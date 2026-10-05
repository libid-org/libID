// SPDX-License-Identifier: MIT OR Apache-2.0
pragma solidity ^0.8.24;

import {CeremonyProfile} from "libid-contracts/ceremony/CeremonyProfile.sol";
import {IPlatformVerifier} from "libid-contracts/ceremony/IPlatformVerifier.sol";

/// @title LibIDStandInVerifier
/// @notice A platform verifier for tests. It checks nothing: it vouches for
///         whatever binding its payload names. `LibIDTestBase` registers one
///         for each platform it sets up.
contract LibIDStandInVerifier is IPlatformVerifier {
    /// @notice The payload `verify` takes.
    struct Binding {
        address holder;
        string id;
        string handle;
        uint64 observedAt;
        /// Makes each payload's session id new.
        uint256 nonce;
    }

    bytes32 private immutable PLATFORM;

    constructor(bytes32 platformId_) {
        PLATFORM = platformId_;
    }

    function platformId() external view returns (bytes32) {
        return PLATFORM;
    }

    function quote() external pure returns (uint256) {
        return 0;
    }

    /// @notice The claim a real verifier would return for the binding, with
    ///         no fee and the registry's operation domain.
    function verify(bytes calldata payload) external payable returns (VerifiedClaim memory claim) {
        Binding memory binding = abi.decode(payload, (Binding));
        claim.sessionId = keccak256(abi.encode(address(this), binding.nonce));
        claim.operationDomain = keccak256("libid.claim-identity");
        claim.transactionData = abi.encode(binding.holder, uint256(0), address(0));
        claim.ceremonyVersion = CeremonyProfile.LAUNCH_VERSION;
        claim.clientIdentifier = "LibIDTestBase";
        claim.userId = binding.id;
        claim.handle = binding.handle;
        claim.metadataObservedAt = binding.observedAt;
    }
}
