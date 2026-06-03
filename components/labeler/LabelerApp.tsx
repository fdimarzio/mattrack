'use client'

import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { SIGNALS, SIGNAL_GROUPS, CATEGORY_COLOR, Signal } from '@/lib/signals'

const fmt = (s: number) => {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

const btn: React.CSSProperties = {
  background: 'transparent', border: '1px solid #1a1a2e', color: '#888',
  padding: '6px 12px', cursor: 'pointer', fontFamily: "'Courier New',monospace",
  fontSize: 12, letterSpacing: 1,
}
const primaryBtn: React.CSSProperties = {
  background: '#ff0055', border: 'none', color: '#fff', padding: '12px 0',
  cursor: 'pointer', fontFamily: "'Courier New',monospace", fontSize: 13,
  letterSpacing: 2, fontWeight: 'bold', width: '100%',
}
const inputStyle: React.CSSProperties = {
  background: '#0a0a0f', border: '1px solid #1a1a2e', color: '#e0e0f0',
  fontFamily: "'Courier New',monospace", fontSize: 13, padding: '6px 10px',
  outline: 'none', width: '100%',
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, color: '#555', letterSpacing: 1, marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>{children}</div>
    </div>
  )
}

function Sel({ value, onChange, opts }: { value: string | number; onChange: (v: string) => void; opts: (string | number)[] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ background: '#0a0a0f', border: '1px solid #1a1a2e', color: '#e0e0f0', fontFamily: "'Courier New',monospace", fontSize: 12, padding: '6px 8px', width: '100%' }}>
      {opts.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function Toggle({ value, onChange, labels, colors }: { value: boolean; onChange: (v: boolean) => void; labels: [string, string]; colors: [string, string] }) {
  return (
    <button onClick={() => onChange(!value)} style={{
      background: value ? colors[1] + '22' : 'transparent',
      border: `1px solid ${value ? colors[1] : colors[0]}`,
      color: value ? colors[1] : colors[0], padding: '8px 16px',
      cursor: 'pointer', fontFamily: "'Courier New',monospace", fontSize: 12, letterSpacing: 1,
    }}>{value ? labels[1] : labels[0]}</button>
  )
}

interface SavedLabel {
  id: string
  signal_label: string
  signal_id: string
  signal_category: string
  start_frame: number
  end_frame: number
  points_awarded: number
  awarded_to: string | null
  has_whistle: boolean
  whistle_source_confirmed: boolean
  label_confidence: number
  is_negative_sample: boolean
  period: number
  signal: Signal
}

interface MatchData {
  red_name: string
  green_name: string
  weight_class: string
  event_name: string
  total_periods: number
}

interface ExistingMatch {
  id: string
  red_name: string
  green_name: string
  event_name: string
  video_id: string
  mattrack_videos: { filename: string }
}

type MarkMode = 'start' | 'peak' | 'end'
type Step = 'home' | 'video' | 'resume_or_new' | 'match' | 'labeling' | 'mark_frames' | 'bbox' | 'whistle' | 'meta'

export default function LabelerApp() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [videoSrc, setVideoSrc] = useState<string | null>(null)
  const [videoName, setVideoName] = useState('')
  const [duration, setDuration] = useState(0)
  const fps = 30
  const [currentFrame, setCurrentFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)

  const [videoId, setVideoId] = useState<string | null>(null)
  const [matchId, setMatchId] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [matchData, setMatchData] = useState<MatchData>({
    red_name: 'Wrestler A', green_name: 'Wrestler B',
    weight_class: '', event_name: '', total_periods: 3,
  })
  const [existingMatches, setExistingMatches] = useState<ExistingMatch[]>([])
  const [recentMatches, setRecentMatches] = useState<ExistingMatch[]>([])
  const [currentMatchName, setCurrentMatchName] = useState('')

  const [step, setStep] = useState<Step>('home')
  const [pendingSignal, setPendingSignal] = useState<Signal | null>(null)
  const [startFrame, setStartFrame] = useState<number | null>(null)
  const [peakFrame, setPeakFrame] = useState<number | null>(null)
  const [endFrame, setEndFrame] = useState<number | null>(null)
  const [markMode, setMarkMode] = useState<MarkMode>('start')

  const [bbox, setBbox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null)
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null)

  const [wrestler, setWrestler] = useState<'red' | 'green'>('red')
  const [period, setPeriod] = useState(1)
  const [confidence, setConfidence] = useState(3)
  const [isNegative, setIsNegative] = useState(false)
  const [isOccluded, setIsOccluded] = useState(false)
  const [isAmbiguous, setIsAmbiguous] = useState(false)
  const [lightingQuality, setLightingQuality] = useState('good')
  const [refDistance, setRefDistance] = useState('medium')
  const [reviewNotes, setReviewNotes] = useState('')
  const [hasWhistle, setHasWhistle] = useState(false)
  const [whistleConfidence, setWhistleConfidence] = useState(0.5)
  const [whistleSourceConfirmed, setWhistleSourceConfirmed] = useState(false)
  const [whistleMethod, setWhistleMethod] = useState('ambiguous')
  const [ambientWhistleCount, setAmbientWhistleCount] = useState(0)

  const [cameraAngle, setCameraAngle] = useState('broadcast')
  const [venueType, setVenueType] = useState('tournament_multi_mat')
  const [ambientDensity, setAmbientDensity] = useState('high')
  const [matCount, setMatCount] = useState(20)

  const [savedLabels, setSavedLabels] = useState<SavedLabel[]>([])
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null)
  const [totalLabels, setTotalLabels] = useState(0)

  // active panel on mobile: 'video' | 'signals' | 'log'
  const [mobileTab, setMobileTab] = useState<'video' | 'signals' | 'log'>('video')

  const showToast = (msg: string, type = 'ok') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  // Load recent matches on mount
  useEffect(() => {
    supabase
      .from('mattrack_matches')
      .select('id, red_name, green_name, event_name, video_id, mattrack_videos(filename)')
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => setRecentMatches((data || []) as unknown as ExistingMatch[]))
  }, [])

  const endSession = async () => {
    if (sessionId) {
      await supabase.from('mattrack_labeling_sessions')
        .update({ last_active_at: new Date().toISOString(), labels_created: totalLabels })
        .eq('id', sessionId)
    }
    setVideoSrc(null); setVideoId(null); setMatchId(null); setSessionId(null)
    setSavedLabels([]); setTotalLabels(0); setCurrentMatchName('')
    setPendingSignal(null); setStep('home'); setMobileTab('video')
    showToast('Session saved ✓')
    const { data } = await supabase
      .from('mattrack_matches')
      .select('id, red_name, green_name, event_name, video_id, mattrack_videos(filename)')
      .order('created_at', { ascending: false })
      .limit(10)
    setRecentMatches((data || []) as unknown as ExistingMatch[])
  }

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const handler = () => setCurrentFrame(Math.round((video.currentTime || 0) * fps))
    video.addEventListener('timeupdate', handler)
    return () => video.removeEventListener('timeupdate', handler)
  }, [videoSrc])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || step !== 'bbox') return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (drawing && drawStart && drawCurrent) {
      const x = Math.min(drawStart.x, drawCurrent.x), y = Math.min(drawStart.y, drawCurrent.y)
      const w = Math.abs(drawCurrent.x - drawStart.x), h = Math.abs(drawCurrent.y - drawStart.y)
      ctx.strokeStyle = '#ff0055'; ctx.lineWidth = 2; ctx.setLineDash([4, 4])
      ctx.strokeRect(x * canvas.width, y * canvas.height, w * canvas.width, h * canvas.height)
      ctx.setLineDash([])
    }
    if (bbox) {
      ctx.strokeStyle = '#00ff88'; ctx.lineWidth = 2
      ctx.strokeRect(bbox.x * canvas.width, bbox.y * canvas.height, bbox.w * canvas.width, bbox.h * canvas.height)
      ctx.fillStyle = '#00ff88'; ctx.font = '11px monospace'
      ctx.fillText('REF', bbox.x * canvas.width + 4, bbox.y * canvas.height + 14)
    }
  }, [bbox, drawing, drawStart, drawCurrent, step])

  const togglePlay = () => {
    if (!videoRef.current) return
    if (playing) { videoRef.current.pause(); setPlaying(false) }
    else { videoRef.current.play(); setPlaying(true) }
  }

  const seekFrame = (delta: number) => {
    if (!videoRef.current) return
    videoRef.current.currentTime = Math.max(0, Math.min(duration, videoRef.current.currentTime + delta / fps))
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setVideoSrc(URL.createObjectURL(file))
    setVideoName(file.name)
    setSavedLabels([])
    // check for existing matches with this filename
    const { data } = await supabase
      .from('mattrack_matches')
      .select('id, red_name, green_name, event_name, video_id, mattrack_videos(filename)')
      .order('created_at', { ascending: false })
      .limit(20)
    const matches = (data || []) as unknown as ExistingMatch[]
    const matching = matches.filter(m => m.mattrack_videos?.filename === file.name)
    setExistingMatches(matching)
    setStep(matching.length > 0 ? 'resume_or_new' : 'video')
  }

  const resumeMatch = async (match: ExistingMatch) => {
    setVideoId(match.video_id)
    setMatchId(match.id)
    setMatchData(m => ({ ...m, red_name: match.red_name, green_name: match.green_name, event_name: match.event_name || '' }))
    setCurrentMatchName(`${match.red_name} vs ${match.green_name}`)
    // load existing labels
    const { data } = await supabase
      .from('mattrack_signal_instances')
      .select('*')
      .eq('match_id', match.id)
      .order('start_frame', { ascending: true })
    if (data) {
      setSavedLabels(data.map((l: Record<string, unknown>) => ({ ...l, signal: SIGNALS.find(s => s.id === l.signal_id) || SIGNALS[0] })) as SavedLabel[])
      setTotalLabels(data.length)
    }
    setStep('labeling')
    setMobileTab('signals')
    showToast(`Resumed — ${data?.length || 0} existing labels loaded`)
  }

  const saveVideoRecord = async () => {
    const vid = videoRef.current
    const { data, error } = await supabase.from('mattrack_videos').insert({
      filename: videoName, duration_seconds: vid?.duration || 0, fps,
      width_px: vid?.videoWidth, height_px: vid?.videoHeight,
      camera_angle: cameraAngle, venue_type: venueType,
      ambient_whistle_density: ambientDensity, estimated_mat_count: matCount,
    }).select().single()
    if (error) { showToast('DB error: ' + error.message, 'err'); return }
    setVideoId(data.id)
    setDuration(vid?.duration || 0)
    setStep('match')
    showToast('Video registered ✓')
  }

  const saveMatchRecord = async () => {
    if (!videoId) return
    const { data, error } = await supabase.from('mattrack_matches').insert({
      video_id: videoId, ...matchData, match_start_frame: 0,
    }).select().single()
    if (error) { showToast('DB error: ' + error.message, 'err'); return }
    setMatchId(data.id)
    setCurrentMatchName(`${matchData.red_name} vs ${matchData.green_name}`)
    const { data: sess } = await supabase.from('mattrack_labeling_sessions')
      .insert({ video_id: videoId, labeler_id: 'default' }).select().single()
    setSessionId(sess?.id || null)
    setStep('labeling')
    setMobileTab('signals')
    showToast('Match created — select a signal to begin labeling')
  }

  const startLabel = (sig: Signal) => {
    if (!videoRef.current) return
    videoRef.current.pause(); setPlaying(false)
    setPendingSignal(sig)
    setStartFrame(null); setPeakFrame(null); setEndFrame(null)
    setMarkMode('start'); setBbox(null)
    setHasWhistle(sig.hasWhistle || false)
    setWhistleSourceConfirmed(false); setWhistleMethod('ambiguous')
    setAmbientWhistleCount(0); setWhistleConfidence(0.5)
    setIsNegative(false); setIsOccluded(false); setIsAmbiguous(false)
    setConfidence(3); setReviewNotes('')
    setStep('mark_frames')
    setMobileTab('video')
    showToast(`Marking: ${sig.label} — scrub to START of gesture`)
  }

  const markFrame = () => {
    const f = Math.round((videoRef.current?.currentTime || 0) * fps)
    if (markMode === 'start') {
      setStartFrame(f); setMarkMode('peak')
      showToast('Start marked at F' + f + ' — now mark PEAK frame')
    } else if (markMode === 'peak') {
      setPeakFrame(f); setMarkMode('end')
      showToast('Peak marked at F' + f + ' — now mark END frame')
    } else {
      setEndFrame(f)
      // Skip bbox on mobile (touch device) — go straight to whistle
      const isMobile = window.matchMedia('(max-width: 768px)').matches || navigator.maxTouchPoints > 0
      if (isMobile) {
        setStep('whistle')
        setMobileTab('signals')
        showToast('End marked — confirm whistle')
      } else {
        setStep('bbox')
        showToast('End marked — drag to draw box around ref (or skip)')
      }
    }
  }

  const canvasCoords = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height }
  }

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (step !== 'bbox') return
    setDrawing(true); const c = canvasCoords(e); setDrawStart(c); setDrawCurrent(c)
  }
  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => { if (!drawing) return; setDrawCurrent(canvasCoords(e)) }
  const onMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawing || !drawStart) return
    const c = canvasCoords(e)
    const x = Math.min(drawStart.x, c.x), y = Math.min(drawStart.y, c.y)
    const w = Math.abs(c.x - drawStart.x), h = Math.abs(c.y - drawStart.y)
    if (w > 0.01 && h > 0.01) { setBbox({ x, y, w, h }); setStep('whistle'); setMobileTab('signals') }
    setDrawing(false)
  }

  // Touch handlers for mobile bbox drawing
  const onTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (step !== 'bbox') return
    e.preventDefault()
    setDrawing(true); const c = canvasCoords(e); setDrawStart(c); setDrawCurrent(c)
  }
  const onTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!drawing) return
    e.preventDefault()
    setDrawCurrent(canvasCoords(e))
  }
  const onTouchEnd = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!drawing || !drawStart) return
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const touch = e.changedTouches[0]
    const c = { x: (touch.clientX - rect.left) / rect.width, y: (touch.clientY - rect.top) / rect.height }
    const x = Math.min(drawStart.x, c.x), y = Math.min(drawStart.y, c.y)
    const w = Math.abs(c.x - drawStart.x), h = Math.abs(c.y - drawStart.y)
    if (w > 0.01 && h > 0.01) { setBbox({ x, y, w, h }); setStep('whistle'); setMobileTab('signals') }
    setDrawing(false)
  }

  const saveLabel = async () => {
    if (!pendingSignal || startFrame === null || endFrame === null) return
    setSaving(true)
    const record = {
      match_id: matchId, video_id: videoId,
      start_frame: startFrame, peak_frame: peakFrame, end_frame: endFrame,
      period, signal_id: pendingSignal.id, signal_label: pendingSignal.label,
      signal_category: pendingSignal.category,
      points_awarded: isNegative ? 0 : pendingSignal.points,
      awarded_to: pendingSignal.requiresWrestler ? wrestler : null,
      is_negative_sample: isNegative,
      bbox_x: bbox?.x, bbox_y: bbox?.y, bbox_w: bbox?.w, bbox_h: bbox?.h,
      has_whistle: hasWhistle,
      whistle_confidence: hasWhistle ? whistleConfidence : null,
      whistle_source_confirmed: hasWhistle ? whistleSourceConfirmed : false,
      whistle_source_method: hasWhistle ? whistleMethod : null,
      ambient_whistle_count_nearby: ambientWhistleCount,
      label_confidence: confidence,
      is_occluded: isOccluded,
      is_ambiguous: isAmbiguous, needs_review: isAmbiguous || confidence < 2,
      review_notes: reviewNotes || null,
      camera_angle: cameraAngle, lighting_quality: lightingQuality, ref_distance: refDistance,
      labeler_id: 'default',
    }
    const { data, error } = await supabase.from('mattrack_signal_instances').insert(record).select().single()
    if (error) { showToast('Save failed: ' + error.message, 'err'); setSaving(false); return }
    if (sessionId) {
      await supabase.from('mattrack_labeling_sessions')
        .update({ labels_created: totalLabels + 1, last_active_at: new Date().toISOString() })
        .eq('id', sessionId)
    }
    setSavedLabels(prev => [{ ...record, id: data.id, signal: pendingSignal } as SavedLabel, ...prev])
    setTotalLabels(n => n + 1)
    setSaving(false)
    setPendingSignal(null)
    setStep('labeling')
    setMobileTab('signals')
    showToast(`✓ Saved: ${pendingSignal.label} — select next signal`)
  }

  const isLabeling = ['labeling', 'mark_frames', 'bbox', 'whistle', 'meta'].includes(step)

  return (
    <div style={{ minHeight: '100vh', background: '#08080f', color: '#e0e0f0', fontFamily: "'Courier New',monospace", display: 'flex', flexDirection: 'column' }}>

      {/* HEADER */}
      <div style={{ background: '#0d0d1a', borderBottom: '2px solid #ff0055', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 18, color: '#ff0055', fontWeight: 'bold', letterSpacing: 3 }}>MATTRACK</div>
          {currentMatchName && <div style={{ fontSize: 10, color: '#555' }}>{currentMatchName}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {isLabeling && <span style={{ fontSize: 11, color: '#00ff88' }}>{totalLabels} labels</span>}
          {isLabeling && (
            <button onClick={endSession} style={{ background: 'transparent', border: '1px solid #00ff88', color: '#00ff88', padding: '7px 14px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, letterSpacing: 1, fontWeight: 'bold' }}>
              ✓ END SESSION
            </button>
          )}
          {!isLabeling && (
            <button onClick={() => fileInputRef.current?.click()} style={{ background: '#ff0055', border: 'none', color: '#fff', padding: '7px 14px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, letterSpacing: 1, fontWeight: 'bold' }}>
              ↑ LOAD VIDEO
            </button>
          )}
        </div>
        <input ref={fileInputRef} type="file" accept="video/*" onChange={handleFile} style={{ display: 'none' }} />
      </div>

      {/* TOAST */}
      {toast && (
        <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', background: toast.type === 'err' ? '#ff0055' : '#00ff88', color: '#000', padding: '10px 20px', fontFamily: 'inherit', fontSize: 12, fontWeight: 'bold', zIndex: 999, borderRadius: 2, maxWidth: '90vw', textAlign: 'center' }}>
          {toast.msg}
        </div>
      )}

      {/* MOBILE TABS — only shown when labeling */}
      {isLabeling && (
        <div style={{ display: 'flex', borderBottom: '1px solid #1a1a2e', background: '#0d0d1a' }}>
          {(['video', 'signals', 'log'] as const).map(tab => (
            <button key={tab} onClick={() => setMobileTab(tab)} style={{
              flex: 1, padding: '10px 0', background: mobileTab === tab ? '#1a1a2e' : 'transparent',
              border: 'none', borderBottom: mobileTab === tab ? '2px solid #ff0055' : '2px solid transparent',
              color: mobileTab === tab ? '#fff' : '#555', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase',
            }}>{tab === 'video' ? '🎬 VIDEO' : tab === 'signals' ? '⚡ SIGNALS' : '📋 LOG'}</button>
          ))}
        </div>
      )}

      {/* ── HOME SCREEN ─────────────────────────────────── */}
      {step === 'home' && (
        <div style={{ flex: 1, padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ fontSize: 11, color: '#666', letterSpacing: 2 }}>RECENT MATCHES</div>
          {recentMatches.length === 0 && (
            <div style={{ color: '#333', fontSize: 12 }}>No sessions yet — load a video to begin</div>
          )}
          {recentMatches.map(m => (
            <button key={m.id} onClick={async () => {
              setExistingMatches([m])
              // Need file — prompt user
              setExistingMatches([m])
              showToast('Load the video file to resume this match')
              fileInputRef.current?.click()
            }} style={{
              background: '#0d0d1a', border: '1px solid #1a1a2e', color: '#e0e0f0',
              padding: '14px 16px', cursor: 'pointer', fontFamily: 'inherit',
              textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              <div style={{ fontSize: 13, fontWeight: 'bold' }}>
                {m.red_name} vs {m.green_name}
              </div>
              <div style={{ fontSize: 10, color: '#555', display: 'flex', gap: 12 }}>
                {m.event_name && <span>{m.event_name}</span>}
                <span>{m.mattrack_videos?.filename}</span>
              </div>
            </button>
          ))}
          <button onClick={() => { setStep('video'); fileInputRef.current?.click() }} style={{
            background: '#ff0055', border: 'none', color: '#fff', padding: '14px 0',
            cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
            letterSpacing: 2, fontWeight: 'bold', marginTop: 8,
          }}>+ NEW SESSION</button>
        </div>
      )}

      {/* ── VIDEO PANEL ─────────────────────────────────── */}
      <div style={{ display: (!isLabeling || mobileTab === 'video') ? 'flex' : 'none', flexDirection: 'column' }}>

        {/* Video */}
        <div style={{ position: 'relative', background: '#000', aspectRatio: '16/9', width: '100%' }}>
          {videoSrc ? (
            <>
              <video ref={videoRef} src={videoSrc} style={{ width: '100%', height: '100%', display: 'block' }}
                onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
                onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
              <canvas ref={canvasRef} width={1280} height={720}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: step === 'bbox' ? 'crosshair' : 'default' }}
                onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
                onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} />
            </>
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, minHeight: 200 }}>
              <div style={{ fontSize: 40, opacity: 0.2 }}>🎬</div>
              <div style={{ color: '#333', letterSpacing: 2, fontSize: 12 }}>LOAD VIDEO TO BEGIN</div>
              <button onClick={() => fileInputRef.current?.click()} style={{ background: '#ff0055', border: 'none', color: '#fff', padding: '10px 24px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>SELECT FILE</button>
            </div>
          )}
          {videoSrc && (
            <div style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(0,0,0,0.85)', padding: '3px 8px', fontSize: 12, fontWeight: 'bold' }}>
              {fmt(currentFrame / fps)} <span style={{ color: '#555', fontSize: 10 }}>F:{currentFrame}</span>
            </div>
          )}
          {step === 'bbox' && (
            <div style={{ position: 'absolute', bottom: 8, left: 8, right: 8, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
              <div style={{ background: 'rgba(255,0,85,0.95)', color: '#fff', padding: '6px 16px', fontSize: 12, fontWeight: 'bold' }}>
                DRAG TO BOX THE REF
              </div>
              <button onClick={() => { setStep('whistle'); setMobileTab('signals') }}
                style={{ background: 'rgba(0,0,0,0.85)', border: '1px solid #555', color: '#aaa', padding: '6px 20px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, letterSpacing: 1 }}>
                SKIP BBOX →
              </button>
            </div>
          )}
        </div>

        {/* Scrubber */}
        {videoSrc && (
          <div style={{ padding: '8px 14px', background: '#0d0d1a' }}>
            <div style={{ position: 'relative', height: 32, cursor: 'pointer' }}
              onClick={e => { const r = e.currentTarget.getBoundingClientRect(); if (videoRef.current) videoRef.current.currentTime = ((e.clientX - r.left) / r.width) * duration }}>
              <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 4, background: '#1a1a2e', transform: 'translateY(-50%)', borderRadius: 2 }} />
              <div style={{ position: 'absolute', top: '50%', left: 0, height: 4, background: '#ff0055', transform: 'translateY(-50%)', borderRadius: 2, width: `${(currentFrame / (duration * fps || 1)) * 100}%` }} />
              {savedLabels.map((l, i) => (
                <div key={i} title={l.signal_label}
                  style={{ position: 'absolute', top: '50%', transform: 'translate(-50%,-50%)', left: `${(l.start_frame / (duration * fps || 1)) * 100}%`, width: 10, height: 10, borderRadius: '50%', background: CATEGORY_COLOR[l.signal_category as keyof typeof CATEGORY_COLOR] || '#fff', border: '1px solid #000', cursor: 'pointer', zIndex: 2 }}
                  onClick={e => { e.stopPropagation(); if (videoRef.current) videoRef.current.currentTime = l.start_frame / fps }} />
              ))}
              {startFrame !== null && (
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${(startFrame / (duration * fps || 1)) * 100}%`, width: endFrame ? `${((endFrame - startFrame) / (duration * fps || 1)) * 100}%` : 3, background: 'rgba(0,255,136,0.3)', borderLeft: '2px solid #00ff88' }} />
              )}
              <div style={{ position: 'absolute', top: '50%', transform: 'translate(-50%,-50%)', left: `${(currentFrame / (duration * fps || 1)) * 100}%`, width: 14, height: 14, borderRadius: '50%', background: '#fff', border: '2px solid #ff0055', zIndex: 3 }} />
            </div>
          </div>
        )}

        {/* Playback controls */}
        {videoSrc && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 14px', background: '#0d0d1a', borderBottom: '1px solid #1a1a2e', flexWrap: 'wrap' }}>
            <button onClick={() => seekFrame(-30)} style={btn}>«1s</button>
            <button onClick={() => seekFrame(-5)} style={btn}>«5f</button>
            <button onClick={() => seekFrame(-1)} style={btn}>‹</button>
            <button onClick={togglePlay} style={{ ...btn, background: '#ff0055', color: '#fff', width: 44, fontSize: 16 }}>{playing ? '⏸' : '▶'}</button>
            <button onClick={() => seekFrame(1)} style={btn}>›</button>
            <button onClick={() => seekFrame(5)} style={btn}>5f›</button>
            <button onClick={() => seekFrame(30)} style={btn}>1s»</button>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
              {[0.25, 0.5, 1, 2].map(r => (
                <button key={r} onClick={() => { setSpeed(r); if (videoRef.current) videoRef.current.playbackRate = r }}
                  style={{ ...btn, background: speed === r ? '#ff0055' : 'transparent', color: speed === r ? '#fff' : '#555', padding: '4px 8px', fontSize: 11 }}>{r}x</button>
              ))}
            </div>
          </div>
        )}

        {/* MARK FRAME button — big, easy to tap */}
        {step === 'mark_frames' && pendingSignal && (
          <div style={{ padding: 16, background: '#0d0d1a', borderBottom: '1px solid #1a1a2e' }}>
            <div style={{ color: pendingSignal.color, fontSize: 15, fontWeight: 'bold', marginBottom: 4 }}>{pendingSignal.label}</div>
            <div style={{ fontSize: 11, color: '#666', marginBottom: 12 }}>
              Scrub to <strong style={{ color: '#ff0055' }}>{markMode.toUpperCase()}</strong> of gesture
              {pendingSignal.notes && <span style={{ color: '#444' }}> — {pendingSignal.notes}</span>}
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {(['start', 'peak', 'end'] as MarkMode[]).map((m, i) => {
                const frameVal = i === 0 ? startFrame : i === 1 ? peakFrame : endFrame
                const done = frameVal !== null
                const active = markMode === m
                return (
                  <div key={m} style={{ flex: 1, textAlign: 'center', padding: '8px 4px', background: done ? '#0d2e0d' : active ? '#1a1a2e' : '#0d0d1a', border: `1px solid ${done ? '#00ff88' : active ? '#ff0055' : '#222'}`, fontSize: 10, color: done ? '#00ff88' : active ? '#ff0055' : '#444' }}>
                    {done ? `✓ ${m.toUpperCase()}\nF${frameVal}` : m.toUpperCase()}
                  </div>
                )
              })}
            </div>
            <button onClick={markFrame} style={{ ...primaryBtn, fontSize: 16, padding: '14px 0' }}>
              ● MARK {markMode.toUpperCase()} — F:{currentFrame}
            </button>
            <button onClick={() => { setPendingSignal(null); setStep('labeling') }} style={{ ...btn, width: '100%', color: '#f87171', borderColor: '#f87171', marginTop: 8, padding: '10px 0' }}>CANCEL</button>
          </div>
        )}

        {/* SETUP PANELS — video env + match metadata */}
        {step === 'video' && videoSrc && (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 11, color: '#666', letterSpacing: 2, marginBottom: 4 }}>STEP 1 — VIDEO ENVIRONMENT</div>
            <Row label="Camera Angle"><Sel value={cameraAngle} onChange={setCameraAngle} opts={['broadcast', 'side', 'corner', 'overhead', 'unknown']} /></Row>
            <Row label="Venue Type"><Sel value={venueType} onChange={setVenueType} opts={['tournament_multi_mat', 'single_mat_gym', 'arena', 'unknown']} /></Row>
            <Row label="Whistle Density"><Sel value={ambientDensity} onChange={setAmbientDensity} opts={['low', 'medium', 'high', 'extreme']} /></Row>
            <Row label="# Mats Audible"><input type="number" value={matCount} onChange={e => setMatCount(+e.target.value)} style={{ ...inputStyle, width: 80 }} /></Row>
            <button onClick={saveVideoRecord} style={{ ...primaryBtn, marginTop: 8 }}>REGISTER VIDEO →</button>
          </div>
        )}

        {step === 'resume_or_new' && (
          <div style={{ padding: 16 }}>
            <div style={{ fontSize: 11, color: '#666', letterSpacing: 2, marginBottom: 12 }}>THIS VIDEO HAS EXISTING SESSIONS</div>
            {existingMatches.map(m => (
              <button key={m.id} onClick={() => resumeMatch(m)} style={{ ...primaryBtn, marginBottom: 8, background: '#1a2e1a', border: '1px solid #00ff88', color: '#00ff88' }}>
                ▶ RESUME: {m.red_name} vs {m.green_name}{m.event_name ? ` — ${m.event_name}` : ''}
              </button>
            ))}
            <button onClick={() => setStep('video')} style={{ ...btn, width: '100%', padding: '12px 0', marginTop: 4 }}>+ NEW SESSION FOR THIS VIDEO</button>
          </div>
        )}

        {step === 'match' && (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 11, color: '#666', letterSpacing: 2, marginBottom: 4 }}>STEP 2 — MATCH METADATA</div>
            <Row label="Red Wrestler"><input value={matchData.red_name} onChange={e => setMatchData(p => ({ ...p, red_name: e.target.value }))} style={inputStyle} /></Row>
            <Row label="Green Wrestler"><input value={matchData.green_name} onChange={e => setMatchData(p => ({ ...p, green_name: e.target.value }))} style={inputStyle} /></Row>
            <Row label="Weight Class"><input value={matchData.weight_class} onChange={e => setMatchData(p => ({ ...p, weight_class: e.target.value }))} style={{ ...inputStyle, width: '100%' }} placeholder="e.g. 157" /></Row>
            <Row label="Event Name"><input value={matchData.event_name} onChange={e => setMatchData(p => ({ ...p, event_name: e.target.value }))} style={inputStyle} /></Row>
            <Row label="Periods"><Sel value={matchData.total_periods} onChange={v => setMatchData(p => ({ ...p, total_periods: +v }))} opts={[2, 3]} /></Row>
            <button onClick={saveMatchRecord} style={{ ...primaryBtn, marginTop: 8 }}>START LABELING →</button>
          </div>
        )}
      </div>

      {/* ── SIGNALS PANEL ─────────────────────────────── */}
      <div style={{ display: (!isLabeling || mobileTab === 'signals') ? 'flex' : 'none', flexDirection: 'column', flex: 1, overflowY: 'auto' }}>

        {/* Whistle step */}
        {step === 'whistle' && (
          <div style={{ padding: 16, borderBottom: '1px solid #1a1a2e', background: '#0d0d1a' }}>
            <div style={{ fontSize: 11, color: '#fb923c', letterSpacing: 2, marginBottom: 12 }}>🔊 WHISTLE CONFIRMATION</div>
            <Row label="Whistle heard?"><Toggle value={hasWhistle} onChange={setHasWhistle} labels={['NO', 'YES']} colors={['#555', '#fb923c']} /></Row>
            {hasWhistle && <>
              <Row label="From THIS mat?"><Toggle value={whistleSourceConfirmed} onChange={setWhistleSourceConfirmed} labels={['UNCERTAIN', 'CONFIRMED']} colors={['#f87171', '#00ff88']} /></Row>
              <Row label="Source"><Sel value={whistleMethod} onChange={setWhistleMethod} opts={['ambiguous', 'manual_verified', 'gesture_correlated', 'spatial_audio']} /></Row>
              <Row label="Nearby whistles">
                <input type="number" min={0} value={ambientWhistleCount} onChange={e => setAmbientWhistleCount(+e.target.value)} style={{ ...inputStyle, width: 80 }} />
                <span style={{ color: '#444', fontSize: 11 }}>other mats</span>
              </Row>
            </>}
            <button onClick={() => setStep('meta')} style={{ ...primaryBtn, marginTop: 12 }}>NEXT → QUALITY</button>
          </div>
        )}

        {/* Meta/quality step */}
        {step === 'meta' && (
          <div style={{ padding: 16, borderBottom: '1px solid #1a1a2e', background: '#0d0d1a' }}>
            <div style={{ fontSize: 11, color: '#666', letterSpacing: 2, marginBottom: 12 }}>LABEL QUALITY</div>
            {pendingSignal?.requiresWrestler && (
              <Row label="Awarded To">
                <button onClick={() => setWrestler('red')} style={{ flex: 1, padding: '10px', background: wrestler === 'red' ? '#cc3333' : 'transparent', border: '1px solid #ff4444', color: wrestler === 'red' ? '#fff' : '#ff4444', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 'bold', fontSize: 12 }}>{matchData.red_name}</button>
                <button onClick={() => setWrestler('green')} style={{ flex: 1, padding: '10px', background: wrestler === 'green' ? '#009944' : 'transparent', border: '1px solid #00cc66', color: wrestler === 'green' ? '#fff' : '#00cc66', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 'bold', fontSize: 12, marginLeft: 8 }}>{matchData.green_name}</button>
              </Row>
            )}
            <Row label="Period">
              {[1, 2, 3].map(p => <button key={p} onClick={() => setPeriod(p)} style={{ ...btn, background: period === p ? '#ff0055' : 'transparent', color: period === p ? '#fff' : '#666', width: 40, padding: '8px 0' }}>{p}</button>)}
            </Row>
            <Row label="Confidence (1-5)">
              {[1, 2, 3, 4, 5].map(n => <button key={n} onClick={() => setConfidence(n)} style={{ ...btn, background: confidence === n ? '#ff0055' : 'transparent', color: confidence === n ? '#fff' : '#666', width: 36, padding: '8px 0' }}>{n}</button>)}
            </Row>
            <Row label="Flags">
              <Toggle value={isNegative} onChange={setIsNegative} labels={['POSITIVE', 'NEGATIVE']} colors={['#00ff88', '#f87171']} />
              <Toggle value={isOccluded} onChange={setIsOccluded} labels={['CLEAR', 'OCCLUDED']} colors={['#555', '#fbbf24']} />
              <Toggle value={isAmbiguous} onChange={setIsAmbiguous} labels={['CLEAR', 'AMBIGUOUS']} colors={['#555', '#fbbf24']} />
            </Row>
            <Row label="Lighting"><Sel value={lightingQuality} onChange={setLightingQuality} opts={['excellent', 'good', 'fair', 'poor']} /></Row>
            <Row label="Ref Distance"><Sel value={refDistance} onChange={setRefDistance} opts={['close', 'medium', 'far']} /></Row>
            <Row label="Notes"><textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} placeholder="Optional notes about this label..." /></Row>
            <button onClick={saveLabel} disabled={saving} style={{ ...primaryBtn, marginTop: 8, opacity: saving ? 0.5 : 1, fontSize: 14, padding: '14px 0' }}>
              {saving ? 'SAVING…' : '✓ SAVE TO DATABASE'}
            </button>
          </div>
        )}

        {/* Signal chooser */}
        {(step === 'labeling') && (
          <div style={{ padding: 14, overflowY: 'auto' }}>
            <div style={{ fontSize: 10, color: '#555', letterSpacing: 2, marginBottom: 12 }}>TAP A SIGNAL TO BEGIN LABELING</div>
            {Object.entries(SIGNAL_GROUPS).map(([title, sigs]) => (
              <div key={title} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: '#444', letterSpacing: 2, marginBottom: 6, paddingBottom: 4, borderBottom: '1px solid #111' }}>{title}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {sigs.map((sig: Signal) => (
                    <button key={sig.id} onClick={() => startLabel(sig)} style={{
                      background: 'transparent', border: `1px solid ${sig.color}`, color: sig.color,
                      padding: '8px 12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11,
                      display: 'flex', alignItems: 'center', gap: 5, letterSpacing: 0.5,
                    }}>
                      {sig.label}
                      {sig.points > 0 && <span style={{ background: sig.color, color: '#000', padding: '1px 5px', fontSize: 10, fontWeight: 'bold', borderRadius: 2 }}>+{sig.points}</span>}
                      {sig.hasWhistle && <span style={{ fontSize: 11 }}>🔊</span>}
                      {sig.fingers && <span style={{ color: sig.color, fontSize: 10 }}>✌{sig.fingers}</span>}
                      {sig.hand && <span style={{ color: '#555', fontSize: 9 }}>{sig.hand[0].toUpperCase()}</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── LOG PANEL ─────────────────────────────────── */}
      <div style={{ display: (!isLabeling || mobileTab === 'log') ? 'flex' : 'none', flexDirection: 'column', flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid #111', fontSize: 10, color: '#444', letterSpacing: 2 }}>
          {totalLabels} LABELS THIS SESSION
        </div>
        {savedLabels.length === 0
          ? <div style={{ padding: 24, textAlign: 'center', color: '#2a2a3a', fontSize: 11 }}>NO LABELS YET</div>
          : savedLabels.map((l, i) => (
            <div key={i} onClick={() => { if (videoRef.current) { videoRef.current.currentTime = l.start_frame / fps; setMobileTab('video') } }}
              style={{ padding: '10px 14px', borderBottom: '1px solid #111', cursor: 'pointer', display: 'flex', gap: 10, borderLeft: `3px solid ${CATEGORY_COLOR[l.signal_category as keyof typeof CATEGORY_COLOR] || '#fff'}` }}>
              <div style={{ minWidth: 55 }}>
                <div style={{ fontSize: 12, fontWeight: 'bold', color: '#fff' }}>{fmt(l.start_frame / fps)}</div>
                <div style={{ fontSize: 9, color: '#444' }}>F{l.start_frame}→{l.end_frame}</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ color: l.signal?.color || '#fff', fontSize: 11, fontWeight: 'bold' }}>{l.signal_label}</span>
                  {l.points_awarded > 0 && <span style={{ background: l.signal?.color, color: '#000', padding: '0 4px', fontSize: 9, fontWeight: 'bold' }}>+{l.points_awarded}</span>}
                  {l.is_negative_sample && <span style={{ color: '#f87171', fontSize: 9, border: '1px solid #f87171', padding: '0 3px' }}>NEG</span>}
                  {l.has_whistle && <span style={{ color: '#fb923c', fontSize: 10 }}>🔊{l.whistle_source_confirmed ? '✓' : '?'}</span>}
                  <span style={{ color: '#444', fontSize: 9 }}>{l.label_confidence}/5</span>
                </div>
                {l.awarded_to && <div style={{ fontSize: 9, color: l.awarded_to === 'red' ? '#ff4444' : '#00cc66', marginTop: 2 }}>{l.awarded_to === 'red' ? matchData.red_name : matchData.green_name}</div>}
              </div>
              <div style={{ fontSize: 9, color: '#333' }}>P{l.period}</div>
            </div>
          ))
        }
      </div>
    </div>
  )
}
