export type SignalCategory = 'scoring' | 'control' | 'violation' | 'time' | 'outcome'

export interface Signal {
  id: string
  label: string
  points: number
  category: SignalCategory
  color: string
  hasWhistle?: boolean
  requiresWrestler?: boolean
  fingers?: number        // for awarding points gesture: 1, 2, or 3 fingers
  hand?: 'left' | 'right' | 'either'  // which hand the ref uses
  notes?: string         // labeler guidance
}

export const SIGNALS: Signal[] = [

  // ── MATCH CONTROL ─────────────────────────────────────────
  {
    id: 'starting_match',
    label: 'Starting the Match',
    points: 0, category: 'control', color: '#a78bfa',
    notes: 'Ref blows whistle and points down to mat',
    hasWhistle: true,
  },
  {
    id: 'stopping_match',
    label: 'Stopping the Match',
    points: 0, category: 'control', color: '#a78bfa',
    notes: 'Ref blows whistle, arm extended palm out',
    hasWhistle: true,
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
    notes: 'Whistle + arm extended pointing out of bounds. CRITICAL: confirm whistle is from THIS mat in tournament settings',
  },
  {
    id: 'wrestler_in_control_left',
    label: 'Wrestler in Control (Left)',
    points: 0, category: 'control', color: '#a78bfa',
    hand: 'left',
    notes: 'Ref extends left arm toward controlling wrestler',
  },
  {
    id: 'wrestler_in_control_right',
    label: 'Wrestler in Control (Right)',
    points: 0, category: 'control', color: '#a78bfa',
    hand: 'right',
    notes: 'Ref extends right arm toward controlling wrestler',
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

  // ── SCORING — AWARDING POINTS (primary scoring gesture) ───
  // The ref raises fingers on left or right hand to indicate points
  // Left hand = wrestler on ref's left; Right hand = wrestler on ref's right
  {
    id: 'award_1pt_left',
    label: 'Award 1pt (Left Hand)',
    points: 1, category: 'scoring', color: '#00ff88',
    hand: 'left', fingers: 1, requiresWrestler: true,
    notes: '1 finger raised on left hand — typically escape',
  },
  {
    id: 'award_1pt_right',
    label: 'Award 1pt (Right Hand)',
    points: 1, category: 'scoring', color: '#00ff88',
    hand: 'right', fingers: 1, requiresWrestler: true,
    notes: '1 finger raised on right hand — typically escape',
  },
  {
    id: 'award_2pt_left',
    label: 'Award 2pt (Left Hand)',
    points: 2, category: 'scoring', color: '#00ff88',
    hand: 'left', fingers: 2, requiresWrestler: true,
    notes: '2 fingers raised on left hand — takedown or reversal',
  },
  {
    id: 'award_2pt_right',
    label: 'Award 2pt (Right Hand)',
    points: 2, category: 'scoring', color: '#00ff88',
    hand: 'right', fingers: 2, requiresWrestler: true,
    notes: '2 fingers raised on right hand — takedown or reversal',
  },
  {
    id: 'award_3pt_left',
    label: 'Award 3pt (Left Hand)',
    points: 3, category: 'scoring', color: '#00ff88',
    hand: 'left', fingers: 3, requiresWrestler: true,
    notes: '3 fingers raised on left hand — near fall 3pt',
  },
  {
    id: 'award_3pt_right',
    label: 'Award 3pt (Right Hand)',
    points: 3, category: 'scoring', color: '#00ff88',
    hand: 'right', fingers: 3, requiresWrestler: true,
    notes: '3 fingers raised on right hand — near fall 3pt',
  },
  {
    id: 'award_4pt_left',
    label: 'Award 4pt (Left Hand)',
    points: 4, category: 'scoring', color: '#00ff88',
    hand: 'left', fingers: 4, requiresWrestler: true,
    notes: '4 fingers raised — near fall 4pt (some rulesets)',
  },
  {
    id: 'award_4pt_right',
    label: 'Award 4pt (Right Hand)',
    points: 4, category: 'scoring', color: '#00ff88',
    hand: 'right', fingers: 4, requiresWrestler: true,
    notes: '4 fingers raised — near fall 4pt (some rulesets)',
  },

  // ── SCORING — SPECIFIC NAMED GESTURES ─────────────────────
  {
    id: 'reversal',
    label: 'Reversal',
    points: 2, category: 'scoring', color: '#00e5ff',
    requiresWrestler: true,
    notes: 'Ref rotates forearms in circular motion, then awards 2pt',
  },
  {
    id: 'nearfall_2',
    label: 'Near Fall (2pt)',
    points: 2, category: 'scoring', color: '#00e5ff',
    requiresWrestler: true,
    notes: 'Ref holds arm parallel to mat, then awards 2pt',
  },
  {
    id: 'nearfall_3',
    label: 'Near Fall (3pt)',
    points: 3, category: 'scoring', color: '#00e5ff',
    requiresWrestler: true,
    notes: 'Ref holds arm parallel to mat, then awards 3pt',
  },

  // ── TIME EVENTS ────────────────────────────────────────────
  {
    id: 'start_injury_time',
    label: 'Start Injury Time',
    points: 0, category: 'time', color: '#fb923c',
    requiresWrestler: true,
    notes: 'Ref points to injured wrestler, circles finger',
  },
  {
    id: 'start_blood_timeout',
    label: 'Start Blood Time Out',
    points: 0, category: 'time', color: '#fb923c',
    requiresWrestler: true,
    notes: 'Ref touches nose/face area',
  },
  {
    id: 'start_recovery_time',
    label: 'Start Recovery Time',
    points: 0, category: 'time', color: '#fb923c',
    requiresWrestler: true,
    notes: 'Similar to injury time — ref indicates recovery',
  },
  {
    id: 'stop_injury_clock',
    label: 'Stop Blood/Injury/Recovery Time',
    points: 0, category: 'time', color: '#fb923c',
    notes: 'Ref crosses wrists to stop the clock',
  },

  // ── VIOLATIONS ─────────────────────────────────────────────
  {
    id: 'stalling_left',
    label: 'Stalling (Left)',
    points: 0, category: 'violation', color: '#f87171',
    hand: 'left', requiresWrestler: true,
    notes: 'Ref points at wrestler with left hand',
  },
  {
    id: 'stalling_right',
    label: 'Stalling (Right)',
    points: 0, category: 'violation', color: '#f87171',
    hand: 'right', requiresWrestler: true,
    notes: 'Ref points at wrestler with right hand',
  },
  {
    id: 'potentially_dangerous_left',
    label: 'Potentially Dangerous (Left)',
    points: 0, category: 'violation', color: '#f87171',
    hand: 'left', requiresWrestler: true,
    notes: 'Ref touches back of head with left hand',
  },
  {
    id: 'potentially_dangerous_right',
    label: 'Potentially Dangerous (Right)',
    points: 0, category: 'violation', color: '#f87171',
    hand: 'right', requiresWrestler: true,
    notes: 'Ref touches back of head with right hand',
  },
  {
    id: 'false_start',
    label: 'Caution / False Start',
    points: 0, category: 'violation', color: '#f87171',
    requiresWrestler: true,
    notes: 'Ref raises fist',
  },
  {
    id: 'interlocking_hands',
    label: 'Interlocking Hands / Grasping Clothing',
    points: 0, category: 'violation', color: '#f87171',
    requiresWrestler: true,
    notes: 'Ref interlocks own fingers and presents to scorer',
  },
  {
    id: 'technical_violation',
    label: 'Technical Violation',
    points: 0, category: 'violation', color: '#f87171',
    requiresWrestler: true,
    notes: 'Ref taps top of head',
  },
  {
    id: 'illegal_hold',
    label: 'Illegal Hold / Unnecessary Roughness',
    points: 0, category: 'violation', color: '#f87171',
    requiresWrestler: true,
    notes: 'Ref grasps own wrist',
  },
  {
    id: 'unsportsmanlike_left',
    label: 'Unsportsmanlike Conduct (Left)',
    points: 0, category: 'violation', color: '#f87171',
    hand: 'left', requiresWrestler: true,
    notes: 'Ref points at wrestler with disapproving gesture',
  },
  {
    id: 'unsportsmanlike_right',
    label: 'Unsportsmanlike Conduct (Right)',
    points: 0, category: 'violation', color: '#f87171',
    hand: 'right', requiresWrestler: true,
    notes: 'Ref points at wrestler with disapproving gesture',
  },
  {
    id: 'flagrant_misconduct_left',
    label: 'Flagrant Misconduct (Left)',
    points: 0, category: 'violation', color: '#ff0055',
    hand: 'left', requiresWrestler: true,
    notes: 'Ref raises fist then points — most severe violation, wrestler disqualified',
  },
  {
    id: 'flagrant_misconduct_right',
    label: 'Flagrant Misconduct (Right)',
    points: 0, category: 'violation', color: '#ff0055',
    hand: 'right', requiresWrestler: true,
    notes: 'Ref raises fist then points — most severe violation, wrestler disqualified',
  },

  // ── OUTCOMES ───────────────────────────────────────────────
  {
    id: 'pin',
    label: 'Pin / Fall',
    points: 6, category: 'outcome', color: '#ff0055',
    hasWhistle: true, requiresWrestler: true,
    notes: 'Ref slaps mat, blows whistle',
  },
  {
    id: 'tech_fall',
    label: 'Technical Fall',
    points: 5, category: 'outcome', color: '#ff0055',
    requiresWrestler: true,
    notes: '15+ point lead — ref stops match',
  },
  {
    id: 'forfeit_dq',
    label: 'Forfeit / Disqualification',
    points: 0, category: 'outcome', color: '#ff0055',
    requiresWrestler: true,
    notes: 'Match ended by forfeit or DQ',
  },
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
  '🏆 AWARDING POINTS':   SIGNALS.filter(s => s.category === 'scoring' && s.fingers),
  '🤼 SCORING GESTURES':  SIGNALS.filter(s => s.category === 'scoring' && !s.fingers),
  '🎮 MATCH CONTROL':     SIGNALS.filter(s => s.category === 'control'),
  '⏱ TIME EVENTS':        SIGNALS.filter(s => s.category === 'time'),
  '⚠️ VIOLATIONS':        SIGNALS.filter(s => s.category === 'violation'),
  '🏁 OUTCOMES':           SIGNALS.filter(s => s.category === 'outcome'),
}
