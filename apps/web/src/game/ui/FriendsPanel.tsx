import { useState } from "react";
import type { FriendRequestRow, FriendRow, HubInviteRow } from "@/lib/friends";

type Props = {
  open: boolean;
  onClose: () => void;
  friends: FriendRow[];
  requests: FriendRequestRow[];
  invites: HubInviteRow[];
  loading: boolean;
  error: string | null;
  onAddFriend: (name: string) => Promise<void>;
  onAnswerRequest: (id: string, accept: boolean) => Promise<void>;
  onInviteToHub: (friendId: string) => Promise<void>;
  onRemoveFriend: (friendId: string) => Promise<void>;
  onAnswerHubInvite: (id: string, accept: boolean) => Promise<string | null>;
  onVisitHub: (hubOwnerId: string) => void;
  onReturnHome: () => void;
  currentHubOwnerId: string;
  myUserId: string;
};

export function FriendsPanel({
  open,
  onClose,
  friends,
  requests,
  invites,
  loading,
  error,
  onAddFriend,
  onAnswerRequest,
  onInviteToHub,
  onRemoveFriend,
  onAnswerHubInvite,
  onVisitHub,
  onReturnHome,
  currentHubOwnerId,
  myUserId,
}: Props) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setLocalError(null);
    try {
      await fn();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const visiting = currentHubOwnerId !== myUserId;

  if (!open) return null;

  return (
    <div
      className="bb-overlay-dim fixed inset-0 z-40 flex items-center justify-center p-4"
      data-ui-overlay
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal
        aria-label="Friends"
        className="bb-parchment bb-book-panel relative z-10 flex max-h-[min(80dvh,640px)] w-full max-w-md flex-col overflow-hidden"
      >
        <div className="relative mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="bb-title text-lg">Friends</h2>
            <p className="mt-1 text-sm text-[var(--bb-ink-soft)]">Invite hunters to your base city</p>
          </div>
          <button type="button" className="bb-btn-ink !px-2 !py-1 text-[10px]" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="bb-brass-rule mb-4" />

        <div className="relative flex-1 space-y-5 overflow-y-auto pr-1">
          {visiting && (
            <div className="bb-choice">
              <p className="text-sm text-[var(--bb-ink-soft)]">You are visiting another hub.</p>
              <button type="button" className="bb-btn-ink mt-2" onClick={onReturnHome}>
                Return to my city
              </button>
            </div>
          )}

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              void run(async () => {
                await onAddFriend(name.trim());
                setName("");
              });
            }}
          >
            <input
              aria-label="Friend display name"
              placeholder="Add by display name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bb-input flex-1"
              autoFocus
            />
            <button type="submit" className="bb-btn-brass" disabled={busy || !name.trim()}>
              Add
            </button>
          </form>

          {(error || localError) && (
            <p className="text-sm text-[var(--bb-danger)]">{localError ?? error}</p>
          )}

          {invites.length > 0 && (
            <section>
              <h3 className="bb-title mb-2 text-xs">Hub invites</h3>
              <ul className="space-y-2">
                {invites.map((inv) => (
                  <li key={inv.id} className="bb-choice">
                    <p className="text-sm">
                      {inv.from_name ?? "Hunter"} invited you to their city
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        className="bb-btn-brass !py-1.5 text-[10px]"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const hub = await onAnswerHubInvite(inv.id, true);
                            if (hub) onVisitHub(hub);
                          })
                        }
                      >
                        Join
                      </button>
                      <button
                        type="button"
                        className="bb-btn-ink !py-1.5 text-[10px]"
                        disabled={busy}
                        onClick={() =>
                          void run(() => onAnswerHubInvite(inv.id, false).then(() => undefined))
                        }
                      >
                        Decline
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {requests.length > 0 && (
            <section>
              <h3 className="bb-title mb-2 text-xs">Friend requests</h3>
              <ul className="space-y-2">
                {requests.map((req) => (
                  <li key={req.id} className="bb-choice flex items-center justify-between gap-2">
                    <span className="text-sm">{req.from_name ?? "Hunter"}</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="bb-btn-brass !py-1.5 text-[10px]"
                        disabled={busy}
                        onClick={() => void run(() => onAnswerRequest(req.id, true))}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="bb-btn-ink !py-1.5 text-[10px]"
                        disabled={busy}
                        onClick={() => void run(() => onAnswerRequest(req.id, false))}
                      >
                        Reject
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h3 className="bb-title mb-2 text-xs">
              Friends {loading ? "…" : `(${friends.length})`}
            </h3>
            {friends.length === 0 ? (
              <p className="text-sm text-[var(--bb-ink-soft)]">
                No friends yet. Add someone by their hunter name.
              </p>
            ) : (
              <ul className="space-y-2">
                {friends.map((f) => (
                  <li key={f.id} className="bb-choice flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: f.online ? "#4a7c59" : "#8a9080" }}
                      />
                      <span className="text-sm font-semibold">{f.display_name}</span>
                      <span className="text-[10px] uppercase tracking-wide text-[var(--bb-ink-soft)]">
                        {f.online ? "Online" : "Offline"}
                      </span>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        className="bb-btn-ink !py-1.5 text-[10px]"
                        disabled={busy || !f.online || visiting}
                        onClick={() => void run(() => onInviteToHub(f.id))}
                      >
                        Invite
                      </button>
                      <button
                        type="button"
                        className="bb-btn-ink !py-1.5 text-[10px]"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            if (!window.confirm(`Remove ${f.display_name} from friends?`)) return;
                            await onRemoveFriend(f.id);
                          })
                        }
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
