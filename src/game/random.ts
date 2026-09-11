/**
 * Seeded pseudo-random numbers (mulberry32) as pure functions of a 32-bit state, so the
 * random state can live inside plain, comparable game state. Never use Math.random in
 * src/game: the same seed must always produce the same round.
 */

/** One draw: the value and the state to use for the next draw. */
export interface RandomDraw {
  readonly value: number;
  readonly state: number;
}

/** Convert any number to a valid unsigned 32-bit seed. Non-finite values become 0. */
export function normalizeSeed(seed: number): number {
  return Number.isFinite(seed) ? seed >>> 0 : 0;
}

/** Next unsigned 32-bit integer (mulberry32). */
export function randomUint32(state: number): RandomDraw {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = Math.imul(next ^ (next >>> 15), next | 1);
  t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
  return { value: (t ^ (t >>> 14)) >>> 0, state: next };
}

/** Next float in [0, 1). */
export function randomFloat(state: number): RandomDraw {
  const draw = randomUint32(state);
  return { value: draw.value / 4294967296, state: draw.state };
}

/**
 * The state of the seed stream used by restart() to derive the next round's seed. It is
 * separate from the obstacle stream so that obstacle generation cannot affect it.
 */
export function seedStreamState(seed: number): number {
  return (normalizeSeed(seed) ^ 0x9e3779b9) >>> 0;
}

/**
 * A fresh, non-deterministic seed from `crypto.getRandomValues`. Used only when the caller
 * does not pass a seed; the round itself stays deterministic for that seed.
 */
export function createRandomSeed(): number {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return buffer[0] ?? 0;
}
