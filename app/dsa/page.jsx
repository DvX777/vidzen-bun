import Link from "next/link";

export const metadata = {
  title: "DSA & Copyright Compliance — VidZen",
  description:
    "Digital Services Act compliance, safe harbor status, and copyright takedown procedure for VidZen.",
};

export default function DSAPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#020617",
        color: "#fff",
        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
        padding: "0 0 80px",
      }}
    >
      {/* ── Header bar ─────────────────────────────────────────────────── */}
      <header
        style={{
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          padding: "18px 32px",
          display: "flex",
          alignItems: "center",
          gap: 14,
          background: "rgba(2,6,23,0.9)",
          backdropFilter: "blur(12px)",
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
      >
        <Link
          href="/"
          style={{
            color: "rgba(255,255,255,0.4)",
            textDecoration: "none",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            gap: 6,
            transition: "color 0.2s",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
          VidZen Home
        </Link>
        <span style={{ color: "rgba(255,255,255,0.15)", fontSize: 13 }}>›</span>
        <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 13 }}>DSA &amp; Copyright Compliance</span>
      </header>

      {/* ── Content ────────────────────────────────────────────────────── */}
      <main
        style={{
          maxWidth: 780,
          margin: "0 auto",
          padding: "60px 24px 0",
        }}
      >
        {/* Badge */}
        <div style={{ marginBottom: 16 }}>
          <span
            style={{
              background: "rgba(244,63,94,0.12)",
              border: "1px solid rgba(244,63,94,0.25)",
              color: "rgba(244,63,94,0.85)",
              borderRadius: 8,
              padding: "4px 12px",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            Legal &amp; Compliance
          </span>
        </div>

        <h1
          style={{
            fontSize: 34,
            fontWeight: 800,
            lineHeight: 1.2,
            marginBottom: 10,
            background: "linear-gradient(135deg, #fff 40%, rgba(244,63,94,0.8))",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Digital Services Act (DSA) &amp; Copyright Notice Policy
        </h1>
        <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 13, marginBottom: 52 }}>
          Last updated: 28 May 2026 · Effective immediately
        </p>

        <PolicySection number="1" title="Status as an Information Location Tool">
          <p>
            <strong>vidzen.fun</strong> operates strictly as an automated indexing directory and
            information location service. This platform does <strong>not</strong> host, store,
            upload, or transmit any video files, media content, or digital streams on its servers
            or infrastructure. All content is retrieved dynamically via automated user queries from
            external, third-party hosting networks over which vidzen.fun exercises no administrative
            control, ownership, or prior knowledge.
          </p>
        </PolicySection>

        <PolicySection number="2" title="Conditional Immunity (Safe Harbor)">
          <p>
            In accordance with <strong>Article 6 of the EU Digital Services Act (Regulation 2022/2065)</strong> and
            established CJEU jurisprudence, vidzen.fun maintains conditional immunity from liability
            for indexed third-party content, provided that it acts expeditiously to remove or disable
            access to specific links upon obtaining actual knowledge of infringement.
          </p>
        </PolicySection>

        <PolicySection number="3" title="Notice and Takedown Procedure">
          <p style={{ marginBottom: 18 }}>
            If you are a copyright owner or an authorized agent representing a rightsholder, and you
            believe that an automated link on our platform indexes unauthorized content, please submit
            a formal removal request.
          </p>
          <p style={{ marginBottom: 14, fontWeight: 600, color: "rgba(255,255,255,0.8)" }}>
            To be processed, your notice must include:
          </p>
          <ul
            style={{
              paddingLeft: 0,
              listStyle: "none",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              marginBottom: 24,
            }}
          >
            {[
              "The exact URL(s) on vidzen.fun that contain the indexing gateway (e.g., https://vidzen.fun/…).",
              "The original, authorized work being infringed for verification.",
              "Clear contact information of the reporting agent.",
            ].map((item, i) => (
              <li
                key={i}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                  color: "rgba(255,255,255,0.65)",
                  fontSize: 15,
                  lineHeight: 1.6,
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: "rgba(244,63,94,0.15)",
                    border: "1px solid rgba(244,63,94,0.3)",
                    color: "rgba(244,63,94,0.9)",
                    fontSize: 11,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginTop: 2,
                  }}
                >
                  {i + 1}
                </span>
                {item}
              </li>
            ))}
          </ul>
          <p style={{ color: "rgba(255,255,255,0.65)", fontSize: 15, lineHeight: 1.6, marginBottom: 20 }}>
            Please send all compliance and takedown notices directly to our designated agent at:
          </p>
          <div
            style={{
              background: "rgba(244,63,94,0.08)",
              border: "1px solid rgba(244,63,94,0.2)",
              borderRadius: 12,
              padding: "16px 22px",
              display: "inline-flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(244,63,94,0.8)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
              <polyline points="22,6 12,13 2,6"/>
            </svg>
            <a
              href="mailto:dev7alarafat@gmail.com"
              style={{
                color: "rgba(244,63,94,0.9)",
                textDecoration: "none",
                fontWeight: 700,
                fontSize: 15,
                letterSpacing: "0.01em",
              }}
            >
              dev7alarafat@gmail.com
            </a>
          </div>
          <p
            style={{
              color: "rgba(255,255,255,0.45)",
              fontSize: 14,
              lineHeight: 1.7,
              marginTop: 20,
            }}
          >
            Upon receipt of a valid, itemized notice, our technical team will <strong style={{ color: "rgba(255,255,255,0.65)" }}>expeditiously blacklist
            and remove</strong> the specified indexing endpoints from our directory system.
          </p>
        </PolicySection>

        {/* Divider */}
        <div
          style={{
            borderTop: "1px solid rgba(255,255,255,0.06)",
            marginTop: 56,
            paddingTop: 28,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <p style={{ color: "rgba(255,255,255,0.25)", fontSize: 12 }}>
            © 2026 VidZen. Operated under DSA Regulation 2022/2065.
          </p>
          <Link
            href="/"
            style={{
              color: "rgba(244,63,94,0.7)",
              textDecoration: "none",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            ← Back to VidZen
          </Link>
        </div>
      </main>
    </div>
  );
}

function PolicySection({ number, title, children }) {
  return (
    <section style={{ marginBottom: 44 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 16 }}>
        <span
          style={{
            flexShrink: 0,
            width: 32,
            height: 32,
            borderRadius: 10,
            background: "rgba(244,63,94,0.12)",
            border: "1px solid rgba(244,63,94,0.2)",
            color: "rgba(244,63,94,0.85)",
            fontSize: 13,
            fontWeight: 800,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginTop: 4,
          }}
        >
          {number}
        </span>
        <h2
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: "#fff",
            lineHeight: 1.3,
          }}
        >
          {title}
        </h2>
      </div>
      <div
        style={{
          paddingLeft: 46,
          color: "rgba(255,255,255,0.62)",
          fontSize: 15,
          lineHeight: 1.8,
        }}
      >
        {children}
      </div>
    </section>
  );
}
