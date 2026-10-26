// SPDX-License-Identifier: MIT OR Apache-2.0
pragma solidity ^0.8.20;

/// @title LibID
/// @notice Use libID from a contract: find who holds a handle, gate a call on
///         it, or pay a handle through the escrow.
///
/// @dev The contracts sit at the same address on every chain of one
///      environment, so the addresses are constants. They name one
///      libID-contracts deployment (v0.19), from chain-configurations. `LibID` has the
///      production addresses, those of Ethereum mainnet. `LibIDTestnet` has
///      the testnet addresses, those of Sepolia and Eden, and is generated
///      from `LibID` with nothing else changed: import it as `LibID` to build
///      for a testnet. Every function is `internal`: it is
///      compiled into the calling contract, and there is nothing to deploy or
///      link. Where a contract has no code, the functions that need it
///      revert `LibIDUnavailable`: check `isAvailable` before reading or
///      gating, and `isEscrowAvailable` before paying. `LibID`'s addresses
///      have no code on Ethereum mainnet yet, so `LibID` reads as unavailable
///      there. A platform other than GitHub, X and Google makes every read
///      and gate revert `UnknownPlatform`.
///
///      A handle is looked up as typed, with only A-Z folded to a-z. A
///      leading at-sign or a space makes another handle, which nobody holds.
///      A Google handle is the email address exactly as Google reports it:
///      dots and plus tags are kept, so a dotted Gmail address and the same
///      address without the dots are different handles, even though Gmail
///      delivers both to one inbox.
///
///      `pay`, `payToken` and `refund` call out. The escrow sends ETH straight
///      to a handle's holder, whose code runs and can revert or burn gas, and a
///      token runs its own code. Guard the calling function against reentrancy
///      and update your own state before paying.
library LibID {
    /// @notice The IdentityRegistry: which address holds which identity.
    address internal constant REGISTRY = 0xF39343fEbdA25cAa8C3861954E33F8a0189D4FDA;
    /// @notice The HandleEscrow: value sent to a handle before anyone holds it.
    address internal constant ESCROW = 0xD38474F12d887a1d97ac7A62cF0B3C17E4d2c100;

    /// @notice Platform ids: `keccak256` of the platform key.
    bytes32 internal constant GITHUB = keccak256("github");
    bytes32 internal constant X = keccak256("x");
    bytes32 internal constant GOOGLE = keccak256("google");

    /// @notice The address the escrow uses for the chain's own coin (EIP-7528).
    address internal constant NATIVE = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    /// This chain has no libID contract where one is needed.
    error LibIDUnavailable();
    /// The caller does not hold the handle. `holder` is who does, or zero.
    error NotHolder(address holder, address caller);
    /// The handle's latest proof is older than the caller allows.
    error ProofTooOld(uint64 observedAt);
    /// The token refused to approve the escrow.
    error ApproveFailed(address token);

    /// @notice Whether this chain has the IdentityRegistry, so reads and gates
    ///         work.
    /// @dev Checks only that `REGISTRY` has code.
    function isAvailable() internal view returns (bool) {
        return REGISTRY.code.length != 0;
    }

    /// @notice Whether this chain also has the HandleEscrow, resolving through
    ///         that same registry, so `pay`, `payToken` and `refund` work.
    function isEscrowAvailable() internal view returns (bool) {
        if (REGISTRY.code.length == 0 || ESCROW.code.length == 0) return false;
        (bool ok, bytes memory ret) = ESCROW.staticcall(abi.encodeWithSelector(ILibIDEscrow.registry.selector));
        // Compared as a word, so an answer that is not a clean address is a
        // plain no rather than a decoding revert.
        return ok && ret.length == 32 && abi.decode(ret, (uint256)) == uint256(uint160(REGISTRY));
    }

    // ─── Reading ────────────────────────────────────────────────────

    /// @notice The address that holds a handle, or zero if nobody does.
    /// @dev Text the platform never issues also returns zero.
    function resolve(bytes32 platformId, string memory handle) internal view returns (address) {
        return _registry().resolveHandle(platformId, handle);
    }

    /// @notice The address that holds a handle, or zero if nobody does or its
    ///         latest proof is older than `maxAge` seconds. See `isHolder` for
    ///         how age is counted.
    /// @dev Zero does not say which: unheld or too old. Use `bindingOf` to
    ///      tell them apart.
    function resolve(bytes32 platformId, string memory handle, uint256 maxAge) internal view returns (address) {
        (address holder, uint64 observedAt) = _binding(platformId, handle);
        return _isFresh(observedAt, maxAge) ? holder : address(0);
    }

    /// @notice The holder of a handle and the `observedAt` of its latest proof,
    ///         to apply your own rules.
    /// @dev `holder` is zero when nobody holds the handle; `observedAt` is
    ///      then zero too, or the time of the proof that last held it.
    function bindingOf(bytes32 platformId, string memory handle)
        internal
        view
        returns (address holder, uint64 observedAt)
    {
        return _binding(platformId, handle);
    }

    /// @notice The address that holds the identity with this id node, or zero.
    ///         An id never changes, unlike a handle.
    /// @dev The id node is `SHA256("libid.<platform>.user-id" || id)`,
    ///      computed off chain, as `idNode` in libID-contracts' TypeScript
    ///      package does. The id itself is never on chain.
    function resolveId(bytes32 idNode) internal view returns (address) {
        return _registry().resolveId(idNode);
    }

    /// @notice The handle `holder` chose as its name, and its platform: one per
    ///         holder, across platforms. Zero and empty if there is none.
    /// @dev Zero and empty also when that handle now belongs to someone else.
    function primaryHandleOf(address holder) internal view returns (bytes32 platformId, string memory handle) {
        return _registry().primaryHandleOf(holder);
    }

    // ─── Gating ─────────────────────────────────────────────────────

    /// @notice Whether `account` holds the handle with a proof no older than
    ///         `maxAge` seconds.
    /// @dev Age is counted from the proof's `observedAt`, which the platform
    ///      verifiers set a fixed allowance before the evidence: 5 minutes before
    ///      the notary signed the session on GitHub and X, and 2 hours before a
    ///      Google token's expiry. The verifiers accept a session up to an hour
    ///      old and a token until it expires, so a proof that was just bound can
    ///      already be up to 65 minutes old on GitHub and X, and up to 2 hours
    ///      on Google. A smaller `maxAge` rejects honest holders. Any `maxAge` of
    ///      at least the block time, such as `type(uint256).max`, accepts any
    ///      age.
    function isHolder(address account, bytes32 platformId, string memory handle, uint256 maxAge)
        internal
        view
        returns (bool)
    {
        (address holder, uint64 observedAt) = _binding(platformId, handle);
        return holder != address(0) && holder == account && _isFresh(observedAt, maxAge);
    }

    /// @notice Revert unless `msg.sender` holds the handle with a proof no
    ///         older than `maxAge` seconds, counted as `isHolder` counts.
    function requireHolder(bytes32 platformId, string memory handle, uint256 maxAge) internal view {
        (address holder, uint64 observedAt) = _binding(platformId, handle);
        if (holder == address(0) || holder != msg.sender) revert NotHolder(holder, msg.sender);
        if (!_isFresh(observedAt, maxAge)) revert ProofTooOld(observedAt);
    }

    // ─── Paying ─────────────────────────────────────────────────────

    /// @notice Send `amount` of this contract's ETH to a handle.
    /// @dev If someone holds the handle, the escrow sends them the ETH in the
    ///      same call: their code runs, and if it reverts so does this call.
    ///      Otherwise the escrow holds the funds until the handle is proved and
    ///      claimed, and `refundTo` can take them back until then.
    ///
    ///      Nothing checks that the platform could issue the text. Text it
    ///      never issues, such as a GitHub handle with a leading at-sign,
    ///      escrows at a node nobody can claim, and only `refundTo` can take
    ///      it back.
    ///
    ///      Reverts `LibIDUnavailable` unless `isEscrowAvailable`. The escrow
    ///      reverts `ZeroAmount` when nothing would arrive, `BadRefundTo` when
    ///      `refundTo` is zero or the escrow, `PayingYourself` when this
    ///      contract holds the handle, and `PlatformAcceptsNoBindings` when
    ///      nobody holds it and the platform takes no new proofs.
    /// @return handleNode The registry's node for the handle, where the escrow
    ///         keeps the funds. Keep it to `refund`: an upgrade of the
    ///         registry can stop the handle text from reaching this node.
    function pay(bytes32 platformId, string memory handle, uint256 amount, address refundTo)
        internal
        returns (bytes32 handleNode)
    {
        handleNode = _escrowNode(platformId, handle);
        ILibIDEscrow(ESCROW).deposit{value: amount}(platformId, handleNode, NATIVE, amount, refundTo);
    }

    /// @notice Send `amount` of an ERC-20 token held by this contract to a
    ///         handle, as `pay` does for ETH.
    /// @dev The escrow books what arrives, so a token that takes a fee from
    ///      the amount received works. These do not: a token that charges the
    ///      sender on top of the amount (its claims and refunds revert), a
    ///      rebasing token, and a token that can block the escrow. Reverts as
    ///      `pay` does, and `ApproveFailed` when the token refuses the approval.
    function payToken(bytes32 platformId, string memory handle, address token, uint256 amount, address refundTo)
        internal
        returns (bytes32 handleNode)
    {
        handleNode = _escrowNode(platformId, handle);
        _forceApprove(token, amount);
        ILibIDEscrow(ESCROW).deposit(platformId, handleNode, token, amount, refundTo);
    }

    /// @notice Take back this contract's escrowed deposits at `handleNode`, in
    ///         one token, and send them to `recipient`.
    /// @dev `handleNode` is what `pay` or `payToken` returned. Works only for
    ///      deposits that named this contract as `refundTo`, and only until
    ///      the handle's holder claims them; otherwise the escrow reverts
    ///      `NothingToRefund`.
    function refund(bytes32 handleNode, address token, address recipient) internal {
        _escrow().refund(handleNode, token, recipient);
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

    /// @dev The registry's node for a handle. The registry must be the
    ///      escrow's, which books and pays out by that registry's nodes.
    function _escrowNode(bytes32 platformId, string memory handle) private view returns (bytes32) {
        if (!isEscrowAvailable()) revert LibIDUnavailable();
        return ILibIDRegistry(REGISTRY).handleNodeOf(platformId, handle);
    }

    /// @dev The holder and proof time of a handle.
    function _binding(bytes32 platformId, string memory handle)
        private
        view
        returns (address holder, uint64 observedAt)
    {
        ILibIDRegistry registry = _registry();
        return registry.handleBinding(registry.handleNodeOf(platformId, handle));
    }

    /// @dev Adds rather than subtracts, so no `maxAge` can underflow or
    ///      overflow.
    function _isFresh(uint64 observedAt, uint256 maxAge) private view returns (bool) {
        return maxAge >= block.timestamp || uint256(observedAt) + maxAge >= block.timestamp;
    }

    /// @dev Approve `amount` for the escrow. If the token refuses, as tokens
    ///      that forbid changing a non-zero allowance do, set it to zero first
    ///      and try again.
    function _forceApprove(address token, uint256 amount) private {
        if (_approve(token, amount)) return;
        if (!_approve(token, 0) || !_approve(token, amount)) revert ApproveFailed(token);
    }

    /// @dev True if `approve` succeeded: no return data from a contract, or a
    ///      first word of 1, as the escrow's SafeERC20 accepts. Only the first
    ///      word is copied, so a huge answer cannot burn the caller's gas.
    function _approve(address token, uint256 amount) private returns (bool ok) {
        bytes memory data = abi.encodeWithSelector(0x095ea7b3, ESCROW, amount);
        uint256 size;
        uint256 word;
        assembly ("memory-safe") {
            ok := call(gas(), token, 0, add(data, 32), mload(data), 0, 32)
            size := returndatasize()
            word := mload(0)
        }
        if (!ok) return false;
        return size == 0 ? token.code.length != 0 : size >= 32 && word == 1;
    }
}

/// @dev The IdentityRegistry calls LibID makes.
interface ILibIDRegistry {
    function resolveHandle(bytes32 platformId, string calldata handle) external view returns (address);
    function resolveId(bytes32 idNode) external view returns (address);
    function primaryHandleOf(address holder) external view returns (bytes32 platformId, string memory handle);
    function handleNodeOf(bytes32 platformId, string calldata handle) external view returns (bytes32);
    function handleBinding(bytes32 handleNode) external view returns (address holder, uint64 observedAt);
}

/// @dev The HandleEscrow calls LibID makes.
interface ILibIDEscrow {
    function registry() external view returns (address);
    function deposit(bytes32 platformId, bytes32 handleNode, address token, uint256 amount, address refundTo)
        external
        payable;
    function refund(bytes32 handleNode, address token, address recipient) external;
}
