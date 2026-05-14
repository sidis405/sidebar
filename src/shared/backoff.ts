// Editor WebSocket reconnect ladder. Per the Failure Modes section of the
// V1 spec: 1s, 2s, 5s, 10s, then capped at 30s for every subsequent attempt.
const LADDER_MS = [1000, 2000, 5000, 10_000] as const;
const CAP_MS = 30_000;

export function nextBackoffMs(attempt: number): number {
  if (attempt < 0) return LADDER_MS[0];
  if (attempt >= LADDER_MS.length) return CAP_MS;
  return LADDER_MS[attempt];
}
