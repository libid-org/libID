// SPDX-License-Identifier: MIT OR Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {CeremonyProofVerifier} from "libid-contracts/ceremony/CeremonyProofVerifier.sol";
import {IPlatformVerifier} from "libid-contracts/ceremony/IPlatformVerifier.sol";
import {IProofVerifier} from "libid-contracts/ceremony/IProofVerifier.sol";
import {HandleEscrow} from "libid-contracts/escrow/HandleEscrow.sol";
import {HandleVectors} from "libid-contracts/identity/HandleVectors.sol";
import {IdentityRegistry} from "libid-contracts/identity/IdentityRegistry.sol";
import {IIdentityRegistry} from "libid-contracts/identity/IIdentityRegistry.sol";
import {StubPlatformVerifier} from "libid-contracts/identity/test/StubPlatformVerifier.sol";

import {LibID} from "../LibID.sol";
import {LibIDTestnet} from "../LibIDTestnet.sol";

/// @title LibIDTestBase
/// @notice A base for Foundry tests of a contract that uses LibID. It puts the
///         real IdentityRegistry and HandleEscrow at the addresses LibID has
///         built in, and binds handles without a ceremony.
///
/// @dev The contracts are the ones in libID-contracts, behind proxies, with
///      empty storage. Only the platform verifiers are stand-ins: each answers
///      with the holder, id, handle and `observedAt` that `bindHandle` gives
///      it, and checks nothing. Nothing here is part of LibID itself: it is
///      compiled only into tests that import it.
abstract contract LibIDTestBase is Test {
    bytes32 private constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    /// @notice Owns the registry, the escrow and the proof verifier.
    address internal libidOwner = makeAddr("libid owner");
    IdentityRegistry internal libidRegistry;
    HandleEscrow internal libidEscrow;
    CeremonyProofVerifier internal libidProofs;
    /// @notice The stand-in verifier of each platform `addLibIDPlatform` set up.
    mapping(bytes32 platformId => StubPlatformVerifier) internal libidVerifiers;

    uint256 private libidNonce;

    /// @notice The contracts at `LibID`'s addresses, with GitHub, X and Google
    ///         set up.
    function deployLibID() internal {
        deployLibIDAt(LibID.REGISTRY, LibID.ESCROW);
        _addEveryPlatform();
    }

    /// @notice The contracts at `LibIDTestnet`'s addresses, with GitHub, X and
    ///         Google set up.
    function deployLibIDTestnet() internal {
        deployLibIDAt(LibIDTestnet.REGISTRY, LibIDTestnet.ESCROW);
        _addEveryPlatform();
    }

    /// @notice The contracts at the given addresses, with no platform set up.
    function deployLibIDAt(address registry, address escrow) internal {
        _proxyAt(registry, address(new IdentityRegistry()));
        libidRegistry = IdentityRegistry(registry);
        libidRegistry.initialize(libidOwner);
        _proxyAt(escrow, address(new HandleEscrow()));
        libidEscrow = HandleEscrow(escrow);
        libidEscrow.initialize(libidOwner, IIdentityRegistry(registry));

        libidProofs = CeremonyProofVerifier(
            address(
                new ERC1967Proxy(
                    address(new CeremonyProofVerifier()), abi.encodeCall(CeremonyProofVerifier.initialize, (libidOwner))
                )
            )
        );
        vm.prank(libidOwner);
        libidRegistry.setProofVerifier(IProofVerifier(address(libidProofs)));
    }

    /// @notice Set up a platform with its real handle rules and a stand-in
    ///         verifier. `platformId` is `LibID.GITHUB`, `LibID.X` or
    ///         `LibID.GOOGLE`.
    function addLibIDPlatform(bytes32 platformId) internal {
        StubPlatformVerifier verifier = new StubPlatformVerifier(platformId, 0);
        libidVerifiers[platformId] = verifier;
        vm.startPrank(libidOwner);
        libidRegistry.setPlatform(platformId, HandleVectors.rulesFor(platformId));
        libidProofs.setVerifier(platformId, 1, IPlatformVerifier(address(verifier)));
        vm.stopPrank();
    }

    /// @notice Bind a handle to `holder` with a proof observed now.
    function bindHandle(address holder, bytes32 platformId, string memory id, string memory handle) internal {
        bindHandle(holder, platformId, id, handle, uint64(block.timestamp), true);
    }

    /// @notice Bind a handle to `holder` as a proof with this `observedAt`
    ///         would, publishing it if `publish` is set.
    /// @dev The registry refuses a proof no newer than the last one of the
    ///      same handle or id; move the clock between such binds.
    function bindHandle(
        address holder,
        bytes32 platformId,
        string memory id,
        string memory handle,
        uint64 observedAt,
        bool publish
    ) internal {
        StubPlatformVerifier verifier = libidVerifiers[platformId];
        require(address(verifier) != address(0), "LibIDTestBase: platform not added");
        verifier.set(id, handle);
        verifier.setObservedAt(observedAt);
        bytes memory payload = abi.encode(
            StubPlatformVerifier.StubPayload({
                ceremonyVersion: 1,
                operationDomain: keccak256("libid.claim-identity"),
                authorizationNonce: bytes32(++libidNonce),
                transactionData: abi.encode(holder, uint256(0), address(0))
            })
        );
        vm.prank(holder);
        libidRegistry.bind(platformId, 1, payload, publish);
    }

    function _addEveryPlatform() private {
        addLibIDPlatform(LibID.GITHUB);
        addLibIDPlatform(LibID.X);
        addLibIDPlatform(LibID.GOOGLE);
    }

    /// @dev An ERC-1967 proxy for `implementation` at `at`, with empty storage.
    function _proxyAt(address at, address implementation) private {
        ERC1967Proxy template = new ERC1967Proxy(implementation, "");
        vm.etch(at, address(template).code);
        vm.store(at, IMPLEMENTATION_SLOT, bytes32(uint256(uint160(implementation))));
    }
}
