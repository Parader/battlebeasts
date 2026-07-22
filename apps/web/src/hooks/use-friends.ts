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
        const id = window.setInterval(() => void refresh(), 10_000);
        return () => window.clearInterval(id);
    }, [userId, refresh]);

    useEffect(() => {
        if (!userId) return;
        void heartbeatPresence(hubOwnerId);
        const id = window.setInterval(() => void heartbeatPresence(hubOwnerId), 20_000);

        const onUnload = () => {
            void setPresenceOffline();
        };
        window.addEventListener("pagehide", onUnload);

        return () => {
            window.clearInterval(id);
            window.removeEventListener("pagehide", onUnload);
            void setPresenceOffline();
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
