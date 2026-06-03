'use client'

import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { detectRefMotion, MotionCandidate, DetectionProgress } from '@/lib/motionDetector'
import { SIGNAL_GROUPS, Signal } from '@/lib/signals'

const fmt = (s: number) => { const m = Math.floor(s / 60), sec = Math.floor(s % 60); return `${m}:${sec.toString().padStart(2, '0')}` }

const btn: React.CSSProperties = {
  background: 'transparent', border: '1px solid #1a1a2e', color: '#888',
  padding: '8px 14px', cursor: 'pointer', fontFamily: "'Courier New',monospace", fontSize: 11, letterSpacing: 1,
}
const primaryBtn: React.CSSProperties = {
  background: '#ff0055', border: 'none', color: '#fff', padding: '12px 0',
  cursor: 'pointer', fontFamily: "'Courier New',monospace", fontSize: 12,
  letterSpacing: 2, fontWeight: 'bold', width: '100%',
}

interface VideoInfo { videoId: string; matchId: string; labelCount: number; redName: string; greenName: string }


// ── Name prompt component ─────────────────────────────────────
function NamePrompt({ onConfirm, defaultRed, defaultGreen }: { onConfirm: (r: string, g: string) => void; defaultRed: string; defaultGreen: string }) {
  const [red, setRed] = useState(defaultRed)
  const [green, setGreen] = useState(defaultGreen)
  const inputStyle: React.CSSProperties = {
    background: '#0a0a0f', border: '1px solid #1a1a2e', color: '#e0e0f0',
    fontFamily: "'Courier New',monospace", fontSize: 13, padding: '8px 10px', width: '100%', outline: 'none',
  }
  return (
    <div style={{ background: '#0d0d1a', border: '1px solid #1a1a2e', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 11, color: '#666', letterSpacing: 2 }}>WRESTLER NAMES</div>
      <div>
        <div style={{ fontSize: 10, color: '#ff4444', marginBottom: 4 }}>RED WRESTLER</div>
        <input value={red} onChange={e => setRed(e.target.value)} style={inputStyle} placeholder="e.g. Frank DiMarzio" />
      </div>
      <div>
        <div style={{ fontSize: 10, color: '#00cc66', marginBottom: 4 }}>GREEN WRESTLER</div>
        <input value={green} onChange={e => setGreen(e.target.value)} style={inputStyle} placeholder="Opponent name" />
      </div>
      <button onClick={() => onConfirm(red, green)} style={{ background: '#ff0055', border: 'none', color: '#fff', padding: '10px 0', cursor: 'pointer', fontFamily: "'Courier New',monospace", fontSize: 12, letterSpacing: 2, fontWeight: 'bold' }}>
        CONFIRM → READY TO SCAN
      </button>
    </div>
  )
}

export default function ScanPage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const previewRef = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [videoSrc, setVideoSrc] = useState<string | null>(null)
  const [videoName, setVideoName] = useState('')
  const [videoId, setVideoId] = useState<string | null>(null)
  const [matchId, setMatchId] = useState<string | null>(null)
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null)
  const [redName, setRedName] = useState('')
  const [greenName, setGreenName] = useState('')
  const [showNamePrompt, setShowNamePrompt] = useState(false)
  const [existingLabelCount, setExistingLabelCount] = useState(0)
  const [alreadyScanned, setAlreadyScanned] = useState(false)

  // Scan state
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState<DetectionProgress | null>(null)
  const [candidates, setCandidates] = useState<MotionCandidate[]>([])
  const [currentIdx, setCurrentIdx] = useState(0)

  // Labeling state
  const [period, setPeriod] = useState(1)
  const [confidence, setConfidence] = useState(5)
  const [wrestler, setWrestler] = useState<'red' | 'green'>('red')
  const [saving, setSaving] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  const [skippedCount, setSkippedCount] = useState(0)
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null)
  const [showSignalPicker, setShowSignalPicker] = useState(false)
  const [previewLooping, setPreviewLooping] = useState(false)

  const showToast = (msg: string, type = 'ok') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000) }

  const pending = candidates.filter(c => c.status === 'pending')
  const current = pending[0] || null
  const reviewed = candidates.filter(c => c.status !== 'pending').length

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    const url = URL.createObjectURL(file)
    setVideoSrc(url); setVideoName(file.name)
    setCandidates([]); setSavedCount(0); setSkippedCount(0)
    setVideoId(null); setMatchId(null); setVideoInfo(null)
    setAlreadyScanned(false); setExistingLabelCount(0)

    // Check if video already registered
    const { data: vids } = await supabase
      .from('mattrack_videos').select('id').eq('filename', file.name).limit(1)

    if (vids && vids.length > 0) {
      const vid = vids[0]
      // Get match + label count
      const { data: matches } = await supabase
        .from('mattrack_matches')
        .select('id, red_name, green_name')
        .eq('video_id', vid.id)
        .limit(1)
      const { count } = await supabase
        .from('mattrack_signal_instances')
        .select('id', { count: 'exact', head: true })
        .eq('video_id', vid.id)
      const labelCount = count || 0
      if (matches && matches.length > 0) {
        setVideoId(vid.id)
        setMatchId(matches[0].id)
        setRedName(matches[0].red_name)
        setGreenName(matches[0].green_name)
        setExistingLabelCount(labelCount)
        if (labelCount > 0) setAlreadyScanned(true)
        setVideoInfo({ videoId: vid.id, matchId: matches[0].id, labelCount, redName: matches[0].red_name, greenName: matches[0].green_name })
      } else {
        // Video registered but no match — show name prompt
        setVideoId(vid.id)
        setShowNamePrompt(true)
      }
    } else {
      // New video — show name prompt to auto-register
      setShowNamePrompt(true)
    }
  }

  const autoRegister = async (redN: string, greenN: string) => {
    // Register video record
    const vid = videoRef.current
    let currentVideoId = videoId
    if (!currentVideoId) {
      const { data, error } = await supabase.from('mattrack_videos').insert({
        filename: videoName,
        duration_seconds: vid?.duration || 0,
        fps: 30,
        width_px: vid?.videoWidth,
        height_px: vid?.videoHeight,
        camera_angle: 'broadcast',
        venue_type: 'tournament_multi_mat',
        ambient_whistle_density: 'high',
        estimated_mat_count: 20,
      }).select().single()
      if (error) { showToast('Registration error: ' + error.message, 'err'); return }
      currentVideoId = data.id
      setVideoId(currentVideoId)
    }
    // Register match record
    const { data: match, error: me } = await supabase.from('mattrack_matches').insert({
      video_id: currentVideoId,
      red_name: redN || 'Wrestler A',
      green_name: greenN || 'Wrestler B',
      match_start_frame: 0,
      total_periods: 3,
    }).select().single()
    if (me) { showToast('Match error: ' + me.message, 'err'); return }
    setMatchId(match.id)
    setRedName(redN || 'Wrestler A')
    setGreenName(greenN || 'Wrestler B')
    setShowNamePrompt(false)
    setVideoInfo({ videoId: currentVideoId!, matchId: match.id, labelCount: 0, redName: redN, greenName: greenN })
    showToast('Video registered ✓ — ready to scan')
  }

  // Preview loop for current candidate
  useEffect(() => {
    const preview = previewRef.current
    if (!preview || !current || !videoSrc) return
    const start = Math.max(0, (current.startFrame / 30))
    const end = current.endFrame / 30
    preview.currentTime = start
    preview.play().catch(() => {})
    const checkLoop = () => {
      if (preview.currentTime >= end) preview.currentTime = start
    }
    const interval = setInterval(checkLoop, 100)
    return () => { clearInterval(interval); preview.pause() }
  }, [current?.id, videoSrc])

  const runScan = async () => {
    const video = videoRef.current; if (!video || !matchId) return
    setScanning(true); setCandidates([]); setSavedCount(0); setSkippedCount(0)
    setAlreadyScanned(false)
    showToast('Scanning video for ref movement…')
    try {
      const results = await detectRefMotion(video, (p) => setScanProgress(p))
      setCandidates(results)
      showToast(`Found ${results.length} candidate moments — review queue ready`)
    } catch (err) {
      showToast('Scan error: ' + String(err), 'err')
    }
    setScanning(false); setScanProgress(null)
  }

  const skipCurrent = () => {
    if (!current) return
    setCandidates(prev => prev.map(c => c.id === current.id ? { ...c, status: 'skipped' } : c))
    setSkippedCount(n => n + 1)
  }

  const labelCurrent = async (signal: Signal) => {
    if (!current || !matchId || !videoId) { showToast('Select a match first', 'err'); return }
    setSaving(true)
    const record = {
      match_id: matchId, video_id: videoId,
      start_frame: current.startFrame,
      peak_frame: current.peakFrame,
      end_frame: current.endFrame,
      period,
      signal_id: signal.id,
      signal_label: signal.label,
      signal_category: signal.category,
      points_awarded: signal.points,
      awarded_to: signal.requiresWrestler ? wrestler : null,
      is_negative_sample: false,
      bbox_x: current.refRegion.x,
      bbox_y: current.refRegion.y,
      bbox_w: current.refRegion.w,
      bbox_h: current.refRegion.h,
      has_whistle: false,
      whistle_source_method: signal.hasWhistle ? 'ambiguous' : null,
      needs_review: signal.hasWhistle || false,
      label_confidence: confidence,
      is_occluded: false, is_ambiguous: false,
      camera_angle: 'broadcast',
      labeler_id: 'motion_scan',
    }
    const { error } = await supabase.from('mattrack_signal_instances').insert(record)
    if (error) { showToast('Save failed: ' + error.message, 'err'); setSaving(false); return }
    setCandidates(prev => prev.map(c => c.id === current.id ? { ...c, status: 'labeled' } : c))
    setSavedCount(n => n + 1)
    setSaving(false)
    setShowSignalPicker(false)
    showToast(`✓ ${signal.label} saved`)
  }

  const catColor: Record<string, string> = {
    scoring: '#00ff88', control: '#a78bfa', clock: '#38bdf8',
    violation: '#f87171', time: '#fb923c', outcome: '#ff0055',
  }

  const progressPct = candidates.length > 0 ? Math.round((reviewed / candidates.length) * 100) : 0

  return (
    <div style={{ minHeight: '100vh', background: '#08080f', color: '#e0e0f0', fontFamily: "'Courier New',monospace", display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div style={{ background: '#0d0d1a', borderBottom: '2px solid #ff0055', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="/" style={{ color: '#555', textDecoration: 'none', fontSize: 11 }}>← HOME</a>
          <div style={{ fontSize: 16, color: '#ff0055', fontWeight: 'bold', letterSpacing: 3 }}>MATTRACK / SCAN</div>
        </div>
        {candidates.length > 0 && (
          <div style={{ fontSize: 11, display: 'flex', gap: 16 }}>
            <span style={{ color: '#00ff88' }}>✓ {savedCount}</span>
            <span style={{ color: '#555' }}>⟳ {pending.length} pending</span>
            <span style={{ color: '#333' }}>✗ {skippedCount} skipped</span>
          </div>
        )}
        <button onClick={() => fileInputRef.current?.click()} style={{ background: '#ff0055', border: 'none', color: '#fff', padding: '7px 14px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, letterSpacing: 1, fontWeight: 'bold' }}>
          ↑ LOAD VIDEO
        </button>
        <input ref={fileInputRef} type="file" accept="video/*" onChange={handleFile} style={{ display: 'none' }} />
      </div>

      {toast && (
        <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', background: toast.type === 'err' ? '#ff0055' : '#00ff88', color: '#000', padding: '10px 20px', fontFamily: 'inherit', fontSize: 12, fontWeight: 'bold', zIndex: 999, maxWidth: '90vw', textAlign: 'center' }}>
          {toast.msg}
        </div>
      )}

      {/* Hidden full video for scanning */}
      {videoSrc && <video ref={videoRef} src={videoSrc} style={{ display: 'none' }} preload="auto" />}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {!videoSrc ? (
          /* ── Landing ── */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 32 }}>
            <div style={{ fontSize: 32, opacity: 0.2 }}>⚡</div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 15, color: '#ff0055', fontWeight: 'bold', letterSpacing: 2, marginBottom: 8 }}>MOTION-ASSISTED LABELING</div>
              <div style={{ fontSize: 11, color: '#555', lineHeight: 1.8, maxWidth: 300 }}>
                Load a match video. The tool scans for referee arm movement and builds a queue of candidate signals. You confirm or skip each one — no more watching every second of footage.
              </div>
            </div>
            <button onClick={() => fileInputRef.current?.click()} style={{ background: '#ff0055', border: 'none', color: '#fff', padding: '12px 32px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, letterSpacing: 2, fontWeight: 'bold' }}>
              SELECT VIDEO
            </button>
          </div>

        ) : candidates.length === 0 ? (
          /* ── Pre-scan setup ── */
          <div style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>

            <div style={{ fontSize: 11, color: '#00ff88', letterSpacing: 1 }}>✓ {videoName}</div>

            {/* Name prompt — new or unmatched video */}
            {showNamePrompt && (
              <NamePrompt
                onConfirm={autoRegister}
                defaultRed={typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('mattrack_defaults') || '{}').red_name || '' : ''}
                defaultGreen={typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('mattrack_defaults') || '{}').green_name || '' : ''}
              />
            )}

            {/* Already scanned warning */}
            {alreadyScanned && !showNamePrompt && (
              <div style={{ background: '#1a1200', border: '1px solid #fbbf24', padding: 12, fontSize: 11, color: '#fbbf24', lineHeight: 1.8 }}>
                ⚠️ This video already has <strong>{existingLabelCount} labels</strong>. Rescanning may create duplicates near already-labeled moments. Proceed anyway?
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button onClick={() => setAlreadyScanned(false)} style={{ ...btn, color: '#fbbf24', borderColor: '#fbbf24', padding: '6px 14px' }}>RESCAN ANYWAY</button>
                  <a href="/labeler" style={{ ...btn, color: '#555', textDecoration: 'none', padding: '6px 14px' }}>USE MANUAL LABELER</a>
                </div>
              </div>
            )}

            {/* Match confirmed — ready to scan */}
            {videoInfo && !alreadyScanned && !showNamePrompt && (
              <div>
                <div style={{ background: '#0d1a0d', border: '1px solid #00ff88', padding: 12, fontSize: 11, color: '#00ff88', marginBottom: 12 }}>
                  <span style={{ color: '#ff4444' }}>{videoInfo.redName}</span> vs <span style={{ color: '#00cc66' }}>{videoInfo.greenName}</span>
                  {videoInfo.labelCount > 0 && <span style={{ color: '#555', marginLeft: 8 }}>· {videoInfo.labelCount} existing labels</span>}
                </div>
                <div style={{ fontSize: 10, color: '#444', lineHeight: 1.8, marginBottom: 12 }}>
                  Analyzes at 2fps · detects ref by grey/black uniform · flags arm movement · ~1 sec per minute of video
                </div>
                <button onClick={runScan} disabled={scanning} style={{ ...primaryBtn, opacity: scanning ? 0.5 : 1 }}>
                  {scanning ? '⚡ SCANNING…' : '⚡ SCAN FOR REF MOVEMENT'}
                </button>
              </div>
            )}

            {/* Scan progress */}
            {scanning && scanProgress && (
              <div style={{ background: '#0d0d1a', border: '1px solid #1a1a2e', padding: 16 }}>
                <div style={{ fontSize: 11, color: '#ff0055', marginBottom: 8 }}>
                  Analyzing frame {scanProgress.framesAnalyzed} / {scanProgress.totalFrames} — {scanProgress.pct}%
                </div>
                <div style={{ height: 4, background: '#1a1a2e', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${scanProgress.pct}%`, height: '100%', background: '#ff0055', transition: 'width 0.3s' }} />
                </div>
                <div style={{ fontSize: 10, color: '#555', marginTop: 6 }}>
                  {scanProgress.candidatesFound} candidate moments found so far
                </div>
              </div>
            )}
          </div>

        ) : (
          /* ── Review queue ── */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            {/* Progress bar */}
            <div style={{ padding: '8px 16px', background: '#0d0d1a', borderBottom: '1px solid #1a1a2e' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#555', marginBottom: 4 }}>
                <span>{reviewed} reviewed</span>
                <span>{progressPct}%</span>
                <span>{pending.length} remaining</span>
              </div>
              <div style={{ height: 3, background: '#1a1a2e', borderRadius: 2 }}>
                <div style={{ width: `${progressPct}%`, height: '100%', background: '#ff0055', borderRadius: 2 }} />
              </div>
            </div>

            {!current ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 }}>
                <div style={{ fontSize: 32 }}>🏆</div>
                <div style={{ fontSize: 14, color: '#00ff88', letterSpacing: 2 }}>QUEUE COMPLETE</div>
                <div style={{ fontSize: 11, color: '#555' }}>{savedCount} signals labeled · {skippedCount} skipped</div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => { setCandidates([]); setScanProgress(null) }} style={btn}>↺ RESCAN</button>
                  <a href="/export" style={{ ...btn, textDecoration: 'none', color: '#00ff88', borderColor: '#00ff88' }}>→ EXPORT</a>
                </div>
              </div>
            ) : (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

                {/* Preview clip — loops automatically */}
                <div style={{ position: 'relative', background: '#000', aspectRatio: '16/9', flexShrink: 0 }}>
                  <video ref={previewRef} src={videoSrc} style={{ width: '100%', height: '100%', display: 'block' }} muted playsInline />
                  {/* Motion score indicator */}
                  <div style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(0,0,0,0.85)', padding: '4px 10px', fontSize: 11 }}>
                    {fmt(current.peakTime)}
                    <span style={{ color: '#ff0055', marginLeft: 8 }}>motion: {Math.round(current.motionScore * 100)}%</span>
                  </div>
                  <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.85)', padding: '4px 10px', fontSize: 10, color: '#555' }}>
                    F{current.startFrame}→F{current.endFrame} · LOOPING
                  </div>
                  {/* Ref region highlight */}
                  <div style={{
                    position: 'absolute',
                    left: `${current.refRegion.x * 100}%`,
                    top: `${current.refRegion.y * 100}%`,
                    width: `${current.refRegion.w * 100}%`,
                    height: `${current.refRegion.h * 100}%`,
                    border: '1px solid rgba(255,0,85,0.4)',
                    pointerEvents: 'none',
                  }} />
                </div>

                {/* Context — show nearby already-labeled signals */}
                <div style={{ padding: '6px 14px', background: '#0a0a0f', borderBottom: '1px solid #111', fontSize: 10, color: '#444', display: 'flex', gap: 12, overflowX: 'auto' }}>
                  <span style={{ flexShrink: 0 }}>NEARBY:</span>
                  {candidates.filter(c => c.status === 'labeled' && Math.abs(c.peakTime - current.peakTime) < 10).length === 0
                    ? <span>no labeled signals nearby</span>
                    : candidates.filter(c => c.status === 'labeled' && Math.abs(c.peakTime - current.peakTime) < 10).map(c => (
                        <span key={c.id} style={{ color: '#555', flexShrink: 0 }}>✓ {fmt(c.peakTime)}</span>
                      ))
                  }
                </div>

                {/* Wrestler selector + period */}
                <div style={{ padding: '10px 14px', background: '#0d0d1a', borderBottom: '1px solid #1a1a2e', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, color: '#555' }}>AWARD TO:</span>
                  <button onClick={() => setWrestler('red')} style={{ ...btn, background: wrestler === 'red' ? '#cc2222' : 'transparent', color: wrestler === 'red' ? '#fff' : '#ff4444', borderColor: '#ff4444', padding: '5px 14px' }}>{redName || 'RED'}</button>
                  <button onClick={() => setWrestler('green')} style={{ ...btn, background: wrestler === 'green' ? '#007733' : 'transparent', color: wrestler === 'green' ? '#fff' : '#00cc66', borderColor: '#00cc66', padding: '5px 14px' }}>{greenName || 'GREEN'}</button>
                  <span style={{ fontSize: 10, color: '#555', marginLeft: 8 }}>PERIOD:</span>
                  {[1,2,3].map(p => <button key={p} onClick={() => setPeriod(p)} style={{ ...btn, background: period === p ? '#ff0055' : 'transparent', color: period === p ? '#fff' : '#555', padding: '5px 10px', width: 32 }}>{p}</button>)}
                  <span style={{ fontSize: 10, color: '#555', marginLeft: 8 }}>CONF:</span>
                  {[3,4,5].map(n => <button key={n} onClick={() => setConfidence(n)} style={{ ...btn, background: confidence === n ? '#ff0055' : 'transparent', color: confidence === n ? '#fff' : '#555', padding: '5px 10px', width: 28 }}>{n}</button>)}
                </div>

                {/* Signal picker or action buttons */}
                {!showSignalPicker ? (
                  <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 10, color: '#555', letterSpacing: 2, marginBottom: 4 }}>
                      IS THIS A REF SIGNAL? Watch the loop above.
                    </div>
                    <button onClick={() => setShowSignalPicker(true)} style={{ ...primaryBtn, fontSize: 14, padding: '14px 0' }}>
                      ✓ YES — SELECT SIGNAL
                    </button>
                    <button onClick={skipCurrent} style={{ ...btn, width: '100%', padding: '12px 0', color: '#555', fontSize: 12 }}>
                      ✗ NO — SKIP THIS MOMENT
                    </button>
                    {/* Remaining queue preview */}
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 10, color: '#333', letterSpacing: 2, marginBottom: 6 }}>UP NEXT</div>
                      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
                        {pending.slice(1, 8).map((c, i) => (
                          <div key={c.id} style={{
                            background: '#0d0d1a', border: '1px solid #1a1a2e',
                            padding: '6px 10px', flexShrink: 0, fontSize: 10,
                            color: '#444', cursor: 'pointer',
                            borderLeft: `2px solid rgba(255,0,85,${c.motionScore})`,
                          }} onClick={() => {
                            // Skip to this one
                            setCandidates(prev => {
                              const currentId = current.id
                              const targetId = c.id
                              return prev.map(p => p.id === currentId ? { ...p, status: 'skipped' } : p)
                            })
                          }}>
                            {fmt(c.peakTime)}<br />
                            <span style={{ color: '#ff0055', fontSize: 9 }}>{Math.round(c.motionScore * 100)}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <div style={{ fontSize: 11, color: '#666', letterSpacing: 2 }}>SELECT SIGNAL TYPE</div>
                      <button onClick={() => setShowSignalPicker(false)} style={{ ...btn, fontSize: 10, padding: '4px 10px', color: '#555' }}>← BACK</button>
                    </div>
                    {Object.entries(SIGNAL_GROUPS).map(([title, sigs]) => (
                      <div key={title} style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 9, color: '#333', letterSpacing: 2, marginBottom: 6 }}>{title}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {sigs.map((sig: Signal) => (
                            <button key={sig.id} onClick={() => labelCurrent(sig)} disabled={saving} style={{
                              background: 'transparent', border: `1px solid ${sig.color}`,
                              color: sig.color, padding: '7px 12px', cursor: 'pointer',
                              fontFamily: 'inherit', fontSize: 11, display: 'flex',
                              alignItems: 'center', gap: 5, opacity: saving ? 0.5 : 1,
                            }}>
                              {sig.label}
                              {sig.points > 0 && <span style={{ background: sig.color, color: '#000', padding: '0 4px', fontSize: 9, fontWeight: 'bold' }}>{sig.points}pt</span>}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
