export type SignalCategory = 'scoring' | 'control' | 'clock' | 'violation' | 'time' | 'outcome'

export interface Signal {
  id: string
  label: string
  points: number
  category: SignalCategory
  color: string
  hasWhistle?: boolean
  requiresWrestler?: boolean
  fingers?: number
  hand?: 'left' | 'right' | 'either'
  notes?: string
}

export const SIGNALS: Signal[] = [

  // ── MATCH CONTROL ─────────────────────────────────────────
  {
    id: 'starting_match',
    label: 'Starting the Match',
    points: 0, category: 'control', color: '#a78bfa',
    hasWhistle: true,
    notes: 'Ref blows whistle and points down to mat',
  },
  {
    id: 'stopping_match',
    label: 'Stopping the Match',
    points: 0, category: 'control', color: '#a78bfa',
    hasWhistle: true,
    notes: 'Ref blows whistle, arm extended palm out',
  },
  {
    id: 'timeout',
    label: 'Time Out',
    points: 0, category: 'control', color: '#a78bfa',
    notes: 'Both hands form T above head',
  },
  {
    id: 'neutral_position',
    label: 'Neutral Position',
    points: 0, category: 'control', color: '#a78bfa',
    notes: 'Both hands open, palms down, spread apart',
  },
  {
    id: 'no_control',
    label: 'Indicates No Control',
    points: 0, category: 'control', color: '#a78bfa',
    notes: 'Both hands open, waved side to side',
  },
  {
    id: 'out_of_bounds',
    label: 'Out of Bounds',
    points: 0, category: 'control', color: '#a78bfa',
    hasWhistle: true,
    notes: 'Whistle + arm extended pointing out. Confirm whistle is from THIS mat in tournaments',
  },
  {
    id: 'wrestler_in_control_red',
    label: 'Wrestler in Control (Red)',
    points: 0, category: 'control', color: '#a78bfa',
    notes: 'Ref extends arm toward red wrestler indicating control',
  },
  {
    id: 'wrestler_in_control_green',
    label: 'Wrestler in Control (Green)',
    points: 0, category: 'control', color: '#a78bfa',
    notes: 'Ref extends arm toward green wrestler indicating control',
  },
  {
    id: 'defer_choice',
    label: 'Defer Choice',
    points: 0, category: 'control', color: '#a78bfa',
    notes: 'Ref rotates hand in circular motion',
  },
  {
    id: 'stalemate',
    label: 'Stalemate',
    points: 0, category: 'control', color: '#fbbf24',
    notes: 'Ref interlocks fingers at chest level',
  },

  // ── SCORING — RED WRESTLER ─────────────────────────────────
  {
    id: 'takedown_3pt_red',
    label: 'Takedown 3pt — Red',
    points: 3, category: 'scoring', color: '#ff4444',
    fingers: 3, requiresWrestler: true,
    notes: 'Red scores takedown — ref signals 3 fingers toward red',
  },
  {
    id: 'escape_1pt_red',
    label: 'Escape 1pt — Red',
    points: 1, category: 'scoring', color: '#ff4444',
    fingers: 1, requiresWrestler: true,
    notes: 'Red escapes — ref signals 1 finger toward red',
  },
  {
    id: 'reversal_2pt_red',
    label: 'Reversal 2pt — Red',
    points: 2, category: 'scoring', color: '#ff4444',
    fingers: 2, requiresWrestler: true,
    notes: 'Red reversal — ref rotates forearms then signals 2 fingers toward red',
  },
  {
    id: 'nearfall_2pt_red',
    label: 'Near Fall 2pt — Red',
    points: 2, category: 'scoring', color: '#ff4444',
    fingers: 2, requiresWrestler: true,
    notes: 'Red near fall 2pt — ref arm parallel to mat then 2 fingers',
  },
  {
    id: 'nearfall_3pt_red',
    label: 'Near Fall 3pt — Red',
    points: 3, category: 'scoring', color: '#ff4444',
    fingers: 3, requiresWrestler: true,
    notes: 'Red near fall 3pt — ref arm parallel to mat then 3 fingers',
  },
  {
    id: 'penalty_1pt_red',
    label: 'Penalty 1pt — Red',
    points: 1, category: 'scoring', color: '#ff4444',
    fingers: 1, requiresWrestler: true,
    notes: 'Red awarded 1pt penalty against opponent',
  },
  {
    id: 'penalty_2pt_red',
    label: 'Penalty 2pt — Red',
    points: 2, category: 'scoring', color: '#ff4444',
    fingers: 2, requiresWrestler: true,
    notes: 'Red awarded 2pt penalty against opponent',
  },

  {
    id: 'nearfall_4pt_red',
    label: 'Near Fall 4pt — Red',
    points: 4, category: 'scoring', color: '#ff4444',
    fingers: 4, requiresWrestler: true,
    notes: 'Red near fall 4pt — ref arm parallel to mat then 4 fingers',
  },

  // ── SCORING — GREEN WRESTLER ───────────────────────────────
  {
    id: 'takedown_3pt_green',
    label: 'Takedown 3pt — Green',
    points: 3, category: 'scoring', color: '#00cc66',
    fingers: 3, requiresWrestler: true,
    notes: 'Green scores takedown — ref signals 3 fingers toward green',
  },
  {
    id: 'escape_1pt_green',
    label: 'Escape 1pt — Green',
    points: 1, category: 'scoring', color: '#00cc66',
    fingers: 1, requiresWrestler: true,
    notes: 'Green escapes — ref signals 1 finger toward green',
  },
  {
    id: 'reversal_2pt_green',
    label: 'Reversal 2pt — Green',
    points: 2, category: 'scoring', color: '#00cc66',
    fingers: 2, requiresWrestler: true,
    notes: 'Green reversal — ref rotates forearms then signals 2 fingers toward green',
  },
  {
    id: 'nearfall_2pt_green',
    label: 'Near Fall 2pt — Green',
    points: 2, category: 'scoring', color: '#00cc66',
    fingers: 2, requiresWrestler: true,
    notes: 'Green near fall 2pt — ref arm parallel to mat then 2 fingers',
  },
  {
    id: 'nearfall_3pt_green',
    label: 'Near Fall 3pt — Green',
    points: 3, category: 'scoring', color: '#00cc66',
    fingers: 3, requiresWrestler: true,
    notes: 'Green near fall 3pt — ref arm parallel to mat then 3 fingers',
  },
  {
    id: 'penalty_1pt_green',
    label: 'Penalty 1pt — Green',
    points: 1, category: 'scoring', color: '#00cc66',
    fingers: 1, requiresWrestler: true,
    notes: 'Green awarded 1pt penalty against opponent',
  },
  {
    id: 'penalty_2pt_green',
    label: 'Penalty 2pt — Green',
    points: 2, category: 'scoring', color: '#00cc66',
    fingers: 2, requiresWrestler: true,
    notes: 'Green awarded 2pt penalty against opponent',
  },

  {
    id: 'nearfall_4pt_green',
    label: 'Near Fall 4pt — Green',
    points: 4, category: 'scoring', color: '#00cc66',
    fingers: 4, requiresWrestler: true,
    notes: 'Green near fall 4pt — ref arm parallel to mat then 4 fingers',
  },


  // ── MATCH CLOCK EVENTS ────────────────────────────────────
  // These affect the clock and mark match boundaries
  {
    id: 'handshake_start',
    label: 'Handshake / Match Start',
    points: 0, category: 'clock', color: '#38bdf8',
    hasWhistle: true,
    notes: 'Ref brings wrestlers together, handshake, whistle to start clock',
  },
  {
    id: 'clock_start',
    label: 'Clock Start',
    points: 0, category: 'clock', color: '#38bdf8',
    hasWhistle: true,
    notes: 'Ref starts match clock — whistle + point down',
  },
  {
    id: 'clock_stop',
    label: 'Clock Stop',
    points: 0, category: 'clock', color: '#38bdf8',
    hasWhistle: true,
    notes: 'Ref stops match clock — whistle + stop signal',
  },
  {
    id: 'period_end',
    label: 'End of Period',
    points: 0, category: 'clock', color: '#38bdf8',
    hasWhistle: true,
    notes: 'Horn/whistle signals end of period',
  },
  {
    id: 'match_end_decision',
    label: 'Match End — Decision',
    points: 0, category: 'clock', color: '#38bdf8',
    hasWhistle: true,
    notes: 'Final whistle — match ends by decision',
  },
  {
    id: 'match_end_handshake',
    label: 'Post-Match Handshake',
    points: 0, category: 'clock', color: '#38bdf8',
    notes: 'Wrestlers shake hands after match — marks definitive match end',
  },
  {
    id: 'injury_clock_start_red',
    label: 'Injury Clock Start — Red',
    points: 0, category: 'clock', color: '#38bdf8',
    requiresWrestler: true,
    notes: 'Injury clock starts for red — ref circles finger, match clock stops',
  },
  {
    id: 'injury_clock_start_green',
    label: 'Injury Clock Start — Green',
    points: 0, category: 'clock', color: '#38bdf8',
    requiresWrestler: true,
    notes: 'Injury clock starts for green — ref circles finger, match clock stops',
  },
  {
    id: 'injury_clock_stop',
    label: 'Injury/Blood Clock Stop',
    points: 0, category: 'clock', color: '#38bdf8',
    notes: 'Ref crosses wrists — injury/blood clock stops, match clock resumes',
  },
  // ── TIME EVENTS ────────────────────────────────────────────
  {
    id: 'start_injury_time_red',
    label: 'Injury Time — Red',
    points: 0, category: 'time', color: '#fb923c',
    requiresWrestler: true,
    notes: 'Red wrestler injury clock started',
  },
  {
    id: 'start_injury_time_green',
    label: 'Injury Time — Green',
    points: 0, category: 'time', color: '#fb923c',
    requiresWrestler: true,
    notes: 'Green wrestler injury clock started',
  },
  {
    id: 'start_blood_timeout_red',
    label: 'Blood Time Out — Red',
    points: 0, category: 'time', color: '#fb923c',
    requiresWrestler: true,
    notes: 'Red wrestler blood timeout — ref touches face area',
  },
  {
    id: 'start_blood_timeout_green',
    label: 'Blood Time Out — Green',
    points: 0, category: 'time', color: '#fb923c',
    requiresWrestler: true,
    notes: 'Green wrestler blood timeout',
  },
  {
    id: 'start_recovery_time_red',
    label: 'Recovery Time — Red',
    points: 0, category: 'time', color: '#fb923c',
    requiresWrestler: true,
    notes: 'Red wrestler recovery time started',
  },
  {
    id: 'start_recovery_time_green',
    label: 'Recovery Time — Green',
    points: 0, category: 'time', color: '#fb923c',
    requiresWrestler: true,
    notes: 'Green wrestler recovery time started',
  },
  {
    id: 'stop_injury_clock',
    label: 'Stop Blood/Injury/Recovery Clock',
    points: 0, category: 'time', color: '#fb923c',
    notes: 'Ref crosses wrists to stop the clock',
  },

  // ── VIOLATIONS ─────────────────────────────────────────────
  {
    id: 'stalling_red',
    label: 'Stalling — Red',
    points: 0, category: 'violation', color: '#f87171',
    requiresWrestler: true,
    notes: 'Stalling called on red wrestler',
  },
  {
    id: 'stalling_green',
    label: 'Stalling — Green',
    points: 0, category: 'violation', color: '#f87171',
    requiresWrestler: true,
    notes: 'Stalling called on green wrestler',
  },
  {
    id: 'potentially_dangerous_red',
    label: 'Potentially Dangerous — Red',
    points: 0, category: 'violation', color: '#f87171',
    requiresWrestler: true,
    notes: 'Red in potentially dangerous position — ref touches back of head',
  },
  {
    id: 'potentially_dangerous_green',
    label: 'Potentially Dangerous — Green',
    points: 0, category: 'violation', color: '#f87171',
    requiresWrestler: true,
    notes: 'Green in potentially dangerous position',
  },
  {
    id: 'false_start_red',
    label: 'False Start / Caution — Red',
    points: 0, category: 'violation', color: '#f87171',
    requiresWrestler: true,
    notes: 'False start or incorrect starting procedure by red',
  },
  {
    id: 'false_start_green',
    label: 'False Start / Caution — Green',
    points: 0, category: 'violation', color: '#f87171',
    requiresWrestler: true,
    notes: 'False start or incorrect starting procedure by green',
  },
  {
    id: 'interlocking_hands_red',
    label: 'Interlocking Hands — Red',
    points: 0, category: 'violation', color: '#f87171',
    requiresWrestler: true,
    notes: 'Red interlocking hands or grasping clothing',
  },
  {
    id: 'interlocking_hands_green',
    label: 'Interlocking Hands — Green',
    points: 0, category: 'violation', color: '#f87171',
    requiresWrestler: true,
    notes: 'Green interlocking hands or grasping clothing',
  },
  {
    id: 'technical_violation_red',
    label: 'Technical Violation — Red',
    points: 0, category: 'violation', color: '#f87171',
    requiresWrestler: true,
    notes: 'Technical violation by red — ref taps top of head',
  },
  {
    id: 'technical_violation_green',
    label: 'Technical Violation — Green',
    points: 0, category: 'violation', color: '#f87171',
    requiresWrestler: true,
    notes: 'Technical violation by green',
  },
  {
    id: 'illegal_hold_red',
    label: 'Illegal Hold / Roughness — Red',
    points: 0, category: 'violation', color: '#f87171',
    requiresWrestler: true,
    notes: 'Illegal hold or unnecessary roughness by red — ref grasps own wrist',
  },
  {
    id: 'illegal_hold_green',
    label: 'Illegal Hold / Roughness — Green',
    points: 0, category: 'violation', color: '#f87171',
    requiresWrestler: true,
    notes: 'Illegal hold or unnecessary roughness by green',
  },
  {
    id: 'unsportsmanlike_red',
    label: 'Unsportsmanlike Conduct — Red',
    points: 0, category: 'violation', color: '#f87171',
    requiresWrestler: true,
    notes: 'Unsportsmanlike conduct by red wrestler or corner',
  },
  {
    id: 'unsportsmanlike_green',
    label: 'Unsportsmanlike Conduct — Green',
    points: 0, category: 'violation', color: '#f87171',
    requiresWrestler: true,
    notes: 'Unsportsmanlike conduct by green wrestler or corner',
  },
  {
    id: 'flagrant_misconduct_red',
    label: 'Flagrant Misconduct — Red',
    points: 0, category: 'violation', color: '#ff0055',
    requiresWrestler: true,
    notes: 'Flagrant misconduct by red — automatic disqualification',
  },
  {
    id: 'flagrant_misconduct_green',
    label: 'Flagrant Misconduct — Green',
    points: 0, category: 'violation', color: '#ff0055',
    requiresWrestler: true,
    notes: 'Flagrant misconduct by green — automatic disqualification',
  },

  // ── OUTCOMES ───────────────────────────────────────────────
  {
    id: 'pin_red',
    label: 'Pin / Fall — Red Wins',
    points: 6, category: 'outcome', color: '#ff0055',
    hasWhistle: true, requiresWrestler: true,
    notes: 'Red wins by pin — ref slaps mat and blows whistle',
  },
  {
    id: 'pin_green',
    label: 'Pin / Fall — Green Wins',
    points: 6, category: 'outcome', color: '#ff0055',
    hasWhistle: true, requiresWrestler: true,
    notes: 'Green wins by pin — ref slaps mat and blows whistle',
  },
  {
    id: 'tech_fall_red',
    label: 'Technical Fall — Red Wins',
    points: 5, category: 'outcome', color: '#ff0055',
    requiresWrestler: true,
    notes: 'Red wins by technical fall (15pt lead)',
  },
  {
    id: 'tech_fall_green',
    label: 'Technical Fall — Green Wins',
    points: 5, category: 'outcome', color: '#ff0055',
    requiresWrestler: true,
    notes: 'Green wins by technical fall (15pt lead)',
  },
  {
    id: 'forfeit_dq_red',
    label: 'Forfeit / DQ — Red Wins',
    points: 0, category: 'outcome', color: '#ff0055',
    requiresWrestler: true,
    notes: 'Red wins by forfeit or disqualification of green',
  },
  {
    id: 'forfeit_dq_green',
    label: 'Forfeit / DQ — Green Wins',
    points: 0, category: 'outcome', color: '#ff0055',
    requiresWrestler: true,
    notes: 'Green wins by forfeit or disqualification of red',
  },
]

export const SIGNAL_MAP = Object.fromEntries(SIGNALS.map(s => [s.id, s]))

export const CATEGORY_COLOR: Record<SignalCategory, string> = {
  scoring:   '#00ff88',
  control:   '#a78bfa',
  clock:     '#38bdf8',
  violation: '#f87171',
  time:      '#fb923c',
  outcome:   '#ff0055',
}

export const SIGNAL_GROUPS: Record<string, Signal[]> = {
  '🔴 RED SCORING':       SIGNALS.filter(s => s.category === 'scoring' && s.id.endsWith('_red')),
  '🟢 GREEN SCORING':     SIGNALS.filter(s => s.category === 'scoring' && s.id.endsWith('_green')),
  '⏱️ CLOCK EVENTS':       SIGNALS.filter(s => s.category === 'clock'),
  '🎮 MATCH CONTROL':     SIGNALS.filter(s => s.category === 'control'),
  '⏱ TIME EVENTS':        SIGNALS.filter(s => s.category === 'time'),
  '⚠️ VIOLATIONS':        SIGNALS.filter(s => s.category === 'violation'),
  '🏁 OUTCOMES':           SIGNALS.filter(s => s.category === 'outcome'),
}
