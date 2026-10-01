// SPDX-License-Identifier: MIT OR Apache-2.0
pragma solidity ^0.8.20;

/// @title LibID
/// @notice Use libID from a contract: find who holds a handle, gate a call on
///         it, or pay a handle through the escrow.
///
/// @dev The contracts sit at the same address on every chain that runs libID,
///      so the addresses are constants. Every function is `internal`: it is
///      compiled into the calling contract, and there is nothing to deploy or
///      link. Where a contract is not deployed, the functions that need it
///      revert `LibIDUnavailable`: check `isAvailable` before reading or
///      gating, and `isEscrowAvailable` before paying.
///
///      `pay`, `payToken` and `refund` call out: the escrow can send ETH to
///      the handle's holder, and a token runs its own code. Guard the calling
///      function against reentrancy, and update your own state before calling.
///
///      Handles are matched the way the platform matches them: case and a
///      leading at-sign do not matter.
library LibID {
    /// @notice The IdentityRegistry: which address holds which identity.
    address internal constant REGISTRY = 0x0531b83b010A6b0C24c2c2c1A6BeeCC90cC71366;
    /// @notice The HandleEscrow: value sent to a handle before anyone holds it.
    address internal constant ESCROW = 0xf7e3Ad279F913fFE2ef74614E3046c15cBDAbb9A;

    /// @notice Platform ids: `keccak256` of the platform key.
    bytes32 internal constant GITHUB = keccak256("github");
    bytes32 internal constant X = keccak256("x");
    bytes32 internal constant GOOGLE = keccak256("google");

    /// @notice The address the escrow uses for the chain's own coin (EIP-7528).
    address internal constant NATIVE = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    /// This chain has no libID contracts.
    error LibIDUnavailable();
    /// The caller does not hold the handle. `holder` is who does, or zero.
    error NotHolder(address holder, address caller);
    /// The handle's latest proof is older than the caller allows.
    error ProofTooOld(uint64 observedAt);
    /// The token refused to approve the escrow.
    error ApproveFailed(address token);

    /// @notice Whether this chain has the IdentityRegistry: everything except
    ///         payments works.
    function isAvailable() internal view returns (bool) {
        return REGISTRY.code.length != 0;
    }

    /// @notice Whether this chain also has the HandleEscrow, so `pay`,
    ///         `payToken` and `refund` work.
    function isEscrowAvailable() internal view returns (bool) {
        return REGISTRY.code.length != 0 && ESCROW.code.length != 0;
    }

    /// @notice The address that holds a handle, or zero if nobody does.
    /// @dev Text that can never be a handle also returns zero. Reverts
    ///      `UnknownPlatform` if the platform is not set up.
    function resolve(bytes32 platformId, string memory handle) internal view returns (address) {
        return _registry().resolveHandle(platformId, handle);
    }

    /// @notice The address that holds a handle, or zero if nobody does or its
    ///         latest proof is older than `maxAge` seconds.
    function resolve(bytes32 platformId, string memory handle, uint256 maxAge) internal view returns (address) {
        (address holder, uint64 observedAt) = _binding(platformId, handle);
        return _isFresh(observedAt, maxAge) ? holder : address(0);
    }

    /// @notice The address that holds the identity with this platform id, or
    ///         zero. An id never changes, unlike a handle.
    function resolveId(bytes32 platformId, string memory id) internal view returns (address) {
        return _registry().resolveId(platformId, id);
    }

    /// @notice The handle `holder` publishes on a platform, or an empty string.
    /// @dev Empty also when the published handle now belongs to someone else.
    function publishedHandleOf(address holder, bytes32 platformId) internal view returns (string memory) {
        return _registry().publishedHandleOf(holder, platformId);
    }

    /// @notice Whether `account` holds the handle with a proof no older than
    ///         `maxAge` seconds.
    function isHolder(address account, bytes32 platformId, string memory handle, uint256 maxAge)
        internal
        view
        returns (bool)
    {
        (address holder, uint64 observedAt) = _binding(platformId, handle);
        return account != address(0) && holder == account && _isFresh(observedAt, maxAge);
    }

    /// @notice Revert unless `msg.sender` holds the handle with a proof no
    ///         older than `maxAge` seconds.
    function requireHolder(bytes32 platformId, string memory handle, uint256 maxAge) internal view {
        (address holder, uint64 observedAt) = _binding(platformId, handle);
        if (holder != msg.sender) revert NotHolder(holder, msg.sender);
        if (!_isFresh(observedAt, maxAge)) revert ProofTooOld(observedAt);
    }

    /// @notice Send `amount` of this contract's ETH to a handle.
    /// @dev If someone holds the handle, they are paid now. Otherwise the
    ///      escrow holds the funds until the handle is proved and claimed;
    ///      until then `refundTo` can take them back. Reverts `UnusableHandle`
    ///      for text that can never be a handle.
    function pay(bytes32 platformId, string memory handle, uint256 amount, address refundTo) internal {
        bytes32 hash = _registry().handleHashOf(platformId, handle);
        _escrow().deposit{value: amount}(platformId, hash, NATIVE, amount, refundTo);
    }

    /// @notice Send `amount` of an ERC-20 token held by this contract to a
    ///         handle, as `pay` does for ETH.
    /// @dev The escrow books what arrives, so a token that takes a fee from
    ///      the amount received works. These do not: a token that charges
    ///      the sender on top of the amount (its claims and refunds revert),
    ///      a rebasing token, and a token that can block the escrow.
    function payToken(bytes32 platformId, string memory handle, address token, uint256 amount, address refundTo)
        internal
    {
        bytes32 hash = _registry().handleHashOf(platformId, handle);
        ILibIDEscrow escrow = _escrow();
        // Zero first: some tokens refuse to change a non-zero allowance. The
        // escrow takes exactly `amount`, which leaves the allowance at zero.
        _approve(token, 0);
        _approve(token, amount);
        escrow.deposit(platformId, hash, token, amount, refundTo);
    }

    /// @notice Take back this contract's escrowed deposits for a handle, in
    ///         one token, and send them to `recipient`.
    /// @dev Works only for deposits that named this contract as `refundTo`,
    ///      and only until the handle's holder claims them. Reverts
    ///      `NothingToRefund` when there is nothing to take back.
    function refund(bytes32 platformId, string memory handle, address token, address recipient) internal {
        bytes32 node = _registry().handleNodeOf(platformId, handle);
        _escrow().refund(node, token, recipient);
    }

    // ─── Internals ──────────────────────────────────────────────────

    function _registry() private view returns (ILibIDRegistry) {
        if (REGISTRY.code.length == 0) revert LibIDUnavailable();
        return ILibIDRegistry(REGISTRY);
    }

    function _escrow() private view returns (ILibIDEscrow) {
        if (ESCROW.code.length == 0) revert LibIDUnavailable();
        return ILibIDEscrow(ESCROW);
    }

    /// @dev The holder and proof time of a handle. Resolves first, so text
    ///      that can never be a handle reads as unheld instead of reverting.
    function _binding(bytes32 platformId, string memory handle)
        private
        view
        returns (address holder, uint64 observedAt)
    {
        ILibIDRegistry registry = _registry();
        if (registry.resolveHandle(platformId, handle) == address(0)) return (address(0), 0);
        return registry.handleBinding(registry.handleNodeOf(platformId, handle));
    }

    /// @dev `observedAt` can be ahead of the block (a Google token's expiry),
    ///      so this adds instead of subtracting. A `maxAge` of at least the
    ///      block time accepts any age, including `type(uint256).max`.
    function _isFresh(uint64 observedAt, uint256 maxAge) private view returns (bool) {
        return maxAge >= block.timestamp || uint256(observedAt) + maxAge >= block.timestamp;
    }

    /// @dev Some tokens return nothing from `approve`; accept that too.
    function _approve(address token, uint256 amount) private {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(0x095ea7b3, ESCROW, amount));
        if (!ok || token.code.length == 0 || (ret.length != 0 && !abi.decode(ret, (bool)))) {
            revert ApproveFailed(token);
        }
    }
}

/// @dev The IdentityRegistry calls LibID makes.
interface ILibIDRegistry {
    function resolveHandle(bytes32 platformId, string calldata handle) external view returns (address);
    function resolveId(bytes32 platformId, string calldata id) external view returns (address);
    function publishedHandleOf(address holder, bytes32 platformId) external view returns (string memory);
    function handleNodeOf(bytes32 platformId, string calldata handle) external view returns (bytes32);
    function handleBinding(bytes32 handleNode) external view returns (address holder, uint64 observedAt);
    function handleHashOf(bytes32 platformId, string calldata handle) external view returns (bytes32);
}

/// @dev The HandleEscrow calls LibID makes.
interface ILibIDEscrow {
    function deposit(bytes32 platformId, bytes32 handleHash, address token, uint256 amount, address refundTo)
        external
        payable;
    function refund(bytes32 handleNode, address token, address recipient) external;
}
