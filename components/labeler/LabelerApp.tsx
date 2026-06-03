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
  padding: '4px 10px', cursor: 'pointer', fontFamily: "'Courier New',monospace",
  fontSize: 11, letterSpacing: 1,
}
const primaryBtn: React.CSSProperties = {
  background: '#ff0055', border: 'none', color: '#fff', padding: '9px 0',
  cursor: 'pointer', fontFamily: "'Courier New',monospace", fontSize: 12,
  letterSpacing: 2, fontWeight: 'bold', width: '100%',
}
const inputStyle: React.CSSProperties = {
  background: '#0a0a0f', border: '1px solid #1a1a2e', color: '#e0e0f0',
  fontFamily: "'Courier New',monospace", fontSize: 11, padding: '4px 8px', outline: 'none',
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
      <div style={{ minWidth: 130, fontSize: 10, color: '#555', letterSpacing: 1 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, flexWrap: 'wrap' }}>{children}</div>
    </div>
  )
}

function Sel({ value, onChange, opts }: { value: string | number; onChange: (v: string) => void; opts: (string | number)[] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ background: '#0a0a0f', border: '1px solid #1a1a2e', color: '#e0e0f0', fontFamily: "'Courier New',monospace", fontSize: 11, padding: '3px 6px' }}>
      {opts.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function Toggle({ value, onChange, labels, colors }: { value: boolean; onChange: (v: boolean) => void; labels: [string, string]; colors: [string, string] }) {
  return (
    <button onClick={() => onChange(!value)} style={{
      background: 'transparent', border: `1px solid ${value ? colors[1] : colors[0]}`,
      color: value ? colors[1] : colors[0], padding: '4px 10px',
      cursor: 'pointer', fontFamily: "'Courier New',monospace", fontSize: 10, letterSpacing: 1,
    }}>{value ? labels[1] : labels[0]}</button>
  )
}

function ConfBar({ value, onChange, steps, labels }: { value: number; onChange: (v: number) => void; steps: number[]; labels: string[] }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {steps.map((s, i) => (
        <button key={s} onClick={() => onChange(s)} title={labels[i]} style={{
          background: value === s ? '#ff0055' : 'transparent',
          border: `1px solid ${value === s ? '#ff0055' : '#222'}`,
          color: value === s ? '#fff' : '#555', padding: '3px 8px',
          cursor: 'pointer', fontFamily: "'Courier New',monospace", fontSize: 10,
        }}>{labels[i]}</button>
      ))}
    </div>
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

type MarkMode = 'start' | 'peak' | 'end'

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

  const [step, setStep] = useState<'video' | 'match' | 'mark_frames' | 'bbox' | 'whistle' | 'meta'>('video')
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
  const [occlusionPct, setOcclusionPct] = useState(0)
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

  const showToast = (msg: string, type = 'ok') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
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
      const x = Math.min(drawStart.x, drawCurrent.x)
      const y = Math.min(drawStart.y, drawCurrent.y)
      const w = Math.abs(drawCurrent.x - drawStart.x)
      const h = Math.abs(drawCurrent.y - drawStart.y)
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

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setVideoSrc(URL.createObjectURL(file))
    setVideoName(file.name)
    setSavedLabels([])
    setVideoId(null)
    setMatchId(null)
    setStep('video')
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
    const { data: sess } = await supabase.from('mattrack_labeling_sessions')
      .insert({ video_id: videoId, labeler_id: 'default' }).select().single()
    setSessionId(sess?.id || null)
    setStep('mark_frames')
    showToast('Match created ✓')
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
  }

  const markFrame = () => {
    const f = Math.round((videoRef.current?.currentTime || 0) * fps)
    if (markMode === 'start') { setStartFrame(f); setMarkMode('peak'); showToast('Start marked F' + f) }
    else if (markMode === 'peak') { setPeakFrame(f); setMarkMode('end'); showToast('Peak marked F' + f) }
    else { setEndFrame(f); setStep('bbox'); showToast('End marked — draw bbox') }
  }

  const canvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height }
  }

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (step !== 'bbox') return
    setDrawing(true); const c = canvasCoords(e); setDrawStart(c); setDrawCurrent(c)
  }
  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawing) return; setDrawCurrent(canvasCoords(e))
  }
  const onMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawing || !drawStart) return
    const c = canvasCoords(e)
    const x = Math.min(drawStart.x, c.x), y = Math.min(drawStart.y, c.y)
    const w = Math.abs(c.x - drawStart.x), h = Math.abs(c.y - drawStart.y)
    if (w > 0.01 && h > 0.01) { setBbox({ x, y, w, h }); setStep('whistle') }
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
      is_occluded: isOccluded, occlusion_pct: isOccluded ? occlusionPct : 0,
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
    setStep('mark_frames')
    showToast(`✓ Saved: ${pendingSignal.label} [F${startFrame}→F${endFrame}]`)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#08080f', color: '#e0e0f0', fontFamily: "'Courier New',monospace", display: 'flex', flexDirection: 'column' }}>

      {/* HEADER */}
      <div style={{ background: '#0d0d1a', borderBottom: '2px solid #ff0055', padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 20, color: '#ff0055', fontWeight: 'bold', letterSpacing: 3 }}>MATTRACK</div>
          <div style={{ fontSize: 9, color: '#444', letterSpacing: 2 }}>ML LABELING v2.0</div>
        </div>
        <div style={{ fontSize: 11, color: '#555' }}>
          SESSION LABELS: <span style={{ color: '#00ff88' }}>{totalLabels}</span>
        </div>
        <button onClick={() => fileInputRef.current?.click()} style={{ background: '#ff0055', border: 'none', color: '#fff', padding: '7px 14px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, letterSpacing: 1, fontWeight: 'bold' }}>
          ↑ LOAD VIDEO
        </button>
        <input ref={fileInputRef} type="file" accept="video/*" onChange={handleFile} style={{ display: 'none' }} />
      </div>

      {toast && (
        <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', background: toast.type === 'err' ? '#ff0055' : '#00ff88', color: '#000', padding: '8px 20px', fontFamily: 'inherit', fontSize: 12, fontWeight: 'bold', zIndex: 999 }}>
          {toast.msg}
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* LEFT: video */}
        <div style={{ flex: '0 0 58%', display: 'flex', flexDirection: 'column', borderRight: '1px solid #1a1a2e' }}>

          <div style={{ position: 'relative', background: '#000', aspectRatio: '16/9' }}>
            {videoSrc ? (
              <>
                <video ref={videoRef} src={videoSrc} style={{ width: '100%', height: '100%', display: 'block' }}
                  onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
                  onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
                <canvas ref={canvasRef} width={1280} height={720}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: step === 'bbox' ? 'crosshair' : 'default' }}
                  onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} />
              </>
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 40, opacity: 0.2 }}>🎬</div>
                <div style={{ color: '#333', letterSpacing: 2, fontSize: 11 }}>LOAD VIDEO TO BEGIN</div>
                <button onClick={() => fileInputRef.current?.click()} style={{ background: '#ff0055', border: 'none', color: '#fff', padding: '8px 20px', cursor: 'pointer', fontFamily: 'inherit' }}>SELECT FILE</button>
              </div>
            )}
            {videoSrc && (
              <div style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(0,0,0,0.85)', padding: '3px 8px', fontSize: 13, fontWeight: 'bold' }}>
                {fmt(currentFrame / fps)} <span style={{ color: '#555', fontSize: 10 }}>F:{currentFrame}</span>
              </div>
            )}
            {step === 'bbox' && (
              <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', background: 'rgba(255,0,85,0.9)', color: '#fff', padding: '4px 14px', fontSize: 11, fontWeight: 'bold' }}>
                DRAW BOUNDING BOX AROUND REF
              </div>
            )}
          </div>

          {/* Scrubber */}
          {videoSrc && (
            <div style={{ padding: '6px 14px', background: '#0d0d1a' }}>
              <div style={{ position: 'relative', height: 28, cursor: 'pointer' }}
                onClick={e => {
                  const r = e.currentTarget.getBoundingClientRect()
                  if (videoRef.current) videoRef.current.currentTime = ((e.clientX - r.left) / r.width) * duration
                }}>
                <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 3, background: '#1a1a2e', transform: 'translateY(-50%)' }} />
                <div style={{ position: 'absolute', top: '50%', left: 0, height: 3, background: '#ff0055', transform: 'translateY(-50%)', width: `${(currentFrame / (duration * fps || 1)) * 100}%` }} />
                {savedLabels.map((l, i) => (
                  <div key={i} title={`${l.signal_label} F:${l.start_frame}`}
                    style={{ position: 'absolute', top: '50%', transform: 'translate(-50%,-50%)', left: `${(l.start_frame / (duration * fps || 1)) * 100}%`, width: 8, height: 8, borderRadius: '50%', background: CATEGORY_COLOR[l.signal_category as keyof typeof CATEGORY_COLOR] || '#fff', border: '1px solid #000', cursor: 'pointer', zIndex: 2 }}
                    onClick={e => { e.stopPropagation(); if (videoRef.current) videoRef.current.currentTime = l.start_frame / fps }} />
                ))}
                <div style={{ position: 'absolute', top: '50%', transform: 'translate(-50%,-50%)', left: `${(currentFrame / (duration * fps || 1)) * 100}%`, width: 12, height: 12, borderRadius: '50%', background: '#fff', border: '2px solid #ff0055', zIndex: 3 }} />
              </div>
            </div>
          )}

          {/* Controls */}
          {videoSrc && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', background: '#0d0d1a', borderBottom: '1px solid #1a1a2e' }}>
              <button onClick={() => seekFrame(-30)} style={btn}>«1s</button>
              <button onClick={() => seekFrame(-5)} style={btn}>«5f</button>
              <button onClick={() => seekFrame(-1)} style={btn}>‹1f</button>
              <button onClick={togglePlay} style={{ ...btn, background: '#ff0055', color: '#fff', width: 40, fontWeight: 'bold' }}>{playing ? '⏸' : '▶'}</button>
              <button onClick={() => seekFrame(1)} style={btn}>1f›</button>
              <button onClick={() => seekFrame(5)} style={btn}>5f›</button>
              <button onClick={() => seekFrame(30)} style={btn}>1s»</button>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                {[0.25, 0.5, 1, 2].map(r => (
                  <button key={r} onClick={() => { setSpeed(r); if (videoRef.current) videoRef.current.playbackRate = r }}
                    style={{ ...btn, background: speed === r ? '#ff0055' : 'transparent', color: speed === r ? '#fff' : '#555', padding: '3px 7px' }}>{r}x</button>
                ))}
              </div>
            </div>
          )}

          {/* Step panels */}
          {step === 'video' && videoSrc && (
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, flex: 1, overflowY: 'auto' }}>
              <div style={{ fontSize: 11, color: '#666', letterSpacing: 2 }}>STEP 1 — VIDEO ENVIRONMENT</div>
              <Row label="Camera Angle"><Sel value={cameraAngle} onChange={setCameraAngle} opts={['broadcast', 'side', 'corner', 'overhead', 'unknown']} /></Row>
              <Row label="Venue Type"><Sel value={venueType} onChange={setVenueType} opts={['tournament_multi_mat', 'single_mat_gym', 'arena', 'unknown']} /></Row>
              <Row label="Whistle Density"><Sel value={ambientDensity} onChange={setAmbientDensity} opts={['low', 'medium', 'high', 'extreme']} /></Row>
              <Row label="# Mats Audible"><input type="number" value={matCount} onChange={e => setMatCount(+e.target.value)} style={{ ...inputStyle, width: 60 }} /></Row>
              <button onClick={saveVideoRecord} style={primaryBtn}>REGISTER VIDEO →</button>
            </div>
          )}

          {step === 'match' && (
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, flex: 1, overflowY: 'auto' }}>
              <div style={{ fontSize: 11, color: '#666', letterSpacing: 2 }}>STEP 2 — MATCH METADATA</div>
              <Row label="Red Wrestler"><input value={matchData.red_name} onChange={e => setMatchData(p => ({ ...p, red_name: e.target.value }))} style={inputStyle} /></Row>
              <Row label="Green Wrestler"><input value={matchData.green_name} onChange={e => setMatchData(p => ({ ...p, green_name: e.target.value }))} style={inputStyle} /></Row>
              <Row label="Weight Class"><input value={matchData.weight_class} onChange={e => setMatchData(p => ({ ...p, weight_class: e.target.value }))} style={{ ...inputStyle, width: 80 }} placeholder="e.g. 157" /></Row>
              <Row label="Event Name"><input value={matchData.event_name} onChange={e => setMatchData(p => ({ ...p, event_name: e.target.value }))} style={inputStyle} /></Row>
              <Row label="Periods"><Sel value={matchData.total_periods} onChange={v => setMatchData(p => ({ ...p, total_periods: +v }))} opts={[2, 3]} /></Row>
              <button onClick={saveMatchRecord} style={primaryBtn}>START LABELING →</button>
            </div>
          )}

          {step === 'mark_frames' && pendingSignal && (
            <div style={{ padding: 16, flex: 1, overflowY: 'auto' }}>
              <div style={{ fontSize: 11, color: '#666', letterSpacing: 2, marginBottom: 8 }}>STEP 3 — MARK GESTURE FRAMES</div>
              <div style={{ color: pendingSignal.color, fontSize: 18, fontWeight: 'bold', marginBottom: 12 }}>{pendingSignal.label}</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                {(['start', 'peak', 'end'] as MarkMode[]).map((m, i) => {
                  const frameVal = i === 0 ? startFrame : i === 1 ? peakFrame : endFrame
                  const done = frameVal !== null
                  const active = markMode === m
                  return (
                    <div key={m} style={{ flex: 1, textAlign: 'center', padding: '6px 0', background: done ? '#1a2e1a' : active ? '#1a1a2e' : '#0d0d1a', border: `1px solid ${done ? '#00ff88' : active ? '#ff0055' : '#222'}`, fontSize: 10, color: done ? '#00ff88' : active ? '#ff0055' : '#444' }}>
                      {done ? `✓ ${m.toUpperCase()}\nF:${frameVal}` : m.toUpperCase()}
                    </div>
                  )
                })}
              </div>
              <button onClick={markFrame} style={{ ...primaryBtn, fontSize: 14, padding: '10px 0', marginBottom: 8 }}>
                ● MARK {markMode.toUpperCase()} (F:{currentFrame})
              </button>
              <button onClick={() => { setPendingSignal(null) }} style={{ ...btn, width: '100%', color: '#f87171', borderColor: '#f87171', marginTop: 8 }}>CANCEL</button>
            </div>
          )}

          {step === 'bbox' && (
            <div style={{ padding: 16, flex: 1 }}>
              <div style={{ fontSize: 11, color: '#666', letterSpacing: 2, marginBottom: 8 }}>STEP 4 — DRAW REF BOUNDING BOX</div>
              <div style={{ fontSize: 11, color: '#aaa', lineHeight: 1.6, marginBottom: 12 }}>Drag a box around the referee in the frame above.</div>
              {bbox && <div style={{ fontSize: 11, color: '#00ff88', marginBottom: 8 }}>✓ Box drawn</div>}
              <button onClick={() => setStep('whistle')} style={{ ...btn, width: '100%', color: '#555' }}>SKIP BBOX</button>
            </div>
          )}
        </div>

        {/* RIGHT: signal buttons + whistle/meta + log */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {step === 'whistle' && (
            <div style={{ padding: 16, borderBottom: '1px solid #1a1a2e', background: '#0d0d1a' }}>
              <div style={{ fontSize: 11, color: '#666', letterSpacing: 2, marginBottom: 10 }}>STEP 5 — WHISTLE / AUDIO</div>
              <Row label="Whistle heard?"><Toggle value={hasWhistle} onChange={setHasWhistle} labels={['NO', 'YES']} colors={['#555', '#fb923c']} /></Row>
              {hasWhistle && <>
                <Row label="From THIS mat?"><Toggle value={whistleSourceConfirmed} onChange={setWhistleSourceConfirmed} labels={['UNCERTAIN', 'CONFIRMED']} colors={['#f87171', '#00ff88']} /></Row>
                <Row label="Source Method"><Sel value={whistleMethod} onChange={setWhistleMethod} opts={['manual_verified', 'spatial_audio', 'gesture_correlated', 'ambiguous']} /></Row>
                <Row label="Whistle Confidence"><ConfBar value={whistleConfidence} onChange={setWhistleConfidence} steps={[0.1, 0.3, 0.5, 0.7, 1.0]} labels={['10%', '30%', '50%', '70%', '100%']} /></Row>
                <Row label="Other whistles ±2s">
                  <input type="number" min={0} value={ambientWhistleCount} onChange={e => setAmbientWhistleCount(+e.target.value)} style={{ ...inputStyle, width: 60 }} />
                </Row>
              </>}
              <button onClick={() => setStep('meta')} style={{ ...primaryBtn, marginTop: 10 }}>NEXT → LABEL QUALITY</button>
            </div>
          )}

          {step === 'meta' && (
            <div style={{ padding: 16, borderBottom: '1px solid #1a1a2e', background: '#0d0d1a', overflowY: 'auto', maxHeight: '55%' }}>
              <div style={{ fontSize: 11, color: '#666', letterSpacing: 2, marginBottom: 10 }}>STEP 6 — LABEL QUALITY</div>
              {pendingSignal?.requiresWrestler && (
                <Row label="Awarded To">
                  <button onClick={() => setWrestler('red')} style={{ ...btn, background: wrestler === 'red' ? '#cc3333' : 'transparent', color: wrestler === 'red' ? '#fff' : '#ff4444', border: '1px solid #ff4444', marginRight: 6 }}>{matchData.red_name}</button>
                  <button onClick={() => setWrestler('green')} style={{ ...btn, background: wrestler === 'green' ? '#009944' : 'transparent', color: wrestler === 'green' ? '#fff' : '#00cc66', border: '1px solid #00cc66' }}>{matchData.green_name}</button>
                </Row>
              )}
              <Row label="Period">{[1, 2, 3].map(p => <button key={p} onClick={() => setPeriod(p)} style={{ ...btn, background: period === p ? '#ff0055' : 'transparent', color: period === p ? '#fff' : '#666', marginRight: 4, width: 30 }}>{p}</button>)}</Row>
              <Row label="Confidence"><ConfBar value={confidence} onChange={setConfidence} steps={[1, 2, 3, 4, 5]} labels={['1', '2', '3', '4', '5']} /></Row>
              <Row label="Negative Sample?"><Toggle value={isNegative} onChange={setIsNegative} labels={['POSITIVE', 'NEGATIVE']} colors={['#00ff88', '#f87171']} /></Row>
              <Row label="Occluded?"><Toggle value={isOccluded} onChange={setIsOccluded} labels={['CLEAR', 'OCCLUDED']} colors={['#555', '#fbbf24']} /></Row>
              {isOccluded && <Row label="Occlusion %"><input type="number" min={0} max={100} value={occlusionPct} onChange={e => setOcclusionPct(+e.target.value)} style={{ ...inputStyle, width: 60 }} /></Row>}
              <Row label="Ambiguous?"><Toggle value={isAmbiguous} onChange={setIsAmbiguous} labels={['CLEAR', 'AMBIGUOUS']} colors={['#555', '#fbbf24']} /></Row>
              <Row label="Lighting"><Sel value={lightingQuality} onChange={setLightingQuality} opts={['excellent', 'good', 'fair', 'poor']} /></Row>
              <Row label="Ref Distance"><Sel value={refDistance} onChange={setRefDistance} opts={['close', 'medium', 'far']} /></Row>
              <Row label="Notes"><textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} rows={2} style={{ ...inputStyle, width: '100%', resize: 'vertical', height: 48 }} /></Row>
              <button onClick={saveLabel} disabled={saving} style={{ ...primaryBtn, marginTop: 10, opacity: saving ? 0.5 : 1 }}>
                {saving ? 'SAVING…' : '✓ SAVE TO DATABASE'}
              </button>
            </div>
          )}

          {step === 'mark_frames' && !pendingSignal && (
            <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
              <div style={{ fontSize: 11, color: '#666', letterSpacing: 2, marginBottom: 12 }}>SELECT SIGNAL TO LABEL</div>
              {Object.entries(SIGNAL_GROUPS).map(([title, sigs]) => (
                <div key={title} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 9, color: '#444', letterSpacing: 2, marginBottom: 5 }}>{title}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {sigs.map(sig => (
                      <button key={sig.id} onClick={() => startLabel(sig)} style={{ background: 'transparent', border: `1px solid ${sig.color}`, color: sig.color, padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
                        {sig.label}
                        {sig.points > 0 && <span style={{ background: sig.color, color: '#000', padding: '0 4px', fontSize: 9, fontWeight: 'bold' }}>+{sig.points}</span>}
                        {sig.hasWhistle && <span style={{ color: '#fb923c', fontSize: 9 }}>🔊</span>}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Label log */}
          <div style={{ flex: 1, overflowY: 'auto', borderTop: '1px solid #1a1a2e' }}>
            <div style={{ padding: '8px 14px', borderBottom: '1px solid #111', fontSize: 10, color: '#444', letterSpacing: 2 }}>
              LABELED THIS SESSION ({savedLabels.length})
            </div>
            {savedLabels.length === 0
              ? <div style={{ padding: 20, textAlign: 'center', color: '#2a2a3a', fontSize: 11 }}>NO LABELS YET</div>
              : savedLabels.map((l, i) => (
                <div key={i} onClick={() => { if (videoRef.current) videoRef.current.currentTime = l.start_frame / fps }}
                  style={{ padding: '8px 14px', borderBottom: '1px solid #111', cursor: 'pointer', display: 'flex', gap: 10, borderLeft: `3px solid ${CATEGORY_COLOR[l.signal_category as keyof typeof CATEGORY_COLOR] || '#fff'}` }}>
                  <div style={{ minWidth: 60 }}>
                    <div style={{ fontSize: 12, fontWeight: 'bold', color: '#fff' }}>{fmt(l.start_frame / fps)}</div>
                    <div style={{ fontSize: 9, color: '#444' }}>F{l.start_frame}→{l.end_frame}</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ color: l.signal?.color || '#fff', fontSize: 11, fontWeight: 'bold' }}>{l.signal_label}</span>
                      {l.points_awarded > 0 && <span style={{ background: l.signal?.color, color: '#000', padding: '0 3px', fontSize: 9, fontWeight: 'bold' }}>+{l.points_awarded}</span>}
                      {l.is_negative_sample && <span style={{ color: '#f87171', fontSize: 9, border: '1px solid #f87171', padding: '0 3px' }}>NEG</span>}
                      {l.has_whistle && <span style={{ color: '#fb923c', fontSize: 9 }}>🔊{l.whistle_source_confirmed ? '✓' : ''}</span>}
                    </div>
                    {l.awarded_to && <div style={{ fontSize: 9, color: l.awarded_to === 'red' ? '#ff4444' : '#00cc66', marginTop: 2 }}>{l.awarded_to === 'red' ? matchData.red_name : matchData.green_name}</div>}
                  </div>
                  <div style={{ fontSize: 9, color: '#333' }}>P{l.period}</div>
                </div>
              ))
            }
          </div>
        </div>
      </div>
    </div>
  )
}
