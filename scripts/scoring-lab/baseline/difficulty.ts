/**
 * Frozen copy of DIFFICULTY_CONFIGS from src/storage/scores.ts (HEAD 7aebdba) — the
 * BEFORE live-judging thresholds. Do not edit.
 */
import type { Difficulty, DifficultyConfig } from '../../../src/storage/scores'

export const BASELINE_DIFFICULTY_CONFIGS: Record<Difficulty, DifficultyConfig> = {
  easy: {
    windowBefore: 0.6,
    windowAfter: 0.7,
    perfectThreshold: 0.70,
    goodThreshold: 0.45,
    leadTime: 3.0,
    focusWeight: 2.0,
    nonFocusWeight: 1.0,
  },
  normal: {
    windowBefore: 0.4,
    windowAfter: 0.5,
    perfectThreshold: 0.80,
    goodThreshold: 0.55,
    leadTime: 2.5,
    focusWeight: 3.0,
    nonFocusWeight: 0.5,
  },
  hard: {
    windowBefore: 0.25,
    windowAfter: 0.3,
    perfectThreshold: 0.90,
    goodThreshold: 0.70,
    leadTime: 2.0,
    focusWeight: 5.0,
    nonFocusWeight: 0.3,
  },
}
