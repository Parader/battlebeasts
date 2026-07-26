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
      className="bb-parchment pointer-events-auto absolute inset-x-0 top-24 z-35 mx-auto max-w-sm px-4 py-3.5"
    >
      <p className="bb-panel-title !text-lg">Party invite</p>
      <p className="bb-panel-sub">
        {invite.fromName} invited you ({invite.modes.join(", ") || "PvP"})
      </p>
      <div className="mt-4 flex gap-2">
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
