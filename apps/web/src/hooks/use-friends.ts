import { useCallback, useEffect, useRef, useState } from "react";
import {
    heartbeatPresence,
    inviteToHub,
    listFriends,
    listIncomingFriendRequests,
    listIncomingHubInvites,
    removeFriend,
    respondFriendRequest,
    respondHubInvite,
    sendFriendRequest,
    setPresenceOffline,
    ensureFriendCode,
    hasRedeemedFriendCode,
    redeemFriendCode,
    type FriendRequestRow,
    type FriendRow,
    type HubInviteRow,
} from "@/lib/friends";

/** Cancels a pending offline mark when we remount (React Strict Mode / hub switch). */
let presenceOfflineTimer: number | null = null;
let presenceEpoch = 0;

function cancelPendingOffline() {
    if (presenceOfflineTimer != null) {
        window.clearTimeout(presenceOfflineTimer);
        presenceOfflineTimer = null;
    }
}

function schedulePresenceOffline(epoch: number) {
    cancelPendingOffline();
    presenceOfflineTimer = window.setTimeout(() => {
        presenceOfflineTimer = null;
        // Only go offline if nothing remounted / re-hearted after this epoch.
        if (epoch === presenceEpoch) {
            void setPresenceOffline();
        }
    }, 750);
}

export function useFriends(userId: string | null, hubOwnerId: string | null) {
    const [friends, setFriends] = useState<FriendRow[]>([]);
    const [requests, setRequests] = useState<FriendRequestRow[]>([]);
    const [invites, setInvites] = useState<HubInviteRow[]>([]);
    const [friendCode, setFriendCode] = useState<string | null>(null);
    const [hasRedeemedCode, setHasRedeemedCode] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [friendRequestToast, setFriendRequestToast] = useState<string | null>(null);
    const seenRequestIds = useRef<Set<string>>(new Set());
    const requestsBootstrapped = useRef(false);

    const failStreak = useRef(0);
    const nextPollAt = useRef(0);

    const refresh = useCallback(async () => {
        if (!userId) {
            setFriends([]);
            setRequests([]);
            setInvites([]);
            setFriendCode(null);
            setHasRedeemedCode(false);
            seenRequestIds.current = new Set();
            requestsBootstrapped.current = false;
            failStreak.current = 0;
            return;
        }
        if (Date.now() < nextPollAt.current) return;
        setLoading(true);
        setError(null);
        try {
            const [f, r, i, code, redeemed] = await Promise.all([
                listFriends(userId),
                listIncomingFriendRequests(userId),
                listIncomingHubInvites(userId),
                ensureFriendCode().catch(() => ""),
                hasRedeemedFriendCode(userId),
            ]);
            failStreak.current = 0;
            nextPollAt.current = 0;
            setFriends(f);
            setRequests(r);
            setInvites(i);
            setFriendCode(code || null);
            setHasRedeemedCode(redeemed);

            const ids = new Set(r.map((req) => req.id));
            if (!requestsBootstrapped.current) {
                seenRequestIds.current = ids;
                requestsBootstrapped.current = true;
            } else {
                const newcomers = r.filter((req) => !seenRequestIds.current.has(req.id));
                if (newcomers.length > 0) {
                    const first = newcomers[0]!;
                    const name = first.from_name ?? "Hunter";
                    setFriendRequestToast(
                        newcomers.length === 1
                            ? `${name} sent you a friend request`
                            : `${newcomers.length} new friend requests`,
                    );
                }
                seenRequestIds.current = ids;
            }
        } catch (err) {
            // Back off hard while Supabase Data API is 504/timing out so we don't pile on.
            failStreak.current += 1;
            const delayMs = Math.min(60_000, 8_000 * 2 ** Math.min(failStreak.current - 1, 3));
            nextPollAt.current = Date.now() + delayMs;
            setError(err instanceof Error ? err.message : "Failed to load friends");
        } finally {
            setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        if (!friendRequestToast) return;
        const id = window.setTimeout(() => setFriendRequestToast(null), 4500);
        return () => window.clearTimeout(id);
    }, [friendRequestToast]);

    useEffect(() => {
        void refresh();
        if (!userId) return;
        const id = window.setInterval(() => void refresh(), 8_000);
        return () => window.clearInterval(id);
    }, [userId, refresh]);

    // Heartbeat while on the play screen — do NOT mark offline on hubOwnerId churn.
    useEffect(() => {
        if (!userId) return;

        const epoch = ++presenceEpoch;
        cancelPendingOffline();

        const beat = () => {
            if (Date.now() < nextPollAt.current) return;
            void heartbeatPresence(hubOwnerId).catch(() => {
                failStreak.current += 1;
                const delayMs = Math.min(60_000, 12_000 * 2 ** Math.min(failStreak.current - 1, 3));
                nextPollAt.current = Date.now() + delayMs;
            });
        };
        beat();
        const id = window.setInterval(beat, 12_000);

        const onVisible = () => {
            if (document.visibilityState === "visible") beat();
        };
        document.addEventListener("visibilitychange", onVisible);

        const onUnload = () => {
            cancelPendingOffline();
            void setPresenceOffline();
        };
        window.addEventListener("pagehide", onUnload);

        return () => {
            window.clearInterval(id);
            document.removeEventListener("visibilitychange", onVisible);
            window.removeEventListener("pagehide", onUnload);
            // Delayed so Strict Mode remount / hub switch can cancel before we go offline.
            schedulePresenceOffline(epoch);
        };
    }, [userId, hubOwnerId]);

    const addFriend = useCallback(
        async (name: string) => {
            await sendFriendRequest(name);
            await refresh();
        },
        [refresh],
    );

    const answerRequest = useCallback(
        async (id: string, accept: boolean) => {
            await respondFriendRequest(id, accept);
            await refresh();
        },
        [refresh],
    );

    const sendHubInvite = useCallback(
        async (friendId: string) => {
            await inviteToHub(friendId);
            await refresh();
        },
        [refresh],
    );

    const remove = useCallback(
        async (friendId: string) => {
            await removeFriend(friendId);
            await refresh();
        },
        [refresh],
    );

    const answerHubInvite = useCallback(
        async (id: string, accept: boolean) => {
            const hubOwner = await respondHubInvite(id, accept);
            await refresh();
            return hubOwner;
        },
        [refresh],
    );

    const redeemCode = useCallback(
        async (code: string) => {
            const result = await redeemFriendCode(code);
            await refresh();
            return result;
        },
        [refresh],
    );

    const clearFriendRequestToast = useCallback(() => setFriendRequestToast(null), []);

    return {
        friends,
        requests,
        invites,
        friendCode,
        hasRedeemedCode,
        friendRequestToast,
        clearFriendRequestToast,
        loading,
        error,
        refresh,
        addFriend,
        answerRequest,
        sendHubInvite,
        answerHubInvite,
        removeFriend: remove,
        redeemCode,
    };
}
