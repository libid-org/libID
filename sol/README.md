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

The libID contracts have the same address on every chain of one environment,
so LibID has them built in. Within an environment these addresses never
change: contract updates are upgrades at the same address. Every function is
`internal`: it compiles into your contract, and there is nothing to deploy or
link. `LibID.sol` imports nothing.

## Testnets

`LibID` has the production addresses. `LibIDTestnet` has the same functions
with the testnet addresses. To build for a testnet, change the import and
nothing else:

```solidity
import {LibIDTestnet as LibID} from "libid/LibIDTestnet.sol";
```

| Library | Chains | IdentityRegistry | HandleEscrow |
|---|---|---|---|
| `LibID` | Ethereum mainnet | `0xbefD300aFf7D4A67fb381Afe8B3596793D3E9a83` | `0x17a244e23ef1f12071298A1862194FeA3D00bbf7` |
| `LibIDTestnet` | Sepolia, Eden testnet | `0x25F29C8C765db2f27d1e2b23987A7b0655C7D640` | `0x57355e1D1Bcf61FeC9b2E5CaD60DccCDdDC4d8e5` |

A local chain has no contract at these addresses. Use `LibIDTestBase` in
your tests, as below.

## Install

With [Foundry](https://getfoundry.sh):

```sh
forge install libid-org/libid
echo 'libid/=lib/libid/sol/src/' >> remappings.txt
```

It needs Solidity 0.8.20 or later.

## Testing your contract

`LibIDTestBase` is a base for Foundry tests. It puts the real IdentityRegistry
and HandleEscrow at the addresses LibID has built in, and binds handles
without a ceremony:

```solidity
import {LibID} from "libid/LibID.sol";
import {LibIDTestBase} from "libid/test/LibIDTestBase.sol";

contract GuestbookTest is LibIDTestBase {
    function test_theHolderSigns() public {
        deployLibID(); // or deployLibIDTestnet() for LibIDTestnet
        address alice = makeAddr("alice");
        bindHandle(alice, LibID.GITHUB, "1001", "octocat");
        // ...
    }
}
```

`bindHandle` also takes the proof's `observedAt`, to test proof ages. The
platform verifiers are stand-ins that check nothing; everything else is the
real code.

Unlike `LibID.sol`, the base imports the libID contracts. They come from
the `lib/libID-contracts` submodule of this repository and its own
submodules; if `lib/libid/sol/lib/libID-contracts` is empty, run
`git submodule update --init --recursive` in `lib/libid`. The base needs
Solidity 0.8.24 or later and these lines in `remappings.txt`:

```text
libid-contracts/=lib/libid/sol/lib/libID-contracts/solidity/contracts/
@openzeppelin/contracts/=lib/libid/sol/lib/libID-contracts/solidity/lib/openzeppelin-contracts/contracts/
@openzeppelin/contracts-upgradeable/=lib/libid/sol/lib/libID-contracts/solidity/lib/openzeppelin-contracts-upgradeable/contracts/
```

The libID contracts compile only through IR. To keep your own contracts on
the legacy pipeline, add to `foundry.toml`:

```toml
optimizer = true
additional_compiler_profiles = [{ name = "libid", via_ir = true }]
compilation_restrictions = [{ paths = "lib/libid/sol/lib/libID-contracts/**", via_ir = true }]
```

Your contracts never import the base, so none of this reaches them.

## Functions

| Function | Returns |
| --- | --- |
| `resolve(platformId, handle)` | the holder of a handle, or zero |
| `resolve(platformId, handle, maxAge)` | the same, or zero if the latest proof is older than `maxAge` seconds |
| `bindingOf(platformId, handle)` | the holder and the `observedAt` of the latest proof, to apply your own rules |
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
matters in a handle. On GitHub and X a leading at-sign is dropped. A Google
handle is the email address exactly as Google reports it: it must not start
with an at-sign, and dots and plus tags are kept, so a dotted Gmail address
and the same address without the dots are different handles, even though
Gmail delivers both to one inbox.

Where a contract is not deployed, the functions that need it revert
`LibIDUnavailable`. A platform the chain has not set up makes the reads and
gates revert `UnknownPlatform`; `publishedHandleOf` returns `""` instead.

`resolve` with a `maxAge` returns zero for a handle nobody holds, for a proof
that is too old, and for text that is no handle. Use `bindingOf` to tell
them apart.

## Proof age

`maxAge` is counted from the proof's `observedAt`, which the platform
verifiers set a fixed allowance before the evidence: 5 minutes before the
notary signed the session on GitHub and X, and 2 hours before the expiry of
Google's sign-in token. The verifiers accept evidence that is already a while
old, and evidence dated up to the allowance ahead of the block, so a proof
that was bound a moment ago can read as:

| Platform | Age of a just-bound proof | With clocks in step |
| --- | --- | --- |
| GitHub, X | 0 to 65 minutes (the session can be up to an hour old, or signed up to 5 minutes ahead of the block) | 5 minutes |
| Google | 0 to 2 hours (the token is accepted until it expires, if that is at most 2 hours ahead of the block) | 1 hour |

The last column is a fresh session, or a token Google just issued, with the
notary's or Google's clock on the block's. A `maxAge` below the top of the
range rejects some honest holders. A
`maxAge` of `type(uint256).max` accepts any age.

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
ETH_RPC_URL=https://ethereum-rpc.publicnode.com \
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com \
  forge test --match-contract 'ForkTest$'
```

`src/LibIDTestnet.sol` is generated: edit `src/LibID.sol`, then run
`./script/testnet.sh`. CI fails when the two differ in anything but the names
and addresses.

The tests use `LibIDTestBase`: they deploy the real libID contracts, pinned
in `lib/libID-contracts`, at the addresses LibID has built in, and bind handles with the dates the real
verifiers give, at both ends of their acceptance windows. One test checks
both libraries' addresses against their environment's factory and the CREATE3
derivation of the canonical names. The fork tests check `LibID` against
Ethereum mainnet and `LibIDTestnet` against Sepolia, and are skipped without
`ETH_RPC_URL` and `SEPOLIA_RPC_URL`.
