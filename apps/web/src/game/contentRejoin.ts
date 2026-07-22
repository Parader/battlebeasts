const KEY = "bb_content_rejoin";

export type ContentRejoinPayload = {
    token: string;
    roomId: string;
    mode: string | null;
    hubOwnerId: string;
    savedAt: number;
};

export function saveContentRejoin(payload: Omit<ContentRejoinPayload, "savedAt">) {
    try {
        sessionStorage.setItem(KEY, JSON.stringify({ ...payload, savedAt: Date.now() }));
    } catch {
        // ignore quota / private mode
    }
}

export function clearContentRejoin() {
    try {
        sessionStorage.removeItem(KEY);
    } catch {
        // ignore
    }
}

export function loadContentRejoin(maxAgeMs = 120_000): ContentRejoinPayload | null {
    try {
        const raw = sessionStorage.getItem(KEY);
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
