/// <reference types="vite/client" />

interface BattleBeastsDesktop {
  isElectron: boolean;
  gameServerUrl: string;
  openExternal?: (url: string) => Promise<boolean>;
  beginDesktopOAuth?: () => Promise<{ ok: boolean; redirectTo?: string; error?: string }>;
  cancelDesktopOAuth?: () => Promise<boolean>;
  takePendingOAuthCallback?: () => Promise<string | null>;
  clearPendingOAuthCallback?: () => Promise<boolean>;
  beginOAuthLoopback?: () => Promise<{ ok: boolean; redirectTo?: string; error?: string }>;
  cancelOAuthLoopback?: () => Promise<boolean>;
  authStorageGet?: (key: string) => Promise<string | null>;
  authStorageSet?: (key: string, value: string) => Promise<boolean>;
  authStorageRemove?: (key: string) => Promise<boolean>;
  onAuthCallback?: (cb: (url: string) => void) => () => void;
}

interface Window {
  battlebeasts?: BattleBeastsDesktop;
}
