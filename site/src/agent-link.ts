import {
  createCCDPClient,
  CeremonyStage,
  type CCDPClient,
  type Identity,
  type IdentityResult,
  type OAuthProof,
  type PlatformId,
} from '@libid/ceremony';
import { encodeGoogleProof, encodeTlsNotaryProof, googleProofFields } from '@libid/contracts';
import { identityRegistryAbi } from '@libid/contracts/abis';
import * as calls from '@libid/contracts/calls';
import { PopupWindow } from '@libid/popup';
import {
  createPublicClient,
  encodeAbiParameters,
  encodePacked,
  formatEther,
  getAddress,
  hexToBytes,
  http,
  isAddress,
  keccak256,
  size,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';

// The networks this launcher links on: libID's IdentityRegistry, with the Bridge and notary that
// serve it. ponytail: the bind encoding below copies handles.link's until it moves into libID.
const testnet = {
  registry: '0x58ac0cd5ec19c850a75d6183b3c3b2de692fb20d',
  bridge: 'https://testnet.bridge.handles.link',
  notary: 'https://testnet.notary.lib.id',
} as const;
type Chain = { name: string; symbol: string; rpc: string } & Record<keyof typeof testnet, string>;
const chains: Record<string, Chain> = {
  1: {
    name: 'Ethereum',
    symbol: 'ETH',
    rpc: 'https://ethereum-rpc.publicnode.com',
    registry: '0xbefd300aff7d4a67fb381afe8b3596793d3e9a83',
    bridge: 'https://bridge.handles.link',
    notary: 'https://notary.lib.id',
  },
  11155111: {
    name: 'Sepolia',
    symbol: 'ETH',
    rpc: 'https://ethereum-sepolia-rpc.publicnode.com',
    ...testnet,
  },
  3735928814: {
    name: 'Eden testnet',
    symbol: 'TIA',
    rpc: 'https://rpc.testnet.eden.gateway.fm/',
    ...testnet,
  },
};
const names: Record<PlatformId, string> = { github: 'GitHub', x: 'X', google: 'Google' };
const operationDomain = keccak256(toHex('libid.bind-identity'));
const verifierVersion = 1;
const platformHash = (platform: PlatformId) => keccak256(toHex(platform));

type Accepted = Extract<IdentityResult, { status: 'accepted' }>;

/** The registry's proof payload for an accepted result, after checking it proves `transactionData`. */
function proofPayload({ identity, oauthProof }: Accepted, transactionData: Hex): Hex {
  const authorizationNonce = toHex(oauthProof.authorizationNonce);
  const digest = keccak256(encodePacked(
    ['bytes32', 'uint16', 'bytes32', 'uint32', 'bytes'],
    [operationDomain, 1, authorizationNonce, size(transactionData), transactionData],
  ));
  if (toHex(oauthProof.authorizationDigest) !== digest) {
    throw new Error('The proof does not match this link.');
  }
  const shared = { ceremonyVersion: 1, operationDomain, authorizationNonce, transactionData };
  if (identity.platformId === 'google') {
    const proof = oauthProof.proof as OAuthProof<'google'>['proof'];
    const clientIdentifier = toHex((identity as Identity<'google'>).oauthClientId);
    return encodeGoogleProof({
      ...shared,
      clientIdentifier,
      ...googleProofFields(proof.publicInputs as Hex[], { digest, clientIdentifier }),
      proof: toHex(proof.identityProof),
    });
  }
  const proof = oauthProof.proof as OAuthProof<'github'>['proof'];
  return encodeTlsNotaryProof({
    ...shared,
    tokenSession: {
      attestedData: toHex(proof.tokenAttestation.attestedData),
      proof: toHex(proof.tokenAttestation.signature),
    },
    identitySession: {
      attestedData: toHex(proof.identityAttestation.attestedData),
      proof: toHex(proof.identityAttestation.signature),
    },
    idNode: toHex(identity.idNode),
    handleNode: toHex(identity.handleNode),
    proof: toHex(proof.bearerLinkProof),
  });
}

const flow = document.querySelector<HTMLElement>('#flow')!;

function view(title: string, ...body: (Node | string)[]) {
  const heading = Object.assign(document.createElement('h2'), { textContent: title, tabIndex: -1 });
  const changed = flow.querySelector('h2')?.textContent !== title;
  flow.replaceChildren(heading, ...body);
  if (changed) heading.focus({ preventScroll: true });
}
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}
const status = (copy: string) => el('p', { role: 'status' }, copy);
const notice = (copy: string) => el('p', { className: 'notice', role: 'alert' }, copy);
const button = (label: string, onclick: () => void) => el('button', { type: 'button', onclick }, label);

const params = new URLSearchParams(location.hash.slice(1));
const address = params.get('address') ?? '';
const session = params.get('session') ?? '';
const chainId = params.get('chain') ?? '';
const chain = Object.hasOwn(chains, chainId) ? chains[chainId] : undefined;

if (!isAddress(address, { strict: false }) || !/^[0-9a-f]{32}$/.test(session)) {
  view('This link does not work.', status('It is incomplete. Ask your agent for a new one.'));
} else if (!chain) {
  const supported = Object.values(chains).map(({ name }) => name).join(', ');
  view('This link does not work.', status(`libID links on ${supported}. Ask your agent for a link to one of them.`));
} else {
  start(getAddress(address), chain);
}

function start(account: Address, { name, symbol, rpc, registry, bridge, notary }: Chain) {
  const client = createPublicClient({ transport: http(rpc) });
  const quoteBind = (platform: PlatformId) => client.readContract({
    address: registry as Address,
    abi: identityRegistryAbi,
    functionName: 'quoteBind',
    args: [platformHash(platform), verifierVersion],
  });
  const amount = (wei: bigint) => `${formatEther(wei)} ${symbol}`;
  const wallet = el('p', { className: 'wallet' }, el('strong', {}, `↓ ${name}`), el('code', {}, account));
  const transactionData = encodeAbiParameters([{ type: 'address' }], [account]);
  let ceremonies: CCDPClient;
  let quotes: Partial<Record<PlatformId, bigint>> = {};
  let balance = 0n;
  let proving = false;

  function choose(message = '') {
    proving = false;
    const options = (Object.keys(names) as PlatformId[]).map((platform) => {
      const quote = quotes[platform];
      const unavailable = (why: string) => el('p', { className: 'option unavailable' }, `${names[platform]}: ${why}`);
      if (quote === undefined) return unavailable('unavailable');
      if (balance <= quote) {
        return unavailable(quote > 0n
          ? `your agent needs more than ${amount(quote)} plus gas`
          : `your agent needs ${symbol} for gas`);
      }
      const link = el('a', { href: '#', className: 'option' }, `Continue with ${names[platform]}`);
      link.addEventListener('click', (event) => prove(event, platform));
      return link;
    });
    view(
      'Choose the account to link',
      el('p', {}, 'Payments sent to the handle you prove will go to your agent’s wallet.'),
      wallet,
      ...(message ? [notice(message)] : []),
      ...options,
      ...(Object.values(quotes).some((quote) => balance <= quote)
        ? [button('Check the balance again', () => void refresh())]
        : []),
      el('p', { className: 'hint' }, 'Your agent signs and pays for the link. '
        + 'Anyone who knows your handle or email can find the linked wallet.'),
    );
  }

  async function refresh(message = '') {
    balance = await client.getBalance({ address: account }).catch(() => balance);
    choose(message);
  }

  // Called from the anchor's click: the popup must open before any await.
  // fromAnchor cancels the click once the popup opens; a blocked popup needs the anchor's navigation.
  function prove(event: MouseEvent, platform: PlatformId) {
    if (proving) return event.preventDefault();
    proving = true;
    let connection: ReturnType<CCDPClient['connect']> | undefined;
    let result: Promise<IdentityResult>;
    try {
      connection = ceremonies.connect(PopupWindow.fromAnchor(event, 'width=480,height=720'));
      const ceremony = ceremonies.new(
        connection,
        platform,
        { notaryAddress: () => notary },
        hexToBytes(operationDomain),
        hexToBytes(transactionData),
        1,
      );
      const off = ceremony.onStage((update) => {
        if (update.status !== 'active') return;
        view('Making your proof…', status(CeremonyStage.message(update.stage, names[platform])));
      });
      const opened = connection;
      result = ceremony.proveUserIdentity().finally(() => {
        off();
        void opened.close().catch(() => {});
      });
    } catch {
      event.preventDefault();
      void connection?.close().catch(() => {});
      choose('Could not open verification. Allow the verification window and try again.');
      return;
    }
    // Let the anchor's fallback navigation start before replacing the anchor.
    setTimeout(() => proving && view('Making your proof…', status('Keep the verification window open.')));
    void result.then(async (outcome) => {
      if (outcome.status === 'denied') return choose('Sign-in declined. Nothing was linked.');
      view('Checking the link…', status(`Checking it on ${name}.`));
      const quote = await quoteBind(platform);
      // This launcher charges no service fee: zero amount, zero receiver.
      const call = calls.identityRegistry.bindPrivately(
        registry as Address,
        quote,
        platformHash(platform),
        verifierVersion,
        proofPayload(outcome, transactionData),
        0n,
        zeroAddress,
      );
      const request = { ...call, account };
      await client.call(request);
      const [gas, price, held] = await Promise.all([
        client.estimateGas(request),
        // Nodes check an EIP-1559 send against its max fee, not the current gas price.
        client.estimateFeesPerGas().then(({ maxFeePerGas }) => maxFeePerGas, () => client.getGasPrice()),
        client.getBalance({ address: account }),
      ]);
      await deliver({
        chainId: Number(chainId),
        to: call.to,
        data: call.data,
        value: String(quote),
        platform,
        handle: outcome.identity.userName,
        expiresAt: outcome.oauthProof.expiresAt,
      }, held >= quote + gas * price);
    }).catch(() => refresh('Verification could not complete. Try again.'));
  }

  // A retry resends the same transaction, so the proof survives a failed request.
  async function deliver(handoff: Record<string, string | number>, funded: boolean) {
    view('Handing the link to your agent…', status('Saving the transaction for your agent.'));
    const response = await fetch(`/api/agent-link/${session}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(handoff),
    }).catch(() => null);
    if (response?.status === 409) return view('This link was already used.', status('Ask your agent for a new one.'));
    if (!response?.ok) {
      return view(
        'Could not save the link.',
        status('Your proof is still ready.'),
        button('Try again', () => void deliver(handoff, funded)),
      );
    }
    const platform = names[handoff.platform as PlatformId];
    view(
      'Ready for your agent.',
      status(`Go back to your agent. It sends the transaction that links ${handoff.handle} on ${platform} `
        + `to its wallet and pays ${amount(BigInt(handoff.value))} plus gas. You can close this page.`),
      ...(funded ? [] : [notice(`Your agent’s wallet needs more ${symbol} for gas before it can send it.`)]),
      wallet,
    );
  }

  void (async () => {
    try {
      const deadline = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timed out.')), 20_000));
      [ceremonies, balance] = await Promise.race([
        Promise.all([createCCDPClient({ oauthBridge: bridge }), client.getBalance({ address: account })]),
        deadline,
      ]);
      const enabled = ceremonies.enabledPlatforms.filter((platform) =>
        ceremonies.enabledVersions(platform).includes(1));
      // A platform whose verifier the registry lacks has no quote and stays unavailable.
      const read = await Promise.allSettled(enabled.map(quoteBind));
      quotes = Object.fromEntries(enabled.flatMap((platform, i) =>
        read[i].status === 'fulfilled' ? [[platform, read[i].value]] : []));
      choose();
    } catch {
      view('Linking is unavailable.', status(`Account verification on ${name} could not start. Try again later.`));
    }
  })();
}
