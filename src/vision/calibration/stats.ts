/** Linear-interpolation quantile (`q` in 0..1) of the values, or null when empty. */
export function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lowerIndex = Math.floor(position);
  const lower = sorted[lowerIndex] ?? 0;
  const upper = sorted[Math.ceil(position)] ?? lower;
  return lower + (upper - lower) * (position - lowerIndex);
}

/** Median of the values, or null when empty. */
export function median(values: readonly number[]): number | null {
  return quantile(values, 0.5);
}

/**
 * Robust standard deviation from the interquartile range (IQR / 1.349). It ignores up to a
 * quarter of outliers on each side, such as a natural blink during the neutral measurement,
 * and, unlike the median absolute deviation, it does not collapse to 0 for a flickering
 * (bimodal) signal. Null when empty.
 */
export function robustSpread(values: readonly number[]): number | null {
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  return q1 === null || q3 === null ? null : (q3 - q1) / 1.349;
}
