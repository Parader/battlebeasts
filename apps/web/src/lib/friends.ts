import { supabase } from "@/lib/supabase";

export type FriendRow = {
    id: string;
    display_name: string;
    color: string;
    online: boolean;
    hub_owner_id: string | null;
};

export type FriendRequestRow = {
    id: string;
    from_user_id: string;
    to_user_id: string;
    status: string;
    created_at: string;
    from_name?: string;
    to_name?: string;
};

export type HubInviteRow = {
    id: string;
    from_user_id: string;
    to_user_id: string;
    hub_owner_id: string;
    status: string;
    expires_at: string;
    from_name?: string;
};

export async function listFriends(userId: string): Promise<FriendRow[]> {
    if (!supabase) return [];

    const { data: links, error } = await supabase
        .from("friendships")
        .select("friend_id")
        .eq("user_id", userId);

    if (error || !links?.length) return [];

    const friendIds = links.map((l) => l.friend_id);
    const [{ data: profiles }, { data: presence }] = await Promise.all([
        supabase.from("profiles").select("id, display_name, color").in("id", friendIds),
        supabase.from("presence").select("user_id, status, hub_owner_id, last_seen").in("user_id", friendIds),
    ]);

    const presenceMap = new Map((presence ?? []).map((p) => [p.user_id, p]));

    const rows = (profiles ?? []).map((p) => {
        const pr = presenceMap.get(p.id);
        const ageMs = pr?.last_seen ? Date.now() - new Date(pr.last_seen).getTime() : Infinity;
        // Heartbeat ~12s; allow a few missed beats + clock skew before offline.
        const fresh = pr?.status === "online" && ageMs < 90_000;
        return {
            id: p.id,
            display_name: p.display_name,
            color: p.color,
            online: Boolean(fresh),
            hub_owner_id: pr?.hub_owner_id ?? null,
        };
    });

    rows.sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1;
        return a.display_name.localeCompare(b.display_name, undefined, { sensitivity: "base" });
    });
    return rows;
}

export async function listIncomingFriendRequests(userId: string): Promise<FriendRequestRow[]> {
    if (!supabase) return [];
    const { data, error } = await supabase
        .from("friend_requests")
        .select("id, from_user_id, to_user_id, status, created_at")
        .eq("to_user_id", userId)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

    if (error || !data?.length) return [];

    const fromIds = data.map((r) => r.from_user_id);
    const { data: profiles } = await supabase.from("profiles").select("id, display_name").in("id", fromIds);
    const nameMap = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

    return data.map((r) => ({ ...r, from_name: nameMap.get(r.from_user_id) }));
}

export async function listIncomingHubInvites(userId: string): Promise<HubInviteRow[]> {
    if (!supabase) return [];
    const { data, error } = await supabase
        .from("hub_invites")
        .select("id, from_user_id, to_user_id, hub_owner_id, status, expires_at")
        .eq("to_user_id", userId)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false });

    if (error || !data?.length) return [];

    const fromIds = data.map((r) => r.from_user_id);
    const { data: profiles } = await supabase.from("profiles").select("id, display_name").in("id", fromIds);
    const nameMap = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

    return data.map((r) => ({ ...r, from_name: nameMap.get(r.from_user_id) }));
}

export async function sendFriendRequest(displayName: string) {
    if (!supabase) throw new Error("Supabase not configured");
    const { error } = await supabase.rpc("send_friend_request", { target_name: displayName });
    if (error) throw error;
}

export async function respondFriendRequest(requestId: string, accept: boolean) {
    if (!supabase) throw new Error("Supabase not configured");
    const { error } = await supabase.rpc("respond_friend_request", {
        request_id: requestId,
        accept,
    });
    if (error) throw error;
}

export async function removeFriend(friendUserId: string) {
    if (!supabase) throw new Error("Supabase not configured");
    const { error } = await supabase.rpc("remove_friend", { friend_user_id: friendUserId });
    if (error) throw error;
}

export async function inviteToHub(friendUserId: string) {
    if (!supabase) throw new Error("Supabase not configured");
    const { error } = await supabase.rpc("invite_to_hub", { friend_user_id: friendUserId });
    if (error) throw error;
}

export async function respondHubInvite(inviteId: string, accept: boolean): Promise<string | null> {
    if (!supabase) throw new Error("Supabase not configured");
    const { data, error } = await supabase.rpc("respond_hub_invite", {
        invite_id: inviteId,
        accept,
    });
    if (error) throw error;
    return (data as string | null) ?? null;
}

export async function heartbeatPresence(hubOwnerId: string | null) {
    if (!supabase) return;
    const { error } = await supabase.rpc("heartbeat_presence", {
        p_hub_owner_id: hubOwnerId,
    });
    if (error) {
        console.warn("[presence] heartbeat failed", error.message);
    }
}

export async function setPresenceOffline() {
    if (!supabase) return;
    const { error } = await supabase.rpc("set_presence_offline");
    if (error) {
        console.warn("[presence] offline failed", error.message);
    }
}

export async function ensureFriendCode(): Promise<string> {
    if (!supabase) throw new Error("Supabase not configured");
    const { data, error } = await supabase.rpc("ensure_friend_code");
    if (error) throw error;
    return String(data ?? "");
}

/** True once this account has redeemed someone else's code (one redeem ever). */
export async function hasRedeemedFriendCode(userId: string): Promise<boolean> {
    if (!supabase) return false;
    const { data, error } = await supabase
        .from("friend_referrals")
        .select("invitee_id")
        .eq("invitee_id", userId)
        .maybeSingle();
    if (error) return false;
    return Boolean(data);
}

export async function redeemFriendCode(code: string): Promise<{ inviter_name?: string }> {
    if (!supabase) throw new Error("Supabase not configured");
    const { data, error } = await supabase.rpc("redeem_friend_code", { code });
    if (error) {
        const msg = error.message ?? "";
        if (/already redeemed/i.test(msg)) {
            throw new Error("You already redeemed a friend code. Share yours to invite others.");
        }
        throw error;
    }
    return (data as { inviter_name?: string }) ?? {};
}

