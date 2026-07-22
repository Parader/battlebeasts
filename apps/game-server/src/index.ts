import "dotenv/config";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { ROOM } from "@battlebeasts/shared";
import { BaseCityRoom } from "./rooms/BaseCityRoom.js";
import { ContentRoom } from "./rooms/ContentRoom.js";

const PORT = Number(process.env.PORT ?? 2567);

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


httpServer.listen(PORT, () => {
  console.log(`[game-server] listening on ws://localhost:${PORT}`);
});
