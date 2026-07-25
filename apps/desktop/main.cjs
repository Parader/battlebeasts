const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const isDev = !app.isPackaged;

/** Resolve game server URL: env > config.json beside exe > localhost. */
function resolveGameServerUrl() {
  if (process.env.BB_GAME_SERVER_URL) return process.env.BB_GAME_SERVER_URL;
  try {
    const configPath = isDev
      ? path.join(__dirname, "config.json")
      : path.join(path.dirname(process.execPath), "config.json");
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (typeof raw.gameServerUrl === "string" && raw.gameServerUrl.trim()) {
        return raw.gameServerUrl.trim();
      }
    }
  } catch {
    // ignore malformed config
  }
  return "ws://localhost:2567";
}

function createWindow() {
  const gameServerUrl = resolveGameServerUrl();

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: "BattleBeasts",
    backgroundColor: "#000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Sandboxed preload cannot read main process.env — pass via argv.
      additionalArguments: [`--bb-game-server=${gameServerUrl}`],
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev) {
    const url = process.env.BB_VITE_URL ?? "http://localhost:5173";
    void win.loadURL(url);
    if (process.env.BB_OPEN_DEVTOOLS === "1") {
      win.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    void win.loadFile(path.join(__dirname, "renderer", "index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
