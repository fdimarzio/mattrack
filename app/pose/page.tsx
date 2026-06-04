'use client'

import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────
interface LabeledInstance {
  id: string
  signal_id: string
  signal_label: string
  signal_category: string
  start_frame: number
  peak_frame: number | null
  end_frame: number
  video_id: string
  filename: string
}

interface PoseKeypoint {
  name: string
  x: number
  y: number
  score: number
}

interface PoseResult {
  instanceId: string
  signalId: string
  signalLabel: string
  frame: number
  keypoints: PoseKeypoint[]
  armAngle: number        // angle between ref's wrist and shoulder
  wristHeight: number     // normalized wrist Y position (0=top, 1=bottom)
  armsRaised: boolean     // both wrists above shoulders
  armSpread: number       // horizontal distance between wrists
  poseScore: number       // overall detection confidence
}

// MediaPipe keypoint indices
const KP = {
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,    RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,    RIGHT_WRIST: 16,
  LEFT_HIP: 23,      RIGHT_HIP: 24,
}

const catColor: Record<string, string> = {
  scoring: '#00ff88', control: '#a78bfa', clock: '#38bdf8',
  violation: '#f87171', time: '#fb923c', outcome: '#ff0055',
}

const fmt = (s: number) => { const m = Math.floor(s/60), sec = Math.floor(s%60); return `${m}:${sec.toString().padStart(2,'0')}` }

export default function PosePage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [videoSrc, setVideoSrc] = useState<string | null>(null)
  const [videoName, setVideoName] = useState('')
  const [instances, setInstances] = useState<LabeledInstance[]>([])
  const [results, setResults] = useState<PoseResult[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [poseModel, setPoseModel] = useState<unknown>(null)
  const [modelLoading, setModelLoading] = useState(false)
  const [modelReady, setModelReady] = useState(false)
  const [selectedResult, setSelectedResult] = useState<PoseResult | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const fps = 30

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  // Load MediaPipe pose model
  const loadModel = async () => {
    setModelLoading(true)
    try {
      // @ts-ignore
      const vision = await window.createMediaPipeVision?.({
        locateFile: (f: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm/${f}`
      })
      if (!vision) {
        showToast('Loading MediaPipe from CDN…')
        return
      }
      // @ts-ignore
      const { PoseLandmarker, FilesetResolver } = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/+esm')
      const filesetResolver = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm'
      )
      const model = await PoseLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
          delegate: 'GPU'
        },
        runningMode: 'IMAGE',
        numPoses: 3,  // detect up to 3 people (2 wrestlers + ref)
      })
      setPoseModel(model)
      setModelReady(true)
      showToast('MediaPipe pose model ready ✓')
    } catch (err) {
      showToast('Model load error — check console')
      console.error(err)
    }
    setModelLoading(false)
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setVideoSrc(URL.createObjectURL(file))
    setVideoName(file.name)
    setResults([])
    setSelectedResult(null)

    // Load labels for this video
    const { data: vids } = await supabase.from('mattrack_videos').select('id').eq('filename', file.name).limit(1)
    if (!vids || vids.length === 0) { showToast('No labels found for this video'); return }
    const { data: labels } = await supabase
      .from('mattrack_signal_instances')
      .select('id, signal_id, signal_label, signal_category, start_frame, peak_frame, end_frame, video_id')
      .eq('video_id', vids[0].id)
      .order('start_frame', { ascending: true })
    if (!labels || labels.length === 0) { showToast('No labeled instances found'); return }
    setInstances(labels.map(l => ({ ...l, filename: file.name })))
    showToast(`Found ${labels.length} labeled instances — ready to analyze`)
  }

  // Extract frame from video at given time
  const extractFrame = (time: number): Promise<HTMLCanvasElement> => new Promise((resolve, reject) => {
    const video = videoRef.current!
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')!
    video.currentTime = time
    const handler = () => {
      video.removeEventListener('seeked', handler)
      ctx.drawImage(video, 0, 0)
      resolve(canvas)
    }
    video.addEventListener('seeked', handler)
  })

  // Detect wrestler color from canvas region
  // Checks ankle band first (more reliable), falls back to singlet color
  const detectWrestlerColor = (canvas: HTMLCanvasElement, bboxX: number, bboxY: number, bboxW: number, bboxH: number): 'red' | 'green' | 'unknown' => {
    const ctx = canvas.getContext('2d')!
    const cw = canvas.width, ch = canvas.height

    // Sample ankle region (bottom 15% of person bbox)
    const ax = Math.floor(bboxX * cw)
    const ay = Math.floor((bboxY + bboxH * 0.85) * ch)
    const aw = Math.floor(bboxW * cw)
    const ah = Math.floor(bboxH * 0.15 * ch)

    if (aw <= 0 || ah <= 0) return 'unknown'

    const ankleData = ctx.getImageData(ax, ay, Math.max(1, aw), Math.max(1, ah)).data
    const torsoData = ctx.getImageData(
      Math.floor(bboxX * cw), Math.floor((bboxY + bboxH * 0.2) * ch),
      Math.max(1, aw), Math.max(1, Math.floor(bboxH * 0.5 * ch))
    ).data

    let ankleRed = 0, ankleGreen = 0, torsoRed = 0, torsoGreen = 0

    // Ankle pixels
    for (let i = 0; i < ankleData.length; i += 4) {
      const r = ankleData[i], g = ankleData[i+1], b = ankleData[i+2]
      const max = Math.max(r,g,b), min = Math.min(r,g,b), delta = max - min
      if (delta > 50 && max > 60) {  // saturated pixel
        const hue = max === r ? ((g-b)/delta + (g<b?6:0)) * 60
                  : max === g ? ((b-r)/delta + 2) * 60
                  : ((r-g)/delta + 4) * 60
        if ((hue < 20 || hue > 340)) ankleRed++
        else if (hue > 90 && hue < 160) ankleGreen++
      }
    }

    // Torso pixels (singlet fallback)
    for (let i = 0; i < torsoData.length; i += 4) {
      const r = torsoData[i], g = torsoData[i+1], b = torsoData[i+2]
      const max = Math.max(r,g,b), min = Math.min(r,g,b), delta = max - min
      if (delta > 50 && max > 60) {
        const hue = max === r ? ((g-b)/delta + (g<b?6:0)) * 60
                  : max === g ? ((b-r)/delta + 2) * 60
                  : ((r-g)/delta + 4) * 60
        if ((hue < 20 || hue > 340)) torsoRed++
        else if (hue > 90 && hue < 160) torsoGreen++
      }
    }

    // Weight ankle 70%, torso 30%
    const totalAnkle = ankleData.length / 4
    const totalTorso = torsoData.length / 4
    const redScore   = (ankleRed / totalAnkle) * 0.7 + (torsoRed / totalTorso) * 0.3
    const greenScore = (ankleGreen / totalAnkle) * 0.7 + (torsoGreen / totalTorso) * 0.3

    if (redScore > greenScore && redScore > 0.03) return 'red'
    if (greenScore > redScore && greenScore > 0.03) return 'green'
    return 'unknown'
  }

  // Compute arm metrics from keypoints
  const computeArmMetrics = (keypoints: PoseKeypoint[]) => {
    const kpByName = Object.fromEntries(keypoints.map(k => [k.name, k]))
    const lw = kpByName['LEFT_WRIST']
    const rw = kpByName['RIGHT_WRIST']
    const ls = kpByName['LEFT_SHOULDER']
    const rs = kpByName['RIGHT_SHOULDER']

    const shoulderY = ls && rs ? (ls.y + rs.y) / 2 : 0.5
    const wristY = lw && rw ? Math.min(lw.y, rw.y) : (lw?.y || rw?.y || 0.5)
    const armsRaised = wristY < shoulderY - 0.05

    const armSpread = lw && rw ? Math.abs(lw.x - rw.x) : 0

    // Angle of dominant wrist relative to shoulder
    const wrist = lw || rw
    const shoulder = ls || rs
    let armAngle = 0
    if (wrist && shoulder) {
      armAngle = Math.atan2(shoulder.y - wrist.y, wrist.x - shoulder.x) * 180 / Math.PI
    }

    const avgScore = keypoints.filter(k =>
      ['LEFT_WRIST','RIGHT_WRIST','LEFT_SHOULDER','RIGHT_SHOULDER'].includes(k.name)
    ).reduce((s, k) => s + k.score, 0) / 4

    return { armAngle, wristHeight: wristY, armsRaised, armSpread, poseScore: avgScore }
  }

  const runAnalysis = async () => {
    if (!poseModel || !videoRef.current || instances.length === 0) return
    setAnalyzing(true)
    setResults([])
    const newResults: PoseResult[] = []

    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i]
      // Use peak frame if available, else midpoint
      const targetFrame = inst.peak_frame || Math.round((inst.start_frame + inst.end_frame) / 2)
      const time = targetFrame / fps

      try {
        const frameCanvas = await extractFrame(time)

        // Run pose detection
        // @ts-ignore
        const detection = poseModel.detect(frameCanvas)

        if (detection.landmarks && detection.landmarks.length > 0) {
          // Find the person most likely to be the ref
          // Heuristic: ref tends to be standing (not crouched like wrestlers)
          // Use the pose with highest average landmark score in upper body
          let bestPose = detection.landmarks[0]
          let bestScore = 0

          for (const landmarks of detection.landmarks) {
            const upperBodyScore = [0,11,12,13,14,15,16].reduce((s: number, idx: number) => s + (landmarks[idx]?.visibility || 0), 0) / 7
            if (upperBodyScore > bestScore) { bestScore = upperBodyScore; bestPose = landmarks }
          }

          const keypoints: PoseKeypoint[] = bestPose.map((lm: {x:number,y:number,visibility:number}, idx: number) => ({
            name: Object.entries(KP).find(([, v]) => v === idx)?.[0] || `kp_${idx}`,
            x: lm.x, y: lm.y, score: lm.visibility || 0,
          })).filter((k: PoseKeypoint) => k.score > 0.3)

          const metrics = computeArmMetrics(keypoints)
          newResults.push({
            instanceId: inst.id,
            signalId: inst.signal_id,
            signalLabel: inst.signal_label,
            frame: targetFrame,
            keypoints,
            ...metrics,
          })

          // Draw skeleton on canvas for visual feedback
          const canvas = canvasRef.current
          if (canvas) {
            const ctx = canvas.getContext('2d')!
            canvas.width = frameCanvas.width
            canvas.height = frameCanvas.height
            ctx.drawImage(frameCanvas, 0, 0)
            // Draw keypoints
            keypoints.forEach(kp => {
              ctx.beginPath()
              ctx.arc(kp.x * canvas.width, kp.y * canvas.height, 6, 0, Math.PI * 2)
              ctx.fillStyle = '#ff0055'
              ctx.fill()
            })
          }
        } else {
          // No pose detected — still record with empty keypoints
          newResults.push({
            instanceId: inst.id, signalId: inst.signal_id, signalLabel: inst.signal_label,
            frame: targetFrame, keypoints: [], armAngle: 0, wristHeight: 0.5,
            armsRaised: false, armSpread: 0, poseScore: 0,
          })
        }
      } catch (err) {
        console.error('Pose error for instance', inst.id, err)
      }

      setProgress(Math.round(((i + 1) / instances.length) * 100))
      await new Promise(r => setTimeout(r, 50))
    }

    setResults(newResults)
    setAnalyzing(false)
    showToast(`Analysis complete — ${newResults.filter(r => r.poseScore > 0).length}/${newResults.length} poses detected`)

    // Save keypoints back to DB
    for (const r of newResults) {
      if (r.keypoints.length > 0) {
        await supabase.from('mattrack_signal_instances').update({
          peak_pose_keypoints: r.keypoints,
          pose_model_used: 'mediapipe_lite',
        }).eq('id', r.instanceId)
      }
    }
  }

  // Group results by signal for pattern view
  const bySignal = results.reduce((acc, r) => {
    if (!acc[r.signalId]) acc[r.signalId] = []
    acc[r.signalId].push(r)
    return acc
  }, {} as Record<string, PoseResult[]>)

  return (
    <div style={{ minHeight:'100vh', background:'#08080f', color:'#e0e0f0', fontFamily:"'Courier New',monospace", display:'flex', flexDirection:'column' }}>

      {/* Header */}
      <div style={{ background:'#0d0d1a', borderBottom:'2px solid #a78bfa', padding:'10px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <a href="/" style={{ color:'#555', textDecoration:'none', fontSize:11 }}>← HOME</a>
          <div style={{ fontSize:16, color:'#a78bfa', fontWeight:'bold', letterSpacing:3 }}>MATTRACK / POSE ANALYSIS</div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {!modelReady && (
            <button onClick={loadModel} disabled={modelLoading} style={{ background:'#a78bfa', border:'none', color:'#000', padding:'7px 14px', cursor:modelLoading?'not-allowed':'pointer', fontFamily:'inherit', fontSize:11, letterSpacing:1, fontWeight:'bold', opacity:modelLoading?0.6:1 }}>
              {modelLoading ? 'LOADING MODEL…' : '⚡ LOAD MEDIAPIPE'}
            </button>
          )}
          {modelReady && <span style={{ fontSize:11, color:'#00ff88', padding:'7px 0' }}>✓ MODEL READY</span>}
          <button onClick={() => fileInputRef.current?.click()} style={{ background:'#a78bfa', border:'none', color:'#000', padding:'7px 14px', cursor:'pointer', fontFamily:'inherit', fontSize:11, letterSpacing:1, fontWeight:'bold' }}>
            ↑ LOAD VIDEO
          </button>
        </div>
        <input ref={fileInputRef} type="file" accept="video/*" onChange={handleFile} style={{ display:'none' }} />
      </div>

      {toast && <div style={{ position:'fixed', top:16, left:'50%', transform:'translateX(-50%)', background:'#00ff88', color:'#000', padding:'10px 20px', fontFamily:'inherit', fontSize:12, fontWeight:'bold', zIndex:999 }}>{toast}</div>}

      <video ref={videoRef} src={videoSrc||undefined} style={{ display:'none' }} preload="auto" />

      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

        {/* Left: frame preview + controls */}
        <div style={{ flex:'0 0 45%', display:'flex', flexDirection:'column', borderRight:'1px solid #1a1a2e' }}>
          <div style={{ position:'relative', background:'#000', aspectRatio:'16/9' }}>
            {videoSrc ? (
              <canvas ref={canvasRef} style={{ width:'100%', height:'100%', display:'block' }} />
            ) : (
              <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:12 }}>
                <div style={{ fontSize:36, opacity:0.2 }}>🦾</div>
                <div style={{ color:'#333', letterSpacing:2, fontSize:11 }}>LOAD VIDEO + MEDIAPIPE</div>
              </div>
            )}
          </div>

          <div style={{ padding:16, flex:1, overflowY:'auto' }}>
            {/* Status */}
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:10, color:'#555', letterSpacing:2, marginBottom:8 }}>STATUS</div>
              <div style={{ fontSize:11, color:'#444', lineHeight:1.8 }}>
                {!videoSrc && '1. Load a labeled video file'}
                {videoSrc && !modelReady && '2. Load MediaPipe model (click button above)'}
                {videoSrc && modelReady && instances.length === 0 && '⚠️ No labels found for this video'}
                {videoSrc && modelReady && instances.length > 0 && !analyzing && results.length === 0 && `✓ ${instances.length} labeled instances ready`}
                {analyzing && `Analyzing frame ${Math.round(progress * instances.length / 100)} of ${instances.length}…`}
                {results.length > 0 && `✓ ${results.filter(r => r.poseScore > 0).length}/${results.length} poses detected`}
              </div>
            </div>

            {/* Progress */}
            {analyzing && (
              <div style={{ marginBottom:16 }}>
                <div style={{ height:4, background:'#1a1a2e', borderRadius:2, overflow:'hidden' }}>
                  <div style={{ width:`${progress}%`, height:'100%', background:'#a78bfa', transition:'width 0.3s' }} />
                </div>
              </div>
            )}

            {/* Run button */}
            {videoSrc && modelReady && instances.length > 0 && !analyzing && (
              <button onClick={runAnalysis} style={{ background:'#a78bfa', border:'none', color:'#000', padding:'12px 0', cursor:'pointer', fontFamily:'inherit', fontSize:12, letterSpacing:2, fontWeight:'bold', width:'100%', marginBottom:16 }}>
                ▶ RUN POSE ANALYSIS ({instances.length} frames)
              </button>
            )}

            {/* How it works */}
            <div style={{ background:'#0d0d1a', border:'1px solid #1a1a2e', padding:14, fontSize:10, color:'#444', lineHeight:1.8 }}>
              <div style={{ color:'#666', marginBottom:4 }}>HOW THIS WORKS</div>
              MediaPipe detects body keypoints (shoulders, elbows, wrists) on the peak frame of each labeled instance. We then compute arm angle, wrist height, and arm spread for each signal type. Signals with similar poses should cluster together — that pattern IS the model.
              <div style={{ marginTop:8, color:'#333' }}>
                The ref is identified as the most upright standing person in frame. Wrestlers are typically crouched.
              </div>
            </div>

            {/* Selected result detail */}
            {selectedResult && (
              <div style={{ marginTop:16, background:'#0d0d1a', border:`1px solid ${catColor[results.find(r=>r.instanceId===selectedResult.instanceId)?.signalId?.includes('scoring')?'scoring':'control']||'#1a1a2e'}`, padding:14 }}>
                <div style={{ fontSize:11, color:'#a78bfa', marginBottom:8, fontWeight:'bold' }}>{selectedResult.signalLabel}</div>
                <div style={{ fontSize:10, color:'#555', lineHeight:1.8 }}>
                  Frame: {selectedResult.frame} ({fmt(selectedResult.frame/fps)})<br/>
                  Pose confidence: {Math.round(selectedResult.poseScore*100)}%<br/>
                  Arms raised: {selectedResult.armsRaised ? '✓ YES' : '✗ NO'}<br/>
                  Wrist height: {(selectedResult.wristHeight*100).toFixed(0)}% from top<br/>
                  Arm spread: {(selectedResult.armSpread*100).toFixed(0)}% of frame width<br/>
                  Arm angle: {selectedResult.armAngle.toFixed(0)}°<br/>
                  Keypoints detected: {selectedResult.keypoints.length}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: results */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

          {results.length === 0 ? (
            <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#2a2a3a', fontSize:11, flexDirection:'column', gap:12 }}>
              <div style={{ fontSize:32, opacity:0.2 }}>🦾</div>
              <div>Run analysis to see pose signatures</div>
            </div>
          ) : (
            <>
              {/* Pattern summary by signal */}
              <div style={{ padding:'12px 16px', borderBottom:'1px solid #1a1a2e', fontSize:10, color:'#444', letterSpacing:2 }}>POSE PATTERNS BY SIGNAL TYPE</div>
              <div style={{ flex:1, overflowY:'auto', padding:'8px 0' }}>
                {Object.entries(bySignal).map(([sigId, sigResults]) => {
                  const avgArmsRaised = sigResults.filter(r => r.armsRaised).length / sigResults.length
                  const avgWristH = sigResults.reduce((s,r) => s+r.wristHeight,0)/sigResults.length
                  const avgSpread = sigResults.reduce((s,r) => s+r.armSpread,0)/sigResults.length
                  const avgConf = sigResults.reduce((s,r) => s+r.poseScore,0)/sigResults.length
                  const label = sigResults[0].signalLabel
                  const cat = instances.find(i => i.signal_id === sigId)?.signal_category || 'control'
                  const color = catColor[cat]

                  return (
                    <div key={sigId} style={{ padding:'10px 16px', borderBottom:'1px solid #111' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                        <span style={{ color, fontSize:12, fontWeight:'bold' }}>{label}</span>
                        <span style={{ color:'#444', fontSize:10 }}>{sigResults.length} sample{sigResults.length>1?'s':''}</span>
                      </div>
                      {avgConf < 0.2 ? (
                        <div style={{ fontSize:10, color:'#f87171' }}>⚠️ Pose not detected — ref may be occluded or out of frame</div>
                      ) : (
                        <div style={{ display:'flex', gap:16, fontSize:10, color:'#555', flexWrap:'wrap' }}>
                          <span>Arms raised: <span style={{ color: avgArmsRaised > 0.5 ? '#00ff88' : '#555' }}>{Math.round(avgArmsRaised*100)}%</span></span>
                          <span>Wrist pos: <span style={{ color:'#aaa' }}>{Math.round(avgWristH*100)}% down</span></span>
                          <span>Arm spread: <span style={{ color:'#aaa' }}>{Math.round(avgSpread*100)}%</span></span>
                          <span>Confidence: <span style={{ color: avgConf > 0.7 ? '#00ff88' : avgConf > 0.4 ? '#fbbf24' : '#f87171' }}>{Math.round(avgConf*100)}%</span></span>
                        </div>
                      )}
                      {/* Individual frames */}
                      <div style={{ display:'flex', gap:6, marginTop:6, flexWrap:'wrap' }}>
                        {sigResults.map(r => (
                          <button key={r.instanceId} onClick={() => {
                            setSelectedResult(r)
                            if (videoRef.current) {
                              videoRef.current.currentTime = r.frame/fps
                            }
                          }} style={{
                            background: selectedResult?.instanceId === r.instanceId ? '#1a1a2e' : 'transparent',
                            border:`1px solid ${r.poseScore > 0.4 ? color : '#333'}`,
                            color: r.poseScore > 0.4 ? color : '#333',
                            padding:'3px 8px', cursor:'pointer', fontFamily:'inherit', fontSize:9,
                          }}>
                            F{r.frame} {r.poseScore > 0.4 ? `${Math.round(r.poseScore*100)}%` : '?'}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
