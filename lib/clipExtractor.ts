/**
 * clipExtractor.ts
 *
 * Extracts short video clips around each labeled signal instance.
 * Runs client-side using the Web Streams API to slice the video Blob.
 *
 * Strategy:
 *   - Each label has start_frame / end_frame
 *   - We extract: (start_frame - PRE_BUFFER_FRAMES) → (end_frame + POST_BUFFER_FRAMES)
 *   - Resulting clips are ~3-8 seconds, suitable as ML training samples
 *   - Clips are uploaded to Supabase Storage under clips/{signal_id}/{instance_id}.webm
 *   - Original full video is NEVER uploaded — stays local
 */

const FPS = 30
const PRE_BUFFER_FRAMES  = 45   // 1.5s before gesture starts
const POST_BUFFER_FRAMES = 60   // 2.0s after gesture ends

export interface ClipJob {
  signalInstanceId: string
  signalId: string
  startFrame: number
  endFrame: number
}

/**
 * Extract a clip from a video File using the browser's native
 * HTMLVideoElement + MediaRecorder pipeline.
 * Returns a Blob of the clip in webm format.
 */
export async function extractClip(
  videoFile: File,
  job: ClipJob
): Promise<Blob> {
  const clipStart = Math.max(0, (job.startFrame - PRE_BUFFER_FRAMES) / FPS)
  const clipEnd   = (job.endFrame + POST_BUFFER_FRAMES) / FPS

  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.src = URL.createObjectURL(videoFile)
    video.muted = true

    const chunks: BlobPart[] = []
    let recorder: MediaRecorder | null = null

    video.addEventListener('loadedmetadata', () => {
      video.currentTime = clipStart
    })

    video.addEventListener('seeked', () => {
      // Start recording once seeked to clip start
      if (recorder) return  // already started

      try {
        const stream = (video as HTMLVideoElement & { captureStream: () => MediaStream }).captureStream()
        recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' })

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data)
        }

        recorder.onstop = () => {
          URL.revokeObjectURL(video.src)
          resolve(new Blob(chunks, { type: 'video/webm' }))
        }

        recorder.start(100) // collect in 100ms chunks
        video.play()

        // Stop recording when we reach clip end
        const checkTime = () => {
          if (video.currentTime >= clipEnd) {
            recorder?.stop()
            video.pause()
          } else {
            requestAnimationFrame(checkTime)
          }
        }
        requestAnimationFrame(checkTime)

      } catch (err) {
        reject(err)
      }
    })

    video.addEventListener('error', reject)
  })
}

/**
 * Process all pending clip jobs for a completed labeling session.
 * Extracts each clip and uploads to Supabase Storage.
 * Calls onProgress(completed, total) after each clip.
 */
export async function processClipJobs(
  videoFile: File,
  jobs: ClipJob[],
  uploadFn: (job: ClipJob, blob: Blob) => Promise<void>,
  onProgress?: (completed: number, total: number) => void
) {
  let completed = 0
  for (const job of jobs) {
    try {
      const blob = await extractClip(videoFile, job)
      await uploadFn(job, blob)
      completed++
      onProgress?.(completed, jobs.length)
    } catch (err) {
      console.error(`Clip extraction failed for ${job.signalInstanceId}:`, err)
    }
  }
}
