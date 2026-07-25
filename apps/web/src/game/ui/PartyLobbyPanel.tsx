import { useEffect, useState } from "react";
import type { PartySnapshot, PvpSeat } from "@battlebeasts/shared";

type HubPlayer = {
  sessionId: string;
  displayName: string;
};

type Props = {
  party: PartySnapshot;
  localSessionId: string | null;
  hubPlayers: HubPlayer[];
  onInvite: (sessionId: string) => void;
  onSetSeat: (sessionId: string, seat: PvpSeat) => void;
  onKick: (sessionId: string) => void;
  onLock: () => void;
  onCancel: () => void;
  onLeave: () => void;
  onClose: () => void;
};

const SEATS: { id: PvpSeat; label: string }[] = [
  { id: "teamA", label: "Team A" },
  { id: "teamB", label: "Team B" },
  { id: "spectator", label: "Spectators" },
];

type ContextMenu = {
  sessionId: string;
  displayName: string;
  x: number;
  y: number;
};

/** Party lobby: seats, invites, lock to queue. */
export function PartyLobbyPanel({
  party,
  localSessionId,
  hubPlayers,
  onInvite,
  onSetSeat,
  onKick,
  onLock,
  onCancel,
  onLeave,
  onClose,
}: Props) {
  const isLeader = party.leaderSessionId === localSessionId;
  const memberIds = new Set(party.members.map((m) => m.sessionId));
  const inviteable = hubPlayers.filter(
    (p) => p.sessionId !== localSessionId && !memberIds.has(p.sessionId),
  );
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

  return (
    <div
      className="bb-overlay-dim fixed inset-0 z-40 flex items-center justify-center p-4"
      data-ui-overlay
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal
        aria-label="Party lobby"
        className="bb-parchment bb-book-panel relative z-10 w-full max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="bb-title text-lg">Arena lobby</h2>
            <p className="mt-1 text-xs text-[var(--bb-ink-soft)]">
              {party.modes.join(" · ") || "PvP"}
              {party.queued ? " · queued" : ""}
            </p>
          </div>
          <button type="button" className="bb-btn-ink !px-2 !py-1 text-[10px]" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="bb-brass-rule mb-4" />

        <div className="grid gap-3 sm:grid-cols-3">
          {SEATS.map((seat) => {
            const seated = party.members.filter((m) => m.seat === seat.id);
            return (
              <div key={seat.id} className="rounded border border-[var(--bb-brass)]/25 p-2">
                <p className="bb-title mb-2 text-[0.65rem] tracking-wider text-[var(--bb-brass)]">
                  {seat.label}
                </p>
                <ul className="min-h-[4.5rem] space-y-1">
                  {seated.length === 0 ? (
                    <li className="text-[0.7rem] text-[var(--bb-ink-soft)]">Empty</li>
                  ) : (
                    seated.map((m) => {
                      const canMove =
                        !party.queued &&
                        (isLeader || m.sessionId === localSessionId);
                      const canKick =
                        isLeader &&
                        !party.queued &&
                        m.sessionId !== localSessionId &&
                        m.sessionId !== party.leaderSessionId;
                      return (
                        <li key={m.sessionId} className="text-[0.75rem] text-[var(--bb-ink)]">
                          <div className="flex items-center justify-between gap-1">
                            <span
                              className={[
                                "truncate",
                                canKick ? "cursor-context-menu" : "",
                              ].join(" ")}
                              title={canKick ? "Right-click for options" : undefined}
                              onContextMenu={
                                canKick
                                  ? (e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setMenu({
                                        sessionId: m.sessionId,
                                        displayName: m.displayName,
                                        x: e.clientX,
                                        y: e.clientY,
                                      });
                                    }
                                  : undefined
                              }
                            >
                              {m.displayName}
                              {m.sessionId === party.leaderSessionId ? " ★" : ""}
                              {m.sessionId === localSessionId ? " (you)" : ""}
                            </span>
                          </div>
                          {canMove ? (
                            <div className="mt-0.5 flex flex-wrap gap-1">
                              {SEATS.filter((s) => s.id !== seat.id).map((s) => (
                                <button
                                  key={s.id}
                                  type="button"
                                  className="bb-btn-ink !px-1.5 !py-0.5 text-[0.55rem]"
                                  onClick={() => onSetSeat(m.sessionId, s.id)}
                                >
                                  → {s.label.replace("Spectators", "Spec")}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </li>
                      );
                    })
                  )}
                </ul>
              </div>
            );
          })}
        </div>

        {isLeader && !party.queued ? (
          <div className="mt-4">
            <p className="bb-title mb-1 text-[0.6rem] tracking-wider text-[var(--bb-brass)]">
              Invite from hub
            </p>
            {inviteable.length === 0 ? (
              <p className="text-xs text-[var(--bb-ink-soft)]">No other hunters in this hub.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {inviteable.map((p) => {
                  const pending = party.pendingInvites.includes(p.sessionId);
                  return (
                    <li key={p.sessionId}>
                      <button
                        type="button"
                        className="bb-btn-ink text-[0.7rem] disabled:opacity-50"
                        disabled={pending}
                        onClick={() => onInvite(p.sessionId)}
                      >
                        {pending ? `Invited ${p.displayName}` : `Invite ${p.displayName}`}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {isLeader ? (
            <>
              {!party.queued ? (
                <button type="button" className="bb-btn-brass" onClick={onLock}>
                  Lock &amp; queue
                </button>
              ) : null}
              <button type="button" className="bb-btn-ink" onClick={onCancel}>
                Cancel party
              </button>
            </>
          ) : (
            <button type="button" className="bb-btn-ink" onClick={onLeave}>
              Leave party
            </button>
          )}
        </div>
      </div>

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
