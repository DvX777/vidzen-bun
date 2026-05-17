'use client'

export default function Docs() {
  return (
    <>
      {/* ── Documentation Section ──── bg-surface/50 ──── */}
      <section id="documentation" style={{
        padding: '96px 0', background: 'rgba(15,23,42,0.5)',
        borderTop: '1px solid rgba(255,255,255,0.03)',
      }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 24px' }}>
          <div style={{ textAlign: 'center', marginBottom: 64 }}>
            <h2 style={{ fontSize: 'clamp(28px, 5vw, 48px)', fontWeight: 700, marginBottom: 16 }}>
              Integrate in Seconds
            </h2>
            <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.5)', maxWidth: 640, margin: '0 auto' }}>
              No API keys required. Just drop our iframe snippet into your application.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 32, marginBottom: 48 }}>
            {/* Movie Card */}
            <GlassDocCard
              title="Embed a Movie"
              desc="Pass the TMDB Movie ID to instantly load the player."
              gradientFrom="rgba(244,63,94,0.05)"
              iconColor="#fb7185"
              code={<>
                <span style={{ color: '#fb7185' }}>&lt;iframe</span>{' '}
                <span style={{ color: '#fb7185' }}>src</span>=<span style={{ color: '#fb7185' }}>"https://vidzen.fun/embed/movie/533535"</span>{' '}
                <span style={{ color: '#fb7185' }}>frameborder</span>=<span style={{ color: '#fb7185' }}>"0"</span>{' '}
                <span style={{ color: '#fb7185' }}>allowfullscreen</span>
                <span style={{ color: '#fb7185' }}>&gt;&lt;/iframe&gt;</span>
              </>}
            />

            {/* TV Card */}
            <GlassDocCard
              title="Embed an Episode"
              desc="Pass the TMDB TV ID, Season Number, and Episode Number."
              gradientFrom="rgba(225,29,72,0.05)"
              iconColor="#e11d48"
              code={<>
                <span style={{ color: '#e11d48' }}>&lt;iframe</span>{' '}
                <span style={{ color: '#fb7185' }}>src</span>=<span style={{ color: '#fb7185' }}>"https://vidzen.fun/embed/tv/94997/1/1"</span>{' '}
                <span style={{ color: '#fb7185' }}>frameborder</span>=<span style={{ color: '#fb7185' }}>"0"</span>{' '}
                <span style={{ color: '#fb7185' }}>allowfullscreen</span>
                <span style={{ color: '#e11d48' }}>&gt;&lt;/iframe&gt;</span>
              </>}
            />
          </div>
        </div>
      </section>

      {/* ── PostMessage API Section ─────────────────────── */}
      <section id="events" style={{ padding: '96px 0', position: 'relative' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 24px' }}>
          <div style={{ textAlign: 'center', marginBottom: 64 }}>
            <h2 style={{ fontSize: 'clamp(28px, 5vw, 48px)', fontWeight: 700, marginBottom: 16 }}>
              PostMessage API
            </h2>
            <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.5)', maxWidth: 640, margin: '0 auto' }}>
              Control the player directly from your parent window using secure postMessage events.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 32 }}>
            {/* Sending Commands */}
            <div className="glass-card" style={{ padding: 32, borderRadius: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                <svg width="24" height="24" fill="none" stroke="#fb7185" strokeWidth="2" viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4 20-7z"/></svg>
                <h3 style={{ fontSize: 20, fontWeight: 700 }}>Sending Commands</h3>
              </div>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', marginBottom: 16 }}>Send JSON commands to the iframe window.</p>
              <div className="custom-scrollbar" style={{
                background: 'rgba(0,0,0,0.5)', padding: 16, borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.05)',
                fontFamily: 'var(--font-mono)', fontSize: 14, color: 'rgba(255,255,255,0.8)',
                marginBottom: 16, overflowX: 'auto',
              }}>
                iframe.contentWindow.postMessage(JSON.stringify({'{'}<br/>
                &nbsp;&nbsp;command: "play"<br/>
                {'}'}), "*");
              </div>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12, fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>
                {[
                  ['play', 'Resumes video playback'],
                  ['pause', 'Pauses video playback'],
                  ['seek', 'Seeks to specific second', 'time: number'],
                  ['volume', 'Sets volume level', 'level: 0-1'],
                  ['mute', 'Toggles mute', 'muted: boolean'],
                  ['getStatus', 'Retrieves current state'],
                ].map(([cmd, desc, param]) => (
                  <li key={cmd}>
                    <code style={{ color: '#fb7185' }}>{cmd}</code>
                    {param && <> + <code style={{ color: '#e11d48' }}>{param}</code></>}
                    : {desc}
                  </li>
                ))}
              </ul>
            </div>

            {/* Listening to Events */}
            <div className="glass-card" style={{ padding: 32, borderRadius: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                <svg width="24" height="24" fill="none" stroke="#e11d48" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 14.14 14.14"/></svg>
                <h3 style={{ fontSize: 20, fontWeight: 700 }}>Listening to Events</h3>
              </div>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', marginBottom: 16 }}>
                Listen for <code>message</code> events on the parent window to capture player status updates.
              </p>
              <div className="custom-scrollbar" style={{
                background: 'rgba(0,0,0,0.5)', padding: 16, borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.05)',
                fontFamily: 'var(--font-mono)', fontSize: 14, color: 'rgba(255,255,255,0.8)',
                marginBottom: 16, overflowX: 'auto',
              }}>
                window.addEventListener("message", (e) =&gt; {'{'}<br/>
                &nbsp;&nbsp;if(e.data.type === "PLAYER_EVENT") {'{'}<br/>
                &nbsp;&nbsp;&nbsp;&nbsp;console.log(e.data.data.event);<br/>
                &nbsp;&nbsp;{'}'}<br/>
                {'}'});
              </div>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12, fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>
                {['play', 'pause', 'timeupdate', 'ended', 'volumechange'].map(evt => (
                  <li key={evt}>
                    <code style={{ color: '#e11d48' }}>{evt}</code>: {evt === 'play' ? 'Video started playing' : evt === 'pause' ? 'Video paused' : evt === 'timeupdate' ? 'Current time changed' : evt === 'ended' ? 'Video reached the end' : 'Volume level updated'}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

function GlassDocCard({ title, desc, gradientFrom, iconColor, code }) {
  return (
    <div className="glass-card" style={{
      borderRadius: 32, overflow: 'hidden', display: 'flex', flexDirection: 'column',
      transition: 'border-color 0.3s',
    }}
      onMouseEnter={e => e.currentTarget.style.borderColor = `${iconColor}30`}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)'}>
      {/* Header with gradient */}
      <div style={{
        padding: 32, borderBottom: '1px solid rgba(255,255,255,0.05)',
        position: 'relative', overflow: 'hidden',
        background: `linear-gradient(135deg, ${gradientFrom}, transparent)`,
      }}>
        <h3 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, position: 'relative', zIndex: 1 }}>{title}</h3>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', position: 'relative', zIndex: 1 }}>{desc}</p>
      </div>
      {/* Code area */}
      <div style={{ padding: 24, background: '#020617', flex: 1 }}>
        <div style={{
          borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)',
          overflow: 'hidden', background: 'rgba(0,0,0,0.8)',
        }}>
          <div className="custom-scrollbar" style={{ padding: 16, overflowX: 'auto' }}>
            <code style={{
              fontSize: 13, fontFamily: 'var(--font-mono)',
              color: 'rgba(255,255,255,0.8)', whiteSpace: 'nowrap', display: 'block',
            }}>
              {code}
            </code>
          </div>
        </div>
      </div>
    </div>
  )
}
