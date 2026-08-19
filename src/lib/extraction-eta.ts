/**
 * Estimate how long an extraction (a single Claude read of one house type) will
 * take, from the durations of past completed extractions. Self-calibrating: the
 * more this project has run, the closer the estimate. Pure + unit-tested.
 *
 * An LLM read is one opaque call — there is no true byte-progress — so the live
 * bar is a time estimate against this figure, never a real percentage.
 */
const FALLBACK_MS = 40_000;
const MIN_MS = 15_000;
const MAX_MS = 120_000;

export function estimateExpectedMs(latencies: number[]): number {
  // Drop sub-3s completions: those are the reuse/cache path, not a real read,
  // and would drag the estimate down so a genuine read looks instant.
  const real = latencies
    .filter((n) => Number.isFinite(n) && n >= 3_000)
    .sort((a, b) => a - b);
  const median = real.length ? real[Math.floor((real.length - 1) / 2)] : FALLBACK_MS;
  // Keep it within a sane band so a single outlier can't make the bar silly.
  return Math.min(MAX_MS, Math.max(MIN_MS, median));
}
