# npm packages

`@libid/popup`, `@libid/ledger`, `@libid/ceremony` and `@libid/ens` are independently versioned
ESM packages with TypeScript declarations. Their initial package versions are
`0.1.0`; publication is a separate maintainer action.

Popup exports its main API, `/worker` and `/testing`. Ceremony exports its
application client API; it requires the app's compatible popup installation as a
peer so both use the same popup classes. Ledger is a regular dependency because
ceremony's declarations use `LedgerId`. Ens depends on `@libid/contracts`, pinned to
the version ceremony uses, for handle normalization. It requires viem as a
peer because `@libid/contracts/identity` imports viem when it loads.

The npm packages contain only the public entry graphs, source maps with embedded
sources, README and repository license/notice files. Source, tests and CCDP
artifacts stay in the repository. Barretenberg and Noir are build dependencies
for the separately deployed CCDP, not dependencies installed by client apps.

## Check a package before release

From the repository root, using Node 26 and pnpm:

```sh
pnpm -C ts install --frozen-lockfile
pnpm -C ts test:packages
```

This builds and packs all four packages into `ts/.cache/npm/`, installs those
exact tarballs into an isolated consumer, then typechecks the public imports
with both the workspace TypeScript and TypeScript 5, and bundles them. The
worker entry is typechecked separately from the browser entry. It also checks
the published file allowlist, that every `exports` target ships, and resolution
of workspace dependency ranges. CI runs the same check alongside the existing
tests; it adds no browser or protocol suite. The consumer and its npm cache stay
in ignored local paths.

## First publication

The npm organization must permit publishing all four names. npm requires a
package to exist before a trusted publisher can be configured. From a checked
main commit, run the command above, authenticate to npm with a maintainer
account, and publish ledger and popup before ceremony; ens depends on none of
them. These first versions carry no provenance; every later one does:

```sh
npm publish ts/.cache/npm/ledger.tgz --access public
npm publish ts/.cache/npm/popup.tgz --access public
npm publish ts/.cache/npm/ceremony.tgz --access public
npm publish ts/.cache/npm/ens.tgz --access public
```

Once per repository, set up two settings that cover every package:

- The `npm-release` environment deploys only tags matching `*-v*`, never
  branches. Add required reviewers if releases need a second person. Only the
  publish job runs there, so only it can obtain an npm OIDC token.
- A tag ruleset lets only maintainers create, move or delete `*-v*` tags. A
  release runs the workflow of its tagged commit, so whoever can create a
  release tag can publish.

On each npm package, configure its GitHub Actions trusted publisher:
`libid-org/libID`, workflow `release.yml`, environment `npm-release`, and
allow direct publishing with `npm publish`. A trusted publisher created after
3 September 2026 otherwise permits only `npm stage publish`, and the release
job cannot publish. With the CLI this needs npm 12 or later:
`npx npm@12 trust github @libid/<package> --repo libid-org/libID --file release.yml --env npm-release --allow-publish`.
npm checks the repository, workflow file and environment, not the branch, so the
environment and the tag ruleset are what keep an edited workflow from
publishing. Then require trusted publishing/2FA according to the organization's
policy and log the bootstrap session out of npm. Routine releases use OIDC and
automatic npm provenance; they need no `NPM_TOKEN`. See
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

## Subsequent releases

1. Bump the `version` of every changed package in one PR. Update ceremony's
   popup peer range when compatibility changes, and refresh `ts/pnpm-lock.yaml`
   with pnpm. Workspace dependency ranges become registry versions during
   `pnpm pack`.
2. Merge and wait for successful main CI.
3. Create one GitHub Release at that tested commit with the tag
   `packages-v<YYYY.MM.DD>`, such as `packages-v2026.10.20`. Another release on
   the same day appends `.<n>`, such as `packages-v2026.10.20.2`.

The release workflow verifies main ancestry and successful CI, builds the
tarballs and runs the consumer check. It then plans, in the order of
`ts/scripts/packages.ts`, every package whose version is not on npm, and checks
that each planned package's `@libid/*` dependencies are on npm or planned before
it. It fails when no version is new. A separate job in the `npm-release`
environment then publishes those same checked tarballs in that order. Stable
versions use `latest`; a prerelease version or GitHub prerelease uses `next`.
Versions already on npm are skipped, so re-running a partly published release
publishes the rest.

## Adding a package

Every package under `ts/packages` that is not `private` takes part in every
package release; the workflow needs no change. In `ts/scripts/packages.ts`, add
it to `packages` after its workspace dependencies, and in
`ts/scripts/check-packages.ts` add its public imports to the consumer. The check
fails while a public package is missing from that list. Then publish its first
version and configure its trusted publisher as under
[First publication](#first-publication); until then, package releases fail.

## Versions

npm versions are independent of CCDP protocol/platform versions and the
`ccdp-v…` container releases. Changing package code does not itself change the
wire protocol. Keep compatible package ranges and the deployed CCDP's supported
ceremony versions aligned.
