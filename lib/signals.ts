export type SignalCategory = 'scoring' | 'control' | 'violation' | 'time' | 'outcome'

export interface Signal {
  id: string
  label: string
  points: number
  category: SignalCategory
  color: string
  hasWhistle?: boolean       // signals that typically accompany a whistle
  requiresWrestler?: boolean // signals that must be awarded to a specific wrestler
}

export const SIGNALS: Signal[] = [
  // ── Scoring ───────────────────────────────────────────────
  { id: 'takedown_2',    label: 'Takedown',             points: 2, category: 'scoring',   color: '#00ff88', requiresWrestler: true },
  { id: 'reversal_2',    label: 'Reversal',             points: 2, category: 'scoring',   color: '#00ff88', requiresWrestler: true },
  { id: 'escape_1',      label: 'Escape',               points: 1, category: 'scoring',   color: '#00ff88', requiresWrestler: true },
  { id: 'nearfall_2',    label: 'Near Fall 2pt',        points: 2, category: 'scoring',   color: '#00e5ff', requiresWrestler: true },
  { id: 'nearfall_3',    label: 'Near Fall 3pt',        points: 3, category: 'scoring',   color: '#00e5ff', requiresWrestler: true },
  { id: 'penalty_1',     label: 'Penalty 1pt',          points: 1, category: 'scoring',   color: '#ff9900', requiresWrestler: true },
  { id: 'penalty_2',     label: 'Penalty 2pt',          points: 2, category: 'scoring',   color: '#ff9900', requiresWrestler: true },

  // ── Control ───────────────────────────────────────────────
  { id: 'out_of_bounds', label: 'Out of Bounds',        points: 0, category: 'control',   color: '#a78bfa', hasWhistle: true },
  { id: 'start_match',   label: 'Start Match',          points: 0, category: 'control',   color: '#a78bfa' },
  { id: 'stop_match',    label: 'Stop Match',           points: 0, category: 'control',   color: '#a78bfa', hasWhistle: true },
  { id: 'timeout',       label: 'Time Out',             points: 0, category: 'control',   color: '#a78bfa' },
  { id: 'neutral',       label: 'Neutral Position',     points: 0, category: 'control',   color: '#a78bfa' },
  { id: 'stalemate',     label: 'Stalemate',            points: 0, category: 'control',   color: '#fbbf24' },
  { id: 'defer_choice',  label: 'Defer Choice',         points: 0, category: 'control',   color: '#fbbf24' },
  { id: 'no_control',    label: 'Indicates No Control', points: 0, category: 'control',   color: '#fbbf24' },

  // ── Violations ────────────────────────────────────────────
  { id: 'stalling',             label: 'Stalling',                  points: 0, category: 'violation', color: '#f87171', requiresWrestler: true },
  { id: 'potentially_dangerous',label: 'Potentially Dangerous',     points: 0, category: 'violation', color: '#f87171', requiresWrestler: true },
  { id: 'illegal_hold',         label: 'Illegal Hold / Roughness',  points: 0, category: 'violation', color: '#f87171', requiresWrestler: true },
  { id: 'technical_violation',  label: 'Technical Violation',       points: 0, category: 'violation', color: '#f87171', requiresWrestler: true },
  { id: 'false_start',          label: 'False Start / Caution',     points: 0, category: 'violation', color: '#f87171', requiresWrestler: true },
  { id: 'unsportsmanlike',      label: 'Unsportsmanlike Conduct',   points: 0, category: 'violation', color: '#f87171', requiresWrestler: true },
  { id: 'interlocking_hands',   label: 'Interlocking Hands',        points: 0, category: 'violation', color: '#f87171', requiresWrestler: true },

  // ── Time Events ───────────────────────────────────────────
  { id: 'injury_time',   label: 'Injury Time',          points: 0, category: 'time',      color: '#fb923c', requiresWrestler: true },
  { id: 'blood_time',    label: 'Blood Time Out',       points: 0, category: 'time',      color: '#fb923c', requiresWrestler: true },
  { id: 'recovery_time', label: 'Recovery Time',        points: 0, category: 'time',      color: '#fb923c', requiresWrestler: true },
  { id: 'stop_clock',    label: 'Stop Blood/Injury Clk',points: 0, category: 'time',      color: '#fb923c' },

  // ── Outcomes ──────────────────────────────────────────────
  { id: 'pin',           label: 'Pin / Fall',           points: 6, category: 'outcome',   color: '#ff0055', hasWhistle: true, requiresWrestler: true },
  { id: 'tech_fall',     label: 'Technical Fall',       points: 5, category: 'outcome',   color: '#ff0055', requiresWrestler: true },
  { id: 'forfeit',       label: 'Forfeit / DQ',         points: 0, category: 'outcome',   color: '#ff0055', requiresWrestler: true },
]

export const SIGNAL_MAP = Object.fromEntries(SIGNALS.map(s => [s.id, s]))

export const CATEGORY_COLOR: Record<SignalCategory, string> = {
  scoring:   '#00ff88',
  control:   '#a78bfa',
  violation: '#f87171',
  time:      '#fb923c',
  outcome:   '#ff0055',
}

export const SIGNAL_GROUPS: Record<string, Signal[]> = {
  '🏆 SCORING':          SIGNALS.filter(s => s.category === 'scoring'),
  '🚨 CONTROL':          SIGNALS.filter(s => s.category === 'control'),
  '⚠️ VIOLATIONS':      SIGNALS.filter(s => s.category === 'violation'),
  '⏱ TIME EVENTS':      SIGNALS.filter(s => s.category === 'time'),
  '🏁 OUTCOMES':         SIGNALS.filter(s => s.category === 'outcome'),
}
