import { describe, expect, it } from "vitest";
import {
  DEFAULT_GAME_CONFIG,
  isObstacleClearable,
  jumpApexHeight,
  resolveGameConfig,
} from "../../src/game";
import {
  createRandomSeed,
  normalizeSeed,
  randomFloat,
  randomUint32,
  seedStreamState,
} from "../../src/game/random";

function sequence(seed: number, count: number): number[] {
  const values: number[] = [];
  let state = seed;
  for (let i = 0; i < count; i += 1) {
    const draw = randomFloat(state);
    values.push(draw.value);
    state = draw.state;
  }
  return values;
}

describe("seeded PRNG", () => {
  it("is deterministic for a seed and differs between seeds", () => {
    expect(sequence(123, 50)).toEqual(sequence(123, 50));
    expect(sequence(123, 50)).not.toEqual(sequence(124, 50));
  });

  it("produces floats in [0, 1) and unsigned 32-bit integers", () => {
    let state = 7;
    for (let i = 0; i < 10_000; i += 1) {
      const draw = randomUint32(state);
      expect(Number.isInteger(draw.value)).toBe(true);
      expect(draw.value).toBeGreaterThanOrEqual(0);
      expect(draw.value).toBeLessThan(2 ** 32);
      state = draw.state;
    }
    for (const value of sequence(99, 10_000)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("is roughly uniform", () => {
    const values = sequence(2024, 20_000);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);
  });

  it("normalises seeds to unsigned 32-bit integers", () => {
    expect(normalizeSeed(42)).toBe(42);
    expect(normalizeSeed(-1)).toBe(0xffffffff);
    expect(normalizeSeed(2 ** 32 + 5)).toBe(5);
    expect(normalizeSeed(3.9)).toBe(3);
    expect(normalizeSeed(Number.NaN)).toBe(0);
    expect(normalizeSeed(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("keeps the seed stream separate from the obstacle stream", () => {
    expect(seedStreamState(5)).not.toBe(5);
    expect(seedStreamState(5)).toBe(seedStreamState(5));
  });

  it("creates random seeds from crypto", () => {
    const seed = createRandomSeed();
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(2 ** 32);
  });
});

describe("game config", () => {
  it("accepts and freezes the defaults", () => {
    const config = resolveGameConfig();
    expect(config).toEqual(DEFAULT_GAME_CONFIG);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(DEFAULT_GAME_CONFIG)).toBe(true);
    expect(DEFAULT_GAME_CONFIG.roundEnd).toBe("all-crashed");
  });

  it("merges overrides", () => {
    const config = resolveGameConfig({ roundEnd: "first-crash", jumpBufferMs: 150 });
    expect(config.roundEnd).toBe("first-crash");
    expect(config.jumpBufferMs).toBe(150);
    expect(config.gravity).toBe(DEFAULT_GAME_CONFIG.gravity);
  });

  it.each([
    ["negative gravity", { gravity: -1 }],
    ["zero jump velocity", { jumpVelocity: 0 }],
    ["NaN speed", { startSpeed: Number.NaN }],
    ["max speed below start speed", { startSpeed: 500, maxSpeed: 400 }],
    ["unknown round-end rule", { roundEnd: "never" as "all-crashed" }],
    ["no obstacle kinds", { obstacleKinds: [] }],
    ["max frame delta below the step", { maxFrameDeltaMs: 1 }],
    ["huge collision inset", { collisionInset: 40 }],
    [
      "an obstacle one jump cannot clear",
      { obstacleKinds: [{ id: "wall", width: 30, height: 200, minSpeed: 0, weight: 1 }] },
    ],
    ["steps long enough to pass through an obstacle", { fixedStepMs: 90, maxFrameDeltaMs: 100 }],
    [
      "no kind available at the start speed",
      { obstacleKinds: [{ id: "late", width: 26, height: 52, minSpeed: 900, weight: 1 }] },
    ],
  ])("rejects %s", (_name, overrides) => {
    expect(() => resolveGameConfig(overrides)).toThrow(RangeError);
  });

  it("only contains obstacle kinds that one jump clears, at every allowed speed", () => {
    const config = DEFAULT_GAME_CONFIG;
    for (const kind of config.obstacleKinds) {
      for (
        let speed = Math.max(config.startSpeed, kind.minSpeed);
        speed <= config.maxSpeed;
        speed += 10
      ) {
        expect(isObstacleClearable(config, kind, speed), `${kind.id} at ${speed}`).toBe(true);
      }
    }
  });

  it("keeps the dinosaur inside its lane at the apex of a jump", () => {
    const config = DEFAULT_GAME_CONFIG;
    expect(jumpApexHeight(config) + config.dinoHeight).toBeLessThan(config.groundY);
  });
});
