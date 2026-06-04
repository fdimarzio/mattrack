export default function Home() {
  return (
    <main style={{
      minHeight: '100vh', background: '#08080f', color: '#e0e0f0',
      fontFamily: "'Courier New', monospace", display: 'flex',
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 32,
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, fontWeight: 'bold', letterSpacing: 6, color: '#ff0055' }}>MATTRACK</div>
        <div style={{ fontSize: 12, color: '#444', letterSpacing: 3, marginTop: 4 }}>WRESTLING SIGNAL ML PIPELINE</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, width: '100%', maxWidth: 680, padding: '0 20px' }}>
        {[
          { href: '/labeler', label: '✏️ LABEL', desc: 'Manual label signals in video', color: '#ff0055' },
          { href: '/scan', label: '⚡ SCAN', desc: 'Motion-detect + rapid label', color: '#fbbf24' },
          { href: '/export', label: '↓ EXPORT', desc: 'Export training data', color: '#00ff88' },
          { href: '/review', label: '🔍 REVIEW', desc: 'Inference review + whistle QA', color: '#38bdf8' },
          { href: '/pose', label: '🦾 POSE', desc: 'MediaPipe keypoint analysis', color: '#a78bfa' },
        ].map(p => (
          <a key={p.href} href={p.href} style={{
            background: '#0d0d1a', border: `1px solid ${p.color}33`,
            padding: '20px', textDecoration: 'none', display: 'flex', flexDirection: 'column', gap: 6,
            transition: 'border-color 0.2s',
          }}>
            <div style={{ fontSize: 15, fontWeight: 'bold', color: p.color, letterSpacing: 2 }}>{p.label}</div>
            <div style={{ fontSize: 11, color: '#555' }}>{p.desc}</div>
          </a>
        ))}
      </div>
    </main>
  )
}
