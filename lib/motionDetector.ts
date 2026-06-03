/**
 * motionDetector.ts
 *
 * Client-side ref motion detection using canvas frame differencing.
 * No server, no model — runs entirely in the browser on the local video file.
 *
 * Algorithm:
 *   1. Sample video at SAMPLE_FPS (2fps by default)
 *   2. For each frame, score each region for "ref-likeness" (grey/black uniform)
 *   3. Compute pixel difference between consecutive frames in candidate ref region
 *   4. Flag high-motion windows as candidate signal events
 *   5. Cluster nearby candidates, return sorted queue
 */

export interface MotionCandidate {
  id: string
  startFrame: number
  endFrame: number
  peakFrame: number
  peakTime: number          // seconds
  motionScore: number       // 0-1, higher = more motion
  refRegion: {              // normalized 0-1 bounding region where motion was detected
    x: number; y: number; w: number; h: number
  }
  status: 'pending' | 'labeled' | 'skipped'
}

const SAMPLE_FPS = 2          // frames per second to analyze
const MOTION_THRESHOLD = 15   // pixel difference threshold (0-255)
const MIN_MOTION_AREA = 0.01  // minimum fraction of frame that must be moving
const CLUSTER_GAP_SECS = 1.5  // merge candidates within this many seconds
const MAX_CANDIDATES = 100    // cap results

// Ref color ranges (HSV-like in canvas RGB space)
// Grey: R≈G≈B, mid-range values
// Black: all channels low
function isRefLikePixel(r: number, g: number, b: number): boolean {
  const avg = (r + g + b) / 3
  const saturation = Math.max(r, g, b) - Math.min(r, g, b)
  const isGrey = saturation < 40 && avg > 60 && avg < 200
  const isBlack = avg < 60 && saturation < 30
  return isGrey || isBlack
}

function scoreRegionAsRef(
  imageData: ImageData,
  rx: number, ry: number, rw: number, rh: number
): number {
  const { data, width, height } = imageData
  let refPixels = 0, totalPixels = 0
  const x0 = Math.floor(rx * width), y0 = Math.floor(ry * height)
  const x1 = Math.min(width, Math.floor((rx + rw) * width))
  const y1 = Math.min(height, Math.floor((ry + rh) * height))

  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * width + x) * 4
      if (isRefLikePixel(data[i], data[i+1], data[i+2])) refPixels++
      totalPixels++
    }
  }
  return totalPixels > 0 ? refPixels / totalPixels : 0
}

function computeMotion(
  prev: ImageData, curr: ImageData,
  rx: number, ry: number, rw: number, rh: number
): number {
  const { width, height } = prev
  const x0 = Math.floor(rx * width), y0 = Math.floor(ry * height)
  const x1 = Math.min(width, Math.floor((rx + rw) * width))
  const y1 = Math.min(height, Math.floor((ry + rh) * height))
  let motionPixels = 0, totalPixels = 0

  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * width + x) * 4
      const diff = Math.abs(curr.data[i] - prev.data[i])
               + Math.abs(curr.data[i+1] - prev.data[i+1])
               + Math.abs(curr.data[i+2] - prev.data[i+2])
      if (diff > MOTION_THRESHOLD * 3) motionPixels++
      totalPixels++
    }
  }
  return totalPixels > 0 ? motionPixels / totalPixels : 0
}

// Find best ref region by scanning a grid
function findRefRegion(imageData: ImageData): { x: number; y: number; w: number; h: number; score: number } {
  // Ref is usually in middle 80% of frame, not at extreme edges
  // Scan in a grid, score each region
  const candidates = [
    // Center regions (most likely)
    { x: 0.2, y: 0.1, w: 0.6, h: 0.7 },
    { x: 0.1, y: 0.1, w: 0.4, h: 0.7 },
    { x: 0.5, y: 0.1, w: 0.4, h: 0.7 },
    { x: 0.3, y: 0.1, w: 0.4, h: 0.5 },
    // Wider scan
    { x: 0.0, y: 0.0, w: 1.0, h: 1.0 },
  ]

  let best = candidates[0]
  let bestScore = 0
  for (const c of candidates) {
    const score = scoreRegionAsRef(imageData, c.x, c.y, c.w, c.h)
    if (score > bestScore) { bestScore = score; best = c }
  }
  return { ...best, score: bestScore }
}

export interface DetectionProgress {
  framesAnalyzed: number
  totalFrames: number
  candidatesFound: number
  pct: number
}

/**
 * Main entry point — runs motion detection on a loaded video element.
 * Uses a hidden canvas to extract frame data.
 * Calls onProgress periodically, resolves with final candidate list.
 */
export async function detectRefMotion(
  video: HTMLVideoElement,
  onProgress: (p: DetectionProgress) => void
): Promise<MotionCandidate[]> {

  const duration = video.duration
  const videofps = 30 // assume 30fps
  const sampleInterval = 1 / SAMPLE_FPS
  const totalSamples = Math.floor(duration * SAMPLE_FPS)

  // Create offscreen canvas for frame extraction
  const canvas = document.createElement('canvas')
  // Downsample for speed — 320x180 is plenty for motion detection
  canvas.width = 320
  canvas.height = 180
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!

  const motionScores: { time: number; frame: number; score: number; region: { x: number; y: number; w: number; h: number } }[] = []
  let prevImageData: ImageData | null = null
  let prevRefRegion = { x: 0.2, y: 0.1, w: 0.6, h: 0.7 }

  const seekTo = (time: number): Promise<void> =>
    new Promise(resolve => {
      video.currentTime = time
      const handler = () => { video.removeEventListener('seeked', handler); resolve() }
      video.addEventListener('seeked', handler)
    })

  for (let i = 0; i < totalSamples; i++) {
    const time = i * sampleInterval
    if (time >= duration) break

    await seekTo(time)
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

    // Every 5 samples, re-detect ref region
    if (i % 5 === 0) {
      const region = findRefRegion(imageData)
      if (region.score > 0.15) {
        prevRefRegion = { x: region.x, y: region.y, w: region.w, h: region.h }
      }
    }

    if (prevImageData) {
      const motionScore = computeMotion(prevImageData, imageData, prevRefRegion.x, prevRefRegion.y, prevRefRegion.w, prevRefRegion.h)
      if (motionScore > MIN_MOTION_AREA) {
        motionScores.push({
          time,
          frame: Math.round(time * videofps),
          score: motionScore,
          region: { ...prevRefRegion },
        })
      }
    }

    prevImageData = imageData

    if (i % 10 === 0) {
      onProgress({ framesAnalyzed: i, totalFrames: totalSamples, candidatesFound: motionScores.length, pct: Math.round((i / totalSamples) * 100) })
      // Yield to browser to keep UI responsive
      await new Promise(r => setTimeout(r, 0))
    }
  }

  // Cluster nearby motion events
  const candidates: MotionCandidate[] = []
  let clusterStart: typeof motionScores[0] | null = null
  let clusterPeak: typeof motionScores[0] | null = null
  let clusterScores: typeof motionScores[0][] = []

  const flushCluster = () => {
    if (!clusterStart || !clusterPeak || clusterScores.length === 0) return
    const avgScore = clusterScores.reduce((s, c) => s + c.score, 0) / clusterScores.length
    const videofps2 = 30
    const bufferFrames = 15 // 0.5s buffer each side
    candidates.push({
      id: `candidate_${candidates.length}`,
      startFrame: Math.max(0, clusterStart.frame - bufferFrames),
      endFrame: clusterPeak.frame + bufferFrames * 2,
      peakFrame: clusterPeak.frame,
      peakTime: clusterPeak.time,
      motionScore: Math.min(1, avgScore * 10),
      refRegion: clusterPeak.region,
      status: 'pending',
    })
    clusterStart = null; clusterPeak = null; clusterScores = []
  }

  for (const m of motionScores) {
    if (!clusterStart) {
      clusterStart = m; clusterPeak = m; clusterScores = [m]
    } else {
      const lastTime = clusterScores[clusterScores.length - 1].time
      if (m.time - lastTime <= CLUSTER_GAP_SECS) {
        clusterScores.push(m)
        if (!clusterPeak || m.score > clusterPeak.score) clusterPeak = m
      } else {
        flushCluster()
        clusterStart = m; clusterPeak = m; clusterScores = [m]
      }
    }
  }
  flushCluster()

  // Sort by motion score descending, cap results
  return candidates
    .sort((a, b) => b.motionScore - a.motionScore)
    .slice(0, MAX_CANDIDATES)
}
