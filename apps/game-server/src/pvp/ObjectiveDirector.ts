import {
  BG_CAPTURE_MS,
  BG_CTF_CAPTURES_TO_WIN,
  BG_DOMINATION_SCORE_TO_WIN,
  BG_FLAG_RETURN_MS,
  BG_KOTH_SCORE_TO_WIN,
  BG_MATCH_DURATION_MS,
  BG_SCORE_TICK_MS,
  TICK_MS,
  mapObjectivesFor,
  type MapObjectivePlacement,
} from "@battlebeasts/shared";
import { BaseCityState, ObjectivePointState, PlayerState } from "../schema/BaseCityState.js";

export type ObjectiveKind = "ctf" | "koth" | "domination";

function kindFromMode(mode: string): ObjectiveKind | null {
  if (mode === "bg_ctf") return "ctf";
  if (mode === "bg_koth") return "koth";
  if (mode === "bg_domination") return "domination";
  return null;
}

function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

export class ObjectiveDirector {
  private kind: ObjectiveKind | null = null;
  private nextTickAt = 0;
  private finished = false;
  private flagReturnAt = new Map<string, number>();

  constructor(
    private readonly state: BaseCityState,
    private readonly getLiving: () => PlayerState[],
    private readonly onMatchOver: (winner: "a" | "b" | "draw") => void,
    private readonly broadcast: (type: string, payload: Record<string, unknown>) => void,
  ) {}

  get active(): boolean {
    return this.kind != null;
  }

  start(mode: string, mapId: string | undefined, now: number) {
    this.kind = kindFromMode(mode);
    this.finished = false;
    this.flagReturnAt.clear();
    this.state.objectives.clear();
    this.state.objectiveKind = this.kind ?? "";
    this.state.scoreA = 0;
    this.state.scoreB = 0;
    this.state.scoreC = 0;
    if (!this.kind) {
      this.state.matchEndsAt = 0;
      return;
    }
    this.state.matchEndsAt = now + BG_MATCH_DURATION_MS;
    this.nextTickAt = now + BG_SCORE_TICK_MS;
    const pads = this.padsForKind(mapId, this.kind);
    for (const pad of pads) {
      const row = new ObjectivePointState();
      row.id = pad.id;
      row.tag = pad.tag;
      row.team = pad.team;
      row.owner = pad.tag === "flag_stand" ? pad.team === "none" ? "" : pad.team : "";
      row.contest = "none";
      row.progress = 0;
      row.x = pad.x;
      row.z = pad.z;
      row.radius = pad.radius;
      row.flagState = pad.tag === "flag_stand" ? "home" : "";
      row.carrierId = "";
      this.state.objectives.set(pad.id, row);
    }
  }

  stop() {
    this.kind = null;
    this.state.objectiveKind = "";
    this.state.matchEndsAt = 0;
    this.state.objectives.clear();
  }

  onPlayerDied(sessionId: string, now: number) {
    if (this.kind !== "ctf") return;
    this.state.objectives.forEach((row) => {
      if (row.flagState === "carried" && row.carrierId === sessionId) {
        const carrier = this.findPlayer(sessionId);
        row.flagState = "dropped";
        row.carrierId = "";
        row.dropX = carrier?.x ?? row.x;
        row.dropZ = carrier?.z ?? row.z;
        this.flagReturnAt.set(row.id, now + BG_FLAG_RETURN_MS);
        this.broadcast("toast", { message: `${row.team === "a" ? "Team A" : "Team B"} flag dropped` });
      }
    });
  }

  tick(now: number) {
    if (!this.kind || this.finished) return;
    if (this.state.matchPhase !== "fighting") return;

    if (this.kind === "ctf") this.tickCtf(now);
    else this.tickCapture(now);

    if (now >= this.nextTickAt) {
      this.nextTickAt = now + BG_SCORE_TICK_MS;
      if (this.kind === "koth" || this.kind === "domination") this.awardTick();
    }

    if (this.checkScoreWin() || (this.state.matchEndsAt > 0 && now >= this.state.matchEndsAt)) {
      this.finishByScore();
    }
  }

  private padsForKind(mapId: string | undefined, kind: ObjectiveKind): MapObjectivePlacement[] {
    const all = mapObjectivesFor(mapId ?? "desert");
    if (kind === "ctf") {
      const flags = all.filter((o) => o.tag === "flag_stand");
      return flags.length >= 2 ? flags : all.filter((o) => o.id.startsWith("flag_"));
    }
    if (kind === "koth") {
      const hill = all.find((o) => o.id === "hill") ?? all.find((o) => o.tag === "capture_point");
      return hill ? [hill] : [];
    }
    const dom = all.filter((o) => o.id.startsWith("dom_"));
    if (dom.length >= 2) return dom;
    return all.filter((o) => o.tag === "capture_point").slice(0, 3);
  }

  private findPlayer(sessionId: string): PlayerState | undefined {
    return this.state.players.get(sessionId);
  }

  private sessionIdOf(player: PlayerState): string {
    let found = "";
    this.state.players.forEach((p, sessionId) => {
      if (p === player) found = sessionId;
    });
    return found;
  }

  private livingIn(row: ObjectivePointState, x: number, z: number): PlayerState[] {
    const r2 = row.radius * row.radius;
    return this.getLiving().filter((p) => dist2(p.x, p.z, x, z) <= r2);
  }

  private tickCtf(now: number) {
    this.state.objectives.forEach((row) => {
      if (row.tag !== "flag_stand") return;
      const ownerTeam = row.team === "a" || row.team === "b" ? row.team : "a";

      if (row.flagState === "dropped") {
        const returnAt = this.flagReturnAt.get(row.id) ?? 0;
        if (now >= returnAt) {
          this.returnFlag(row);
          return;
        }
        const atDrop = this.livingIn(row, row.dropX, row.dropZ);
        const ally = atDrop.find((p) => p.team === ownerTeam);
        if (ally) {
          this.returnFlag(row);
          return;
        }
        const enemy = atDrop.find((p) => p.team && p.team !== ownerTeam);
        if (enemy) this.pickupFlag(row, enemy);
        return;
      }

      if (row.flagState === "home") {
        const atStand = this.livingIn(row, row.x, row.z);
        const enemy = atStand.find((p) => p.team && p.team !== ownerTeam);
        if (enemy) this.pickupFlag(row, enemy);
        return;
      }

      if (row.flagState === "carried") {
        const carrier = this.findPlayer(row.carrierId);
        if (!carrier || carrier.hp <= 0 || carrier.roundDead) {
          row.flagState = "dropped";
          row.dropX = carrier?.x ?? row.x;
          row.dropZ = carrier?.z ?? row.z;
          row.carrierId = "";
          this.flagReturnAt.set(row.id, now + BG_FLAG_RETURN_MS);
          return;
        }
        const ownStand = this.ownStand(carrier.team);
        if (!ownStand || ownStand.flagState !== "home") return;
        if (dist2(carrier.x, carrier.z, ownStand.x, ownStand.z) <= ownStand.radius * ownStand.radius) {
          if (carrier.team === "a") this.state.scoreA += 1;
          else if (carrier.team === "b") this.state.scoreB += 1;
          this.returnFlag(row);
          this.broadcast("toast", {
            message: `${carrier.displayName} captured the flag`,
          });
        }
      }
    });
  }

  private pickupFlag(row: ObjectivePointState, carrier: PlayerState) {
    const sessionId = this.sessionIdOf(carrier);
    if (!sessionId || this.carryingFlag(sessionId)) return;
    row.flagState = "carried";
    row.carrierId = sessionId;
    this.flagReturnAt.delete(row.id);
    this.broadcast("toast", { message: `${carrier.displayName} took the flag` });
  }

  private returnFlag(row: ObjectivePointState) {
    row.flagState = "home";
    row.carrierId = "";
    row.dropX = row.x;
    row.dropZ = row.z;
    this.flagReturnAt.delete(row.id);
  }

  private ownStand(team: string): ObjectivePointState | undefined {
    let found: ObjectivePointState | undefined;
    this.state.objectives.forEach((row) => {
      if (row.tag === "flag_stand" && row.team === team) found = row;
    });
    return found;
  }

  private carryingFlag(sessionId: string): boolean {
    let yes = false;
    this.state.objectives.forEach((row) => {
      if (row.flagState === "carried" && row.carrierId === sessionId) yes = true;
    });
    return yes;
  }

  private tickCapture(now: number) {
    const step = TICK_MS / Math.max(1, BG_CAPTURE_MS);
    this.state.objectives.forEach((row) => {
      if (row.tag !== "capture_point") return;
      const inside = this.livingIn(row, row.x, row.z);
      const a = inside.some((p) => p.team === "a");
      const b = inside.some((p) => p.team === "b");
      if (a && b) {
        row.contest = "contested";
        return;
      }
      if (!a && !b) {
        row.contest = "none";
        return;
      }
      const claiming = a ? "a" : "b";
      if (row.owner === claiming) {
        row.contest = claiming;
        row.progress = 1;
        return;
      }
      if (row.contest !== claiming) row.progress = 0;
      row.contest = claiming;
      row.progress = Math.min(1, row.progress + step);
      if (row.progress >= 1) {
        row.owner = claiming;
        row.progress = 1;
        this.broadcast("toast", {
          message: `${claiming === "a" ? "Team A" : "Team B"} took a point`,
        });
      }
    });
    void now;
  }

  private awardTick() {
    let a = 0;
    let b = 0;
    this.state.objectives.forEach((row) => {
      if (row.tag !== "capture_point") return;
      if (row.contest === "contested") return;
      if (row.owner === "a") a += 1;
      if (row.owner === "b") b += 1;
    });
    if (this.kind === "koth") {
      if (a > 0 && b === 0) this.state.scoreA += 1;
      if (b > 0 && a === 0) this.state.scoreB += 1;
      return;
    }
    this.state.scoreA += a;
    this.state.scoreB += b;
  }

  private checkScoreWin(): boolean {
    if (this.kind === "ctf") {
      return this.state.scoreA >= BG_CTF_CAPTURES_TO_WIN || this.state.scoreB >= BG_CTF_CAPTURES_TO_WIN;
    }
    const cap = this.kind === "koth" ? BG_KOTH_SCORE_TO_WIN : BG_DOMINATION_SCORE_TO_WIN;
    return this.state.scoreA >= cap || this.state.scoreB >= cap;
  }

  private finishByScore() {
    if (this.finished) return;
    this.finished = true;
    const a = this.state.scoreA;
    const b = this.state.scoreB;
    const winner = a === b ? "draw" : a > b ? "a" : "b";
    this.onMatchOver(winner);
  }
}
