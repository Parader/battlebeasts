import { createClient, type SupportedStorage, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const publishableKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

export const isSupabaseConfigured = Boolean(url && publishableKey);

const isElectron =
    typeof window !== "undefined" && window.battlebeasts?.isElectron === true;

/** Persist PKCE verifier + session via Electron main (reliable vs file:// quirks). */
function createElectronAuthStorage(): SupportedStorage {
    return {
        getItem: async (key) => {
            const fromMain = await window.battlebeasts?.authStorageGet?.(key);
            if (typeof fromMain === "string") return fromMain;
            try {
                return window.localStorage.getItem(key);
            } catch {
                return null;
            }
        },
        setItem: async (key, value) => {
            await window.battlebeasts?.authStorageSet?.(key, value);
            try {
                window.localStorage.setItem(key, value);
            } catch {
                // ignore
            }
        },
        removeItem: async (key) => {
            await window.battlebeasts?.authStorageRemove?.(key);
            try {
                window.localStorage.removeItem(key);
            } catch {
                // ignore
            }
        },
    };
}

export const supabase: SupabaseClient<Database> | null = isSupabaseConfigured
    ? createClient<Database>(url!, publishableKey!, {
          auth: {
              persistSession: true,
              autoRefreshToken: true,
              // Desktop OAuth uses an external browser + loopback; don't parse the app URL.
              detectSessionInUrl: !isElectron,
              flowType: "pkce",
              ...(isElectron ? { storage: createElectronAuthStorage() } : {}),
          },
      })
    : null;
