// SPDX-License-Identifier: MIT OR Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {CeremonyProofVerifier} from "libid-contracts/ceremony/CeremonyProofVerifier.sol";
import {IPlatformVerifier} from "libid-contracts/ceremony/IPlatformVerifier.sol";
import {IProofVerifier} from "libid-contracts/ceremony/IProofVerifier.sol";
import {HandleEscrow} from "libid-contracts/escrow/HandleEscrow.sol";
import {NoReturnToken, TestERC20, one} from "libid-contracts/escrow/test/EscrowMocks.sol";
import {Create3} from "libid-contracts/factory/Create3.sol";
import {HandleVectors} from "libid-contracts/identity/HandleVectors.sol";
import {IdentityNodes} from "libid-contracts/identity/IdentityNodes.sol";
import {IdentityRegistry} from "libid-contracts/identity/IdentityRegistry.sol";
import {IIdentityRegistry} from "libid-contracts/identity/IIdentityRegistry.sol";
import {StubPlatformVerifier} from "libid-contracts/identity/test/StubPlatformVerifier.sol";

import {LibID} from "../src/LibID.sol";

/// @notice A contract that uses LibID, as an integrator's would.
contract Consumer {
    function isAvailable() external view returns (bool) {
        return LibID.isAvailable();
    }

    function resolve(bytes32 platformId, string calldata handle) external view returns (address) {
        return LibID.resolve(platformId, handle);
    }

    function resolve(bytes32 platformId, string calldata handle, uint256 maxAge) external view returns (address) {
        return LibID.resolve(platformId, handle, maxAge);
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

    function gated(string calldata handle, uint256 maxAge) external view returns (bool) {
        LibID.requireHolder(LibID.GITHUB, handle, maxAge);
        return true;
    }

    function pay(bytes32 platformId, string calldata handle, uint256 amount, address refundTo) external {
        LibID.pay(platformId, handle, amount, refundTo);
    }

    function payToken(bytes32 platformId, string calldata handle, address token, uint256 amount, address refundTo)
        external
    {
        LibID.payToken(platformId, handle, token, amount, refundTo);
    }

    receive() external payable {}
}

contract LibIDTest is Test {
    /// The factory every canonical address derives from.
    address constant FACTORY = 0xa92244C3F4462aaD08bD1A33c3940b9B936321AD;
    bytes32 constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal sender = makeAddr("sender");

    IdentityRegistry internal registry = IdentityRegistry(LibID.REGISTRY);
    HandleEscrow internal escrow = HandleEscrow(LibID.ESCROW);
    StubPlatformVerifier internal github;
    Consumer internal consumer;
    uint256 internal nonce;

    function setUp() public {
        vm.warp(1_800_000_000);

        // The real contracts, behind proxies at their canonical addresses.
        _proxyAt(LibID.REGISTRY, address(new IdentityRegistry()));
        registry.initialize(owner);
        _proxyAt(LibID.ESCROW, address(new HandleEscrow()));

        CeremonyProofVerifier proofs = CeremonyProofVerifier(
            address(
                new ERC1967Proxy(
                    address(new CeremonyProofVerifier()), abi.encodeCall(CeremonyProofVerifier.initialize, (owner))
                )
            )
        );
        github = new StubPlatformVerifier(LibID.GITHUB, 0);
        vm.startPrank(owner);
        registry.setProofVerifier(IProofVerifier(address(proofs)));
        registry.setPlatform(LibID.GITHUB, HandleVectors.rulesFor(LibID.GITHUB));
        proofs.setVerifier(LibID.GITHUB, 1, IPlatformVerifier(address(github)));
        vm.stopPrank();
        escrow.initialize(owner, IIdentityRegistry(LibID.REGISTRY));

        consumer = new Consumer();
        vm.deal(address(consumer), 10 ether);
    }

    // ─── Addresses ──────────────────────────────────────────────────

    /// The constants are the factory's CREATE3 addresses for the canonical
    /// names, computed here independently of the literals in LibID.
    function test_theAddressesAreTheFactoryAddressesOfTheCanonicalNames() public pure {
        assertEq(LibID.REGISTRY, Create3.addressOf(keccak256("libid.IdentityRegistry"), FACTORY));
        assertEq(LibID.ESCROW, Create3.addressOf(keccak256("libid.HandleEscrow.2"), FACTORY));
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

    function test_resolveRevertsForAPlatformThatIsNotSetUp() public {
        vm.expectRevert(abi.encodeWithSelector(IIdentityRegistry.UnknownPlatform.selector, LibID.X));
        consumer.resolve(LibID.X, "octocat");
    }

    function test_resolveWithAMaxAgeDropsOldProofs() public {
        _bind(alice, "1001", "octocat", true);
        uint64 provedAt = _provedAt("octocat");
        assertEq(consumer.resolve(LibID.GITHUB, "octocat", 1 days), alice);
        vm.warp(provedAt + 1 days);
        assertEq(consumer.resolve(LibID.GITHUB, "octocat", 1 days), alice, "exactly maxAge old");
        vm.warp(provedAt + 1 days + 1);
        assertEq(consumer.resolve(LibID.GITHUB, "octocat", 1 days), address(0), "one second too old");
        assertEq(consumer.resolve(LibID.GITHUB, "nobody", 1 days), address(0));
        assertEq(consumer.resolve(LibID.GITHUB, "not a handle", 1 days), address(0));
    }

    /// A Google proof's time is its token's expiry, ahead of the block. That
    /// must read as fresh, not revert on a subtraction.
    function test_aProofTimeAheadOfTheBlockIsFresh() public {
        _bindAt(alice, "1001", "octocat", uint64(vm.getBlockTimestamp() + 1 hours), true);
        assertEq(consumer.resolve(LibID.GITHUB, "octocat", 0), alice);
        assertTrue(consumer.isHolder(alice, LibID.GITHUB, "octocat", 0));
    }

    /// The largest maxAge means any age, not an overflow.
    function test_theLargestMaxAgeAcceptsAnyAge() public {
        _bind(alice, "1001", "octocat", true);
        vm.warp(_provedAt("octocat") + 3650 days);
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
        vm.warp(_provedAt("octocat") + 2 days);
        assertFalse(consumer.isHolder(alice, LibID.GITHUB, "octocat", 1 days));
    }

    function test_requireHolderLetsTheHolderIn() public {
        _bind(alice, "1001", "octocat", true);
        vm.prank(alice);
        assertTrue(consumer.gated("octocat", 1 days));
    }

    function test_requireHolderNamesWhoHoldsTheHandle() public {
        _bind(alice, "1001", "octocat", true);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(LibID.NotHolder.selector, alice, bob));
        consumer.gated("octocat", 1 days);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(LibID.NotHolder.selector, address(0), bob));
        consumer.gated("nobody", 1 days);
    }

    function test_requireHolderRefusesAnOldProof() public {
        _bind(alice, "1001", "octocat", true);
        uint64 provedAt = _provedAt("octocat");
        vm.warp(provedAt + 2 days);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LibID.ProofTooOld.selector, provedAt));
        consumer.gated("octocat", 1 days);
    }

    // ─── Paying ─────────────────────────────────────────────────────

    function test_payReachesTheHolderAtOnce() public {
        _bind(alice, "1001", "octocat", true);
        consumer.pay(LibID.GITHUB, "@Octocat", 1 ether, sender);
        assertEq(alice.balance, 1 ether);
    }

    function test_payToAnUnheldHandleWaitsForItsHolder() public {
        consumer.pay(LibID.GITHUB, "carol", 1 ether, sender);
        bytes32 node = IdentityNodes.handleNode(LibID.GITHUB, "carol");
        assertEq(escrow.escrowed(node, LibID.NATIVE), 1 ether);

        address carol = makeAddr("carol");
        _bind(carol, "3003", "carol", true);
        vm.prank(carol);
        escrow.claim(node, one(LibID.NATIVE), carol);
        assertEq(carol.balance, 1 ether);
    }

    function test_payRefusesTextThatIsNotAHandle() public {
        vm.expectRevert();
        consumer.pay(LibID.GITHUB, "not a handle", 1 ether, sender);
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
        consumer.payToken(LibID.GITHUB, "carol", address(token), 25, sender);
        assertEq(escrow.escrowed(IdentityNodes.handleNode(LibID.GITHUB, "carol"), address(token)), 25);
    }

    function test_payTokenRefusesAnAddressWithoutCode() public {
        address notAToken = makeAddr("notAToken");
        vm.expectRevert(abi.encodeWithSelector(LibID.ApproveFailed.selector, notAToken));
        consumer.payToken(LibID.GITHUB, "carol", notAToken, 25, sender);
    }

    // ─── A chain without libID ──────────────────────────────────────

    function test_everyCallRevertsClearlyWhereLibIDIsNotDeployed() public {
        vm.etch(LibID.REGISTRY, "");
        vm.etch(LibID.ESCROW, "");
        assertFalse(consumer.isAvailable());

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
        consumer.pay(LibID.GITHUB, "octocat", 1 ether, sender);
    }

    function test_isAvailableWhenBothContractsAreThere() public view {
        assertTrue(consumer.isAvailable());
    }

    // ─── Helpers ────────────────────────────────────────────────────

    function _provedAt(string memory handle) internal view returns (uint64 observedAt) {
        (, observedAt) = registry.handleBinding(IdentityNodes.handleNode(LibID.GITHUB, handle));
    }

    /// Puts an ERC-1967 proxy for `implementation` at `at`, with empty storage.
    function _proxyAt(address at, address implementation) internal {
        ERC1967Proxy template = new ERC1967Proxy(implementation, "");
        vm.etch(at, address(template).code);
        vm.store(at, IMPLEMENTATION_SLOT, bytes32(uint256(uint160(implementation))));
    }

    function _bind(address who, string memory id, string memory handle, bool publish) internal {
        _bindAt(who, id, handle, uint64(vm.getBlockTimestamp()) + uint64(++nonce), publish);
    }

    function _bindAt(address who, string memory id, string memory handle, uint64 observedAt, bool publish) internal {
        github.set(id, handle);
        github.setObservedAt(observedAt);
        bytes memory payload = abi.encode(
            StubPlatformVerifier.StubPayload({
                ceremonyVersion: 1,
                operationDomain: keccak256("libid.claim-identity"),
                authorizationNonce: bytes32(++nonce),
                transactionData: abi.encode(who, uint256(0), address(0))
            })
        );
        vm.prank(who);
        registry.bind(LibID.GITHUB, 1, payload, publish);
    }
}

/// Reads the real Eden deployment. Runs only with EDEN_RPC_URL set.
contract LibIDForkTest is Test {
    function setUp() public {
        string memory rpc = vm.envOr("EDEN_RPC_URL", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);
    }

    function test_edenRunsLibIDAtTheEmbeddedAddresses() public {
        Consumer consumer = new Consumer();
        assertTrue(consumer.isAvailable());
        assertEq(address(HandleEscrow(LibID.ESCROW).registry()), LibID.REGISTRY);
        assertEq(consumer.resolve(LibID.GITHUB, "nobody-has-this-handle-xyz"), address(0));
    }
}
