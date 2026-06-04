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

interface LocalVideo {
  filename: string
  url: string
  size_mb: number
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

interface BatchResult {
  filename: string
  detections: Detection[]
  groundTruth: GroundTruth[]
  evalResult: EvalResult | null
  status: 'pending' | 'running' | 'done' | 'error'
  error?: string
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

  if (!ls || !rs) return []

  const shoulderY = (ls.y + rs.y) / 2
  const shoulderWidth = Math.abs(ls.x - rs.x)
  const hipY = lh && rh ? (lh.y + rh.y) / 2 : shoulderY + 0.3

  const armAngle = (w: typeof lw, s: typeof ls) => {
    if (!w || !s) return null
    return Math.atan2(s.y - w.y, Math.abs(w.x - s.x)) * 180 / Math.PI
  }

  const armExt = (w: typeof lw, e: typeof le, s: typeof ls) => {
    if (!w || !e || !s) return 0
    const total = Math.sqrt((s.x-w.x)**2 + (s.y-w.y)**2)
    return Math.min(1, total / (shoulderWidth * 1.2))
  }

  const leftAngle  = armAngle(lw, ls)
  const rightAngle = armAngle(rw, rs)
  const leftExt    = armExt(lw, le, ls)
  const rightExt   = armExt(rw, re, rs)

  const bodyLean = ls && rs && lh && rh
    ? Math.abs((ls.x + rs.x)/2 - (lh.x + rh.x)/2) / shoulderWidth
    : 0

  const leftRaised  = lw && ls ? ls.y - lw.y : 0
  const rightRaised = rw && rs ? rs.y - rw.y : 0

  if (leftRaised > shoulderWidth * 0.3 && leftExt > 0.5) {
    detections.push({ timeSeconds: frameNum/FPS, frame: frameNum, signalId: 'scoring_signal', signalLabel: 'Scoring Signal (fingers)', confidence: Math.min(0.9, leftExt * (leftRaised / shoulderWidth)), reason: `Left arm raised ${(leftRaised/shoulderWidth*100).toFixed(0)}% above shoulder, ${(leftExt*100).toFixed(0)}% extended`, armAngle: leftAngle||0, armDirection: 'up-left', armExtension: leftExt, bodyLean })
  }
  if (rightRaised > shoulderWidth * 0.3 && rightExt > 0.5) {
    detections.push({ timeSeconds: frameNum/FPS, frame: frameNum, signalId: 'scoring_signal', signalLabel: 'Scoring Signal (fingers)', confidence: Math.min(0.9, rightExt * (rightRaised / shoulderWidth)), reason: `Right arm raised ${(rightRaised/shoulderWidth*100).toFixed(0)}% above shoulder, ${(rightExt*100).toFixed(0)}% extended`, armAngle: rightAngle||0, armDirection: 'up-right', armExtension: rightExt, bodyLean })
  }

  if (leftAngle !== null && Math.abs(leftAngle) < 25 && leftExt > 0.6) {
    detections.push({ timeSeconds: frameNum/FPS, frame: frameNum, signalId: 'out_of_bounds', signalLabel: 'Out of Bounds', confidence: Math.min(0.85, leftExt * (1 - Math.abs(leftAngle)/25)), reason: `Left arm horizontal at ${leftAngle.toFixed(0)}°, ${(leftExt*100).toFixed(0)}% extended`, armAngle: leftAngle, armDirection: 'horizontal-left', armExtension: leftExt, bodyLean })
  }
  if (rightAngle !== null && Math.abs(rightAngle) < 25 && rightExt > 0.6) {
    detections.push({ timeSeconds: frameNum/FPS, frame: frameNum, signalId: 'out_of_bounds', signalLabel: 'Out of Bounds', confidence: Math.min(0.85, rightExt * (1 - Math.abs(rightAngle)/25)), reason: `Right arm horizontal at ${rightAngle.toFixed(0)}°, ${(rightExt*100).toFixed(0)}% extended`, armAngle: rightAngle, armDirection: 'horizontal-right', armExtension: rightExt, bodyLean })
  }

  if (leftAngle !== null && Math.abs(leftAngle) < 15 && leftExt > 0.5 && lw && lw.y > shoulderY) {
    detections.push({ timeSeconds: frameNum/FPS, frame: frameNum, signalId: 'nearfall', signalLabel: 'Near Fall', confidence: 0.6, reason: `Left arm parallel to mat at ${leftAngle.toFixed(0)}°, below shoulder level`, armAngle: leftAngle, armDirection: 'parallel-mat', armExtension: leftExt, bodyLean })
  }
  if (rightAngle !== null && Math.abs(rightAngle) < 15 && rightExt > 0.5 && rw && rw.y > shoulderY) {
    detections.push({ timeSeconds: frameNum/FPS, frame: frameNum, signalId: 'nearfall', signalLabel: 'Near Fall', confidence: 0.6, reason: `Right arm parallel to mat at ${rightAngle.toFixed(0)}°, below shoulder level`, armAngle: rightAngle, armDirection: 'parallel-mat', armExtension: rightExt, bodyLean })
  }

  if (bodyLean > 0.3 && (
    (lw && lw.y > hipY) || (rw && rw.y > hipY)
  )) {
    detections.push({ timeSeconds: frameNum/FPS, frame: frameNum, signalId: 'pin', signalLabel: 'Pin / Fall', confidence: Math.min(0.8, bodyLean), reason: `Body leaning toward mat (${(bodyLean*100).toFixed(0)}% lean), arm at mat level`, armAngle: 0, armDirection: 'down', armExtension: 0, bodyLean })
  }

  if (lw && rw && ls && rs) {
    const leftHoriz  = leftAngle !== null  && Math.abs(leftAngle)  < 30 && leftExt  > 0.4
    const rightHoriz = rightAngle !== null && Math.abs(rightAngle) < 30 && rightExt > 0.4
    const armsOpposite = lw.x < ls.x && rw.x > rs.x
    if (leftHoriz && rightHoriz && armsOpposite) {
      detections.push({ timeSeconds: frameNum/FPS, frame: frameNum, signalId: 'timeout', signalLabel: 'Time Out / No Control', confidence: 0.75, reason: `Both arms horizontal forming T shape`, armAngle: 0, armDirection: 'both-horizontal', armExtension: (leftExt+rightExt)/2, bodyLean })
    }
  }

  if (leftAngle !== null && leftAngle > -45 && leftAngle < 20 && leftExt > 0.55 && leftRaised < shoulderWidth * 0.1) {
    detections.push({ timeSeconds: frameNum/FPS, frame: frameNum, signalId: 'stalling', signalLabel: 'Stalling / Pointing', confidence: 0.5, reason: `Left arm extended at ${leftAngle.toFixed(0)}°, pointing gesture`, armAngle: leftAngle, armDirection: 'forward-left', armExtension: leftExt, bodyLean })
  }

  const best: Record<string, Detection> = {}
  for (const d of detections) {
    if (!best[d.signalId] || d.confidence > best[d.signalId].confidence) {
      best[d.signalId] = d
    }
  }

  return Object.values(best)
}

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

function evaluate(detections: Detection[], groundTruth: GroundTruth[]): EvalResult {
  const matched: EvalResult['matched'] = []
  const usedGT = new Set<number>()
  const usedDet = new Set<number>()

  for (let di = 0; di < detections.length; di++) {
    const det = detections[di]
    let bestGTIdx = -1, bestDist = MATCH_WINDOW_FRAMES + 1

    for (let gi = 0; gi < groundTruth.length; gi++) {
      if (usedGT.has(gi)) continue
      const gt = groundTruth[gi]
      const frameDist = Math.abs(det.frame - gt.frame)
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

export default function BaselinePage() {
  const videoRef   = useRef<HTMLVideoElement>(null)
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
  const [localVideos, setLocalVideos] = useState<LocalVideo[]>([])
  const [toast, setToast]             = useState<string | null>(null)

  // Batch mode state
  const [batchMode, setBatchMode]     = useState(false)
  const [batchQueue, setBatchQueue]   = useState<LocalVideo[]>([])
  const [batchResults, setBatchResults] = useState<BatchResult[]>([])
  const [batchIdx, setBatchIdx]       = useState(0)
  const [batchRunning, setBatchRunning] = useState(false)
  const batchStopRef                  = useRef(false)

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
    setVideoSrc(null); setBatchMode(false)
    const { data } = await supabase
      .from('mattrack_signal_instances')
      .select('start_frame, signal_id, signal_label')
      .eq('video_id', video.id)
      .order('start_frame', { ascending: true })
    setGroundTruth((data || []).map(d => ({ frame: d.start_frame, signal_id: d.signal_id, signal_label: d.signal_label })))

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

  // ── Core scan function (reusable for single + batch) ─────────
  const scanVideo = async (
    videoEl: HTMLVideoElement,
    model: unknown,
    onProgress: (pct: number) => void
  ): Promise<Detection[]> => {
    const duration = videoEl.duration
    if (!duration || duration < 0.1) return []
    const totalFrames = Math.floor(duration * FPS / SAMPLE_RATE)
    const allDetections: Detection[] = []

    const canvas = document.createElement('canvas')
    canvas.width = 320; canvas.height = 180
    const ctx = canvas.getContext('2d')!

    // Attach canvas to DOM so GPU can render to it (needed for BlazePose)
    canvas.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:320px;height:180px;'
    document.body.appendChild(canvas)

    let prevKps: { name: string; x: number; y: number; score: number }[] | null = null

    try {
      for (let fi = 0; fi < totalFrames; fi++) {
        if (batchStopRef.current) break
        const frameNum = fi * SAMPLE_RATE
        const time = frameNum / FPS
        if (time >= duration) break

        // Seek and wait for frame decode — with generous timeout
        videoEl.currentTime = time
        await new Promise<void>(r => {
          const h = () => { videoEl.removeEventListener('seeked', h); r() }
          videoEl.addEventListener('seeked', h)
          setTimeout(r, 1500)  // 1.5s fallback for slow seeks
        })
        // Extra tick to ensure frame is painted
        await new Promise(r => setTimeout(r, 30))

        ctx.drawImage(videoEl, 0, 0, 320, 180)

        try {
          // detect() with 3s timeout — if model hangs, skip frame and continue
          const detection: any = await Promise.race([
            new Promise(r => { (model as any).detect(canvas, (res: any) => r(res)) }),
            new Promise(r => setTimeout(() => r(null), 3000))
          ])
          if (detection) {
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
              allDetections.push(...applyNFHSRules(kps, prevKps, frameNum))
            }
            prevKps = kps
          }
        } catch { /* skip frame */ }

        // Update progress every 10 frames
        if (fi % 10 === 0) {
          onProgress(Math.round((fi / totalFrames) * 100))
          await new Promise(r => setTimeout(r, 0))  // yield to UI
        }
      }
    } finally {
      document.body.removeChild(canvas)
    }

    return clusterDetections(allDetections)
  }

  // ── Single video baseline ────────────────────────────────────
  const runBaseline = async () => {
    if (!poseModel || !videoRef.current) return
    setRunning(true); setDetections([]); setEvalResult(null); setProgress(0)
    showToast(`Scanning ${Math.floor(videoRef.current.duration)}s video at ${FPS/SAMPLE_RATE}fps…`)

    const clustered = await scanVideo(videoRef.current, poseModel, setProgress)
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

  // ── Batch baseline ───────────────────────────────────────────
  const startBatch = async () => {
    if (!poseModel || batchQueue.length === 0) return
    setBatchRunning(true)
    batchStopRef.current = false

    const results: BatchResult[] = batchQueue.map(v => ({
      filename: v.filename,
      detections: [],
      groundTruth: [],
      evalResult: null,
      status: 'pending' as const,
    }))
    setBatchResults([...results])

    for (let i = 0; i < batchQueue.length; i++) {
      if (batchStopRef.current) break
      setBatchIdx(i)

      results[i].status = 'running'
      setBatchResults([...results])

      // Load ground truth for this video from DB
      const { data: vData } = await supabase
        .from('mattrack_videos')
        .select('id')
        .ilike('filename', `%${batchQueue[i].filename.replace(/\.[^.]+$/, '')}%`)
        .limit(1)

      let gt: GroundTruth[] = []
      if (vData && vData.length > 0) {
        const { data: gtData } = await supabase
          .from('mattrack_signal_instances')
          .select('start_frame, signal_id, signal_label')
          .eq('video_id', vData[0].id)
          .order('start_frame', { ascending: true })
        gt = (gtData || []).map((d: any) => ({ frame: d.start_frame, signal_id: d.signal_id, signal_label: d.signal_label }))
      }
      results[i].groundTruth = gt

      // Reuse videoRef — same reliable seeking as single-video mode
      const videoEl = videoRef.current!
      videoEl.src = batchQueue[i].url
      videoEl.load()

      try {
        await new Promise<void>((resolve, reject) => {
          const onMeta = () => { videoEl.removeEventListener('loadedmetadata', onMeta); resolve() }
          const onErr  = () => { videoEl.removeEventListener('error', onErr); reject(new Error('Video load failed')) }
          videoEl.addEventListener('loadedmetadata', onMeta)
          videoEl.addEventListener('error', onErr)
          setTimeout(() => reject(new Error('Load timeout — check video server')), 20000)
        })

        const clustered = await scanVideo(videoEl, poseModel, (pct) => {
          setProgress(pct)
        })
        results[i].detections = clustered
        results[i].evalResult = gt.length > 0 ? evaluate(clustered, gt) : null
        results[i].status = 'done'
      } catch (err: any) {
        results[i].status = 'error'
        results[i].error = err?.message || 'Unknown error'
      }

      setBatchResults([...results])
      setProgress(0)
    }

    setBatchRunning(false)
    const done = results.filter(r => r.status === 'done').length
    const withGT = results.filter(r => r.groundTruth.length > 0)
    if (withGT.length > 0) {
      const avgF1 = withGT.reduce((s, r) => s + (r.evalResult?.f1 || 0), 0) / withGT.length
      showToast(`Batch done — ${done}/${results.length} videos · Avg F1: ${(avgF1*100).toFixed(0)}%`)
    } else {
      showToast(`Batch done — ${done}/${results.length} videos scanned`)
    }
  }

  // Aggregate batch stats
  const aggStats = (() => {
    const withGT = batchResults.filter(r => r.evalResult)
    if (withGT.length === 0) return null
    const tp = withGT.reduce((s,r) => s + (r.evalResult?.truePositives||0), 0)
    const fp = withGT.reduce((s,r) => s + (r.evalResult?.falsePositives||0), 0)
    const fn = withGT.reduce((s,r) => s + (r.evalResult?.falseNegatives||0), 0)
    const precision = tp / Math.max(1, tp + fp)
    const recall    = tp / Math.max(1, tp + fn)
    const f1 = 2 * precision * recall / Math.max(0.001, precision + recall)
    return { tp, fp, fn, precision, recall, f1, videoCount: withGT.length }
  })()

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
          {localServer && <span style={{ fontSize:9, color:'#00ff88' }}>✓ VIDEO SERVER · {localVideos.length} files</span>}
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

      {/* Mode toggle */}
      <div style={{ display:'flex', borderBottom:'1px solid #1a1a2e', background:'#0d0d1a' }}>
        {(['single', 'batch'] as const).map(mode => (
          <button key={mode} onClick={() => { setBatchMode(mode === 'batch'); setDetections([]); setEvalResult(null); setBatchResults([]) }}
            style={{ flex:1, padding:'10px 0', background:((batchMode && mode==='batch') || (!batchMode && mode==='single')) ? '#1a1a2e' : 'transparent', border:'none', borderBottom:((batchMode && mode==='batch') || (!batchMode && mode==='single')) ? '2px solid #38bdf8' : '2px solid transparent', color:((batchMode && mode==='batch') || (!batchMode && mode==='single')) ? '#fff' : '#555', cursor:'pointer', fontFamily:'inherit', fontSize:11, letterSpacing:2, textTransform:'uppercase' }}>
            {mode === 'single' ? '▶ SINGLE VIDEO' : '⚡ BATCH — ALL VIDEOS'}
          </button>
        ))}
      </div>

      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

        {/* ── SINGLE MODE ── */}
        {!batchMode && (
          <>
            <div style={{ flex:'0 0 340px', borderRight:'1px solid #1a1a2e', display:'flex', flexDirection:'column' }}>
          <div style={{ flex:1, overflowY:'auto', padding:16, display:'flex', flexDirection:'column', gap:14 }}>
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
                Applies NFHS rules directly to detected body pose — no training. Arm angles, extension, and body lean are checked against each signal definition. This is your baseline.
              </div>
          </div>{/* end scrollable */}

          {/* Sticky run bar */}
          <div style={{ borderTop:'1px solid #1a1a2e', padding:12, background:'#0d0d1a', display:'flex', flexDirection:'column', gap:8 }}>
            {running ? (
              <>
                <div style={{ fontSize:10, color:'#38bdf8', letterSpacing:1 }}>SCANNING… {progress}%</div>
                <div style={{ height:4, background:'#1a1a2e', borderRadius:2 }}>
                  <div style={{ width:`${progress}%`, height:'100%', background:'#38bdf8', borderRadius:2, transition:'width 0.3s' }} />
                </div>
              </>
            ) : (
              <button onClick={runBaseline} disabled={!videoSrc || !modelReady}
                style={{ background: !videoSrc || !modelReady ? '#1a1a2e' : '#38bdf8', border:'none', color: !videoSrc || !modelReady ? '#333' : '#000', padding:'12px 0', cursor: !videoSrc || !modelReady ? 'not-allowed':'pointer', fontFamily:'inherit', fontSize:12, letterSpacing:2, fontWeight:'bold', width:'100%' }}>
                {!modelReady ? 'LOAD MODEL FIRST' : !videoSrc ? 'SELECT VIDEO ABOVE' : '▶ RUN ZERO-SHOT BASELINE'}
              </button>
            )}
          </div>
            </div>

            {/* Right: detections */}
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
                    {evalResult && evalResult.unmatched_detections.length > 0 && (
                      <div>
                        <div style={{ padding:'8px 16px', background:'#2e0d0d', fontSize:10, color:'#f87171', letterSpacing:2 }}>✗ FALSE POSITIVES ({evalResult.unmatched_detections.length})</div>
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
                    {evalResult && evalResult.unmatched_gt.length > 0 && (
                      <div>
                        <div style={{ padding:'8px 16px', background:'#2e2000', fontSize:10, color:'#fbbf24', letterSpacing:2 }}>⚠ MISSED ({evalResult.unmatched_gt.length})</div>
                        {evalResult.unmatched_gt.map((gt, i) => (
                          <div key={i} style={{ padding:'10px 16px', borderBottom:'1px solid #111', display:'flex', gap:12, borderLeft:'3px solid #fbbf24' }}>
                            <div style={{ minWidth:50, fontSize:12, fontWeight:'bold' }}>{fmt(gt.frame/FPS)}</div>
                            <div style={{ flex:1 }}>
                              <div style={{ fontSize:11, color:'#fbbf24' }}>{gt.signal_label}</div>
                              <div style={{ fontSize:10, color:'#555', marginTop:2 }}>F{gt.frame} — rule-based detector missed this</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {(!evalResult && detections.length > 0) && (
                      <div>
                        <div style={{ padding:'8px 16px', fontSize:10, color:'#38bdf8', letterSpacing:2 }}>ALL DETECTIONS</div>
                        {detections.map((d, i) => (
                          <div key={i} style={{ padding:'10px 16px', borderBottom:'1px solid #111', display:'flex', gap:12, borderLeft:'3px solid #38bdf8' }}>
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
          </>
        )}

        {/* ── BATCH MODE ── */}
        {batchMode && (
          <>
            <div style={{ flex:'0 0 360px', borderRight:'1px solid #1a1a2e', display:'flex', flexDirection:'column' }}>
              {/* Scrollable list */}
              <div style={{ flex:1, overflowY:'auto', padding:16, display:'flex', flexDirection:'column', gap:14 }}>

              {!localServer ? (
                <div style={{ background:'#1a0a0a', border:'1px solid #f87171', padding:16, fontSize:11, color:'#f87171', lineHeight:2 }}>
                  ⚠ Video server not running<br />
                  <span style={{ color:'#444' }}>Run: python scripts/video_server.py</span>
                </div>
              ) : (
                <>
                  <div>
                    <div style={{ fontSize:10, color:'#555', letterSpacing:2, marginBottom:8 }}>SELECT VIDEOS TO BATCH SCAN</div>
                    <div style={{ display:'flex', gap:6, marginBottom:10 }}>
                      <button onClick={() => setBatchQueue([...localVideos])} style={{ ...btn, fontSize:10, padding:'6px 10px', color:'#38bdf8', borderColor:'#38bdf8' }}>SELECT ALL ({localVideos.length})</button>
                      <button onClick={() => setBatchQueue([])} style={{ ...btn, fontSize:10, padding:'6px 10px' }}>CLEAR</button>
                    </div>
                    {localVideos.map(v => {
                      const inQueue = batchQueue.some(q => q.filename === v.filename)
                      return (
                        <button key={v.filename} onClick={() => setBatchQueue(prev => inQueue ? prev.filter(q => q.filename !== v.filename) : [...prev, v])}
                          style={{ display:'block', width:'100%', textAlign:'left', marginBottom:4, background:inQueue?'#1a1a2e':'transparent', border:`1px solid ${inQueue?'#38bdf8':'#1a1a2e'}`, color:inQueue?'#fff':'#555', padding:'8px 12px', cursor:'pointer', fontFamily:'inherit' }}>
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                            <span style={{ fontSize:11 }}>{v.filename.replace(/\.[^.]+$/, '')}</span>
                            <span style={{ fontSize:9, color:'#444' }}>{v.size_mb}MB</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>

                  {batchQueue.length > 0 && modelReady && !batchRunning && (
                    <button onClick={startBatch} style={{ background:'#38bdf8', border:'none', color:'#000', padding:'12px 0', cursor:'pointer', fontFamily:'inherit', fontSize:12, letterSpacing:2, fontWeight:'bold', width:'100%' }}>
                      ▶ RUN BATCH ({batchQueue.length} videos)
                    </button>
                  )}

                  {batchRunning && (
                    <>
                      <div style={{ fontSize:10, color:'#38bdf8' }}>
                        SCANNING {batchIdx + 1}/{batchQueue.length}: {batchQueue[batchIdx]?.filename}
                      </div>
                      <div style={{ height:4, background:'#1a1a2e', borderRadius:2 }}>
                        <div style={{ width:`${progress}%`, height:'100%', background:'#38bdf8', borderRadius:2, transition:'width 0.3s' }} />
                      </div>
                      <button onClick={() => { batchStopRef.current = true }} style={{ ...btn, color:'#f87171', borderColor:'#f87171', width:'100%', padding:'8px 0' }}>
                        ■ STOP BATCH
                      </button>
                    </>
                  )}

                  {!modelReady && (
                    <div style={{ fontSize:10, color:'#fbbf24' }}>⚠ Load pose model first (top right)</div>
                  )}
                </>
              )}
              </div>{/* end scrollable */}

              {/* Sticky run/stop bar */}
              {localServer && (
                <div style={{ borderTop:'1px solid #1a1a2e', padding:12, background:'#0d0d1a', display:'flex', flexDirection:'column', gap:8 }}>
                  {batchRunning ? (
                    <>
                      <div style={{ fontSize:10, color:'#38bdf8', letterSpacing:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {batchIdx + 1}/{batchQueue.length}: {batchQueue[batchIdx]?.filename.replace(/\.[^.]+$/,'')}
                      </div>
                      <div style={{ height:4, background:'#1a1a2e', borderRadius:2 }}>
                        <div style={{ width:`${progress}%`, height:'100%', background:'#38bdf8', borderRadius:2, transition:'width 0.3s' }} />
                      </div>
                      <button onClick={() => { batchStopRef.current = true }}
                        style={{ background:'transparent', border:'1px solid #f87171', color:'#f87171', padding:'10px 0', cursor:'pointer', fontFamily:'inherit', fontSize:11, letterSpacing:2, width:'100%' }}>
                        ■ STOP BATCH
                      </button>
                    </>
                  ) : (
                    <button onClick={startBatch} disabled={batchQueue.length === 0 || !modelReady}
                      style={{ background: batchQueue.length === 0 || !modelReady ? '#1a1a2e' : '#38bdf8', border:'none', color: batchQueue.length === 0 || !modelReady ? '#333' : '#000', padding:'12px 0', cursor: batchQueue.length === 0 || !modelReady ? 'not-allowed':'pointer', fontFamily:'inherit', fontSize:12, letterSpacing:2, fontWeight:'bold', width:'100%' }}>
                      {!modelReady ? 'LOAD MODEL FIRST' : batchQueue.length === 0 ? 'SELECT VIDEOS ABOVE' : `▶ RUN BATCH (${batchQueue.length} videos)`}
                    </button>
                  )}
                </div>
              )}

              {/* Aggregate stats */}
              {aggStats && (
                <div style={{ background:'#0d0d1a', border:'1px solid #1a1a2e', padding:14 }}>
                  <div style={{ fontSize:10, color:'#555', letterSpacing:2, marginBottom:10 }}>AGGREGATE — {aggStats.videoCount} VIDEOS W/ GT</div>
                  {[
                    { label:'PRECISION', value:aggStats.precision },
                    { label:'RECALL',    value:aggStats.recall },
                    { label:'F1 SCORE',  value:aggStats.f1 },
                  ].map(m => (
                    <div key={m.label} style={{ marginBottom:8 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}>
                        <span style={{ fontSize:10, color:'#555' }}>{m.label}</span>
                        <span style={{ fontSize:14, fontWeight:'bold', color: m.value>0.7?'#00ff88':m.value>0.4?'#fbbf24':'#f87171' }}>{(m.value*100).toFixed(0)}%</span>
                      </div>
                      <div style={{ height:4, background:'#111', borderRadius:2 }}>
                        <div style={{ width:`${m.value*100}%`, height:'100%', background:m.value>0.7?'#00ff88':m.value>0.4?'#fbbf24':'#f87171', borderRadius:2 }} />
                      </div>
                    </div>
                  ))}
                  <div style={{ display:'flex', gap:12, fontSize:10, marginTop:8 }}>
                    <span style={{ color:'#00ff88' }}>✓ {aggStats.tp} TP</span>
                    <span style={{ color:'#f87171' }}>✗ {aggStats.fp} FP</span>
                    <span style={{ color:'#fbbf24' }}>⚠ {aggStats.fn} FN</span>
                  </div>
                </div>
              )}
            </div>

            {/* Right: batch results list */}
            <div style={{ flex:1, overflowY:'auto' }}>
              {batchResults.length === 0 ? (
                <div style={{ padding:32, textAlign:'center', color:'#222', fontSize:11 }}>
                  {localServer ? 'Select videos and run batch scan' : 'Start video server first'}
                </div>
              ) : (
                batchResults.map((r, i) => {
                  const statusColor = r.status === 'done' ? '#00ff88' : r.status === 'error' ? '#f87171' : r.status === 'running' ? '#38bdf8' : '#333'
                  return (
                    <div key={i} style={{ padding:'12px 16px', borderBottom:'1px solid #111', borderLeft:`3px solid ${statusColor}` }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                        <span style={{ fontSize:11, color:'#ccc' }}>{r.filename.replace(/\.[^.]+$/, '')}</span>
                        <span style={{ fontSize:10, color:statusColor, letterSpacing:1 }}>{r.status.toUpperCase()}{r.status === 'running' ? ` ${progress}%` : ''}</span>
                      </div>
                      {r.status === 'done' && (
                        <div style={{ display:'flex', gap:16, fontSize:10 }}>
                          <span style={{ color:'#38bdf8' }}>{r.detections.length} detections</span>
                          {r.groundTruth.length > 0 && r.evalResult ? (
                            <>
                              <span style={{ color:'#555' }}>{r.groundTruth.length} GT</span>
                              <span style={{ color:r.evalResult.precision>0.7?'#00ff88':r.evalResult.precision>0.4?'#fbbf24':'#f87171' }}>P:{(r.evalResult.precision*100).toFixed(0)}%</span>
                              <span style={{ color:r.evalResult.recall>0.7?'#00ff88':r.evalResult.recall>0.4?'#fbbf24':'#f87171' }}>R:{(r.evalResult.recall*100).toFixed(0)}%</span>
                              <span style={{ color:r.evalResult.f1>0.7?'#00ff88':r.evalResult.f1>0.4?'#fbbf24':'#f87171', fontWeight:'bold' }}>F1:{(r.evalResult.f1*100).toFixed(0)}%</span>
                            </>
                          ) : (
                            <span style={{ color:'#333' }}>no GT</span>
                          )}
                        </div>
                      )}
                      {r.status === 'error' && <div style={{ fontSize:10, color:'#f87171' }}>{r.error}</div>}
                      {r.status === 'running' && (
                        <div style={{ height:2, background:'#1a1a2e', borderRadius:1, marginTop:6 }}>
                          <div style={{ width:`${progress}%`, height:'100%', background:'#38bdf8', borderRadius:1, transition:'width 0.3s' }} />
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}


