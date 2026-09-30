---
title: Test on a local chain
description: Run libID on anvil with known test accounts, so every guide works offline.
sidebar:
  order: 6
---

You can run libID on your own machine with [anvil](https://getfoundry.sh).
The script below deploys `IdentityNames` and `HandleEscrow` from the
contracts repository, and binds a few test handles. Every guide in these docs
works against it.

The script uses test verifiers that accept any claim without a proof. Use it
only for local testing.

## Set up

You need [Foundry](https://getfoundry.sh). Clone the contracts:

```sh
git clone --recursive https://github.com/libid-org/libID-contracts
cd libID-contracts/solidity
```

Save this as `script/LocalChain.s.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {HandleVectors} from "../contracts/identity/HandleVectors.sol";
import {IdentityNames} from "../contracts/identity/IdentityNames.sol";
import {IIdentityNames} from "../contracts/identity/IIdentityNames.sol";
import {StubPlatformVerifier} from "../contracts/identity/test/StubPlatformVerifier.sol";
import {CeremonyProofVerifier} from "../contracts/ceremony/CeremonyProofVerifier.sol";
import {IPlatformVerifier} from "../contracts/ceremony/IPlatformVerifier.sol";
import {IProofVerifier} from "../contracts/ceremony/IProofVerifier.sol";
import {HandleEscrow} from "../contracts/escrow/HandleEscrow.sol";

/// A local libID for testing: IdentityNames and HandleEscrow with test
/// verifiers that accept any claim. Never deploy this to a real network.
contract LocalChain is Script {
    // anvil's first account deploys and owns everything.
    uint256 constant ADMIN = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    uint256 nonce;

    function run() external {
        address admin = vm.addr(ADMIN);
        vm.startBroadcast(ADMIN);
        IdentityNames names = IdentityNames(
            address(new ERC1967Proxy(address(new IdentityNames()), abi.encodeCall(IdentityNames.initialize, (admin))))
        );
        CeremonyProofVerifier proofs = CeremonyProofVerifier(
            address(
                new ERC1967Proxy(
                    address(new CeremonyProofVerifier()), abi.encodeCall(CeremonyProofVerifier.initialize, (admin))
                )
            )
        );
        names.setProofVerifier(IProofVerifier(address(proofs)));
        bytes32[3] memory platforms =
            [HandleVectors.PLATFORM_GITHUB, HandleVectors.PLATFORM_X, HandleVectors.PLATFORM_GOOGLE];
        for (uint256 i; i < platforms.length; i++) {
            names.setPlatform(platforms[i], HandleVectors.rulesFor(platforms[i]));
            proofs.setVerifier(platforms[i], 1, IPlatformVerifier(address(new StubPlatformVerifier(platforms[i], 0))));
        }
        HandleEscrow escrow = HandleEscrow(
            address(
                new ERC1967Proxy(
                    address(new HandleEscrow()),
                    abi.encodeCall(HandleEscrow.initialize, (admin, IIdentityNames(address(names))))
                )
            )
        );
        vm.stopBroadcast();

        // anvil accounts 1 and 2
        bind(names, "github", "583231", "octocat", 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a);
        bind(names, "github", "1001", "alice-dev", 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d);
        bind(names, "x", "2244994945", "alice_x", 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d);

        console.log("IdentityNames", address(names));
        console.log("HandleEscrow ", address(escrow));
    }

    /// Bind `handle` and `userId` on `platform` to the wallet of `key`, as if
    /// that wallet had proved the account. Publishes the handle as its name.
    function bind(IdentityNames names, string memory platform, string memory userId, string memory handle, uint256 key)
        public
    {
        bytes32 platformId = keccak256(bytes(platform));
        StubPlatformVerifier verifier = StubPlatformVerifier(
            address(CeremonyProofVerifier(address(names.proofVerifier())).verifierOf(platformId, 1))
        );
        vm.startBroadcast(ADMIN);
        verifier.set(userId, handle);
        verifier.setObservedAt(uint64(block.timestamp) + uint64(++nonce));
        vm.stopBroadcast();

        address wallet = vm.addr(key);
        bytes memory payload = abi.encode(
            StubPlatformVerifier.StubPayload({
                ceremonyVersion: 1,
                operationDomain: keccak256("libid.claim-identity"),
                authorizationNonce: keccak256(abi.encode(wallet, platformId, userId, handle, nonce)),
                transactionData: abi.encode(wallet, uint256(0), address(0))
            })
        );
        vm.broadcast(key);
        names.bind(platformId, 1, payload, true);
    }
}
```

## Run it

Start anvil in one terminal:

```sh
anvil
```

In another, run the script:

```sh
forge script script/LocalChain.s.sol \
  --skip '*/circuits/**' --skip '*/ceremony/test/**' \
  --rpc-url http://127.0.0.1:8545 --broadcast
```

The `--skip` flags leave out files that a fresh clone does not have yet.

On a fresh anvil, the addresses are always the same:

```
IdentityNames 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
HandleEscrow  0x0B306BF915C4d645ff596e518fAf3F9669b97016
```

## What you get

| Handle | Account id | Wallet |
| --- | --- | --- |
| GitHub `octocat` | `583231` | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` (anvil account 2) |
| GitHub `alice-dev` | `1001` | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` (anvil account 1) |
| X `alice_x` | `2244994945` | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` (anvil account 1) |

Each handle is also its wallet's shown name. The private keys of the anvil
accounts are printed when anvil starts.

## Use it with the guides

Set these before you run a guide's code:

```sh
export RPC_URL=http://127.0.0.1:8545
export HANDLE_ESCROW=0x0B306BF915C4d645ff596e518fAf3F9669b97016
```

The guides use the canonical `IdentityNames` address. On the local chain,
replace it with `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`.

## Bind another handle

To bind a handle yourself, call the script's `bind` function. This binds
GitHub `carol` to anvil account 3, which is what the claim step of
[Send funds to a handle](/docs/guides/pay-a-handle/) needs:

```sh
forge script script/LocalChain.s.sol \
  --skip '*/circuits/**' --skip '*/ceremony/test/**' \
  --sig 'bind(address,string,string,string,uint256)' \
  0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512 github 777 carol \
  0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6 \
  --rpc-url http://127.0.0.1:8545 --broadcast
```

The arguments are the `IdentityNames` address, the platform, the account id,
the handle, and the private key of the wallet to bind it to.
