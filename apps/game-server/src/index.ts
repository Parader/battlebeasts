import "dotenv/config";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { registerAuthoredMaps, ROOM } from "@battlebeasts/shared";
import { BaseCityRoom } from "./rooms/BaseCityRoom.js";
import { ContentRoom } from "./rooms/ContentRoom.js";

// Before any room is created: ContentRoom.onCreate resolves its map through
// the registry, so authored documents must already be in it.
registerAuthoredMaps();

const isProd = process.env.NODE_ENV === "production";
// Prod / Docker: PORT from env (2567). Local `pnpm dev:server`: 2568 on loopback
// so a dirty working tree never binds the live player port.
const PORT = Number(isProd ? (process.env.PORT ?? 2567) : 2568);
const HOST = isProd ? "0.0.0.0" : "127.0.0.1";

const app = express();
app.use(cors());
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define(ROOM.BASE_CITY, BaseCityRoom).filterBy(["hubOwnerId"]);
gameServer.define(ROOM.ARENA, ContentRoom).filterBy(["matchId"]);
gameServer.define(ROOM.BATTLEGROUND, ContentRoom).filterBy(["matchId"]);
gameServer.define(ROOM.DUNGEON, ContentRoom).filterBy(["matchId"]);
gameServer.define(ROOM.BOSS, ContentRoom).filterBy(["matchId"]);


httpServer.listen(PORT, HOST, () => {
  console.log(`[game-server] listening on ${HOST}:${PORT}`);
});
