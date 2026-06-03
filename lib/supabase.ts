import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// ── typed helpers ─────────────────────────────────────────

export async function createVideo(data: {
  filename: string
  duration_seconds: number
  fps: number
  width_px?: number
  height_px?: number
  camera_angle: string
  venue_type: string
  ambient_whistle_density: string
  estimated_mat_count: number
  event_name?: string
  local_file_path?: string   // stored for reference, not uploaded
}) {
  return supabase.from('mattrack_videos').insert(data).select().single()
}

export async function createMatch(data: {
  video_id: string
  red_name: string
  green_name: string
  weight_class?: string
  event_name?: string
  total_periods: number
}) {
  return supabase.from('mattrack_matches').insert(data).select().single()
}

export async function createSignalInstance(data: Record<string, unknown>) {
  return supabase.from('mattrack_signal_instances').insert(data).select().single()
}

export async function createTimedEvent(data: Record<string, unknown>) {
  return supabase.from('mattrack_timed_events').insert(data).select().single()
}

export async function createSession(data: {
  video_id: string
  labeler_id: string
}) {
  return supabase.from('mattrack_labeling_sessions').insert(data).select().single()
}

export async function updateSession(id: string, data: Record<string, unknown>) {
  return supabase.from('mattrack_labeling_sessions').update(data).eq('id', id)
}

export async function getSessionLabels(videoId: string) {
  return supabase
    .from('mattrack_signal_instances')
    .select('*')
    .eq('video_id', videoId)
    .order('start_frame', { ascending: true })
}

// Upload an extracted clip to Supabase Storage
export async function uploadClip(
  signalInstanceId: string,
  clipBlob: Blob,
  signalId: string
) {
  const path = `clips/${signalId}/${signalInstanceId}.mp4`
  const { error } = await supabase.storage
    .from(process.env.NEXT_PUBLIC_SUPABASE_CLIPS_BUCKET!)
    .upload(path, clipBlob, { contentType: 'video/mp4', upsert: true })
  if (error) throw error
  // Update the signal instance with the clip path
  await supabase
    .from('mattrack_signal_instances')
    .update({ clip_path: path })
    .eq('id', signalInstanceId)
  return path
}
