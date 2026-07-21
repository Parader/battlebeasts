import "dotenv/config";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { ROOM } from "@battlebeasts/shared";
import { BaseCityRoom } from "./rooms/BaseCityRoom.js";

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

gameServer.define(ROOM.BASE_CITY, BaseCityRoom);

httpServer.listen(PORT, () => {
  console.log(`[game-server] listening on ws://localhost:${PORT}`);
});
