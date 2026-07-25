type Props = {
  invite: { partyId: string; fromName: string; modes: string[] };
  onAccept: () => void;
  onDecline: () => void;
};

/** Incoming party invite prompt. */
export function PartyInviteToast({ invite, onAccept, onDecline }: Props) {
  return (
    <div
      data-ui-overlay
      className="bb-parchment pointer-events-auto absolute inset-x-0 top-24 z-35 mx-auto max-w-sm px-4 py-3"
    >
      <p className="bb-title text-sm">Party invite</p>
      <p className="mt-1 text-xs text-[var(--bb-ink-soft)]">
        {invite.fromName} invited you ({invite.modes.join(", ") || "PvP"})
      </p>
      <div className="mt-3 flex gap-2">
        <button type="button" className="bb-btn-brass" onClick={onAccept}>
          Accept
        </button>
        <button type="button" className="bb-btn-ink" onClick={onDecline}>
          Decline
        </button>
      </div>
    </div>
  );
}
