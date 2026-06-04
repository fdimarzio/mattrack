'use client'

import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

// ── NFHS Signal Definitions ───────────────────────────────────
// Each signal has specific visual characteristics to detect
const SIGNAL_DEFINITIONS: Record<string, {
  description: string
  keyFeatures: string[]
  armPattern: 'fingers_extended' | 'arm_horizontal' | 'arm_parallel_mat' | 'arms_circular' | 'arm_pointing' | 'both_arms_T' | 'arm_down_slap' | 'hands_together' | 'arm_circular_single' | 'unknown'
  fingerCount?: number | 'variable'
  direction?: 'left' | 'right' | 'either' | 'down' | 'out'
  motionType: 'static' | 'circular' | 'downward' | 'outward' | 'pointing'
}> = {
  takedown_3pt_red:    { description: 'Ref raises 3 fingers toward awarded wrestler', keyFeatures: ['3 fingers extended', 'arm raised toward wrestler', 'palm facing scorer'], armPattern: 'fingers_extended', fingerCount: 3, direction: 'either', motionType: 'static' },
  takedown_3pt_green:  { description: 'Ref raises 3 fingers toward awarded wrestler', keyFeatures: ['3 fingers extended', 'arm raised toward wrestler'], armPattern: 'fingers_extended', fingerCount: 3, direction: 'either', motionType: 'static' },
  escape_1pt_red:      { description: 'Ref raises 1 finger toward awarded wrestler', keyFeatures: ['1 finger extended (index)', 'arm raised', 'clear single finger'], armPattern: 'fingers_extended', fingerCount: 1, direction: 'either', motionType: 'static' },
  escape_1pt_green:    { description: 'Ref raises 1 finger toward awarded wrestler', keyFeatures: ['1 finger extended', 'arm raised'], armPattern: 'fingers_extended', fingerCount: 1, direction: 'either', motionType: 'static' },
  reversal_2pt_red:    { description: 'Forearms rotate in circular motion, then 2 fingers', keyFeatures: ['forearms rotating', 'circular motion', 'then 2 fingers shown'], armPattern: 'arms_circular', fingerCount: 2, direction: 'either', motionType: 'circular' },
  reversal_2pt_green:  { description: 'Forearms rotate in circular motion, then 2 fingers', keyFeatures: ['forearms rotating', 'circular motion'], armPattern: 'arms_circular', fingerCount: 2, direction: 'either', motionType: 'circular' },
  nearfall_2pt_red:    { description: 'Arm held parallel to mat, then 2 fingers', keyFeatures: ['arm parallel to mat', 'horizontal arm position', 'then 2 fingers'], armPattern: 'arm_parallel_mat', fingerCount: 2, direction: 'either', motionType: 'static' },
  nearfall_3pt_red:    { description: 'Arm held parallel to mat, then 3 fingers', keyFeatures: ['arm parallel to mat', 'horizontal arm position', 'then 3 fingers'], armPattern: 'arm_parallel_mat', fingerCount: 3, direction: 'either', motionType: 'static' },
  nearfall_4pt_red:    { description: 'Arm held parallel to mat, then 4 fingers', keyFeatures: ['arm parallel to mat', '4 fingers shown'], armPattern: 'arm_parallel_mat', fingerCount: 4, direction: 'either', motionType: 'static' },
  nearfall_4pt_green:  { description: 'Arm held parallel to mat, then 4 fingers', keyFeatures: ['arm parallel to mat', '4 fingers shown'], armPattern: 'arm_parallel_mat', fingerCount: 4, direction: 'either', motionType: 'static' },
  out_of_bounds:       { description: 'One arm extended horizontally pointing to boundary', keyFeatures: ['arm fully extended horizontal', 'pointing to boundary line', 'whistle'], armPattern: 'arm_horizontal', direction: 'out', motionType: 'outward' },
  stalling_red:        { description: 'Ref points at stalling wrestler', keyFeatures: ['finger pointing at wrestler', 'arm extended toward wrestler'], armPattern: 'arm_pointing', direction: 'either', motionType: 'pointing' },
  stalling_green:      { description: 'Ref points at stalling wrestler', keyFeatures: ['finger pointing at wrestler'], armPattern: 'arm_pointing', direction: 'either', motionType: 'pointing' },
  pin_red:             { description: 'Ref slaps mat, blows whistle', keyFeatures: ['body bent toward mat', 'arm swinging down', 'hand toward mat surface'], armPattern: 'arm_down_slap', direction: 'down', motionType: 'downward' },
  pin_green:           { description: 'Ref slaps mat, blows whistle', keyFeatures: ['body bent toward mat', 'arm swinging down'], armPattern: 'arm_down_slap', direction: 'down', motionType: 'downward' },
  tech_fall_red:       { description: 'Ref stops match, signals technical fall', keyFeatures: ['match stopped', 'arms raised'], armPattern: 'fingers_extended', direction: 'either', motionType: 'static' },
  handshake_start:     { description: 'Ref brings wrestlers together for handshake', keyFeatures: ['both arms extended toward wrestlers', 'bringing wrestlers together'], armPattern: 'hands_together', motionType: 'static' },
  clock_start:         { description: 'Ref signals clock to start, blows whistle', keyFeatures: ['arm pointing down to mat', 'whistle blown'], armPattern: 'arm_pointing', direction: 'down', motionType: 'pointing' },
  period_end:          { description: 'Horn/whistle signals end of period', keyFeatures: ['match stopped', 'arms out'], armPattern: 'arm_horizontal', motionType: 'outward' },
  match_end_decision:  { description: 'Ref raises winner\'s hand', keyFeatures: ['one arm raised high', 'holding wrestler wrist'], armPattern: 'fingers_extended', direction: 'either', motionType: 'static' },
  starting_match:      { description: 'Ref blows whistle and points down to mat', keyFeatures: ['arm pointing to mat', 'whistle'], armPattern: 'arm_pointing', direction: 'down', motionType: 'pointing' },
  stopping_match:      { description: 'Arm extended palm out', keyFeatures: ['arm extended', 'palm facing out', 'stop gesture'], armPattern: 'arm_horizontal', motionType: 'outward' },
  timeout:             { description: 'Both hands form T above head', keyFeatures: ['both arms form T shape', 'hands above head'], armPattern: 'both_arms_T', motionType: 'static' },
  defer_choice:        { description: 'Ref rotates single hand in circular motion', keyFeatures: ['one hand rotating', 'circular wrist motion'], armPattern: 'arm_circular_single', motionType: 'circular' },
  no_control:          { description: 'Both hands open waved side to side', keyFeatures: ['both hands open', 'waving motion', 'no control indicated'], armPattern: 'both_arms_T', motionType: 'outward' },
  potentially_dangerous_red: { description: 'Ref touches back of head', keyFeatures: ['hand to back of own head', 'specific gesture'], armPattern: 'arm_pointing', motionType: 'pointing' },
  potentially_dangerous_green: { description: 'Ref touches back of head', keyFeatures: ['hand to back of own head'], armPattern: 'arm_pointing', motionType: 'pointing' },
}

const ARM_PATTERN_LABELS: Record<string, string> = {
  fingers_extended:   '✋ Fingers extended — count determines points',
  arm_horizontal:     '→ Arm horizontal — pointing out or stopping',
  arm_parallel_mat:   '— Arm parallel to mat — near fall position',
  arms_circular:      '↺ Arms circular — reversal motion',
  arm_pointing:       '👉 Arm pointing — at wrestler or downward',
  both_arms_T:        'T Both arms form T — timeout or no control',
  arm_down_slap:      '↓ Arm down/slap — pin signal',
  hands_together:     '🤝 Hands together — bringing wrestlers in',
  arm_circular_single:'↻ Single hand circular — defer choice',
  unknown:            '? Unknown pattern',
}

interface VideoRecord { id: string; filename: string; duration_seconds: number; label_count: number }
interface LabeledInstance { id: string; signal_id: string; signal_label: string; signal_category: string; start_frame: number; peak_frame: number | null; end_frame: number; video_id: string }
interface FrameAnalysis {
  instanceId: string
  signalId: string
  signalLabel: string
  signalCategory: string
  frame: number
  // Pose data
  keypoints: { name: string; x: number; y: number; score: number }[]
  poseDetected: boolean
  poseScore: number
  // Signal-specific analysis
  expectedPattern: string
  expectedFeatures: string[]
  // Detected arm characteristics
  dominantArmAngle: number        // degrees from horizontal
  dominantArmDirection: string    // 'left' | 'right' | 'up' | 'down' | 'unknown'
  armExtension: number            // 0-1, how extended the arm is
  bodyLean: number                // forward lean angle
  // Motion context (from surrounding frames)
  motionType: string
  // Match to expected
  patternMatch: 'strong' | 'partial' | 'weak' | 'no_pose'
  matchNotes: string[]
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

  const [videos, setVideos] = useState<VideoRecord[]>([])
  const [selectedVideo, setSelectedVideo] = useState<VideoRecord | null>(null)
  const [instances, setInstances] = useState<LabeledInstance[]>([])
  const [videoSrc, setVideoSrc] = useState<string | null>(null)
  const [fileLoaded, setFileLoaded] = useState(false)

  const [modelReady, setModelReady] = useState(false)
  const [modelLoading, setModelLoading] = useState(false)
  const [poseModel, setPoseModel] = useState<unknown>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [analyses, setAnalyses] = useState<FrameAnalysis[]>([])
  const [selectedAnalysis, setSelectedAnalysis] = useState<FrameAnalysis | null>(null)
  const [activeTab, setActiveTab] = useState<'by_signal' | 'timeline' | 'patterns'>('by_signal')

  const [localServer, setLocalServer] = useState(false)
  const [localVideos, setLocalVideos] = useState<{filename:string,url:string,size_mb:number}[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3500) }

  useEffect(() => {
    // Load video list
    supabase.rpc('get_videos_with_label_count')
      .then(({ data }) => {
        if (data) setVideos((data as VideoRecord[]).filter(v => v.label_count > 0))
      })
    // Check local server
    fetch('http://localhost:7432/ping', { signal: AbortSignal.timeout(1500) })
      .then(r => { if (r.ok) return fetch('http://localhost:7432/videos'); throw new Error('no server') })
      .then(r => r.json())
      .then(d => { if (d?.videos) { setLocalServer(true); setLocalVideos(d.videos) } })
      .catch(() => {})
  }, [])

  const selectVideo = async (video: VideoRecord) => {
    setSelectedVideo(video); setAnalyses([]); setVideoSrc(null); setFileLoaded(false)
    const { data } = await supabase
      .from('mattrack_signal_instances')
      .select('id, signal_id, signal_label, signal_category, start_frame, peak_frame, end_frame, video_id')
      .eq('video_id', video.id).order('start_frame', { ascending: true })
    setInstances(data || [])

    // Try auto-load from local server
    if (localServer && localVideos.length > 0) {
      const base = video.filename.replace(/\s*\(\d{4}.*?\)/,'').replace(/\.[^.]+$/,'').toLowerCase()
      const match = localVideos.find(v => v.filename.replace(/\.[^.]+$/,'').toLowerCase() === base)
      if (match) { setVideoSrc(match.url); setFileLoaded(true); showToast(`Auto-loaded ${match.filename} ✓`); return }
    }
    showToast(`${data?.length||0} labels loaded — select file below`)
    setTimeout(() => fileInputRef.current?.click(), 300)
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setVideoSrc(URL.createObjectURL(file)); setFileLoaded(true)
    showToast(`${file.name} loaded ✓`)
  }

  const loadModel = async () => {
    setModelLoading(true)
    try {
      await new Promise<void>((resolve, reject) => {
        const existing = document.querySelector('script[src*="ml5"]')
        if (existing) { resolve(); return }
        const s = document.createElement('script')
        s.src = 'https://unpkg.com/ml5@1.2.1/dist/ml5.min.js'
        s.onload = () => resolve(); s.onerror = reject
        document.head.appendChild(s)
      })
      showToast('ml5 loaded — initialising pose model…')
      await new Promise<void>((resolve, reject) => {
        const ml5 = (window as any).ml5
        if (!ml5?.bodyPose) { reject(new Error('ml5.bodyPose not available')); return }
        const model = ml5.bodyPose('BlazePose', { runtime:'mediapipe', enableSmoothing:false }, () => {
          setPoseModel(model); setModelReady(true)
          showToast('Pose model ready ✓'); resolve()
        })
      })
    } catch (err) {
      console.error(err); showToast('Model load failed — check console')
    }
    setModelLoading(false)
  }

  const extractFrame = (time: number): Promise<HTMLCanvasElement> =>
    new Promise(resolve => {
      const video = videoRef.current!
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth || 1280; canvas.height = video.videoHeight || 720
      video.currentTime = time
      const h = () => { video.removeEventListener('seeked', h); canvas.getContext('2d')!.drawImage(video, 0, 0); resolve(canvas) }
      video.addEventListener('seeked', h)
    })

  // Analyze arm characteristics from keypoints
  const analyzeArm = (keypoints: FrameAnalysis['keypoints'], signalId: string): Omit<FrameAnalysis, 'instanceId'|'signalId'|'signalLabel'|'signalCategory'|'frame'|'keypoints'|'poseDetected'|'poseScore'> => {
    const kp = Object.fromEntries(keypoints.map(k => [k.name, k]))
    const def = SIGNAL_DEFINITIONS[signalId]

    const lw = kp['left_wrist'], rw = kp['right_wrist']
    const ls = kp['left_shoulder'], rs = kp['right_shoulder']
    const le = kp['left_elbow'], re = kp['right_elbow']
    const lh = kp['left_hip'], rh = kp['right_hip']

    // Dominant arm — whichever wrist is higher (more raised)
    const leftRaised = ls && lw ? ls.y - lw.y : -999
    const rightRaised = rs && rw ? rs.y - rw.y : -999
    const usLeft = leftRaised > rightRaised
    const wrist = usLeft ? lw : rw
    const shoulder = usLeft ? ls : rs
    const elbow = usLeft ? le : re

    // Arm angle from horizontal (0=horizontal, 90=straight up, -90=straight down)
    let dominantArmAngle = 0
    let armExtension = 0
    let dominantArmDirection = 'unknown'

    if (wrist && shoulder) {
      const dx = wrist.x - shoulder.x
      const dy = shoulder.y - wrist.y  // inverted Y
      dominantArmAngle = Math.atan2(dy, Math.abs(dx)) * 180 / Math.PI
      dominantArmDirection = dy > 0.05 ? 'up' : dy < -0.1 ? 'down' : dx > 0 ? 'right' : 'left'

      // Extension: distance from shoulder to wrist relative to shoulder width
      const shoulderWidth = ls && rs ? Math.abs(ls.x - rs.x) : 0.3
      const armDist = Math.sqrt(dx*dx + (wrist.y-shoulder.y)**2)
      armExtension = shoulderWidth > 0 ? Math.min(1, armDist / shoulderWidth) : 0
    }

    // Body lean: are hips behind shoulders (leaning forward toward mat)?
    const hipY = lh && rh ? (lh.y + rh.y)/2 : null
    const shoulderY = ls && rs ? (ls.y + rs.y)/2 : null
    const bodyLean = hipY && shoulderY ? Math.abs(hipY - shoulderY) : 0

    // Match analysis against NFHS signal definition
    const matchNotes: string[] = []
    let patternMatch: FrameAnalysis['patternMatch'] = 'weak'

    if (!def) { return { expectedPattern: 'unknown', expectedFeatures: [], dominantArmAngle, dominantArmDirection, armExtension, bodyLean, motionType: 'unknown', patternMatch: 'no_pose', matchNotes: ['No signal definition found'] } }

    switch (def.armPattern) {
      case 'fingers_extended':
        if (dominantArmDirection === 'up' || dominantArmAngle > 20) {
          matchNotes.push(`✓ Arm raised (${dominantArmAngle.toFixed(0)}° from horizontal)`)
          patternMatch = armExtension > 0.6 ? 'strong' : 'partial'
        } else {
          matchNotes.push(`✗ Expected arm raised — got ${dominantArmDirection} at ${dominantArmAngle.toFixed(0)}°`)
        }
        if (def.fingerCount) matchNotes.push(`ℹ Expect ${def.fingerCount} finger(s) — finger count requires hand detection`)
        break

      case 'arm_horizontal':
        if (Math.abs(dominantArmAngle) < 25 && armExtension > 0.5) {
          matchNotes.push(`✓ Arm roughly horizontal (${dominantArmAngle.toFixed(0)}°)`)
          patternMatch = 'strong'
        } else {
          matchNotes.push(`✗ Expected horizontal arm — got ${dominantArmAngle.toFixed(0)}°`)
          patternMatch = 'partial'
        }
        break

      case 'arm_parallel_mat':
        if (Math.abs(dominantArmAngle) < 20) {
          matchNotes.push(`✓ Arm parallel to mat (${dominantArmAngle.toFixed(0)}°)`)
          patternMatch = 'strong'
        } else {
          matchNotes.push(`✗ Expected arm parallel to mat — got ${dominantArmAngle.toFixed(0)}°`)
        }
        break

      case 'arm_down_slap':
        if (dominantArmDirection === 'down' || dominantArmAngle < -20) {
          matchNotes.push(`✓ Arm directed downward (${dominantArmAngle.toFixed(0)}°)`)
          if (bodyLean > 0.1) matchNotes.push(`✓ Body leaning forward toward mat`)
          patternMatch = 'strong'
        } else {
          matchNotes.push(`✗ Expected downward arm for mat slap — got ${dominantArmDirection}`)
          patternMatch = 'partial'
        }
        break

      case 'arm_pointing':
        if (armExtension > 0.5) {
          matchNotes.push(`✓ Arm extended (${(armExtension*100).toFixed(0)}% extension)`)
          patternMatch = 'partial'
        } else {
          matchNotes.push(`✗ Expected extended pointing arm`)
        }
        break

      case 'arms_circular':
        matchNotes.push('ℹ Circular motion requires frame sequence — check surrounding frames')
        patternMatch = 'partial'
        break

      case 'both_arms_T':
        if (ls && rs && lw && rw) {
          const leftAngle = lw && ls ? Math.abs(Math.atan2(ls.y - lw.y, lw.x - ls.x) * 180/Math.PI) : 0
          const rightAngle = rw && rs ? Math.abs(Math.atan2(rs.y - rw.y, rw.x - rs.x) * 180/Math.PI) : 0
          if (leftAngle < 30 && rightAngle < 30) {
            matchNotes.push(`✓ Both arms roughly horizontal — T shape detected`)
            patternMatch = 'strong'
          } else {
            matchNotes.push(`✗ Expected T shape — left arm ${leftAngle.toFixed(0)}°, right arm ${rightAngle.toFixed(0)}°`)
          }
        } else {
          matchNotes.push('✗ Could not detect both wrists')
        }
        break

      default:
        matchNotes.push('ℹ Pattern requires manual review')
        patternMatch = 'partial'
    }

    return {
      expectedPattern: ARM_PATTERN_LABELS[def.armPattern] || def.armPattern,
      expectedFeatures: def.keyFeatures,
      dominantArmAngle, dominantArmDirection, armExtension, bodyLean,
      motionType: def.motionType,
      patternMatch, matchNotes,
    }
  }

  const runAnalysis = async () => {
    if (!poseModel || !videoRef.current || instances.length === 0) return
    setAnalyzing(true); setAnalyses([]); setProgress(0)
    const results: FrameAnalysis[] = []
    const fps = 30

    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i]
      const targetFrame = inst.peak_frame || Math.round((inst.start_frame + inst.end_frame) / 2)

      try {
        const frameCanvas = await extractFrame(targetFrame / fps)
        const detection: any = await new Promise(resolve => {
          ;(poseModel as any).detect(frameCanvas, (r: any) => resolve(r))
        })

        const poses = Array.isArray(detection) ? detection : (detection?.poses || [])
        const topPose = poses[0]
        const rawKps = topPose?.keypoints || topPose?.pose?.keypoints || []

        const keypoints = rawKps
          .filter((k: any) => (k.confidence || k.score || 0) > 0.15)
          .map((k: any) => ({
            name: (k.name || k.part || '').toLowerCase().replace(' ', '_'),
            x: k.x !== undefined ? k.x / frameCanvas.width : (k.position?.x || 0) / frameCanvas.width,
            y: k.y !== undefined ? k.y / frameCanvas.height : (k.position?.y || 0) / frameCanvas.height,
            score: k.confidence || k.score || 0,
          }))

        const upperKps = ['left_wrist','right_wrist','left_shoulder','right_shoulder','left_elbow','right_elbow']
        const poseScore = keypoints.filter((k: any) => upperKps.includes(k.name)).reduce((s: number, k: any) => s + k.score, 0) / 6
        const poseDetected = poseScore > 0.2

        const armAnalysis = poseDetected
          ? analyzeArm(keypoints, inst.signal_id)
          : { expectedPattern: SIGNAL_DEFINITIONS[inst.signal_id]?.armPattern || 'unknown', expectedFeatures: SIGNAL_DEFINITIONS[inst.signal_id]?.keyFeatures || [], dominantArmAngle: 0, dominantArmDirection: 'unknown', armExtension: 0, bodyLean: 0, motionType: 'unknown', patternMatch: 'no_pose' as const, matchNotes: ['Pose not detected in this frame'] }

        // Draw skeleton on canvas
        const canvas = canvasRef.current
        if (canvas) {
          canvas.width = frameCanvas.width; canvas.height = frameCanvas.height
          const ctx = canvas.getContext('2d')!
          ctx.drawImage(frameCanvas, 0, 0)
          // Draw connections
          const pairs = [['left_shoulder','left_elbow'],['left_elbow','left_wrist'],['right_shoulder','right_elbow'],['right_elbow','right_wrist'],['left_shoulder','right_shoulder'],['left_shoulder','left_hip'],['right_shoulder','right_hip']]
          const kpMap = Object.fromEntries(keypoints.map((k: any) => [k.name, k]))
          ctx.lineWidth = 3
          pairs.forEach(([a, b]) => {
            const ka = kpMap[a], kb = kpMap[b]
            if (ka && kb) {
              ctx.strokeStyle = '#ff0055'
              ctx.beginPath(); ctx.moveTo(ka.x*canvas.width, ka.y*canvas.height); ctx.lineTo(kb.x*canvas.width, kb.y*canvas.height); ctx.stroke()
            }
          })
          keypoints.forEach((kp: any) => {
            const isArm = upperKps.includes(kp.name)
            ctx.beginPath(); ctx.arc(kp.x*canvas.width, kp.y*canvas.height, isArm ? 8 : 4, 0, Math.PI*2)
            ctx.fillStyle = isArm ? '#ff0055' : '#ffffff55'; ctx.fill()
          })
          // Info overlay
          const matchColor = armAnalysis.patternMatch === 'strong' ? '#00ff88' : armAnalysis.patternMatch === 'partial' ? '#fbbf24' : '#f87171'
          ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fillRect(0, 0, canvas.width, 52)
          ctx.font = `${Math.round(canvas.height*0.025)}px monospace`
          ctx.fillStyle = catColor[inst.signal_category] || '#fff'
          ctx.fillText(inst.signal_label, 8, 20)
          ctx.fillStyle = matchColor; ctx.font = `${Math.round(canvas.height*0.02)}px monospace`
          ctx.fillText(`${armAnalysis.patternMatch.toUpperCase()} MATCH — ${armAnalysis.expectedPattern}`, 8, 44)
        }

        results.push({ instanceId:inst.id, signalId:inst.signal_id, signalLabel:inst.signal_label, signalCategory:inst.signal_category, frame:targetFrame, keypoints, poseDetected, poseScore, ...armAnalysis })

        // Save to DB
        if (keypoints.length > 0) {
          await supabase.from('mattrack_signal_instances')
            .update({ peak_pose_keypoints: keypoints, pose_model_used: 'mediapipe_blazepose' })
            .eq('id', inst.id)
        }
      } catch (err) {
        console.error(inst.id, err)
        const def = SIGNAL_DEFINITIONS[inst.signal_id]
        results.push({ instanceId:inst.id, signalId:inst.signal_id, signalLabel:inst.signal_label, signalCategory:inst.signal_category, frame:targetFrame, keypoints:[], poseDetected:false, poseScore:0, expectedPattern: def?.armPattern||'unknown', expectedFeatures: def?.keyFeatures||[], dominantArmAngle:0, dominantArmDirection:'unknown', armExtension:0, bodyLean:0, motionType:'unknown', patternMatch:'no_pose', matchNotes:['Error during analysis'] })
      }

      setProgress(Math.round(((i+1)/instances.length)*100))
      await new Promise(r => setTimeout(r, 30))
    }

    setAnalyses(results); setAnalyzing(false)
    const strong = results.filter(r => r.patternMatch === 'strong').length
    const partial = results.filter(r => r.patternMatch === 'partial').length
    showToast(`Done — ${strong} strong matches, ${partial} partial, ${results.length-strong-partial} weak/no pose`)
  }

  const bySignal = analyses.reduce((acc, r) => { if (!acc[r.signalId]) acc[r.signalId] = []; acc[r.signalId].push(r); return acc }, {} as Record<string, FrameAnalysis[]>)

  const btn: React.CSSProperties = { background:'transparent', border:'1px solid #1a1a2e', color:'#888', padding:'8px 14px', cursor:'pointer', fontFamily:"'Courier New',monospace", fontSize:11 }

  return (
    <div style={{ minHeight:'100vh', background:'#08080f', color:'#e0e0f0', fontFamily:"'Courier New',monospace", display:'flex', flexDirection:'column' }}>
      <div style={{ background:'#0d0d1a', borderBottom:'2px solid #a78bfa', padding:'10px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <a href="/" style={{ color:'#555', textDecoration:'none', fontSize:11 }}>← HOME</a>
          <div style={{ fontSize:16, color:'#a78bfa', fontWeight:'bold', letterSpacing:3 }}>MATTRACK / POSE ANALYSIS</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {localServer && <span style={{ fontSize:9, color:'#00ff88' }}>✓ VIDEO SERVER</span>}
          {!modelReady
            ? <button onClick={loadModel} disabled={modelLoading} style={{ background:'#a78bfa', border:'none', color:'#000', padding:'7px 14px', cursor:modelLoading?'not-allowed':'pointer', fontFamily:'inherit', fontSize:11, fontWeight:'bold', opacity:modelLoading?0.6:1 }}>
                {modelLoading ? 'LOADING…' : '⚡ LOAD POSE MODEL'}
              </button>
            : <span style={{ fontSize:11, color:'#00ff88' }}>✓ POSE MODEL READY</span>
          }
        </div>
      </div>

      {toast && <div style={{ position:'fixed', top:16, left:'50%', transform:'translateX(-50%)', background:'#00ff88', color:'#000', padding:'10px 20px', fontFamily:'inherit', fontSize:12, fontWeight:'bold', zIndex:999, maxWidth:'90vw', textAlign:'center' }}>{toast}</div>}


      <input ref={fileInputRef} type="file" accept="video/*" onChange={handleFile} style={{ display:'none' }} />

      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

        {/* Left */}
        <div style={{ flex:'0 0 42%', display:'flex', flexDirection:'column', borderRight:'1px solid #1a1a2e', overflow:'hidden' }}>
          <div style={{ position:'relative', background:'#000', aspectRatio:'16/9', flexShrink:0 }}>
            {fileLoaded ? (
              <>
                <video ref={videoRef} src={videoSrc||undefined}
                  style={{ width:'100%', height:'100%', display:'block', position:'absolute', inset:0 }}
                  preload="auto" controls={false} />
                <canvas ref={canvasRef}
                  style={{ width:'100%', height:'100%', display:'block', position:'absolute', inset:0, opacity: selectedAnalysis ? 1 : 0, transition:'opacity 0.2s', pointerEvents:'none' }} />
                {!selectedAnalysis && (
                  <div style={{ position:'absolute', bottom:8, left:'50%', transform:'translateX(-50%)', background:'rgba(0,0,0,0.7)', color:'#555', fontSize:10, padding:'4px 12px', letterSpacing:1 }}>
                    CLICK A LABEL TO SEE POSE OVERLAY
                  </div>
                )}
              </>
            ) : (
              <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:8 }}>
                <div style={{ fontSize:32, opacity:0.15 }}>🦾</div>
                <div style={{ color:'#333', fontSize:11, letterSpacing:2 }}>SELECT VIDEO BELOW</div>
              </div>
            )}
          </div>

          <div style={{ flex:1, overflowY:'auto', padding:14, display:'flex', flexDirection:'column', gap:12 }}>

            {/* Video list */}
            <div>
              <div style={{ fontSize:10, color:'#555', letterSpacing:2, marginBottom:8 }}>SELECT LABELED VIDEO</div>
              {videos.map(v => (
                <button key={v.id} onClick={() => selectVideo(v)} style={{ display:'block', width:'100%', textAlign:'left', marginBottom:5, background: selectedVideo?.id===v.id ? '#1a1a2e' : 'transparent', border:`1px solid ${selectedVideo?.id===v.id ? '#a78bfa' : '#1a1a2e'}`, color: selectedVideo?.id===v.id ? '#fff' : '#555', padding:'9px 12px', cursor:'pointer', fontFamily:'inherit' }}>
                  <div style={{ display:'flex', justifyContent:'space-between' }}>
                    <span style={{ fontSize:11 }}>{v.filename.replace(/\s*\(\d{4}.*?\)/,'')}</span>
                    <span style={{ fontSize:12, color:'#00ff88', fontWeight:'bold' }}>{v.label_count} labels</span>
                  </div>
                </button>
              ))}
            </div>

            {/* File picker fallback */}
            {selectedVideo && !fileLoaded && (
              <button onClick={() => fileInputRef.current?.click()} style={{ ...btn, width:'100%', padding:'10px 0', textAlign:'center' as const, color:'#a78bfa', borderColor:'#a78bfa' }}>
                ↑ SELECT FILE FROM COMPUTER
              </button>
            )}

            {/* Run button */}
            {fileLoaded && instances.length > 0 && (
              <div>
                {analyzing && (
                  <div style={{ marginBottom:8 }}>
                    <div style={{ fontSize:10, color:'#a78bfa', marginBottom:4 }}>Analyzing {progress}% — frame by frame against NFHS signal definitions</div>
                    <div style={{ height:4, background:'#1a1a2e', borderRadius:2 }}>
                      <div style={{ width:`${progress}%`, height:'100%', background:'#a78bfa', borderRadius:2 }} />
                    </div>
                  </div>
                )}
                <button onClick={runAnalysis} disabled={!modelReady||analyzing} style={{ background: modelReady&&!analyzing ? '#a78bfa' : '#1a1a2e', border:'none', color: modelReady&&!analyzing ? '#000' : '#444', padding:'12px 0', cursor: modelReady&&!analyzing ? 'pointer' : 'not-allowed', fontFamily:'inherit', fontSize:12, letterSpacing:2, fontWeight:'bold', width:'100%' }}>
                  {!modelReady ? 'LOAD MODEL FIRST' : analyzing ? `ANALYZING ${progress}%…` : `▶ ANALYZE ${instances.length} SIGNALS`}
                </button>
              </div>
            )}

            {/* Selected frame detail */}
            {selectedAnalysis && (
              <div style={{ background:'#0d0d1a', border:`1px solid ${selectedAnalysis.patternMatch==='strong'?'#00ff88':selectedAnalysis.patternMatch==='partial'?'#fbbf24':'#f87171'}`, padding:14 }}>
                <div style={{ fontSize:11, color: catColor[selectedAnalysis.signalCategory], fontWeight:'bold', marginBottom:6 }}>{selectedAnalysis.signalLabel}</div>
                <div style={{ fontSize:10, color:'#555', marginBottom:8 }}>Frame {selectedAnalysis.frame} · {fmt(selectedAnalysis.frame/30)}</div>

                <div style={{ fontSize:10, color:'#666', letterSpacing:1, marginBottom:4 }}>EXPECTED (NFHS)</div>
                {selectedAnalysis.expectedFeatures.map((f,i) => (
                  <div key={i} style={{ fontSize:10, color:'#a78bfa', marginBottom:2 }}>→ {f}</div>
                ))}

                <div style={{ fontSize:10, color:'#666', letterSpacing:1, margin:'8px 0 4px' }}>DETECTED</div>
                {selectedAnalysis.matchNotes.map((n,i) => (
                  <div key={i} style={{ fontSize:10, color: n.startsWith('✓') ? '#00ff88' : n.startsWith('✗') ? '#f87171' : '#555', marginBottom:2 }}>{n}</div>
                ))}

                {selectedAnalysis.poseDetected && (
                  <div style={{ marginTop:8, fontSize:10, color:'#333' }}>
                    Arm angle: {selectedAnalysis.dominantArmAngle.toFixed(0)}° · Direction: {selectedAnalysis.dominantArmDirection} · Extension: {(selectedAnalysis.armExtension*100).toFixed(0)}%
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: results */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
          {/* Tabs */}
          <div style={{ display:'flex', borderBottom:'1px solid #1a1a2e' }}>
            {(['by_signal','timeline','patterns'] as const).map(t => (
              <button key={t} onClick={() => setActiveTab(t)} style={{ flex:1, padding:'9px 0', background: activeTab===t ? '#1a1a2e' : 'transparent', border:'none', borderBottom: activeTab===t ? '2px solid #a78bfa' : '2px solid transparent', color: activeTab===t ? '#fff' : '#444', cursor:'pointer', fontFamily:'inherit', fontSize:10, letterSpacing:2 }}>
                {t.replace('_',' ').toUpperCase()}
              </button>
            ))}
          </div>

          <div style={{ flex:1, overflowY:'auto' }}>
            {analyses.length === 0 ? (
              <div style={{ padding:32, textAlign:'center', color:'#222', fontSize:11 }}>Run analysis to see results matched against NFHS signal definitions</div>
            ) : activeTab === 'by_signal' ? (
              Object.entries(bySignal).map(([sigId, sigAnalyses]) => {
                const def = SIGNAL_DEFINITIONS[sigId]
                const strong = sigAnalyses.filter(a => a.patternMatch==='strong').length
                const partial = sigAnalyses.filter(a => a.patternMatch==='partial').length
                const color = catColor[sigAnalyses[0].signalCategory] || '#fff'
                return (
                  <div key={sigId} style={{ padding:'12px 16px', borderBottom:'1px solid #111' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                      <span style={{ color, fontSize:12, fontWeight:'bold' }}>{sigAnalyses[0].signalLabel}</span>
                      <span style={{ fontSize:10 }}>
                        <span style={{ color:'#00ff88' }}>{strong}✓</span>
                        <span style={{ color:'#fbbf24', marginLeft:6 }}>{partial}~</span>
                        <span style={{ color:'#333', marginLeft:6 }}>{sigAnalyses.length-strong-partial}✗</span>
                      </span>
                    </div>
                    {def && (
                      <div style={{ fontSize:10, color:'#444', marginBottom:6 }}>
                        {def.description}
                      </div>
                    )}
                    <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                      {sigAnalyses.map(a => (
                        <button key={a.instanceId} onClick={() => { setSelectedAnalysis(a); if(videoRef.current) videoRef.current.currentTime = a.frame/30 }} style={{
                          background: selectedAnalysis?.instanceId===a.instanceId ? '#1a1a2e' : 'transparent',
                          border:`1px solid ${a.patternMatch==='strong'?'#00ff88':a.patternMatch==='partial'?'#fbbf24':a.patternMatch==='no_pose'?'#222':'#f87171'}`,
                          color: a.patternMatch==='strong'?'#00ff88':a.patternMatch==='partial'?'#fbbf24':a.patternMatch==='no_pose'?'#333':'#f87171',
                          padding:'4px 10px', cursor:'pointer', fontFamily:'inherit', fontSize:9,
                        }}>
                          {fmt(a.frame/30)}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })
            ) : activeTab === 'patterns' ? (
              <div style={{ padding:16 }}>
                <div style={{ fontSize:10, color:'#555', letterSpacing:2, marginBottom:14 }}>NFHS SIGNAL PATTERN REFERENCE</div>
                {Object.entries(ARM_PATTERN_LABELS).map(([pattern, label]) => {
                  const signals = Object.entries(SIGNAL_DEFINITIONS).filter(([,d]) => d.armPattern === pattern)
                  if (signals.length === 0) return null
                  return (
                    <div key={pattern} style={{ marginBottom:14, background:'#0d0d1a', border:'1px solid #1a1a2e', padding:12 }}>
                      <div style={{ fontSize:11, color:'#a78bfa', fontWeight:'bold', marginBottom:6 }}>{label}</div>
                      <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                        {signals.map(([id]) => {
                          const sigAnalyses = bySignal[id] || []
                          const strong = sigAnalyses.filter(a => a.patternMatch==='strong').length
                          return (
                            <span key={id} style={{ fontSize:10, color: strong > 0 ? '#00ff88' : '#444', border:`1px solid ${strong > 0 ? '#00ff88' : '#1a1a2e'}`, padding:'2px 8px' }}>
                              {id.replace(/_red|_green/,'')} {sigAnalyses.length > 0 ? `(${strong}/${sigAnalyses.length})` : ''}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              // Timeline view
              <div>
                {analyses.map((a, i) => (
                  <div key={i} onClick={() => { setSelectedAnalysis(a); if(videoRef.current) videoRef.current.currentTime = a.frame/30 }}
                    style={{ padding:'8px 16px', borderBottom:'1px solid #111', cursor:'pointer', display:'flex', gap:12, alignItems:'center', background: selectedAnalysis?.instanceId===a.instanceId ? '#0d0d1a' : 'transparent', borderLeft:`3px solid ${a.patternMatch==='strong'?'#00ff88':a.patternMatch==='partial'?'#fbbf24':a.patternMatch==='no_pose'?'#222':'#f87171'}` }}>
                    <div style={{ minWidth:50, fontSize:12, fontWeight:'bold' }}>{fmt(a.frame/30)}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:11, color: catColor[a.signalCategory] }}>{a.signalLabel}</div>
                      <div style={{ fontSize:9, color:'#444', marginTop:2 }}>{a.matchNotes[0]}</div>
                    </div>
                    <div style={{ fontSize:10, color: a.patternMatch==='strong'?'#00ff88':a.patternMatch==='partial'?'#fbbf24':a.patternMatch==='no_pose'?'#333':'#f87171' }}>
                      {a.patternMatch.toUpperCase().replace('_',' ')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
