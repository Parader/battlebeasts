import {
  STATUSES,
  combineStatusAnticipationMul,
  combineStatusCastDurationMul,
  combineStatusDamageDealtMul,
  combineStatusDamageTakenMul,
  combineStatusMoveMul,
  combineStatusSlowPercent,
  getStatus,
  ccDrKind,
  hardCcDrMul,
  HARD_CC_DR_WINDOW_MS,
  type CcDrKind,
  isControlHelperStatus,
  isElementalSecondaryStatus,
  isHardCrowdControlStatus,
  isTimedControlStatus,
  isUntouchableShortenable,
  rollStatusChance,
  statusDispelPriority,
  statusIsBuffDispellable,
  statusIsDebuffDispellable,
  statusMapKey,
  statusesBlockCast,
  statusesBlockDisplacement,
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
  onInterruptCast?: (targetId: string, sourceId?: string) => void;
  onDotDamage?: (targetId: string, damage: number, statusId: string, sourceId: string) => void;
  onHotHeal?: (targetId: string, heal: number, statusId: string, sourceId: string) => void;
  onModifyDuration?: (
    targetId: string,
    statusId: string,
    sourceId: string,
    durationMs: number,
    alreadyControlled: boolean,
  ) => number;
  onStatusApplied?: (targetId: string, statusId: string, sourceId: string) => void;
  /** Lingering Grace — scale newly applied HoT duration. */
  hotDurationMul?: (sourceId: string, statusId: string) => number;
  /** Everlasting Grace — scale HoT tick interval (1 = unchanged). */
  hotTickMsMul?: (sourceId: string, targetId: string, statusId: string) => number;
  /** Persistent Grace / Overflowing Renewal tick amps. */
  hotHealMul?: (
    targetId: string,
    statusId: string,
    sourceId: string,
    isLastTick: boolean,
  ) => number;
  onHotApplied?: (targetId: string, statusId: string, sourceId: string) => void;
};

/**
 * Applies / ticks / expires statuses on players and world targets.
 */
export class StatusSystem {
  /** Recent hard-CC apply times, keyed by target then CC type. */
  private hardCcRecent = new Map<string, Partial<Record<CcDrKind, number[]>>>();

  constructor(
    private state: BaseCityState,
    private hooks: StatusHooks = {},
  ) {}

  clearTarget(targetId: string) {
    const host = this.getHost(targetId);
    if (!host) return;
    host.statuses.clear();
    this.hardCcRecent.delete(targetId);
  }

  /** True when the target already has a timed control effect (hard CC or slow). */
  hasTimedControl(targetId: string): boolean {
    const host = this.getHost(targetId);
    if (!host) return false;
    let found = false;
    host.statuses.forEach((row) => {
      if (found) return;
      if (isControlHelperStatus(row.statusId)) return;
      if (isTimedControlStatus(STATUSES[row.statusId])) found = true;
    });
    return found;
  }

  remove(targetId: string, statusId: string, sourceId?: string) {
    const host = this.getHost(targetId);
    if (!host) return;
    const def = getStatus(statusId);
    if (def?.stackPerSource) {
      if (sourceId) {
        host.statuses.delete(statusMapKey(statusId, sourceId));
        return;
      }
      // No source — clear every row of this status id.
      const toRemove: string[] = [];
      host.statuses.forEach((row, key) => {
        if (row.statusId === statusId) toRemove.push(key);
      });
      for (const key of toRemove) host.statuses.delete(key);
      return;
    }
    host.statuses.delete(statusId);
  }

  has(targetId: string, statusId: string, sourceId?: string): boolean {
    return this.getStacks(targetId, statusId, sourceId) > 0;
  }

  /** Return the sourceId of the caster who feared targetId, or null if not feared. */
  getFearSource(targetId: string): string | null {
    return this.getSourceId(targetId, "feared");
  }

  /** Return the sourceId of the first row matching statusId on targetId, or null. */
  getSourceId(targetId: string, statusId: string): string | null {
    const host = this.getHost(targetId);
    if (!host) return null;
    let foundSourceId: string | null = null;
    host.statuses.forEach((row) => {
      if (row.statusId === statusId && row.sourceId) {
        foundSourceId = row.sourceId;
      }
    });
    return foundSourceId;
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

  /**
   * Stack count for `statusId`. When `sourceId` is set (or the status is
   * per-source), reads that caster's row only.
   */
  /** Caster-owned HoT instances on one host. */
  countHotsFrom(targetId: string, sourceId: string): number {
    const host = this.getHost(targetId);
    if (!host || !sourceId) return 0;
    let n = 0;
    host.statuses.forEach((row) => {
      const def = STATUSES[row.statusId];
      if (def?.mechanic === "hot" && row.sourceId === sourceId) n += 1;
    });
    return n;
  }

  /** Caster-owned HoT instances across every player and dummy. */
  countHotsFromSource(sourceId: string): number {
    if (!sourceId) return 0;
    let n = 0;
    const tally = (host: StatusHost) => {
      host.statuses.forEach((row) => {
        const def = STATUSES[row.statusId];
        if (def?.mechanic === "hot" && row.sourceId === sourceId) n += 1;
      });
    };
    this.state.players.forEach((p) => tally(p));
    this.state.targets.forEach((t) => tally(t));
    return n;
  }

  refreshHotsFromSource(targetId: string, sourceId: string, now: number, durationMul = 1) {
    const host = this.getHost(targetId);
    if (!host || !sourceId) return;
    host.statuses.forEach((row) => {
      const def = STATUSES[row.statusId];
      if (def?.mechanic !== "hot" || row.sourceId !== sourceId || def.permanent) return;
      const duration = Math.max(50, Math.round(def.durationMs * Math.max(0.1, durationMul)));
      row.expiresAt = now + duration;
    });
  }

  forEachHotFrom(
    targetId: string,
    sourceId: string,
    fn: (statusId: string, durationMs: number) => void,
  ) {
    const host = this.getHost(targetId);
    if (!host || !sourceId) return;
    host.statuses.forEach((row) => {
      const def = STATUSES[row.statusId];
      if (def?.mechanic !== "hot" || row.sourceId !== sourceId || def.permanent) return;
      fn(row.statusId, def.durationMs);
    });
  }

  extendHotsFromSource(targetId: string, sourceId: string, extraMs: number) {
    const host = this.getHost(targetId);
    if (!host || !sourceId || extraMs <= 0) return;
    host.statuses.forEach((row) => {
      const def = STATUSES[row.statusId];
      if (def?.mechanic !== "hot" || row.sourceId !== sourceId || def.permanent) return;
      row.expiresAt += extraMs;
    });
  }

  getStacks(targetId: string, statusId: string, sourceId?: string): number {
    const host = this.getHost(targetId);
    if (!host) return 0;
    const def = getStatus(statusId);
    if (def?.stackPerSource) {
      if (!sourceId) {
        let max = 0;
        host.statuses.forEach((row) => {
          if (row.statusId === statusId) max = Math.max(max, row.stacks);
        });
        return max;
      }
      return host.statuses.get(statusMapKey(statusId, sourceId))?.stacks ?? 0;
    }
    return host.statuses.get(statusId)?.stacks ?? 0;
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
    opts?: {
      /**
       * Intensified Elements — scale DoT/slow duration and stackable slow stacks
       * (1.05 / 1.10 / 1.15). Buffs / self apps should leave this at 1.
       */
      effectMul?: number;
    },
  ) {
    if (!apps?.length) return;
    const effectMul =
      typeof opts?.effectMul === "number" && opts.effectMul > 0 ? opts.effectMul : 1;
    for (const app of apps) {
      if (!rollStatusChance(app.chance ?? 1)) continue;
      const def = getStatus(app.statusId);
      let durationMs = app.durationMs;
      let stacks = app.stacks ?? 1;
      if (def && effectMul !== 1 && isElementalSecondaryStatus(def)) {
        const baseDur = durationMs ?? def.durationMs;
        durationMs = Math.max(1, Math.round(baseDur * effectMul));
        // Stack-scaled chills (frostChill) set stacks in ability code — only buff duration here.
        if (
          def.slowPercentPerStack == null &&
          (def.mechanic === "slow" || (typeof def.moveMul === "number" && def.moveMul < 1)) &&
          (def.maxStacks ?? 1) > 1
        ) {
          stacks = Math.min(
            def.maxStacks ?? 1,
            Math.max(1, Math.ceil(stacks * effectMul)),
          );
        }
      }
      this.apply(targetId, app.statusId, sourceId, now, {
        durationMs,
        stacks,
      });
    }
  }

  apply(
    targetId: string,
    statusId: string,
    sourceId: string,
    now: number,
    opts?: {
      durationMs?: number;
      stacks?: number;
      /** Replace stacks instead of adding. */
      setStacks?: boolean;
      /** Directional angle (radians) for directional statuses like exposedAngle. */
      angle?: number;
      /** Override default max stacks (e.g. Unbreakable allowing 4 Hardened stacks). */
      maxStacks?: number;
    },
  ): boolean {
    const def = getStatus(statusId);
    const host = this.getHost(targetId);
    if (!def || !host) return false;

    // Skip debuffs while player i-frames are active
    if ("invulnerable" in host && Boolean((host as PlayerState).invulnerable) && def.polarity === "debuff") {
      return false;
    }

    let duration = opts?.durationMs ?? def.durationMs;
    const alreadyControlled = this.hasTimedControl(targetId);
    if (this.hooks.onModifyDuration && def.polarity === "debuff") {
      duration = this.hooks.onModifyDuration(
        targetId,
        statusId,
        sourceId,
        duration,
        alreadyControlled,
      );
    }
    if (def.mechanic === "hot" && this.hooks.hotDurationMul) {
      const hotMul = this.hooks.hotDurationMul(sourceId, statusId);
      if (hotMul > 0 && hotMul !== 1) {
        duration = Math.max(50, Math.round(duration * hotMul));
      }
    }
    const drKind = ccDrKind(def);
    // Refreshes of an already-active type (Frost Mist freeze ticks) do not stack DR.
    if (drKind && !this.hasCcDrKind(targetId, drKind)) {
      duration = this.applyHardCcDr(targetId, drKind, now, duration);
      this.recordHardCc(targetId, drKind, now);
      if (duration <= 0) return false;
    }
    // Bulwark Charge: hard CC durations reduced by 75% while charging.
    if (
      def.polarity === "debuff" &&
      (def.mechanic === "stun" || def.mechanic === "root" || def.mechanic === "silence") &&
      this.has(targetId, "bulwarkCharging")
    ) {
      duration = Math.max(50, Math.round(duration * 0.25));
    }
    // Ascendant Form: CC debuff durations reduced by 50% while transformed.
    if (
      def.polarity === "debuff" &&
      (isHardCrowdControlStatus(def) ||
        def.mechanic === "stun" ||
        def.mechanic === "root" ||
        def.mechanic === "silence" ||
        def.mechanic === "slow" ||
        def.mechanic === "fear") &&
      this.has(targetId, "ascendantForm")
    ) {
      duration = Math.max(50, Math.round(duration * 0.5));
    }
    // Flow Untouchable: newly applied root / slow / stun / fear 25% shorter (not silence).
    if (def.polarity === "debuff" && this.has(targetId, "untouchable") && isUntouchableShortenable(def)) {
      duration = Math.max(1, Math.round(duration * 0.75));
    }
    const permanent = def.permanent === true || duration <= 0;
    const expiresAt = permanent ? Number.MAX_SAFE_INTEGER : now + duration;
    const requested = opts?.stacks ?? 1;
    const maxStacks = opts?.maxStacks ?? def.maxStacks ?? 1;
    const rule = def.stackRule ?? "refresh";
    const mapKey = statusMapKey(statusId, sourceId);
    const existing = host.statuses.get(mapKey);

    if (opts?.setStacks) {
      const stacks = Math.min(maxStacks, Math.max(0, requested));
      if (stacks <= 0 && !permanent) {
        if (existing) host.statuses.delete(mapKey);
        return false;
      }
      if (existing) {
        existing.stacks = stacks;
        existing.expiresAt = expiresAt;
        existing.sourceId = sourceId;
        if (typeof opts?.angle === "number") existing.angle = opts.angle;
        if (def.tickMs) existing.nextTickAt = Math.min(existing.nextTickAt || now + def.tickMs, now + def.tickMs);
      } else {
        const row = new StatusInstanceState();
        row.id = mapKey;
        row.statusId = statusId;
        row.expiresAt = expiresAt;
        row.stacks = stacks;
        row.sourceId = sourceId;
        if (typeof opts?.angle === "number") row.angle = opts.angle;
        row.nextTickAt = def.tickMs ? now + def.tickMs : 0;
        host.statuses.set(mapKey, row);
      }
      if (def.mechanic === "stun" || def.mechanic === "silence" || def.blocksCast) {
        this.hooks.onInterruptCast?.(targetId, sourceId);
      }
      this.hooks.onStatusApplied?.(targetId, statusId, sourceId);
      if (def.mechanic === "hot") this.hooks.onHotApplied?.(targetId, statusId, sourceId);
      return true;
    }

    const addStacks = Math.max(1, requested);

    if (existing) {
      if (rule === "ignore") return false;
      if (rule === "refresh") {
        existing.expiresAt = expiresAt;
        existing.sourceId = sourceId;
        // Re-apply replaces stack count (e.g. Barrier refills absorb HP).
        existing.stacks = Math.min(maxStacks, addStacks);
        if (typeof opts?.angle === "number") existing.angle = opts.angle;
        if (def.tickMs) existing.nextTickAt = Math.min(existing.nextTickAt || now + def.tickMs, now + def.tickMs);
      } else if (rule === "stack") {
        existing.stacks = Math.min(maxStacks, existing.stacks + addStacks);
        existing.expiresAt = expiresAt;
        existing.sourceId = sourceId;
        if (typeof opts?.angle === "number") existing.angle = opts.angle;
      }
    } else {
      const row = new StatusInstanceState();
      row.id = mapKey;
      row.statusId = statusId;
      row.expiresAt = expiresAt;
      row.stacks = Math.min(maxStacks, addStacks);
      row.sourceId = sourceId;
      if (typeof opts?.angle === "number") row.angle = opts.angle;
      row.nextTickAt = def.tickMs ? now + def.tickMs : 0;
      host.statuses.set(mapKey, row);
    }

    if (def.mechanic === "stun" || def.mechanic === "silence" || def.blocksCast) {
      this.hooks.onInterruptCast?.(targetId, sourceId);
    }
    this.hooks.onStatusApplied?.(targetId, statusId, sourceId);
    if (def.mechanic === "hot") this.hooks.onHotApplied?.(targetId, statusId, sourceId);
    return true;
  }

  private applyHardCcDr(
    targetId: string,
    kind: CcDrKind,
    now: number,
    duration: number,
  ): number {
    const recent = (this.hardCcRecent.get(targetId)?.[kind] ?? []).filter(
      (t) => now - t < HARD_CC_DR_WINDOW_MS,
    );
    const mul = hardCcDrMul(recent.length);
    if (mul <= 0) return 0;
    if (mul >= 0.999) return duration;
    return Math.max(50, Math.round(duration * mul));
  }

  private hasCcDrKind(targetId: string, kind: CcDrKind): boolean {
    const host = this.getHost(targetId);
    if (!host) return false;
    let found = false;
    host.statuses.forEach((row) => {
      if (found) return;
      if (ccDrKind(STATUSES[row.statusId]) === kind) found = true;
    });
    return found;
  }

  private recordHardCc(targetId: string, kind: CcDrKind, now: number) {
    const byType = this.hardCcRecent.get(targetId) ?? {};
    const recent = (byType[kind] ?? []).filter((t) => now - t < HARD_CC_DR_WINDOW_MS);
    recent.push(now);
    byType[kind] = recent;
    this.hardCcRecent.set(targetId, byType);
  }

  /**
   * Refreshes expiration time of all matching `statusId` instances on targetId.
   */
  refreshDuration(targetId: string, statusId: string, now: number): boolean {
    const host = this.getHost(targetId);
    if (!host) return false;
    const def = getStatus(statusId);
    if (!def || def.permanent || def.durationMs <= 0) return false;
    let refreshed = false;
    host.statuses.forEach((row) => {
      if (row.statusId === statusId) {
        row.expiresAt = now + def.durationMs;
        refreshed = true;
      }
    });
    return refreshed;
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
    let mul = combineStatusMoveMul(this.entries(targetId));
    if (mul > 1 && this.has(targetId, "contained")) {
      mul = 1 + (mul - 1) * 0.75;
    }
    return mul;
  }

  /** Incoming damage factor (1 = full; 0.6 = 40% resist). */
  getDamageTakenMul(targetId: string): number {
    return combineStatusDamageTakenMul(this.entries(targetId));
  }

  /** Outgoing damage factor (1 = full; 1.2 = +20% dealt). */
  getDamageDealtMul(attackerId: string): number {
    return combineStatusDamageDealtMul(this.entries(attackerId));
  }

  /** Cast anticipation duration factor (1 = normal; 0.75 = 25% shorter). */
  getAnticipationMul(targetId: string): number {
    return combineStatusAnticipationMul(this.entries(targetId));
  }

  getCastDurationMul(targetId: string): number {
    return combineStatusCastDurationMul(this.entries(targetId));
  }

  /** Full invulnerability from statuses (e.g. Counter riposte). */
  grantsInvulnerable(targetId: string): boolean {
    return statusesGrantInvulnerable(this.entries(targetId));
  }

  /**
   * Absorb damage with shield statuses (`stacks` = remaining HP).
   * Returns damage that should still hit HP.
   */
  absorbWithShields(
    targetId: string,
    damage: number,
    opts?: { onShieldBroken?: (targetId: string, statusId: string) => void },
  ): number {
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
      if (row.stacks <= 0) {
        toRemove.push(key);
        opts?.onShieldBroken?.(targetId, row.statusId);
      }
    });
    for (const key of toRemove) host.statuses.delete(key);
    return remaining;
  }

  getTotalShieldHp(targetId: string): number {
    const host = this.getHost(targetId);
    if (!host) return 0;
    let total = 0;
    host.statuses.forEach((row) => {
      const def = STATUSES[row.statusId];
      if (def?.mechanic === "shield") {
        total += Math.max(0, Math.floor(row.stacks));
      }
    });
    return total;
  }

  canMove(targetId: string): boolean {
    return !statusesBlockMove(this.entries(targetId));
  }

  canCast(targetId: string): boolean {
    return !statusesBlockCast(this.entries(targetId));
  }

  /** Knockback / pull immunity (Iron Guard, Bulwark Charge, …). */
  blocksDisplacement(targetId: string): boolean {
    return statusesBlockDisplacement(this.entries(targetId));
  }

  /**
   * Remove up to `max` dispellable debuffs (ally cleanse).
   * Returns removed status ids.
   */
  dispelDebuffs(targetId: string, max = 1): string[] {
    return this.dispelByFilter(targetId, max, statusIsDebuffDispellable);
  }

  /**
   * Remove up to `max` dispellable buffs (enemy purge).
   * Returns removed status ids.
   */
  dispelBuffs(targetId: string, max = 1): string[] {
    return this.dispelByFilter(targetId, max, statusIsBuffDispellable);
  }

  private dispelByFilter(
    targetId: string,
    max: number,
    filter: (def: StatusDef) => boolean,
  ): string[] {
    const host = this.getHost(targetId);
    if (!host || max <= 0) return [];
    type Cand = { key: string; statusId: string; priority: number };
    const cands: Cand[] = [];
    host.statuses.forEach((row, key) => {
      const def = STATUSES[row.statusId];
      if (!def || !filter(def)) return;
      cands.push({
        key,
        statusId: row.statusId,
        priority: statusDispelPriority(def),
      });
    });
    cands.sort((a, b) => b.priority - a.priority || a.statusId.localeCompare(b.statusId));
    const removed: string[] = [];
    for (const c of cands) {
      if (removed.length >= max) break;
      host.statuses.delete(c.key);
      removed.push(c.statusId);
    }
    return removed;
  }

  private tickHost(targetId: string, host: StatusHost, now: number) {
    const toRemove: string[] = [];
    host.statuses.forEach((row, key) => {
      const def = STATUSES[row.statusId];
      if (!def) {
        toRemove.push(key);
        return;
      }
      if (!def.permanent && now >= row.expiresAt) {
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
        const tickMsMul = this.hooks.hotTickMsMul?.(row.sourceId, targetId, def.id) ?? 1;
        const tickMs = Math.max(50, Math.round(def.tickMs * Math.max(0.25, tickMsMul)));
        while (row.nextTickAt > 0 && now >= row.nextTickAt && now < row.expiresAt) {
          const isLastTick = row.nextTickAt + tickMs >= row.expiresAt;
          const healMul =
            this.hooks.hotHealMul?.(targetId, def.id, row.sourceId, isLastTick) ?? 1;
          const heal = Math.max(1, Math.round(def.healPerTick * Math.max(1, row.stacks) * healMul));
          this.hooks.onHotHeal?.(targetId, heal, def.id, row.sourceId);
          row.nextTickAt += tickMs;
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
