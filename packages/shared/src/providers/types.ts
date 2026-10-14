import type { Category, Source, TrustLevel } from "../constants";
import type { AggregatedUsageRow } from "../schemas";

/**
 * Every integration implements this. `since` is rounded down to the start of
 * its local day so each returned day is complete; upserts replace values, so
 * a partial day would otherwise overwrite a complete one.
 */
export interface UsageIntegration {
  readonly source: Source;
  fetchUsage(since: Date, until: Date): Promise<AggregatedUsageRow[]>;
}

export interface ProviderOptions {
  /** IANA timezone used to bucket usage into local days. */
  timeZone: string;
  /** "verified" only when the TokenRank server runs the integration itself. */
  trust: TrustLevel;
  /**
   * Local-only mapping from a provider project / workspace / API key id to a
   * category. Ids are used for lookup and then discarded; never uploaded.
   */
  categoryMap?: Record<string, Category>;
  fetch?: typeof fetch;
  userAgent?: string;
  /** Called after each HTTP page; useful for progress output. */
  onProgress?: (message: string) => void;
}

export interface OrgIdentity {
  /** Raw provider org id. Callers must hash it immediately (see orgFingerprintInput). */
  orgId: string | null;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
