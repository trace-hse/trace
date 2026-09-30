export type PaperAttack = 'deletion' | 'rewriting'

export interface PaperRobustnessPoint {
  /** Percentage of observations deleted, or decision groups rewritten. */
  strength: number
  selection: number
  tally: number
}

export const PAPER_ROBUSTNESS_SOURCE = {
  url: 'https://arxiv.org/html/2607.08400v1#S6.F5',
  figure: 'Figure 5',
  benchmark: 'ToolBench',
  threshold: 2,
  precision: 'Digitized from the published vector figure; not the original experiment outputs.',
  backbone: 'GPT-5.4-mini',
  seeds: 3,
  deletionRunsPerStrength: 15,
  rewritingRunsPerStrength: 9,
} as const

// Digitized from arXiv v1 source img/fig_robustness.pdf's vector paths, calibrated
// against the -5 axis and threshold 2. RG/AM-F control curves match Tables 11/12.
// These are rounded plotting values, not original experiment outputs or HSE
// measurements. Display approximate scores; use only the published strengths.
export const PAPER_ROBUSTNESS: Readonly<Record<PaperAttack, readonly PaperRobustnessPoint[]>> = {
  deletion: [
    { strength: 0, selection: 11.34, tally: 14.34 },
    { strength: 10, selection: 10.15, tally: 10.79 },
    { strength: 20, selection: 8.99, tally: 7.88 },
    { strength: 30, selection: 8.27, tally: 5.26 },
    { strength: 40, selection: 7.13, tally: 3.52 },
    { strength: 50, selection: 5.99, tally: 1.77 },
    { strength: 60, selection: 5.30, tally: 0.64 },
    { strength: 70, selection: 4.06, tally: -0.41 },
  ],
  rewriting: [
    { strength: 0, selection: 11.34, tally: 14.34 },
    { strength: 20, selection: 8.16, tally: 14.34 },
    { strength: 40, selection: 5.22, tally: 14.34 },
    { strength: 60, selection: -1.53, tally: 14.34 },
    { strength: 80, selection: -2.90, tally: 14.34 },
    { strength: 100, selection: -3.51, tally: 14.34 },
  ],
}

/** Snap to a published strength; never simulate or interpolate a measurement. */
export function nearestPaperPoint(attack: PaperAttack, strength: number): PaperRobustnessPoint {
  const target = Number.isFinite(strength) ? strength : 0
  return PAPER_ROBUSTNESS[attack].reduce((nearest, point) =>
    Math.abs(point.strength - target) < Math.abs(nearest.strength - target) ? point : nearest)
}
