#!/usr/bin/env bash
# Writes src/LibIDTestnet.sol: LibID with the testnet addresses. The library
# and every other file-level declaration are renamed so both files can be
# imported together, and the two addresses are replaced; nothing else changes.
# CI runs this and fails on any difference, so edit LibID.sol only.
set -euo pipefail
cd "$(dirname "$0")/.."

# The testnet environment's canonical addresses: the registry from
# chain-configurations' networks/sepolia.toml and networks/eden-testnet.toml,
# the escrow the factory address of libid.HandleEscrow.4.
registry=0x58Ac0CD5eC19C850A75D6183b3C3B2DE692FB20D
escrow=0xE7eb0c675B757C12B1312dF652242b863624Bfab

# Written beside the target and moved over it only once complete, so a failed
# run leaves the old file in place.
tmp=$(mktemp -d src/.testnet.XXXXXX)
trap 'rm -rf "$tmp"' EXIT

perl -0pe '
  s{\A(// SPDX-License-Identifier:[^\n]*\n)}{$1// Generated from LibID.sol by script/testnet.sh. Do not edit.\n} or die "no SPDX line\n";
  s{^/// \@title LibID$}{/// \@title LibIDTestnet}m or die "no title\n";
  s{^library LibID \{}{library LibIDTestnet \{}m or die "no library\n";
  # Every other file-level declaration must be named ILibID* and is renamed
  # wherever it is used. Any other name would clash between the two files.
  my %renamed;
  while (/^(?:abstract\s+contract|contract|interface|library|struct|enum|type|error|event|function)\s+(\w+)/mg) {
    my $name = $1;
    next if $name eq "LibIDTestnet";
    $name =~ /\AILibID(\w+)\z/ or die "file-level $name is not named ILibID*\n";
    $renamed{$name} = "ILibIDTestnet$1";
  }
  for my $name (keys %renamed) { s{\b$name\b}{$renamed{$name}}g }
  # A file-level line that declares nothing above is a constant, a `using`
  # or something else this script does not rename.
  for (/^([^\s\/}*\n][^\n]*)/mg) {
    next if /\A(?:pragma|import|library|interface|contract|abstract|struct|enum|type|error|event|function)\b/;
    die "file-level line not handled: $_\n";
  }
  s{(address internal constant REGISTRY = )0x[0-9a-fA-F]{40};}{${1}'"$registry"';} or die "no REGISTRY\n";
  s{(address internal constant ESCROW = )0x[0-9a-fA-F]{40};}{${1}'"$escrow"';} or die "no ESCROW\n";
' src/LibID.sol > "$tmp/LibIDTestnet.sol"
forge fmt "$tmp/LibIDTestnet.sol"
mv "$tmp/LibIDTestnet.sol" src/LibIDTestnet.sol
