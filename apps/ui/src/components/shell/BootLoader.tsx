/**
 * Full-screen splash shown while the daemon store completes its first
 * fetch. Uses the canonical Zen Dots brandmark; gentle pulse so the
 * surface reads as deliberate rather than washed out.
 */
export default function BootLoader() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        minHeight: "100vh",
        background: "var(--color-bg-base, #ffffff)",
      }}
    >
      <span
        style={{
          fontFamily: "'Zen Dots', system-ui, sans-serif",
          fontSize: 48,
          fontWeight: 400,
          letterSpacing: "0.04em",
          color: "var(--color-text-primary, #0a0a0b)",
          animation: "ae-pulse 1.6s ease-in-out infinite",
          lineHeight: 1,
        }}
      >
        aeqi
      </span>
      <style>{`
        @keyframes ae-pulse {
          0%, 100% { opacity: 0.55; }
          50%      { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
