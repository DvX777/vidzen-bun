"use client";

export default function ContentRemovedScreen() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
        color: "#fff",
        zIndex: 9999,
        gap: 20,
        padding: 24,
        textAlign: "center",
      }}
    >
      {/* Icon */}
      <div style={{ marginBottom: 8 }}>
        <svg
          width="72"
          height="72"
          viewBox="0 0 24 24"
          fill="none"
          stroke="rgba(244,63,94,0.9)"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <circle cx="12" cy="16" r="0.5" fill="rgba(244,63,94,0.9)" />
        </svg>
      </div>

      {/* Headline */}
      <h1
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: "#fff",
          lineHeight: 1.3,
          maxWidth: 420,
        }}
      >
        This content has been removed
      </h1>

      {/* Sub-text */}
      <p
        style={{
          fontSize: 14,
          color: "rgba(255,255,255,0.45)",
          maxWidth: 380,
          lineHeight: 1.7,
        }}
      >
        This title is no longer available due to a copyright compliance request.
        If you believe this is an error, please contact us at{" "}
        <a
          href="mailto:dev7alarafat@gmail.com"
          style={{ color: "rgba(244,63,94,0.8)", textDecoration: "none" }}
        >
          dev7alarafat@gmail.com
        </a>
        .
      </p>

      {/* DSA link */}
      <a
        href="/dsa"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          marginTop: 8,
          padding: "10px 24px",
          borderRadius: 10,
          background: "rgba(244,63,94,0.12)",
          border: "1px solid rgba(244,63,94,0.25)",
          color: "rgba(244,63,94,0.9)",
          fontSize: 13,
          fontWeight: 600,
          textDecoration: "none",
          transition: "background 0.2s",
          letterSpacing: "0.02em",
        }}
      >
        View our DSA & Copyright Policy
      </a>
    </div>
  );
}
