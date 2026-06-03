#!/usr/bin/env python3
"""
scripts/extract_clips.py

Alternative to the browser-based extractor.
Use this for large batches or if browser extraction is too slow.

Requirements:
    pip install supabase python-dotenv
    ffmpeg must be installed (brew install ffmpeg / apt install ffmpeg)

Usage:
    python scripts/extract_clips.py --video /path/to/match.mp4 --video-id <uuid>

What it does:
    1. Fetches all labeled signal instances for the given video_id from Supabase
    2. For each instance, uses ffmpeg to extract a clip window
    3. Uploads each clip to Supabase Storage
    4. Updates the signal_instance row with clip_path
    5. Optionally deletes source video after all clips are extracted (--cleanup flag)
"""

import argparse
import os
import subprocess
import tempfile
from pathlib import Path
from dotenv import load_dotenv

load_dotenv('.env.local')

SUPABASE_URL     = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY     = os.getenv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
CLIPS_BUCKET     = os.getenv('NEXT_PUBLIC_SUPABASE_CLIPS_BUCKET', 'mattrack-clips')
FPS              = 30
PRE_BUFFER_SECS  = 1.5   # seconds before start_frame
POST_BUFFER_SECS = 2.0   # seconds after end_frame


def get_supabase_client():
    from supabase import create_client
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def fetch_signal_instances(sb, video_id: str):
    result = sb.table('mattrack_signal_instances') \
               .select('id, signal_id, start_frame, end_frame, clip_path') \
               .eq('video_id', video_id) \
               .is_('clip_path', 'null') \
               .execute()
    return result.data


def extract_clip_ffmpeg(video_path: str, start_sec: float, end_sec: float, output_path: str):
    """Use ffmpeg to extract a clip. Fast because it uses keyframe seeking."""
    duration = end_sec - start_sec
    cmd = [
        'ffmpeg', '-y',
        '-ss', str(max(0, start_sec)),
        '-i', video_path,
        '-t', str(duration),
        '-c:v', 'libx264',   # re-encode for clean cuts
        '-c:a', 'aac',
        '-preset', 'fast',
        '-crf', '23',
        output_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg error: {result.stderr}")


def upload_clip(sb, local_path: str, storage_path: str):
    with open(local_path, 'rb') as f:
        sb.storage.from_(CLIPS_BUCKET).upload(
            storage_path, f,
            file_options={"content-type": "video/mp4", "upsert": "true"}
        )


def main():
    parser = argparse.ArgumentParser(description='Extract and upload labeled clips')
    parser.add_argument('--video', required=True, help='Path to local video file')
    parser.add_argument('--video-id', required=True, help='Supabase video UUID')
    parser.add_argument('--cleanup', action='store_true',
                        help='Delete source video after all clips extracted')
    args = parser.parse_args()

    if not Path(args.video).exists():
        print(f"Error: video file not found: {args.video}")
        return

    sb = get_supabase_client()
    instances = fetch_signal_instances(sb, args.video_id)

    if not instances:
        print("No unlabeled clip instances found (all may already have clip_path set)")
        return

    print(f"Found {len(instances)} signal instances to extract")

    with tempfile.TemporaryDirectory() as tmpdir:
        for i, inst in enumerate(instances):
            start_sec = max(0, (inst['start_frame'] / FPS) - PRE_BUFFER_SECS)
            end_sec   = (inst['end_frame'] / FPS) + POST_BUFFER_SECS
            fname     = f"{inst['id']}.mp4"
            local_out = os.path.join(tmpdir, fname)
            storage_path = f"clips/{inst['signal_id']}/{fname}"

            print(f"[{i+1}/{len(instances)}] Extracting {inst['signal_id']} "
                  f"({start_sec:.1f}s → {end_sec:.1f}s) ...")

            try:
                extract_clip_ffmpeg(args.video, start_sec, end_sec, local_out)
                upload_clip(sb, local_out, storage_path)
                sb.table('mattrack_signal_instances') \
                  .update({'clip_path': storage_path}) \
                  .eq('id', inst['id']) \
                  .execute()
                print(f"    ✓ Uploaded → {storage_path}")
            except Exception as e:
                print(f"    ✗ Failed: {e}")

    if args.cleanup:
        os.remove(args.video)
        print(f"\nCleaned up source video: {args.video}")

    print(f"\nDone. {len(instances)} clips processed.")


if __name__ == '__main__':
    main()
