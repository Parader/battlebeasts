import { useState } from "react";
import type { FriendRow } from "@/lib/friends";
import { GamePanelShell } from "./GamePanelShell";

type Props = {
  open: boolean;
  onClose: () => void;
  friends: FriendRow[];
  loading: boolean;
  error: string | null;
  onAddFriend: (name: string) => Promise<void>;
  onRedeemFriendCode: (code: string) => Promise<void>;
  friendCode: string | null;
  /** After one redeem, the input is hidden permanently. */
  hasRedeemedCode?: boolean;
  onInviteToHub: (friendId: string) => Promise<void>;
  onRemoveFriend: (friendId: string) => Promise<void>;
  onReturnHome: () => void;
  currentHubOwnerId: string;
  myUserId: string;
};

export function FriendsPanel({
  open,
  onClose,
  friends,
  loading,
  error,
  onAddFriend,
  onRedeemFriendCode,
  friendCode,
  hasRedeemedCode = false,
  onInviteToHub,
  onRemoveFriend,
  onReturnHome,
  currentHubOwnerId,
  myUserId,
}: Props) {
  const [name, setName] = useState("");
  const [codeInput, setCodeInput] = useState("");
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

        <section className="space-y-2">
          <h3 className="bb-section-label">Your friend code</h3>
          <p className="bb-muted text-sm">
            Share this code so friends can redeem it once and link you for quests.
          </p>
          <div className="bb-list-row flex items-center justify-between gap-2">
            <code className="tabular-nums tracking-wider">{friendCode ?? "…"}</code>
            {friendCode ? (
              <button
                type="button"
                className="bb-btn-ink"
                onClick={() => void navigator.clipboard?.writeText(friendCode)}
              >
                Copy
              </button>
            ) : null}
          </div>
          {hasRedeemedCode ? (
            <p className="bb-muted text-sm">
              You already redeemed a friend code. Keep sharing yours to invite people.
            </p>
          ) : (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!codeInput.trim()) return;
                void run(async () => {
                  await onRedeemFriendCode(codeInput.trim());
                  setCodeInput("");
                });
              }}
            >
              <input
                aria-label="Redeem friend code"
                placeholder="Redeem a code (once)"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                className="bb-input flex-1"
              />
              <button type="submit" className="bb-btn-brass" disabled={busy || !codeInput.trim()}>
                Redeem
              </button>
            </form>
          )}
        </section>

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
