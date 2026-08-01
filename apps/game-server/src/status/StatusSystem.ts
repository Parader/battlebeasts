import {
  STATUSES,
  combineStatusDamageDealtMul,
  combineStatusDamageTakenMul,
  combineStatusMoveMul,
  combineStatusSlowPercent,
  getStatus,
  isHardCrowdControlStatus,
  rollStatusChance,
  statusesBlockCast,
  statusesBlockMove,
  statusesGrantInvulnerable,
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
  onHotHeal?: (targetId: string, heal: number, statusId: string, sourceId: string) => void;
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

  remove(targetId: string, statusId: string) {
    const host = this.getHost(targetId);
    if (!host) return;
    host.statuses.delete(statusId);
  }

  has(targetId: string, statusId: string): boolean {
    const host = this.getHost(targetId);
    return Boolean(host?.statuses.get(statusId));
  }

  /**
   * True when `targetId` has an active hard CC (stun / root / silence)
   * whose `sourceId` is `attackerId` (Opportunist).
   */
  hasHardCcFrom(targetId: string, attackerId: string): boolean {
    if (!attackerId) return false;
    const host = this.getHost(targetId);
    if (!host) return false;
    let found = false;
    host.statuses.forEach((row) => {
      if (found) return;
      if (row.sourceId !== attackerId) return;
      if (isHardCrowdControlStatus(STATUSES[row.statusId])) found = true;
    });
    return found;
  }

  getStacks(targetId: string, statusId: string): number {
    const host = this.getHost(targetId);
    return host?.statuses.get(statusId)?.stacks ?? 0;
  }

  /** Additive slow % from all statuses, optionally excluding one id (e.g. frostChill). */
  getSlowPercent(targetId: string, excludeStatusId?: string): number {
    const entries = this.entries(targetId).filter(
      (e) => !excludeStatusId || e.def.id !== excludeStatusId,
    );
    return combineStatusSlowPercent(entries);
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
    opts?: { durationMs?: number; stacks?: number; /** Replace stacks instead of adding. */ setStacks?: boolean },
  ): boolean {
    const def = getStatus(statusId);
    const host = this.getHost(targetId);
    if (!def || !host) return false;

    // Skip debuffs while player i-frames are active
    if ("invulnerable" in host && Boolean((host as PlayerState).invulnerable) && def.polarity === "debuff") {
      return false;
    }

    const duration = opts?.durationMs ?? def.durationMs;
    const requested = opts?.stacks ?? 1;
    const maxStacks = def.maxStacks ?? 1;
    const rule = def.stackRule ?? "refresh";
    const existing = host.statuses.get(statusId);

    if (opts?.setStacks) {
      const stacks = Math.min(maxStacks, Math.max(0, requested));
      if (stacks <= 0) {
        if (existing) host.statuses.delete(statusId);
        return false;
      }
      if (existing) {
        existing.stacks = stacks;
        existing.expiresAt = now + duration;
        existing.sourceId = sourceId;
        if (def.tickMs) existing.nextTickAt = Math.min(existing.nextTickAt || now + def.tickMs, now + def.tickMs);
      } else {
        const row = new StatusInstanceState();
        row.id = statusId;
        row.statusId = statusId;
        row.expiresAt = now + duration;
        row.stacks = stacks;
        row.sourceId = sourceId;
        row.nextTickAt = def.tickMs ? now + def.tickMs : 0;
        host.statuses.set(statusId, row);
      }
      if (def.mechanic === "stun" || def.mechanic === "silence" || def.blocksCast) {
        this.hooks.onInterruptCast?.(targetId);
      }
      return true;
    }

    const addStacks = Math.max(1, requested);

    if (existing) {
      if (rule === "ignore") return false;
      if (rule === "refresh") {
        existing.expiresAt = now + duration;
        existing.sourceId = sourceId;
        // Re-apply replaces stack count (e.g. Barrier refills absorb HP).
        existing.stacks = Math.min(maxStacks, addStacks);
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

    if (def.mechanic === "stun" || def.mechanic === "silence" || def.blocksCast) {
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

  /** Incoming damage factor (1 = full; 0.6 = 40% resist). */
  getDamageTakenMul(targetId: string): number {
    return combineStatusDamageTakenMul(this.entries(targetId));
  }

  /** Outgoing damage factor (1 = full; 1.2 = +20% dealt). */
  getDamageDealtMul(attackerId: string): number {
    return combineStatusDamageDealtMul(this.entries(attackerId));
  }

  /** Full invulnerability from statuses (e.g. Counter riposte). */
  grantsInvulnerable(targetId: string): boolean {
    return statusesGrantInvulnerable(this.entries(targetId));
  }

  /**
   * Absorb damage with shield statuses (`stacks` = remaining HP).
   * Returns damage that should still hit HP.
   */
  absorbWithShields(targetId: string, damage: number): number {
    let remaining = Math.max(0, damage);
    if (!(remaining > 0)) return 0;
    const host = this.getHost(targetId);
    if (!host) return remaining;

    const toRemove: string[] = [];
    host.statuses.forEach((row, key) => {
      if (!(remaining > 0)) return;
      const def = STATUSES[row.statusId];
      if (!def || def.mechanic !== "shield") return;
      const pool = Math.max(0, Math.floor(row.stacks));
      if (pool <= 0) {
        toRemove.push(key);
        return;
      }
      const absorbed = Math.min(remaining, pool);
      row.stacks = pool - absorbed;
      remaining -= absorbed;
      if (row.stacks <= 0) toRemove.push(key);
    });
    for (const key of toRemove) host.statuses.delete(key);
    return remaining;
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
      if (def.mechanic === "hot" && def.tickMs && def.healPerTick && row.nextTickAt > 0) {
        while (row.nextTickAt > 0 && now >= row.nextTickAt && now < row.expiresAt) {
          const heal = def.healPerTick * Math.max(1, row.stacks);
          this.hooks.onHotHeal?.(targetId, heal, def.id, row.sourceId);
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
