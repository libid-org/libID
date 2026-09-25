# ENS integration

**Status: design proposal.** Nothing here is built. It is not a protocol spec in
the sense of `specs/` and defines no `ASM-*`/`SP-*`/`REQ-*` identifiers; the parts
that carry trust assumptions graduate into a service spec under `specs/` if the
integration is approved.

## The thing that must work

Alice puts a name in her X bio. Bob — who has never heard of libID — pastes it
into MetaMask and sends her funds.

Everything below follows from that sentence. A name that resolves only inside our
own product needs no ENS at all: we would call `resolveHandle` and be done. ENS
earns its keep exactly when the name works in wallets we do not control.

## Why this is cheap

ENS documents three ways to issue subnames: on-chain, on an L2, and offchain via
CCIP-Read. None describes us, and the difference is in our favour: **we are not
issuing names, we are projecting state that already exists.**
`IdentityNames.resolveHandle(platformId, handle)` already answers the question an
ENS resolver asks, so a name needs no registry entry, no NFT, no mint, and no
storage of its own.

Coinbase runs this shape in production for over eleven million `*.cb.id` names:

```
registry.resolver(cb.id)       = 0x1934FC75…   supportsInterface(0x9061b923) = true
registry.resolver(jesse.cb.id) = 0x0000…       no per-name entry at all
```

One wildcard resolver at the apex. Nothing per user.

## Namespace

**`handles.link`, imported on-chain** via `DNSRegistrar`. The import is one
gas-heavy transaction, never repeated; it produces an ordinary ENS registry entry
that a wildcard resolver then serves. The `.link` TLD is already wired into ENS
(`registry.resolver(link)` is set), so nothing exotic is required.

**ENSv2 changes none of this.** Its root registry gives every DNS TLD one
`DNSTLDResolver`, whose first step is to look the name up in the v1 registry and
hand the query to whatever resolver it finds there, full name included. A DNS
name imported as above therefore keeps resolving through the same entry and the
same resolver after v2 ships; only `.eth` names have a migration.

A `.eth` second-level name was the alternative, and it is rejected. It costs an
annual renewal whose expiry would kill every name beneath it at once — a recurring
dependency taken on for nothing, since the DNS domain already exists and is
already managed.

DNS-rooted names resolve in the wallets that matter. ENS resolution is
namehash-based and TLD-agnostic, so `.eth` is one TLD among the others; MetaMask
resolves `jesse.cb.id` and labels it ENS. That name is served offchain — with
CCIP-Read disabled it does not resolve at all — so it evidences the whole path,
not merely the choice of TLD.

**Gasless DNSSEC (ENSIP-17) is not the route**, for a reason belonging to the
standard rather than to any wallet: the resolver a TXT record names must
implement `addr` and must not initiate a CCIP-Read request, which is exactly what
a gateway needs. Subnames require the on-chain import.

**MetaMask Snaps** (`endowment:name-lookup`) can teach a wallet a namespace it
does not know, but the snap must be installed by the **sender** — the participant
we control least. They solve nothing here.

## Name shape

```
alice.x.handles.link              the short form
alice.x.base.handles.link         with an explicit chain
```

The platform label is not decoration: our keyspace is per platform, so `alice` on
X and `alice` on GitHub are different names that may hold different wallets.

**The chain belongs to the hierarchy**, as a label of its own, rather than being
left to the coin type alone. That is settled, and it is part of the name shape
rather than an extension held in reserve.

The label may be omitted, and the two forms say different things:

- **With a chain** the name **narrows**: it is answered only when the caller asks
  for that same chain. This is how a payment is directed explicitly — in an
  invoice, a message, an integration.
- **Without one** the name is answered by the caller's coin type under the rule
  below: an address for a chain that holds a binding, null for every other.

So a chain label never overrides and never widens. Safety comes from the
coin-type rule in both forms; the label adds intent.

The grammar is ours and nothing external constrains it. Two rules keep it
unambiguous: platform names and chain names are closed sets that never overlap,
and the parse runs right to left, since a Gmail local part contributes a variable
number of labels.

## How resolution works

**ENSIP-10 (wildcard).** The client walks up: it asks the registry for a resolver
for the full name and, on a miss, strips the leftmost label and repeats. The
resolver it finds receives the **original, complete name**:

```solidity
interface ExtendedResolver {
    function resolve(bytes calldata name, bytes calldata data)
        external view returns (bytes);
}
// supportsInterface: 0x9061b923
```

One resolver at the apex therefore covers arbitrary depth. We never create
`x.handles.link` as a name.

**ERC-3668 (CCIP-Read).** The resolver holds no data, so it reverts:

```solidity
error OffchainLookup(address sender, string[] urls, bytes callData,
                     bytes4 callbackFunction, bytes extraData);
```

**Three steps, and the address comes from the third.** The gateway's answer is an
opaque blob; it becomes an address only after a second on-chain call.

```
1. eth_call   resolve(name, addr(node, coinType))
              on the mainnet registry, 0x0000…2e1e — the fixed point.
              The walk-up finds the resolver set on handles.link.
              ↳ revert OffchainLookup(sender, urls, callData, callback, extraData)

2. HTTP GET   urls[0] → { "data": "0x…" }
              A signed blob. No address yet.

3. eth_call   callback(response, extraData) on our resolver.
              It verifies the signature and RETURNS the address.
```

Both calls are `eth_call`. Nothing is sent, no gas is spent, and no state changes.

**Nothing is registered with any wallet.** The endpoint travels inside the revert,
per query, so the contract tells the client where to look. `urls` is a list, so
several endpoints give redundancy and the client tries them in order.

In practice a client reaches the resolver through the ENS `UniversalResolver`,
which performs the walk-up, so the revert surfaces from `resolveWithGateways`
rather than from our contract directly. The flow is unchanged; only the trace
looks different.

**Supporting ENS is not enough.** A wallet needs three things together: ENSIP-10,
or the walk-up never reaches a resolver at all; ERC-3668, or the revert is
reported as an error; and ENSIP-11, or it asks only for mainnet. A wallet holding
all three resolves our names with nothing installed and nothing registered. One
holding fewer either shows an error or receives the mainnet answer, and both are
safe.

## Which chain, and which address

**ENSIP-11** assigns EVM chains a coin type of `0x80000000 | chainId`, resolved
through `addr(node, coinType)`. Bare `addr(node)` is coin type 60 — Ethereum
mainnet, a specific chain rather than an unknown one.

`IdentityNames` sits at one CREATE3 address on every chain with its own state, so
the coin type says which chain's contract to read. The rule is one line with no
exceptions:

> Answer with an address only for a chain where the binding exists. For every
> other chain, including mainnet, answer null.

- Deployed on Base, sender on Base → resolves
- Sender on Arbitrum → refused
- Sender on mainnet where there is no binding → refused

MetaMask queries per chain and does **not** fall back to bare `addr(node)` when
the answer is null: `jesse.base.eth` resolves on Base and is refused elsewhere
with "address resolution for this name not found". Sending on the wrong chain is
therefore not merely unlikely but impossible for wallets implementing ENSIP-11.
One that only calls bare `addr(node)` receives the mainnet answer or a refusal,
and both are safe.

No home chain is designated and nothing is guessed on the user's behalf.

## Where the boundary runs

The line between what we decide and what we accept falls at the gateway call.

**Before it — the client's, not ours.** The walk-up, the registry lookups, whether
the client follows CCIP-Read at all, which coin type it asks with, how deep a name
it will resolve, and **which chain the transaction is finally sent on**. A wallet
that balks at a name never calls us and we never learn of it.

**After it — entirely ours.** The name grammar, the parse, which chain's contract
to read, what policy to apply, and what to refuse.

This is why a chain label cannot make a wallet send on that chain: by the time we
answer, the wallet has chosen its network. What the label does is make us withhold
the address when the caller's coin type disagrees, so nothing is sent at all.

## Several chains, one identity

A user represented on several chains needs no separation in the name: the coin
type separates them. One name gives a different answer per chain, which is
correct — the name denotes a person, the address is a per-chain detail.

A binding on a chain therefore means **"funds can reach me here"**, and users
should be told so plainly. A person believes they are proving an identity; they
are also opening an account.

What does not exist, and does not appear on its own, is **cross-chain freshness**.
The `observedAt` watermark orders proofs within a chain; nothing orders them
across chains. A chain where nobody has re-proved in two years answers
confidently about two years ago.

The sharp case is handle recycling, which this system permits by design. Alice
binds `@alice` on Base, loses the account, the platform reassigns the handle, and
its new holder binds `@alice` on Arbitrum:

```
alice.x.handles.link on Base      → Alice
alice.x.handles.link on Arbitrum  → somebody else
```

Both answers are honest to their own chain. One name, two people, told apart only
by which network the sender was on.

**The gateway is where this can be addressed**, because it reads every chain at
once and no on-chain resolver can. `byHandle(node)` exposes `observedAt`
publicly, so the options are open: expose the age and let the consumer decide;
answer only for the freshest chain and refuse elsewhere; or refuse entirely when
chains disagree.

The first is cheap and honest. The others are **policy** — the gateway begins
deciding rather than reporting, which is a different thing for a system that
describes itself as trust-minimized, and a choice to make deliberately.

## What to implement

**0. Import `handles.link`** via `DNSRegistrar`.

DNSSEC is a precondition, not a preference: the oracle verifies the signature
chain in the EVM, so an unsigned zone cannot be imported at all. `handles.link` is
registered and signed, and `.link` is already an ENS node owned by the registrar,
so what remains is the TXT record and one transaction.

```
TXT  _ens.handles.link   a=0x<owner>

DNSRegistrar.proveAndClaimWithResolver(name, input, resolver, addr)
```

- `name` — the domain in DNS **wire format**, not a string:
  `\x07handles\x04link\x00`. The same encoding ENSIP-10 uses.
- `input` — the DNSSEC chain as `{bytes rrset; bytes sig}` pairs, root downward,
  ending with the TXT RRset. The oracle validates each step against the root key
  it pins. This is what makes the transaction gas-heavy.
- `resolver` — our wildcard resolver, set in the same transaction. May be zero and
  set later with `setResolver`.
- `addr` — must be **zero** for us. It would write `addr(node)` on the resolver,
  and ours holds no records. A non-zero `addr` with a zero `resolver` reverts.

**No gateway URL appears anywhere in DNS** — the record carries an address and
nothing else. Only the rejected ENSIP-17 path puts a resolver in a TXT record.

`proveAndClaimWithResolver` requires `msg.sender` to be the address in the TXT
record. Plain `proveAndClaim(name, input)` has no such check — anyone may submit
the proof, and ownership goes to whatever the record names.

That is the shape of the dependency: **the ENS name follows the DNS domain.** A
later valid proof overwrites the owner, so whoever controls the registrar account
and the DNSSEC keys controls the namespace. Those credentials belong apart from
the gateway's signing key.

**1. The resolver contract** — mainnet, small, stateless. `resolve(name, data)`
reverting `OffchainLookup`; the callback verifying the response;
`supportsInterface(0x9061b923)` and no other id — ERC-7996 in particular, see
**What the gateway signs for**; owner-managed gateway URLs and signer set. It
holds no names.

**2. The gateway** — below. It reads the indexed model `usernames-indexer`
keeps of every chain, and nothing else: no RPC, no per-chain configuration.
The chains it serves are the chains indexers have written; a new indexer is
served the first time it commits.

**3. Nothing on the write path.** `IdentityNames` is untouched: no new call, no
migration, no per-user transaction.

## The backend

A **read-only CCIP-Read gateway** with no state of its own: it reads the
Postgres mirror `usernames-indexer` keeps of every chain. No queue, no write
path, one signing key.

```
request   →  GET /{sender}/{data}.json      (ERC-3668)

work      →  1. decode → (DNS-encoded name, record calldata)
             2. parse right to left → handle, platform, optional chain
             3. platformId = keccak256(platform domain)
             4. match coinType forward against the chains the store holds;
                a label naming another chain answers null
             5. look the binding up in that chain's indexed model
             6. sign (resolver, expires, keccak(callData), keccak(result))

response  →  { "data": "0x…" }   → the resolver's callback verifies
```

- **Stateless** — scale horizontally, restart freely, nothing to back up.
- **Read-only** — a compromised gateway cannot write a binding; the worst it does
  is answer wrongly.
- **One secret**, the signing key, pinned by the resolver. Rotation is an owner
  transaction.
- **Cacheable** — answers are `IdentityNames` reads and carry an expiry the
  resolver enforces.

**What the gateway signs for.** The `resolver` in the digest is the address the
gateway is configured to serve, never the `{sender}` in the path. Today the two
agree, but only because of the route: a wallet reaches the resolver through the
ENS `UniversalResolver`, which forwards the `OffchainLookup` to a batch gateway
with the original sender intact (ENSIP-21). A resolver announcing ERC-7996 is
instead called directly, and the universal resolver raises the lookup again
under its own address (ENSIP-22), so `{sender}` names the universal resolver.
The reference `offchain-resolver` gateway signs for the path and would fail on
that route; that, and not taste, is why the resolver announces ENSIP-10 and
nothing else. Signing for the configured address costs one setting and holds on
both routes. `{sender}` never enters the digest; the gateway may refuse a
mismatch with a terminal 400, and logs it either way. The comparison is
case-insensitive — viem lowercases it, so a checksum check refuses every
request — and that refusal is the first thing to relax before any ERC-7996
deployment. One instance serves one resolver; another network or a
replacement resolver gets its own.

**CORS, on every response.** The mainnet universal resolver lists its gateways
as `["https://ccip-v3.ens.xyz", "x-batch-gateway:true"]`, and the second entry
tells viem to run the batch gateway inside the page. The browser therefore
fetches this gateway directly from the wallet's origin, and without
`Access-Control-Allow-Origin: *` the script never sees the answer and the name
does not resolve. The header goes on every response, errors included. `GET` is
the only method: the resolver's `urls` carry `{data}`, the deployment workflow
refuses a template without it, and ERC-3668 uses its `POST` form only when
`{data}` is absent — so no `POST` route and no preflight. It belongs in the
binary rather than in a proxy in front of it, so no deployment can lose it. `*`
is right: the answers are public and signed, and nothing is sent with
credentials.

**Direct invocation, later.** Once the gateway signs for a configured address
and can answer a `multicall(bytes[])` inside `resolve`, a new resolver
deployment may announce ERC-7996 with `eth.ens.resolver.extended.multicall`:
one signed answer then carries a whole profile, and the ENS batch gateway drops
out of the path. Not before the v2 contracts are final, and never by editing
the deployed resolver, which is immutable — replacing it is one `setResolver`.

It belongs in its own repository, following the pattern of `notary` and
`identity-backend`: a small Rust binary shipped as a container. It must not live
inside `identity-backend`, which is the write path — OAuth, proofs, claiming.
Different failure modes, different blast radius. Being stateless it also suits a
serverless deployment.

**Testing note.** A client without ERC-3668 reports failure for names that work,
and a client with CCIP-Read enabled follows the lookup silently, which makes an
offchain resolver look like an on-chain one. Telling the two apart means disabling
CCIP-Read deliberately — in viem that is a client option, and passing it to the
action instead is silently ignored. A test through the mainnet
`UniversalResolver`, with the batch gateway played by the test, covers the route
a wallet actually takes; the resolver's own tests do not.

## What ENSIP-15 allows

ENSIP-15 is the normative transform, and it is **not** UTS-46 — it diverges, so
UTS-46 is not a substitute for reading it. The reference implementation is
`@adraffy/ens-normalize`, which every wallet reaches through ethers or viem, so a
name it refuses is a name no wallet will resolve.

After `HandleNormalizer` a handle is lowercase ASCII drawn from `[a-z0-9._-]`.
Most of the specification — combining marks, confusable scripts, fenced
characters — cannot apply to that set. What remains is the requirement that a
label is not empty, which our own rules already enforce, and two rules from the
**Validate** section:

```
5F (_) LOW LINE can only occur at the start.
    Must match /^_*[^_]*$/
    valid: "___", "__abc"      invalid: "abc__", "_abc_"

The 3rd and 4th characters must not both be 2D (-) HYPHEN-MINUS.
    Must not match /^..--/
    valid: "ab-c", "---a"      invalid: "xn--", "----"
```

The hyphen rule reserves the punycode prefix `xn--`, so it is positional rather
than a ban on the character: `a--b` passes, `ab--cd` does not.

Note what is NOT restricted, because it shapes the mappings below. A leading or
trailing hyphen is legal in ENS, though DNS forbids it — `-alice` and `alice-`
both normalize. A leading underscore is legal, and it is the only position where
one is. Both facts are load-bearing: the first is why the `_` → `-` substitution
works, the second is what makes a marker label possible.

## Turning a handle into a name

The transform takes what `HandleNormalizer` produced, never the raw text, so it
never sees case, padding or a leading at-sign. It returns an ordered list of
labels, or it refuses. A refusal means the account has no name: it stays
reachable by address, and by nothing else.

```
<handle labels> . <platform> [ . <chain> ] . handles . link
```

Only the handle labels are transformed. The platform label and the chain label
come from closed sets that never overlap, and the chain is chosen by whoever
writes the name rather than derived from anything — see **Name shape**.

**X** — substitute, then check one position.

```
label  = handle, every "_" replaced by "-"
refuse   when the 3rd and 4th characters of handle are both "_"
```

X's alphabet is `[a-z0-9_]` and contains no hyphen, so the substitution is a
bijection onto its image and reverses by replacing every `-` with `_`. The refusal
is the `/^..--/` rule and nothing more: `a__b` gives `a--b` and passes, `ab__cd`
gives `ab--cd` and does not, so only a doubled underscore at exactly those two
positions is lost.

**GitHub** — nothing to do.

```
label  = handle
```

Our rules forbid a doubled hyphen anywhere, so `/^..--/` cannot fire, and GitHub
issues no underscores. No handle is ever refused.

**Gmail** — split the local part.

```
local, domain = handle, split at its single "@"
refuse   unless domain is "gmail.com"
refuse   unless local matches ^[a-z0-9]+(\.[a-z0-9]+)*$
labels = local, split at every "."
```

Reverses by joining the labels with dots and appending the domain the platform
label implies. Our email rules also admit `+`, `-` and `_`, which Gmail does not
issue; an address carrying one is refused rather than mapped, because a mapping
for characters no account can hold would be untested code on a payment path.

**Workspace** — the domain travels in the labels.

```
labels = local split at "." ++ ["_at"] ++ domain split at "."
```

The `_at` marker cannot collide with a handle: a leading underscore is the only
position ENS permits one, and no handle-derived label contains an underscore at
all — X's are `[a-z0-9-]`, GitHub's are `[a-z0-9-]`, Gmail's are `[a-z0-9]`.

**There is no fallback, and an earlier draft was wrong to promise one.** It named
an id-derived form, `<idNode as 64 hex characters>._id.handles.link`. Sixty-four
characters is one past the DNS label ceiling of RFC 1035, so no client can encode
it — ethers' `dnsEncode` refuses above 63. It could not have covered anything.
Splitting the node across two labels or encoding it in a shorter alphabet would
both work, but neither is worth a name nobody would use: the accounts it was meant
to rescue are better served by the Workspace form above.

Three properties hold, and each is work the gateway does not have to do:

- **Injective** — no two accounts reach one name. Across platforms the platform
  label separates them; within one, the substitutions are bijections.
- **Reversible** — the labels carry the handle itself, so the gateway holds no
  mapping and needs no database.
- **Closed** — it reads no state and calls nothing, so one function serves the
  gateway, a browser and a Rust client alike.

## Which handles become names

Both sides normalize. The ENS client applies **ENSIP-15** before hashing, so the
resolver receives already-normalized labels; `HandleNormalizer` then applies ours.
On the subset ENS accepts, the two agree, so a mismatch never produces a wrong
address — it produces a name that does not exist, rejected by the client before
the request reaches us. Two handles cannot collapse onto one name either: after
our normalization a handle is lowercase ASCII, and ENSIP-15 is injective on that
set.

**GitHub — all of them, unchanged.**

**X — all but a rounding error.** `@some_handle` becomes
`some-handle.x.handles.link`, which anyone recognises. What is lost is a doubled
underscore at the third and fourth characters, and nothing else.

**Gmail — all of them, with no escape at all.** Gmail permits only `[a-z0-9.]`,
with no leading, trailing or doubled dot, which is already a legal chain of ENS
labels. Letting the platform label imply the domain removes any ambiguity:

```
alice@gmail.com          → alice.google.handles.link
alice.smith@gmail.com    → alice.smith.google.handles.link
```

A `+tag` never appears — it is a delivery alias, and the `email` claim carries the
canonical address.

**Google Workspace — every address whose parts are label-legal.** A Workspace
address carries its own domain, and joining the parts with dots is ambiguous
(`a.b@c.com` and `a@b.c.com` both give `a.b.c.com`); the `_at` marker resolves it:

```
alice@company.com  → alice._at.company.com.google.handles.link
```

Six labels with a marker in the middle is closer to a machine string than to a
name, and a resolving name publishes where someone works. Both were once reason
enough to leave the form unexposed. They are not, because the alternative turned
out to be no name at all: without it a Workspace account is unreachable by name,
and the fallback that was supposed to catch it does not exist. A long name beats
none. **The privacy consequence stands and is now a product decision rather than
a technical one**: publishing a Workspace name discloses an employer, so whether
these names are minted by default belongs in the binding flow, not here.

**What still has no name.** An address holding `_` or `+`. Both are legal in a
Google address as proved, neither is legal in an ENS label, and no substitution is
available: unlike X, where `_` maps to `-` because X forbids `-`, a Google address
may hold both, so the map would not be reversible. An irreversible map on a
payment path is worse than no name. These accounts are reachable by address.

## The trust model

**The gateway signs, and that is the model.** The resolver pins a signer, the
gateway signs each answer, and the callback verifies the signature. It is what
most CCIP-Read deployments do, and it is the decision here rather than a stage on
the way to something else.

The cost is stated plainly and accepted: **a compromised signing key can answer
with any address.** For a system that routes payments that is the whole risk in
one sentence.

The signer is a keypair of its own, pinned in the resolver's storage. It is not
the ENS name owner and not the address in the DNS record — three separate keys,
which must be held apart:

| key | what it grants | where it lives |
|---|---|---|
| registrar account + DNSSEC | the DNS domain, and therefore the ENS name | DNS provider |
| name and resolver owner | sets the resolver, the gateway URLs, the signer set | cold |
| gateway signer | signs answers | on the gateway host |

Seizing a gateway URL without the signing key buys nothing: the callback rejects
the answer. Seizing the DNS takes the whole namespace. So the URLs are the least
sensitive of the three and the DNS credentials the most, which is the opposite of
where attention usually goes.

What a signature covers is `(resolver, expires, keccak(callData), keccak(result))`.
An answer is therefore bound to that resolver and that query, and expires — it
cannot be replayed for another name or after its deadline. The `resolver` is the
gateway's own configuration, not the request's `{sender}`, for the reason given
under **The backend**.

A storage proof against an L2 state root posted on L1 would replace the signature,
and it is not the plan. It also would not generalize: it needs a chain that posts
state roots to L1 and a canonical way to prove storage against them, which not
every chain we target provides.

## What we deliberately do not do

**Issue subnames as NFTs**, on L1 or through an L2 framework such as Durin. Durin
is right when a name is an asset in its own right. Here a name is derived from a
proof, and minting it separately creates a **second source of truth that can
disagree with the first**: a user rebinds `alice` to a new wallet in
`IdentityNames` while the subname NFT still records the old owner, and nothing
decides which is correct.

The consequence to accept: the user has **no on-chain claim to the ENS name
itself**. It resolves while we run the gateway and keep the resolver pointed at
it. The authoritative record is the binding in `IdentityNames`, which survives
independently and is readable without us. ENS is a display layer, not storage,
and users should be told so.

## What this buys that ordinary subnames do not

Because the name is derived rather than registered:

- **A rename follows automatically.** Alice re-proves as `@alice2`,
  `alice2.x.handles.link` starts resolving and `alice.x.handles.link` stops — no
  ENS transaction, because the handle retirement already happened in
  `IdentityNames`.
- **A wallet move follows automatically.** Alice re-proves from a new wallet and
  the same name resolves to it. With a registered subname this would be a
  transfer; here there is nothing to transfer.

## Open decisions

1. **Gateway policy when chains disagree** — the most consequential, because it
   is where the gateway stops being a pure projection.
2. **Whether `_` → `-` is surfaced in our own UI** or applied only in the
   gateway, so a user sees the name they will paste into a bio.
3. **Whether a Workspace name is minted by default**, given that it discloses an
   employer, or offered as a choice at binding time.
4. **Name depth.** `jesse.cb.id` is one label under the domain and resolves.
   Gmail names reach three and a chain label adds a fourth. ENSIP-10's walk-up is
   depth-agnostic by specification, but depth is decided by the client, so it is
   the first thing to measure after the import.

## Sources

- [ENSIP-10: Wildcard Resolution](https://docs.ens.domains/ensip/10/)
- [ENSIP-11: EVM Chain Address Resolution](https://docs.ens.domains/ensip/11/)
- [ENSIP-15: Name Normalization](https://docs.ens.domains/ensip/15/)
- [ENSIP-17: Gasless DNS Resolution](https://docs.ens.domains/ensip/17/)
- [ERC-3668: CCIP Read](https://eips.ethereum.org/EIPS/eip-3668)
- [Offchain / L2 Resolvers](https://docs.ens.domains/resolvers/ccip-read/)
- [ens-normalize: the ENSIP-15 reference implementation](https://github.com/adraffy/ens-normalize.js)
- [Subnames: issuance models](https://docs.ens.domains/web/subdomains/)
- [DNS Registrar](https://docs.ens.domains/registry/dns/)
- [MetaMask: custom name resolution](https://docs.metamask.io/snaps/features/custom-name-resolution/)
- [Durin](https://github.com/resolverworks/durin)
