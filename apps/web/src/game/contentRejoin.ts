import { MATCH_REJOIN_MS } from "@battlebeasts/shared";

const CONTENT_KEY = "bb_content_rejoin";
const HUB_KEY = "bb_hub_rejoin";
/** Last visited host hub — survives refresh so guests can rejoin without a new invite. */
const PREFERRED_HUB_KEY = "bb_preferred_hub";

export type ContentRejoinPayload = {
    token?: string;
    roomId: string;
    room?: string;
    mode: string | null;
    matchId?: string;
    team?: string;
    role?: string;
    spawnSlot?: number;
    hubOwnerId: string;
    savedAt: number;
};

export type HubRejoinPayload = {
    token: string;
    roomId: string;
    hubOwnerId: string;
    savedAt: number;
};

type PreferredHubPayload = {
    userId: string;
    hubOwnerId: string;
    savedAt: number;
};

function readJson<T>(store: Storage, key: string): T | null {
    try {
        const raw = store.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

export function saveContentRejoin(payload: Omit<ContentRejoinPayload, "savedAt">) {
    if (!payload.roomId && !payload.token) return;
    try {
        const prev = readJson<ContentRejoinPayload>(localStorage, CONTENT_KEY);
        const next: ContentRejoinPayload = {
            token: payload.token || prev?.token,
            roomId: payload.roomId || prev?.roomId || "",
            room: payload.room || prev?.room,
            mode: payload.mode ?? prev?.mode ?? null,
            matchId: payload.matchId || prev?.matchId,
            team: payload.team || prev?.team,
            role: payload.role || prev?.role,
            spawnSlot: payload.spawnSlot ?? prev?.spawnSlot,
            hubOwnerId: payload.hubOwnerId || prev?.hubOwnerId || "",
            savedAt: Date.now(),
        };
        localStorage.setItem(CONTENT_KEY, JSON.stringify(next));
        sessionStorage.removeItem(CONTENT_KEY);
    } catch {
        // ignore quota / private mode
    }
}

export function clearContentRejoin() {
    try {
        localStorage.removeItem(CONTENT_KEY);
        sessionStorage.removeItem(CONTENT_KEY);
    } catch {
        // ignore
    }
}

export function loadContentRejoin(maxAgeMs = MATCH_REJOIN_MS): ContentRejoinPayload | null {
    try {
        const parsed =
            readJson<ContentRejoinPayload>(localStorage, CONTENT_KEY) ??
            readJson<ContentRejoinPayload>(sessionStorage, CONTENT_KEY);
        if (!parsed || (!parsed.roomId && !parsed.token)) return null;
        if (Date.now() - (parsed.savedAt ?? 0) > maxAgeMs) {
            clearContentRejoin();
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

export function saveHubRejoin(payload: Omit<HubRejoinPayload, "savedAt">) {
    try {
        sessionStorage.setItem(HUB_KEY, JSON.stringify({ ...payload, savedAt: Date.now() }));
    } catch {
        // ignore
    }
}

export function clearHubRejoin() {
    try {
        sessionStorage.removeItem(HUB_KEY);
    } catch {
        // ignore
    }
}

export function loadHubRejoin(maxAgeMs = 90_000): HubRejoinPayload | null {
    try {
        const raw = sessionStorage.getItem(HUB_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as HubRejoinPayload;
        if (!parsed?.token || !parsed.roomId) return null;
        if (Date.now() - (parsed.savedAt ?? 0) > maxAgeMs) {
            clearHubRejoin();
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

export function savePreferredHub(userId: string, hubOwnerId: string) {
    if (!userId || !hubOwnerId || hubOwnerId === userId) {
        clearPreferredHub();
        return;
    }
    try {
        const payload: PreferredHubPayload = { userId, hubOwnerId, savedAt: Date.now() };
        sessionStorage.setItem(PREFERRED_HUB_KEY, JSON.stringify(payload));
    } catch {
        // ignore
    }
}

export function clearPreferredHub() {
    try {
        sessionStorage.removeItem(PREFERRED_HUB_KEY);
    } catch {
        // ignore
    }
}

/** Prefer an explicit visit preference, else infer from fresh rejoin tokens. */
export function loadPreferredHub(userId: string, maxAgeMs = 8 * 60 * 60_000): string | null {
    if (!userId) return null;
    try {
        const raw = sessionStorage.getItem(PREFERRED_HUB_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as PreferredHubPayload;
            if (
                parsed?.userId === userId &&
                parsed.hubOwnerId &&
                parsed.hubOwnerId !== userId &&
                Date.now() - (parsed.savedAt ?? 0) <= maxAgeMs
            ) {
                return parsed.hubOwnerId;
            }
            if (parsed?.userId !== userId || Date.now() - (parsed.savedAt ?? 0) > maxAgeMs) {
                clearPreferredHub();
            }
        }
    } catch {
        // ignore
    }

    // Rejoin payloads may still be valid after a refresh even if preference was cleared.
    try {
        const hub = loadHubRejoin();
        if (hub?.hubOwnerId && hub.hubOwnerId !== userId) return hub.hubOwnerId;
        const content = loadContentRejoin();
        if (content?.hubOwnerId && content.hubOwnerId !== userId) return content.hubOwnerId;
    } catch {
        // ignore
    }
    return null;
}
