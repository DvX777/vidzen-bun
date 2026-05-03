'use client'
import { useState, useEffect, useRef, useCallback } from 'react'

const TMDB_KEY = '5b4bdc244af059756a769ed9666b8523'
const TMDB_IMG = 'https://image.tmdb.org/t/p/w342'

const FALLBACK = [
  { src: `${TMDB_IMG}/8cdWjvZQUExUUTzyp4t6EDMubfO.jpg`, title: 'Deadpool & Wolverine' },
  { src: `${TMDB_IMG}/kDp1vUBnMpe8ak4rjgl3cLELqjU.jpg`, title: 'Inception' },
  { src: `${TMDB_IMG}/qJ2tW6WMUDux911BTUgMe1nCoa.jpg`, title: 'Interstellar' },
  { src: `${TMDB_IMG}/1E5baAaEse26fej7uHcjOgEERB2.jpg`, title: 'Dune: Part Two' },
  { src: `${TMDB_IMG}/vpnVM9B6NMmQpWeZvzLvDESb2QY.jpg`, title: 'Inside Out 2' },
  { src: `${TMDB_IMG}/aosm8YFMuJCgUn8pBLVWmGRFkLB.jpg`, title: 'The Substance' },
  { src: `${TMDB_IMG}/yDHYTfA3R0jFYba16jBB1ef8oIt.jpg`, title: 'Oppenheimer' },
  { src: `${TMDB_IMG}/pB8BM7pdSp6B6Ih7QI4S2t0POhQ.jpg`, title: 'Gladiator II' },
  { src: `${TMDB_IMG}/8b8R8l88Qje9dn9OE8PY05Nez7H.jpg`, title: 'Barbie' },
  { src: `${TMDB_IMG}/b33nnKl1GSFbao4l3fZDDqsMx0F.jpg`, title: 'Wonka' },
  { src: `${TMDB_IMG}/xVMtv55caCEvBaV83LofTF4UIbg.jpg`, title: 'Avengers: Endgame' },
  { src: `${TMDB_IMG}/sv1xJUazXeYqALzczSZ3O6nkH75.jpg`, title: 'John Wick 4' },
]

async function loadPosters() {
  try {
    const [r1, r2] = await Promise.all([
      fetch(`https://api.themoviedb.org/3/trending/movie/week?api_key=${TMDB_KEY}`),
      fetch(`https://api.themoviedb.org/3/movie/now_playing?api_key=${TMDB_KEY}&page=1`),
    ])
    if (!r1.ok || !r2.ok) throw new Error()
    const [d1, d2] = await Promise.all([r1.json(), r2.json()])
    const trending = (d1.results || []).filter(x => x.poster_path).slice(0, 12).map(x => ({ src: TMDB_IMG + x.poster_path, title: x.title || x.name }))
    const playing  = (d2.results || []).filter(x => x.poster_path).slice(0, 12).map(x => ({ src: TMDB_IMG + x.poster_path, title: x.title }))
    return { col1: trending.slice(0,6), col2: playing.slice(0,6), col3: trending.slice(6,12) }
  } catch {
    return { col1: FALLBACK.slice(0,6), col2: FALLBACK.slice(6,12), col3: FALLBACK.slice(3,9) }
  }
}

function useInView(threshold = 0.15) {
  const ref = useRef(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setInView(true); obs.disconnect() } }, { threshold })
    obs.observe(el)
    return () => obs.disconnect()
  }, [threshold])
  return [ref, inView]
}

function Reveal({ children, delay = 0 }) {
  const [ref, inView] = useInView(0.12)
  return (
    <div ref={ref} style={{ opacity: inView ? 1 : 0, transform: inView ? 'none' : 'translateY(28px)', transition: `opacity 0.65s cubic-bezier(.16,1,.3,1) ${delay}ms, transform 0.65s cubic-bezier(.16,1,.3,1) ${delay}ms` }}>
      {children}
    </div>
  )
}

function MarqueeCol({ items, reverse, speed = 24 }) {
  if (!items.length) return null
  const doubled = [...items, ...items]
  return (
    <div style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 12, flex: '0 0 160px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, animation: `marqueeY ${speed}s linear infinite`, animationDirection: reverse ? 'reverse' : 'normal' }}>
        {doubled.map((item, i) => (
          <div key={i} style={{ width: 160, height: 230, borderRadius: 10, overflow: 'hidden', flexShrink: 0, background: '#111' }}>
            {item.src && <img src={item.src} alt={item.title || ''} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
          </div>
        ))}
      </div>
    </div>
  )
}

function CopyBtn({ text }) {
  const [ok, setOk] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 2000) }}
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: ok ? '#4ade80' : 'rgba(255,255,255,0.3)', padding: '2px 6px', flexShrink: 0 }}>
      {ok ? '✓' : '⎘'}
    </button>
  )
}

function CodeRow({ code, accent }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: accent ? 'rgba(236,72,153,0.06)' : 'rgba(255,255,255,0.03)', border: `1px solid ${accent ? 'rgba(236,72,153,0.15)' : 'rgba(255,255,255,0.06)'}`, borderRadius: 8, padding: '10px 14px', marginTop: 8 }}>
      <code style={{ fontSize: 12, color: accent ? '#f472b6' : 'rgba(255,255,255,0.6)', flex: 1, wordBreak: 'break-all', fontFamily: 'monospace' }}>{code}</code>
      <CopyBtn text={code} />
    </div>
  )
}

export default function HomePage() {
  const [posters, setPosters]   = useState({ col1: [], col2: [], col3: [] })
  const [tab,     setTab]       = useState('movie')
  const [id,      setId]        = useState('')
  const [sea,     setSea]       = useState('')
  const [ep,      setEp]        = useState('')
  const [loadedUrl, setLoadedUrl] = useState('/embed/movie/666243')
  const [scrolled, setScrolled]  = useState(false)

  useEffect(() => { loadPosters().then(setPosters) }, [])
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', fn, { passive: true })
    return () => window.removeEventListener('scroll', fn)
  }, [])

  const dId  = id  || '666243'
  const dSea = sea || '1'
  const dEp  = ep  || '1'
  const embedUrl = tab === 'movie' ? `/embed/movie/${dId}` : `/embed/tv/${dId}/${dSea}/${dEp}`
  const fullEmbed = `https://vidzen.fun${embedUrl}`

  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.08) transparent; }
        body { background: #050507; color: #e4e4e7; font-family: 'Inter', system-ui, sans-serif; -webkit-font-smoothing: antialiased; overflow-x: hidden; }
        ::selection { background: rgba(236,72,153,0.25); }
        input { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; color: #e4e4e7; font-family: inherit; font-size: 15px; padding: 12px 16px; width: 100%; outline: none; transition: border-color 0.2s; }
        input:focus { border-color: rgba(236,72,153,0.4); }
        input::placeholder { color: rgba(255,255,255,0.2); }
        button { font-family: inherit; cursor: pointer; }
        @keyframes marqueeY { from { transform: translateY(0); } to { transform: translateY(-50%); } }
        @keyframes glowPulse { 0%,100% { opacity:0.4; transform:scale(1); } 50% { opacity:1; transform:scale(1.1); } }
        @keyframes dotPulse { 0%,100% { opacity:0.4; } 50% { opacity:1; box-shadow:0 0 8px #ec4899; } }
        @keyframes heroIn { from { opacity:0; transform:translateY(24px); } to { opacity:1; transform:none; } }
      `}</style>

      {/* NAVBAR */}
      <nav style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, padding: scrolled ? '6px 20px' : '12px 20px', transition: 'padding 0.3s' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px', background: scrolled ? 'rgba(5,5,7,0.88)' : 'rgba(5,5,7,0.55)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, transition: 'all 0.3s', boxShadow: scrolled ? '0 8px 32px rgba(0,0,0,0.4)' : 'none' }}>
          <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: '0.12em', color: '#fff' }}>VID<span style={{ color: '#ec4899' }}>Z</span>EN</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => scrollTo('docs')} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: 500, padding: '8px 14px', borderRadius: 10, transition: 'all 0.2s' }}
              onMouseEnter={e => { e.target.style.color='#fff'; e.target.style.background='rgba(255,255,255,0.06)'; }} onMouseLeave={e => { e.target.style.color='rgba(255,255,255,0.5)'; e.target.style.background='none'; }}>
              Documentation
            </button>
            <button onClick={() => scrollTo('player')} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(236,72,153,0.12)', border: '1px solid rgba(236,72,153,0.2)', color: '#ec4899', fontSize: 13, fontWeight: 500, padding: '8px 16px', borderRadius: 10, transition: 'all 0.2s' }}
              onMouseEnter={e => e.currentTarget.style.background='rgba(236,72,153,0.22)'} onMouseLeave={e => e.currentTarget.style.background='rgba(236,72,153,0.12)'}>
              <svg width="13" height="13" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              Test Player
            </button>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section style={{ position: 'relative', minHeight: '100vh', display: 'flex', alignItems: 'center', overflow: 'hidden', paddingTop: 80 }}>
        {/* grid bg */}
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.025) 1px,transparent 1px)', backgroundSize: '60px 60px', maskImage: 'radial-gradient(ellipse 70% 60% at 50% 50%,black 20%,transparent 80%)', WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 50%,black 20%,transparent 80%)' }} />
        <div style={{ position: 'absolute', width: 500, height: 500, background: 'rgba(236,72,153,0.07)', borderRadius: '50%', filter: 'blur(100px)', top: '5%', left: '2%', animation: 'glowPulse 8s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', width: 400, height: 400, background: 'rgba(139,92,246,0.06)', borderRadius: '50%', filter: 'blur(100px)', bottom: '10%', right: '8%', animation: 'glowPulse 8s ease-in-out infinite 4s' }} />

        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 60, padding: '40px 24px', width: '100%', position: 'relative', zIndex: 1 }}>
          {/* Text side */}
          <div style={{ flex: '0 0 auto', maxWidth: 500, animation: 'heroIn 0.9s cubic-bezier(.16,1,.3,1) both' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 16px', borderRadius: 999, background: 'rgba(236,72,153,0.08)', border: '1px solid rgba(236,72,153,0.15)', fontSize: 12, fontWeight: 500, color: '#f472b6', letterSpacing: '0.04em', marginBottom: 24 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ec4899', animation: 'dotPulse 2s ease-in-out infinite' }} />
              Next Generation Streaming API
            </div>
            <h1 style={{ fontSize: 'clamp(48px,8vw,80px)', fontWeight: 900, letterSpacing: '0.08em', lineHeight: 1, marginBottom: 16, background: 'linear-gradient(135deg,#fff 40%,#71717a)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              VID<span style={{ WebkitTextFillColor: '#ec4899' }}>Z</span>EN
            </h1>
            <p style={{ fontSize: 16, lineHeight: 1.7, color: 'rgba(255,255,255,0.42)', marginBottom: 32, maxWidth: 420 }}>
              The <em style={{ color: 'rgba(255,255,255,0.7)', fontStyle: 'normal', fontWeight: 500 }}>most powerful</em> streaming embed you could ever dream of. Lightning-fast, multi-provider, fully embeddable.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
              {[['115K+', 'Movies'], ['79K+', 'Episodes'], ['3', 'Providers']].map(([n, l]) => (
                <div key={l} style={{ padding: '12px 22px', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
                  <span style={{ display: 'block', fontSize: 22, fontWeight: 800, color: '#fff' }}>{n}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>{l}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
              <button onClick={() => scrollTo('player')} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#ec4899', color: '#fff', border: 'none', borderRadius: 12, padding: '13px 28px', fontSize: 14, fontWeight: 700, letterSpacing: '0.04em', transition: 'all 0.2s' }}
                onMouseEnter={e => e.currentTarget.style.background='#db2777'} onMouseLeave={e => e.currentTarget.style.background='#ec4899'}>
                GET STARTED
                <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14m-7-7 7 7-7 7"/></svg>
              </button>
              <button onClick={() => scrollTo('docs')} style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '13px 24px', fontSize: 14, fontWeight: 500, transition: 'all 0.2s' }}
                onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,0.09)'} onMouseLeave={e => e.currentTarget.style.background='rgba(255,255,255,0.05)'}>
                Documentation
              </button>
            </div>
            <a href="https://discord.gg/SsXwShdtFc" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,0.35)', fontSize: 13, textDecoration: 'none', transition: 'color 0.2s' }}
              onMouseEnter={e => e.currentTarget.style.color='rgba(255,255,255,0.65)'} onMouseLeave={e => e.currentTarget.style.color='rgba(255,255,255,0.35)'}>
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m15 10-4 4 6 6 4-16-18 7 4 2 2 6 3-4"/></svg>
              Join our Discord
            </a>
          </div>

          {/* Marquee posters */}
          <div style={{ flex: 1, display: 'flex', gap: 12, height: 560, position: 'relative', overflow: 'hidden', maskImage: 'linear-gradient(to bottom,transparent,black 15%,black 85%,transparent)', WebkitMaskImage: 'linear-gradient(to bottom,transparent,black 15%,black 85%,transparent)' }}>
            <MarqueeCol items={posters.col1} reverse={false} speed={26} />
            <MarqueeCol items={posters.col2} reverse={true}  speed={30} />
            <MarqueeCol items={posters.col3} reverse={false} speed={22} />
          </div>
        </div>
      </section>

      {/* PLAYER SECTION */}
      <section id="player" style={{ maxWidth: 900, margin: '0 auto', padding: '80px 24px' }}>
        <Reveal>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <h2 style={{ fontSize: 'clamp(28px,4vw,42px)', fontWeight: 800, color: '#fff', marginBottom: 12 }}>Test the Player</h2>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 15 }}>Enter any TMDB ID to preview the embed instantly</p>
          </div>
        </Reveal>
        <Reveal delay={80}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, background: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 4, width: 'fit-content' }}>
            {['movie', 'series'].map(t => (
              <button key={t} onClick={() => setTab(t === 'series' ? 'tv' : 'movie')} style={{ padding: '8px 22px', borderRadius: 9, border: 'none', fontWeight: 600, fontSize: 13, letterSpacing: '0.05em', transition: 'all 0.2s', background: (t === 'series' ? tab === 'tv' : tab === 'movie') ? '#ec4899' : 'transparent', color: (t === 'series' ? tab === 'tv' : tab === 'movie') ? '#fff' : 'rgba(255,255,255,0.4)' }}>
                {t.toUpperCase()}
              </button>
            ))}
          </div>
        </Reveal>
        <Reveal delay={120}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <input value={id} onChange={e => setId(e.target.value)} placeholder={tab === 'movie' ? 'Movie TMDB ID (e.g. 666243)' : 'Show TMDB ID (e.g. 94997)'} style={{ flex: 2, minWidth: 200 }} />
            {tab === 'tv' && <>
              <input value={sea} onChange={e => setSea(e.target.value)} placeholder="Season" style={{ flex: '0 0 100px' }} />
              <input value={ep}  onChange={e => setEp(e.target.value)}  placeholder="Episode" style={{ flex: '0 0 100px' }} />
            </>}
          </div>
        </Reveal>
        <Reveal delay={160}>
          <button onClick={() => setLoadedUrl(embedUrl)} style={{ width: '100%', background: '#ec4899', color: '#fff', border: 'none', borderRadius: 12, padding: '14px', fontSize: 15, fontWeight: 700, letterSpacing: '0.04em', marginBottom: 24, transition: 'background 0.2s' }}
            onMouseEnter={e => e.target.style.background='#db2777'} onMouseLeave={e => e.target.style.background='#ec4899'}>
            LOAD {tab === 'movie' ? 'MOVIE' : 'EPISODE'}
          </button>
        </Reveal>
        <Reveal delay={200}>
          <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', background: '#000', boxShadow: '0 0 0 1px rgba(255,255,255,0.07), 0 32px 64px rgba(0,0,0,0.6)' }}>
            <div style={{ position: 'absolute', inset: -1, borderRadius: 17, background: 'linear-gradient(135deg,rgba(236,72,153,0.2),transparent 60%)', pointerEvents: 'none', zIndex: 0 }} />
            <div style={{ aspectRatio: '16/9' }}>
              <iframe src={loadedUrl} allowFullScreen title="VidZen Player" style={{ width: '100%', height: '100%', border: 'none', display: 'block' }} />
            </div>
          </div>
        </Reveal>
      </section>

      {/* DOCS */}
      <section id="docs" style={{ maxWidth: 1100, margin: '0 auto', padding: '80px 24px' }}>
        <Reveal>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <h2 style={{ fontSize: 'clamp(28px,4vw,42px)', fontWeight: 800, color: '#fff', marginBottom: 12 }}>API Documentation</h2>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 15 }}>Integrate VidZen in seconds with simple embed URLs</p>
          </div>
        </Reveal>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 20 }}>
          {[
            { badge: 'Movie', color: '#ec4899', title: 'Embed Movie', desc: 'Use the TMDB movie ID to embed any film.', endpoint: 'https://vidzen.fun/embed/movie/[TMDB_ID]', example: '<iframe src="https://vidzen.fun/embed/movie/666243" frameBorder="0" allowFullScreen></iframe>' },
            { badge: 'TV', color: '#8b5cf6', title: 'Embed TV Show', desc: 'Specify TMDB ID, season, and episode number.', endpoint: 'https://vidzen.fun/embed/tv/[TMDB_ID]/[SEASON]/[EPISODE]', example: '<iframe src="https://vidzen.fun/embed/tv/94997/1/1" frameBorder="0" allowFullScreen></iframe>' },
          ].map((doc, i) => (
            <Reveal key={i} delay={i * 80}>
              <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: 28 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                  <span style={{ background: doc.color + '18', color: doc.color, fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6, letterSpacing: '0.06em' }}>{doc.badge}</span>
                  <h3 style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>{doc.title}</h3>
                </div>
                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, marginBottom: 16 }}>{doc.desc}</p>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Endpoint</div>
                <CodeRow code={doc.endpoint} />
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, marginTop: 16 }}>Code Example</div>
                <CodeRow code={doc.example} accent />
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '32px 24px', textAlign: 'center' }}>
        <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: '0.12em', color: '#fff' }}>VID<span style={{ color: '#ec4899' }}>Z</span>EN</span>
        <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 13, marginTop: 8 }}>© 2026 VidZen. All rights reserved.</p>
        <a href="https://discord.gg/SsXwShdtFc" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', color: 'rgba(255,255,255,0.3)', fontSize: 13, textDecoration: 'none', marginTop: 12 }}>Discord</a>
      </footer>
    </>
  )
}
