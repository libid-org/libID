---
title: Send funds to a handle
description: Pay a handle with HandleEscrow, even before anyone holds it.
sidebar:
  order: 4
---

`HandleEscrow` lets you send ETH or tokens to a handle such as `carol` on
GitHub. If Carol has already proved the handle, she gets the funds right away.
If not, the escrow holds them. Then one of two things happens: Carol proves
the handle and claims the funds, or the sender takes them back first.

```mermaid
flowchart TD
  D["Sender deposits to carol"] --> Q["Is carol bound?"]
  Q -- yes --> F["Carol is paid at once"]
  Q -- no --> H["The escrow holds the funds"]
  H -- "Carol binds, then claims" --> C["Carol is paid"]
  H -- "refundTo refunds first" --> R["refundTo is paid back"]
```

A paid deposit emits `Forwarded`, a held one `Deposited`. Held funds end one
of two ways, `Claimed` or `Refunded`, whichever comes first.

In this guide you play both people: a sender, with `PRIVATE_KEY`, and Carol,
with `CAROL_KEY`. Set them, and `HANDLE_ESCROW`, as
[Test on a local chain](/docs/guides/local-chain/) shows. Binding Carol's
handle without a real proof needs the local-chain project, which is not
published yet. On other networks, Carol binds with the libID sign-in flow.

## The sender's script

Create `sender.mjs`. Start with the setup:

```js
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { handleEscrowAbi, handleNode, platformId } from '@libid/contracts';

const transport = http(process.env.RPC_URL);
const client = createPublicClient({ transport });
const escrow = { address: process.env.HANDLE_ESCROW, abi: handleEscrowAbi };

const NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
```

`NATIVE` is the address the escrow uses for ETH.

### Hash the handle

The escrow takes the handle as a node, a SHA-256 hash of the handle.
Compute it on your side, so the handle itself is never sent to the RPC:

```js
const sender = createWalletClient({ account: privateKeyToAccount(process.env.PRIVATE_KEY), transport });

const node = handleNode('github', 'carol');
```

`handleNode` takes the platform key, not its id. It folds A-Z to a-z and
hashes the result. Nothing else changes: it does not trim spaces or drop a
leading `@`, so `@carol` is a different node from `carol`, and nobody can
prove it. It throws `HandleError` if the text can never be a handle, for
example if it is empty or too long. The node is the key the escrow keeps
the funds under.

### Send

```js
async function send(amount) {
  const tx = await sender.writeContract({
    ...escrow,
    functionName: 'deposit',
    args: [platformId('github'), node, NATIVE, amount, sender.account.address],
    value: amount,
  });
  await client.waitForTransactionReceipt({ hash: tx });
}

await send(10n ** 16n); // 0.01 ETH
```

The arguments are the platform, the handle node, the token, the amount, and
the address that may take the funds back. For ETH, `value` must equal
`amount`.

If someone already owns the handle, the escrow pays them in the same
transaction and emits `Forwarded`. Otherwise it keeps the funds and emits
`Deposited`. Nobody owns `carol` on the local chain yet, so the escrow keeps
them.

### Check what is held

```js
const held = await client.readContract({ ...escrow, functionName: 'escrowed', args: [node, NATIVE] });
console.log('held for carol:', held);
```

### Take it back

Until Carol claims, the `refundTo` address of a deposit can take it back.
The sender named itself as `refundTo`, so it can call `refund`:

```js
const tx = await sender.writeContract({
  ...escrow,
  functionName: 'refund',
  args: [node, NATIVE, sender.account.address],
});
await client.waitForTransactionReceipt({ hash: tx });
```

The last argument is where the funds go. `refundable(node, token, address)`
tells you how much a refund would return.

A refund and a claim are alternatives: whichever comes first gets the funds.
So that Carol has something to claim in the next step, send again:

```js
await send(10n ** 16n);
```

Run it:

```sh
node sender.mjs
```

## Carol proves her handle

In a real app, Carol proves `carol` on GitHub with the libID sign-in flow,
which binds the handle to her address. See
[How binding works](/docs/advanced/how-binding-works/). On the
[local chain](/docs/guides/local-chain/#the-guides-test-data), bind it from
the `local-chain` directory:

```sh
./bind.sh github 777 carol $CAROL_KEY
```

## Carol's script

Create `carol.mjs`, starting with the same setup as `sender.mjs`, then:

```js
const carol = createWalletClient({ account: privateKeyToAccount(process.env.CAROL_KEY), transport });
const node = handleNode('github', 'carol');

const tx = await carol.writeContract({
  ...escrow,
  functionName: 'claim',
  args: [node, [NATIVE], carol.account.address],
});
await client.waitForTransactionReceipt({ hash: tx });

console.log('left for carol:', await client.readContract({ ...escrow, functionName: 'escrowed', args: [node, NATIVE] }));
```

`claim` must come from the holder of the handle. The second argument
lists the tokens to claim; tokens with nothing held are skipped. The third is
where the funds go.

```sh
node carol.mjs
```

After a claim, the sender can no longer refund the deposits Carol took.

## Send tokens

To send an ERC-20 token, approve the escrow first, then pass the token's
address instead of `NATIVE` and leave out `value`.

Tokens that charge a fee when they send, and tokens whose balances change on
their own, do not work with the escrow. A token address with no code reverts
with `BadToken`.

## Send by handle text

`depositToHandle` takes the handle as text instead of a node. Use it in
place of `deposit`:

```js
await sender.writeContract({
  ...escrow,
  functionName: 'depositToHandle',
  args: [platformId('github'), 'carol', NATIVE, amount, sender.account.address],
  value: amount,
});
```

It credits the same node, so Carol claims both kinds the same way. It also
emits `DepositedToHandle` with the handle folded. The handle is then public in
the calldata and the logs. It folds A-Z like `handleNode` and checks nothing
else, so `@carol` still lands on a node nobody can claim.

## Things to know

- A wrong node sends funds to a slot nobody can claim. Only the refund
  address can get them back.
- Code written for libID-contracts v0.17 passed a `keccak256` hash of the
  handle as the second argument of `deposit`. The function kept its
  signature, so that call still goes through, and the funds go to a node
  nobody can claim.
- `handleNode` used to take a platform id and a hash. Now it takes a
  platform key and the handle. `handleNode(platformId('github'), 'carol')`
  still type-checks, and throws at run time.
- A handle can change holders. Before you send, you can show when the
  current holder proved it. See [Resolve a handle](/docs/guides/resolve-handle/).
- The refund address should be your user. If a contract sends on a user's
  behalf and names itself, the user cannot get the funds back.
