import { useState } from "react";
import { Heading } from "react-aria-components";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { CloseButton } from "@/components/base/buttons/close-button";
import { Input } from "@/components/base/input/input";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
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

    return (
        <ModalOverlay
            isOpen={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
            isDismissable
        >
            <Modal className="w-full max-w-md">
                <Dialog className="flex w-full flex-col">
                    <div className="flex max-h-[min(80dvh,640px)] w-full flex-col overflow-hidden rounded-2xl bg-primary shadow-xl ring-1 ring-secondary">
                        <div className="flex items-center justify-between border-b border-secondary px-4 py-3">
                            <div>
                                <Heading slot="title" className="text-lg font-semibold text-primary">
                                    Friends
                                </Heading>
                                <p className="text-sm text-tertiary">Invite hunters to your base city</p>
                            </div>
                            <CloseButton onClick={onClose} />
                        </div>

                        <div className="flex-1 space-y-5 overflow-y-auto p-4">
                            {visiting && (
                                <div className="rounded-xl bg-secondary p-3 text-sm">
                                    <p className="text-secondary">You are visiting another hub.</p>
                                    <Button className="mt-2" size="sm" color="secondary" onClick={onReturnHome}>
                                        Return to my city
                                    </Button>
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
                                <Input
                                    aria-label="Friend display name"
                                    placeholder="Add by display name"
                                    value={name}
                                    onChange={setName}
                                    size="sm"
                                    className="flex-1"
                                    autoFocus
                                />
                                <Button type="submit" size="md" color="primary" isDisabled={busy || !name.trim()}>
                                    Add
                                </Button>
                            </form>

                            {(error || localError) && (
                                <p className="text-sm text-error-primary">{localError ?? error}</p>
                            )}

                            {invites.length > 0 && (
                                <section>
                                    <h3 className="mb-2 text-sm font-semibold text-primary">Hub invites</h3>
                                    <ul className="space-y-2">
                                        {invites.map((inv) => (
                                            <li key={inv.id} className="rounded-lg bg-secondary px-3 py-2">
                                                <p className="text-sm text-primary">
                                                    {inv.from_name ?? "Hunter"} invited you to their city
                                                </p>
                                                <div className="mt-2 flex gap-2">
                                                    <Button
                                                        size="sm"
                                                        color="primary"
                                                        isDisabled={busy}
                                                        onClick={() =>
                                                            void run(async () => {
                                                                const hub = await onAnswerHubInvite(inv.id, true);
                                                                if (hub) onVisitHub(hub);
                                                            })
                                                        }
                                                    >
                                                        Join
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        color="secondary"
                                                        isDisabled={busy}
                                                        onClick={() =>
                                                            void run(() => onAnswerHubInvite(inv.id, false).then(() => undefined))
                                                        }
                                                    >
                                                        Decline
                                                    </Button>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            )}

                            {requests.length > 0 && (
                                <section>
                                    <h3 className="mb-2 text-sm font-semibold text-primary">Friend requests</h3>
                                    <ul className="space-y-2">
                                        {requests.map((req) => (
                                            <li
                                                key={req.id}
                                                className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2"
                                            >
                                                <span className="text-sm text-primary">{req.from_name ?? "Hunter"}</span>
                                                <div className="flex gap-2">
                                                    <Button
                                                        size="sm"
                                                        color="primary"
                                                        isDisabled={busy}
                                                        onClick={() => void run(() => onAnswerRequest(req.id, true))}
                                                    >
                                                        Accept
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        color="secondary"
                                                        isDisabled={busy}
                                                        onClick={() => void run(() => onAnswerRequest(req.id, false))}
                                                    >
                                                        Reject
                                                    </Button>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            )}

                            <section>
                                <h3 className="mb-2 text-sm font-semibold text-primary">
                                    Friends {loading ? "…" : `(${friends.length})`}
                                </h3>
                                {friends.length === 0 ? (
                                    <p className="text-sm text-tertiary">
                                        No friends yet. Add someone by their hunter name.
                                    </p>
                                ) : (
                                    <ul className="space-y-2">
                                        {friends.map((f) => (
                                            <li
                                                key={f.id}
                                                className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2"
                                            >
                                                <div className="flex items-center gap-2">
                                                    <span
                                                        className="size-2.5 rounded-full"
                                                        style={{ backgroundColor: f.online ? "#22c55e" : "#94a3b8" }}
                                                    />
                                                    <span className="text-sm font-medium text-primary">
                                                        {f.display_name}
                                                    </span>
                                                    <Badge color={f.online ? "success" : "gray"} size="sm">
                                                        {f.online ? "Online" : "Offline"}
                                                    </Badge>
                                                </div>
                                                <Button
                                                    size="sm"
                                                    color="secondary"
                                                    isDisabled={busy || !f.online || visiting}
                                                    onClick={() => void run(() => onInviteToHub(f.id))}
                                                >
                                                    Invite
                                                </Button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </section>
                        </div>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}
