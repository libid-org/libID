// SPDX-License-Identifier: MIT OR Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";

import {CeremonyProfile} from "libid-contracts/ceremony/CeremonyProfile.sol";
import {CeremonyProofVerifier} from "libid-contracts/ceremony/CeremonyProofVerifier.sol";
import {IPlatformVerifier} from "libid-contracts/ceremony/IPlatformVerifier.sol";
import {IProofVerifier} from "libid-contracts/ceremony/IProofVerifier.sol";
import {HandleEscrow} from "libid-contracts/escrow/HandleEscrow.sol";
import {HandleVectors} from "libid-contracts/identity/HandleVectors.sol";
import {IdentityRegistry} from "libid-contracts/identity/IdentityRegistry.sol";
import {IIdentityRegistry} from "libid-contracts/identity/IIdentityRegistry.sol";

import {LibID} from "../LibID.sol";
import {LibIDTestnet} from "../LibIDTestnet.sol";
import {LibIDStandInVerifier} from "./LibIDStandInVerifier.sol";

/// @title LibIDTestBase
/// @notice A base for Foundry tests of a contract that uses LibID. It puts the
///         real IdentityRegistry and HandleEscrow at the addresses LibID has
///         built in, and binds handles without a ceremony.
///
/// @dev Where nothing is deployed at those addresses, the contracts from
///      libID-contracts are placed there behind proxies, with empty storage.
///      Where libID is already there, as on a fork or after an earlier call,
///      that deployment is used as it is. Either way, handles are bound
///      through `LibIDStandInVerifier`, registered beside any real verifiers
///      under `LIBID_STAND_IN_VERSION`; everything else is the real code.
///
///      Every function works inside a `vm.prank` or `vm.startPrank` of the
///      calling test and leaves it as it found it. None works during a
///      broadcast.
///
///      Nothing here is part of LibID: it is compiled only into tests that
///      import it.
abstract contract LibIDTestBase is Test {
    /// @notice The verifier version the stand-ins are registered under. The
    ///         highest, so on a fork they sit beside the live verifiers.
    uint16 internal constant LIBID_STAND_IN_VERSION = type(uint16).max;
    /// @dev A Google ID token's lifetime: its `exp` is an hour after issue.
    uint64 private constant LIBID_GOOGLE_TOKEN_LIFETIME = 1 hours;

    IdentityRegistry internal libidRegistry;
    HandleEscrow internal libidEscrow;
    CeremonyProofVerifier internal libidProofs;
    /// @notice The stand-in verifier of each platform `addLibIDPlatform` set up.
    mapping(bytes32 platformId => LibIDStandInVerifier) internal libidVerifiers;

    uint256 private libidNonce;

    /// @dev Runs the function outside the test's prank, then restores it.
    modifier libidKeepsCallers() {
        (VmSafe.CallerMode mode, address sender, address origin) = vm.readCallers();
        if (mode == VmSafe.CallerMode.Prank || mode == VmSafe.CallerMode.RecurrentPrank) {
            vm.stopPrank();
        } else {
            require(mode == VmSafe.CallerMode.None, "LibIDTestBase: cannot run during a broadcast");
        }
        _;
        if (mode == VmSafe.CallerMode.Prank) vm.prank(sender, origin);
        if (mode == VmSafe.CallerMode.RecurrentPrank) vm.startPrank(sender, origin);
    }

    /// @notice libID at `LibID`'s addresses, with GitHub, X and Google set up.
    function deployLibID() internal {
        deployLibIDAt(LibID.REGISTRY, LibID.ESCROW);
        _libidAddEveryPlatform();
    }

    /// @notice libID at `LibIDTestnet`'s addresses, with GitHub, X and Google
    ///         set up.
    function deployLibIDTestnet() internal {
        deployLibIDAt(LibIDTestnet.REGISTRY, LibIDTestnet.ESCROW);
        _libidAddEveryPlatform();
    }

    /// @notice libID at the given addresses. Where neither has code, deploys
    ///         it there with no platform set up. Where both hold a libID
    ///         deployment, uses that. Anything else reverts.
    function deployLibIDAt(address registry, address escrow) internal libidKeepsCallers {
        if (registry.code.length == 0 && escrow.code.length == 0) {
            _libidDeployAt(registry, escrow);
        } else {
            _libidUse(registry, escrow);
        }
    }

    /// @notice Set up a platform: its real handle rules, if the registry has
    ///         none for it yet, and a stand-in verifier. `platformId` is
    ///         `LibID.GITHUB`, `LibID.X` or `LibID.GOOGLE`.
    function addLibIDPlatform(bytes32 platformId) internal libidKeepsCallers {
        LibIDStandInVerifier verifier = new LibIDStandInVerifier(platformId);
        libidVerifiers[platformId] = verifier;
        try libidRegistry.rulesOf(platformId) {}
        catch {
            vm.prank(libidRegistry.owner());
            libidRegistry.setPlatform(platformId, HandleVectors.rulesFor(platformId));
        }
        vm.prank(libidProofs.owner());
        libidProofs.setVerifier(platformId, LIBID_STAND_IN_VERSION, IPlatformVerifier(address(verifier)));
    }

    /// @notice Bind a handle to `holder` and publish it, as a proof made now
    ///         with the notary's or Google's clock on the block's would:
    ///         `observedAt` is 5 minutes ago on GitHub and X, and an hour ago
    ///         on Google. Moves the clock a second first, so each such proof
    ///         is newer than the last, and on to just past that age if it
    ///         reads less, as it does at the start of a test.
    function bindHandle(address holder, bytes32 platformId, string memory id, string memory handle) internal {
        uint64 age = libidAgeNow(platformId);
        uint64 time = uint64(vm.getBlockTimestamp()) + 1;
        if (time <= age) time = age + 1;
        vm.warp(time);
        bindHandle(holder, platformId, id, handle, time - age, true);
    }

    /// @notice Bind a handle to `holder` as a proof with this `observedAt`
    ///         would, publishing it if `publish` is set.
    /// @dev The registry refuses a proof no newer than the last one of the
    ///      same handle or id.
    function bindHandle(
        address holder,
        bytes32 platformId,
        string memory id,
        string memory handle,
        uint64 observedAt,
        bool publish
    ) internal libidKeepsCallers {
        LibIDStandInVerifier verifier = libidVerifiers[platformId];
        require(address(verifier) != address(0), "LibIDTestBase: platform not added");
        bytes memory payload = abi.encode(
            LibIDStandInVerifier.Binding({
                holder: holder, id: id, handle: handle, observedAt: observedAt, nonce: ++libidNonce
            })
        );
        vm.prank(holder);
        libidRegistry.bind(platformId, LIBID_STAND_IN_VERSION, payload, publish);
    }

    /// @notice How old a platform's proof made now reads, with the notary's or
    ///         Google's clock on the block's: the verifier's allowance, less
    ///         the token's lifetime on Google.
    function libidAgeNow(bytes32 platformId) internal pure returns (uint64) {
        if (platformId == LibID.GITHUB) return CeremonyProfile.FUTURE_OBSERVATION_ALLOWANCE_SECONDS_GITHUB;
        if (platformId == LibID.X) return CeremonyProfile.FUTURE_OBSERVATION_ALLOWANCE_SECONDS_X;
        if (platformId == LibID.GOOGLE) {
            return CeremonyProfile.FUTURE_OBSERVATION_ALLOWANCE_SECONDS_GOOGLE - LIBID_GOOGLE_TOKEN_LIFETIME;
        }
        revert("LibIDTestBase: unknown platform");
    }

    function _libidAddEveryPlatform() private {
        addLibIDPlatform(LibID.GITHUB);
        addLibIDPlatform(LibID.X);
        addLibIDPlatform(LibID.GOOGLE);
    }

    function _libidDeployAt(address registry, address escrow) private {
        address owner = makeAddr("libid owner");
        _libidProxyAt(registry, address(new IdentityRegistry()));
        libidRegistry = IdentityRegistry(registry);
        libidRegistry.initialize(owner);
        _libidProxyAt(escrow, address(new HandleEscrow()));
        libidEscrow = HandleEscrow(escrow);
        libidEscrow.initialize(owner, IIdentityRegistry(registry));

        libidProofs = CeremonyProofVerifier(
            address(
                new ERC1967Proxy(
                    address(new CeremonyProofVerifier()), abi.encodeCall(CeremonyProofVerifier.initialize, (owner))
                )
            )
        );
        vm.prank(owner);
        libidRegistry.setProofVerifier(IProofVerifier(address(libidProofs)));
    }

    /// @dev Takes the deployment already at these addresses, if it is one.
    function _libidUse(address registry, address escrow) private {
        bool bound;
        if (registry.code.length != 0 && escrow.code.length != 0) {
            try HandleEscrow(escrow).registry() returns (IIdentityRegistry escrowRegistry) {
                bound = address(escrowRegistry) == registry;
            } catch {}
        }
        require(bound, "LibIDTestBase: code at the addresses is not a libID deployment");
        libidRegistry = IdentityRegistry(registry);
        libidEscrow = HandleEscrow(escrow);
        libidProofs = CeremonyProofVerifier(address(libidRegistry.proofVerifier()));
    }

    /// @dev An ERC-1967 proxy for `implementation` at `at`, with empty storage.
    function _libidProxyAt(address at, address implementation) private {
        ERC1967Proxy template = new ERC1967Proxy(implementation, "");
        vm.etch(at, address(template).code);
        vm.store(at, ERC1967Utils.IMPLEMENTATION_SLOT, bytes32(uint256(uint160(implementation))));
    }
}
