/**
 * keymoment-hits — every tunable parameter in one place. Calibrated on lab seed 1 ONLY
 * (seeds 2 and 3 are reporting seeds). Times in seconds.
 */
export const PARAMS = {
  // --- pose ------------------------------------------------------------------------------------
  /** Bone direction tolerance: s = exp(-(1 - cos theta) / kappa); 0.2 -> 10 deg 0.93, 20 deg 0.74, 30 deg 0.51, 45 deg 0.23 */
  kappa: 0.2,
  /**
   * Bounds of the per-dance zero-credit level (the mean similarity of two unrelated poses of the
   * same dance); static or very short references would otherwise give ~1.
   */
  chanceMin: 0.2,
  chanceMax: 0.7,

  // --- motion ----------------------------------------------------------------------------------
  /** Share of the pose credit kept when the user does not move while the dancer does */
  motionFloor: 0.05,
  /** Motion agreement treated as chance (no credit) — still users reach ~0.05, random flailing ~0.2 */
  motionZero: 0.15,
  /** Motion agreement that earns the full motion factor */
  motionFull: 0.4,
  /** Reference motion (weighted squared direction change) below which a moment is a pause */
  restMotion: 0.08,

  // --- timing ----------------------------------------------------------------------------------
  /** Search window around the lag-shifted moment (move windows are also clipped halfway to the neighbouring moves) */
  window: 0.45,
  /** Free local timing tolerance around the compensated time */
  freeTol: 0.15,
  /** Largest free global latency compensation */
  maxLatency: 0.3,
  /** Timing error beyond the free band costs credit linearly: factor = max(0, 1 - error / timingZero) */
  timingZero: 2,
  /** Step of the global lag search (the range follows from the timing parameters, see lagRange()) */
  lagStep: 0.05,

  // --- moves -----------------------------------------------------------------------------------
  /** Minimum time between two hits (about one fast beat) */
  minHitGap: 0.35,
  /** Body-segment change needed since the previous hit (weighted RMS unit-vector difference; 0.3 ~ 17 deg) */
  minHitDisplacement: 0.3,
  /** Speed at the hit must be below this fraction of the peak speed since the previous hit (braking) */
  brakeRatio: 0.75,
  /** Motion segment length bounds */
  minSegment: 0.3,
  maxSegment: 0.8,
  /** No hit this close to the end of the reference */
  endMargin: 0.35,

  // --- aggregation -----------------------------------------------------------------------------
  /** Motion window of the continuous (every-frame) term */
  denseSegment: 0.4,
  /** Weight of the continuous term in the overall score */
  continuousWeight: 0.4,
}

export type Params = typeof PARAMS

/** Cache key of the reference-dependent parameters. */
export function referenceParamsKey(): string {
  const p = PARAMS
  return [p.kappa, p.chanceMin, p.chanceMax, p.restMotion, p.window, p.maxLatency, p.minHitGap,
    p.minHitDisplacement, p.brakeRatio, p.minSegment, p.maxSegment, p.endMargin, p.denseSegment].join('|')
}
