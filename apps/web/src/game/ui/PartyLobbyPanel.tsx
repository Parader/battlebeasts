import { useEffect, useMemo, useState, type MouseEvent } from "react";
import {
  PVP_MODES,
  type PartyMemberSnapshot,
  type PartySnapshot,
  type PvpSeat,
} from "@battlebeasts/shared";

type HubPlayer = {
  sessionId: string;
  userId?: string;
  displayName: string;
};

export type PartyFriendInviteRow = {
  id: string;
  displayName: string;
  online: boolean;
};

type Props = {
  party: PartySnapshot;
  localSessionId: string | null;
  hubPlayers: HubPlayer[];
  friends: PartyFriendInviteRow[];
  /** Hub invite + mark pending party join (remote friends). */
  onInviteFriend: (friendUserId: string) => void;
  onSetSeat: (sessionId: string, seat: PvpSeat) => void;
  onKick: (sessionId: string) => void;
  onLock: (matchKind?: "ranked" | "unranked") => void;
  onCancel: () => void;
  onLeave: () => void;
  onClose: () => void;
};

type ContextMenu = {
  sessionId: string;
  displayName: string;
  x: number;
  y: number;
};

function modeMeta(modes: string[]) {
  let teamSize = 1;
  let maxSpectators = 2;
  for (const id of modes) {
    const m = PVP_MODES.find((x) => x.id === id);
    if (!m) continue;
    teamSize = Math.max(teamSize, m.teamSize);
    maxSpectators = Math.max(maxSpectators, m.maxSpectators);
  }
  return { teamSize, maxSpectators };
}

function padSlots(
  seated: PartyMemberSnapshot[],
  capacity: number,
): Array<PartyMemberSnapshot | null> {
  const slots: Array<PartyMemberSnapshot | null> = [...seated];
  while (slots.length < capacity) slots.push(null);
  return slots.slice(0, capacity);
}

function PlayerSlot({
  member,
  isLeader,
  isYou,
  canTake,
  canKick,
  onTake,
  onOpenKickMenu,
}: {
  member: PartyMemberSnapshot | null;
  isLeader: boolean;
  isYou: boolean;
  canTake: boolean;
  canKick: boolean;
  onTake: () => void;
  onOpenKickMenu: (e: MouseEvent, m: PartyMemberSnapshot) => void;
}) {
  if (!member) {
    return (
      <button
        type="button"
        className="bb-lobby-slot bb-lobby-slot--empty"
        disabled={!canTake}
        onClick={onTake}
      >
        {canTake ? "Take Slot" : "Empty"}
      </button>
    );
  }

  return (
    <div
      className={[
        "bb-lobby-slot bb-lobby-slot--filled",
        isYou ? "bb-lobby-slot--you" : "",
        canKick ? "bb-lobby-slot--kickable" : "",
      ].join(" ")}
      title={canKick ? "Right-click to kick" : undefined}
      onContextMenu={
        canKick
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              onOpenKickMenu(e, member);
            }
          : undefined
      }
    >
      <span className="bb-lobby-slot__avatar" aria-hidden>
        {member.displayName.slice(0, 1).toUpperCase()}
      </span>
      <div className="bb-lobby-slot__meta">
        <div className="bb-lobby-slot__name-row">
          {isLeader ? <span className="bb-lobby-slot__crown" title="Party leader">♛</span> : null}
          <span className="bb-lobby-slot__name">{member.displayName}</span>
          {isYou ? <span className="bb-lobby-slot__you">You</span> : null}
        </div>
      </div>
    </div>
  );
}

/** PvP arena lobby — team columns, observer bench, game-style controls. */
export function PartyLobbyPanel({
  party,
  localSessionId,
  hubPlayers,
  friends,
  onInviteFriend,
  onSetSeat,
  onKick,
  onLock,
  onCancel,
  onLeave,
  onClose,
}: Props) {
  const isLeader = party.leaderSessionId === localSessionId;
  const memberUserIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of party.members) {
      if (m.userId) ids.add(m.userId);
    }
    for (const h of hubPlayers) {
      if (!h.userId) continue;
      if (party.members.some((m) => m.sessionId === h.sessionId)) ids.add(h.userId);
    }
    return ids;
  }, [party.members, hubPlayers]);
  const pendingFriends = new Set(party.pendingFriendInvites ?? []);
  const inviteableFriends = friends.filter((f) => !memberUserIds.has(f.id));
  const [menu, setMenu] = useState<ContextMenu | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const { teamSize, maxSpectators } = useMemo(() => modeMeta(party.modes), [party.modes]);
  const teamAFilled = party.members.filter((m) => m.seat === "teamA").length >= teamSize;
  const teamBFilled = party.members.filter((m) => m.seat === "teamB").length >= teamSize;
  const fullPremade = teamAFilled && teamBFilled;
  const teamA = useMemo(
    () => padSlots(
      party.members.filter((m) => m.seat === "teamA"),
      teamSize,
    ),
    [party.members, teamSize],
  );
  const teamB = useMemo(
    () => padSlots(
      party.members.filter((m) => m.seat === "teamB"),
      teamSize,
    ),
    [party.members, teamSize],
  );
  const spectators = useMemo(
    () => padSlots(
      party.members.filter((m) => m.seat === "spectator"),
      maxSpectators,
    ),
    [party.members, maxSpectators],
  );

  const localMember = party.members.find((m) => m.sessionId === localSessionId);
  const canSelfMove = Boolean(localSessionId) && !party.queued;
  const canStart = isLeader && !party.queued;

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

  const openKickMenu = (e: MouseEvent, m: PartyMemberSnapshot) => {
    setMenu({
      sessionId: m.sessionId,
      displayName: m.displayName,
      x: e.clientX,
      y: e.clientY,
    });
  };

  const renderTeam = (label: string, seat: PvpSeat, slots: Array<PartyMemberSnapshot | null>) => (
    <section className="bb-lobby-team">
      <header className="bb-lobby-team__head">{label}</header>
      <div className="bb-lobby-team__slots">
        {slots.map((member, i) => {
          const canTake =
            canSelfMove &&
            !member &&
            Boolean(localSessionId) &&
            localMember?.seat !== seat;
          const canKick =
            Boolean(member) &&
            isLeader &&
            !party.queued &&
            member!.sessionId !== localSessionId &&
            member!.sessionId !== party.leaderSessionId;
          return (
            <PlayerSlot
              key={member?.sessionId ?? `${seat}-empty-${i}`}
              member={member}
              isLeader={Boolean(member && member.sessionId === party.leaderSessionId)}
              isYou={Boolean(member && member.sessionId === localSessionId)}
              canTake={canTake}
              canKick={canKick}
              onTake={() => {
                if (localSessionId) onSetSeat(localSessionId, seat);
              }}
              onOpenKickMenu={openKickMenu}
            />
          );
        })}
      </div>
    </section>
  );

  return (
    <div
      className="bb-lobby-overlay fixed inset-0 z-40 flex items-center justify-center p-4"
      data-ui-overlay
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal
        aria-label="Arena lobby"
        className="bb-lobby-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="bb-lobby-panel__header">
          <div>
            <h2 className="bb-lobby-panel__title">Arena Lobby</h2>
            <p className="bb-lobby-panel__sub">
              {party.modes
                .map((id) => PVP_MODES.find((m) => m.id === id)?.label ?? id)
                .join(" · ") || "PvP"}
              {party.queued ? " · Searching…" : ""}
            </p>
          </div>
          <button
            type="button"
            className="bb-btn-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="bb-lobby-teams">
          {renderTeam("Team 1", "teamA", teamA)}
          {renderTeam("Team 2", "teamB", teamB)}
        </div>

        <section className="bb-lobby-observers">
          <header className="bb-lobby-team__head">Observers</header>
          <div className="bb-lobby-observers__row">
            <button
              type="button"
              className="bb-lobby-btn bb-lobby-btn--slot"
              disabled={!canSelfMove || localMember?.seat === "spectator"}
              onClick={() => {
                if (localSessionId) onSetSeat(localSessionId, "spectator");
              }}
            >
              Become Observer
            </button>
            <div className="bb-lobby-observers__grid">
              {spectators.map((member, i) => {
                const canKick =
                  Boolean(member) &&
                  isLeader &&
                  !party.queued &&
                  member!.sessionId !== localSessionId &&
                  member!.sessionId !== party.leaderSessionId;
                return (
                  <PlayerSlot
                    key={member?.sessionId ?? `spec-empty-${i}`}
                    member={member}
                    isLeader={Boolean(member && member.sessionId === party.leaderSessionId)}
                    isYou={Boolean(member && member.sessionId === localSessionId)}
                    canTake={false}
                    canKick={canKick}
                    onTake={() => undefined}
                    onOpenKickMenu={openKickMenu}
                  />
                );
              })}
            </div>
          </div>
        </section>

        {isLeader && !party.queued && inviteOpen ? (
          <div className="bb-lobby-invites">
            {inviteableFriends.length === 0 ? (
              <p className="bb-lobby-invites__empty">
                No friends to invite. Everyone in this hub is already in the lobby.
              </p>
            ) : (
              <ul className="bb-lobby-invites__list">
                {inviteableFriends.map((f) => {
                  const pending = pendingFriends.has(f.id);
                  const inHub = hubPlayers.some((h) => h.userId === f.id);
                  return (
                    <li key={f.id}>
                      <button
                        type="button"
                        className="bb-lobby-btn bb-lobby-btn--slot"
                        disabled={pending}
                        onClick={() => onInviteFriend(f.id)}
                      >
                        {pending
                          ? `Invited ${f.displayName}`
                          : inHub
                            ? `Add ${f.displayName}`
                            : `Invite ${f.displayName}${f.online ? "" : " (offline)"}`}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}

        <footer className="bb-lobby-footer">
          <div className="bb-lobby-footer__left">
            {isLeader ? (
              <button type="button" className="bb-lobby-btn bb-lobby-btn--danger" onClick={onCancel}>
                Leave Lobby
              </button>
            ) : (
              <button type="button" className="bb-lobby-btn bb-lobby-btn--danger" onClick={onLeave}>
                Leave Lobby
              </button>
            )}
          </div>
          <div className="bb-lobby-footer__right">
            {isLeader && !party.queued ? (
              <button
                type="button"
                className="bb-lobby-btn bb-lobby-btn--slot"
                onClick={() => setInviteOpen((v) => !v)}
              >
                {inviteOpen ? "Hide Invites" : "Invite Friend"}
              </button>
            ) : null}
            {canStart ? (
              fullPremade ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="bb-lobby-btn bb-lobby-btn--start"
                    onClick={() => {
                      onLock("ranked");
                      onClose();
                    }}
                  >
                    Start Ranked
                  </button>
                  <button
                    type="button"
                    className="bb-lobby-btn bb-lobby-btn--slot"
                    onClick={() => {
                      onLock("unranked");
                      onClose();
                    }}
                  >
                    Start Unranked
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="bb-lobby-btn bb-lobby-btn--start"
                  onClick={() => {
                    onLock("ranked");
                    onClose();
                  }}
                >
                  Queue Ranked
                </button>
              )
            ) : party.queued ? (
              <span className="bb-lobby-queued">Queued</span>
            ) : null}
          </div>
        </footer>
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
