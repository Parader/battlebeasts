import { useState } from "react";
import type { FriendRequestRow, FriendRow, HubInviteRow } from "@/lib/friends";
import { GamePanelShell } from "./GamePanelShell";

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
    <GamePanelShell
      title="Friends"
      subtitle="Invite hunters to your base city"
      onClose={onClose}
      maxHeightClass="max-h-[min(80dvh,640px)]"
    >
      <div className="space-y-5">
        {visiting ? (
          <div className="bb-list-row bb-list-row--stack">
            <p className="bb-muted">You are visiting another hub.</p>
            <button type="button" className="bb-btn-ink self-start" onClick={onReturnHome}>
              Return to my city
            </button>
          </div>
        ) : null}

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

        {invites.length > 0 ? (
          <section>
            <h3 className="bb-section-label">Hub invites</h3>
            <ul className="space-y-2">
              {invites.map((inv) => (
                <li key={inv.id} className="bb-list-row bb-list-row--stack">
                  <p>
                    {inv.from_name ?? "Hunter"} invited you to their city
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="bb-btn-brass"
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
                      className="bb-btn-ink"
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
        ) : null}

        {requests.length > 0 ? (
          <section>
            <h3 className="bb-section-label">Friend requests</h3>
            <ul className="space-y-2">
              {requests.map((req) => (
                <li key={req.id} className="bb-list-row justify-between">
                  <span className="font-semibold">{req.from_name ?? "Hunter"}</span>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      className="bb-btn-brass"
                      disabled={busy}
                      onClick={() => void run(() => onAnswerRequest(req.id, true))}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="bb-btn-ink"
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
        ) : null}

        <section>
          <h3 className="bb-section-label">
            Friends {loading ? "…" : `(${friends.length})`}
          </h3>
          {friends.length === 0 ? (
            <p className="bb-muted">No friends yet. Add someone by their hunter name.</p>
          ) : (
            <ul className="space-y-2">
              {friends.map((f) => (
                <li key={f.id} className="bb-list-row justify-between">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: f.online ? "#4a7c59" : "#8a9080" }}
                    />
                    <span className="truncate font-semibold">{f.display_name}</span>
                    <span className="bb-meta uppercase tracking-wide">
                      {f.online ? "Online" : "Offline"}
                    </span>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      className="bb-btn-ink"
                      disabled={busy || !f.online || visiting}
                      onClick={() => void run(() => onInviteToHub(f.id))}
                    >
                      Invite
                    </button>
                    <button
                      type="button"
                      className="bb-btn-ghost"
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
    </GamePanelShell>
  );
}
