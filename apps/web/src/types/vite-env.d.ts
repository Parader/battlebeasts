/// <reference types="vite/client" />

interface BattleBeastsDesktop {
  isElectron: boolean;
  gameServerUrl: string;
}

interface Window {
  battlebeasts?: BattleBeastsDesktop;
}
