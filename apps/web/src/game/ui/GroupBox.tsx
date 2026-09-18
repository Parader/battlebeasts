type Member = {
  sessionId: string;
  displayName: string;
  online?: boolean;
};

type Props = {
  members: Member[];
  leaderSessionId: string;
  localSessionId: string | null;
  onKick: (sessionId: string) => void;
  onLeave: () => void;
};

/** Compact live group — invite from the hub roster, queue from a portal. */
export function isLiveGroup<
  T extends {
    members: Member[];
    pendingInvites?: string[];
    pendingFriendInvites?: string[];
  },
>(party: T | null | undefined, localSessionId: string | null): party is T {
  if (!party || !localSessionId) return false;
  if (!party.members.some((m) => m.sessionId === localSessionId)) return false;
  return (
    party.members.length >= 2 ||
    (party.pendingInvites?.length ?? 0) > 0 ||
    (party.pendingFriendInvites?.length ?? 0) > 0
  );
}

export function GroupBox({
  members,
  leaderSessionId,
  localSessionId,
  onKick,
  onLeave,
}: Props) {
  const isLeader = localSessionId === leaderSessionId;
  return (
    <div className="bb-parchment pointer-events-auto relative mt-1 max-w-[12rem] px-3 py-2">
      <p className="bb-section-label mb-1.5">Group</p>
      <ul className="space-y-1">
        {members.map((m) => {
          const isSelf = m.sessionId === localSessionId;
          const lead = m.sessionId === leaderSessionId;
          return (
            <li
              key={m.sessionId}
              className={`flex items-center justify-between gap-2 ${m.online === false ? "opacity-55" : ""}`}
            >
              <span className="truncate text-sm text-[var(--bb-ink)]">
                {m.displayName}
                {lead ? " ★" : ""}
                {isSelf ? " (you)" : ""}
                {m.online === false ? " (logged out)" : ""}
              </span>
              {isLeader && !isSelf ? (
                <button
                  type="button"
                  className="bb-btn-ghost shrink-0 text-[10px]"
                  onClick={() => onKick(m.sessionId)}
                >
                  Remove
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <button type="button" className="bb-btn-ghost mt-2 w-full text-xs" onClick={onLeave}>
        {isLeader ? "Disband" : "Leave"}
      </button>
    </div>
  );
}
