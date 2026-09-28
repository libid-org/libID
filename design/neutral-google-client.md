# A neutral Google client, so the application never sees the address

**Status: design option, not specified.** Nothing here is built, and no
requirement text is written for it. It layers on the digest profile of
`private-gmail-handle.md` and does not replace it: without the digests the
proof itself carries the address. It changes the OAuth Bridge, the CCDP
Distribution and the SDK, and would be specified in a PR of its own.

## The thing that must work

Alice binds `alice@gmail.com` to her wallet through an application she does
not trust with her address. The application gets a proof it can submit and
two digests, and learns the address only if Alice, on a screen the
application does not control, chooses to show it. Bob, whom Alice told her
address, still resolves it.

`private-gmail-handle.md` hides the address from everyone who reads the
chain. It says plainly that it does not hide it from the application
operator: the ID Token reaches the application's origin, so the operator
holds the email and decides whether a claim carries it (SP-PRIV-01 and §4
of `ceremony-common.md`). This note asks what it would take to close that
last gap, and whether it can be closed at all.

## Who learns the address today

Two browser flows exist. The SDK on `main` (`ts/packages/claim`) has the
application open Google in a popup and receive the raw `id_token` on its own
origin over the `libid_link` channel (`google/claim.ts:53-91`,
`channel.ts:11`, `apps/demo/src/relay.ts:61-111`). The application then
holds the token, the email, the `sub` and the proof.

The CCDP rebuild (libid PR #28 at `08c3f3d`, specified in PR #13 at
`374035c`, neither merged) goes further. The Callback page on the Bridge's
`/auth/callback` copies the return into memory, clears it, and moves it to
the CCDP Prover page on the Distribution origin, which verifies the token
and proves there; the Application receives the result over the popup's
message channel, never the token (`ccdp.md:762`: "keep the return private
from Application"). Two things still hand the address to the application:

- **The result.** Prover returns `identity` with `userId` and `userName`
  beside the proof (`ts/packages/ceremony/src/platforms/index.ts:89-126`),
  and the Google proof of the byte profile carries the email in its public
  inputs anyway.
- **The OAuth client is the application's.** Every registration's
  `redirect_uri` is the Bridge's `/auth/callback` (`oauth-bridge.md:59-61`),
  the Bridge "owns OAuth registrations" (`ccdp.md:65`), and the application
  operator "controls its frontend, redirect deployment, OAuth clients"
  (`libid.md:56`). The Bridge writes the Callback document's CSP itself, so
  the hash pinning of the Distribution's code does not bind a malicious
  Bridge operator (`ccdp.md:594-595`: "A compromised Bridge or Distribution
  can replace browser code and observe or withhold credentials"). And an
  operator that owns a Google client can recover a returning user's email
  with no consent screen at all, `prompt=none` or One Tap's `auto_select`,
  outside any libID ceremony
  (developers.google.com/identity/openid-connect/openid-connect,
  developers.google.com/identity/gsi/web/reference/js-reference).

The second point is the one no amount of care inside the ceremony fixes:
while the client is the application's, the application can ask Google
directly.

## The idea

One Google OAuth client, registered and operated by libID, whose only
redirect URI is on the Distribution origin. The token lands in the
Canonical Runtime there; the runtime verifies it, proves the digest
statement, and returns to the application the proof, the two digests and,
only if the user chose it on the runtime's own screen, the email. The
application never holds the token and owns no Google client that could
ask for it.

## Is it feasible

Checked on 2026-09-23 against Google's published policy and the browsers'
documented behaviour; the sources are listed at the end.

### Google

- **A shared broker client is allowed.** Google's OAuth policies require
  separate projects for testing and production and nothing like one project
  per application; the rule that matters is that the consent screen
  "accurately represent the identity of the application", and here the
  application that receives the token is libID, so the screen naming libID
  is the accurate one. A broker that showed an integrating application's
  brand under its own client would break that rule.
- **Precedent.** MetaMask Embedded Wallets (formerly Web3Auth) ship a shared
  client by default: "The Google consent screen identifies the OAuth
  application managed by Embedded Wallets, not your dapp". Aptos Connect
  appears to do the same for Keyless across dApps; that is inferred, not
  confirmed. Privy, Clerk and Auth0 offer shared credentials for
  development only and ask for your own in production, for branding and
  control, not because Google forbids sharing. Sui zkLogin and plain Aptos
  Keyless use per-dApp clients because the client id is part of the address
  derivation, which libID's is not (REQ-COMMON-17C).
- **The redirect must be libID's.** Redirect domains must be ones the
  project owner owns or is licensed to use, and verification covers every
  redirect domain. So "each application registers libID's redirect under its
  own client" is not an option, and would not help: the application would
  still own a client it could ask directly.
- **Verification.** `openid email` are non-sensitive scopes; no app
  verification is required. Showing libID's name and logo requires brand
  verification: the domains verified in Search Console, a public homepage
  and a privacy policy on the same domain, and the privacy policy must say
  that libID passes the proof and digests to the application the user is
  using.
- **The endpoint.** Google's discovery document still lists
  `response_type=id_token` with `fragment` and `form_post`, and the OIDC
  guide documents the implicit flow with a required `nonce` and no
  deprecation notice. Google's browser pages do call direct implicit use
  "provided only for legacy support". Google Identity Services in redirect
  mode, which also takes a `nonce`, is the supported alternative if the
  endpoint is ever retired.

### Browsers

- **Top-level redirects work everywhere.** The application navigates the
  whole tab to the Distribution origin; that page stores the ceremony in its
  own first-party storage keyed by `state`, sends the tab to Google, receives
  the fragment on its own callback, proves, and navigates back to the
  application with the result in the fragment or a form post. No opener has
  to survive, and no storage is partitioned. The result is tens of
  kilobytes; Chrome's URL limit is 2 MB, and a form post has none that
  matters.
- **A popup probably works, with no guarantee.** Google's sign-in pages sent
  `Cross-Origin-Opener-Policy: same-origin` only as report-only on
  2026-09-23 (signed out; signed-in pages not measured), so today the
  opener survives. Google is collecting reports, and an enforced header
  would cut the popup off from the page that opened it. The CCDP popup flow
  depends on the opener already, so the risk is not new, but a design that
  hinges on privacy should not rest on a report-only header.
- **An iframe of the Distribution inside the application cannot talk to a
  top-level Distribution window through storage.** Chrome (since 115),
  Firefox (since 103) and Safari partition BroadcastChannel and storage by
  top-level site. A popup opened by that iframe keeps it as `opener`, which
  should work; untested.
- **FedCM does not fit.** Google supports FedCM only for same-site iframes
  ("All other cases like different domains are unsupported"), so a libID
  iframe inside `app.example` is excluded, and FedCM is Chrome and Edge only;
  Firefox paused its implementation.

Verdict: feasible, with the top-level redirect as the flow to rely on and
the popup as a convenience where it keeps working.

## The one new risk, and the screen it needs

With per-application clients, a hostile site that wants Alice's Google
account bound to the attacker's wallet has to get Alice through a Google
consent screen naming the hostile site's own client. With one shared
client, Alice consents to libID once, and every later ceremony, started by
any site, meets at most an account chooser. A hostile site can open the
neutral ceremony with an Authorized Transaction Data whose `target` is the
attacker's wallet, and Alice, recognizing the libID flow, signs in. The
proof binds her account to the attacker. Consent-screen phishing is already
outside protocol enforcement (`ceremony-common.md` §12), but a shared client
turns a per-site consent into a global one.

So the neutral runtime must show a screen of its own before it sends Alice
to Google, and continue only on her click there: the site that asked (the
return origin, which the runtime reads from the navigation it received and
will send the result to), the operation, the wallet the identity binds to,
the service fee, and the disclosure choice. The Distribution origin serves
that page top-level with `frame-ancestors 'none'`, so the site cannot frame
or overlay it.

A wallet address is not something people check by eye. The stronger form
has the runtime ask the wallet in Alice's browser to sign for the `target`
before the ceremony proceeds: a hostile site's `target` is a wallet Alice's
browser does not control, so the ceremony stops there. Injected wallets
work on any top-level origin; embedded and smart-account wallets need their
own connection flow on the Distribution origin, and that is the cost.

This screen is also the enforcement point the second review of
`private-gmail-handle.md` found missing. There, a disclosure choice in the
Authorized Transaction Data was rejected because no trusted screen showed
it and the runtime could not read it. Under a neutral client the runtime
owns a screen, shows the choice, and holds the email until the user says
yes, so a user-authorized disclosure becomes enforceable. This note does not
reintroduce it; it records that the option would reopen.

## What the application can still do

- **Confirm a suspected address.** It receives the handle digest, which is
  an unsalted hash of the normalized address. An application that already
  suspects Alice's address confirms it by hashing it (ASM-HASH-01), as any
  reader of the chain can. The neutral client stops the application from
  being told; it does not stop it from guessing.
- **Run its own client beside the neutral one.** Nothing stops an
  application from also registering a Google client and asking Alice to
  sign in to it. The neutral client removes libID's part in handing over the
  address; it cannot remove the application's ability to ask. Alice sees the
  difference, since that consent screen names the application, and the
  protocol can say no more than that.
- **Withhold or delay.** It can refuse to submit the proof. That is
  availability, not privacy.

## Where the trust goes

Trust moves; it does not shrink.

- **libID gains silent re-authentication over every user of every
  application.** The same `prompt=none` that lets an application recover an
  email today lets whoever operates the neutral client recover it for
  anyone who ever consented to libID. That is the concentration this design
  buys, and it has to be named in the privacy policy and the threat model.
- **The Distribution operator can change the code the token lands in.**
  `ccdp.md:594-595` already says a compromised Distribution can observe
  credentials; under a neutral client every Google ceremony runs there.
  Content-addressed releases, published hashes and reproducible builds let
  others check what was served; they do not stop a malicious operator from
  serving something else to someone.
- **One client carries every application's quota and reputation.** Google
  applies a new-user authorization rate limit to every client, set by
  "application history, developer reputation, and riskiness". Abuse through
  one integration throttles all of them, and a suspension stops every
  Google ceremony at once.
- **The consent screen says libID.** Applications lose their own branding on
  Google sign-in, which is the price of the application not being the party
  Google releases the token to.

## Options

**Neutral client, top-level redirect, runtime-owned confirmation, digest
profile.** The design above. **Recommended as the option to pursue**, for
Google only, if hiding the address from applications is a goal.

**Neutral client with a popup.** The flow the CCDP rebuild already uses,
with the redirect moved to the Distribution origin. Less disruptive for the
application, but it rests on Google's COOP staying report-only. Acceptable
as a convenience beside the redirect flow, not as the only path.

**Neutral client through FedCM.** Rejected: Google refuses cross-site
iframes, and only Chromium ships it.

**Per-application clients with libID's redirect registered under them.**
Rejected: Google allows it only with a licence to libID's domain, and the
application still owns a client it can ask directly.

**Per-application clients, CCDP as specified.** What PR #13 describes. It
keeps the token out of the application's page but not out of the
application's reach, for the two reasons in "Who learns the address
today". This is the status quo against which the option is measured.

## What would change

Listed, not written; each is a requirement change for its own PR.

- **Roles.** `libid.md`'s roles table: the application operator no longer
  configures a Google OAuth client; libID operates one, and the Distribution
  operator is trusted with Google tokens. `ccdp.md:65` and
  `oauth-bridge.md:22` stop giving the Bridge the Google registration.
- **Redirect.** Google's `redirect_uri` moves from `<bridge>/auth/callback`
  (`oauth-bridge.md:59-61`, `ccdp.md:127`,
  `ts/packages/ceremony/src/ccdp/client/config.ts:57`) to a fixed path on the
  Distribution origin. The Bridge keeps X and GitHub.
- **SP-CLIENT-01 and REQ-COMMON-17.** They become trivial for Google: every
  deployment carries the same client.
- **SP-DELIVERY-01, REQ-COMMON-29 and 30.** Their meaning moves from "an
  authorization response reaches only an origin registered to that client"
  to "the Canonical Runtime returns a result only to the return origin the
  user confirmed". The consent-phishing paragraph of common §12 gains the
  global-consent case and the confirmation screen.
- **Attribution.** `IdentityNames.CeremonyBound` carries the client
  identifier so an operator can tell which application produced a binding
  (`IdentityNames.sol:279-294`); with one client it tells them apart no
  longer. A replacement would be the return origin the user confirmed,
  reported by the runtime. The Consumer cannot check that value, so either
  it is committed where the proof binds it, which changes the Authorization
  Digest's fields, or it is recorded as unauthenticated.
- **REQ-PLAT-03.** Unchanged in substance: the runtime still derives local
  fields from the verified token; what changes is who receives them.
- **The result.** The runtime returns the proof, the digests and, on the
  user's yes, the email; never `userId` in plaintext, which the digest
  profile already stops sending.
- **SDK and Distribution.** A ceremony entry page and a Google callback on
  the Distribution origin, the confirmation screen, first-party ceremony
  state keyed by `state`, and a return navigation; the application side
  loses its Google client configuration and gains a return route.

## Open decisions

- Whether hiding the address from applications is a goal worth moving this
  much trust to libID. The design is feasible; whether it is wanted is a
  product question.
- Whether the confirmation screen asks the wallet to sign for the `target`,
  and what that means for embedded and smart-account wallets.
- Whether the confirmed return origin replaces the client identifier as the
  attribution field, and whether it is committed in the Authorization
  Digest.
- Whether a user-authorized disclosure choice returns once the screen exists.

## Sources

Code and specification, against each repository's `origin/main` on
2026-09-23 unless a revision is named:

- `libid` `ts/packages/claim`: `src/google/claim.ts:53-91`,
  `src/channel.ts:11`, `src/prover/prove.worker.ts:72-75`;
  `ts/apps/demo/src/relay.ts:61-111`.
- `libid` PR #28 at `08c3f3d`: `ts/packages/ceremony/src/platforms/index.ts:89-126`,
  `src/ccdp/client/config.ts:57`. PR #13 at `374035c`: `specs/ccdp.md`
  (65-69, 97-99, 127, 594-595, 762), `specs/oauth-bridge.md` (20-24, 59-61).
- `libid-server-rs` at `origin/main`: `src/routes/mod.rs:101-119`,
  `src/routes/callback.rs:84-96`, `src/artifact/mod.rs:92-107`.
- `specs/libid.md:56,67`; `specs/ceremony-common.md` SP-CLIENT-01,
  SP-DELIVERY-01, REQ-COMMON-17/17C/29/30, §12.
- `libid-contracts` `identity/IdentityNames.sol:279-294`,
  `ceremony/GooglePlatformVerifier.sol:208-210,239`.

Google and browsers, fetched 2026-09-23:

- Google OAuth policies and compliance:
  developers.google.com/identity/protocols/oauth2/policies,
  developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance,
  developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification,
  developers.google.com/terms/api-services-user-data-policy,
  support.google.com/cloud/answer/13463073, /15549049, /7454865, /9028764.
- Endpoint: accounts.google.com/.well-known/openid-configuration,
  developers.google.com/identity/openid-connect/openid-connect,
  developers.google.com/identity/protocols/oauth2/javascript-implicit-flow,
  developers.google.com/identity/gsi/web/reference/js-reference.
- FedCM: developers.google.com/identity/gsi/web/guides/fedcm-migration,
  developer.mozilla.org/en-US/docs/Web/API/FedCM_API,
  github.com/mozilla/standards-positions/issues/618.
- Partitioning: privacysandbox.google.com/cookies/storage-partitioning,
  developer.mozilla.org/en-US/docs/Web/Privacy/Guides/State_Partitioning,
  bugs.webkit.org/show_bug.cgi?id=229814.
- Precedent: docs.metamask.io/embedded-wallets/authentication/social-logins/google/,
  aptos.dev/build/guides/aptos-keyless/introduction, docs.sui.io/sui-stack/zklogin-integration/,
  docs.privy.io/basics/get-started/dashboard/configure-login-methods,
  clerk.com/docs/guides/configure/auth-strategies/social-connections/google,
  auth0.com/docs/authenticate/identity-providers/social-identity-providers/devkeys.
- COOP: `curl -sI` of Google's authorization endpoint and sign-in page,
  signed out, 2026-09-23 (reported by the research; not re-measured).
