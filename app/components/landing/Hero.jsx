'use client'
import { useState, useEffect } from 'react'

const TMDB_KEY = '5b4bdc244af059756a769ed9666b8523'
const TMDB_IMG = 'https://image.tmdb.org/t/p/w300'

export default function Hero() {
  const [posters, setPosters] = useState({ row1: [], row2: [] })

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`https://api.themoviedb.org/3/trending/all/week?api_key=${TMDB_KEY}`)
        const data = await res.json()
        const items = (data.results || []).filter(i => i.poster_path).slice(0, 16)
        setPosters({
          row1: items.slice(0, 8),
          row2: items.slice(8, 16),
        })
      } catch { /* fallback: empty marquee */ }
    }
    load()
  }, [])

  return (
    <>
      {/* ── Hero Section ─────────────────────────────────── */}
      <main style={{ position: 'relative', paddingTop: 128, paddingBottom: 80, overflow: 'hidden' }}>
        {/* Blob glows */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          width: '100%', maxWidth: 800, height: 400, opacity: 0.3, pointerEvents: 'none',
          display: 'flex', justifyContent: 'center', alignItems: 'center',
        }}>
          <div style={{
            position: 'absolute', width: 288, height: 288, background: '#f43f5e',
            borderRadius: '50%', mixBlendMode: 'screen', filter: 'blur(100px)',
            animation: 'blob 7s infinite',
          }} />
          <div style={{
            position: 'absolute', width: 288, height: 288, background: '#e11d48',
            borderRadius: '50%', mixBlendMode: 'screen', filter: 'blur(100px)',
            animation: 'blob 7s infinite 2s', transform: 'translateX(128px)',
          }} />
        </div>

        <div style={{ position: 'relative', maxWidth: 1024, margin: '0 auto', padding: '0 24px', textAlign: 'center', zIndex: 10 }}>
          <h1 style={{
            fontSize: 'clamp(48px, 7vw, 88px)', fontWeight: 800,
            letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: 32,
          }}>
            The ultimate streaming<br/>
            <span style={{
              background: 'linear-gradient(90deg, #fb7185, #e11d48, #fb7185)',
              backgroundSize: '200% auto',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              animation: 'gradient 8s linear infinite',
            }}>
              API framework.
            </span>
          </h1>

          <p style={{
            fontSize: 'clamp(16px, 2vw, 20px)', color: 'rgba(255,255,255,0.5)',
            maxWidth: 640, margin: '0 auto 48px', lineHeight: 1.7,
          }}>
            Lightning-fast failover networks, true parallel source racing, and a fully responsive
            embedded player ready for your app.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
            <a href="#documentation" style={{
              padding: '16px 32px', borderRadius: 9999,
              background: '#fff', color: '#000', fontWeight: 700, fontSize: 15,
              textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8,
              transition: 'transform 0.2s',
            }}
              onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.05)'}
              onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m16 18 2-2-2-2m-4-4L10 8l-2 2"/><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
              Read the Docs
            </a>
            <a href="#sandbox" style={{
              padding: '16px 32px', borderRadius: 9999,
              background: '#1e293b', color: '#fff', fontWeight: 700, fontSize: 15,
              border: '1px solid rgba(255,255,255,0.08)',
              textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8,
              transition: 'all 0.2s',
            }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
              onMouseLeave={e => e.currentTarget.style.background = '#1e293b'}>
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m10 8 6 4-6 4V8z"/></svg>
              Live Sandbox
            </a>
          </div>
        </div>
      </main>

      {/* ── Horizontal Poster Marquee ────────────────────── */}
      <div style={{
        padding: '40px 0', borderTop: '1px solid rgba(255,255,255,0.03)',
        borderBottom: '1px solid rgba(255,255,255,0.03)',
        background: 'rgba(15,23,42,0.3)', backdropFilter: 'blur(4px)',
        overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 24,
      }}>
        <MarqueeRow items={posters.row1} reverse={false} />
        <MarqueeRow items={posters.row2} reverse={true} />
      </div>
    </>
  )
}

function MarqueeRow({ items, reverse }) {
  if (!items.length) return <div style={{ height: 180 }} />
  // Duplicate many times for seamless loop
  const duped = Array(8).fill(items).flat()
  return (
    <div style={{
      display: 'flex', gap: 16, width: 'max-content',
      animation: `${reverse ? 'marquee-reverse' : 'marquee'} 40s linear infinite`,
    }}>
      {duped.map((item, i) => (
        <div key={i} style={{
          width: 160, aspectRatio: '2/3', flexShrink: 0,
          borderRadius: 12, overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.1)',
          position: 'relative', cursor: 'pointer',
        }}>
          <img src={TMDB_IMG + item.poster_path} alt={item.title || item.name || ''}
            loading="lazy"
            style={{
              width: '100%', height: '100%', objectFit: 'cover',
              transition: 'transform 0.5s',
            }}
            onMouseEnter={e => e.target.style.transform = 'scale(1.1)'}
            onMouseLeave={e => e.target.style.transform = 'scale(1)'}
          />
          {/* Hover overlay with play icon */}
          <div style={{
            position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)',
            opacity: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'opacity 0.3s',
          }}
            onMouseEnter={e => e.currentTarget.style.opacity = '1'}
            onMouseLeave={e => e.currentTarget.style.opacity = '0'}>
            <svg width="40" height="40" fill="none" stroke="#fb7185" strokeWidth="1.5" viewBox="0 0 24 24" style={{ filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.5))' }}>
              <circle cx="12" cy="12" r="10"/><path d="m10 8 6 4-6 4V8z"/>
            </svg>
          </div>
        </div>
      ))}
    </div>
  )
}
