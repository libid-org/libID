#!/usr/bin/env bash
# Builds and tests integrator/, a project that uses LibID and LibIDTestBase
# with the README's remappings and foundry.toml lines, as an installed copy
# of this repository at lib/libid.
set -euo pipefail
sol="$(cd "$(dirname "$0")/.." && pwd)"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

cp -R "$sol/integrator/." "$work/"
mkdir -p "$work/lib"
ln -s "$(dirname "$sol")" "$work/lib/libid"
ln -s "$sol/lib/forge-std" "$work/lib/forge-std"
cd "$work"
forge test -vv
