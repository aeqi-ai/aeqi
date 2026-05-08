import { useState, useEffect } from "react";

/**
 * Welcome — combined sign-in / sign-up entry point. Per the canonical
 * "every user = a Company" model, there is no separate signup vs login
 * flow: a user authenticates (passkey, Phantom/Solana wallet, or email),
 * the server resolves them to a Company (creating one if their auth
 * identity is new), the spawn animates live on-chain, and they land on
 * `/trust/<pubkey>/` inside their Company.
 *
 * Three doors:
 *   - Continue with a Solana wallet — uses `window.solana` (Phantom,
 *     Backpack, Solflare, etc. all inject the same shape). Detected on
 *     mount; surfaced as the recommended option when available.
 *   - Continue with passkey — WebAuthn ceremony; secp256r1-native on
 *     Solana so the passkey IS the on-chain authority. Recommended when
 *     Touch ID / Face ID / Windows Hello is available.
 *   - Continue with email — magic-link / OTP today; the email serves as
 *     the auth identity that resolves to a Company.
 *
 * Companion to `aeqi-platform`'s `/api/solana/companies/create` (smoke
 * server at :9220 by default; override with VITE_AEQI_SOLANA_API).
 */

type Door = "wallet" | "passkey" | "email";

/**
 * Standard shape exposed by Phantom, Backpack, Solflare, and any other
 * Solana Wallet Standard provider on `window.solana`. Only the methods
 * we actually call are typed; extra properties exist on real providers
 * and that's fine.
 */
interface WalletProvider {
  isPhantom?: boolean;
  isBackpack?: boolean;
  connect: () => Promise<{ publicKey: { toString: () => string } }>;
  signMessage: (message: Uint8Array, encoding?: "utf8") => Promise<{ signature: Uint8Array }>;
}

/**
 * Base64url encode/decode for WebAuthn buffer fields. WebAuthn-rs
 * serializes byte fields as base64url strings; the browser's
 * `navigator.credentials.create()` / `.get()` expect ArrayBuffer for
 * those same fields. These helpers bridge.
 */
function b64uEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64uDecode(s: string): Uint8Array<ArrayBuffer> {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  const decoded = atob(padded + "=".repeat(padLen));
  // Explicit ArrayBuffer (not SharedArrayBuffer) so the result narrows
  // to Uint8Array<ArrayBuffer>, which is what BufferSource expects.
  const bytes = new Uint8Array(new ArrayBuffer(decoded.length));
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
  return bytes;
}

/**
 * Walk the `publicKey` field of a WebAuthn-rs CreationChallengeResponse
 * (returned as JSON) and convert all base64url byte fields into
 * `BufferSource` (Uint8Array) so the browser API accepts it.
 */
function decodeCreateOptions(ccr: Record<string, unknown>): PublicKeyCredentialCreationOptions {
  const pk = (ccr.publicKey ?? ccr) as Record<string, unknown>;
  const user = pk.user as Record<string, unknown>;
  const excludeRaw = (pk.excludeCredentials ?? []) as Array<{
    id: string;
    type: string;
    transports?: AuthenticatorTransport[];
  }>;
  return {
    challenge: b64uDecode(pk.challenge as string),
    rp: pk.rp as PublicKeyCredentialRpEntity,
    user: {
      id: b64uDecode(user.id as string),
      name: user.name as string,
      displayName: user.displayName as string,
    },
    pubKeyCredParams: pk.pubKeyCredParams as PublicKeyCredentialParameters[],
    timeout: pk.timeout as number | undefined,
    attestation: pk.attestation as AttestationConveyancePreference | undefined,
    authenticatorSelection: pk.authenticatorSelection as AuthenticatorSelectionCriteria | undefined,
    excludeCredentials: excludeRaw.map((c) => ({
      id: b64uDecode(c.id),
      type: "public-key" as const,
      transports: c.transports,
    })),
  };
}

/**
 * Walk a WebAuthn-rs RequestChallengeResponse and convert byte fields
 * the same way as `decodeCreateOptions` but for the assertion shape.
 */
function decodeRequestOptions(rcr: Record<string, unknown>): PublicKeyCredentialRequestOptions {
  const pk = (rcr.publicKey ?? rcr) as Record<string, unknown>;
  const allowRaw = (pk.allowCredentials ?? []) as Array<{
    id: string;
    type: string;
    transports?: AuthenticatorTransport[];
  }>;
  return {
    challenge: b64uDecode(pk.challenge as string),
    rpId: pk.rpId as string | undefined,
    timeout: pk.timeout as number | undefined,
    userVerification: pk.userVerification as UserVerificationRequirement | undefined,
    allowCredentials: allowRaw.map((c) => ({
      id: b64uDecode(c.id),
      type: "public-key" as const,
      transports: c.transports,
    })),
  };
}

/**
 * Pack a registration credential (returned by navigator.credentials.create())
 * into the JSON shape webauthn-rs's `RegisterPublicKeyCredential` expects.
 */
function encodeRegistrationCredential(cred: PublicKeyCredential) {
  const att = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id,
    rawId: b64uEncode(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: b64uEncode(att.clientDataJSON),
      attestationObject: b64uEncode(att.attestationObject),
    },
    extensions: cred.getClientExtensionResults?.() ?? {},
  };
}

/**
 * Pack an assertion credential (from navigator.credentials.get()) into
 * the shape webauthn-rs's `PublicKeyCredential` expects.
 */
function encodeAssertionCredential(cred: PublicKeyCredential) {
  const ass = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: b64uEncode(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: b64uEncode(ass.clientDataJSON),
      authenticatorData: b64uEncode(ass.authenticatorData),
      signature: b64uEncode(ass.signature),
      userHandle: ass.userHandle ? b64uEncode(ass.userHandle) : null,
    },
    extensions: cred.getClientExtensionResults?.() ?? {},
  };
}

/**
 * Base58 encoder. Bitcoin alphabet (matches Solana). Pulled inline so
 * we don't pay a wallet-adapter dep just for a 30-line helper.
 */
function base58Encode(bytes: Uint8Array): string {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      const v = digits[j] * 256 + carry;
      digits[j] = v % 58;
      carry = Math.floor(v / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = "";
  for (let i = 0; i < zeros; i++) out += "1";
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}

export type WelcomeMode = "signup" | "login" | "welcome";

interface WelcomeCopy {
  title: string;
  subtitle: string;
  emailButton: string;
  sideTitle: string;
  foot: string;
}

const COPY: Record<WelcomeMode, WelcomeCopy> = {
  signup: {
    title: "Start your company.",
    subtitle: "Three seconds. One signer. Your TRUST is on-chain before you blink.",
    emailButton: "Sign up →",
    sideTitle: "What you get in 3 seconds",
    foot: "One Company per identity. Sign in with any method later — we resolve to the same on-chain TRUST.",
  },
  login: {
    title: "Welcome back.",
    subtitle:
      "Sign in with your wallet, passkey, or email — same Company, same on-chain authority.",
    emailButton: "Sign in →",
    sideTitle: "Pick up where you left off",
    foot: "First time here? Same flow — we'll spawn your Company on the spot.",
  },
  welcome: {
    title: "Welcome to aeqi.",
    subtitle:
      "Continue with your wallet, passkey, or email. The system figures out new vs returning.",
    emailButton: "Continue →",
    sideTitle: "What you get in 3 seconds",
    foot: "One Company per identity. Sign in with any method later — we resolve to the same on-chain TRUST.",
  },
};

interface SpawnResponse {
  company_id: string;
  trust_id_hex: string;
  trust_pubkey_b58: string;
  authority_pubkey_b58: string;
  already_existed: boolean;
  create_signature_b58: string | null;
  role_init_signature_b58: string | null;
  token_init_signature_b58: string | null;
  governance_init_signature_b58: string | null;
  role_module_pda_b58: string;
  token_module_pda_b58: string;
  governance_module_pda_b58: string;
  role_module_state_pda_b58: string;
  token_module_state_pda_b58: string;
  governance_module_state_pda_b58: string;
}

interface SpawnStep {
  key: string;
  label: string;
  detail?: string;
  status: "pending" | "active" | "done";
}

const SOLANA_API_URL =
  (import.meta.env.VITE_AEQI_SOLANA_API as string | undefined) ?? "http://127.0.0.1:9220";

const SOLSCAN_BASE =
  (import.meta.env.VITE_SOLSCAN_BASE as string | undefined) ?? "https://solscan.io";

const SOLSCAN_CLUSTER = (import.meta.env.VITE_SOLSCAN_CLUSTER as string | undefined) ?? "custom";

function solscanLink(kind: "tx" | "account", value: string): string {
  const path = kind === "tx" ? "tx" : "account";
  if (SOLSCAN_CLUSTER === "mainnet" || SOLSCAN_CLUSTER === "") {
    return `${SOLSCAN_BASE}/${path}/${value}`;
  }
  return `${SOLSCAN_BASE}/${path}/${value}?cluster=${SOLSCAN_CLUSTER}`;
}

export default function WelcomePage({ mode = "welcome" }: { mode?: WelcomeMode } = {}) {
  const copy = COPY[mode];
  const [stage, setStage] = useState<"door" | "spawning" | "welcome" | "error">("door");
  const [picked, setPicked] = useState<Door | null>(null);
  const [email, setEmail] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SpawnResponse | null>(null);
  const [steps, setSteps] = useState<SpawnStep[]>([]);
  const [walletDetected, setWalletDetected] = useState<{
    name: string;
    icon?: string;
  } | null>(null);
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);

  // Detect installed Solana wallet (Phantom, Backpack, Solflare,
  // any Wallet Standard provider) on mount.
  useEffect(() => {
    const w = (
      window as unknown as {
        solana?: { isPhantom?: boolean; isBackpack?: boolean };
        backpack?: unknown;
        solflare?: { isSolflare?: boolean };
      }
    ).solana;
    if (w?.isPhantom) setWalletDetected({ name: "Phantom", icon: "👻" });
    else if (w?.isBackpack) setWalletDetected({ name: "Backpack", icon: "🎒" });
    else if ((window as unknown as { solflare?: unknown }).solflare)
      setWalletDetected({ name: "Solflare", icon: "🔥" });
    else if (w) setWalletDetected({ name: "Solana wallet" });

    // Detect platform authenticator (Touch ID / Face ID / Windows Hello).
    if (window.PublicKeyCredential) {
      window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
        .then((avail) => setPasskeyAvailable(avail))
        .catch(() => setPasskeyAvailable(false));
    }

    document.title =
      mode === "login" ? "Sign in · aeqi" : mode === "signup" ? "Sign up · aeqi" : "Welcome · aeqi";
  }, [mode]);

  function buildSteps(): SpawnStep[] {
    return [
      {
        key: "auth",
        label: "Identity confirmed",
        status: "done",
      },
      {
        key: "wallet",
        label: "Provisioning your Solana wallet",
        status: "active",
      },
      {
        key: "trust",
        label: "Deploying your Company on Solana",
        status: "pending",
      },
      {
        key: "role",
        label: "Role module initialized",
        status: "pending",
      },
      {
        key: "token",
        label: "Token module initialized",
        status: "pending",
      },
      {
        key: "governance",
        label: "Governance module initialized",
        status: "pending",
      },
    ];
  }

  function advanceStep(idx: number, detail?: string) {
    setSteps((prev) =>
      prev.map((s, i) => {
        if (i < idx) return { ...s, status: "done" as const };
        if (i === idx) return { ...s, status: "active" as const, detail: detail ?? s.detail };
        return s;
      }),
    );
  }

  async function animateSpawn(data: SpawnResponse) {
    setOutcome(data);
    const trustPda = data.trust_pubkey_b58;
    // Returning users (already_existed:true) skip the long animation
    // since nothing was actually spawned — flash through the steps and
    // land on welcome. New users get the full ~2s motion to make the
    // on-chain spawn feel real.
    const tick = data.already_existed ? 120 : 450;
    const advanceWith = async (idx: number, detail?: string) => {
      await new Promise((r) => setTimeout(r, tick));
      advanceStep(idx, detail);
    };
    await advanceWith(2, trustPda);
    await advanceWith(3, data.role_init_signature_b58 ?? undefined);
    await advanceWith(4, data.token_init_signature_b58 ?? undefined);
    await advanceWith(5, data.governance_init_signature_b58 ?? undefined);
    await new Promise((r) => setTimeout(r, tick));
    setSteps((prev) => prev.map((s) => ({ ...s, status: "done" as const })));
    await new Promise((r) => setTimeout(r, 300));
    setStage("welcome");
  }

  /**
   * Wallet path: real SIWS — Sign-In With Solana.
   *
   *   1. POST /api/auth/welcome/wallet-start with the wallet pubkey →
   *      get back a server-issued nonce + the canonical message text.
   *   2. Hand the message to `wallet.signMessage()`. Phantom / Backpack /
   *      Solflare all expose the same shape — they pop a confirmation
   *      to the user displaying the message text, then return a 64-byte
   *      ed25519 signature.
   *   3. POST /api/auth/welcome/wallet-verify with the pubkey + message
   *      + signature. Server runs ed25519 verify (cryptographic gate),
   *      consumes the nonce (replay protection), resolves auth_methods
   *      (returning user) or creates a new Company (first time), mints
   *      JWT bound to company_id, kind=wallet_siws.
   *   4. Persist JWT to localStorage and animate the spawn.
   *
   * Same email-style auth_methods resolution as the email path — the
   * wallet's pubkey is the canonical identity for kind=wallet_siws.
   * Same wallet on a second sign-in returns the same Company forever.
   */
  async function spawnViaWalletSiws(provider: WalletProvider, walletPubkey: string) {
    setStage("spawning");
    setErrorMsg(null);
    setSteps(buildSteps());
    try {
      // Stage 1: get challenge.
      const startRes = await fetch(`${SOLANA_API_URL}/api/auth/welcome/wallet-start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet_pubkey: walletPubkey }),
      });
      if (!startRes.ok) {
        throw new Error(`wallet-start ${startRes.status}: ${await startRes.text()}`);
      }
      const start = (await startRes.json()) as {
        wallet_pubkey: string;
        nonce: string;
        message: string;
        expires_at: string;
      };

      // Stage 2: ask the wallet to sign. Phantom & friends expose
      // signMessage(Uint8Array, "utf8") returning { signature: Uint8Array }.
      const encoded = new TextEncoder().encode(start.message);
      const signed = await provider.signMessage(encoded, "utf8");
      const signatureBytes = signed.signature;
      const signatureB58 = base58Encode(signatureBytes);

      // Stage 3: verify on the server.
      const verifyRes = await fetch(`${SOLANA_API_URL}/api/auth/welcome/wallet-verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet_pubkey: walletPubkey,
          message: start.message,
          signature_b58: signatureB58,
        }),
      });
      if (!verifyRes.ok) {
        throw new Error(`wallet-verify ${verifyRes.status}: ${await verifyRes.text()}`);
      }
      const verify = (await verifyRes.json()) as SpawnResponse & {
        session_jwt: string;
        session_expires_at: string;
      };

      try {
        localStorage.setItem("aeqi_session_jwt", verify.session_jwt);
        localStorage.setItem("aeqi_session_company_id", verify.company_id);
        localStorage.setItem("aeqi_session_expires_at", verify.session_expires_at);
      } catch {
        // Safari private mode etc. — non-fatal.
      }

      await animateSpawn(verify);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(msg);
      setStage("error");
    }
  }

  /**
   * Email path: real auth via magic link.
   *
   *   1. POST /api/auth/welcome/email-start with the email
   *   2. Smoke server returns the magic_link_url directly (real prod
   *      sends via SMTP and omits the URL); we auto-follow in dev so
   *      the demo doesn't require an inbox
   *   3. GET that URL → /api/auth/welcome/email-verify which:
   *      - resolves the email via auth_methods (returning user) OR
   *        creates a new Company + spawns TRUST + persists auth_method
   *      - mints a JWT bound to company_id
   *   4. We persist the JWT to localStorage and animate the spawn
   */
  async function spawnViaEmailMagicLink(email: string) {
    setStage("spawning");
    setErrorMsg(null);
    setSteps(buildSteps());
    try {
      const startRes = await fetch(`${SOLANA_API_URL}/api/auth/welcome/email-start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!startRes.ok) {
        const body = await startRes.text();
        throw new Error(`email-start ${startRes.status}: ${body}`);
      }
      const start = (await startRes.json()) as {
        email: string;
        expires_at: string;
        magic_link_url?: string;
      };
      if (!start.magic_link_url) {
        // Real prod path: tell the user to check their inbox.
        throw new Error(
          "Magic link sent — check your email. (Auto-follow disabled in this build.)",
        );
      }
      const verifyRes = await fetch(start.magic_link_url);
      if (!verifyRes.ok) {
        const body = await verifyRes.text();
        throw new Error(`email-verify ${verifyRes.status}: ${body}`);
      }
      const verify = (await verifyRes.json()) as SpawnResponse & {
        session_jwt: string;
        session_expires_at: string;
      };
      // Persist the session. Future API calls attach `Authorization:
      // Bearer ${jwt}` and the platform resolves the company from sub.
      try {
        localStorage.setItem("aeqi_session_jwt", verify.session_jwt);
        localStorage.setItem("aeqi_session_company_id", verify.company_id);
        localStorage.setItem("aeqi_session_expires_at", verify.session_expires_at);
      } catch {
        // Safari private mode etc. — non-fatal; session lives in memory only.
      }
      await animateSpawn(verify);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(msg);
      setStage("error");
    }
  }

  async function handleWalletConnect() {
    setPicked("wallet");
    const provider = (window as unknown as { solana?: WalletProvider }).solana;
    if (!provider) {
      setErrorMsg("No Solana wallet detected. Install Phantom, Backpack, or Solflare.");
      setStage("error");
      return;
    }
    try {
      const resp = await provider.connect();
      const pk = resp.publicKey.toString();
      await spawnViaWalletSiws(provider, pk);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(msg);
      setStage("error");
    }
  }

  /**
   * Passkey path: real WebAuthn ceremony.
   *
   * Tries assertion first (returning user's existing passkey for this rp_id).
   * On NotAllowedError or no-credential / aborted, falls back to registration
   * (new authenticator). Either path resolves through auth_methods on the
   * server and lands on the same spawn animation.
   */
  async function handlePasskey() {
    setPicked("passkey");
    if (!window.PublicKeyCredential) {
      setErrorMsg("This browser doesn't support WebAuthn. Try Chrome, Safari, Edge, or Firefox.");
      setStage("error");
      return;
    }
    setStage("spawning");
    setErrorMsg(null);
    setSteps(buildSteps());

    try {
      // Try ASSERTION first — covers the returning-user case where the
      // browser's authenticator already has a credential for our rp_id.
      const startRes = await fetch(`${SOLANA_API_URL}/api/auth/welcome/passkey-assert-start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!startRes.ok) {
        const body = await startRes.text();
        throw new Error(`assert-start ${startRes.status}: ${body}`);
      }
      const start = (await startRes.json()) as {
        ceremony_id: string;
        challenge: Record<string, unknown>;
      };
      const requestOptions = decodeRequestOptions(start.challenge);

      let assertion: PublicKeyCredential | null = null;
      try {
        assertion = (await navigator.credentials.get({
          publicKey: requestOptions,
        })) as PublicKeyCredential | null;
      } catch (e) {
        // NotAllowedError / no-credential — fall through to registration.
        if ((e as DOMException)?.name !== "NotAllowedError") {
          throw e;
        }
      }

      if (assertion) {
        const verifyRes = await fetch(`${SOLANA_API_URL}/api/auth/welcome/passkey-assert-finish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ceremony_id: start.ceremony_id,
            credential: encodeAssertionCredential(assertion),
          }),
        });
        if (verifyRes.ok) {
          const verify = (await verifyRes.json()) as SpawnResponse & {
            session_jwt: string;
            session_expires_at: string;
          };
          persistSession(verify);
          await animateSpawn(verify);
          return;
        }
        // Server rejected (credential not registered, expired, etc.) —
        // fall through to registration so the user still lands somewhere.
      }

      // REGISTRATION path: first-time user, or assertion gave us nothing.
      const regStartRes = await fetch(`${SOLANA_API_URL}/api/auth/welcome/passkey-register-start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!regStartRes.ok) {
        const body = await regStartRes.text();
        throw new Error(`register-start ${regStartRes.status}: ${body}`);
      }
      const regStart = (await regStartRes.json()) as {
        ceremony_id: string;
        challenge: Record<string, unknown>;
      };
      const createOptions = decodeCreateOptions(regStart.challenge);

      const registration = (await navigator.credentials.create({
        publicKey: createOptions,
      })) as PublicKeyCredential | null;
      if (!registration) {
        throw new Error("authenticator did not return a credential");
      }

      const finishRes = await fetch(`${SOLANA_API_URL}/api/auth/welcome/passkey-register-finish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ceremony_id: regStart.ceremony_id,
          credential: encodeRegistrationCredential(registration),
        }),
      });
      if (!finishRes.ok) {
        throw new Error(`register-finish ${finishRes.status}: ${await finishRes.text()}`);
      }
      const finish = (await finishRes.json()) as SpawnResponse & {
        session_jwt: string;
        session_expires_at: string;
      };
      persistSession(finish);
      await animateSpawn(finish);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(msg);
      setStage("error");
    }
  }

  function persistSession(s: {
    session_jwt: string;
    company_id: string;
    session_expires_at: string;
  }) {
    try {
      localStorage.setItem("aeqi_session_jwt", s.session_jwt);
      localStorage.setItem("aeqi_session_company_id", s.company_id);
      localStorage.setItem("aeqi_session_expires_at", s.session_expires_at);
    } catch {
      // Safari private mode etc. — non-fatal.
    }
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setPicked("email");
    await spawnViaEmailMagicLink(email.trim().toLowerCase());
  }

  function reset() {
    setStage("door");
    setPicked(null);
    setErrorMsg(null);
    setOutcome(null);
    setSteps([]);
  }

  if (stage === "spawning") return <SpawningView steps={steps} picked={picked} />;

  if (stage === "welcome" && outcome) return <WelcomeView outcome={outcome} onContinue={reset} />;

  if (stage === "error")
    return <ErrorView message={errorMsg ?? "Something went wrong."} onBack={reset} />;

  // stage === "door"
  return (
    <main className="welcome-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div className="welcome-pane" id="main-content">
        <div className="welcome-mark">æ</div>
        <h1 className="welcome-headline">{copy.title}</h1>
        <p className="welcome-subhead">{copy.subtitle}</p>

        <div className="welcome-doors">
          {walletDetected && (
            <button
              type="button"
              className="welcome-door welcome-door--recommended"
              onClick={handleWalletConnect}
            >
              <span className="welcome-door-icon" aria-hidden="true">
                {walletDetected.icon ?? "◎"}
              </span>
              <span className="welcome-door-body">
                <span className="welcome-door-title">Continue with {walletDetected.name}</span>
                <span className="welcome-door-detail">
                  Sign once. Your wallet pubkey is your Company authority.
                </span>
              </span>
              <span className="welcome-door-chev" aria-hidden="true">
                →
              </span>
            </button>
          )}

          {!walletDetected && (
            <div className="welcome-door welcome-door--hint" aria-hidden="true">
              <span className="welcome-door-icon">◎</span>
              <span className="welcome-door-body">
                <span className="welcome-door-title">No Solana wallet detected</span>
                <span className="welcome-door-detail">
                  Phantom · Backpack · Solflare · Glow — install any to use it as your signer.
                </span>
              </span>
            </div>
          )}

          <button
            type="button"
            className={`welcome-door ${
              passkeyAvailable && !walletDetected ? "welcome-door--recommended" : ""
            }`}
            onClick={handlePasskey}
          >
            <span className="welcome-door-icon" aria-hidden="true">
              ⌥
            </span>
            <span className="welcome-door-body">
              <span className="welcome-door-title">
                One-touch with passkey
                {passkeyAvailable && <span className="welcome-door-tag"> · Touch ID ready</span>}
              </span>
              <span className="welcome-door-detail">
                Non-custodial. Your passkey IS the Solana authority via secp256r1.
              </span>
            </span>
            <span className="welcome-door-chev" aria-hidden="true">
              →
            </span>
          </button>

          <form className="welcome-door welcome-door--email" onSubmit={handleEmailSubmit}>
            <span className="welcome-door-icon" aria-hidden="true">
              @
            </span>
            <span className="welcome-door-body">
              <label className="welcome-door-title" htmlFor="welcome-email">
                Continue with email
              </label>
              <input
                id="welcome-email"
                className="welcome-door-input"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </span>
            <button type="submit" className="welcome-door-submit">
              {copy.emailButton}
            </button>
          </form>
        </div>

        <p className="welcome-foot">{copy.foot}</p>
      </div>

      <aside className="welcome-side">
        <div className="welcome-side-inner">
          <h2 className="welcome-side-title">{copy.sideTitle}</h2>
          <ul className="welcome-side-list">
            <li>
              <span className="welcome-side-step">01</span>
              <span>
                <strong>Your TRUST.</strong> A Solana smart account with role graph, treasury, and
                governance — yours from the second you land.
              </span>
            </li>
            <li>
              <span className="welcome-side-step">02</span>
              <span>
                <strong>Your authority.</strong> Your wallet, your passkey, or your email-bound
                custodial keypair — your call. Rotate anytime without losing the Company.
              </span>
            </li>
            <li>
              <span className="welcome-side-step">03</span>
              <span>
                <strong>Your stack.</strong> Cap table (Token-2022), org chart (roles), governance
                (proposals + voting) — all deployed atomically.
              </span>
            </li>
          </ul>
          <p className="welcome-side-foot">
            Powered by <span className="welcome-side-brand">aeqi</span> on Solana
          </p>
        </div>
      </aside>
    </main>
  );
}

// ── Spawning view ─────────────────────────────────────────────────────────

function SpawningView({ steps, picked }: { steps: SpawnStep[]; picked: Door | null }) {
  const pickedLabel =
    picked === "wallet" ? "your wallet" : picked === "passkey" ? "your passkey" : "your email";
  return (
    <main className="welcome-shell welcome-shell--solo">
      <div className="welcome-pane welcome-pane--center">
        <div className="welcome-mark welcome-mark--lg">æ</div>
        <h1 className="welcome-spawn-title">Welcome to your Company.</h1>
        <p className="welcome-spawn-sub">
          Authenticated with {pickedLabel}. Spawning your TRUST on Solana now.
        </p>
        <ol className="welcome-spawn-list">
          {steps.map((s) => (
            <li key={s.key} className={`welcome-spawn-step welcome-spawn-step--${s.status}`}>
              <span className="welcome-spawn-marker" aria-hidden="true">
                {s.status === "done" ? "✓" : s.status === "active" ? "•" : "·"}
              </span>
              <span className="welcome-spawn-label">{s.label}</span>
              {s.detail && (
                <span className="welcome-spawn-detail">
                  {s.detail.length > 24
                    ? `${s.detail.slice(0, 8)}…${s.detail.slice(-6)}`
                    : s.detail}
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}

// ── Welcome (post-spawn) view ─────────────────────────────────────────────

function WelcomeView({ outcome, onContinue }: { outcome: SpawnResponse; onContinue: () => void }) {
  const trustShort = `${outcome.trust_pubkey_b58.slice(
    0,
    6,
  )}…${outcome.trust_pubkey_b58.slice(-4)}`;
  const authorityShort = `${outcome.authority_pubkey_b58.slice(
    0,
    6,
  )}…${outcome.authority_pubkey_b58.slice(-4)}`;
  return (
    <main className="welcome-shell welcome-shell--solo">
      <div className="welcome-pane welcome-pane--center">
        <div className="welcome-mark welcome-mark--lg welcome-mark--success">✓</div>
        <h1 className="welcome-spawn-title">Your Company is live.</h1>
        <p className="welcome-spawn-sub">
          {outcome.already_existed
            ? "Welcome back — your TRUST is exactly where you left it."
            : "Authority pubkey + role + token + governance modules are on-chain."}
        </p>

        <dl className="welcome-summary">
          <div className="welcome-summary-row">
            <dt>TRUST</dt>
            <dd>
              <a
                href={solscanLink("account", outcome.trust_pubkey_b58)}
                target="_blank"
                rel="noopener noreferrer"
                className="welcome-summary-link"
              >
                {trustShort} ↗
              </a>
            </dd>
          </div>
          <div className="welcome-summary-row">
            <dt>Authority</dt>
            <dd>
              <a
                href={solscanLink("account", outcome.authority_pubkey_b58)}
                target="_blank"
                rel="noopener noreferrer"
                className="welcome-summary-link"
              >
                {authorityShort} ↗
              </a>
            </dd>
          </div>
        </dl>

        <div className="welcome-cta-row">
          <button
            type="button"
            className="welcome-cta welcome-cta--primary"
            onClick={() => {
              window.location.assign(`/trust/${outcome.trust_pubkey_b58}/`);
            }}
          >
            Enter your Company →
          </button>
          <button type="button" className="welcome-cta welcome-cta--secondary" onClick={onContinue}>
            Add a backup signer
          </button>
        </div>

        <p className="welcome-spawn-foot">
          Tip: add a second signer (passkey on another device, hardware key) so you never lose
          access.
        </p>
      </div>
    </main>
  );
}

// ── Error view ────────────────────────────────────────────────────────────

function ErrorView({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <main className="welcome-shell welcome-shell--solo">
      <div className="welcome-pane welcome-pane--center">
        <div className="welcome-mark welcome-mark--lg">·</div>
        <h1 className="welcome-spawn-title">That didn't work.</h1>
        <p className="welcome-spawn-sub welcome-spawn-sub--err">{message}</p>
        <div className="welcome-cta-row">
          <button type="button" className="welcome-cta welcome-cta--primary" onClick={onBack}>
            Try again
          </button>
        </div>
      </div>
    </main>
  );
}
