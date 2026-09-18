import { useEffect, useMemo, useState, type MouseEvent } from "react";
import {
  coopPveCapForModes,
  PVE_CONTENTS,
  pveContentIdFromModes,
  PVP_FAMILIES,
  pvpFamilyFighterCap,
  pvpFamilyFromModes,
  pvpFamilyMaxSpectators,
  pvpFamilyTeamSizes,
  resolvePremadeBattlegroundSize,
  resolvePremadeSkirmishMode,
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
  onSetLayout: (layout: { splitSides?: boolean; teamCOpen?: boolean; teamSize?: number }) => void;
  onKick: (sessionId: string) => void;
  onLock: (matchKind?: "ranked" | "unranked" | "coop_pve") => void;
  onCancel: () => void;
  onLeave: () => void;
  onClose: () => void;
  loadoutReady?: boolean;
};

type ContextMenu = {
  sessionId: string;
  displayName: string;
  x: number;
  y: number;
};

function familyMeta(party: PartySnapshot) {
  const family = party.family ?? pvpFamilyFromModes(party.modes);
  const sizes = pvpFamilyTeamSizes(family);
  const maxSide =
    family === "battleground"
      ? Math.max(2, Math.min(5, party.teamSize ?? sizes[0] ?? 5))
      : (sizes[0] ?? 3);
  return {
    family,
    label: PVP_FAMILIES.find((f) => f.id === family)?.label ?? "Skirmish",
    maxSide,
    maxFighters: pvpFamilyFighterCap(family),
    maxSpectators: pvpFamilyMaxSpectators(family),
  };
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
        member.online === false ? "opacity-55" : "",
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
          {member.online === false ? (
            <span className="bb-lobby-slot__you">Logged out</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Hub party lobby — PvP teams or coop Wave Assault (max 4). */
export function PartyLobbyPanel({
  party,
  localSessionId,
  hubPlayers,
  friends,
  onInviteFriend,
  onSetSeat,
  onSetLayout,
  onKick,
  onLock,
  onCancel,
  onLeave,
  onClose,
  loadoutReady = true,
}: Props) {
  const isCoopPve = party.kind === "coop_pve";
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
  const meta = useMemo(() => familyMeta(party), [party]);
  const teamACount = party.members.filter((m) => m.seat === "teamA").length;
  const teamBCount = party.members.filter((m) => m.seat === "teamB").length;
  const teamCCount = party.members.filter((m) => m.seat === "teamC").length;
  const isSkirmish = meta.family === "skirmish";
  const splitSides = party.splitSides !== false;
  const showTeamC = Boolean(party.teamCOpen) || teamCCount > 0;
  const teamSize = meta.maxSide;
  const maxSpectators = meta.maxSpectators;
  const fullPremade =
    isSkirmish
      ? resolvePremadeSkirmishMode(teamACount, teamBCount, teamCCount) != null
      : resolvePremadeBattlegroundSize(teamACount, teamBCount) != null;
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
  const teamC = useMemo(
    () => padSlots(
      party.members.filter((m) => m.seat === "teamC"),
      teamSize,
    ),
    [party.members, teamSize],
  );
  const groupSlots = useMemo(
    () =>
      padSlots(
        party.members.filter((m) => m.seat === "teamA" || m.seat === "teamB" || m.seat === "teamC"),
        meta.maxFighters,
      ),
    [party.members, meta.maxFighters],
  );
  const spectators = useMemo(
    () => padSlots(
      party.members.filter((m) => m.seat === "spectator"),
      maxSpectators,
    ),
    [party.members, maxSpectators],
  );
  const coopCap = coopPveCapForModes(party.modes);
  const coopFighters = useMemo(
    () => padSlots(party.members, coopCap),
    [party.members, coopCap],
  );

  const localMember = party.members.find((m) => m.sessionId === localSessionId);
  const canSelfMove = Boolean(localSessionId) && !party.queued && !isCoopPve;
  const canStart =
    isLeader &&
    !party.queued &&
    loadoutReady &&
    party.members.every((m) => m.online !== false) &&
    (isCoopPve ? party.members.length >= 1 : true);

  const coopSubtitle = useMemo(() => {
    const contentId = pveContentIdFromModes(party.modes);
    const label = PVE_CONTENTS.find((c) => c.id === contentId)?.label ?? "PvE";
    return `${label} · up to ${coopCap}${party.queued ? " · Starting…" : ""}`;
  }, [party.modes, party.queued, coopCap]);

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

  const inviteSection =
    isLeader && !party.queued && inviteOpen ? (
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
                    disabled={pending || (isCoopPve && party.members.length >= coopCap)}
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
    ) : null;

  const footerLeft = (
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
  );

  const kickMenu = menu ? (
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
  ) : null;

  if (isCoopPve) {
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
          aria-label={`${PVE_CONTENTS.find((c) => c.id === pveContentIdFromModes(party.modes))?.label ?? "PvE"} lobby`}
          className="bb-lobby-panel"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="bb-lobby-panel__header">
            <div>
              <h2 className="bb-lobby-panel__title">
                {PVE_CONTENTS.find((c) => c.id === pveContentIdFromModes(party.modes))?.label ?? "PvE"} Lobby
              </h2>
              <p className="bb-lobby-panel__sub">{coopSubtitle}</p>
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
            {renderTeam("Fighters", "teamA", coopFighters)}
          </div>

          {inviteSection}

          <footer className="bb-lobby-footer">
            {footerLeft}
            <div className="bb-lobby-footer__right">
              {isLeader && !party.queued ? (
                <button
                  type="button"
                  className="bb-lobby-btn bb-lobby-btn--slot"
                  onClick={() => setInviteOpen((v) => !v)}
                  disabled={party.members.length >= coopCap}
                >
                  {inviteOpen ? "Hide Invites" : "Invite Friend"}
                </button>
              ) : null}
              {canStart ? (
                <button
                  type="button"
                  className="bb-lobby-btn bb-lobby-btn--start"
                  onClick={() => {
                    onLock("coop_pve");
                    onClose();
                  }}
                >
                  Start
                </button>
              ) : party.queued ? (
                <span className="bb-lobby-queued">Starting…</span>
              ) : isLeader && !loadoutReady ? (
                <span className="bb-lobby-queued">Slot every key first</span>
              ) : null}
            </div>
          </footer>
        </div>

        {kickMenu}
      </div>
    );
  }

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
        aria-label={`${meta.label} lobby`}
        className="bb-lobby-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="bb-lobby-panel__header">
          <div>
            <h2 className="bb-lobby-panel__title">{meta.label} lobby</h2>
            <p className="bb-lobby-panel__sub">
              {splitSides
                ? isSkirmish
                  ? "Custom sides — add a third team for 1v1v1"
                  : "Custom sides — fill both teams to start, or Find Match"
                : "Your group queues together. Matchmaking picks the match."}
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

        {!isSkirmish && splitSides && isLeader && !party.queued ? (
          <div className="bb-lobby-size" role="group" aria-label="Battleground size">
            {[2, 3, 4, 5].map((n) => {
              const on = teamSize === n;
              return (
                <button
                  key={n}
                  type="button"
                  className={["bb-lobby-btn bb-lobby-btn--slot", on ? "bb-lobby-btn--on" : ""].join(" ")}
                  aria-pressed={on}
                  onClick={() => onSetLayout({ teamSize: n })}
                >
                  {n}v{n}
                </button>
              );
            })}
          </div>
        ) : null}

        <div
          className={[
            "bb-lobby-teams",
            splitSides && isSkirmish ? "bb-lobby-teams--three" : "",
          ].join(" ")}
        >
          {splitSides ? (
            <>
              {renderTeam("Team 1", "teamA", teamA)}
              {renderTeam("Team 2", "teamB", teamB)}
              {isSkirmish && showTeamC ? (
                <section className="bb-lobby-team">
                  <header className="bb-lobby-team__head bb-lobby-team__head--extra">
                    <span>Team 3</span>
                    {isLeader && !party.queued ? (
                      <button
                        type="button"
                        className="bb-lobby-team__remove"
                        aria-label="Remove team"
                        onClick={() => {
                          for (const m of party.members) {
                            if (m.seat === "teamC") onSetSeat(m.sessionId, "teamA");
                          }
                          onSetLayout({ teamCOpen: false });
                        }}
                      >
                        −
                      </button>
                    ) : null}
                  </header>
                  <div className="bb-lobby-team__slots">
                    {teamC.map((member, i) => {
                      const canTake =
                        canSelfMove &&
                        !member &&
                        Boolean(localSessionId) &&
                        localMember?.seat !== "teamC";
                      const canKick =
                        Boolean(member) &&
                        isLeader &&
                        !party.queued &&
                        member!.sessionId !== localSessionId &&
                        member!.sessionId !== party.leaderSessionId;
                      return (
                        <PlayerSlot
                          key={member?.sessionId ?? `teamC-empty-${i}`}
                          member={member}
                          isLeader={Boolean(member && member.sessionId === party.leaderSessionId)}
                          isYou={Boolean(member && member.sessionId === localSessionId)}
                          canTake={canTake}
                          canKick={canKick}
                          onTake={() => {
                            if (localSessionId) onSetSeat(localSessionId, "teamC");
                          }}
                          onOpenKickMenu={openKickMenu}
                        />
                      );
                    })}
                  </div>
                </section>
              ) : isSkirmish && isLeader && !party.queued ? (
                <button
                  type="button"
                  className="bb-lobby-team bb-lobby-team--add"
                  onClick={() => onSetLayout({ teamCOpen: true })}
                >
                  <span className="bb-lobby-team--add__plus">+</span>
                  <span>Add team</span>
                </button>
              ) : null}
            </>
          ) : (
            renderTeam("Your group", "teamA", groupSlots)
          )}
        </div>
        {isLeader && !party.queued ? (
          <div className="bb-lobby-observers" style={{ paddingTop: 0 }}>
            <button
              type="button"
              className="bb-lobby-btn bb-lobby-btn--slot"
              onClick={() => {
                if (splitSides) {
                  for (const m of party.members) {
                    if (m.seat !== "spectator" && m.seat !== "teamA") {
                      onSetSeat(m.sessionId, "teamA");
                    }
                  }
                  onSetLayout({ splitSides: false, teamCOpen: false });
                } else {
                  onSetLayout({ splitSides: true });
                }
              }}
            >
              {splitSides ? "Queue as one group" : "Split sides (custom match)"}
            </button>
          </div>
        ) : null}

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

        {inviteSection}

        <footer className="bb-lobby-footer">
          {footerLeft}
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
              <div className="flex flex-wrap gap-2">
                {fullPremade ? (
                  <>
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
                      className="bb-lobby-btn bb-lobby-btn--start"
                      onClick={() => {
                        onLock("unranked");
                        onClose();
                      }}
                    >
                      Start Unranked
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="bb-lobby-btn bb-lobby-btn--start"
                    onClick={() => {
                      onLock("ranked");
                      onClose();
                    }}
                  >
                    Find Match
                  </button>
                )}
              </div>
            ) : party.queued ? (
              <span className="bb-lobby-queued">Queued</span>
            ) : isLeader && !loadoutReady ? (
              <span className="bb-lobby-queued">Slot every key first</span>
            ) : null}
          </div>
        </footer>
      </div>

      {kickMenu}
    </div>
  );
}
