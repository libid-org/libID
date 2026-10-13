---
title: Published handles
description: The one handle a holder shows on each platform, and every identity it has.
sidebar:
  order: 4
---

A holder can have several identities. To show it under one name, a holder
can publish one handle per platform.

## Publishing

The holder publishes when it binds an identity, by passing `publish: true` to
`bind`. Later binds from the same holder on the same platform update the
published handle to the handle just proved, even with `publish: false`. So a
holder that renames on the platform shows its new handle once it proves it.

`unpublish(platformId)` removes the published handle. The binding stays.

## Reading it

```solidity
function publishedHandleOf(address holder, bytes32 platformId) view returns (string)
```

`publishedHandleOf` returns the handle only while it still resolves to that
holder. If someone else has taken the handle, it returns an empty string, so
you never show a handle the holder has lost.

This is the check ENS asks its integrators to do themselves for reverse
records. Here the contract does it.

## Published handle or all identities

| You want | Use |
| --- | --- |
| One name to show next to an address | `publishedHandleOf` |
| Every identity an address holds | `identitiesOf` |

See [Look up a wallet](/docs/guides/lookup-wallet/).

ENS names under `handles.link` resolve from name to address only. An address
has no ENS reverse record.
