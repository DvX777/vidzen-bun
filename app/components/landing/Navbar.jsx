'use client'

export default function Navbar({ onNav }) {
  return (
    <nav style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40,
      borderBottom: '1px solid rgba(255,255,255,0.05)',
      background: 'rgba(2,6,23,0.5)',
      backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
    }}>
      <div style={{
        maxWidth: 1280, margin: '0 auto', padding: '0 24px',
        height: 80, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'linear-gradient(135deg, #fb7185, #e11d48)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="16" height="16" fill="#fff" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          </div>
          <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em' }}>
            VidZen<span style={{ color: '#fb7185' }}>.</span>
          </span>
        </div>

        {/* Nav links */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 32, fontSize: 14, fontWeight: 500, color: 'rgba(255,255,255,0.6)' }}>
          {[
            { label: 'Features', id: 'features' },
            { label: 'Documentation', id: 'documentation' },
            { label: 'Player API', id: 'events' },
            { label: 'Sandbox', id: 'sandbox' },
          ].map(item => (
            <a key={item.id} href={`#${item.id}`}
              style={{ textDecoration: 'none', color: 'inherit', transition: 'color 0.2s', cursor: 'pointer' }}
              onMouseEnter={e => e.target.style.color = '#fff'}
              onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.6)'}>
              {item.label}
            </a>
          ))}
        </div>

        {/* CTA */}
        <a href="#sandbox" style={{
          padding: '10px 20px', borderRadius: 9999,
          background: '#fff', color: '#000',
          fontSize: 14, fontWeight: 700, textDecoration: 'none',
          display: 'flex', alignItems: 'center', gap: 8,
          transition: 'transform 0.2s',
        }}
          onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.05)'}
          onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
          Try Demo
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14m-7-7 7 7-7 7"/></svg>
        </a>
      </div>
    </nav>
  )
}
