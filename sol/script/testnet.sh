#!/usr/bin/env bash
# Writes src/LibIDTestnet.sol: LibID with the testnet addresses. The library,
# its interfaces and its two addresses are renamed or replaced; nothing else
# changes. CI runs this and fails on any difference, so edit LibID.sol only.
set -euo pipefail
cd "$(dirname "$0")/.."

# The testnet environment's canonical addresses, from chain-configurations'
# networks/sepolia.toml and networks/eden-testnet.toml.
registry=0x25F29C8C765db2f27d1e2b23987A7b0655C7D640
escrow=0x57355e1D1Bcf61FeC9b2E5CaD60DccCDdDC4d8e5

perl -0pe '
  s{\A(// SPDX-License-Identifier:[^\n]*\n)}{$1// Generated from LibID.sol by script/testnet.sh. Do not edit.\n} or die "no SPDX line\n";
  s{^/// \@title LibID$}{/// \@title LibIDTestnet}m or die "no title\n";
  s{^library LibID \{}{library LibIDTestnet \{}m or die "no library\n";
  s{\bILibID(Registry|Escrow)\b}{ILibIDTestnet$1}g;
  s{(address internal constant REGISTRY = )0x[0-9a-fA-F]{40};}{${1}'"$registry"';} or die "no REGISTRY\n";
  s{(address internal constant ESCROW = )0x[0-9a-fA-F]{40};}{${1}'"$escrow"';} or die "no ESCROW\n";
' src/LibID.sol > src/LibIDTestnet.sol
forge fmt src/LibIDTestnet.sol
