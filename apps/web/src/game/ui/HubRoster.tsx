import { useEffect, useState } from "react";

type HubPlayer = {
  sessionId: string;
  displayName: string;
  isOwner: boolean;
};

type Props = {
  players: HubPlayer[];
  localSessionId: string | null;
  /** True when local user owns this hub. */
  isHubOwner: boolean;
  onKick: (sessionId: string) => void;
};

type ContextMenu = {
  sessionId: string;
  displayName: string;
  x: number;
  y: number;
};

/** Top-left hub presence list — owner right-clicks a name to kick. */
export function HubRoster({ players, localSessionId, isHubOwner, onKick }: Props) {
  const [menu, setMenu] = useState<ContextMenu | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  if (players.length === 0) return null;

  return (
    <div className="bb-parchment pointer-events-auto relative mt-1 max-w-[11rem] px-2 py-1.5">
      <p className="bb-title mb-1 text-[0.55rem] tracking-wider text-[var(--bb-brass)]">In hub</p>
      <ul className="space-y-0.5">
        {players.map((p) => {
          const isSelf = p.sessionId === localSessionId;
          const canKick = isHubOwner && !isSelf && !p.isOwner;
          return (
            <li key={p.sessionId}>
              <span
                className={[
                  "block truncate text-[0.7rem]",
                  canKick
                    ? "cursor-context-menu text-[var(--bb-ink)]"
                    : "text-[var(--bb-ink-soft)]",
                ].join(" ")}
                title={canKick ? "Right-click for options" : undefined}
                onContextMenu={
                  canKick
                    ? (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setMenu({
                          sessionId: p.sessionId,
                          displayName: p.displayName,
                          x: e.clientX,
                          y: e.clientY,
                        });
                      }
                    : undefined
                }
              >
                {p.displayName}
                {p.isOwner ? " ★" : ""}
                {isSelf ? " (you)" : ""}
              </span>
            </li>
          );
        })}
      </ul>

      {menu ? (
        <div
          className="bb-context-menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className="bb-context-menu__item bb-context-menu__item--danger"
            onClick={() => {
              onKick(menu.sessionId);
              setMenu(null);
            }}
          >
            Kick {menu.displayName} from lobby
          </button>
        </div>
      ) : null}
    </div>
  );
}
