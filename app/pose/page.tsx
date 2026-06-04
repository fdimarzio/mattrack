'use client'

import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

interface VideoRecord {
  id: string
  filename: string
  duration_seconds: number
  label_count: number
}

interface LabeledInstance {
  id: string
  signal_id: string
  signal_label: string
  signal_category: string
  start_frame: number
  peak_frame: number | null
  end_frame: number
  video_id: string
}

interface PoseResult {
  instanceId: string
  signalId: string
  signalLabel: string
  signalCategory: string
  frame: number
  keypoints: { name: string; x: number; y: number; score: number }[]
  armsRaised: boolean
  wristHeight: number
  armSpread: number
  poseScore: number
}

const catColor: Record<string, string> = {
  scoring: '#00ff88', control: '#a78bfa', clock: '#38bdf8',
  violation: '#f87171', time: '#fb923c', outcome: '#ff0055',
}

const fmt = (s: number) => {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default function PosePage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Step 1: pick from DB list
  const [videos, setVideos] = useState<VideoRecord[]>([])
  const [selectedVideo, setSelectedVideo] = useState<VideoRecord | null>(null)
  const [instances, setInstances] = useState<LabeledInstance[]>([])

  // Step 2: load local file
  const [videoSrc, setVideoSrc] = useState<string | null>(null)
  const [fileLoaded, setFileLoaded] = useState(false)

  // Step 3: pose analysis
  const [modelReady, setModelReady] = useState(false)
  const [modelLoading, setModelLoading] = useState(false)
  const [poseModel, setPoseModel] = useState<unknown>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState<PoseResult[]>([])
  const [selectedResult, setSelectedResult] = useState<PoseResult | null>(null)

  const [toast, setToast] = useState<string | null>(null)
  const [localServer, setLocalServer] = useState(false)
  const [localVideos, setLocalVideos] = useState<{filename:string,url:string,size_mb:number}[]>([])
  const [checkingServer, setCheckingServer] = useState(false)
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3500) }

  // Check for local video server on mount
  useEffect(() => {
    const checkServer = async () => {
      setCheckingServer(true)
      try {
        const res = await fetch('http://localhost:7432/ping', { signal: AbortSignal.timeout(2000) })
        if (res.ok) {
          setLocalServer(true)
          const vidRes = await fetch('http://localhost:7432/videos')
          const data = await vidRes.json()
          setLocalVideos(data.videos || [])
        }
      } catch {
        setLocalServer(false)
      }
      setCheckingServer(false)
    }
    checkServer()
  }, [])

  const loadFromLocalServer = (vid: {filename:string,url:string,size_mb:number}) => {
    setVideoSrc(vid.url)
    setFileLoaded(true)
    showToast(`${vid.filename} loaded from local server ✓`)
  }

  // Load video list from DB on mount
  useEffect(() => {
    supabase.rpc('get_videos_with_label_count')
      .then(({ data, error }) => {
        if (error || !data) {
          // fallback query
          supabase.from('mattrack_videos')
            .select('id, filename, duration_seconds')
            .order('created_at', { ascending: false })
            .then(({ data: vids }) => {
              if (vids) setVideos(vids.map(v => ({ ...v, label_count: 0 })))
            })
          return
        }
        setVideos((data as VideoRecord[]).filter(v => v.label_count > 0))
      })
  }, [])

  const selectVideo = async (video: VideoRecord) => {
    setSelectedVideo(video)
    setResults([])
    setVideoSrc(null)
    setFileLoaded(false)
    setSelectedResult(null)

    const { data: labels } = await supabase
      .from('mattrack_signal_instances')
      .select('id, signal_id, signal_label, signal_category, start_frame, peak_frame, end_frame, video_id')
      .eq('video_id', video.id)
      .order('start_frame', { ascending: true })

    setInstances(labels || [])
    showToast(`${labels?.length || 0} labels loaded — now select the video file`)
    // Auto-open file picker
    setTimeout(() => fileInputRef.current?.click(), 300)
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setVideoSrc(URL.createObjectURL(file))
    setFileLoaded(true)
    showToast(`${file.name} loaded ✓`)
  }

  const loadModel = async () => {
    setModelLoading(true)
    try {
      // Load MediaPipe via script tag (avoids CSP ESM restrictions)
      await new Promise<void>((resolve, reject) => {
        if ((window as any).ml5) { resolve(); return }
        const script = document.createElement('script')
        script.src = 'https://unpkg.com/ml5@1.2.1/dist/ml5.min.js'
        script.onload = () => resolve()
        script.onerror = reject
        document.head.appendChild(script)
      })
      showToast('ML5 loaded — initialising pose model…')

      // Use ml5 bodyPose (wraps MediaPipe BlazePose)
      await new Promise<void>((resolve, reject) => {
        const ml5 = (window as any).ml5
        if (!ml5) { reject(new Error('ml5 not available')); return }
        const pose = ml5.bodyPose('BlazePose', { runtime: 'mediapipe', enableSmoothing: false }, () => {
          setPoseModel(pose)
          setModelReady(true)
          showToast('Pose model ready ✓')
          resolve()
        })
      })
    } catch (err) {
      console.error('Model load error:', err)
      showToast('Model load failed — see console')
    }
    setModelLoading(false)
  }

  const extractFrame = (time: number): Promise<HTMLCanvasElement> =>
    new Promise(resolve => {
      const video = videoRef.current!
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth || 1280
      canvas.height = video.videoHeight || 720
      video.currentTime = time
      const handler = () => {
        video.removeEventListener('seeked', handler)
        canvas.getContext('2d')!.drawImage(video, 0, 0)
        resolve(canvas)
      }
      video.addEventListener('seeked', handler)
    })

  const runAnalysis = async () => {
    if (!poseModel || !videoRef.current || instances.length === 0) return
    setAnalyzing(true); setResults([]); setProgress(0)
    const newResults: PoseResult[] = []
    const fps = 30

    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i]
      const targetFrame = inst.peak_frame || Math.round((inst.start_frame + inst.end_frame) / 2)

      try {
        const frameCanvas = await extractFrame(targetFrame / fps)
        // Run ml5 bodyPose detection
        const detection: any = await new Promise(resolve => {
          ;(poseModel as any).detect(frameCanvas, (results: any) => resolve(results))
        })

        const poses = Array.isArray(detection) ? detection : (detection?.poses || [])
        const topPose = poses[0]
        const rawKps = topPose?.keypoints || topPose?.pose?.keypoints || []

        const keypoints = rawKps
          .filter((k: any) => (k.confidence || k.score || 0) > 0.2)
          .map((k: any) => ({
            name: (k.name || k.part || 'unknown').toLowerCase().replace(' ', '_'),
            x: k.x !== undefined ? k.x / frameCanvas.width : (k.position?.x || 0) / frameCanvas.width,
            y: k.y !== undefined ? k.y / frameCanvas.height : (k.position?.y || 0) / frameCanvas.height,
            score: k.confidence || k.score || 0,
          }))

        const lw = keypoints.find((k: {name:string}) => k.name === 'left_wrist')
        const rw = keypoints.find((k: {name:string}) => k.name === 'right_wrist')
        const ls = keypoints.find((k: {name:string}) => k.name === 'left_shoulder')
        const rs = keypoints.find((k: {name:string}) => k.name === 'right_shoulder')
        const shoulderY = ls && rs ? (ls.y + rs.y) / 2 : 0.5
        const wristY = lw && rw ? Math.min(lw.y, rw.y) : (lw?.y || rw?.y || 0.5)
        const armsRaised = wristY < shoulderY - 0.05
        const armSpread = lw && rw ? Math.abs(lw.x - rw.x) : 0
        const upperKps = ['left_wrist','right_wrist','left_shoulder','right_shoulder','left_elbow','right_elbow']
        const poseScore = keypoints.filter((k: {name:string}) => upperKps.includes(k.name)).reduce((s: number, k: {score:number}) => s + k.score, 0) / 6

        // Draw on canvas
        const canvas = canvasRef.current
        if (canvas) {
          canvas.width = frameCanvas.width; canvas.height = frameCanvas.height
          const ctx = canvas.getContext('2d')!
          ctx.drawImage(frameCanvas, 0, 0)
          keypoints.forEach((kp: {x:number,y:number,name:string,score:number}) => {
            const isArm = upperKps.includes(kp.name)
            ctx.beginPath()
            ctx.arc(kp.x * canvas.width, kp.y * canvas.height, isArm ? 8 : 4, 0, Math.PI * 2)
            ctx.fillStyle = isArm ? '#ff0055' : '#ffffff44'
            ctx.fill()
          })
          // Draw arm lines
          if (ls && lw) { ctx.strokeStyle='#ff0055'; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(ls.x*canvas.width,ls.y*canvas.height); ctx.lineTo(lw.x*canvas.width,lw.y*canvas.height); ctx.stroke() }
          if (rs && rw) { ctx.strokeStyle='#ff0055'; ctx.lineWidth=3; ctx.beginPath(); ctx.moveTo(rs.x*canvas.width,rs.y*canvas.height); ctx.lineTo(rw.x*canvas.width,rw.y*canvas.height); ctx.stroke() }
          // Label
          ctx.fillStyle='rgba(0,0,0,0.8)'; ctx.fillRect(0,0,canvas.width,28)
          ctx.fillStyle='#ff0055'; ctx.font=`${Math.round(canvas.height*0.025)}px monospace`
          ctx.fillText(`${inst.signal_label} — F${targetFrame} — pose:${Math.round(poseScore*100)}%`, 8, 20)
        }

        newResults.push({ instanceId:inst.id, signalId:inst.signal_id, signalLabel:inst.signal_label, signalCategory:inst.signal_category, frame:targetFrame, keypoints, armsRaised, wristHeight:wristY, armSpread, poseScore })

        // Save keypoints to DB
        if (keypoints.length > 0) {
          await supabase.from('mattrack_signal_instances')
            .update({ peak_pose_keypoints: keypoints, pose_model_used: 'mediapipe_lite' })
            .eq('id', inst.id)
        }
      } catch (err) {
        console.error('Frame error', inst.id, err)
        newResults.push({ instanceId:inst.id, signalId:inst.signal_id, signalLabel:inst.signal_label, signalCategory:inst.signal_category, frame:targetFrame, keypoints:[], armsRaised:false, wristHeight:0.5, armSpread:0, poseScore:0 })
      }

      setProgress(Math.round(((i+1)/instances.length)*100))
      await new Promise(r => setTimeout(r, 30))
    }

    setResults(newResults)
    setAnalyzing(false)
    const detected = newResults.filter(r => r.poseScore > 0.3).length
    showToast(`Done — ${detected}/${newResults.length} poses detected`)
  }

  const bySignal = results.reduce((acc, r) => {
    if (!acc[r.signalId]) acc[r.signalId] = []
    acc[r.signalId].push(r)
    return acc
  }, {} as Record<string, PoseResult[]>)

  const btn: React.CSSProperties = { background:'transparent', border:'1px solid #1a1a2e', color:'#888', padding:'8px 14px', cursor:'pointer', fontFamily:"'Courier New',monospace", fontSize:11, letterSpacing:1 }

  return (
    <div style={{ minHeight:'100vh', background:'#08080f', color:'#e0e0f0', fontFamily:"'Courier New',monospace", display:'flex', flexDirection:'column' }}>

      {/* Header */}
      <div style={{ background:'#0d0d1a', borderBottom:'2px solid #a78bfa', padding:'10px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <a href="/" style={{ color:'#555', textDecoration:'none', fontSize:11 }}>← HOME</a>
          <div style={{ fontSize:16, color:'#a78bfa', fontWeight:'bold', letterSpacing:3 }}>MATTRACK / POSE</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {!modelReady
            ? <button onClick={loadModel} disabled={modelLoading} style={{ background:'#a78bfa', border:'none', color:'#000', padding:'7px 14px', cursor:modelLoading?'not-allowed':'pointer', fontFamily:'inherit', fontSize:11, fontWeight:'bold', opacity:modelLoading?0.6:1 }}>
                {modelLoading ? 'LOADING…' : '⚡ LOAD MEDIAPIPE'}
              </button>
            : <span style={{ fontSize:11, color:'#00ff88' }}>✓ MODEL READY</span>
          }
        </div>
      </div>

      {toast && <div style={{ position:'fixed', top:16, left:'50%', transform:'translateX(-50%)', background:'#00ff88', color:'#000', padding:'10px 20px', fontFamily:'inherit', fontSize:12, fontWeight:'bold', zIndex:999, maxWidth:'90vw', textAlign:'center' }}>{toast}</div>}

      <video ref={videoRef} src={videoSrc||undefined} style={{ display:'none' }} preload="auto" />
      <input ref={fileInputRef} type="file" accept="video/*" onChange={handleFile} style={{ display:'none' }} />

      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

        {/* Left: video canvas + steps */}
        <div style={{ flex:'0 0 45%', display:'flex', flexDirection:'column', borderRight:'1px solid #1a1a2e' }}>

          <div style={{ position:'relative', background:'#000', aspectRatio:'16/9' }}>
            {fileLoaded
              ? <canvas ref={canvasRef} style={{ width:'100%', height:'100%', display:'block' }} />
              : <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:8 }}>
                  <div style={{ fontSize:36, opacity:0.15 }}>🦾</div>
                  <div style={{ color:'#333', fontSize:11, letterSpacing:2 }}>SELECT A VIDEO BELOW</div>
                </div>
            }
          </div>

          <div style={{ flex:1, padding:16, overflowY:'auto', display:'flex', flexDirection:'column', gap:14 }}>

            {/* STEP 1: Pick from DB list */}
            <div>
              <div style={{ fontSize:10, color:'#666', letterSpacing:2, marginBottom:10 }}>
                STEP 1 — SELECT A LABELED VIDEO
              </div>
              {videos.length === 0
                ? <div style={{ color:'#333', fontSize:11 }}>No labeled videos found — label some signals first</div>
                : videos.map(v => (
                    <button key={v.id} onClick={() => selectVideo(v)} style={{
                      display:'block', width:'100%', textAlign:'left', marginBottom:6,
                      background: selectedVideo?.id === v.id ? '#1a1a2e' : 'transparent',
                      border: `1px solid ${selectedVideo?.id === v.id ? '#a78bfa' : '#1a1a2e'}`,
                      color: selectedVideo?.id === v.id ? '#fff' : '#555',
                      padding:'10px 12px', cursor:'pointer', fontFamily:'inherit',
                    }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <span style={{ fontSize:11 }}>{v.filename.replace(/\s*\(\d{4}.*?\)/,'')}</span>
                        <span style={{ fontSize:12, color:'#00ff88', fontWeight:'bold' }}>{v.label_count} labels</span>
                      </div>
                    </button>
                  ))
              }
            </div>

            {/* STEP 2: Load file */}
            {selectedVideo && (
              <div>
                <div style={{ fontSize:10, color:'#666', letterSpacing:2, marginBottom:8 }}>
                  STEP 2 — LOAD THE VIDEO FILE
                </div>

                {localServer && localVideos.length > 0 ? (
                  // Local server running — show file list
                  <div>
                    <div style={{ fontSize:9, color:'#00ff88', marginBottom:8 }}>✓ Local video server detected</div>
                    {(() => {
                      const baseName = selectedVideo.filename.replace(/\s*\(\d{4}.*?\)/,'').replace(/\.[^.]+$/,'').toLowerCase()
                      const matches = localVideos.filter(v => v.filename.replace(/\.[^.]+$/,'').toLowerCase() === baseName)
                      const others = localVideos.filter(v => v.filename.replace(/\.[^.]+$/,'').toLowerCase() !== baseName)
                      return (
                        <div>
                          {matches.length > 0 && (
                            <div style={{ marginBottom:8 }}>
                              <div style={{ fontSize:9, color:'#555', marginBottom:4 }}>MATCHING FILE</div>
                              {matches.map(v => (
                                <button key={v.filename} onClick={() => loadFromLocalServer(v)} style={{
                                  display:'block', width:'100%', textAlign:'left',
                                  background: fileLoaded && videoSrc === v.url ? '#0d2e0d' : '#0d0d1a',
                                  border:`1px solid ${fileLoaded && videoSrc === v.url ? '#00ff88' : '#00ff88'}`,
                                  color:'#00ff88', padding:'10px 12px', cursor:'pointer',
                                  fontFamily:'inherit', fontSize:11, marginBottom:4,
                                }}>
                                  {fileLoaded && videoSrc === v.url ? '✓ ' : '▶ '}{v.filename}
                                  <span style={{ color:'#555', fontSize:9, marginLeft:8 }}>{v.size_mb}MB</span>
                                </button>
                              ))}
                            </div>
                          )}
                          {matches.length === 0 && (
                            <div style={{ fontSize:10, color:'#fbbf24', marginBottom:8 }}>
                              No exact match for "{baseName}" — pick from list below or use file picker
                            </div>
                          )}
                          <div style={{ fontSize:9, color:'#333', marginBottom:4 }}>ALL VIDEOS IN FOLDER</div>
                          <div style={{ maxHeight:160, overflowY:'auto' }}>
                            {others.slice(0,20).map(v => (
                              <button key={v.filename} onClick={() => loadFromLocalServer(v)} style={{
                                display:'block', width:'100%', textAlign:'left',
                                background:'transparent', border:'1px solid #1a1a2e',
                                color:'#555', padding:'7px 12px', cursor:'pointer',
                                fontFamily:'inherit', fontSize:10, marginBottom:3,
                              }}>
                                {v.filename} <span style={{ color:'#333', fontSize:9 }}>{v.size_mb}MB</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                ) : (
                  // No local server — fallback to file picker
                  <div>
                    {checkingServer
                      ? <div style={{ fontSize:10, color:'#444', marginBottom:8 }}>Checking for local server…</div>
                      : <div style={{ fontSize:10, color:'#444', marginBottom:8, lineHeight:1.7 }}>
                          Find <strong style={{ color:'#aaa' }}>{selectedVideo.filename.replace(/\s*\(\d{4}.*?\)/,'')}</strong> on your computer.
                          <div style={{ marginTop:6, color:'#333' }}>
                            Tip: run <code style={{ background:'#0a0a0a', padding:'1px 6px', color:'#fbbf24' }}>python scripts/video_server.py</code> from your mattrack folder to auto-load videos.
                          </div>
                        </div>
                    }
                    <button onClick={() => fileInputRef.current?.click()} style={{
                      ...btn, width:'100%', padding:'10px 0', textAlign:'center' as const,
                      color: fileLoaded ? '#00ff88' : '#a78bfa',
                      borderColor: fileLoaded ? '#00ff88' : '#a78bfa',
                    }}>
                      {fileLoaded ? '✓ FILE LOADED' : '↑ SELECT FILE FROM COMPUTER'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* STEP 3: Run */}
            {selectedVideo && fileLoaded && (
              <div>
                <div style={{ fontSize:10, color:'#666', letterSpacing:2, marginBottom:8 }}>
                  STEP 3 — RUN POSE ANALYSIS
                </div>
                {!modelReady && (
                  <div style={{ fontSize:10, color:'#fbbf24', marginBottom:8 }}>
                    ⚠️ Load MediaPipe model first (button in header)
                  </div>
                )}
                {analyzing && (
                  <div style={{ marginBottom:10 }}>
                    <div style={{ fontSize:10, color:'#a78bfa', marginBottom:4 }}>Analyzing {progress}%</div>
                    <div style={{ height:4, background:'#1a1a2e', borderRadius:2 }}>
                      <div style={{ width:`${progress}%`, height:'100%', background:'#a78bfa', borderRadius:2, transition:'width 0.2s' }} />
                    </div>
                  </div>
                )}
                <button onClick={runAnalysis} disabled={!modelReady || analyzing} style={{
                  background: modelReady && !analyzing ? '#a78bfa' : '#1a1a2e',
                  border:'none', color: modelReady && !analyzing ? '#000' : '#444',
                  padding:'12px 0', cursor: modelReady && !analyzing ? 'pointer' : 'not-allowed',
                  fontFamily:'inherit', fontSize:12, letterSpacing:2, fontWeight:'bold', width:'100%',
                }}>
                  {analyzing ? `ANALYZING… ${progress}%` : `▶ ANALYZE ${instances.length} SIGNALS`}
                </button>
              </div>
            )}

            {/* Selected result detail */}
            {selectedResult && (
              <div style={{ background:'#0d0d1a', border:`1px solid ${catColor[selectedResult.signalCategory]||'#1a1a2e'}`, padding:14 }}>
                <div style={{ fontSize:11, color: catColor[selectedResult.signalCategory], fontWeight:'bold', marginBottom:8 }}>{selectedResult.signalLabel}</div>
                <div style={{ fontSize:10, color:'#555', lineHeight:1.9 }}>
                  Frame: {selectedResult.frame} ({fmt(selectedResult.frame/30)})<br/>
                  Detection confidence: <span style={{ color: selectedResult.poseScore > 0.6 ? '#00ff88' : selectedResult.poseScore > 0.3 ? '#fbbf24' : '#f87171' }}>{Math.round(selectedResult.poseScore*100)}%</span><br/>
                  Arms raised: <span style={{ color: selectedResult.armsRaised ? '#00ff88' : '#555' }}>{selectedResult.armsRaised ? 'YES' : 'NO'}</span><br/>
                  Wrist height: {Math.round(selectedResult.wristHeight*100)}% from top<br/>
                  Arm spread: {Math.round(selectedResult.armSpread*100)}% of frame width<br/>
                  Keypoints: {selectedResult.keypoints.length}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: results by signal */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
          <div style={{ padding:'10px 16px', borderBottom:'1px solid #1a1a2e', fontSize:10, color:'#444', letterSpacing:2 }}>
            {results.length === 0 ? 'POSE PATTERNS WILL APPEAR HERE' : `POSE PATTERNS — ${results.filter(r=>r.poseScore>0.3).length}/${results.length} DETECTED`}
          </div>
          <div style={{ flex:1, overflowY:'auto' }}>
            {results.length === 0
              ? <div style={{ padding:32, textAlign:'center', color:'#222', fontSize:11 }}>Run analysis to see pose signatures per signal type</div>
              : Object.entries(bySignal).map(([sigId, sigResults]) => {
                  const detected = sigResults.filter(r => r.poseScore > 0.3)
                  const avgArmsRaised = detected.length ? detected.filter(r=>r.armsRaised).length/detected.length : 0
                  const avgWrist = detected.length ? detected.reduce((s,r)=>s+r.wristHeight,0)/detected.length : 0
                  const avgSpread = detected.length ? detected.reduce((s,r)=>s+r.armSpread,0)/detected.length : 0
                  const color = catColor[sigResults[0].signalCategory] || '#fff'
                  return (
                    <div key={sigId} style={{ padding:'12px 16px', borderBottom:'1px solid #111' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                        <span style={{ color, fontSize:12, fontWeight:'bold' }}>{sigResults[0].signalLabel}</span>
                        <span style={{ fontSize:10, color: detected.length === sigResults.length ? '#00ff88' : '#fbbf24' }}>
                          {detected.length}/{sigResults.length} detected
                        </span>
                      </div>
                      {detected.length === 0
                        ? <div style={{ fontSize:10, color:'#f87171' }}>⚠️ No poses detected — ref may be out of frame at these timestamps</div>
                        : <div style={{ display:'flex', gap:16, fontSize:10, color:'#555', marginBottom:8, flexWrap:'wrap' }}>
                            <span>Arms raised: <span style={{ color: avgArmsRaised > 0.5 ? '#00ff88' : '#aaa' }}>{Math.round(avgArmsRaised*100)}%</span></span>
                            <span>Wrist pos: <span style={{ color:'#aaa' }}>{Math.round(avgWrist*100)}% down</span></span>
                            <span>Spread: <span style={{ color:'#aaa' }}>{Math.round(avgSpread*100)}%</span></span>
                          </div>
                      }
                      <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                        {sigResults.map(r => (
                          <button key={r.instanceId} onClick={() => {
                            setSelectedResult(r)
                            if (videoRef.current) videoRef.current.currentTime = r.frame/30
                          }} style={{
                            background: selectedResult?.instanceId === r.instanceId ? '#1a1a2e' : 'transparent',
                            border:`1px solid ${r.poseScore > 0.3 ? color : '#222'}`,
                            color: r.poseScore > 0.3 ? color : '#333',
                            padding:'4px 10px', cursor:'pointer', fontFamily:'inherit', fontSize:9,
                          }}>
                            {fmt(r.frame/30)} {r.poseScore > 0.3 ? `${Math.round(r.poseScore*100)}%` : '—'}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })
            }
          </div>
        </div>
      </div>
    </div>
  )
}
