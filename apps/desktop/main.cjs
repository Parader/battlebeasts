const { app, BrowserWindow, shell, ipcMain } = require("electron");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const { runUpdater, DEFAULT_GAME_SERVER_URL } = require("./updater.cjs");

const isDev = !app.isPackaged;
const PROTOCOL = "battlebeasts";
/**
 * Dedicated desktop OAuth loopback — do NOT use :5173 (Vite / IPv6 localhost fights).
 * Must be listed in Supabase Auth → Redirect URLs.
 */
const OAUTH_HOST = "127.0.0.1";
const OAUTH_PORT = 3847;
const OAUTH_CALLBACK_PATH = "/auth/callback";
const OAUTH_REDIRECT = `http://${OAUTH_HOST}:${OAUTH_PORT}${OAUTH_CALLBACK_PATH}`;
/** Packaged UI origin — http (not file://) so Supabase PKCE localStorage works. */
const UI_HOST = "127.0.0.1";
const UI_PORT = 3850;

let oauthLoopbackServer = null;
let oauthLoopbackTimer = null;
let uiServer = null;
let uiRoot = null;
let launcherWin = null;
let gameWin = null;
let updateResult = null;
let updateInFlight = null;
let lastLauncherStatus = null;
let lastLauncherProgress = null;
let lastLauncherNotes = null;
let lastLauncherReady = null;
let quitting = false;
let updatePollTimer = null;
const UPDATE_POLL_MS = 60_000;
/** Last OAuth redirect URL (with ?code=). Survives until the renderer consumes it. */
let pendingOAuthCallbackUrl = null;

/** In-memory + disk auth storage for Supabase (PKCE verifier / session). */
const authStoragePath = () => path.join(app.getPath("userData"), "bb-auth-storage.json");
let authStorageCache = null;

function loadAuthStorage() {
  if (authStorageCache) return authStorageCache;
  try {
    const raw = fs.readFileSync(authStoragePath(), "utf8");
    authStorageCache = JSON.parse(raw);
    if (!authStorageCache || typeof authStorageCache !== "object") authStorageCache = {};
  } catch {
    authStorageCache = {};
  }
  return authStorageCache;
}

function saveAuthStorage() {
  try {
    fs.writeFileSync(authStoragePath(), JSON.stringify(authStorageCache ?? {}), "utf8");
  } catch (err) {
    console.warn("[desktop] auth storage write failed", err);
  }
}

const DEV_GAME_SERVER_URL = "ws://127.0.0.1:2568";

/** Resolve game server URL: env > packaged feed/config > baked home IP. Dev always uses 2568. */
function resolveGameServerUrl() {
  if (process.env.BB_GAME_SERVER_URL) return process.env.BB_GAME_SERVER_URL.trim();
  if (isDev) return DEV_GAME_SERVER_URL;
  try {
    const configPath = path.join(path.dirname(process.execPath), "config.json");
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (typeof raw.gameServerUrl === "string" && raw.gameServerUrl.trim()) {
        return raw.gameServerUrl.trim();
      }
    }
  } catch {
    // ignore malformed config
  }
  if (updateResult && typeof updateResult.gameServerUrl === "string" && updateResult.gameServerUrl.trim()) {
    return updateResult.gameServerUrl.trim();
  }
  return DEFAULT_GAME_SERVER_URL;
}

function findProtocolUrl(argv = process.argv) {
  return argv.find((a) => typeof a === "string" && a.startsWith(`${PROTOCOL}://`)) ?? null;
}

function focusMainWindow() {
  const win =
    (gameWin && !gameWin.isDestroyed() ? gameWin : null) ||
    (launcherWin && !launcherWin.isDestroyed() ? launcherWin : null) ||
    BrowserWindow.getAllWindows()[0];
  if (!win) return null;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return win;
}

function sendToLauncher(channel, payload) {
  if (channel === "updater:status") lastLauncherStatus = payload;
  if (channel === "updater:progress") lastLauncherProgress = payload;
  if (channel === "updater:notes") lastLauncherNotes = payload;
  if (channel === "updater:ready") lastLauncherReady = payload;
  if (launcherWin && !launcherWin.isDestroyed()) {
    launcherWin.webContents.send(channel, payload);
  }
}

function flushLauncherState() {
  if (!launcherWin || launcherWin.isDestroyed()) return;
  if (lastLauncherNotes) launcherWin.webContents.send("updater:notes", lastLauncherNotes);
  if (lastLauncherStatus) launcherWin.webContents.send("updater:status", lastLauncherStatus);
  if (lastLauncherProgress) launcherWin.webContents.send("updater:progress", lastLauncherProgress);
  if (lastLauncherReady) launcherWin.webContents.send("updater:ready", lastLauncherReady);
}

function publishAuthCallback(url) {
  pendingOAuthCallbackUrl = url;
  const win = focusMainWindow();
  if (!win) return;
  win.webContents.send("auth-callback", url);
}

function stopOAuthLoopback() {
  if (oauthLoopbackTimer) {
    clearTimeout(oauthLoopbackTimer);
    oauthLoopbackTimer = null;
  }
  if (oauthLoopbackServer) {
    try {
      oauthLoopbackServer.close();
    } catch {
      // ignore
    }
    oauthLoopbackServer = null;
  }
}

function oauthSuccessHtml() {
  const deepLink = `${PROTOCOL}://focus`;
  const deepLinkJson = JSON.stringify(deepLink);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Mage Trials</title>
  <meta http-equiv="refresh" content="1;url=${deepLink}"/>
</head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1220;color:#e8f2fa;font-family:system-ui,sans-serif">
  <div style="text-align:center;padding:2rem;max-width:28rem">
    <h1 style="margin:0 0 .5rem;font-size:1.5rem">Signed in</h1>
    <p style="margin:0 0 1rem;opacity:.85">Return to the Mage Trials window — sign-in should finish automatically.</p>
    <p style="margin:1.25rem 0 0"><a href=${deepLinkJson} style="color:#7dd3fc">Open Mage Trials</a></p>
  </div>
  <script>
    try { window.location.replace(${deepLinkJson}); } catch (e) {}
  </script>
</body>
</html>`;
}

function startOAuthLoopback() {
  stopOAuthLoopback();
  pendingOAuthCallbackUrl = null;
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let parsed;
      try {
        parsed = new URL(req.url || "/", `http://${OAUTH_HOST}:${OAUTH_PORT}`);
      } catch {
        res.writeHead(400).end("Bad request");
        return;
      }
      if (parsed.pathname !== OAUTH_CALLBACK_PATH) {
        res.writeHead(404).end("Not found");
        return;
      }

      const fullUrl = `${OAUTH_REDIRECT}${parsed.search}`;
      const hasAuthPayload =
        parsed.searchParams.has("code") ||
        parsed.searchParams.has("error") ||
        parsed.searchParams.has("error_description");

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(oauthSuccessHtml());

      if (hasAuthPayload) {
        publishAuthCallback(fullUrl);
        setTimeout(() => stopOAuthLoopback(), 5_000);
      }
    });

    server.once("error", (err) => {
      oauthLoopbackServer = null;
      reject(err);
    });

    server.listen(OAUTH_PORT, OAUTH_HOST, () => {
      oauthLoopbackServer = server;
      oauthLoopbackTimer = setTimeout(() => stopOAuthLoopback(), 5 * 60_000);
      resolve(OAUTH_REDIRECT);
    });
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".map": "application/json",
};

function contentTypeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function isInsideRoot(root, filePath) {
  const rel = path.relative(path.resolve(root), path.resolve(filePath));
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function startUiServer(root) {
  const resolvedRoot = path.resolve(root);
  if (uiServer) {
    if (uiRoot === resolvedRoot) return Promise.resolve(`http://${UI_HOST}:${UI_PORT}/`);
    return new Promise((resolve, reject) => {
      uiServer.close(() => {
        uiServer = null;
        uiRoot = null;
        startUiServer(resolvedRoot).then(resolve, reject);
      });
    });
  }
  uiRoot = resolvedRoot;
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url || "/", `http://${UI_HOST}:${UI_PORT}`);
        let rel = decodeURIComponent(url.pathname);
        if (rel === "/" || rel === "") rel = "index.html";
        rel = rel.replace(/^\/+/, "");
        const filePath = path.normalize(path.join(resolvedRoot, rel));
        if (!isInsideRoot(resolvedRoot, filePath)) {
          res.writeHead(403).end("Forbidden");
          return;
        }
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          const indexPath = path.join(resolvedRoot, "index.html");
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          fs.createReadStream(indexPath).pipe(res);
          return;
        }
        res.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
        fs.createReadStream(filePath).pipe(res);
      } catch (err) {
        res.writeHead(500).end(String(err));
      }
    });
    server.once("error", (err) => {
      uiServer = null;
      uiRoot = null;
      reject(err);
    });
    server.listen(UI_PORT, UI_HOST, () => {
      uiServer = server;
      resolve(`http://${UI_HOST}:${UI_PORT}/`);
    });
  });
}

function registerProtocolClient() {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
    }
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const url = findProtocolUrl(argv);
    if (url && (url === `${PROTOCOL}://focus` || url.startsWith(`${PROTOCOL}://focus?`))) {
      focusMainWindow();
      if (pendingOAuthCallbackUrl) publishAuthCallback(pendingOAuthCallbackUrl);
      return;
    }
    if (url && url.includes("code=")) {
      publishAuthCallback(url);
      return;
    }
    focusMainWindow();
    if (pendingOAuthCallbackUrl) publishAuthCallback(pendingOAuthCallbackUrl);
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (typeof url !== "string" || !url.startsWith(`${PROTOCOL}://`)) return;
    if (url === `${PROTOCOL}://focus` || url.startsWith(`${PROTOCOL}://focus?`)) {
      focusMainWindow();
      if (pendingOAuthCallbackUrl) publishAuthCallback(pendingOAuthCallbackUrl);
      return;
    }
    if (url.includes("code=")) {
      publishAuthCallback(url);
      return;
    }
    focusMainWindow();
  });

  ipcMain.handle("open-external", async (_event, url) => {
    if (typeof url !== "string") return false;
    if (!url.startsWith("https://") && !url.startsWith("http://")) return false;
    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle("quit-app", async () => {
    quitting = true;
    app.quit();
    return true;
  });

  ipcMain.handle("auth-storage-get", async (_event, key) => {
    if (typeof key !== "string") return null;
    const store = loadAuthStorage();
    return typeof store[key] === "string" ? store[key] : null;
  });

  ipcMain.handle("auth-storage-set", async (_event, key, value) => {
    if (typeof key !== "string" || typeof value !== "string") return false;
    const store = loadAuthStorage();
    store[key] = value;
    saveAuthStorage();
    return true;
  });

  ipcMain.handle("auth-storage-remove", async (_event, key) => {
    if (typeof key !== "string") return false;
    const store = loadAuthStorage();
    delete store[key];
    saveAuthStorage();
    return true;
  });

  ipcMain.handle("begin-desktop-oauth", async () => {
    try {
      const redirectTo = await startOAuthLoopback();
      return { ok: true, redirectTo };
    } catch (err) {
      const message =
        err && typeof err === "object" && err.code === "EADDRINUSE"
          ? `OAuth port ${OAUTH_PORT} is already in use. Close the other app using it, then try again.`
          : err instanceof Error
            ? err.message
            : "Could not start OAuth listener";
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("cancel-desktop-oauth", async () => {
    stopOAuthLoopback();
    pendingOAuthCallbackUrl = null;
    return true;
  });

  ipcMain.handle("take-pending-oauth-callback", async () => pendingOAuthCallbackUrl);

  ipcMain.handle("clear-pending-oauth-callback", async () => {
    pendingOAuthCallbackUrl = null;
    return true;
  });

  ipcMain.handle("begin-oauth-loopback", async () => {
    try {
      const redirectTo = await startOAuthLoopback();
      return { ok: true, redirectTo };
    } catch (err) {
      const message =
        err && typeof err === "object" && err.code === "EADDRINUSE"
          ? `OAuth port ${OAUTH_PORT} is already in use. Close the other app using it, then try again.`
          : err instanceof Error
            ? err.message
            : "Could not start OAuth listener";
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("cancel-oauth-loopback", async () => {
    stopOAuthLoopback();
    pendingOAuthCallbackUrl = null;
    return true;
  });

  const ICON_PATH = path.join(__dirname, "build", "icon.png");
  const WINDOW_ICON = fs.existsSync(ICON_PATH) ? ICON_PATH : undefined;

function gameWindowOptions(gameServerUrl) {
    return {
      width: 1280,
      height: 800,
      minWidth: 960,
      minHeight: 600,
      title: "Mage Trials",
      backgroundColor: "#050814",
      autoHideMenuBar: true,
      icon: WINDOW_ICON,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        additionalArguments: [`--bb-game-server=${gameServerUrl}`],
      },
    };
  }

  function createLauncherWindow() {
    if (launcherWin && !launcherWin.isDestroyed()) {
      launcherWin.setSkipTaskbar(false);
      if (launcherWin.isMinimized()) launcherWin.restore();
      launcherWin.show();
      launcherWin.focus();
      return launcherWin;
    }
    launcherWin = new BrowserWindow({
      width: 1280,
      height: 860,
      minWidth: 900,
      minHeight: 600,
      title: "Mage Trials",
      backgroundColor: "#050814",
      autoHideMenuBar: true,
      icon: WINDOW_ICON,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    launcherWin.setMenuBarVisibility(false);
    launcherWin.webContents.on("did-finish-load", () => flushLauncherState());
    launcherWin.on("show", () => {
      startUpdatePoll();
      void startUpdate();
    });
    launcherWin.on("hide", () => stopUpdatePoll());
    launcherWin.on("closed", () => {
      stopUpdatePoll();
      launcherWin = null;
    });
    void launcherWin.loadFile(path.join(__dirname, "launcher", "index.html"));
    return launcherWin;
  }

  function hideLauncher() {
    stopUpdatePoll();
    if (!launcherWin || launcherWin.isDestroyed()) return;
    launcherWin.setSkipTaskbar(true);
    launcherWin.hide();
  }

  function showLauncher() {
    const win = createLauncherWindow();
    win.setSkipTaskbar(false);
    win.show();
    win.focus();
    if (updateResult && updateResult.canPlay) {
      sendToLauncher("updater:ready", {
        canPlay: true,
        error: null,
        stale: Boolean(updateResult.stale),
      });
    }
    flushLauncherState();
    return win;
  }

  async function createGameWindow(contentRoot, gameServerUrl) {
    if (gameWin && !gameWin.isDestroyed()) {
      gameWin.focus();
      return gameWin;
    }
    const url = gameServerUrl || resolveGameServerUrl();
    gameWin = new BrowserWindow(gameWindowOptions(url));
    gameWin.setMenuBarVisibility(false);
    gameWin.webContents.setWindowOpenHandler(({ url: openUrl }) => {
      void shell.openExternal(openUrl);
      return { action: "deny" };
    });
    gameWin.on("closed", () => {
      gameWin = null;
      if (isDev || quitting) return;
      showLauncher();
    });

    if (isDev) {
      const viteUrl = process.env.BB_VITE_URL ?? "http://localhost:5173";
      void gameWin.loadURL(viteUrl);
      if (process.env.BB_OPEN_DEVTOOLS === "1") {
        gameWin.webContents.openDevTools({ mode: "detach" });
      }
      return gameWin;
    }

    const uiUrl = await startUiServer(contentRoot);
    void gameWin.loadURL(uiUrl);
    return gameWin;
  }

  function startUpdatePoll() {
    if (updatePollTimer) return;
    updatePollTimer = setInterval(() => {
      if (gameWin && !gameWin.isDestroyed()) return;
      if (!launcherWin || launcherWin.isDestroyed() || !launcherWin.isVisible()) return;
      void startUpdate();
    }, UPDATE_POLL_MS);
  }

  function stopUpdatePoll() {
    if (!updatePollTimer) return;
    clearInterval(updatePollTimer);
    updatePollTimer = null;
  }

  async function startUpdate() {
    if (updateInFlight) return updateInFlight;
    lastLauncherReady = null;
    updateInFlight = runUpdater({
      userData: app.getPath("userData"),
      packaged: app.isPackaged,
      execPath: process.execPath,
      launcherVersion: app.getVersion(),
      onStatus: (payload) => sendToLauncher("updater:status", payload),
      onProgress: (payload) => sendToLauncher("updater:progress", payload),
      onNotes: (payload) => sendToLauncher("updater:notes", payload),
    })
      .then((result) => {
        updateResult = result;
        if (result && result.restartLauncher) {
          quitting = true;
          stopUpdatePoll();
          sendToLauncher("updater:status", {
            phase: "updating",
            message: "Installing launcher update… it will reopen on its own.",
          });
          sendToLauncher("updater:ready", {
            canPlay: false,
            restartLauncher: true,
            error: null,
            stale: false,
          });
          setTimeout(() => app.exit(0), 1500);
          return result;
        }
        sendToLauncher("updater:ready", {
          canPlay: Boolean(result.canPlay),
          error: result.error || null,
          stale: Boolean(result.stale),
        });
        return result;
      })
      .finally(() => {
        updateInFlight = null;
      });
    return updateInFlight;
  }

  ipcMain.handle("launcher-play", async () => {
    sendToLauncher("updater:status", { phase: "checking", message: "Checking for updates…" });
    const result = await startUpdate();
    if (result && result.restartLauncher) return false;
    if (!result || !result.canPlay || !result.contentDir) return false;
    hideLauncher();
    try {
      await createGameWindow(result.contentDir, resolveGameServerUrl());
      return true;
    } catch (err) {
      showLauncher();
      const message = err instanceof Error ? err.message : String(err);
      sendToLauncher("updater:status", { phase: "error", message: "Couldn’t start the game." });
      sendToLauncher("updater:ready", { canPlay: true, error: message });
      return false;
    }
  });

  ipcMain.handle("updater-retry", async () => {
    await startUpdate();
    return true;
  });

  app.whenReady().then(() => {
    app.setAppUserModelId("com.battlebeasts.desktop");
    registerProtocolClient();
    if (isDev) {
      void createGameWindow(path.join(__dirname, "renderer"), resolveGameServerUrl());
    } else {
      createLauncherWindow();
      void startUpdate();
    }

    const coldStartUrl = findProtocolUrl(process.argv);
    if (coldStartUrl && coldStartUrl.includes("code=")) {
      setTimeout(() => publishAuthCallback(coldStartUrl), 800);
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        if (isDev) void createGameWindow(path.join(__dirname, "renderer"), resolveGameServerUrl());
        else {
          createLauncherWindow();
          void startUpdate();
        }
      }
    });
  });

  app.on("window-all-closed", () => {
    stopOAuthLoopback();
    if (uiServer) {
      try {
        uiServer.close();
      } catch {
        // ignore
      }
      uiServer = null;
    }
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    quitting = true;
    stopOAuthLoopback();
  });
}
