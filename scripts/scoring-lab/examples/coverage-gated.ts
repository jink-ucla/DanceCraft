/**
 * EXAMPLE candidate scorer (demonstrates the lab interface; not a proposal).
 * Wraps the frozen legacy computePostDanceScore and multiplies by the fraction of the dance
 * covered by recorded user frames. Shows the 4th argument: `options.referenceGeometry` (what the
 * app will pass) and `options.lab` (lab-only diagnostics — never use it to compute the score; here
 * it is only echoed as a diagnostic field). Extra fields (`coverage`, `geometry`) show up with
 * --show coverage,geometry and in --json output.
 *
 *   npx tsx scripts/scoring-lab/run.ts --scorer scripts/scoring-lab/examples/coverage-gated.ts --show coverage,geometry
 */
import type { ScoreFn } from '../scorer'
import { computePostDanceScore, computeRank } from '../baseline/scoring/dtw'

export const name = 'example: legacy scorer x coverage'

/** How DanceMode records user poses for this candidate (same as DanceMode @ 7aebdba). */
export const recordPolicy = 'presence'

export const score: ScoreFn = (reference, user, sectionDuration = 10, options) => {
  const base = computePostDanceScore(reference, user, sectionDuration)
  // Production-safe: the dance duration comes from the reference itself, not options.lab
  const duration = reference[reference.length - 1]?.time ?? 0
  const span = user.length > 1 ? user[user.length - 1].time - user[0].time : 0
  const coverage = duration > 0 ? Math.min(1, span / duration) : 0
  const overallScore = base.overallScore * coverage
  const geo = options?.referenceGeometry
  return {
    ...base,
    overallScore,
    rank: computeRank(overallScore),
    coverage,
    geometry: geo ? `${geo.width}x${geo.height}` : 'none',
    labDuration: options?.lab?.danceDuration,
  }
}
