-- mattrack_baseline_runs
-- Stores the output of each zero-shot baseline scan so results persist
-- and can be compared over time as more labels are added.

create table if not exists mattrack_baseline_runs (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz default now(),

  -- which video this run is for
  video_id        uuid references mattrack_videos(id) on delete cascade,
  filename        text not null,          -- denormalized for easy display

  -- scan config
  model_version   text not null default 'blazepose-zero-shot-v1',
  sample_rate     int  not null default 3,   -- every Nth frame
  fps             int  not null default 30,

  -- raw detections (full array for later analysis)
  detections      jsonb default '[]',

  -- eval metrics (null if no ground truth existed at scan time)
  ground_truth_count  int,
  detection_count     int,
  true_positives      int,
  false_positives     int,
  false_negatives     int,
  precision           numeric(5,4),
  recall              numeric(5,4),
  f1                  numeric(5,4),

  -- batch grouping — all videos scanned together share a run_group_id
  run_group_id    uuid,
  status          text default 'done'   -- done | error
);

create index if not exists mattrack_baseline_runs_video_id  on mattrack_baseline_runs(video_id);
create index if not exists mattrack_baseline_runs_created   on mattrack_baseline_runs(created_at desc);
create index if not exists mattrack_baseline_runs_group     on mattrack_baseline_runs(run_group_id);
