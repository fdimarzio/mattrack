#!/usr/bin/env python3
"""
scripts/detect_ref_bbox.py

Auto-detects the referee bounding box for labels missing bbox data.
Uses color-based person detection — the ref's grey/black striped uniform
is visually distinct from wrestlers in colored singlets.

Strategy:
  1. For each signal instance with no bbox, extract the peak_frame (or mid frame)
  2. Run person detection (YOLO or MediaPipe)
  3. Among detected persons, score each by grey/black stripe pattern
  4. Highest scorer = the ref → save normalized bbox to DB

Requirements:
  pip install supabase python-dotenv opencv-python ultralytics

Usage:
  python scripts/detect_ref_bbox.py --video /path/to/match.mp4 --video-id <uuid>
  python scripts/detect_ref_bbox.py --video /path/to/match.mp4 --video-id <uuid> --dry-run
"""

import argparse
import os
import cv2
import numpy as np
from pathlib import Path
from dotenv import load_dotenv

load_dotenv('.env.local')

SUPABASE_URL = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.getenv('NEXT_PUBLIC_SUPABASE_ANON_KEY')


def get_supabase():
    from supabase import create_client
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def is_ref_uniform(crop: np.ndarray) -> float:
    """
    Score a person crop for how likely it is to be a referee.
    Refs wear grey/black vertical stripes.
    Returns 0.0 (definitely not ref) to 1.0 (definitely ref).
    """
    if crop is None or crop.size == 0:
        return 0.0

    # Focus on torso area (middle 60% of crop)
    h, w = crop.shape[:2]
    torso = crop[int(h*0.2):int(h*0.7), int(w*0.1):int(w*0.9)]
    if torso.size == 0:
        return 0.0

    # Convert to HSV for color analysis
    hsv = cv2.cvtColor(torso, cv2.COLOR_BGR2HSV)

    # Grey detection: low saturation, mid value
    grey_mask = cv2.inRange(hsv, (0, 0, 60), (180, 50, 200))
    grey_pct = np.sum(grey_mask > 0) / grey_mask.size

    # Black detection: low value
    black_mask = cv2.inRange(hsv, (0, 0, 0), (180, 255, 60))
    black_pct = np.sum(black_mask > 0) / black_mask.size

    # Check for alternating stripes (vertical frequency analysis)
    grey_col = grey_mask.mean(axis=0)  # average per column
    stripe_score = 0.0
    if len(grey_col) > 4:
        diffs = np.abs(np.diff(grey_col.astype(float)))
        stripe_score = min(1.0, diffs.mean() / 50.0)

    # Combined score
    uniform_score = (grey_pct * 0.4) + (black_pct * 0.3) + (stripe_score * 0.3)

    # Penalize if too much bright color (wrestlers wear colored singlets)
    bright_mask = cv2.inRange(hsv, (0, 100, 100), (180, 255, 255))
    bright_pct = np.sum(bright_mask > 0) / bright_mask.size
    uniform_score *= max(0, 1.0 - bright_pct * 2)

    return min(1.0, uniform_score)


def detect_ref_in_frame(frame: np.ndarray, frame_w: int, frame_h: int):
    """
    Detect all people in frame and return the one most likely to be the ref.
    Returns normalized bbox (x, y, w, h) or None.
    """
    try:
        from ultralytics import YOLO
        model = YOLO('yolov8n.pt')  # auto-downloads on first run
        results = model(frame, classes=[0], verbose=False)  # class 0 = person

        best_bbox = None
        best_score = 0.2  # minimum threshold

        for result in results:
            for box in result.boxes:
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                crop = frame[int(y1):int(y2), int(x1):int(x2)]
                ref_score = is_ref_uniform(crop)

                if ref_score > best_score:
                    best_score = ref_score
                    # Normalize to 0-1
                    best_bbox = {
                        'x': x1 / frame_w,
                        'y': y1 / frame_h,
                        'w': (x2 - x1) / frame_w,
                        'h': (y2 - y1) / frame_h,
                        'score': ref_score,
                    }

        return best_bbox
    except ImportError:
        print("  ultralytics not installed — pip install ultralytics")
        return None


def main():
    parser = argparse.ArgumentParser(description='Auto-detect ref bbox for unlabeled instances')
    parser.add_argument('--video', required=True)
    parser.add_argument('--video-id', required=True)
    parser.add_argument('--dry-run', action='store_true', help="Don't write to DB, just show results")
    parser.add_argument('--min-score', type=float, default=0.25, help='Minimum ref detection score (0-1)')
    args = parser.parse_args()

    if not Path(args.video).exists():
        print(f"Video not found: {args.video}")
        return

    sb = get_supabase()

    # Fetch instances missing bbox
    result = sb.table('mattrack_signal_instances') \
               .select('id, start_frame, peak_frame, end_frame') \
               .eq('video_id', args.video_id) \
               .is_('bbox_x', 'null') \
               .execute()

    instances = result.data
    if not instances:
        print("No instances missing bbox for this video")
        return

    print(f"Processing {len(instances)} instances missing bbox...")

    cap = cv2.VideoCapture(args.video)
    fps = cap.get(cv2.CAP_PROP_FPS)
    frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    updated = 0

    for inst in instances:
        # Use peak frame if available, otherwise midpoint
        target_frame = inst.get('peak_frame') or (inst['start_frame'] + inst['end_frame']) // 2
        cap.set(cv2.CAP_PROP_POS_FRAMES, target_frame)
        ret, frame = cap.read()
        if not ret:
            print(f"  Could not read frame {target_frame}")
            continue

        bbox = detect_ref_in_frame(frame, frame_w, frame_h)

        if bbox and bbox['score'] >= args.min_score:
            print(f"  ✓ Instance {inst['id'][:8]}… F{target_frame}: ref at ({bbox['x']:.2f}, {bbox['y']:.2f}, {bbox['w']:.2f}, {bbox['h']:.2f}) score={bbox['score']:.2f}")
            if not args.dry_run:
                sb.table('mattrack_signal_instances').update({
                    'bbox_x': bbox['x'], 'bbox_y': bbox['y'],
                    'bbox_w': bbox['w'], 'bbox_h': bbox['h'],
                    'bbox_is_static': False,
                }).eq('id', inst['id']).execute()
                updated += 1
        else:
            score = bbox['score'] if bbox else 0
            print(f"  ✗ Instance {inst['id'][:8]}… F{target_frame}: no ref detected (score={score:.2f})")

    cap.release()
    print(f"\nDone. {'Would update' if args.dry_run else 'Updated'} {updated}/{len(instances)} instances.")


if __name__ == '__main__':
    main()
