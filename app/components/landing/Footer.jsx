'use client'
import Link from 'next/link'

export default function Footer() {
  return (
    <footer style={{
      borderTop: '1px solid rgba(255,255,255,0.05)',
      padding: '32px 24px', textAlign: 'center',
      color: 'rgba(255,255,255,0.3)', fontSize: 14,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
    }}>
      <p>© 2026 VidZen API. High-Performance Video Infrastructure.</p>
      <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link
          href="/dsa"
          style={{
            color: 'rgba(255,255,255,0.28)',
            textDecoration: 'none',
            fontSize: 12,
            fontWeight: 500,
            transition: 'color 0.2s',
            letterSpacing: '0.02em',
          }}
          onMouseEnter={e => e.currentTarget.style.color = 'rgba(244,63,94,0.8)'}
          onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.28)'}
        >
          DSA Compliance / Report Abuse &amp; Copyright
        </Link>
      </div>
    </footer>
  )
}
