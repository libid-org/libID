---
title: Primary names
description: The one name a wallet shows on each platform, and every account it owns.
sidebar:
  order: 4
---

A wallet can own several accounts. To show it as one name, each wallet can
pick a primary name: one handle per platform.

## Setting it

The wallet picks it when it binds an account, by passing `publishName: true`
to `bind`. Later binds from the same wallet on the same platform update the
primary name to the handle just proved, even with `publishName: false`. So a
wallet that renames on the platform shows its new handle once it proves it.

`unpublish(platformId)` removes the primary name. The binding stays.

## Reading it

```solidity
function primaryOf(address wallet, bytes32 platformId) view returns (string)
```

`primaryOf` returns the name only while the handle still resolves to that
wallet. If someone else has taken the handle, it returns an empty string.
You never show a name the wallet has lost.

This is the check ENS asks its integrators to do themselves for reverse
records. Here the contract does it.

`reverseOf` returns the stored name without that check. Use `primaryOf` to
show a name.

## Primary name or all accounts

| You want | Use |
| --- | --- |
| One name to show next to a wallet | `primaryOf`, or `primaryName` in TypeScript |
| Every account a wallet owns | `accountsOf` |

See [Look up a wallet](/docs/guides/lookup-wallet/).

ENS names under `handles.link` resolve from name to address only. A wallet
has no ENS reverse record.
