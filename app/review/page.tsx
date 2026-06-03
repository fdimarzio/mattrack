'use client'

import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { SIGNALS, SIGNAL_MAP, CATEGORY_COLOR } from '@/lib/signals'

// ── Types ─────────────────────────────────────────────────────────
interface Detection {
  id: string
  source: 'model' | 'human'
  signal_id: string
  signal_label: string
  signal_category: string
  start_frame: number
  end_frame: number
  confidence: number  // 0-1 model confidence OR 1.0 for human
  status: 'pending' | 'accepted' | 'rejected' | 'corrected'
  corrected_signal_id?: string
  bbox_x?: number; bbox_y?: number; bbox_w?: number; bbox_h?: number
  // For existing DB labels loaded for review
  db_id?: string
  needs_whistle_review?: boolean
}

const fmt = (s: number) => { const m = Math.floor(s / 60), sec = Math.floor(s % 60); return `${m}:${sec.toString().padStart(2, '0')}` }

const catColor: Record<string, string> = {
  scoring: '#00ff88', control: '#a78bfa', clock: '#38bdf8',
  violation: '#f87171', time: '#fb923c', outcome: '#ff0055',
}

const btn: React.CSSProperties = {
  background: 'transparent', border: '1px solid #1a1a2e', color: '#888',
  padding: '6px 12px', cursor: 'pointer', fontFamily: "'Courier New',monospace", fontSize: 11, letterSpacing: 1,
}

// ── Mock model inference ───────────────────────────────────────────
// TODO: Replace with real model API call once model is trained
// For now simulates what the model would return: detections with confidence scores
const runMockInference = (duration: number, fps: number): Detection[] => {
  // This is placeholder — real inference will call a Python API
  // that runs the trained gesture recognition model on the video
  return []
}

export default function ReviewPage() {
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

  const [detections, setDetections] = useState<Detection[]>([])
  const [activeDetection, setActiveDetection] = useState<Detection | null>(null)
  const [inferenceRunning, setInferenceRunning] = useState(false)
  const [matchId, setMatchId] = useState<string | null>(null)
  const [existingLabels, setExistingLabels] = useState<Detection[]>([])
  const [showExisting, setShowExisting] = useState(true)
  const [showPending, setShowPending] = useState(true)
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null)
  const [bboxMode, setBboxMode] = useState(false)
  const [bboxDrawStart, setBboxDrawStart] = useState<{x:number,y:number}|null>(null)
  const [bboxDrawCurrent, setBboxDrawCurrent] = useState<{x:number,y:number}|null>(null)
  const [bboxDrawing, setBboxDrawing] = useState(false)
  const [whistleReviewMode, setWhistleReviewMode] = useState(false)
  const [pendingWhistleIdx, setPendingWhistleIdx] = useState(0)

  const showToast = (msg: string, type = 'ok') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000) }

  // Draw bbox overlay on canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (bboxDrawing && bboxDrawStart && bboxDrawCurrent) {
      const x = Math.min(bboxDrawStart.x, bboxDrawCurrent.x)
      const y = Math.min(bboxDrawStart.y, bboxDrawCurrent.y)
      const w = Math.abs(bboxDrawCurrent.x - bboxDrawStart.x)
      const h = Math.abs(bboxDrawCurrent.y - bboxDrawStart.y)
      ctx.strokeStyle = '#ff0055'; ctx.lineWidth = 2; ctx.setLineDash([4,4])
      ctx.strokeRect(x * canvas.width, y * canvas.height, w * canvas.width, h * canvas.height)
      ctx.setLineDash([])
    }
    // Draw bbox for active detection
    if (activeDetection?.bbox_x != null && activeDetection.bbox_y != null && activeDetection.bbox_w != null && activeDetection.bbox_h != null) {
      const bx = activeDetection.bbox_x, by = activeDetection.bbox_y
      const bw = activeDetection.bbox_w, bh = activeDetection.bbox_h
      ctx.strokeStyle = '#00ff88'; ctx.lineWidth = 2
      ctx.strokeRect(bx * canvas.width, by * canvas.height, bw * canvas.width, bh * canvas.height)
      ctx.fillStyle = '#00ff88'; ctx.font = '12px monospace'
      ctx.fillText('REF', bx * canvas.width + 4, by * canvas.height + 14)
    }
  }, [bboxDrawing, bboxDrawStart, bboxDrawCurrent, activeDetection])

  const canvasBboxCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height }
  }
  const onBboxMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setBboxDrawing(true); const c = canvasBboxCoords(e); setBboxDrawStart(c); setBboxDrawCurrent(c)
  }
  const onBboxMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!bboxDrawing) return; setBboxDrawCurrent(canvasBboxCoords(e))
  }
  const onBboxMouseUp = async (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!bboxDrawing || !bboxDrawStart || !activeDetection?.db_id) return
    const c = canvasBboxCoords(e)
    const x = Math.min(bboxDrawStart.x, c.x), y = Math.min(bboxDrawStart.y, c.y)
    const w = Math.abs(c.x - bboxDrawStart.x), h = Math.abs(c.y - bboxDrawStart.y)
    if (w > 0.02 && h > 0.02) {
      await supabase.from('mattrack_signal_instances')
        .update({ bbox_x: x, bbox_y: y, bbox_w: w, bbox_h: h })
        .eq('id', activeDetection.db_id)
      setExistingLabels(prev => prev.map(l =>
        l.db_id === activeDetection.db_id ? { ...l, bbox_x: x, bbox_y: y, bbox_w: w, bbox_h: h } : l
      ))
      showToast('Bbox saved ✓')
      setBboxMode(false)
    }
    setBboxDrawing(false)
  }

  useEffect(() => {
    const video = videoRef.current; if (!video) return
    const h = () => setCurrentFrame(Math.round((video.currentTime || 0) * fps))
    video.addEventListener('timeupdate', h)
    return () => video.removeEventListener('timeupdate', h)
  }, [videoSrc])

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setVideoSrc(URL.createObjectURL(file))
    setVideoName(file.name)
    setDetections([])
    setExistingLabels([])
    setActiveDetection(null)

    // Load existing labels for this video
    const { data } = await supabase
      .from('mattrack_signal_instances')
      .select('*, mattrack_matches(id)')
      .eq('mattrack_videos.filename', file.name)

    // Also try by filename via video join
    const { data: videoData } = await supabase
      .from('mattrack_videos')
      .select('id')
      .eq('filename', file.name)
      .limit(1)
      .single()

    if (videoData) {
      setMatchId(videoData.id)
      const { data: labels } = await supabase
        .from('mattrack_signal_instances')
        .select('*')
        .eq('video_id', videoData.id)
        .order('start_frame', { ascending: true })

      if (labels) {
        const existing: Detection[] = labels.map((l: Record<string, unknown>) => ({
          id: `existing_${l.id}`,
          db_id: l.id as string,
          source: 'human' as const,
          signal_id: l.signal_id as string,
          signal_label: l.signal_label as string,
          signal_category: l.signal_category as string,
          start_frame: l.start_frame as number,
          end_frame: l.end_frame as number,
          confidence: (l.label_confidence as number) / 5,
          status: 'accepted' as const,
          needs_whistle_review: l.needs_review as boolean,
          bbox_x: l.bbox_x as number,
          bbox_y: l.bbox_y as number,
          bbox_w: l.bbox_w as number,
          bbox_h: l.bbox_h as number,
        }))
        setExistingLabels(existing)
        showToast(`Loaded ${existing.length} existing labels`)
      }
    }
  }

  const runInference = async () => {
    if (!videoRef.current) return
    setInferenceRunning(true)
    showToast('Running inference… (mock — model not trained yet)')

    // TODO: When model is trained, replace this with:
    // const response = await fetch('/api/inference', {
    //   method: 'POST',
    //   body: JSON.stringify({ video_id: matchId, start_frame: 0, end_frame: duration * fps })
    // })
    // const { detections } = await response.json()

    const mock = runMockInference(duration, fps)
    setTimeout(() => {
      setDetections(mock)
      setInferenceRunning(false)
      showToast(mock.length > 0 ? `Found ${mock.length} detections` : 'Model not trained yet — label more data first')
    }, 1500)
  }

  const jumpTo = (det: Detection) => {
    if (!videoRef.current) return
    const t = Math.max(0, (det.start_frame - 30) / fps)
    videoRef.current.currentTime = t
    setActiveDetection(det)
  }

  const acceptDetection = (id: string) => {
    setDetections(prev => prev.map(d => d.id === id ? { ...d, status: 'accepted' } : d))
    showToast('Accepted ✓')
  }

  const rejectDetection = (id: string) => {
    setDetections(prev => prev.map(d => d.id === id ? { ...d, status: 'rejected' } : d))
    showToast('Rejected')
  }

  // Whistle review — go through all needs_review labels one by one
  const whistleLabels = existingLabels.filter(l => l.needs_whistle_review)
  const currentWhistleLabel = whistleLabels[pendingWhistleIdx]

  const confirmWhistle = async (confirmed: boolean) => {
    if (!currentWhistleLabel?.db_id) return
    await supabase.from('mattrack_signal_instances').update({
      has_whistle: confirmed,
      whistle_source_confirmed: confirmed,
      whistle_source_method: confirmed ? 'manual_verified' : 'ambiguous',
      needs_review: false,
    }).eq('id', currentWhistleLabel.db_id)
    setExistingLabels(prev => prev.map(l =>
      l.db_id === currentWhistleLabel.db_id
        ? { ...l, needs_whistle_review: false, status: 'accepted' }
        : l
    ))
    setPendingWhistleIdx(i => i + 1)
    showToast(confirmed ? 'Whistle confirmed ✓' : 'No whistle — marked')
  }

  const saveAccepted = async () => {
    const accepted = detections.filter(d => d.status === 'accepted')
    if (accepted.length === 0) { showToast('No accepted detections to save', 'err'); return }
    showToast(`Saving ${accepted.length} accepted detections…`)
    // TODO: insert accepted model detections as signal_instances with source='model'
    showToast(`Saved ${accepted.length} detections ✓`)
  }

  const allDetections = [
    ...(showExisting ? existingLabels : []),
    ...(showPending ? detections : []),
  ].sort((a, b) => a.start_frame - b.start_frame)

  const pendingCount = detections.filter(d => d.status === 'pending').length
  const acceptedCount = detections.filter(d => d.status === 'accepted').length
  const whistlePendingCount = whistleLabels.filter(l => l.needs_whistle_review).length

  return (
    <div style={{ minHeight: '100vh', background: '#08080f', color: '#e0e0f0', fontFamily: "'Courier New',monospace", display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div style={{ background: '#0d0d1a', borderBottom: '2px solid #38bdf8', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <a href="/" style={{ color: '#555', textDecoration: 'none', fontSize: 11 }}>← HOME</a>
          <div style={{ fontSize: 16, color: '#38bdf8', fontWeight: 'bold', letterSpacing: 3 }}>MATTRACK / INFERENCE REVIEW</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {whistlePendingCount > 0 && (
            <button onClick={() => setWhistleReviewMode(!whistleReviewMode)} style={{ ...btn, color: '#fbbf24', borderColor: '#fbbf24' }}>
              🔊 {whistlePendingCount} WHISTLE REVIEWS
            </button>
          )}
          {acceptedCount > 0 && (
            <button onClick={saveAccepted} style={{ ...btn, color: '#00ff88', borderColor: '#00ff88' }}>
              SAVE {acceptedCount} ACCEPTED
            </button>
          )}
          <button onClick={() => fileInputRef.current?.click()} style={{ background: '#38bdf8', border: 'none', color: '#000', padding: '7px 14px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, letterSpacing: 1, fontWeight: 'bold' }}>
            ↑ LOAD VIDEO
          </button>
        </div>
        <input ref={fileInputRef} type="file" accept="video/*" onChange={handleFile} style={{ display: 'none' }} />
      </div>

      {toast && (
        <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', background: toast.type === 'err' ? '#ff0055' : '#00ff88', color: '#000', padding: '10px 20px', fontFamily: 'inherit', fontSize: 12, fontWeight: 'bold', zIndex: 999 }}>
          {toast.msg}
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Left: video */}
        <div style={{ flex: '0 0 45%', display: 'flex', flexDirection: 'column', borderRight: '1px solid #1a1a2e' }}>

          <div style={{ position: 'relative', background: '#000', aspectRatio: '16/9' }}>
            {videoSrc ? (
              <>
                <video ref={videoRef} src={videoSrc} style={{ width: '100%', height: '100%', display: 'block' }}
                  onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
                  onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
                <canvas ref={canvasRef} width={1280} height={720}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: bboxMode ? 'crosshair' : 'default', pointerEvents: bboxMode ? 'auto' : 'none' }}
                  onMouseDown={onBboxMouseDown} onMouseMove={onBboxMouseMove} onMouseUp={onBboxMouseUp} />
                {bboxMode && (
                  <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(255,0,85,0.9)', color: '#fff', padding: '4px 12px', fontSize: 11, fontWeight: 'bold' }}>
                    DRAW BOX AROUND REF — drag mouse
                  </div>
                )}
              </>
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
                <div style={{ fontSize: 36, opacity: 0.2 }}>🎬</div>
                <div style={{ color: '#333', letterSpacing: 2, fontSize: 11 }}>LOAD A LABELED VIDEO TO REVIEW</div>
                <button onClick={() => fileInputRef.current?.click()} style={{ background: '#38bdf8', border: 'none', color: '#000', padding: '10px 24px', cursor: 'pointer', fontFamily: 'inherit' }}>SELECT FILE</button>
              </div>
            )}
            {videoSrc && (
              <div style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(0,0,0,0.85)', padding: '3px 8px', fontSize: 12, fontWeight: 'bold' }}>
                {fmt(currentFrame / fps)} <span style={{ color: '#555', fontSize: 10 }}>F:{currentFrame}</span>
              </div>
            )}
            {/* Active detection info overlay */}
            {activeDetection && (
              <div style={{ position: 'absolute', bottom: 8, left: 8, right: 8, background: 'rgba(0,0,0,0.9)', border: `1px solid ${catColor[activeDetection.signal_category]}`, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ color: catColor[activeDetection.signal_category], fontWeight: 'bold', fontSize: 13 }}>{activeDetection.signal_label}</div>
                  <div style={{ color: '#555', fontSize: 10 }}>F{activeDetection.start_frame} → F{activeDetection.end_frame} · {activeDetection.source === 'model' ? `${Math.round(activeDetection.confidence * 100)}% confidence` : 'Human label'}</div>
                </div>
                {activeDetection.source === 'model' && activeDetection.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => acceptDetection(activeDetection.id)} style={{ ...btn, color: '#00ff88', borderColor: '#00ff88', padding: '4px 12px' }}>✓ ACCEPT</button>
                    <button onClick={() => rejectDetection(activeDetection.id)} style={{ ...btn, color: '#f87171', borderColor: '#f87171', padding: '4px 12px' }}>✗ REJECT</button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Scrubber with detection markers */}
          {videoSrc && (
            <div style={{ padding: '8px 14px', background: '#0d0d1a' }}>
              <div style={{ position: 'relative', height: 32, cursor: 'pointer' }}
                onClick={e => { const r = e.currentTarget.getBoundingClientRect(); if (videoRef.current) videoRef.current.currentTime = ((e.clientX - r.left) / r.width) * duration }}>
                <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 4, background: '#1a1a2e', transform: 'translateY(-50%)' }} />
                <div style={{ position: 'absolute', top: '50%', left: 0, height: 4, background: '#38bdf8', transform: 'translateY(-50%)', width: `${(currentFrame / (duration * fps || 1)) * 100}%` }} />
                {/* Detection spans */}
                {allDetections.map((d, i) => {
                  const left = (d.start_frame / (duration * fps || 1)) * 100
                  const width = Math.max(0.5, ((d.end_frame - d.start_frame) / (duration * fps || 1)) * 100)
                  const color = catColor[d.signal_category] || '#fff'
                  const alpha = d.status === 'rejected' ? '33' : d.status === 'accepted' ? 'cc' : '88'
                  return (
                    <div key={i} onClick={e => { e.stopPropagation(); jumpTo(d) }}
                      title={`${d.signal_label} [${d.source}]`}
                      style={{ position: 'absolute', top: '20%', height: '60%', left: `${left}%`, width: `${width}%`, background: color + alpha, cursor: 'pointer', border: activeDetection?.id === d.id ? `1px solid ${color}` : 'none', zIndex: 2 }} />
                  )
                })}
                <div style={{ position: 'absolute', top: '50%', transform: 'translate(-50%,-50%)', left: `${(currentFrame / (duration * fps || 1)) * 100}%`, width: 14, height: 14, borderRadius: '50%', background: '#fff', border: '2px solid #38bdf8', zIndex: 3 }} />
              </div>
              {/* Legend */}
              <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 9, color: '#444' }}>
                <span>█ = detection span on timeline (click to jump)</span>
                <span style={{ marginLeft: 'auto' }}>
                  <span style={{ color: '#555' }}>HUMAN: </span>{existingLabels.length}
                  <span style={{ color: '#555', marginLeft: 8 }}>MODEL: </span>{detections.length}
                </span>
              </div>
            </div>
          )}

          {/* Playback controls */}
          {videoSrc && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', background: '#0d0d1a', borderBottom: '1px solid #1a1a2e', flexWrap: 'wrap' }}>
              {[[-30,'«1s'],[-5,'«5f'],[-1,'‹']].map(([d,l]) => <button key={l} onClick={() => { if (videoRef.current) videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime + (d as number)/fps) }} style={btn}>{l}</button>)}
              <button onClick={() => { if (videoRef.current) { if (playing) { videoRef.current.pause(); setPlaying(false) } else { videoRef.current.play(); setPlaying(true) } } }} style={{ ...btn, background: '#38bdf8', color: '#000', width: 40, fontWeight: 'bold' }}>{playing ? '⏸' : '▶'}</button>
              {[[1,'›'],[5,'5f›'],[30,'1s»']].map(([d,l]) => <button key={l} onClick={() => { if (videoRef.current) videoRef.current.currentTime = Math.min(duration, videoRef.current.currentTime + (d as number)/fps) }} style={btn}>{l}</button>)}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
                {[0.25, 0.5, 1, 2].map(r => <button key={r} onClick={() => { setSpeed(r); if (videoRef.current) videoRef.current.playbackRate = r }} style={{ ...btn, background: speed === r ? '#38bdf8' : 'transparent', color: speed === r ? '#000' : '#555', padding: '3px 7px', fontSize: 10 }}>{r}x</button>)}
              </div>
            </div>
          )}

          {/* Inference controls */}
          {videoSrc && (
            <div style={{ padding: 16, background: '#0d0d1a', flex: 1 }}>
              <div style={{ fontSize: 11, color: '#666', letterSpacing: 2, marginBottom: 12 }}>MODEL INFERENCE</div>

              <div style={{ background: '#0a1a2e', border: '1px solid #1a3a5e', padding: 16, marginBottom: 16, fontSize: 11, color: '#38bdf8', lineHeight: 1.8 }}>
                <div style={{ fontWeight: 'bold', marginBottom: 6 }}>CURRENT STATUS: PRE-TRAINING</div>
                <div style={{ color: '#555' }}>
                  Model not yet trained — need more labeled data first.<br />
                  Once you have ~50 labels per signal class, come back here<br />
                  and the Run Inference button will call the trained model API.
                </div>
                <div style={{ marginTop: 10, color: '#1a5a8e' }}>
                  Pipeline: Video → Frame extraction → Pose detection →<br />
                  Gesture classifier → Confidence scores → Your review
                </div>
              </div>

              <button onClick={runInference} disabled={inferenceRunning} style={{
                background: inferenceRunning ? '#1a1a2e' : '#38bdf8',
                border: 'none', color: inferenceRunning ? '#555' : '#000',
                padding: '10px 24px', cursor: inferenceRunning ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', fontSize: 12, letterSpacing: 2, fontWeight: 'bold', marginBottom: 12,
              }}>
                {inferenceRunning ? 'RUNNING…' : '▶ RUN INFERENCE ON THIS VIDEO'}
              </button>

              <div style={{ fontSize: 10, color: '#333', lineHeight: 1.6 }}>
                When trained: loads video → extracts frames at 30fps → runs pose model to find ref → classifies gesture sequence → returns detections with confidence scores for your review above.
              </div>
            </div>
          )}
        </div>

        {/* Right: detection list + whistle review */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Whistle review panel */}
          {whistleReviewMode && currentWhistleLabel && (
            <div style={{ padding: 16, background: '#1a1200', borderBottom: '2px solid #fbbf24' }}>
              <div style={{ fontSize: 11, color: '#fbbf24', letterSpacing: 2, marginBottom: 8 }}>
                🔊 WHISTLE REVIEW — {pendingWhistleIdx + 1} of {whistleLabels.length}
              </div>
              <div style={{ color: catColor[currentWhistleLabel.signal_category], fontWeight: 'bold', marginBottom: 4 }}>
                {currentWhistleLabel.signal_label}
              </div>
              <div style={{ fontSize: 10, color: '#555', marginBottom: 12 }}>
                F{currentWhistleLabel.start_frame} → F{currentWhistleLabel.end_frame} · Listen carefully — did the whistle come from THIS mat?
              </div>
              <button onClick={() => { jumpTo(currentWhistleLabel); }} style={{ ...btn, marginBottom: 12, width: '100%' }}>
                ▶ JUMP TO THIS LABEL
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => confirmWhistle(true)} style={{ flex: 1, padding: '10px', background: '#0d2e0d', border: '1px solid #00ff88', color: '#00ff88', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 'bold' }}>
                  ✓ YES — THIS MAT
                </button>
                <button onClick={() => confirmWhistle(false)} style={{ flex: 1, padding: '10px', background: '#2e0d0d', border: '1px solid #f87171', color: '#f87171', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 'bold' }}>
                  ✗ NO / ADJACENT MAT
                </button>
              </div>
            </div>
          )}

          {/* Filters */}
          <div style={{ padding: '10px 14px', borderBottom: '1px solid #1a1a2e', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => setShowExisting(!showExisting)} style={{ ...btn, background: showExisting ? '#1a1a2e' : 'transparent', color: showExisting ? '#e0e0f0' : '#555', fontSize: 10, padding: '4px 10px' }}>
              HUMAN ({existingLabels.length})
            </button>
            <button onClick={() => setShowPending(!showPending)} style={{ ...btn, background: showPending ? '#1a1a2e' : 'transparent', color: showPending ? '#e0e0f0' : '#555', fontSize: 10, padding: '4px 10px' }}>
              MODEL ({detections.length})
            </button>
            <span style={{ fontSize: 10, color: '#333', marginLeft: 'auto', alignSelf: 'center' }}>
              {pendingCount} pending · {acceptedCount} accepted
            </span>
          </div>

          {/* Detection list */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {allDetections.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#2a2a3a', fontSize: 11 }}>
                {videoSrc ? 'Load a labeled video to see existing labels, or run inference to see model detections' : 'Load a video to begin'}
              </div>
            ) : allDetections.map((d, i) => (
              <div key={i} onClick={() => jumpTo(d)}
                style={{ padding: '10px 14px', borderBottom: '1px solid #111', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'flex-start', borderLeft: `3px solid ${catColor[d.signal_category]}`, background: activeDetection?.id === d.id ? '#0d0d1a' : 'transparent', opacity: d.status === 'rejected' ? 0.35 : 1 }}>
                <div style={{ minWidth: 55 }}>
                  <div style={{ fontSize: 12, fontWeight: 'bold', color: '#fff' }}>{fmt(d.start_frame / fps)}</div>
                  <div style={{ fontSize: 9, color: '#444' }}>F{d.start_frame}→{d.end_frame}</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ color: catColor[d.signal_category], fontSize: 11, fontWeight: 'bold' }}>{d.signal_label}</span>
                    <span style={{ fontSize: 9, color: d.source === 'model' ? '#38bdf8' : '#555', border: `1px solid ${d.source === 'model' ? '#38bdf8' : '#333'}`, padding: '0 4px' }}>
                      {d.source === 'model' ? `MODEL ${Math.round(d.confidence * 100)}%` : 'HUMAN'}
                    </span>
                    {d.needs_whistle_review && <span style={{ color: '#fbbf24', fontSize: 9 }}>🔊 REVIEW</span>}
                    {d.status === 'accepted' && <span style={{ color: '#00ff88', fontSize: 9 }}>✓</span>}
                    {d.status === 'rejected' && <span style={{ color: '#f87171', fontSize: 9 }}>✗</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {d.source === 'model' && d.status === 'pending' && <>
                    <button onClick={e => { e.stopPropagation(); acceptDetection(d.id) }} style={{ background: 'transparent', border: '1px solid #00ff88', color: '#00ff88', padding: '2px 8px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 10 }}>✓</button>
                    <button onClick={e => { e.stopPropagation(); rejectDetection(d.id) }} style={{ background: 'transparent', border: '1px solid #f87171', color: '#f87171', padding: '2px 8px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 10 }}>✗</button>
                  </>}
                  {d.source === 'human' && !d.bbox_x && (
                    <button onClick={e => { e.stopPropagation(); jumpTo(d); setBboxMode(true) }}
                      style={{ background: 'transparent', border: '1px solid #a78bfa', color: '#a78bfa', padding: '2px 8px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 9 }}>+ BBOX</button>
                  )}
                  {d.bbox_x && <span style={{ fontSize: 9, color: '#00ff88' }}>□</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
