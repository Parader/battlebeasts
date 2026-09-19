export function App() {
  const play =
    (typeof window !== "undefined" &&
      (import.meta.env.VITE_PLAY_URL as string | undefined)) ||
    "http://localhost:5173/play?lab=1";

  return (
    <div
      style={{
        minHeight: "100%",
        display: "grid",
        placeItems: "center",
        padding: 32,
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        background: "#12151a",
        color: "#dbe2ec",
      }}
    >
      <div style={{ maxWidth: 440, lineHeight: 1.5 }}>
        <h1 style={{ fontSize: 22, margin: "0 0 12px" }}>Spell lab moved</h1>
        <p style={{ margin: "0 0 16px", color: "#8b97a8" }}>
          Spells with travel, pulls, and channels need the live game — cast bar,
          aim preview, and real keybinds. Open play with the lab flag (admin
          account).
        </p>
        <a
          href={play}
          style={{
            display: "inline-block",
            padding: "8px 14px",
            borderRadius: 6,
            background: "#6aa9ff",
            color: "#0b1220",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Open spell lab in game
        </a>
      </div>
    </div>
  );
}
