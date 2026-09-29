# Dependency updates

Dependabot checks all supported dependency sources weekly. Package jobs allow
both direct and indirect dependencies; there are no dependency-name allowlists
or ignored packages. This does not mean every pin is automatically updatable.
Updates remain reviewable pull requests, not automatic merges.

## Coverage

Every repository below also checks GitHub Actions in `.github/workflows`.
`libID-contracts` explicitly includes its `.github/actions/forge-build` composite
action directory, which is not discovered by the root job. Workspace jobs
include their member packages.

| Repository | Additional update jobs |
| --- | --- |
| `libID` | npm/pnpm: `/site`, `/ts`; Docker Compose: `/harness` |
| `libID-rs` | Cargo: `/` |
| `libID-contracts` | Cargo: `/rust`; npm/pnpm: `/ts`; Git submodules: `/` (Solidity libraries) |
| `chain-configurations` | Cargo: `/` |
| `libID-circuits` | No other Dependabot-supported manifests |
| `notary` | Cargo: `/`; Docker: `/` |
| `libID-bridge-rs` | Cargo: `/`; Docker: `/` |
| `keeper` | Cargo: `/`; Docker: `/`, `/e2e`; Docker Compose: `/` |
| `usernames-indexer` | Cargo: `/`; Docker: `/`; Docker Compose: `/` |
| `tlsn` | Cargo: `/`, `/crates/examples-zk`; Docker: `/crates/harness` |
| `mpz` | Cargo: `/`, `/crates/lpn-estimator` |
| `repository-template`, `examples` | No package manifests yet; add jobs when adding dependencies |

The separate Cargo jobs in `tlsn` and `mpz` cover crates excluded from their root
workspaces. The existing `/site` job keeps its seven-day cooldown and one-open-PR
limit, but is no longer restricted to Wrangler. Other jobs use the default PR
limit. Related `libid-*` crates and browser proof packages are grouped where used
together; grouping cannot coordinate updates across repositories or ecosystems.

## Manual review and unsupported pins

- **Noir:** Dependabot does not support `Nargo.toml`. Review the SHA-256, RSA,
  bignum, Base64 and date dependencies in `libID-circuits` and
  `tlsn/crates/examples-zk/noir` manually.
- **Proof compatibility:** update `libID-circuits/toolchain.env` (Nargo and
  Barretenberg), generated verification keys/verifiers and release artifacts
  together with `@aztec/bb.js` and `@noir-lang/*` in `libID/ts`.
  `libID/ts/packages/claim-full/package.json` also has custom
  `libid.notaryRelease` and `libid.circuitsRelease` fields; these are not npm
  dependencies. Its asset-fetch script checks toolchain compatibility. An npm
  update PR alone does not establish compatibility with the released circuits.
- **Git revisions:** Cargo dependencies pinned to version-like tags can be
  updated, but raw commit `rev` pins cannot. This includes the TLSN/MPZ patches
  in `notary` and `keeper`, and utility/Merkle pins in `tlsn`. Dependabot also
  cannot update transitive Git dependencies. Review upstream and fork changes,
  preserve required fork fixes, and update compatible revisions together.
- **Installed tools:** Rust/Foundry/Node/pnpm versions in workflow inputs or
  environment variables, `solc_version` in `foundry.toml`, `cargo install`
  commands, shell download URLs/checksums, and ad-hoc Python installs are not
  package manifests. Review these manually. The floating `nightly` in
  `tlsn/crates/wasm/rust-toolchain` has no version for Dependabot to bump.
- **Images in workflows:** the Actions updater checks `uses:`, not service
  `image:` values. Review PostgreSQL service images in `notary` and
  `usernames-indexer` workflows separately; Docker and Compose jobs cover their
  respective files, not arbitrary workflow YAML.
- **Deployment artifacts:** `keeper/e2e/Dockerfile` downloads a
  `chain-configurations` release using an ARG and architecture-specific
  checksums. Update these and the copied network configuration together.
  Contract vendoring scripts and other generated artifacts also require their
  documented regeneration workflows. Review harness image bumps against the
  APIs they exercise; existing legacy image pins are not renamed by this setup.

Ordinary manifest coverage is not a guarantee that every update will resolve:
exact constraints, prerelease policies, unavailable tags, registry access and
CI can still block an update. Review the Dependabot job logs after activation.

## Activation and maintenance

Configuration takes effect on each repository's default branch. Forks (`tlsn`
and `mpz`) additionally require explicitly enabling Dependabot version updates
in repository Settings → Advanced Security. Security alerts and automatic
security updates are separate repository settings; this configuration does not
turn those settings on.

When introducing a package manager, standalone workspace, container directory,
or submodule, add its real manifest root to `.github/dependabot.yml`. Do not add
jobs pointing to nonexistent manifests. The repository template starts with
Actions only. Avoid package-name allowlists unless an exclusion is deliberate
and documented here.

The DCO checks accept Dependabot's exact bot author identity with its standard
`Signed-off-by: dependabot[bot] <support@github.com>` trailer. Unsigned bot
commits still fail; human commits still require their own matching sign-off.
The template includes a runnable regression check for this exception.

References: [supported ecosystems](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories),
[configuration options](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference),
[activation, including forks](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/configure-version-updates),
[Cargo pinned-revision handling](https://github.com/dependabot/dependabot-core/blob/main/cargo/lib/dependabot/cargo/update_checker.rb).
