'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────
interface LabelRow {
  id: string
  signal_id: string
  signal_label: string
  signal_category: string
  start_frame: number
  peak_frame: number
  end_frame: number
  points_awarded: number
  awarded_to: string | null
  period: number
  label_confidence: number
  is_negative_sample: boolean
  is_ambiguous: boolean
  needs_review: boolean
  bbox_x: number | null
  bbox_y: number | null
  bbox_w: number | null
  bbox_h: number | null
  camera_angle: string
  lighting_quality: string
  ref_distance: string
  video_id: string
  match_id: string
  created_at: string
  filename: string
  red_name: string
  green_name: string
  event_name: string
  duration_seconds: number
  fps: number
  width_px: number
  height_px: number
}

interface Stats {
  total: number
  by_signal: Record<string, number>
  by_category: Record<string, number>
  with_bbox: number
  needs_review: number
  negative_samples: number
  avg_confidence: number
}

const catColor: Record<string, string> = {
  scoring: '#00ff88', control: '#a78bfa', clock: '#38bdf8',
  violation: '#f87171', time: '#fb923c', outcome: '#ff0055',
}

const btn: React.CSSProperties = {
  background: 'transparent', border: '1px solid #1a1a2e', color: '#888',
  padding: '8px 16px', cursor: 'pointer', fontFamily: "'Courier New',monospace",
  fontSize: 11, letterSpacing: 1,
}

export default function ExportPage() {
  const [labels, setLabels] = useState<LabelRow[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'ready' | 'needs_review' | 'no_bbox'>('all')
  const [exportFormat, setExportFormat] = useState<'csv' | 'coco' | 'manifest'>('manifest')
  const [exporting, setExporting] = useState(false)
  const [splitRatio, setSplitRatio] = useState({ train: 70, val: 20, test: 10 })

  useEffect(() => { loadLabels() }, [])

  const loadLabels = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('mattrack_signal_instances')
      .select(`
        *,
        mattrack_videos(filename, duration_seconds, fps, width_px, height_px),
        mattrack_matches(red_name, green_name, event_name)
      `)
      .order('created_at', { ascending: true })

    if (error || !data) { setLoading(false); return }

    const rows: LabelRow[] = data.map((d: Record<string, unknown>) => {
      const vid = d.mattrack_videos as Record<string, unknown> | null
      const match = d.mattrack_matches as Record<string, unknown> | null
      return {
        ...d as unknown as LabelRow,
        filename: (vid?.filename as string) || '',
        duration_seconds: (vid?.duration_seconds as number) || 0,
        fps: (vid?.fps as number) || 30,
        width_px: (vid?.width_px as number) || 0,
        height_px: (vid?.height_px as number) || 0,
        red_name: (match?.red_name as string) || '',
        green_name: (match?.green_name as string) || '',
        event_name: (match?.event_name as string) || '',
      }
    })

    setLabels(rows)

    // Compute stats
    const by_signal: Record<string, number> = {}
    const by_category: Record<string, number> = {}
    rows.forEach(r => {
      by_signal[r.signal_label] = (by_signal[r.signal_label] || 0) + 1
      by_category[r.signal_category] = (by_category[r.signal_category] || 0) + 1
    })

    setStats({
      total: rows.length,
      by_signal,
      by_category,
      with_bbox: rows.filter(r => r.bbox_x !== null).length,
      needs_review: rows.filter(r => r.needs_review).length,
      negative_samples: rows.filter(r => r.is_negative_sample).length,
      avg_confidence: rows.length ? Math.round(rows.reduce((s, r) => s + (r.label_confidence || 0), 0) / rows.length * 10) / 10 : 0,
    })

    setLoading(false)
  }

  const filteredLabels = labels.filter(r => {
    if (filter === 'ready') return !r.needs_review && !r.is_ambiguous
    if (filter === 'needs_review') return r.needs_review
    if (filter === 'no_bbox') return r.bbox_x === null
    return true
  })

  // Assign train/val/test splits deterministically
  const withSplits = filteredLabels.map((r, i) => {
    const pct = (i / Math.max(filteredLabels.length, 1)) * 100
    const split = pct < splitRatio.train ? 'train'
      : pct < splitRatio.train + splitRatio.val ? 'val' : 'test'
    return { ...r, split }
  })

  const exportCSV = () => {
    const headers = [
      'id', 'split', 'filename', 'signal_id', 'signal_label', 'signal_category',
      'start_frame', 'peak_frame', 'end_frame', 'duration_frames',
      'fps', 'width_px', 'height_px',
      'bbox_x', 'bbox_y', 'bbox_w', 'bbox_h', 'has_bbox',
      'points_awarded', 'awarded_to', 'period',
      'label_confidence', 'is_negative_sample', 'is_ambiguous',
      'camera_angle', 'lighting_quality', 'ref_distance',
      'red_name', 'green_name', 'event_name'
    ]
    const rows = withSplits.map(r => [
      r.id, r.split, r.filename, r.signal_id, r.signal_label, r.signal_category,
      r.start_frame, r.peak_frame || '', r.end_frame, r.end_frame - r.start_frame,
      r.fps, r.width_px, r.height_px,
      r.bbox_x ?? '', r.bbox_y ?? '', r.bbox_w ?? '', r.bbox_h ?? '',
      r.bbox_x !== null ? 1 : 0,
      r.points_awarded, r.awarded_to || '', r.period,
      r.label_confidence, r.is_negative_sample ? 1 : 0, r.is_ambiguous ? 1 : 0,
      r.camera_angle || '', r.lighting_quality || '', r.ref_distance || '',
      r.red_name, r.green_name, r.event_name
    ])
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n')
    download(csv, 'mattrack_labels.csv', 'text/csv')
  }

  const exportCOCO = () => {
    // COCO Video Action Detection format
    const categories = Array.from(new Set(labels.map(r => r.signal_id))).map((id, i) => ({
      id: i + 1,
      name: id,
      supercategory: labels.find(r => r.signal_id === id)?.signal_category || 'unknown'
    }))
    const catMap = Object.fromEntries(categories.map(c => [c.name, c.id]))

    const videos = Array.from(new Set(labels.map(r => r.video_id))).map((vid_id, i) => {
      const r = labels.find(l => l.video_id === vid_id)!
      return { id: i + 1, file_name: r.filename, width: r.width_px, height: r.height_px, fps: r.fps }
    })
    const vidMap = Object.fromEntries(videos.map(v => [labels.find(l => l.filename === v.file_name)?.video_id, v.id]))

    const annotations = withSplits.map((r, i) => ({
      id: i + 1,
      video_id: vidMap[r.video_id],
      category_id: catMap[r.signal_id],
      split: r.split,
      segment: [r.start_frame / r.fps, r.end_frame / r.fps],
      start_frame: r.start_frame,
      peak_frame: r.peak_frame,
      end_frame: r.end_frame,
      bbox: r.bbox_x !== null ? [r.bbox_x, r.bbox_y, r.bbox_w, r.bbox_h] : null,
      score: r.label_confidence / 5,
      attributes: {
        awarded_to: r.awarded_to,
        period: r.period,
        points: r.points_awarded,
        is_negative: r.is_negative_sample,
        is_ambiguous: r.is_ambiguous,
        needs_review: r.needs_review,
        camera_angle: r.camera_angle,
        lighting: r.lighting_quality,
      }
    }))

    const coco = {
      info: { description: 'MatTrack Wrestling Signal Dataset', version: '1.0', date_created: new Date().toISOString() },
      videos,
      categories,
      annotations,
    }
    download(JSON.stringify(coco, null, 2), 'mattrack_coco.json', 'application/json')
  }

  const exportManifest = () => {
    // Clip extraction manifest — feed this to extract_clips.py
    const manifest = withSplits.map(r => ({
      instance_id: r.id,
      video_filename: r.filename,
      video_id: r.video_id,
      split: r.split,
      signal_id: r.signal_id,
      signal_label: r.signal_label,
      signal_category: r.signal_category,
      start_frame: r.start_frame,
      peak_frame: r.peak_frame,
      end_frame: r.end_frame,
      fps: r.fps,
      // Clip window: 1.5s before start, 2s after end
      clip_start_frame: Math.max(0, r.start_frame - 45),
      clip_end_frame: r.end_frame + 60,
      clip_start_sec: Math.max(0, (r.start_frame - 45) / r.fps),
      clip_end_sec: (r.end_frame + 60) / r.fps,
      bbox: r.bbox_x !== null ? { x: r.bbox_x, y: r.bbox_y, w: r.bbox_w, h: r.bbox_h } : null,
      has_bbox: r.bbox_x !== null,
      // Ref auto-detection hint: look for grey/black striped uniform
      ref_detection_hint: 'grey_black_stripes',
      label_confidence: r.label_confidence,
      needs_whistle_review: r.needs_review,
    }))

    const output = {
      exported_at: new Date().toISOString(),
      total_instances: manifest.length,
      splits: {
        train: manifest.filter(m => m.split === 'train').length,
        val: manifest.filter(m => m.split === 'val').length,
        test: manifest.filter(m => m.split === 'test').length,
      },
      missing_bbox: manifest.filter(m => !m.has_bbox).length,
      note_on_bbox: 'Ref identified by grey/black striped uniform. Run auto-bbox detection before training.',
      instances: manifest,
    }
    download(JSON.stringify(output, null, 2), 'mattrack_manifest.json', 'application/json')
  }

  const download = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    a.click()
  }

  const doExport = () => {
    setExporting(true)
    if (exportFormat === 'csv') exportCSV()
    else if (exportFormat === 'coco') exportCOCO()
    else exportManifest()
    setTimeout(() => setExporting(false), 1000)
  }

  // Minimum recommended per class for a viable model
  const MIN_PER_CLASS = 50
  const signalEntries = stats ? Object.entries(stats.by_signal).sort((a, b) => b[1] - a[1]) : []

  return (
    <div style={{ minHeight: '100vh', background: '#08080f', color: '#e0e0f0', fontFamily: "'Courier New',monospace" }}>

      {/* Header */}
      <div style={{ background: '#0d0d1a', borderBottom: '2px solid #ff0055', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <a href="/" style={{ color: '#555', textDecoration: 'none', fontSize: 11 }}>← HOME</a>
          <div style={{ fontSize: 16, color: '#ff0055', fontWeight: 'bold', letterSpacing: 3 }}>MATTRACK / EXPORT</div>
        </div>
        <a href="/review" style={{ ...btn, color: '#38bdf8', borderColor: '#38bdf8', textDecoration: 'none', padding: '6px 14px' }}>
          → INFERENCE REVIEW
        </a>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#444' }}>LOADING LABELS…</div>
      ) : (
        <div style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>

          {/* Stats overview */}
          {stats && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12, marginBottom: 28 }}>
              {[
                { label: 'TOTAL LABELS', value: stats.total, color: '#e0e0f0' },
                { label: 'READY TO TRAIN', value: stats.total - stats.needs_review, color: '#00ff88' },
                { label: 'NEEDS REVIEW', value: stats.needs_review, color: '#fbbf24' },
                { label: 'HAS BBOX', value: stats.with_bbox, color: '#a78bfa' },
                { label: 'NEGATIVE', value: stats.negative_samples, color: '#f87171' },
                { label: 'AVG CONFIDENCE', value: `${stats.avg_confidence}/5`, color: '#38bdf8' },
              ].map(s => (
                <div key={s.label} style={{ background: '#0d0d1a', border: '1px solid #1a1a2e', padding: '12px 14px' }}>
                  <div style={{ fontSize: 22, fontWeight: 'bold', color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 9, color: '#444', letterSpacing: 1, marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Bbox notice */}
          {stats && stats.with_bbox < stats.total && (
            <div style={{ background: '#1a1500', border: '1px solid #fbbf24', padding: '12px 16px', marginBottom: 20, fontSize: 11, color: '#fbbf24', lineHeight: 1.6 }}>
              ⚠️ {stats.total - stats.with_bbox} labels are missing bounding boxes. The ref auto-detector will fill these in using grey/black stripe detection before training. Export the manifest and run <code style={{ background: '#0a0a00', padding: '1px 6px' }}>python scripts/detect_ref_bbox.py</code> to backfill.
            </div>
          )}

          {/* Signal coverage */}
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 11, color: '#666', letterSpacing: 2, marginBottom: 12 }}>SIGNAL COVERAGE — need {MIN_PER_CLASS}+ per class for training</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {signalEntries.map(([label, count]) => {
                const r = labels.find(l => l.signal_label === label)
                const color = catColor[r?.signal_category || 'control']
                const pct = Math.min(100, (count / MIN_PER_CLASS) * 100)
                const ready = count >= MIN_PER_CLASS
                return (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 200, fontSize: 11, color: ready ? color : '#555', flexShrink: 0 }}>{label}</div>
                    <div style={{ flex: 1, height: 8, background: '#0d0d1a', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: ready ? color : '#333', borderRadius: 2, transition: 'width 0.3s' }} />
                    </div>
                    <div style={{ width: 40, textAlign: 'right', fontSize: 11, color: ready ? color : '#555' }}>{count}</div>
                    <div style={{ width: 20, fontSize: 11 }}>{ready ? '✓' : ''}</div>
                  </div>
                )
              })}
            </div>
            <div style={{ fontSize: 10, color: '#333', marginTop: 10 }}>
              Total labels needed for minimum viable model: ~{Object.keys(stats?.by_signal || {}).length * MIN_PER_CLASS} ({Object.keys(stats?.by_signal || {}).length} classes × {MIN_PER_CLASS})
            </div>
          </div>

          {/* Train/val/test split */}
          <div style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 11, color: '#666', letterSpacing: 2, marginBottom: 12 }}>DATASET SPLIT</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {(['train', 'val', 'test'] as const).map(s => (
                <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: '#555', width: 36 }}>{s.toUpperCase()}</span>
                  <input type="number" min={0} max={100}
                    value={splitRatio[s]}
                    onChange={e => setSplitRatio(p => ({ ...p, [s]: +e.target.value }))}
                    style={{ background: '#0d0d1a', border: '1px solid #1a1a2e', color: '#e0e0f0', fontFamily: 'inherit', fontSize: 12, padding: '4px 8px', width: 56, textAlign: 'center' }} />
                  <span style={{ fontSize: 11, color: '#444' }}>%</span>
                  <span style={{ fontSize: 11, color: '#555' }}>({Math.round(filteredLabels.length * splitRatio[s] / 100)} samples)</span>
                </div>
              ))}
            </div>
          </div>

          {/* Filter + export */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: '#666', letterSpacing: 2, marginBottom: 12 }}>EXPORT</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              {(['all', 'ready', 'needs_review', 'no_bbox'] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{ ...btn, background: filter === f ? '#1a1a2e' : 'transparent', color: filter === f ? '#fff' : '#555', borderColor: filter === f ? '#ff0055' : '#1a1a2e', fontSize: 10, padding: '5px 10px' }}>
                  {f.toUpperCase().replace('_', ' ')} ({f === 'all' ? labels.length : f === 'ready' ? labels.filter(r => !r.needs_review).length : f === 'needs_review' ? labels.filter(r => r.needs_review).length : labels.filter(r => r.bbox_x === null).length})
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              {(['manifest', 'csv', 'coco'] as const).map(f => (
                <button key={f} onClick={() => setExportFormat(f)} style={{ ...btn, background: exportFormat === f ? '#ff0055' : 'transparent', color: exportFormat === f ? '#fff' : '#555', borderColor: exportFormat === f ? '#ff0055' : '#1a1a2e' }}>
                  {f === 'manifest' ? '📋 CLIP MANIFEST' : f === 'csv' ? '📊 CSV' : '🗂 COCO JSON'}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 10, color: '#444', marginBottom: 12, lineHeight: 1.6 }}>
              {exportFormat === 'manifest' && '→ JSON file fed to extract_clips.py — extracts video clips around each label. Start here.'}
              {exportFormat === 'csv' && '→ Flat CSV with all label metadata. Good for analysis in Excel/pandas.'}
              {exportFormat === 'coco' && '→ COCO Video format. Compatible with PyTorch, TensorFlow, Roboflow, and most CV frameworks.'}
            </div>
            <button onClick={doExport} disabled={exporting || filteredLabels.length === 0} style={{
              background: '#ff0055', border: 'none', color: '#fff', padding: '12px 32px',
              cursor: filteredLabels.length === 0 ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', fontSize: 13, letterSpacing: 2, fontWeight: 'bold',
              opacity: filteredLabels.length === 0 ? 0.4 : 1,
            }}>
              {exporting ? 'EXPORTING…' : `↓ EXPORT ${filteredLabels.length} LABELS`}
            </button>
          </div>

          {/* Label table */}
          <div>
            <div style={{ fontSize: 11, color: '#666', letterSpacing: 2, marginBottom: 10 }}>LABEL DETAIL</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #1a1a2e' }}>
                    {['FILE', 'SIGNAL', 'FRAMES', 'SPLIT', 'BBOX', 'CONF', 'FLAGS'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: '#444', letterSpacing: 1, fontWeight: 'normal' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {withSplits.map(r => (
                    <tr key={r.id} style={{ borderBottom: '1px solid #0d0d1a' }}>
                      <td style={{ padding: '6px 10px', color: '#555', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.filename}</td>
                      <td style={{ padding: '6px 10px', color: catColor[r.signal_category] || '#fff' }}>{r.signal_label}</td>
                      <td style={{ padding: '6px 10px', color: '#555' }}>{r.start_frame}→{r.end_frame}</td>
                      <td style={{ padding: '6px 10px', color: r.split === 'train' ? '#00ff88' : r.split === 'val' ? '#fbbf24' : '#f87171' }}>{r.split}</td>
                      <td style={{ padding: '6px 10px', color: r.bbox_x !== null ? '#00ff88' : '#333' }}>{r.bbox_x !== null ? '✓' : '—'}</td>
                      <td style={{ padding: '6px 10px', color: '#555' }}>{r.label_confidence}/5</td>
                      <td style={{ padding: '6px 10px' }}>
                        {r.needs_review && <span style={{ color: '#fbbf24', marginRight: 4 }}>⚠</span>}
                        {r.is_negative_sample && <span style={{ color: '#f87171', marginRight: 4 }}>NEG</span>}
                        {r.is_ambiguous && <span style={{ color: '#fb923c' }}>AMB</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      )}
    </div>
  )
}
