type WaveHud = {
  wave: number;
  phase: string;
  alive: number;
  goal: number;
};

type Props = {
  hud: WaveHud | null;
  paused: boolean;
  onTogglePause: () => void;
  onReturnHub: () => void;
};

/** Minimal Wave Assault overlay — wave count + pause / leave. */
export function WaveAssaultHud({ hud, paused, onTogglePause, onReturnHub }: Props) {
  return (
    <div
      data-ui-overlay
      className="pointer-events-none absolute inset-x-0 top-0 z-40 flex flex-col items-center gap-2 px-3 pt-3"
    >
      <div className="bb-panel pointer-events-auto flex items-center gap-3 px-3 py-2">
        <span className="text-sm font-semibold text-[var(--bb-ink)]" style={{ fontFamily: "var(--bb-font-display)" }}>
          {hud && hud.wave > 0 ? `Wave ${hud.wave}` : "Wave Assault"}
        </span>
        {hud && hud.phase === "fighting" ? (
          <span className="bb-meta tabular-nums">
            {hud.alive}/{hud.goal}
          </span>
        ) : null}
        {hud && hud.phase === "clear" ? <span className="bb-meta">Wave clear…</span> : null}
        {hud && hud.phase === "intro" ? <span className="bb-meta">Get ready…</span> : null}
        {paused ? <span className="text-sm text-[var(--bb-brass)]">Paused</span> : null}
        <button type="button" className="bb-btn-ink" onClick={onTogglePause}>
          {paused ? "Resume" : "Pause"}
        </button>
        <button type="button" className="bb-btn-ink" onClick={onReturnHub}>
          Leave
        </button>
      </div>
    </div>
  );
}
