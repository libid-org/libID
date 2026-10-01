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
| `isAvailable()` | whether this chain runs libID |

Platform ids are `LibID.GITHUB`, `LibID.X` and `LibID.GOOGLE`. Handles are
matched the way the platform matches them: case and a leading at-sign do not
matter.

A `maxAge` of `type(uint256).max` accepts any age. On a chain without libID,
every function except `isAvailable` reverts `LibIDUnavailable`.

`pay` and `payToken` pay the holder at once if the handle has one. Otherwise
the escrow holds the funds until someone proves the handle and claims them,
and `refundTo` can take them back until then. Set `refundTo` to your user, not
your contract, unless your contract can call `refund` itself.

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
