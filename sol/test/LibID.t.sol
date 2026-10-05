// SPDX-License-Identifier: MIT OR Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {CeremonyProfile} from "libid-contracts/ceremony/CeremonyProfile.sol";
import {HandleEscrow} from "libid-contracts/escrow/HandleEscrow.sol";
import {FeeToken, NoReturnToken, PayoutFeeToken, TestERC20, one} from "libid-contracts/escrow/test/EscrowMocks.sol";
import {Create3} from "libid-contracts/factory/Create3.sol";
import {HandleNormalizer} from "libid-contracts/identity/HandleNormalizer.sol";
import {HandleVectors} from "libid-contracts/identity/HandleVectors.sol";
import {IdentityNodes} from "libid-contracts/identity/IdentityNodes.sol";
import {IdentityRegistry} from "libid-contracts/identity/IdentityRegistry.sol";
import {IIdentityRegistry} from "libid-contracts/identity/IIdentityRegistry.sol";

import {LibID} from "../src/LibID.sol";
import {LibIDTestnet} from "../src/LibIDTestnet.sol";
import {LibIDTestBase} from "../src/test/LibIDTestBase.sol";

/// @notice A contract that uses LibID, as an integrator's would.
contract Consumer {
    function isAvailable() external view returns (bool) {
        return LibID.isAvailable();
    }

    function isEscrowAvailable() external view returns (bool) {
        return LibID.isEscrowAvailable();
    }

    function resolve(bytes32 platformId, string calldata handle) external view returns (address) {
        return LibID.resolve(platformId, handle);
    }

    function resolve(bytes32 platformId, string calldata handle, uint256 maxAge) external view returns (address) {
        return LibID.resolve(platformId, handle, maxAge);
    }

    function bindingOf(bytes32 platformId, string calldata handle) external view returns (address, uint64) {
        return LibID.bindingOf(platformId, handle);
    }

    function resolveId(bytes32 platformId, string calldata id) external view returns (address) {
        return LibID.resolveId(platformId, id);
    }

    function publishedHandleOf(address holder, bytes32 platformId) external view returns (string memory) {
        return LibID.publishedHandleOf(holder, platformId);
    }

    function isHolder(address account, bytes32 platformId, string calldata handle, uint256 maxAge)
        external
        view
        returns (bool)
    {
        return LibID.isHolder(account, platformId, handle, maxAge);
    }

    function gated(bytes32 platformId, string calldata handle, uint256 maxAge) external view returns (bool) {
        LibID.requireHolder(platformId, handle, maxAge);
        return true;
    }

    function pay(bytes32 platformId, string calldata handle, uint256 amount, address refundTo)
        external
        returns (bytes32)
    {
        return LibID.pay(platformId, handle, amount, refundTo);
    }

    function payToken(bytes32 platformId, string calldata handle, address token, uint256 amount, address refundTo)
        external
        returns (bytes32)
    {
        return LibID.payToken(platformId, handle, token, amount, refundTo);
    }

    function refund(bytes32 handleNode, address token, address recipient) external {
        LibID.refund(handleNode, token, recipient);
    }

    receive() external payable {}
}

/// @notice `approve` reverts on zero, as BNB's does on Ethereum mainnet.
contract NoZeroApproveToken is TestERC20 {
    function approve(address spender, uint256 value) public override returns (bool) {
        require(value > 0, "zero approve");
        return super.approve(spender, value);
    }
}

/// @notice `approve` refuses to change a non-zero allowance, as USDT's does.
contract StrictApproveToken is TestERC20 {
    function approve(address spender, uint256 value) public override returns (bool) {
        require(value == 0 || allowance(msg.sender, spender) == 0, "reset first");
        return super.approve(spender, value);
    }

    function setAllowance(address owner, address spender, uint256 value) external {
        _approve(owner, spender, value);
    }
}

/// @notice `approve` answers with a word that is neither true nor false.
contract DirtyApproveToken is TestERC20 {
    function approve(address, uint256) public pure override returns (bool) {
        assembly {
            mstore(0, 2)
            return(0, 32)
        }
    }
}

/// @notice `approve` answers with one byte.
contract ShortApproveToken is TestERC20 {
    function approve(address, uint256) public pure override returns (bool) {
        assembly {
            mstore8(0, 1)
            return(0, 1)
        }
    }
}

/// @notice `approve` answers true followed by more words.
contract LongApproveToken is TestERC20 {
    function approve(address spender, uint256 value) public override returns (bool) {
        super.approve(spender, value);
        assembly {
            mstore(0, 1)
            mstore(32, 7)
            return(0, 64)
        }
    }
}

/// @notice `approve` answers true padded to 600 KB, to burn a caller that
///         copies the whole answer.
contract BombApproveToken is TestERC20 {
    function approve(address spender, uint256 value) public override returns (bool) {
        super.approve(spender, value);
        assembly {
            mstore(0, 1)
            return(0, 600000)
        }
    }
}

/// @notice A holder that refuses ETH.
contract RejectsEther {
    receive() external payable {
        revert("no");
    }
}

contract LibIDTest is LibIDTestBase {
    /// The factories every canonical address derives from, one per environment.
    address constant FACTORY = 0xb7432C991Be3167689d5e80c9E2bf1ff5cCCd2E0;
    address constant TESTNET_FACTORY = 0x9dBF2b5F96cb31A48cCa4e25D2c8348Be414ebC8;
    /// A Google ID token lives an hour; its `exp` is the evidence time.
    uint64 constant GOOGLE_TOKEN_LIFETIME = 1 hours;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal sender = makeAddr("sender");

    IdentityRegistry internal registry = IdentityRegistry(LibID.REGISTRY);
    HandleEscrow internal escrow = HandleEscrow(LibID.ESCROW);
    Consumer internal consumer;

    function setUp() public {
        vm.warp(1_800_000_000);

        // The real contracts at their canonical addresses. X is left out, to
        // test a platform that is not set up.
        deployLibIDAt(LibID.REGISTRY, LibID.ESCROW);
        addLibIDPlatform(LibID.GITHUB);
        addLibIDPlatform(LibID.GOOGLE);

        consumer = new Consumer();
        vm.deal(address(consumer), 10 ether);
    }

    // ─── Addresses ──────────────────────────────────────────────────

    /// The constants are the factory's CREATE3 addresses for the canonical
    /// names, computed here independently of the literals in LibID.
    function test_theAddressesAreTheFactoryAddressesOfTheCanonicalNames() public pure {
        assertEq(LibID.REGISTRY, Create3.addressOf(keccak256("libid.IdentityRegistry"), FACTORY));
        assertEq(LibID.ESCROW, Create3.addressOf(keccak256("libid.HandleEscrow.2"), FACTORY));
        assertEq(LibIDTestnet.REGISTRY, Create3.addressOf(keccak256("libid.IdentityRegistry"), TESTNET_FACTORY));
        assertEq(LibIDTestnet.ESCROW, Create3.addressOf(keccak256("libid.HandleEscrow.2"), TESTNET_FACTORY));
    }

    function test_thePlatformIdsAreTheContractsOwn() public pure {
        assertEq(LibID.GITHUB, HandleVectors.PLATFORM_GITHUB);
        assertEq(LibID.X, HandleVectors.PLATFORM_X);
        assertEq(LibID.GOOGLE, HandleVectors.PLATFORM_GOOGLE);
    }

    // ─── Resolving ──────────────────────────────────────────────────

    function test_resolveFindsTheHolderAsTheUserTypedIt() public {
        _bind(alice, "1001", "octocat", true);
        assertEq(consumer.resolve(LibID.GITHUB, "octocat"), alice);
        assertEq(consumer.resolve(LibID.GITHUB, "@OctoCat"), alice);
        assertEq(consumer.resolve(LibID.GITHUB, "nobody"), address(0));
        assertEq(consumer.resolve(LibID.GITHUB, "not a handle"), address(0));
    }

    /// A Google handle is an email address: case does not matter, a leading
    /// at-sign makes it no handle at all.
    function test_aGoogleHandleTakesNoLeadingAtSign() public {
        _bindGoogle(alice, "0xabc", "alice@gmail.com");
        assertEq(consumer.resolve(LibID.GOOGLE, "Alice@Gmail.com"), alice);
        assertEq(consumer.resolve(LibID.GOOGLE, "@alice@gmail.com"), address(0));
    }

    /// Rules but no verifier yet is not set up either: the age-checking reads
    /// must say so, as `resolve` does, not answer "nobody holds it".
    function test_aPlatformWithRulesButNoVerifierIsNotSetUp() public {
        vm.prank(libidOwner);
        registry.setPlatform(LibID.X, HandleVectors.rulesFor(LibID.X));
        bytes memory unknown = abi.encodeWithSelector(IIdentityRegistry.UnknownPlatform.selector, LibID.X);
        vm.expectRevert(unknown);
        consumer.resolve(LibID.X, "jack");
        vm.expectRevert(unknown);
        consumer.resolve(LibID.X, "jack", 1 days);
        vm.expectRevert(unknown);
        consumer.isHolder(alice, LibID.X, "jack", 1 days);
        vm.expectRevert(unknown);
        consumer.bindingOf(LibID.X, "jack");
        vm.expectRevert(unknown);
        consumer.bindingOf(LibID.X, "not a handle");
        vm.prank(alice);
        vm.expectRevert(unknown);
        consumer.gated(LibID.X, "jack", 1 days);
        assertEq(consumer.publishedHandleOf(alice, LibID.X), "", "published reads never revert");
    }

    function test_bindingOfTellsTheCasesApart() public {
        _bind(alice, "1001", "octocat", true);
        (address holder, uint64 observedAt) = consumer.bindingOf(LibID.GITHUB, "@Octocat");
        assertEq(holder, alice);
        assertEq(observedAt, _provedAt(LibID.GITHUB, "octocat"));

        (holder, observedAt) = consumer.bindingOf(LibID.GITHUB, "nobody");
        assertEq(holder, address(0));
        assertEq(observedAt, 0);
        (holder, observedAt) = consumer.bindingOf(LibID.GITHUB, "not a handle");
        assertEq(holder, address(0));
        assertEq(observedAt, 0);

        // A retired handle is unheld but keeps the time of its last proof.
        uint64 retiredAt = _provedAt(LibID.GITHUB, "octocat");
        _bind(alice, "1001", "octocat2", true);
        (holder, observedAt) = consumer.bindingOf(LibID.GITHUB, "octocat");
        assertEq(holder, address(0));
        assertEq(observedAt, retiredAt);
    }

    function test_theReadsRevertForAPlatformThatIsNotSetUp() public {
        bytes memory unknown = abi.encodeWithSelector(IIdentityRegistry.UnknownPlatform.selector, LibID.X);
        vm.expectRevert(unknown);
        consumer.resolve(LibID.X, "octocat");
        vm.expectRevert(unknown);
        consumer.resolve(LibID.X, "octocat", 1 days);
        vm.expectRevert(unknown);
        consumer.isHolder(alice, LibID.X, "octocat", 1 days);
    }

    function test_resolveWithAMaxAgeDropsOldProofs() public {
        _bind(alice, "1001", "octocat", true);
        uint64 provedAt = _provedAt(LibID.GITHUB, "octocat");
        assertEq(consumer.resolve(LibID.GITHUB, "octocat", 1 days), alice);
        vm.warp(provedAt + 1 days);
        assertEq(consumer.resolve(LibID.GITHUB, "octocat", 1 days), alice, "exactly maxAge old");
        vm.warp(provedAt + 1 days + 1);
        assertEq(consumer.resolve(LibID.GITHUB, "octocat", 1 days), address(0), "one second too old");
        assertEq(consumer.resolve(LibID.GITHUB, "nobody", 1 days), address(0));
        assertEq(consumer.resolve(LibID.GITHUB, "not a handle", 1 days), address(0));
    }

    /// The verifiers date a proof a fixed allowance before its evidence. With
    /// the notary's and Google's clocks on the block's, a GitHub proof made
    /// now reads 5 minutes old and a Google one an hour old.
    function test_aProofMadeNowReadsAsOldAsItsAllowance() public {
        _bind(alice, "1001", "octocat", true);
        assertFalse(consumer.isHolder(alice, LibID.GITHUB, "octocat", 5 minutes - 1));
        assertTrue(consumer.isHolder(alice, LibID.GITHUB, "octocat", 5 minutes));

        _bindGoogle(bob, "0xabc", "bob@gmail.com");
        assertFalse(consumer.isHolder(bob, LibID.GOOGLE, "bob@gmail.com", 1 hours - 1));
        assertTrue(consumer.isHolder(bob, LibID.GOOGLE, "bob@gmail.com", 1 hours));
    }

    /// The GitHub verifier accepts a session signed as far ahead of the block
    /// as its allowance, so a proof can have no age at all when bound.
    function test_aGitHubProofSignedAheadOfTheBlockCanHaveNoAge() public {
        _tick();
        uint64 blockTime = uint64(vm.getBlockTimestamp());
        uint64 ahead = CeremonyProfile.MAX_FUTURE_ATTESTATION_SKEW_SECONDS_GITHUB;
        uint64 allowance = CeremonyProfile.FUTURE_OBSERVATION_ALLOWANCE_SECONDS_GITHUB;
        if (ahead > allowance) ahead = allowance;
        _bindSignedAt(alice, "1001", "octocat", blockTime + ahead, true);

        uint64 youngest = allowance - ahead;
        assertEq(youngest, 0);
        assertEq(_provedAt(LibID.GITHUB, "octocat"), blockTime);
        assertTrue(consumer.isHolder(alice, LibID.GITHUB, "octocat", youngest));
    }

    /// The Google verifier accepts a token that expires as far ahead of the
    /// block as its allowance, so a proof can have no age at all when bound.
    function test_aGoogleProofExpiringAtTheAllowanceCanHaveNoAge() public {
        _tick();
        uint64 blockTime = uint64(vm.getBlockTimestamp());
        _bindGoogleExpiring(
            alice, "0xabc", "alice@gmail.com", blockTime + CeremonyProfile.FUTURE_OBSERVATION_ALLOWANCE_SECONDS_GOOGLE
        );
        assertEq(_provedAt(LibID.GOOGLE, "alice@gmail.com"), blockTime);
        assertTrue(consumer.isHolder(alice, LibID.GOOGLE, "alice@gmail.com", 0));
    }

    /// The verifiers accept a GitHub session up to an hour old, so a proof
    /// can be nearly 65 minutes old the moment it is bound.
    function test_aGitHubProofBoundLateIsAlreadyOverAnHourOld() public {
        _tick();
        uint64 blockTime = uint64(vm.getBlockTimestamp());
        _bindSignedAt(alice, "1001", "octocat", blockTime - (CeremonyProfile.PROOF_LIFETIME_SECONDS_GITHUB - 1), true);
        assertFalse(consumer.isHolder(alice, LibID.GITHUB, "octocat", 1 hours));
        assertFalse(consumer.isHolder(alice, LibID.GITHUB, "octocat", 65 minutes - 2));
        assertTrue(consumer.isHolder(alice, LibID.GITHUB, "octocat", 65 minutes - 1));
    }

    /// The Google verifier accepts a token until it expires, so a proof can
    /// be nearly 2 hours old the moment it is bound.
    function test_aGoogleProofBoundLateIsAlreadyNearlyTwoHoursOld() public {
        _tick();
        _bindGoogleExpiring(alice, "0xabc", "alice@gmail.com", uint64(vm.getBlockTimestamp()) + 1);
        assertFalse(consumer.isHolder(alice, LibID.GOOGLE, "alice@gmail.com", 2 hours - 2));
        assertTrue(consumer.isHolder(alice, LibID.GOOGLE, "alice@gmail.com", 2 hours - 1));
    }

    function test_theLargestMaxAgeAcceptsAnyAge() public {
        _bind(alice, "1001", "octocat", true);
        vm.warp(_provedAt(LibID.GITHUB, "octocat") + 3650 days);
        assertEq(consumer.resolve(LibID.GITHUB, "octocat", type(uint256).max), alice);
        assertTrue(consumer.isHolder(alice, LibID.GITHUB, "octocat", type(uint256).max));
        assertFalse(consumer.isHolder(address(0), LibID.GITHUB, "nobody", type(uint256).max));
    }

    function test_resolveIdFollowsTheIdentityAcrossARename() public {
        _bind(alice, "1001", "octocat", true);
        _bind(alice, "1001", "octocat2", true);
        assertEq(consumer.resolveId(LibID.GITHUB, "1001"), alice);
        assertEq(consumer.resolve(LibID.GITHUB, "octocat"), address(0));
    }

    function test_publishedHandleOfIsEmptyOnceTheHandleIsLost() public {
        _bind(alice, "1001", "octocat", true);
        assertEq(consumer.publishedHandleOf(alice, LibID.GITHUB), "octocat");
        _bind(bob, "2002", "octocat", false);
        assertEq(consumer.publishedHandleOf(alice, LibID.GITHUB), "");
    }

    // ─── Gating ─────────────────────────────────────────────────────

    function test_isHolder() public {
        _bind(alice, "1001", "octocat", true);
        assertTrue(consumer.isHolder(alice, LibID.GITHUB, "octocat", 1 days));
        assertFalse(consumer.isHolder(bob, LibID.GITHUB, "octocat", 1 days));
        assertFalse(consumer.isHolder(address(0), LibID.GITHUB, "nobody", 1 days));
        vm.warp(_provedAt(LibID.GITHUB, "octocat") + 2 days);
        assertFalse(consumer.isHolder(alice, LibID.GITHUB, "octocat", 1 days));
    }

    function test_requireHolderLetsTheHolderIn() public {
        _bind(alice, "1001", "octocat", true);
        vm.prank(alice);
        assertTrue(consumer.gated(LibID.GITHUB, "octocat", 1 days));
    }

    function test_requireHolderNamesWhoHoldsTheHandle() public {
        _bind(alice, "1001", "octocat", true);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(LibID.NotHolder.selector, alice, bob));
        consumer.gated(LibID.GITHUB, "octocat", 1 days);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(LibID.NotHolder.selector, address(0), bob));
        consumer.gated(LibID.GITHUB, "nobody", 1 days);
    }

    /// A handle nobody holds must not let the zero address in, which is the
    /// sender of an `eth_call` that names none.
    function test_requireHolderNeverLetsTheZeroAddressIn() public {
        vm.prank(address(0));
        vm.expectRevert(abi.encodeWithSelector(LibID.NotHolder.selector, address(0), address(0)));
        consumer.gated(LibID.GITHUB, "nobody", type(uint256).max);
    }

    function test_requireHolderRefusesAnOldProof() public {
        _bind(alice, "1001", "octocat", true);
        uint64 provedAt = _provedAt(LibID.GITHUB, "octocat");
        vm.warp(provedAt + 2 days);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LibID.ProofTooOld.selector, provedAt));
        consumer.gated(LibID.GITHUB, "octocat", 1 days);
    }

    // ─── Paying ─────────────────────────────────────────────────────

    function test_payReachesTheHolderAtOnce() public {
        _bind(alice, "1001", "octocat", true);
        bytes32 node = consumer.pay(LibID.GITHUB, "@Octocat", 1 ether, sender);
        assertEq(node, IdentityNodes.handleNode(LibID.GITHUB, "octocat"));
        assertEq(node, registry.handleNodeOfHash(LibID.GITHUB, registry.handleHashOf(LibID.GITHUB, "octocat")));
        assertEq(alice.balance, 1 ether);
    }

    /// `pay` returns the node the registry gives for the hash, which is the
    /// node the escrow books the deposit at, whatever formula derives it.
    function test_payReturnsTheNodeTheEscrowBooks() public {
        bytes32 hash = registry.handleHashOf(LibID.GITHUB, "carol");
        bytes32 node = keccak256("another node");
        vm.mockCall(
            LibID.REGISTRY, abi.encodeCall(IIdentityRegistry.handleNodeOfHash, (LibID.GITHUB, hash)), abi.encode(node)
        );
        assertEq(consumer.pay(LibID.GITHUB, "carol", 1 ether, sender), node);
        assertEq(escrow.escrowed(node, LibID.NATIVE), 1 ether);

        TestERC20 token = new TestERC20();
        token.mint(address(consumer), 100);
        assertEq(consumer.payToken(LibID.GITHUB, "carol", address(token), 40, sender), node);
        assertEq(escrow.escrowed(node, address(token)), 40);
    }

    function test_payToAnUnheldHandleWaitsForItsHolder() public {
        bytes32 node = consumer.pay(LibID.GITHUB, "carol", 1 ether, sender);
        assertEq(escrow.escrowed(node, LibID.NATIVE), 1 ether);

        address carol = makeAddr("carol");
        _bind(carol, "3003", "carol", true);
        vm.prank(carol);
        escrow.claim(node, one(LibID.NATIVE), carol);
        assertEq(carol.balance, 1 ether);
    }

    function test_payRefusesTextThatIsNotAHandle() public {
        vm.expectRevert(
            abi.encodeWithSelector(IIdentityRegistry.UnusableHandle.selector, HandleNormalizer.Problem.BadChar)
        );
        consumer.pay(LibID.GITHUB, "not a handle", 1 ether, sender);
    }

    /// The holder's code runs inside `pay`; a holder that refuses ETH makes
    /// the payment revert.
    function test_aHolderThatRefusesEtherMakesPayRevert() public {
        address holder = address(new RejectsEther());
        _bind(holder, "4004", "refuser", true);
        vm.expectRevert(abi.encodeWithSelector(HandleEscrow.NativeTransferFailed.selector, holder, 1 ether));
        consumer.pay(LibID.GITHUB, "refuser", 1 ether, sender);
    }

    function test_payTokenApprovesAndDeposits() public {
        TestERC20 token = new TestERC20();
        token.mint(address(consumer), 100);
        _bind(alice, "1001", "octocat", true);
        consumer.payToken(LibID.GITHUB, "octocat", address(token), 40, sender);
        assertEq(token.balanceOf(alice), 40);
        assertEq(token.allowance(address(consumer), LibID.ESCROW), 0);
    }

    function test_payTokenWorksWithATokenThatReturnsNothing() public {
        NoReturnToken token = new NoReturnToken();
        token.mint(address(consumer), 100);
        bytes32 node = consumer.payToken(LibID.GITHUB, "carol", address(token), 25, sender);
        assertEq(escrow.escrowed(node, address(token)), 25);
    }

    function test_payTokenWorksWithATokenThatRefusesAZeroApproval() public {
        NoZeroApproveToken token = new NoZeroApproveToken();
        token.mint(address(consumer), 100);
        bytes32 node = consumer.payToken(LibID.GITHUB, "carol", address(token), 25, sender);
        assertEq(escrow.escrowed(node, address(token)), 25);
    }

    function test_payTokenResetsAnAllowanceTheTokenWillNotChange() public {
        StrictApproveToken token = new StrictApproveToken();
        token.mint(address(consumer), 100);
        token.setAllowance(address(consumer), LibID.ESCROW, 7);
        bytes32 node = consumer.payToken(LibID.GITHUB, "carol", address(token), 25, sender);
        assertEq(escrow.escrowed(node, address(token)), 25);
        assertEq(token.allowance(address(consumer), LibID.ESCROW), 0);
    }

    /// The escrow books what arrives, so a token that takes a fee from the
    /// amount received still reaches the holder.
    function test_payTokenWorksWithATokenThatTakesAFeeFromTheAmount() public {
        FeeToken token = new FeeToken();
        token.mint(address(consumer), 1000);
        bytes32 node = consumer.payToken(LibID.GITHUB, "carol", address(token), 1000, sender);
        assertEq(escrow.escrowed(node, address(token)), 990);

        address carol = makeAddr("carol");
        _bind(carol, "3003", "carol", true);
        vm.prank(carol);
        escrow.claim(node, one(address(token)), carol);
        assertEq(token.balanceOf(carol), 990);
    }

    function test_payTokenAcceptsATrueFollowedByMoreWords() public {
        LongApproveToken token = new LongApproveToken();
        token.mint(address(consumer), 100);
        bytes32 node = consumer.payToken(LibID.GITHUB, "carol", address(token), 25, sender);
        assertEq(escrow.escrowed(node, address(token)), 25);
    }

    /// Only the first word of the answer is copied: `payToken` costs the
    /// token's own `approve` plus the usual deposit, not a second copy of a
    /// huge answer.
    function test_aHugeApproveAnswerDoesNotBurnTheCallersGas() public {
        BombApproveToken token = new BombApproveToken();
        token.mint(address(consumer), 100);
        uint256 start = gasleft();
        token.approve(address(this), 1);
        uint256 approveCost = start - gasleft();

        start = gasleft();
        consumer.payToken(LibID.GITHUB, "carol", address(token), 25, sender);
        assertLt(start - gasleft(), approveCost + 400_000);
    }

    function test_payTokenRefusesAnAddressWithoutCode() public {
        address notAToken = makeAddr("notAToken");
        vm.expectRevert(abi.encodeWithSelector(LibID.ApproveFailed.selector, notAToken));
        consumer.payToken(LibID.GITHUB, "carol", notAToken, 25, sender);
    }

    function test_payTokenRefusesAnApproveAnswerThatIsNotTrue() public {
        address dirty = address(new DirtyApproveToken());
        vm.expectRevert(abi.encodeWithSelector(LibID.ApproveFailed.selector, dirty));
        consumer.payToken(LibID.GITHUB, "carol", dirty, 25, sender);

        address short = address(new ShortApproveToken());
        vm.expectRevert(abi.encodeWithSelector(LibID.ApproveFailed.selector, short));
        consumer.payToken(LibID.GITHUB, "carol", short, 25, sender);
    }

    // ─── Refunding ──────────────────────────────────────────────────

    function test_aContractTakesBackWhatItEscrowed() public {
        address recipient = makeAddr("recipient");
        bytes32 node = consumer.pay(LibID.GITHUB, "carol", 1 ether, address(consumer));
        consumer.refund(node, LibID.NATIVE, recipient);
        assertEq(recipient.balance, 1 ether);
    }

    function test_aContractTakesBackTheTokensItEscrowed() public {
        TestERC20 token = new TestERC20();
        token.mint(address(consumer), 100);
        address recipient = makeAddr("recipient");
        bytes32 node = consumer.payToken(LibID.GITHUB, "carol", address(token), 40, address(consumer));
        consumer.refund(node, address(token), recipient);
        assertEq(token.balanceOf(recipient), 40);
        assertEq(token.balanceOf(address(consumer)), 60);
        assertEq(escrow.escrowed(node, address(token)), 0);
    }

    /// A token that takes a fee from what the escrow receives: the refund is
    /// what the escrow booked.
    function test_aRefundOfAFeeTakingTokenReturnsWhatWasBooked() public {
        FeeToken token = new FeeToken();
        token.mint(address(consumer), 1000);
        address recipient = makeAddr("recipient");
        bytes32 node = consumer.payToken(LibID.GITHUB, "carol", address(token), 1000, address(consumer));
        assertEq(escrow.escrowed(node, address(token)), 990);
        consumer.refund(node, address(token), recipient);
        assertEq(token.balanceOf(recipient), 990);
        assertEq(escrow.escrowed(node, address(token)), 0);
    }

    /// A token that takes a fee from what the escrow sends out: the refund
    /// releases what was booked and the recipient gets it less the fee.
    function test_aRefundOfATokenThatTakesAFeeOnPayoutArrivesLessTheFee() public {
        PayoutFeeToken token = new PayoutFeeToken();
        token.mint(address(consumer), 1000);
        address recipient = makeAddr("recipient");
        bytes32 node = consumer.payToken(LibID.GITHUB, "carol", address(token), 1000, address(consumer));
        assertEq(escrow.escrowed(node, address(token)), 1000);
        consumer.refund(node, address(token), recipient);
        assertEq(token.balanceOf(recipient), 990);
        assertEq(escrow.escrowed(node, address(token)), 0);
        assertEq(token.balanceOf(LibID.ESCROW), 0);
    }

    /// The node `pay` returned still reaches the deposit after the platform's
    /// rules change, when the handle text no longer would.
    function test_theReturnedNodeRefundsAfterTheRulesChange() public {
        bytes32 node = consumer.pay(LibID.GITHUB, "carol-long-handle", 1 ether, address(consumer));
        HandleNormalizer.Rules memory narrow = HandleVectors.rulesFor(LibID.GITHUB);
        narrow.maxLength = 10;
        vm.prank(libidOwner);
        registry.setPlatform(LibID.GITHUB, narrow);

        address recipient = makeAddr("recipient");
        consumer.refund(node, LibID.NATIVE, recipient);
        assertEq(recipient.balance, 1 ether);
    }

    function test_refundAfterTheHolderClaimedReverts() public {
        bytes32 node = consumer.pay(LibID.GITHUB, "carol", 1 ether, address(consumer));
        address carol = makeAddr("carol");
        _bind(carol, "3003", "carol", true);
        vm.prank(carol);
        escrow.claim(node, one(LibID.NATIVE), carol);

        vm.expectRevert(
            abi.encodeWithSelector(HandleEscrow.NothingToRefund.selector, node, LibID.NATIVE, address(consumer))
        );
        consumer.refund(node, LibID.NATIVE, makeAddr("recipient"));
    }

    // ─── Availability ───────────────────────────────────────────────

    function test_isAvailableWhenBothContractsAreThere() public view {
        assertTrue(consumer.isAvailable());
        assertTrue(consumer.isEscrowAvailable());
    }

    /// Reads and gates need only the registry; payments need the escrow too.
    function test_aChainWithOnlyTheRegistryStillReadsAndGates() public {
        _bind(alice, "1001", "octocat", true);
        vm.etch(LibID.ESCROW, "");
        assertTrue(consumer.isAvailable());
        assertFalse(consumer.isEscrowAvailable());
        assertEq(consumer.resolve(LibID.GITHUB, "octocat", 1 days), alice);
        vm.prank(alice);
        assertTrue(consumer.gated(LibID.GITHUB, "octocat", 1 days));

        bytes memory unavailable = abi.encodeWithSelector(LibID.LibIDUnavailable.selector);
        vm.expectRevert(unavailable);
        consumer.pay(LibID.GITHUB, "octocat", 1 ether, sender);
        vm.expectRevert(unavailable);
        consumer.payToken(LibID.GITHUB, "octocat", address(1), 1, sender);
        vm.expectRevert(unavailable);
        consumer.refund(bytes32(0), LibID.NATIVE, sender);
    }

    /// An escrow that resolves through another registry is not this one's.
    function test_anEscrowBoundToAnotherRegistryIsNotAvailable() public {
        vm.mockCall(LibID.ESCROW, abi.encodeWithSignature("registry()"), abi.encode(address(0xbeef)));
        assertFalse(consumer.isEscrowAvailable());
    }

    /// An answer that is not a clean address is a plain no, not a revert.
    function test_aDirtyRegistryAnswerIsNotAvailable() public {
        uint256 dirty = uint256(uint160(LibID.REGISTRY)) | (uint256(1) << 200);
        vm.mockCall(LibID.ESCROW, abi.encodeWithSignature("registry()"), abi.encode(dirty));
        assertFalse(consumer.isEscrowAvailable());
    }

    function test_everyCallRevertsClearlyWhereLibIDIsNotDeployed() public {
        vm.etch(LibID.REGISTRY, "");
        vm.etch(LibID.ESCROW, "");
        assertFalse(consumer.isAvailable());
        assertFalse(consumer.isEscrowAvailable());

        bytes memory unavailable = abi.encodeWithSelector(LibID.LibIDUnavailable.selector);
        vm.expectRevert(unavailable);
        consumer.resolve(LibID.GITHUB, "octocat");
        vm.expectRevert(unavailable);
        consumer.resolve(LibID.GITHUB, "octocat", 1 days);
        vm.expectRevert(unavailable);
        consumer.resolveId(LibID.GITHUB, "1001");
        vm.expectRevert(unavailable);
        consumer.publishedHandleOf(alice, LibID.GITHUB);
        vm.expectRevert(unavailable);
        consumer.isHolder(alice, LibID.GITHUB, "octocat", 1 days);
        vm.prank(alice);
        vm.expectRevert(unavailable);
        consumer.gated(LibID.GITHUB, "octocat", 1 days);
        vm.expectRevert(unavailable);
        consumer.pay(LibID.GITHUB, "octocat", 1 ether, sender);
        vm.expectRevert(unavailable);
        consumer.payToken(LibID.GITHUB, "octocat", address(1), 1, sender);
        vm.expectRevert(unavailable);
        consumer.refund(bytes32(0), LibID.NATIVE, sender);
    }

    // ─── Helpers ────────────────────────────────────────────────────

    function _provedAt(bytes32 platformId, string memory handle) internal view returns (uint64 observedAt) {
        (, observedAt) = registry.handleBinding(IdentityNodes.handleNode(platformId, handle));
    }

    /// Moves the clock a second, so each proof is newer than the last.
    function _tick() internal {
        vm.warp(vm.getBlockTimestamp() + 1);
    }

    /// Binds a GitHub handle from a session the notary signed in this block.
    function _bind(address who, string memory id, string memory handle, bool publish) internal {
        _tick();
        _bindSignedAt(who, id, handle, uint64(vm.getBlockTimestamp()), publish);
    }

    /// Binds a GitHub handle as the GitHub verifier dates a session the notary
    /// signed at `createdAt`. The verifier accepts `createdAt` up to its skew
    /// and its allowance ahead of the block, until its proof lifetime has
    /// passed, and sets `observedAt` to `createdAt` less the allowance.
    function _bindSignedAt(address who, string memory id, string memory handle, uint64 createdAt, bool publish)
        internal
    {
        uint64 blockTime = uint64(vm.getBlockTimestamp());
        require(
            createdAt <= blockTime + CeremonyProfile.MAX_FUTURE_ATTESTATION_SKEW_SECONDS_GITHUB
                && createdAt <= blockTime + CeremonyProfile.FUTURE_OBSERVATION_ALLOWANCE_SECONDS_GITHUB
                && blockTime < createdAt + CeremonyProfile.PROOF_LIFETIME_SECONDS_GITHUB,
            "the verifier would refuse it"
        );
        bindHandle(
            who,
            LibID.GITHUB,
            id,
            handle,
            createdAt - CeremonyProfile.FUTURE_OBSERVATION_ALLOWANCE_SECONDS_GITHUB,
            publish
        );
    }

    /// Binds a Google handle from a token Google issued in this block.
    function _bindGoogle(address who, string memory id, string memory handle) internal {
        _tick();
        _bindGoogleExpiring(who, id, handle, uint64(vm.getBlockTimestamp()) + GOOGLE_TOKEN_LIFETIME);
    }

    /// Binds a Google handle as the Google verifier dates a token that expires
    /// at `exp`. The verifier accepts the token until it expires, if `exp` is
    /// no more than its allowance ahead of the block, and sets `observedAt` to
    /// `exp` less the allowance.
    function _bindGoogleExpiring(address who, string memory id, string memory handle, uint64 exp) internal {
        uint64 blockTime = uint64(vm.getBlockTimestamp());
        require(
            blockTime < exp && exp <= blockTime + CeremonyProfile.FUTURE_OBSERVATION_ALLOWANCE_SECONDS_GOOGLE,
            "the verifier would refuse it"
        );
        bindHandle(
            who, LibID.GOOGLE, id, handle, exp - CeremonyProfile.FUTURE_OBSERVATION_ALLOWANCE_SECONDS_GOOGLE, true
        );
    }
}

/// Selects a fork from an RPC URL in `variable`. Skipped when it is empty,
/// unless LIBID_REQUIRE_FORK is set, as CI sets it: then a missing RPC fails.
abstract contract ForkTest is Test {
    function _fork(string memory variable) internal {
        string memory rpc = vm.envOr(variable, string(""));
        if (bytes(rpc).length == 0) {
            require(
                !vm.envOr("LIBID_REQUIRE_FORK", false),
                string.concat("LIBID_REQUIRE_FORK is set but ", variable, " is empty")
            );
            vm.skip(true);
        }
        vm.createSelectFork(rpc);
    }
}

/// Reads the real Ethereum mainnet deployment through LibID.
contract LibIDForkTest is ForkTest {
    function setUp() public {
        _fork("ETH_RPC_URL");
    }

    function test_mainnetRunsLibIDAtTheEmbeddedAddresses() public {
        Consumer consumer = new Consumer();
        assertTrue(consumer.isAvailable());
        assertTrue(consumer.isEscrowAvailable());
        assertEq(address(HandleEscrow(LibID.ESCROW).registry()), LibID.REGISTRY);
        assertEq(consumer.resolve(LibID.GITHUB, "nobody-has-this-handle-xyz"), address(0));
        assertFalse(consumer.isHolder(address(1), LibID.GITHUB, "nobody-has-this-handle-xyz", 1 days));
    }
}

/// Reads the real Sepolia deployment through LibIDTestnet.
contract LibIDTestnetForkTest is ForkTest {
    function setUp() public {
        _fork("SEPOLIA_RPC_URL");
    }

    function test_sepoliaRunsLibIDTestnetAtTheEmbeddedAddresses() public view {
        assertTrue(LibIDTestnet.isAvailable());
        assertTrue(LibIDTestnet.isEscrowAvailable());
        assertEq(address(HandleEscrow(LibIDTestnet.ESCROW).registry()), LibIDTestnet.REGISTRY);
        assertEq(LibIDTestnet.resolve(LibIDTestnet.GITHUB, "nobody-has-this-handle-xyz"), address(0));
        assertFalse(LibIDTestnet.isHolder(address(1), LibIDTestnet.GITHUB, "nobody-has-this-handle-xyz", 1 days));
    }
}
