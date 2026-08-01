const { contextBridge, ipcRenderer } = require("electron");

function readGameServerUrl() {
  const arg = process.argv.find((a) => a.startsWith("--bb-game-server="));
  if (arg) return arg.slice("--bb-game-server=".length);
  return "ws://localhost:2567";
}

contextBridge.exposeInMainWorld("battlebeasts", {
  isElectron: true,
  gameServerUrl: readGameServerUrl(),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  beginDesktopOAuth: () => ipcRenderer.invoke("begin-desktop-oauth"),
  cancelDesktopOAuth: () => ipcRenderer.invoke("cancel-desktop-oauth"),
  takePendingOAuthCallback: () => ipcRenderer.invoke("take-pending-oauth-callback"),
  clearPendingOAuthCallback: () => ipcRenderer.invoke("clear-pending-oauth-callback"),
  beginOAuthLoopback: () => ipcRenderer.invoke("begin-oauth-loopback"),
  cancelOAuthLoopback: () => ipcRenderer.invoke("cancel-oauth-loopback"),
  authStorageGet: (key) => ipcRenderer.invoke("auth-storage-get", key),
  authStorageSet: (key, value) => ipcRenderer.invoke("auth-storage-set", key, value),
  authStorageRemove: (key) => ipcRenderer.invoke("auth-storage-remove", key),
  onAuthCallback: (cb) => {
    const handler = (_event, url) => {
      if (typeof url === "string") cb(url);
    };
    ipcRenderer.on("auth-callback", handler);
    return () => ipcRenderer.removeListener("auth-callback", handler);
  },
});
