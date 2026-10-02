# npm packages

`@libid/popup`, `@libid/ledger` and `@libid/ceremony` are independently versioned
ESM packages with TypeScript declarations. Their initial package versions are
`0.1.0`; publication is a separate maintainer action.

Popup exports its main API, `/worker` and `/testing`. Ceremony exports its
application client API; it requires the app's compatible popup installation as a
peer so both use the same popup classes. Ledger is a regular dependency because
ceremony's declarations use `LedgerId`.

The npm packages contain only the public entry graphs, source maps with embedded
sources, README and repository license/notice files. Source, tests and CCDP
artifacts stay in the repository. Barretenberg and Noir are build dependencies
for the separately deployed CCDP, not dependencies installed by client apps.

## Check a package before release

From the repository root, using Node 24 and pnpm:

```sh
pnpm -C ts install --frozen-lockfile
pnpm -C ts test:packages
```

This builds and packs all three packages into `ts/.cache/npm/`, installs those
exact tarballs into an isolated consumer, then typechecks and bundles the public
imports. The worker entry is typechecked separately from the browser entry. It
also checks the published file allowlist and resolution of workspace dependency
ranges. CI runs the same check alongside the existing tests; it adds no browser
or protocol suite. The consumer and its npm cache stay in ignored local paths.

## First publication

The npm organization must permit publishing all three names. npm requires a
package to exist before a trusted publisher can be configured. From a checked
main commit, run the command above, authenticate to npm with a maintainer
account, and publish ledger and popup before ceremony:

```sh
npm publish ts/.cache/npm/ledger.tgz --access public
npm publish ts/.cache/npm/popup.tgz --access public
npm publish ts/.cache/npm/ceremony.tgz --access public
```

On each npm package, configure its GitHub Actions trusted publisher:
`libid-org/libID`, workflow `release.yml`. Allow publishing and leave the
GitHub environment unset (the workflow uses none). Then require trusted
publishing/2FA according to the organization's policy and remove any bootstrap
publish token. Routine releases use OIDC and automatic npm provenance; they need
no `NPM_TOKEN`. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

## Subsequent releases

1. Bump the affected package's `version` in a PR. Update ceremony's popup peer
   range when compatibility changes, and refresh `ts/pnpm-lock.yaml` with pnpm.
   Workspace dependency ranges become registry versions during `pnpm pack`.
2. Merge and wait for successful main CI. Publish newly required ledger/popup
   versions before a ceremony version that depends on them.
3. Create a GitHub Release at that tested commit with a matching tag:
   `popup-v0.1.1`, `ledger-v0.1.1` or `ceremony-v0.1.1`.

The release workflow verifies the package version, main ancestry and successful
CI, builds the tarballs, runs the consumer check and publishes the same checked
tarball. Stable releases use `latest`; a prerelease version or GitHub prerelease
uses `next`. A retry after successful publication cannot replace an npm version;
inspect the registry before retrying a failed release.

npm versions are independent of CCDP protocol/platform versions and the
`ccdp-v…` container releases. Changing package code does not itself change the
wire protocol. Keep compatible package ranges and the deployed CCDP's supported
ceremony versions aligned.
