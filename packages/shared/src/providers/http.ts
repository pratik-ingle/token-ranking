import { ProviderError } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * GET JSON with retries on 429/5xx (honouring Retry-After). Error messages
 * contain only the status and the provider's error type, never headers, so
 * an API key can't end up in a log line.
 */
export async function getJson<T>(
  url: string,
  headers: Record<string, string>,
  opts: { fetch?: typeof fetch; retries?: number; baseDelayMs?: number } = {},
): Promise<{ body: T; headers: Headers }> {
  return requestJson<T>("GET", url, headers, undefined, opts);
}

export async function requestJson<T>(
  method: "GET" | "POST",
  url: string,
  headers: Record<string, string>,
  jsonBody: unknown,
  opts: { fetch?: typeof fetch; retries?: number; baseDelayMs?: number } = {},
): Promise<{ body: T; headers: Headers }> {
  const doFetch = opts.fetch ?? fetch;
  const retries = opts.retries ?? 5;
  const base = opts.baseDelayMs ?? 1000;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await doFetch(url, {
        method,
        headers: jsonBody === undefined ? headers : { ...headers, "Content-Type": "application/json" },
        body: jsonBody === undefined ? undefined : JSON.stringify(jsonBody),
      });
    } catch (err) {
      if (attempt >= retries) throw new ProviderError(`network error: ${(err as Error).message}`, null, true);
      await sleep(base * 2 ** attempt);
      continue;
    }
    if (res.ok) return { body: (await res.json()) as T, headers: res.headers };
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < retries) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : base * 2 ** attempt);
      continue;
    }
    let detail = "";
    try {
      const body = (await res.json()) as { error?: { type?: string; code?: string } | string };
      const e = body?.error;
      detail = typeof e === "string" ? "" : (e?.type ?? e?.code ?? "");
    } catch {
      /* ignore */
    }
    const hint =
      res.status === 401 || res.status === 403
        ? " (check that this is an organization admin key with usage access)"
        : "";
    throw new ProviderError(`HTTP ${res.status}${detail ? ` ${detail}` : ""}${hint}`, res.status, retryable);
  }
}

/** Input to the server-side org fingerprint: sha256(source + ":" + orgId), hex. */
export async function orgFingerprintInput(source: string, orgId: string): Promise<string> {
  const data = new TextEncoder().encode(`${source}:${orgId}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
