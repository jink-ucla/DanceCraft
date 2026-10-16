/**
 * BEFORE baseline scorer: frozen copies of src/scoring/** (HEAD 7aebdba) and the live
 * difficulty configs, so the original behaviour stays reproducible after src/ changes:
 *
 *   npx tsx scripts/scoring-lab/run.ts --scorer scripts/scoring-lab/baseline/scorer.ts --live
 *
 * The files under ./scoring are verbatim copies. Do not edit them.
 */
import type { LiveDeps } from '../live'
import { DANCE_MODE_KEYPOSE_OPTIONS } from '../live'
import { computePostDanceScore } from './scoring/dtw'
import { comparePoses, compareMoveVelocity } from './scoring/comparison'
import { checkPresence } from './scoring/presence'
import { MovementTracker } from './scoring/movement'
import { detectKeyPoses } from './scoring/keyPoseDetection'
import { BASELINE_DIFFICULTY_CONFIGS } from './difficulty'

export const name = 'baseline (frozen src/scoring @ 7aebdba)'

export { computePostDanceScore }

export const recordPolicy = 'presence'

export const liveDeps: LiveDeps = {
  detectKeyPoses,
  comparePoses,
  compareMoveVelocity,
  checkPresence,
  createMovementTracker: () => new MovementTracker(),
  difficultyConfigs: BASELINE_DIFFICULTY_CONFIGS,
  keyPoseOptions: DANCE_MODE_KEYPOSE_OPTIONS,
}
