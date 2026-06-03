export default function Home() {
  return (
    <main style={{
      minHeight: '100vh',
      background: '#08080f',
      color: '#e0e0f0',
      fontFamily: "'Courier New', monospace",
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 32,
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, fontWeight: 'bold', letterSpacing: 6, color: '#ff0055' }}>MATTRACK</div>
        <div style={{ fontSize: 12, color: '#444', letterSpacing: 3, marginTop: 4 }}>
          WRESTLING SIGNAL ML LABELING SYSTEM
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16 }}>
        <a href="/labeler" style={{
          background: '#ff0055', color: '#fff', padding: '12px 28px',
          textDecoration: 'none', fontFamily: 'inherit',
          fontSize: 13, letterSpacing: 2, fontWeight: 'bold',
        }}>
          ▶ START LABELING
        </a>
        <a href="/dashboard" style={{
          background: 'transparent', color: '#555', padding: '12px 28px',
          textDecoration: 'none', fontFamily: 'inherit',
          fontSize: 13, letterSpacing: 2,
          border: '1px solid #1a1a2e',
        }}>
          DASHBOARD (coming soon)
        </a>
      </div>
    </main>
  )
}
