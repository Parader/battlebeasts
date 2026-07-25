const { contextBridge } = require("electron");

function readGameServerUrl() {
  const arg = process.argv.find((a) => a.startsWith("--bb-game-server="));
  if (arg) return arg.slice("--bb-game-server=".length);
  return "ws://localhost:2567";
}

contextBridge.exposeInMainWorld("battlebeasts", {
  isElectron: true,
  gameServerUrl: readGameServerUrl(),
});
