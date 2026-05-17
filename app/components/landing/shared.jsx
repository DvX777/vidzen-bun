'use client'
import { useState, useEffect, useRef } from 'react'

export function useInView(threshold = 0.15) {
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

export function Reveal({ children, delay = 0, className = '' }) {
  const [ref, inView] = useInView(0.12)
  return (
    <div ref={ref} className={className} style={{
      opacity: inView ? 1 : 0,
      transform: inView ? 'none' : 'translateY(24px)',
      transition: `opacity 0.65s var(--ease-out) ${delay}ms, transform 0.65s var(--ease-out) ${delay}ms`
    }}>
      {children}
    </div>
  )
}

export function CopyBtn({ text }) {
  const [ok, setOk] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 2000) }}
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: ok ? '#4ade80' : 'var(--text-dim)', padding: '2px 6px', flexShrink: 0, fontSize: 14, transition: 'color 0.2s' }}>
      {ok ? '✓' : '⎘'}
    </button>
  )
}

export function CodeBlock({ code, accent = false }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      background: accent ? 'rgba(244,63,94,0.06)' : 'var(--bg-card)',
      border: `1px solid ${accent ? 'var(--accent-border)' : 'var(--border-default)'}`,
      borderRadius: 'var(--radius-sm)', padding: '10px 14px', marginTop: 8
    }}>
      <code style={{ fontSize: 12, color: accent ? 'var(--accent-light)' : 'var(--text-muted)', flex: 1, wordBreak: 'break-all', fontFamily: 'var(--font-mono)' }}>{code}</code>
      <CopyBtn text={code} />
    </div>
  )
}

export function WindowChrome({ children, title = '' }) {
  return (
    <div style={{
      background: 'var(--bg-code)', border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)', overflow: 'hidden',
      boxShadow: '0 24px 48px rgba(0,0,0,0.4)'
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '12px 16px', borderBottom: '1px solid var(--border-default)',
        background: 'rgba(255,255,255,0.02)'
      }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57' }} />
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#febc2e' }} />
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c840' }} />
        </div>
        {title && <span style={{ fontSize: 12, color: 'var(--text-dim)', marginLeft: 8, fontFamily: 'var(--font-mono)' }}>{title}</span>}
      </div>
      {children}
    </div>
  )
}
