# LibID

A Solidity library for using libID from your contracts: find who holds a
handle, let only its holder call a function, or send funds to a handle.

```solidity
import {LibID} from "libid/LibID.sol";

contract Guestbook {
    address public immutable owner = msg.sender;
    mapping(string handle => string) public notes;

    error NotOwner();

    function sign(string calldata handle, string calldata message) external {
        LibID.requireHolder(LibID.GITHUB, handle, 90 days);
        notes[handle] = message;
    }

    // Changes no state, so the holder's code running inside `pay` cannot
    // corrupt any. A function that does needs a reentrancy guard.
    function tip(string calldata handle) external payable returns (bytes32 handleNode) {
        return LibID.pay(LibID.GITHUB, handle, msg.value);
    }

    // Only the depositor, this contract, can refund a mistyped or unclaimed tip.
    function refund(bytes32 handleNode, address recipient) external {
        if (msg.sender != owner) revert NotOwner();
        LibID.refund(handleNode, LibID.NATIVE, recipient);
    }
}
```

The libID contracts have the same address on every chain of one environment,
so LibID has them built in. They follow chain-configurations' deployments
and change when libID-contracts ships as a new deployment; rebuild against
the LibID that names the deployment you use. Every function is
`internal`: it compiles into your contract, and there is nothing to deploy or
link. `LibID.sol` imports nothing.

Your contract compiles in the selectors of five IdentityRegistry functions
and four HandleEscrow functions, `ILibIDRegistry` and `ILibIDEscrow` in
`LibID.sol`. Both contracts are upgradeable proxies, and these nine functions
never change: libID-contracts declares them as interfaces of the same names,
which IdentityRegistry and HandleEscrow inherit, so changing one fails its
build ([libID-contracts#148](https://github.com/libid-org/libID-contracts/pull/148)).
A deployment whose functions differ would ship as a new library.

## Testnets

`LibID` holds two pairs of addresses and picks one by `block.chainid`. The
same import and the same build work on every chain:

| Pair | Chains (chain id) | IdentityRegistry | HandleEscrow |
|---|---|---|---|
| Testnet | Sepolia (11155111), Arbitrum Sepolia (421614), Eden testnet (3735928814) | `0x58Ac0CD5eC19C850A75D6183b3C3B2DE692FB20D` | `0xE7eb0c675B757C12B1312dF652242b863624Bfab` |
| Production | Ethereum, Arbitrum One, Base, BNB Smart Chain, Eden | `0xF39343fEbdA25cAa8C3861954E33F8a0189D4FDA` | `0xf2731aB2c9451A9191e0Ef64D7fd5352068eB1b5` |

They are chain-configurations' addresses: libID-contracts v0.19's
IdentityRegistry and v0.21's HandleEscrow, deployed on every chain in the
table. Every chain without a testnet chain id gets the production pair,
including a testnet not listed here and a local chain such as anvil's 31337.
Where that pair has no code, `isAvailable()` and `isEscrowAvailable()` are
false and the calls revert `LibIDUnavailable`. `isAvailable` checks only
that the registry address has code. `LibID.registry()` and `LibID.escrow()`
return this chain's pair.

The testnet chain ids are compiled into your contract: a new testnet chain
needs a release of this library, and a rebuild against it, before your
contract picks the testnet pair there.

A local chain has no contract at these addresses. Use `LibIDTestBase` in your
tests, as below.

## Install

With [Foundry](https://getfoundry.sh):

```sh
forge install libid-org/libid
echo 'libid/=lib/libid/sol/src/' >> remappings.txt
```

It needs Solidity 0.8.20 or later.

## Testing your contract

`LibIDTestBase` is a base for Foundry tests. It puts the real IdentityRegistry
and HandleEscrow at the addresses LibID picks for the test's chain, and binds
handles without a ceremony:

```solidity
import {LibID} from "libid/LibID.sol";
import {LibIDTestBase} from "libid/test/LibIDTestBase.sol";

contract GuestbookTest is LibIDTestBase {
    function setUp() public {
        deployLibID(); // after vm.chainId(11155111) for the testnet pair
    }

    function test_theHolderSigns() public {
        address alice = makeAddr("alice");
        bindHandle(alice, LibID.GITHUB, "1001", "octocat");
        // ...
    }
}
```

- `bindHandle(holder, platformId, id, handle)` binds the handle as the
  holder's primary handle, its one name across platforms, as a proof made now
  would: it reads 5 minutes old on GitHub and X and an
  hour old on Google, as with the notary's or Google's clock on the block's.
  It moves the clock forward a second first, so binds in one block do not
  refuse each other as stale.
- `bindHandle(holder, platformId, id, handle, observedAt, primary)` takes the
  proof time, to test proof ages. It does not move the clock. Without
  `primary`, the bind is private: it discloses no handle.
- Both bind the nodes a circuit would output for `id` and `handle`.
  `libidIdNode(platformId, id)` gives the id node, for `resolveId`.
- Where libID is already deployed, as on a fork, `deployLibID` uses that
  deployment and adds the stand-in verifiers to it. Code there that is not
  libID makes it revert.
- With `via_ir` the optimizer treats the chain id as constant within a call:
  use one chain per test function, or read `LibID` only through an external
  call after `vm.chainId`.
- The functions work inside your `vm.prank` or `vm.startPrank`, and leave it
  in place.
- The platform verifiers are stand-ins, libID-contracts' test
  `StubPlatformVerifier`, that check no proof. Everything else is the real
  code.

Unlike `LibID.sol`, the base imports the libID contracts. They come from
the `lib/libID-contracts` submodule of this repository and its own
submodules; if `lib/libid/sol/lib/libID-contracts` is empty, run
`git submodule update --init --recursive` in `lib/libid`. The base needs
Solidity 0.8.24 or later and these lines in `remappings.txt`. They apply only
to files under `lib/libid/`, so your own OpenZeppelin is untouched:

```text
lib/libid/:libid-contracts/=lib/libid/sol/lib/libID-contracts/solidity/contracts/
lib/libid/:@openzeppelin/contracts/=lib/libid/sol/lib/libID-contracts/solidity/lib/openzeppelin-contracts/contracts/
lib/libid/:@openzeppelin/contracts-upgradeable/=lib/libid/sol/lib/libID-contracts/solidity/lib/openzeppelin-contracts-upgradeable/contracts/
```

The libID contracts compile only through IR. Add to `foundry.toml`:

```toml
additional_compiler_profiles = [{ name = "libid", via_ir = true }]
compilation_restrictions = [{ paths = "lib/libid/sol/lib/libID-contracts/**", via_ir = true }]
```

A test that imports the base then builds through IR, with every contract it
imports. Your contracts get two builds: the one you deploy, on your own
settings (`out/Guestbook.sol/Guestbook.json`), and the IR one your tests run
(`Guestbook.libid.json`). To test the build you deploy, set `via_ir = true`
for the whole project instead.

`integrator/` in this directory is such a project; `./script/integrator.sh`
builds and tests it.

## Functions

| Function | Returns |
| --- | --- |
| `resolve(platformId, handle)` | the holder of a handle, or zero |
| `resolve(platformId, handle, maxAge)` | the same, or zero if the latest proof is older than `maxAge` seconds |
| `bindingOf(platformId, handle)` | the holder and the `observedAt` of the latest proof, to apply your own rules |
| `resolveId(idNode)` | the holder of the identity with that id node, or zero |
| `primaryHandleOf(holder)` | the holder's primary handle and its platform, or zero and `""` |
| `isHolder(account, platformId, handle, maxAge)` | whether `account` holds the handle with a fresh enough proof |
| `requireHolder(platformId, handle, maxAge)` | reverts `NotHolder` or `ProofTooOld` unless `msg.sender` holds it |
| `pay(platformId, handle, amount)` | sends ETH from your contract to the handle; returns the escrow node |
| `payToken(platformId, handle, token, amount)` | the same for an ERC-20 your contract holds |
| `refund(handleNode, token, recipient)` | takes back what your contract escrowed at that node, from its refund date until it is claimed |
| `contribution(handleNode, token)` | what your contract has escrowed at that node, and its refund date |
| `isAvailable()` | whether this chain has the IdentityRegistry, for reads and gates |
| `isEscrowAvailable()` | whether it also has the HandleEscrow, bound to that registry, for payments |
| `registry()`, `escrow()` | this chain's IdentityRegistry and HandleEscrow addresses |

Platform ids are `LibID.GITHUB`, `LibID.X` and `LibID.GOOGLE`. A handle is
looked up as typed, with only A-Z folded to a-z. `OctoCat` finds `octocat`;
`@octocat` and ` octocat` are other handles, which nobody holds. A Google
handle is the email address exactly as Google reports it: dots and plus tags
are kept, so a dotted Gmail address and the same address without the dots
are different handles, even though Gmail delivers both to one inbox.

`resolveId` takes the id node, never the id. Compute it off chain:
`SHA256("libid.<platform>.user-id" || id)`, as `idNode('github', '583231')`
from `@libid/contracts/platforms` does. Nothing on chain computes it.

Where a contract is not deployed, the functions that need it revert
`LibIDUnavailable`. Any platform id but the three makes every read and gate
revert `UnknownPlatform`. A platform with no verifier yet reads as unheld.

`resolve` with a `maxAge` returns zero for a handle nobody holds and for a
proof that is too old. Use `bindingOf` to tell them apart.

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
the escrow holds the funds until someone proves the handle and claims them.

- The escrowed funds are your contract's, not your user's. The escrow keys a
  deposit by its sender, and the sender is your contract. Only your contract
  can call `LibID.refund`, and only from the refund date until the holder
  claims.
- Every payment your contract escrows for one handle, in one token, adds to
  one contribution, whichever user it pays for. Its refund date is 30 days
  (the escrow's `REFUND_GRACE`) after the last of them: each new payment moves
  it 30 days out for the whole amount, including other users' shares.
  `contribution` returns the amount and the date.
- If your contract pays for its users, record each user's share and the node
  `pay` returns, and offer a way to refund it. Without that, a payment to a
  wrong or never-claimed handle stays locked in your contract's name. Do not
  recompute the node from the handle later: an upgrade of the registry can
  make that text reach a different node.
- Nothing checks that the platform could issue the handle. Text it never
  issues, such as `@octocat` on GitHub, is escrowed at a node nobody can
  claim. Only your contract gets it back, from the refund date.
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

The tests use `LibIDTestBase`: they deploy the real libID contracts, pinned
in `lib/libID-contracts`, at the addresses LibID picks, and bind handles with the dates the real
verifiers give, at both ends of their acceptance windows. One test checks
both pairs of addresses against their environment's factory and the CREATE3
derivation of the canonical names, and others check which chain ids get
which pair. The fork tests run `LibID` against Ethereum mainnet, Sepolia and
Eden testnet, on local forks, and check that it picks that chain's pair.
They read, and pay a handle nobody holds and refund it after its refund
date. Where a chain has no code at the addresses, they check only
that the library reports it unavailable, and skip the rest. Where it has the registry but not the escrow, they skip the payments. Each is
skipped without its RPC URL (`ETH_RPC_URL`, `SEPOLIA_RPC_URL`,
`EDEN_RPC_URL`), unless `LIBID_REQUIRE_FORK=true`, which CI sets: then a
missing URL fails. CI reads Eden testnet's URL from the `EDEN_RPC_URL`
secret, as chain-configurations keeps it, and without the secret skips the
Eden fork tests and says so in the job summary.
