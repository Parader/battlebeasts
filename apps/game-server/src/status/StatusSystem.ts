import {
  STATUSES,
  combineStatusMoveMul,
  getStatus,
  rollStatusChance,
  statusesBlockCast,
  statusesBlockMove,
  type StatusApplication,
  type StatusDef,
} from "@battlebeasts/shared";
import {
  BaseCityState,
  PlayerState,
  StatusInstanceState,
  WorldTargetState,
} from "../schema/BaseCityState.js";

type StatusHost = PlayerState | WorldTargetState;

export type StatusHooks = {
  /** Called when a stun (or other interrupt) should cancel an in-progress cast. */
  onInterruptCast?: (targetId: string) => void;
  onDotDamage?: (targetId: string, damage: number, statusId: string, sourceId: string) => void;
};

/**
 * Applies / ticks / expires statuses on players and world targets.
 */
export class StatusSystem {
  constructor(
    private state: BaseCityState,
    private hooks: StatusHooks = {},
  ) {}

  clearTarget(targetId: string) {
    const host = this.getHost(targetId);
    if (!host) return;
    host.statuses.clear();
  }

  applyApplications(
    targetId: string,
    apps: StatusApplication[] | undefined,
    sourceId: string,
    now: number,
  ) {
    if (!apps?.length) return;
    for (const app of apps) {
      if (!rollStatusChance(app.chance ?? 1)) continue;
      this.apply(targetId, app.statusId, sourceId, now, {
        durationMs: app.durationMs,
        stacks: app.stacks ?? 1,
      });
    }
  }

  apply(
    targetId: string,
    statusId: string,
    sourceId: string,
    now: number,
    opts?: { durationMs?: number; stacks?: number },
  ): boolean {
    const def = getStatus(statusId);
    const host = this.getHost(targetId);
    if (!def || !host) return false;

    // Skip debuffs while player i-frames are active
    if ("invulnerable" in host && Boolean((host as PlayerState).invulnerable) && def.polarity === "debuff") {
      return false;
    }

    const duration = opts?.durationMs ?? def.durationMs;
    const addStacks = Math.max(1, opts?.stacks ?? 1);
    const maxStacks = def.maxStacks ?? 1;
    const rule = def.stackRule ?? "refresh";
    const existing = host.statuses.get(statusId);

    if (existing) {
      if (rule === "ignore") return false;
      if (rule === "refresh") {
        existing.expiresAt = now + duration;
        existing.sourceId = sourceId;
        if (def.tickMs) existing.nextTickAt = Math.min(existing.nextTickAt || now + def.tickMs, now + def.tickMs);
      } else if (rule === "stack") {
        existing.stacks = Math.min(maxStacks, existing.stacks + addStacks);
        existing.expiresAt = now + duration;
        existing.sourceId = sourceId;
      }
    } else {
      const row = new StatusInstanceState();
      row.id = statusId;
      row.statusId = statusId;
      row.expiresAt = now + duration;
      row.stacks = Math.min(maxStacks, addStacks);
      row.sourceId = sourceId;
      row.nextTickAt = def.tickMs ? now + def.tickMs : 0;
      host.statuses.set(statusId, row);
    }

    if (def.mechanic === "stun" || def.blocksCast) {
      this.hooks.onInterruptCast?.(targetId);
    }
    return true;
  }

  tick(now: number) {
    this.state.players.forEach((player, sessionId) => {
      this.tickHost(sessionId, player, now);
    });
    this.state.targets.forEach((target, id) => {
      this.tickHost(id, target, now);
    });
  }

  getMoveMul(targetId: string): number {
    return combineStatusMoveMul(this.entries(targetId));
  }

  canMove(targetId: string): boolean {
    return !statusesBlockMove(this.entries(targetId));
  }

  canCast(targetId: string): boolean {
    return !statusesBlockCast(this.entries(targetId));
  }

  private tickHost(targetId: string, host: StatusHost, now: number) {
    const toRemove: string[] = [];
    host.statuses.forEach((row, key) => {
      const def = STATUSES[row.statusId];
      if (!def || now >= row.expiresAt) {
        toRemove.push(key);
        return;
      }
      if (def.mechanic === "dot" && def.tickMs && def.damagePerTick && row.nextTickAt > 0) {
        while (row.nextTickAt > 0 && now >= row.nextTickAt && now < row.expiresAt) {
          const dmg = def.damagePerTick * Math.max(1, row.stacks);
          this.hooks.onDotDamage?.(targetId, dmg, def.id, row.sourceId);
          row.nextTickAt += def.tickMs;
        }
      }
    });
    for (const key of toRemove) host.statuses.delete(key);
  }

  private entries(targetId: string): { def: StatusDef; stacks: number }[] {
    const host = this.getHost(targetId);
    if (!host) return [];
    const out: { def: StatusDef; stacks: number }[] = [];
    host.statuses.forEach((row) => {
      const def = STATUSES[row.statusId];
      if (def) out.push({ def, stacks: row.stacks });
    });
    return out;
  }

  private getHost(targetId: string): StatusHost | undefined {
    return this.state.players.get(targetId) ?? this.state.targets.get(targetId);
  }
}
