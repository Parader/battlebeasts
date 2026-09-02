const { app, BrowserWindow, shell, ipcMain } = require("electron");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");

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

/** Default host for friend builds — override with config.json or BB_GAME_SERVER_URL. */
const DEFAULT_GAME_SERVER_URL = "ws://74.59.153.60:2567";

/** Resolve game server URL: env > config.json beside exe > baked host IP. */
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
  return DEFAULT_GAME_SERVER_URL;
}

function findProtocolUrl(argv = process.argv) {
  return argv.find((a) => typeof a === "string" && a.startsWith(`${PROTOCOL}://`)) ?? null;
}

function focusMainWindow() {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return null;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return win;
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

function startUiServer() {
  if (uiServer) return Promise.resolve(`http://${UI_HOST}:${UI_PORT}/`);
  const root = path.join(__dirname, "renderer");
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url || "/", `http://${UI_HOST}:${UI_PORT}`);
        let rel = decodeURIComponent(url.pathname);
        if (rel === "/") rel = "/index.html";
        const filePath = path.normalize(path.join(root, rel));
        if (!filePath.startsWith(root)) {
          res.writeHead(403).end("Forbidden");
          return;
        }
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
          // SPA fallback
          const indexPath = path.join(root, "index.html");
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

  async function createWindow() {
    const gameServerUrl = resolveGameServerUrl();

    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 960,
      minHeight: 600,
      title: "Mage Trials",
      backgroundColor: "#000000",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
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
      return;
    }

    try {
      const uiUrl = await startUiServer();
      void win.loadURL(uiUrl);
    } catch (err) {
      console.error("[desktop] UI server failed, falling back to loadFile", err);
      void win.loadFile(path.join(__dirname, "renderer", "index.html"));
    }
  }

  app.whenReady().then(() => {
    registerProtocolClient();
    void createWindow();

    const coldStartUrl = findProtocolUrl(process.argv);
    if (coldStartUrl && coldStartUrl.includes("code=")) {
      setTimeout(() => publishAuthCallback(coldStartUrl), 800);
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
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
    stopOAuthLoopback();
  });
}
