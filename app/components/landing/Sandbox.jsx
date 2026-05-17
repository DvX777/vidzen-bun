'use client'
import { useState } from 'react'

export default function Sandbox() {
  const [mode, setMode] = useState('movie')
  const [tmdbId, setTmdbId] = useState('533535')
  const [season, setSeason] = useState('1')
  const [episode, setEpisode] = useState('1')
  const [playerUrl, setPlayerUrl] = useState('/embed/movie/533535')
  const [browserUrl, setBrowserUrl] = useState('https://vidzen.fun/embed/movie/533535')

  function load() {
    let url, display
    if (mode === 'movie') {
      url = `/embed/movie/${tmdbId}`
      display = `https://vidzen.fun/embed/movie/${tmdbId}`
    } else {
      url = `/embed/tv/${tmdbId}/${season}/${episode}`
      display = `https://vidzen.fun/embed/tv/${tmdbId}/${season}/${episode}`
    }
    setPlayerUrl(url)
    setBrowserUrl(display)
  }

  function setModeTo(m) {
    setMode(m)
    if (m === 'movie') setTmdbId('533535')
    else setTmdbId('94997')
  }

  return (
    <section id="sandbox" style={{
      padding: '96px 0',
      background: 'rgba(15,23,42,0.5)',
      borderTop: '1px solid rgba(255,255,255,0.03)',
      borderBottom: '1px solid rgba(255,255,255,0.03)',
      position: 'relative',
    }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <h2 style={{ fontSize: 'clamp(28px, 5vw, 48px)', fontWeight: 700, marginBottom: 16 }}>
            Interactive Sandbox
          </h2>
          <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.5)', maxWidth: 640, margin: '0 auto' }}>
            Test the player completely live.
          </p>
        </div>

        {/* Glass wrapper */}
        <div className="glass-card" style={{
          borderRadius: 32, padding: 24,
          display: 'flex', gap: 24, alignItems: 'flex-start',
        }}>
          {/* Left: Controls (w-80 = 320px) */}
          <div style={{
            width: 320, flexShrink: 0, alignSelf: 'flex-start',
            background: 'rgba(0,0,0,0.4)', borderRadius: 24,
            padding: 24, border: '1px solid rgba(255,255,255,0.05)',
            display: 'flex', flexDirection: 'column', gap: 24,
          }}>
            {/* Movie / TV Toggle */}
            <div style={{
              display: 'flex', padding: 4,
              background: 'rgba(255,255,255,0.03)', borderRadius: 16,
              border: '1px solid rgba(255,255,255,0.05)',
            }}>
              <button onClick={() => setModeTo('movie')} style={{
                flex: 1, padding: '8px 0', fontSize: 14, fontWeight: 700, borderRadius: 12,
                transition: 'all 0.2s',
                background: mode === 'movie' ? '#f43f5e' : 'transparent',
                color: mode === 'movie' ? '#fff' : 'rgba(255,255,255,0.5)',
                boxShadow: mode === 'movie' ? '0 0 15px rgba(244,63,94,0.3)' : 'none',
              }}>Movie</button>
              <button onClick={() => setModeTo('tv')} style={{
                flex: 1, padding: '8px 0', fontSize: 14, fontWeight: 700, borderRadius: 12,
                transition: 'all 0.2s',
                background: mode === 'tv' ? '#e11d48' : 'transparent',
                color: mode === 'tv' ? '#fff' : 'rgba(255,255,255,0.5)',
                boxShadow: mode === 'tv' ? '0 0 15px rgba(225,29,72,0.3)' : 'none',
              }}>TV Show</button>
            </div>

            {/* TMDB ID */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>TMDB ID</label>
              <input value={tmdbId} onChange={e => setTmdbId(e.target.value)} type="text" />
            </div>

            {/* Season / Episode (TV only) */}
            {mode === 'tv' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>Season</label>
                  <input value={season} onChange={e => setSeason(e.target.value)} type="number" min="1" />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.15em' }}>Episode</label>
                  <input value={episode} onChange={e => setEpisode(e.target.value)} type="number" min="1" />
                </div>
              </div>
            )}

            {/* Load Button */}
            <button onClick={load} style={{
              width: '100%', padding: '16px 0', borderRadius: 12,
              background: '#fff', color: '#000', fontWeight: 700, fontSize: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'transform 0.2s',
            }}
              onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
              onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
              <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m10 8 6 4-6 4V8z"/></svg>
              Load Player
            </button>
          </div>

          {/* Right: Player with macOS chrome */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div style={{
              borderRadius: 24, background: '#000',
              border: '1px solid rgba(255,255,255,0.05)',
              overflow: 'hidden', display: 'flex', flexDirection: 'column',
            }}>
              {/* macOS title bar */}
              <div style={{
                height: 40, background: '#1e1e1e',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                display: 'flex', alignItems: 'center', padding: '0 16px', gap: 8, flexShrink: 0,
              }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f56' }} />
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ffbd2e' }} />
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#27c93f' }} />
                <div style={{ marginLeft: 16, flex: 1, display: 'flex', justifyContent: 'center' }}>
                  <div style={{
                    padding: '4px 12px', background: 'rgba(0,0,0,0.3)', borderRadius: 4,
                    fontSize: 12, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.4)',
                    maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {browserUrl}
                  </div>
                </div>
              </div>

              {/* Player iframe */}
              <div style={{ width: '100%', position: 'relative', aspectRatio: '16/9', background: '#0a0a0c' }}>
                <iframe src={playerUrl} allowFullScreen title="VidZen Player"
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
