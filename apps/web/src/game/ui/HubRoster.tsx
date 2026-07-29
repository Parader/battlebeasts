import { useEffect, useState } from "react";

type HubPlayer = {
  sessionId: string;
  displayName: string;
  isOwner: boolean;
};

type GrantAmounts = {
  essence: string;
  copper: string;
  silver: string;
  gold: string;
};

type Props = {
  players: HubPlayer[];
  localSessionId: string | null;
  /** True when local user owns this hub. */
  isHubOwner: boolean;
  /** True when server flagged this session as admin. */
  isAdmin: boolean;
  onKick: (sessionId: string) => void;
  onGrantResources: (
    sessionId: string,
    amounts: { essence: number; copper: number; silver: number; gold: number },
  ) => void;
};

type ContextMenu = {
  sessionId: string;
  displayName: string;
  x: number;
  y: number;
  canKick: boolean;
  canGrant: boolean;
};

/** Top-left hub presence list — owner kick / admin grant via right-click. */
export function HubRoster({
  players,
  localSessionId,
  isHubOwner,
  isAdmin,
  onKick,
  onGrantResources,
}: Props) {
  const [menu, setMenu] = useState<ContextMenu | null>(null);
  const [grantTarget, setGrantTarget] = useState<{
    sessionId: string;
    displayName: string;
  } | null>(null);
  const [amounts, setAmounts] = useState<GrantAmounts>({
    essence: "",
    copper: "",
    silver: "",
    gold: "",
  });

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
    <div className="bb-parchment pointer-events-auto relative mt-1 max-w-[12rem] px-3 py-2">
      <p className="bb-section-label mb-1.5">In hub</p>
      <ul className="space-y-1">
        {players.map((p) => {
          const isSelf = p.sessionId === localSessionId;
          const canKick = isHubOwner && !isSelf && !p.isOwner;
          const canGrant = isAdmin;
          const hasMenu = canKick || canGrant;
          return (
            <li key={p.sessionId}>
              <span
                className={[
                  "block truncate text-sm",
                  hasMenu
                    ? "cursor-context-menu text-[var(--bb-ink)]"
                    : "text-[var(--bb-ink-soft)]",
                ].join(" ")}
                title={hasMenu ? "Right-click for options" : undefined}
                onContextMenu={
                  hasMenu
                    ? (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setMenu({
                          sessionId: p.sessionId,
                          displayName: p.displayName,
                          x: e.clientX,
                          y: e.clientY,
                          canKick,
                          canGrant,
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
          {menu.canGrant ? (
            <button
              type="button"
              role="menuitem"
              className="bb-context-menu__item"
              onClick={() => {
                setGrantTarget({
                  sessionId: menu.sessionId,
                  displayName: menu.displayName,
                });
                setAmounts({ essence: "", copper: "", silver: "", gold: "" });
                setMenu(null);
              }}
            >
              Grant resources…
            </button>
          ) : null}
          {menu.canKick ? (
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
          ) : null}
        </div>
      ) : null}

      {grantTarget ? (
        <div
          className="bb-overlay-dim pointer-events-auto fixed inset-0 z-50 flex items-center justify-center p-4"
          onPointerDown={() => setGrantTarget(null)}
        >
          <div
            className="bb-parchment bb-book-panel w-full max-w-sm"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <header className="bb-panel-header">
              <h2 className="bb-panel-title">Grant resources</h2>
              <p className="bb-panel-sub">{grantTarget.displayName}</p>
            </header>
            <div className="grid grid-cols-2 gap-2 text-sm text-[var(--bb-ink)]">
              {(
                [
                  ["essence", "Essence"],
                  ["copper", "Copper"],
                  ["silver", "Silver"],
                  ["gold", "Gold"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex flex-col gap-1">
                  <span className="bb-section-label">{label}</span>
                  <input
                    type="number"
                    min={0}
                    className="bb-input"
                    value={amounts[key]}
                    onChange={(e) =>
                      setAmounts((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                  />
                </label>
              ))}
            </div>
            <footer className="bb-panel-footer justify-end gap-2">
              <button type="button" className="bb-btn-ink" onClick={() => setGrantTarget(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="bb-btn-brass"
                onClick={() => {
                  const parse = (s: string) => {
                    const n = Number(s);
                    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
                  };
                  onGrantResources(grantTarget.sessionId, {
                    essence: parse(amounts.essence),
                    copper: parse(amounts.copper),
                    silver: parse(amounts.silver),
                    gold: parse(amounts.gold),
                  });
                  setGrantTarget(null);
                }}
              >
                Grant
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
