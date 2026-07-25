const CONTENT_KEY = "bb_content_rejoin";
const HUB_KEY = "bb_hub_rejoin";
/** Last visited host hub — survives refresh so guests can rejoin without a new invite. */
const PREFERRED_HUB_KEY = "bb_preferred_hub";

export type ContentRejoinPayload = {
    token: string;
    roomId: string;
    mode: string | null;
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

export function saveContentRejoin(payload: Omit<ContentRejoinPayload, "savedAt">) {
    try {
        sessionStorage.setItem(CONTENT_KEY, JSON.stringify({ ...payload, savedAt: Date.now() }));
    } catch {
        // ignore quota / private mode
    }
}

export function clearContentRejoin() {
    try {
        sessionStorage.removeItem(CONTENT_KEY);
    } catch {
        // ignore
    }
}

export function loadContentRejoin(maxAgeMs = 120_000): ContentRejoinPayload | null {
    try {
        const raw = sessionStorage.getItem(CONTENT_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as ContentRejoinPayload;
        if (!parsed?.token || !parsed.roomId) return null;
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
