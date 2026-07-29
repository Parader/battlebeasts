import type { FriendRequestRow, HubInviteRow } from "@/lib/friends";

export type PartyInvitePrompt = {
  partyId: string;
  fromName: string;
  modes: string[];
};

type Props = {
  partyInvite: PartyInvitePrompt | null;
  onPartyAccept: () => void;
  onPartyDecline: () => void;
  hubInvites: HubInviteRow[];
  onHubAccept: (id: string) => void;
  onHubDecline: (id: string) => void;
  friendRequests: FriendRequestRow[];
  onFriendAccept: (id: string) => void;
  onFriendDecline: (id: string) => void;
};

/** Incoming invites stacked under the top-right HUD actions. */
export function InvitePromptStack({
  partyInvite,
  onPartyAccept,
  onPartyDecline,
  hubInvites,
  onHubAccept,
  onHubDecline,
  friendRequests,
  onFriendAccept,
  onFriendDecline,
}: Props) {
  const empty =
    !partyInvite && hubInvites.length === 0 && friendRequests.length === 0;
  if (empty) return null;

  return (
    <div
      data-ui-overlay
      className="pointer-events-none absolute right-4 top-[4.25rem] z-35 flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {partyInvite ? (
        <InviteCard
          title="Party invite"
          body={`${partyInvite.fromName} invited you (${partyInvite.modes.join(", ") || "PvP"})`}
          onAccept={onPartyAccept}
          onDecline={onPartyDecline}
        />
      ) : null}

      {hubInvites.map((inv) => (
        <InviteCard
          key={inv.id}
          title="Hub invite"
          body={`${inv.from_name ?? "Hunter"} invited you to their city`}
          acceptLabel="Join"
          onAccept={() => onHubAccept(inv.id)}
          onDecline={() => onHubDecline(inv.id)}
        />
      ))}

      {friendRequests.map((req) => (
        <InviteCard
          key={req.id}
          title="Friend request"
          body={`${req.from_name ?? "Hunter"} wants to be friends`}
          onAccept={() => onFriendAccept(req.id)}
          onDecline={() => onFriendDecline(req.id)}
        />
      ))}
    </div>
  );
}

function InviteCard({
  title,
  body,
  acceptLabel = "Accept",
  onAccept,
  onDecline,
}: {
  title: string;
  body: string;
  acceptLabel?: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div className="bb-parchment pointer-events-auto px-3.5 py-3 shadow-lg">
      <p className="bb-panel-title !text-base">{title}</p>
      <p className="bb-panel-sub !mt-1">{body}</p>
      <div className="mt-3 flex gap-2">
        <button type="button" className="bb-btn-brass" onClick={onAccept}>
          {acceptLabel}
        </button>
        <button type="button" className="bb-btn-ink" onClick={onDecline}>
          Decline
        </button>
      </div>
    </div>
  );
}
