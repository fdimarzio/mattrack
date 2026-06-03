-- MatTrack ML Schema v2.0
-- Already applied to project ghdmvzlfenpmoiyyagqw
-- Run this for any new Supabase project

-- Add clip_path to signal instances (hybrid storage: local video + cloud clips)
-- Note: full schema is in docs/schema.sql

ALTER TABLE mattrack_signal_instances
  ADD COLUMN IF NOT EXISTS clip_path text,         -- Supabase Storage path after extraction
  ADD COLUMN IF NOT EXISTS clip_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS local_video_path text;  -- labeler's local file path at time of labeling

-- Also add local_video_path to videos table
ALTER TABLE mattrack_videos
  ADD COLUMN IF NOT EXISTS local_file_path text;   -- e.g. /Volumes/WrestlingHD/match_001.mp4
