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

    // Keeps no state, so the holder's code running inside `pay` cannot
    // corrupt any. A function that does keep state needs a reentrancy guard.
    function tip(string calldata handle) external payable {
        LibID.pay(LibID.GITHUB, handle, msg.value, msg.sender);
    }
}
```

The libID contracts have the same address on every chain, so LibID has them
built in. These addresses never change: contract updates are upgrades at the
same address. Every function is `internal`: it compiles into your contract, and
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
| `pay(platformId, handle, amount, refundTo)` | sends ETH from your contract to the handle; returns the escrow node |
| `payToken(platformId, handle, token, amount, refundTo)` | the same for an ERC-20 your contract holds |
| `refund(handleNode, token, recipient)` | takes back what your contract escrowed at that node, before it is claimed |
| `isAvailable()` | whether this chain has the IdentityRegistry, for reads and gates |
| `isEscrowAvailable()` | whether it also has the HandleEscrow, bound to that registry, for payments |

Platform ids are `LibID.GITHUB`, `LibID.X` and `LibID.GOOGLE`. Case never
matters in a handle. On GitHub and X a leading at-sign is dropped; a Google
handle is an email address and must not start with one.

Where a contract is not deployed, the functions that need it revert
`LibIDUnavailable`. A platform the chain has not set up makes the reads,
`isHolder` included, revert `UnknownPlatform`.

## Proof age

`maxAge` is counted from the proof's `observedAt`. The platform verifiers set
it a fixed allowance before the evidence time, so a proof made just now is
already that old:

| Platform | A fresh proof's age |
| --- | --- |
| GitHub, X | 5 minutes |
| Google | about 1 hour (2 hours before the sign-in token's expiry) |

So `maxAge` must be larger than that, or every holder fails. A `maxAge` of
`type(uint256).max` accepts any age.

## Payments

`pay` and `payToken` pay the holder at once if the handle has one. Otherwise
the escrow holds the funds until someone proves the handle and claims them,
and `refundTo` can take them back until then.

- Set `refundTo` to your user, so they can call `HandleEscrow.refund`
  themselves. If you set it to your contract, keep the node `pay` returns and
  offer a way to call `LibID.refund` with it. Do not recompute the node from
  the handle later: a change to the platform's rules can make that text reach
  a different node, or none.
- Payments call out. When the handle has a holder, the escrow sends ETH
  straight to it with all remaining gas: the holder's code runs, and can
  revert the payment or burn the gas. A token runs its own code too. Guard the
  calling function against reentrancy, update your state before you pay, and
  do not pay many handles in one call where one bad holder can block the rest.
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
the addresses LibID has built in, and bind handles with the timing the real
verifiers produce. One test checks the addresses against the factory's CREATE3
derivation of their canonical names. The fork test checks them against the
live Eden deployment, and is skipped without `EDEN_RPC_URL`.
