/**
 * In-Memory-Rate-Limiter (Sliding Window). Bewusst einfach: ein Prozess,
 * ein Container (Annahme B5). Schlüssel z. B. "login:<ip>".
 * IPs werden nur flüchtig im Speicher gehalten, nie persistiert.
 */
const buckets = new Map<string, number[]>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const cutoff = now - windowMs;
  const timestamps = (buckets.get(key) ?? []).filter((t) => t > cutoff);
  if (timestamps.length >= limit) {
    buckets.set(key, timestamps);
    const retryAfterSeconds = Math.ceil((timestamps[0] + windowMs - now) / 1000);
    return { ok: false, retryAfterSeconds };
  }
  timestamps.push(now);
  buckets.set(key, timestamps);

  // Speicher begrenzen: alte Einträge gelegentlich räumen
  if (buckets.size > 10_000) {
    for (const [k, ts] of buckets) {
      if (ts.every((t) => t <= cutoff)) buckets.delete(k);
    }
  }
  return { ok: true, retryAfterSeconds: 0 };
}

/** Nur für Tests. */
export function resetRateLimits(): void {
  buckets.clear();
}
