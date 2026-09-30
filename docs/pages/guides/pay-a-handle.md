---
title: Send funds to a handle
description: Pay a handle with HandleEscrow, even before its owner has a wallet.
sidebar:
  order: 4
---

`HandleEscrow` lets you send ETH or tokens to a handle such as `@carol` on
GitHub. If Carol has already proved the handle, she gets the funds right away.
If not, the escrow holds them until she proves it and claims them. Until then,
you can take them back.

## Set up

You need a wallet with some ETH. The examples use viem with a private key:

```js
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { handleEscrowAbi, handleHash, handleNode, platformId, rulesOnChain } from '@libid/contracts';

const transport = http(process.env.RPC_URL);
const client = createPublicClient({ transport });
const account = privateKeyToAccount(process.env.PRIVATE_KEY);
const wallet = createWalletClient({ account, transport });

const names = { client, address: '0xe78b53a183dd51763df44beb2500ddab9bb0329e' };
const escrow = { address: process.env.HANDLE_ESCROW, abi: handleEscrowAbi };

const NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
```

`NATIVE` is the address the escrow uses for ETH. Find the `HandleEscrow`
address in [Addresses](/docs/reference/addresses/).

## Hash the handle

The escrow takes the handle as a hash. Compute it on your side, so the
handle itself is never sent to the RPC:

```js
const rules = await rulesOnChain(names, 'github');
const hash = handleHash('carol', rules);
```

`rulesOnChain` reads how the platform writes handles: GitHub ignores case,
X drops a leading `@`, and so on. `handleHash` applies those rules and hashes
the result. It throws if the text can never be a handle on that platform.

## Send

```js
const amount = 10n ** 16n; // 0.01 ETH

const hash1 = await wallet.writeContract({
  ...escrow,
  functionName: 'deposit',
  args: [platformId('github'), hash, NATIVE, amount, account.address],
  value: amount,
});
await client.waitForTransactionReceipt({ hash: hash1 });
```

The arguments are the platform, the handle hash, the token, the amount, and
the address that may take the funds back. For ETH, `value` must equal
`amount`.

If someone already owns the handle, the escrow pays them in the same
transaction and emits `Forwarded`. Otherwise it keeps the funds and emits
`Deposited`.

## Check what is held

The escrow keeps funds under the handle's node. Compute it from the hash:

```js
const node = handleNode('github', hash);

const held = await client.readContract({
  ...escrow,
  functionName: 'escrowed',
  args: [node, NATIVE],
});
```

## Take it back

Until the owner claims, the address you named can take its own deposits back:

```js
const hash2 = await wallet.writeContract({
  ...escrow,
  functionName: 'refund',
  args: [node, NATIVE, account.address],
});
await client.waitForTransactionReceipt({ hash: hash2 });
```

The last argument is where the funds go. `refundable(node, token, address)`
tells you how much a refund would return.

## Claim as the owner

Once Carol proves `carol` on GitHub, she can claim from the wallet she proved
it with:

```js
const hash3 = await wallet.writeContract({
  ...escrow,
  functionName: 'claim',
  args: [node, [NATIVE], account.address],
});
await client.waitForTransactionReceipt({ hash: hash3 });
```

The second argument lists the tokens to claim. Tokens with nothing held are
skipped. The third is where the funds go.

After a claim, deposits made earlier can no longer be refunded.

## Send tokens

To send an ERC-20 token, approve the escrow first, then pass the token's
address instead of `NATIVE` and leave out `value`.

Tokens that charge a fee when they send, and tokens whose balances change on
their own, do not work with the escrow.

## Things to know

- A wrong hash sends funds to a slot nobody can claim. Only the refund
  address can get them back.
- A handle can change owners. Before you send, you can show when the current
  owner proved it. See [Resolve a handle](/docs/guides/resolve-handle/).
- The refund address should be your user. If a contract sends on a user's
  behalf and names itself, the user cannot get the funds back.
