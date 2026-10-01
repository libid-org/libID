# LibID

A Solidity library for using libID from your contracts: find who holds a
handle, let only its holder call a function, or send funds to a handle.

```solidity
import {LibID} from "libid/LibID.sol";

contract Guestbook {
    function sign(string calldata handle, string calldata message) external {
        LibID.requireHolder(LibID.GITHUB, handle, 90 days);
        // ...
    }

    function tip(string calldata handle) external payable {
        LibID.pay(LibID.GITHUB, handle, msg.value, msg.sender);
    }
}
```

The libID contracts have the same address on every chain, so LibID has them
built in. Every function is `internal`: it compiles into your contract, and
there is nothing to deploy or link. `LibID.sol` imports nothing.

## Install

With [Foundry](https://getfoundry.sh):

```sh
forge install libid-org/libid
echo 'libid/=lib/libid/sol/src/' >> remappings.txt
```

It needs Solidity 0.8.20 or later.

## Functions

| Function | Returns |
| --- | --- |
| `resolve(platformId, handle)` | the holder of a handle, or zero |
| `resolve(platformId, handle, maxAge)` | the same, or zero if the latest proof is older than `maxAge` seconds |
| `resolveId(platformId, id)` | the holder of the identity with that id, or zero |
| `publishedHandleOf(holder, platformId)` | the handle the holder publishes, or `""` |
| `isHolder(account, platformId, handle, maxAge)` | whether `account` holds the handle with a fresh enough proof |
| `requireHolder(platformId, handle, maxAge)` | reverts `NotHolder` or `ProofTooOld` unless `msg.sender` holds it |
| `pay(platformId, handle, amount, refundTo)` | sends ETH from your contract to the handle through `HandleEscrow` |
| `payToken(platformId, handle, token, amount, refundTo)` | the same for an ERC-20 your contract holds |
| `refund(platformId, handle, token, recipient)` | takes back what your contract escrowed for a handle, before it is claimed |
| `isAvailable()` | whether this chain has the IdentityRegistry, for reads and gates |
| `isEscrowAvailable()` | whether it also has the HandleEscrow, for payments |

Platform ids are `LibID.GITHUB`, `LibID.X` and `LibID.GOOGLE`. Handles are
matched the way the platform matches them: case and a leading at-sign do not
matter.

A `maxAge` of `type(uint256).max` accepts any age. Where a contract is not
deployed, the functions that need it revert `LibIDUnavailable`.

## Payments

`pay` and `payToken` pay the holder at once if the handle has one. Otherwise
the escrow holds the funds until someone proves the handle and claims them,
and `refundTo` can take them back until then.

- Set `refundTo` to your user, so they can call `HandleEscrow.refund`
  themselves. If you set it to your contract, your contract must offer a way
  to call `LibID.refund`, or the funds stay there until claimed.
- Payments call out. The escrow may send ETH to the holder, which runs the
  holder's code, and a token runs its own code. Protect the calling function
  against reentrancy, and update your contract's state before you pay.
- The escrow books what arrives, so a token that takes a fee from the amount
  received works. A token that charges the sender on top of the amount, a
  rebasing token, and a token that can block the escrow do not.

## Development

```sh
git submodule update --init --recursive
cd sol
forge test
EDEN_RPC_URL=https://ev-reth-eden-testnet.binarybuilders.services:8545 forge test --match-contract LibIDForkTest
```

The tests deploy the real libID contracts, pinned in `lib/libID-contracts`, at
the addresses LibID has built in. One test checks those addresses against the
factory's CREATE3 derivation of their canonical names. The fork test checks
them against the live Eden deployment, and is skipped without `EDEN_RPC_URL`.
