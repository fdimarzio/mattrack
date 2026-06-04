'use client'

import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

// ── NFHS Rule-Based Signal Detector ──────────────────────────
// Zero-shot detection — no training required
// Applies NFHS signal rules directly to pose keypoints

interface Detection {
  timeSeconds: number
  frame: number
  signalId: string
  signalLabel: string
  confidence: number   // 0-1
  reason: string       // what triggered the detection
  armAngle: number
  armDirection: string
  armExtension: number
  bodyLean: number
}

interface VideoRecord {
  id: string
  filename: string
  label_count: number
}

interface GroundTruth {
  frame: number
  signal_id: string
  signal_label: string
}

interface EvalResult {
  truePositives: number
  falsePositives: number
  falseNegatives: number
  precision: number
  recall: number
  f1: number
  matched: { detection: Detection; groundTruth: GroundTruth }[]
  unmatched_detections: Detection[]
  unmatched_gt: GroundTruth[]
}

const FPS = 30
const SAMPLE_RATE = 3  // analyze every Nth frame (3 = 10fps)
const MATCH_WINDOW_FRAMES = 45  // 1.5 second window for GT matching

// ── NFHS Rule Engine ─────────────────────────────────────────
function applyNFHSRules(
  keypoints: { name: string; x: number; y: number; score: number }[],
  prevKeypoints: typeof keypoints | null,
  frameNum: number
): Detection[] {
  const detections: Detection[] = []
  const kp = Object.fromEntries(keypoints.map(k => [k.name, k]))

  const lw = kp['left_wrist'],  rw = kp['right_wrist']
  const ls = kp['left_shoulder'], rs = kp['right_shoulder']
  const le = kp['left_elbow'],  re = kp['right_elbow']
  const lh = kp['left_hip'],    rh = kp['right_hip']

  if (!ls || !rs) return []  // need shoulders to do anything

  const shoulderY = (ls.y + rs.y) / 2
  const shoulderWidth = Math.abs(ls.x - rs.x)
  const hipY = lh && rh ? (lh.y + rh.y) / 2 : shoulderY + 0.3
  const bodyHeight = Math.abs(hipY - shoulderY)

  // Helper: arm angle from horizontal for a given wrist/shoulder pair
  const armAngle = (w: typeof lw, s: typeof ls) => {
    if (!w || !s) return null
    return Math.atan2(s.y - w.y, Math.abs(w.x - s.x)) * 180 / Math.PI
  }

  // Helper: arm extension (0=bent, 1=fully extended)
  const armExt = (w: typeof lw, e: typeof le, s: typeof ls) => {
    if (!w || !e || !s) return 0
    const total = Math.sqrt((s.x-w.x)**2 + (s.y-w.y)**2)
    return Math.min(1, total / (shoulderWidth * 1.2))
  }

  const leftAngle  = armAngle(lw, ls)
  const rightAngle = armAngle(rw, rs)
  const leftExt    = armExt(lw, le, ls)
  const rightExt   = armExt(rw, re, rs)

  // Body lean toward mat (pin signal)
  const bodyLean = ls && rs && lh && rh
    ? Math.abs((ls.x + rs.x)/2 - (lh.x + rh.x)/2) / shoulderWidth
    : 0

  // ── RULE 1: SCORING — Fingers extended upward (1, 2, or 3pt) ──
  // Arm raised above shoulder, extended
  const leftRaised  = lw && ls ? ls.y - lw.y : 0
  const rightRaised = rw && rs ? rs.y - rw.y : 0

  if (leftRaised > shoulderWidth * 0.3 && leftExt > 0.5) {
    detections.push({ timeSeconds: frameNum/FPS, frame: frameNum, signalId: 'scoring_signal', signalLabel: 'Scoring Signal (fingers)', confidence: Math.min(0.9, leftExt * (leftRaised / shoulderWidth)), reason: `Left arm raised ${(leftRaised/shoulderWidth*100).toFixed(0)}% above shoulder, ${(leftExt*100).toFixed(0)}% extended`, armAngle: leftAngle||0, armDirection: 'up-left', armExtension: leftExt, bodyLean })
  }
  if (rightRaised > shoulderWidth * 0.3 && rightExt > 0.5) {
    detections.push({ timeSeconds: frameNum/FPS, frame: frameNum, signalId: 'scoring_signal', signalLabel: 'Scoring Signal (fingers)', confidence: Math.min(0.9, rightExt * (rightRaised / shoulderWidth)), reason: `Right arm raised ${(rightRaised/shoulderWidth*100).toFixed(0)}% above shoulder, ${(rightExt*100).toFixed(0)}% extended`, armAngle: rightAngle||0, armDirection: 'up-right', armExtension: rightExt, bodyLean })
  }

  // ── RULE 2: OUT OF BOUNDS — Arm horizontal, extended ──
  if (leftAngle !== null && Math.abs(leftAngle) < 25 && leftExt > 0.6) {
    detections.push({ timeSeconds: frameNum/FPS, frame: frameNum, signalId: 'out_of_bounds', signalLabel: 'Out of Bounds', confidence: Math.min(0.85, leftExt * (1 - Math.abs(leftAngle)/25)), reason: `Left arm horizontal at ${leftAngle.toFixed(0)}°, ${(leftExt*100).toFixed(0)}% extended`, armAngle: leftAngle, armDirection: 'horizontal-left', armExtension: leftExt, bodyLean })
  }
  if (rightAngle !== null && Math.abs(rightAngle) < 25 && rightExt > 0.6) {
    detections.push({ timeSeconds: frameNum/FPS, frame: frameNum, signalId: 'out_of_bounds', signalLabel: 'Out of Bounds', confidence: Math.min(0.85, rightExt * (1 - Math.abs(rightAngle)/25)), reason: `Right arm horizontal at ${rightAngle.toFixed(0)}°, ${(rightExt*100).toFixed(0)}% extended`, armAngle: rightAngle, armDirection: 'horizontal-right', armExtension: rightExt, bodyLean })
  }

  // ── RULE 3: NEAR FALL — Arm parallel to mat at lower height ──
  if (leftAngle !== null && Math.abs(leftAngle) < 15 && leftExt > 0.5 && lw && lw.y > shoulderY) {
    detections.push({ timeSeconds: frameNum/FPS, frame: frameNum, signalId: 'nearfall', signalLabel: 'Near Fall', confidence: 0.6, reason: `Left arm parallel to mat at ${leftAngle.toFixed(0)}°, below shoulder level`, armAngle: leftAngle, armDirection: 'parallel-mat', armExtension: leftExt, bodyLean })
  }
  if (rightAngle !== null && Math.abs(rightAngle) < 15 && rightExt > 0.5 && rw && rw.y > shoulderY) {
    detections.push({ timeSeconds: frameNum/FPS, frame: frameNum, signalId: 'nearfall', signalLabel: 'Near Fall', confidence: 0.6, reason: `Right arm parallel to mat at ${rightAngle.toFixed(0)}°, below shoulder level`, armAngle: rightAngle, armDirection: 'parallel-mat', armExtension: rightExt, bodyLean })
  }

  // ── RULE 4: PIN — Body leaning toward mat + arm downward ──
  if (bodyLean > 0.3 && (
    (lw && lw.y > hipY) || (rw && rw.y > hipY)
  )) {
    detections.push({ timeSeconds: frameNum/FPS, frame: frameNum, signalId: 'pin', signalLabel: 'Pin / Fall', confidence: Math.min(0.8, bodyLean), reason: `Body leaning toward mat (${(bodyLean*100).toFixed(0)}% lean), arm at mat level`, armAngle: 0, armDirection: 'down', armExtension: 0, bodyLean })
  }

  // ── RULE 5: TIMEOUT — Both arms form T ──
  if (lw && rw && ls && rs) {
    const leftHoriz  = leftAngle !== null  && Math.abs(leftAngle)  < 30 && leftExt  > 0.4
    const rightHoriz = rightAngle !== null && Math.abs(rightAngle) < 30 && rightExt > 0.4
    const armsOpposite = lw.x < ls.x && rw.x > rs.x  // arms spread outward
    if (leftHoriz && rightHoriz && armsOpposite) {
      detections.push({ timeSeconds: frameNum/FPS, frame: frameNum, signalId: 'timeout', signalLabel: 'Time Out / No Control', confidence: 0.75, reason: `Both arms horizontal forming T shape`, armAngle: 0, armDirection: 'both-horizontal', armExtension: (leftExt+rightExt)/2, bodyLean })
    }
  }

  // ── RULE 6: STALLING — Single arm pointing/extended at lower angle ──
  if (leftAngle !== null && leftAngle > -45 && leftAngle < 20 && leftExt > 0.55 && leftRaised < shoulderWidth * 0.1) {
    detections.push({ timeSeconds: frameNum/FPS, frame: frameNum, signalId: 'stalling', signalLabel: 'Stalling / Pointing', confidence: 0.5, reason: `Left arm extended at ${leftAngle.toFixed(0)}°, pointing gesture`, armAngle: leftAngle, armDirection: 'forward-left', armExtension: leftExt, bodyLean })
  }

  // Deduplicate — keep highest confidence per signal type
  const best: Record<string, Detection> = {}
  for (const d of detections) {
    if (!best[d.signalId] || d.confidence > best[d.signalId].confidence) {
      best[d.signalId] = d
    }
  }

  return Object.values(best)
}

// ── Cluster nearby detections ────────────────────────────────
function clusterDetections(detections: Detection[], gapFrames = 30): Detection[] {
  if (detections.length === 0) return []
  const sorted = [...detections].sort((a,b) => a.frame - b.frame)
  const clusters: Detection[] = []
  let current = sorted[0]

  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i]
    if (d.signalId === current.signalId && d.frame - current.frame < gapFrames) {
      if (d.confidence > current.confidence) current = d
    } else {
      clusters.push(current)
      current = d
    }
  }
  clusters.push(current)
  return clusters
}

// ── Evaluate against ground truth ────────────────────────────
function evaluate(detections: Detection[], groundTruth: GroundTruth[]): EvalResult {
  const matched: EvalResult['matched'] = []
  const usedGT = new Set<number>()
  const usedDet = new Set<number>()

  // For each detection find closest GT within window
  for (let di = 0; di < detections.length; di++) {
    const det = detections[di]
    let bestGTIdx = -1, bestDist = MATCH_WINDOW_FRAMES + 1

    for (let gi = 0; gi < groundTruth.length; gi++) {
      if (usedGT.has(gi)) continue
      const gt = groundTruth[gi]
      const frameDist = Math.abs(det.frame - gt.frame)
      // Signal type match — loose match (scoring vs scoring)
      const typeMatch = det.signalId === gt.signal_id ||
        (det.signalId === 'scoring_signal' && ['takedown_3pt_red','takedown_3pt_green','escape_1pt_red','escape_1pt_green','reversal_2pt_red','reversal_2pt_green','nearfall_2pt_red','nearfall_3pt_red','nearfall_4pt_red'].includes(gt.signal_id)) ||
        (det.signalId === 'nearfall' && gt.signal_id.includes('nearfall')) ||
        (det.signalId === 'pin' && gt.signal_id.includes('pin')) ||
        (det.signalId === 'out_of_bounds' && gt.signal_id === 'out_of_bounds') ||
        (det.signalId === 'timeout' && ['timeout','no_control','neutral_position'].includes(gt.signal_id)) ||
        (det.signalId === 'stalling' && gt.signal_id.includes('stalling'))

      if (typeMatch && frameDist < bestDist) {
        bestDist = frameDist; bestGTIdx = gi
      }
    }

    if (bestGTIdx >= 0) {
      matched.push({ detection: det, groundTruth: groundTruth[bestGTIdx] })
      usedGT.add(bestGTIdx); usedDet.add(di)
    }
  }

  const tp = matched.length
  const fp = detections.length - tp
  const fn = groundTruth.length - tp
  const precision = tp / Math.max(1, tp + fp)
  const recall    = tp / Math.max(1, tp + fn)
  const f1        = 2 * precision * recall / Math.max(0.001, precision + recall)

  return {
    truePositives: tp, falsePositives: fp, falseNegatives: fn,
    precision, recall, f1,
    matched,
    unmatched_detections: detections.filter((_,i) => !usedDet.has(i)),
    unmatched_gt: groundTruth.filter((_,i) => !usedGT.has(i)),
  }
}

const fmt = (s: number) => { const m = Math.floor(s/60), sec = Math.floor(s%60); return `${m}:${sec.toString().padStart(2,'0')}` }
const catColor: Record<string,string> = { scoring:'#00ff88', control:'#a78bfa', clock:'#38bdf8', violation:'#f87171', time:'#fb923c', outcome:'#ff0055' }

export default function BaselinePage() {
  const videoRef   = useRef<HTMLVideoElement>(null)
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [videos, setVideos]           = useState<VideoRecord[]>([])
  const [selectedVideo, setSelectedVideo] = useState<VideoRecord | null>(null)
  const [videoSrc, setVideoSrc]       = useState<string | null>(null)
  const [groundTruth, setGroundTruth] = useState<GroundTruth[]>([])

  const [modelReady, setModelReady]   = useState(false)
  const [modelLoading, setModelLoading] = useState(false)
  const [poseModel, setPoseModel]     = useState<unknown>(null)

  const [running, setRunning]         = useState(false)
  const [progress, setProgress]       = useState(0)
  const [detections, setDetections]   = useState<Detection[]>([])
  const [evalResult, setEvalResult]   = useState<EvalResult | null>(null)
  const [localServer, setLocalServer] = useState(false)
  const [localVideos, setLocalVideos] = useState<{filename:string,url:string}[]>([])
  const [toast, setToast]             = useState<string | null>(null)
  const showToast = (msg:string) => { setToast(msg); setTimeout(()=>setToast(null),3500) }

  useEffect(() => {
    supabase.rpc('get_videos_with_label_count')
      .then(({data}) => { if (data) setVideos((data as VideoRecord[]).filter(v=>v.label_count>0)) })
    fetch('http://localhost:7432/ping', { signal: AbortSignal.timeout(1500) })
      .then(r => { if (r.ok) return fetch('http://localhost:7432/videos'); throw new Error('no server') })
      .then(r => r.json())
      .then(d => { if (d?.videos) { setLocalServer(true); setLocalVideos(d.videos) } })
      .catch(()=>{})
  }, [])

  const selectVideo = async (video: VideoRecord) => {
    setSelectedVideo(video); setDetections([]); setEvalResult(null)
    setVideoSrc(null)
    const { data } = await supabase
      .from('mattrack_signal_instances')
      .select('start_frame, signal_id, signal_label')
      .eq('video_id', video.id)
      .order('start_frame', { ascending: true })
    setGroundTruth((data || []).map(d => ({ frame: d.start_frame, signal_id: d.signal_id, signal_label: d.signal_label })))

    // Auto-load from local server
    if (localServer) {
      const base = video.filename.replace(/\s*\(\d{4}.*?\)/,'').replace(/\.[^.]+$/,'').toLowerCase()
      const match = localVideos.find(v => v.filename.replace(/\.[^.]+$/,'').toLowerCase() === base)
      if (match) { setVideoSrc(match.url); showToast(`Auto-loaded ${match.filename} ✓`); return }
    }
    setTimeout(() => fileInputRef.current?.click(), 200)
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return
    setVideoSrc(URL.createObjectURL(f)); showToast(`${f.name} loaded ✓`)
  }

  const loadModel = async () => {
    setModelLoading(true)
    try {
      await new Promise<void>((resolve, reject) => {
        if ((window as any).ml5?.bodyPose) { resolve(); return }
        const s = document.createElement('script')
        s.src = 'https://unpkg.com/ml5@1.2.1/dist/ml5.min.js'
        s.onload = () => resolve(); s.onerror = reject
        document.head.appendChild(s)
      })
      await new Promise<void>((resolve, reject) => {
        const ml5 = (window as any).ml5
        if (!ml5?.bodyPose) { reject(new Error('ml5 not ready')); return }
        ml5.bodyPose('BlazePose', { runtime:'mediapipe', enableSmoothing:false }, (m: unknown) => {
          setPoseModel(m); setModelReady(true); showToast('Pose model ready ✓'); resolve()
        })
      })
    } catch(err) { console.error(err); showToast('Model load failed') }
    setModelLoading(false)
  }

  const extractFrame = (time: number): Promise<ImageData> =>
    new Promise(resolve => {
      const video = videoRef.current!
      const canvas = document.createElement('canvas')
      canvas.width = 320; canvas.height = 180  // small for speed
      const ctx = canvas.getContext('2d')!
      video.currentTime = time
      const h = () => { video.removeEventListener('seeked', h); ctx.drawImage(video,0,0,320,180); resolve(ctx.getImageData(0,0,320,180)) }
      video.addEventListener('seeked', h)
    })

  const runBaseline = async () => {
    if (!poseModel || !videoRef.current) return
    setRunning(true); setDetections([]); setEvalResult(null); setProgress(0)

    const video = videoRef.current
    const duration = video.duration
    const totalFrames = Math.floor(duration * FPS / SAMPLE_RATE)
    const allDetections: Detection[] = []

    showToast(`Scanning ${Math.floor(duration)}s video at ${FPS/SAMPLE_RATE}fps…`)

    // Create analysis canvas
    const canvas = document.createElement('canvas')
    canvas.width = 320; canvas.height = 180
    const ctx = canvas.getContext('2d')!

    let prevKps: { name: string; x: number; y: number; score: number }[] | null = null

    for (let fi = 0; fi < totalFrames; fi++) {
      const frameNum = fi * SAMPLE_RATE
      const time = frameNum / FPS
      if (time >= duration) break

      video.currentTime = time
      await new Promise<void>(r => {
        const h = () => { video.removeEventListener('seeked', h); r() }
        video.addEventListener('seeked', h)
        setTimeout(r, 500)  // timeout fallback
      })

      ctx.drawImage(video, 0, 0, 320, 180)

      try {
        const detection: any = await new Promise(r => {
          ;(poseModel as any).detect(canvas, (res: any) => r(res))
        })
        const poses = Array.isArray(detection) ? detection : (detection?.poses || [])
        const topPose = poses[0]
        const rawKps = topPose?.keypoints || topPose?.pose?.keypoints || []
        const kps = rawKps
          .filter((k: any) => (k.confidence || k.score || 0) > 0.2)
          .map((k: any) => ({
            name: (k.name || k.part || '').toLowerCase().replace(' ','_'),
            x: (k.x !== undefined ? k.x : k.position?.x || 0) / 320,
            y: (k.y !== undefined ? k.y : k.position?.y || 0) / 180,
            score: k.confidence || k.score || 0,
          }))

        if (kps.length > 4) {
          const frameDetections = applyNFHSRules(kps, prevKps, frameNum)
          allDetections.push(...frameDetections)
        }
        prevKps = kps
      } catch (err) { /* skip frame */ }

      if (fi % 20 === 0) {
        setProgress(Math.round((fi / totalFrames) * 100))
        await new Promise(r => setTimeout(r, 0))
      }
    }

    const clustered = clusterDetections(allDetections)
    setDetections(clustered)

    if (groundTruth.length > 0) {
      const result = evaluate(clustered, groundTruth)
      setEvalResult(result)
      showToast(`Done — Precision: ${(result.precision*100).toFixed(0)}% · Recall: ${(result.recall*100).toFixed(0)}% · F1: ${(result.f1*100).toFixed(0)}%`)
    } else {
      showToast(`Done — ${clustered.length} detections (no ground truth to evaluate against)`)
    }
    setRunning(false)
  }

  const btn: React.CSSProperties = { background:'transparent', border:'1px solid #1a1a2e', color:'#888', padding:'8px 14px', cursor:'pointer', fontFamily:"'Courier New',monospace", fontSize:11 }

  return (
    <div style={{ minHeight:'100vh', background:'#08080f', color:'#e0e0f0', fontFamily:"'Courier New',monospace", display:'flex', flexDirection:'column' }}>

      <div style={{ background:'#0d0d1a', borderBottom:'2px solid #38bdf8', padding:'10px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <a href="/" style={{ color:'#555', textDecoration:'none', fontSize:11 }}>← HOME</a>
          <div style={{ fontSize:16, color:'#38bdf8', fontWeight:'bold', letterSpacing:3 }}>MATTRACK / BASELINE</div>
          <div style={{ fontSize:10, color:'#444' }}>zero-shot NFHS rule detector</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {localServer && <span style={{ fontSize:9, color:'#00ff88' }}>✓ VIDEO SERVER</span>}
          {!modelReady
            ? <button onClick={loadModel} disabled={modelLoading} style={{ background:'#38bdf8', border:'none', color:'#000', padding:'7px 14px', cursor:modelLoading?'not-allowed':'pointer', fontFamily:'inherit', fontSize:11, fontWeight:'bold', opacity:modelLoading?0.6:1 }}>
                {modelLoading ? 'LOADING…' : '⚡ LOAD POSE MODEL'}
              </button>
            : <span style={{ fontSize:11, color:'#00ff88' }}>✓ MODEL READY</span>
          }
        </div>
      </div>

      {toast && <div style={{ position:'fixed', top:16, left:'50%', transform:'translateX(-50%)', background:'#38bdf8', color:'#000', padding:'10px 20px', fontFamily:'inherit', fontSize:12, fontWeight:'bold', zIndex:999, maxWidth:'90vw', textAlign:'center' }}>{toast}</div>}

      <video ref={videoRef} src={videoSrc||undefined} style={{ display:'none' }} preload="auto" />
      <input ref={fileInputRef} type="file" accept="video/*" onChange={handleFile} style={{ display:'none' }} />

      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

        {/* Left: setup */}
        <div style={{ flex:'0 0 340px', borderRight:'1px solid #1a1a2e', overflowY:'auto', padding:16, display:'flex', flexDirection:'column', gap:14 }}>

          <div>
            <div style={{ fontSize:10, color:'#555', letterSpacing:2, marginBottom:8 }}>SELECT VIDEO</div>
            {videos.map(v => (
              <button key={v.id} onClick={() => selectVideo(v)} style={{ display:'block', width:'100%', textAlign:'left', marginBottom:5, background:selectedVideo?.id===v.id?'#1a1a2e':'transparent', border:`1px solid ${selectedVideo?.id===v.id?'#38bdf8':'#1a1a2e'}`, color:selectedVideo?.id===v.id?'#fff':'#555', padding:'9px 12px', cursor:'pointer', fontFamily:'inherit' }}>
                <div style={{ display:'flex', justifyContent:'space-between' }}>
                  <span style={{ fontSize:11 }}>{v.filename.replace(/\s*\(\d{4}.*?\)/,'')}</span>
                  <span style={{ fontSize:11, color:'#00ff88' }}>{v.label_count} GT</span>
                </div>
              </button>
            ))}
          </div>

          {selectedVideo && !videoSrc && (
            <button onClick={() => fileInputRef.current?.click()} style={{ ...btn, width:'100%', padding:'10px 0', textAlign:'center' as const, color:'#38bdf8', borderColor:'#38bdf8' }}>
              ↑ SELECT VIDEO FILE
            </button>
          )}

          {videoSrc && (
            <div style={{ fontSize:10, color:'#00ff88' }}>✓ Video loaded · {groundTruth.length} ground truth labels</div>
          )}

          {videoSrc && modelReady && (
            <button onClick={runBaseline} disabled={running} style={{ background:running?'#1a1a2e':'#38bdf8', border:'none', color:running?'#444':'#000', padding:'12px 0', cursor:running?'not-allowed':'pointer', fontFamily:'inherit', fontSize:12, letterSpacing:2, fontWeight:'bold', width:'100%' }}>
              {running ? `SCANNING ${progress}%…` : '▶ RUN ZERO-SHOT BASELINE'}
            </button>
          )}

          {running && (
            <div style={{ height:4, background:'#1a1a2e', borderRadius:2 }}>
              <div style={{ width:`${progress}%`, height:'100%', background:'#38bdf8', borderRadius:2, transition:'width 0.3s' }} />
            </div>
          )}

          {/* Eval scores */}
          {evalResult && (
            <div style={{ background:'#0d0d1a', border:'1px solid #1a1a2e', padding:14 }}>
              <div style={{ fontSize:10, color:'#555', letterSpacing:2, marginBottom:10 }}>BASELINE PERFORMANCE</div>
              {[
                { label:'PRECISION', value:evalResult.precision, desc:'of detections are correct' },
                { label:'RECALL',    value:evalResult.recall,    desc:'of GT signals detected' },
                { label:'F1 SCORE',  value:evalResult.f1,        desc:'harmonic mean' },
              ].map(m => (
                <div key={m.label} style={{ marginBottom:10 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                    <span style={{ fontSize:10, color:'#555' }}>{m.label}</span>
                    <span style={{ fontSize:14, fontWeight:'bold', color: m.value>0.7?'#00ff88':m.value>0.4?'#fbbf24':'#f87171' }}>{(m.value*100).toFixed(0)}%</span>
                  </div>
                  <div style={{ height:5, background:'#111', borderRadius:2 }}>
                    <div style={{ width:`${m.value*100}%`, height:'100%', background:m.value>0.7?'#00ff88':m.value>0.4?'#fbbf24':'#f87171', borderRadius:2 }} />
                  </div>
                  <div style={{ fontSize:9, color:'#333', marginTop:2 }}>{m.desc}</div>
                </div>
              ))}
              <div style={{ display:'flex', gap:12, fontSize:10, marginTop:8 }}>
                <span style={{ color:'#00ff88' }}>✓ {evalResult.truePositives} TP</span>
                <span style={{ color:'#f87171' }}>✗ {evalResult.falsePositives} FP</span>
                <span style={{ color:'#fbbf24' }}>⚠ {evalResult.falseNegatives} FN</span>
              </div>
            </div>
          )}

          <div style={{ background:'#0a1a0a', border:'1px solid #1a2e1a', padding:12, fontSize:10, color:'#444', lineHeight:1.8 }}>
            <div style={{ color:'#555', marginBottom:4 }}>HOW THIS WORKS</div>
            Applies NFHS rules directly to detected body pose — no training. Arm angles, extension, and body lean are checked against each signal definition. This is your baseline. After labeling + training, compare the trained model against this score.
          </div>
        </div>

        {/* Right: detections + comparison */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
          <div style={{ padding:'10px 16px', borderBottom:'1px solid #1a1a2e', fontSize:10, color:'#444', letterSpacing:2, display:'flex', gap:20 }}>
            <span>DETECTIONS: <span style={{ color:'#38bdf8' }}>{detections.length}</span></span>
            <span>GROUND TRUTH: <span style={{ color:'#00ff88' }}>{groundTruth.length}</span></span>
            {evalResult && <span>F1: <span style={{ color:evalResult.f1>0.7?'#00ff88':evalResult.f1>0.4?'#fbbf24':'#f87171' }}>{(evalResult.f1*100).toFixed(0)}%</span></span>}
          </div>

          <div style={{ flex:1, overflowY:'auto' }}>
            {detections.length === 0 && groundTruth.length === 0 ? (
              <div style={{ padding:32, textAlign:'center', color:'#222', fontSize:11 }}>Select a video and run baseline to see detections</div>
            ) : (
              <div>
                {/* Matched */}
                {evalResult && evalResult.matched.length > 0 && (
                  <div>
                    <div style={{ padding:'8px 16px', background:'#0d2e0d', fontSize:10, color:'#00ff88', letterSpacing:2 }}>✓ TRUE POSITIVES ({evalResult.matched.length})</div>
                    {evalResult.matched.map((m, i) => (
                      <div key={i} style={{ padding:'10px 16px', borderBottom:'1px solid #111', display:'flex', gap:12, borderLeft:'3px solid #00ff88' }}>
                        <div style={{ minWidth:50, fontSize:12, fontWeight:'bold' }}>{fmt(m.detection.timeSeconds)}</div>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:11, color:'#00ff88' }}>DETECTED: {m.detection.signalLabel}</div>
                          <div style={{ fontSize:10, color:'#555', marginTop:2 }}>{m.detection.reason}</div>
                          <div style={{ fontSize:10, color:'#444', marginTop:1 }}>GT: {m.groundTruth.signal_label} @ F{m.groundTruth.frame}</div>
                        </div>
                        <div style={{ fontSize:11, color:'#00ff88' }}>{(m.detection.confidence*100).toFixed(0)}%</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* False positives */}
                {evalResult && evalResult.unmatched_detections.length > 0 && (
                  <div>
                    <div style={{ padding:'8px 16px', background:'#2e0d0d', fontSize:10, color:'#f87171', letterSpacing:2 }}>✗ FALSE POSITIVES ({evalResult.unmatched_detections.length}) — detected but no matching GT</div>
                    {evalResult.unmatched_detections.map((d, i) => (
                      <div key={i} style={{ padding:'10px 16px', borderBottom:'1px solid #111', display:'flex', gap:12, borderLeft:'3px solid #f87171' }}>
                        <div style={{ minWidth:50, fontSize:12, fontWeight:'bold' }}>{fmt(d.timeSeconds)}</div>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:11, color:'#f87171' }}>{d.signalLabel}</div>
                          <div style={{ fontSize:10, color:'#555', marginTop:2 }}>{d.reason}</div>
                        </div>
                        <div style={{ fontSize:11, color:'#f87171' }}>{(d.confidence*100).toFixed(0)}%</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* False negatives */}
                {evalResult && evalResult.unmatched_gt.length > 0 && (
                  <div>
                    <div style={{ padding:'8px 16px', background:'#2e2000', fontSize:10, color:'#fbbf24', letterSpacing:2 }}>⚠ MISSED ({evalResult.unmatched_gt.length}) — in GT but not detected</div>
                    {evalResult.unmatched_gt.map((gt, i) => (
                      <div key={i} style={{ padding:'10px 16px', borderBottom:'1px solid #111', display:'flex', gap:12, borderLeft:'3px solid #fbbf24' }}>
                        <div style={{ minWidth:50, fontSize:12, fontWeight:'bold' }}>{fmt(gt.frame/FPS)}</div>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:11, color:'#fbbf24' }}>{gt.signal_label}</div>
                          <div style={{ fontSize:10, color:'#555', marginTop:2 }}>F{gt.frame} — rule-based detector missed this signal</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* All detections when no GT */}
                {(!evalResult && detections.length > 0) && (
                  <div>
                    <div style={{ padding:'8px 16px', fontSize:10, color:'#38bdf8', letterSpacing:2 }}>ALL DETECTIONS</div>
                    {detections.map((d, i) => (
                      <div key={i} style={{ padding:'10px 16px', borderBottom:'1px solid #111', display:'flex', gap:12, borderLeft:`3px solid #38bdf8` }} onClick={() => { if(videoRef.current) videoRef.current.currentTime = d.timeSeconds }}>
                        <div style={{ minWidth:50, fontSize:12, fontWeight:'bold', cursor:'pointer' }}>{fmt(d.timeSeconds)}</div>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:11, color:'#38bdf8' }}>{d.signalLabel}</div>
                          <div style={{ fontSize:10, color:'#555', marginTop:2 }}>{d.reason}</div>
                        </div>
                        <div style={{ fontSize:11, color:'#38bdf8' }}>{(d.confidence*100).toFixed(0)}%</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
