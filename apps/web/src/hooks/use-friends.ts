import { useCallback, useEffect, useState } from "react";
import {
    heartbeatPresence,
    inviteToHub,
    listFriends,
    listIncomingFriendRequests,
    listIncomingHubInvites,
    respondFriendRequest,
    respondHubInvite,
    sendFriendRequest,
    setPresenceOffline,
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
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        if (!userId) {
            setFriends([]);
            setRequests([]);
            setInvites([]);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const [f, r, i] = await Promise.all([
                listFriends(userId),
                listIncomingFriendRequests(userId),
                listIncomingHubInvites(userId),
            ]);
            setFriends(f);
            setRequests(r);
            setInvites(i);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load friends");
        } finally {
            setLoading(false);
        }
    }, [userId]);

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
            void heartbeatPresence(hubOwnerId);
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

    const answerHubInvite = useCallback(
        async (id: string, accept: boolean) => {
            const hubOwner = await respondHubInvite(id, accept);
            await refresh();
            return hubOwner;
        },
        [refresh],
    );

    return {
        friends,
        requests,
        invites,
        loading,
        error,
        refresh,
        addFriend,
        answerRequest,
        sendHubInvite,
        answerHubInvite,
    };
}
