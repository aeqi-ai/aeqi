/**
 * Parse a runtime error string into a humane shape for the chat error bubble.
 *
 * The runtime emits raw upstream errors verbatim (OpenRouter/DeepInfra JSON,
 * generic JSON-RPC envelopes, plain strings). Rendering those raw is
 * unreadable. This helper recognises the common shapes and lifts the
 * relevant signal to a one-line headline + optional detail + optional hint.
 *
 * Falls through to `headline = content` for unknown shapes so we never lose
 * information.
 */
export interface ParsedError {
  headline: string;
  detail?: string;
  hint?: string;
}

export function parseErrorContent(content: string): ParsedError {
  const text = (content || "").trim();
  if (!text) return { headline: "Something went wrong." };

  const parsed = tryParseEmbeddedJson(text);
  const errObj =
    parsed && typeof parsed === "object" && parsed !== null
      ? ((parsed as Record<string, unknown>).error ?? parsed)
      : null;
  const errMsg = readString(errObj, "message");
  const errCode = readNumber(errObj, "code");
  const errMetadataRaw = readMetadataRaw(errObj);

  // OpenRouter / Anthropic / etc. HTTP envelope:
  //   "OpenRouter API error (429 Too Many Requests): {...}"
  const httpEnvelope = text.match(/^([A-Za-z0-9_ -]+?) (?:API )?error \((\d{3})[^)]*\)/);
  if (httpEnvelope) {
    return parseHttpEnvelope(httpEnvelope[1].trim(), parseInt(httpEnvelope[2], 10), {
      errMsg,
      errMetadataRaw,
    });
  }

  if (errMsg) {
    const codeNote = errCode ? ` (${errCode})` : "";
    return { headline: `${errMsg}${codeNote}` };
  }

  return { headline: text };
}

function tryParseEmbeddedJson(text: string): unknown {
  const braceStart = text.indexOf("{");
  const candidate = braceStart >= 0 ? text.slice(braceStart) : text;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function readString(obj: unknown, key: string): string | null {
  if (!obj || typeof obj !== "object") return null;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" ? v : null;
}

function readNumber(obj: unknown, key: string): number | null {
  if (!obj || typeof obj !== "object") return null;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "number" ? v : null;
}

function readMetadataRaw(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const meta = (obj as Record<string, unknown>).metadata;
  if (!meta || typeof meta !== "object") return null;
  const raw = (meta as Record<string, unknown>).raw;
  return typeof raw === "string" ? raw : null;
}

function parseHttpEnvelope(
  provider: string,
  status: number,
  ctx: { errMsg: string | null; errMetadataRaw: string | null },
): ParsedError {
  const { errMsg, errMetadataRaw } = ctx;
  const modelMatch = errMetadataRaw?.match(/([\w./:-]+)\s+is\s+(?:temporarily\s+)?rate-limited/i);
  const modelName = modelMatch ? modelMatch[1] : null;

  if (status === 429) {
    return {
      headline: "Upstream is rate-limited",
      detail: modelName ? `${provider} returned 429 for ${modelName}` : `${provider} returned 429`,
      hint: "Retrying or add your own OpenRouter key in Settings → Integrations",
    };
  }
  if (status === 401 || status === 403) {
    return {
      headline: "Upstream rejected the request",
      detail: `${provider} returned ${status}${errMsg ? `: ${errMsg}` : ""}`,
      hint: "Check the API key in Settings → Integrations",
    };
  }
  if (status === 402) {
    return {
      headline: "Upstream is out of credit",
      detail: `${provider} returned 402${errMsg ? `: ${errMsg}` : ""}`,
      hint: "Add credit or switch provider in Settings → Integrations",
    };
  }
  if (status === 408 || status === 504) {
    return {
      headline: "Upstream timed out",
      detail: `${provider} returned ${status}`,
      hint: "Retrying — if this persists try a different model",
    };
  }
  if (status >= 500) {
    return {
      headline: "Upstream service is down",
      detail: `${provider} returned ${status}${errMsg ? `: ${errMsg}` : ""}`,
      hint: "Try again in a moment or switch model",
    };
  }
  if (status >= 400) {
    return { headline: `${provider} returned ${status}`, detail: errMsg ?? undefined };
  }
  return { headline: `${provider} returned ${status}` };
}
