import { STATUSES } from "@battlebeasts/shared";

export type StatusRowLite = {
  statusId: string;
  stacks?: number;
  expiresAt?: number;
  startedAt?: number;
  angle?: number;
};

export type StatusMapLike =
  | {
      forEach: (
        cb: (row: { statusId?: string; stacks?: number; expiresAt?: number; startedAt?: number; angle?: number }) => void,
      ) => void;
    }
  | null
  | undefined;

const EMPTY_STATUS_ROWS: StatusRowLite[] = [];

/** Read active status rows from a Colyseus MapSchema-like object. */
export function collectStatusRows(map: StatusMapLike): StatusRowLite[] {
  if (!map) return EMPTY_STATUS_ROWS;
  const rows: StatusRowLite[] = [];
  map.forEach((row) => {
    if (row?.statusId && STATUSES[row.statusId]) {
      rows.push({
        statusId: row.statusId,
        stacks: row.stacks ?? 1,
        expiresAt: row.expiresAt,
        startedAt: row.startedAt,
        angle: row.angle,
      });
    }
  });
  return rows.length === 0 ? EMPTY_STATUS_ROWS : rows;
}

export function hasStatusId(map: StatusMapLike, statusId: string): boolean {
  if (!map) return false;
  let found = false;
  map.forEach((row) => {
    if (row?.statusId === statusId) found = true;
  });
  return found;
}

/** Cloak / Revenge vanish — hide auras, pulses, and lock-on chrome. */
export function isStealthedStatus(map: StatusMapLike): boolean {
  return hasStatusId(map, "cloaked") || hasStatusId(map, "revengePhased");
}

/** Status ids that show the poison badge above HP bars. */
export const POISON_BADGE_IDS = new Set(["poisoned"]);

/** Status ids that show the burning badge above HP bars. */
export const BURNING_BADGE_IDS = new Set(["burning"]);

/** Status ids that show the bleed badge above HP bars. */
export const BLEEDING_BADGE_IDS = new Set(["bleeding"]);

/** Status ids that show the rejuvenation badge above HP bars. */
export const REJUVENATION_BADGE_IDS = new Set(["rejuvenated", "overflowingGraceHot"]);

/** Status ids that show the silence badge above HP bars. */
export const SILENCE_BADGE_IDS = new Set(["silenced"]);

/** Status ids that show the holy blessing badge above HP bars. */
export const HOLY_BADGE_IDS = new Set([
  "holyBlessed",
  "lastingGrace",
  "rebirthBlessing",
  "rebirthPending",
]);

/** Status ids that show the Blood Pact empower badge above HP bars. */
export const BLOOD_PACT_BADGE_IDS = new Set(["bloodPactEmpower"]);

/** Status ids that show the Soul Mark badge above HP bars. */
export const SOUL_MARK_BADGE_IDS = new Set(["soulMarked"]);

/** Status ids that show the Soul Sever badge above HP bars. */
export const SOUL_SEVER_BADGE_IDS = new Set(["soulSevered"]);

/** Status ids that show the Chilled badge above HP bars (Frost Mist / Runic Shard). */
export const CHILL_BADGE_IDS = new Set(["frostChill"]);

/** Status ids that show the Shocked badge above HP bars (Chain Lightning, Arc Thread, Surge, Wild Infusion). */
export const SHOCK_BADGE_IDS = new Set(["shocked"]);

/** Status ids that show the Slowed badge above HP bars (Underground Pulse, Gravity Field, etc.). */
export const SLOW_BADGE_IDS = new Set(["slowed", "gravityFieldSlow"]);

/** Status ids that show the Haste badge above HP bars. */
export const HASTE_BADGE_IDS = new Set([
  "slipstreamHaste",
  "verdantHaste",
  "predatorHaste",
  "surged",
  "conductiveSurge",
  "empathicSurge",
  "upliftingPresence",
  "harmoniousGrowth",
  "inspiringRecovery",
  "battleRhythm",
]);

/** Status ids that show the Soul Relay badge above HP bars. */
export const RELAY_BADGE_IDS = new Set(["soulRelayLinked"]);

/** Status ids that show the Spellbreaker orb badge above HP bars. */
export const SPELLBREAKER_BADGE_IDS = new Set(["spellbreakerCharge"]);

export type BadgeRead = {
  stacks: number;
  expiresAt: number;
  startedAt?: number;
  /** Winning status id when multiple ids share a badge slot. */
  statusId?: string;
};

export const BADGE_SIZE = 20;
export const RING_R = 8.25;
export const RING_C = 2 * Math.PI * RING_R;

export function readBadge(rows: StatusRowLite[], ids: Set<string>): BadgeRead {
  let stacks = 0;
  let expiresAt = 0;
  let startedAt = 0;
  let statusId: string | undefined;
  for (const row of rows) {
    if (!row.statusId || !ids.has(row.statusId)) continue;
    const s = row.stacks ?? 1;
    const exp = row.expiresAt ?? 0;
    if (exp > expiresAt || (exp === expiresAt && s >= stacks)) {
      stacks = Math.max(stacks, s);
      expiresAt = Math.max(expiresAt, exp);
      startedAt = row.startedAt ?? 0;
      statusId = row.statusId;
    }
  }
  return { stacks, expiresAt, startedAt, statusId };
}

export function readPoisonStacks(rows: StatusRowLite[]): number {
  return readBadge(rows, POISON_BADGE_IDS).stacks;
}

export function readBurningStacks(rows: StatusRowLite[]): number {
  return readBadge(rows, BURNING_BADGE_IDS).stacks;
}

export function readBleedingStacks(rows: StatusRowLite[]): number {
  return readBadge(rows, BLEEDING_BADGE_IDS).stacks;
}

export function readRejuvenationStacks(rows: StatusRowLite[]): number {
  return readBadge(rows, REJUVENATION_BADGE_IDS).stacks;
}

export function readPoisonBadge(rows: StatusRowLite[]): BadgeRead {
  return readBadge(rows, POISON_BADGE_IDS);
}

export function readBurningBadge(rows: StatusRowLite[]): BadgeRead {
  return readBadge(rows, BURNING_BADGE_IDS);
}

export function readBleedingBadge(rows: StatusRowLite[]): BadgeRead {
  return readBadge(rows, BLEEDING_BADGE_IDS);
}

export function readRejuvenationBadge(rows: StatusRowLite[]): BadgeRead {
  return readBadge(rows, REJUVENATION_BADGE_IDS);
}

export function readSilenceBadge(rows: StatusRowLite[]): BadgeRead {
  return readBadge(rows, SILENCE_BADGE_IDS);
}

export function readHolyBadge(rows: StatusRowLite[]): BadgeRead {
  return readBadge(rows, HOLY_BADGE_IDS);
}

export function readBloodPactBadge(rows: StatusRowLite[]): BadgeRead {
  return readBadge(rows, BLOOD_PACT_BADGE_IDS);
}

export function readSoulMarkBadge(rows: StatusRowLite[]): BadgeRead {
  return readBadge(rows, SOUL_MARK_BADGE_IDS);
}

export function readSoulMarkStacks(rows: StatusRowLite[]): number {
  return readBadge(rows, SOUL_MARK_BADGE_IDS).stacks;
}

export function readSoulSeverBadge(rows: StatusRowLite[]): BadgeRead {
  return readBadge(rows, SOUL_SEVER_BADGE_IDS);
}

export function readChillBadge(rows: StatusRowLite[]): BadgeRead {
  return readBadge(rows, CHILL_BADGE_IDS);
}

export function readChillStacks(rows: StatusRowLite[]): number {
  return readBadge(rows, CHILL_BADGE_IDS).stacks;
}

export function readShockBadge(rows: StatusRowLite[]): BadgeRead {
  return readBadge(rows, SHOCK_BADGE_IDS);
}

export function readShockStacks(rows: StatusRowLite[]): number {
  return readBadge(rows, SHOCK_BADGE_IDS).stacks;
}

export function readSlowBadge(rows: StatusRowLite[]): BadgeRead {
  return readBadge(rows, SLOW_BADGE_IDS);
}

export function readHasteBadge(rows: StatusRowLite[]): BadgeRead {
  return readBadge(rows, HASTE_BADGE_IDS);
}

export function readRelayBadge(rows: StatusRowLite[]): BadgeRead {
  return readBadge(rows, RELAY_BADGE_IDS);
}

export function readSpellbreakerBadge(rows: StatusRowLite[]): BadgeRead {
  return readBadge(rows, SPELLBREAKER_BADGE_IDS);
}

export function durationMsFor(statusId: string): number {
  return Math.max(1, STATUSES[statusId]?.durationMs ?? 3000);
}

/** Remaining fraction 1 → 0 from server expiresAt, using apply start when known. */
export function badgeRemainFrac(
  expiresAt: number,
  durationMs: number,
  now = Date.now(),
  startedAt = 0,
): number {
  if (!(expiresAt > 0)) return 0;
  const left = Math.max(0, expiresAt - now);
  const span =
    startedAt > 0 && expiresAt > startedAt ? expiresAt - startedAt : durationMs;
  return Math.max(0, Math.min(1, left / Math.max(1, span)));
}

export function badgeRemainFromRead(
  read: BadgeRead,
  fallbackDurationMs: number,
  now = Date.now(),
): number {
  return badgeRemainFrac(read.expiresAt, fallbackDurationMs, now, read.startedAt ?? 0);
}

export function setRingRemain(ring: SVGCircleElement | null, remain: number) {
  if (!ring) return;
  ring.style.strokeDashoffset = String(RING_C * (1 - remain));
}

export function syncPoisonBadge(
  badge: HTMLDivElement | null,
  stacksEl: HTMLSpanElement | null,
  ring: SVGCircleElement | null,
  read: BadgeRead,
  lastStacks: { current: number },
) {
  if (!badge) return;
  if (read.stacks <= 0) {
    badge.style.display = "none";
    lastStacks.current = 0;
    return;
  }
  badge.style.display = "flex";
  if (read.stacks !== lastStacks.current) {
    lastStacks.current = read.stacks;
    if (stacksEl) stacksEl.textContent = String(read.stacks);
  }
  setRingRemain(ring, badgeRemainFromRead(read, durationMsFor("poisoned")));
}

export function syncBurningBadge(
  badge: HTMLDivElement | null,
  ring: SVGCircleElement | null,
  read: BadgeRead,
) {
  if (!badge) return;
  if (read.stacks <= 0) {
    badge.style.display = "none";
    return;
  }
  badge.style.display = "flex";
  setRingRemain(ring, badgeRemainFromRead(read, durationMsFor("burning")));
}

export function syncBleedingBadge(
  badge: HTMLDivElement | null,
  stacksEl: HTMLSpanElement | null,
  ring: SVGCircleElement | null,
  read: BadgeRead,
  lastStacks: { current: number },
) {
  if (!badge) return;
  if (read.stacks <= 0) {
    badge.style.display = "none";
    lastStacks.current = 0;
    return;
  }
  badge.style.display = "flex";
  if (read.stacks !== lastStacks.current) {
    lastStacks.current = read.stacks;
    if (stacksEl) stacksEl.textContent = String(read.stacks);
  }
  setRingRemain(ring, badgeRemainFromRead(read, durationMsFor("bleeding")));
}

export function syncSoulSeverBadge(
  badge: HTMLDivElement | null,
  ring: SVGCircleElement | null,
  read: BadgeRead,
) {
  if (!badge) return;
  if (read.stacks <= 0) {
    badge.style.display = "none";
    return;
  }
  badge.style.display = "flex";
  setRingRemain(ring, badgeRemainFromRead(read, durationMsFor("soulSevered")));
}

export function syncRejuvenationBadge(
  badge: HTMLDivElement | null,
  stacksEl: HTMLSpanElement | null,
  ring: SVGCircleElement | null,
  read: BadgeRead,
  lastStacks: { current: number },
) {
  if (!badge) return;
  if (read.stacks <= 0) {
    badge.style.display = "none";
    lastStacks.current = 0;
    return;
  }
  badge.style.display = "flex";
  if (read.stacks !== lastStacks.current) {
    lastStacks.current = read.stacks;
    if (stacksEl) stacksEl.textContent = String(read.stacks);
  }
  setRingRemain(ring, badgeRemainFromRead(read, durationMsFor("rejuvenated")));
}

export function syncSilenceBadge(
  badge: HTMLDivElement | null,
  ring: SVGCircleElement | null,
  read: BadgeRead,
) {
  if (!badge) return;
  if (read.stacks <= 0) {
    badge.style.display = "none";
    return;
  }
  badge.style.display = "flex";
  setRingRemain(ring, badgeRemainFromRead(read, durationMsFor("silenced")));
}

export function syncHolyBadge(
  badge: HTMLDivElement | null,
  ring: SVGCircleElement | null,
  read: BadgeRead,
) {
  if (!badge) return;
  if (read.stacks <= 0) {
    badge.style.display = "none";
    return;
  }
  badge.style.display = "flex";
  const def = STATUSES[read.statusId ?? "holyBlessed"];
  if (def?.isAura || read.statusId === "holyBlessed") {
    setRingRemain(ring, 1);
    return;
  }
  const span = Math.max(durationMsFor("holyBlessed"), 6500);
  setRingRemain(ring, badgeRemainFromRead(read, span));
}

export function syncBloodPactBadge(
  badge: HTMLDivElement | null,
  ring: SVGCircleElement | null,
  read: BadgeRead,
) {
  if (!badge) return;
  if (read.stacks <= 0) {
    badge.style.display = "none";
    return;
  }
  badge.style.display = "flex";
  setRingRemain(ring, badgeRemainFromRead(read, durationMsFor("bloodPactEmpower")));
}

export function syncSoulMarkBadge(
  badge: HTMLDivElement | null,
  stacksEl: HTMLSpanElement | null,
  ring: SVGCircleElement | null,
  read: BadgeRead,
  lastStacks: { current: number },
) {
  if (!badge) return;
  if (read.stacks <= 0) {
    badge.style.display = "none";
    lastStacks.current = 0;
    return;
  }
  badge.style.display = "flex";
  if (read.stacks !== lastStacks.current) {
    lastStacks.current = read.stacks;
    if (stacksEl) stacksEl.textContent = String(read.stacks);
  }
  setRingRemain(ring, badgeRemainFromRead(read, durationMsFor("soulMarked")));
}

export function syncChillBadge(
  badge: HTMLDivElement | null,
  stacksEl: HTMLSpanElement | null,
  ring: SVGCircleElement | null,
  read: BadgeRead,
  lastStacks: { current: number },
) {
  if (!badge) return;
  if (read.stacks <= 0) {
    badge.style.display = "none";
    lastStacks.current = 0;
    return;
  }
  badge.style.display = "flex";
  if (read.stacks !== lastStacks.current) {
    lastStacks.current = read.stacks;
    if (stacksEl) stacksEl.textContent = String(read.stacks);
  }
  setRingRemain(ring, badgeRemainFromRead(read, durationMsFor("frostChill")));
}

export function syncShockBadge(
  badge: HTMLDivElement | null,
  stacksEl: HTMLSpanElement | null,
  ring: SVGCircleElement | null,
  read: BadgeRead,
  lastStacks: { current: number },
) {
  if (!badge) return;
  if (read.stacks <= 0) {
    badge.style.display = "none";
    lastStacks.current = 0;
    return;
  }
  badge.style.display = "flex";
  if (read.stacks !== lastStacks.current) {
    lastStacks.current = read.stacks;
    if (stacksEl) stacksEl.textContent = String(read.stacks);
  }
  setRingRemain(ring, badgeRemainFromRead(read, durationMsFor("shocked")));
}

export function syncHasteBadge(
  badge: HTMLDivElement | null,
  ring: SVGCircleElement | null,
  read: BadgeRead,
) {
  if (!badge) return;
  if (read.stacks <= 0) {
    badge.style.display = "none";
    return;
  }
  badge.style.display = "flex";
  const def = STATUSES[read.statusId ?? "slipstreamHaste"];
  if (def?.isAura) {
    setRingRemain(ring, 1);
    return;
  }
  const span = durationMsFor(read.statusId ?? "slipstreamHaste");
  setRingRemain(ring, badgeRemainFromRead(read, span));
}

export function syncRelayBadge(
  badge: HTMLDivElement | null,
  ring: SVGCircleElement | null,
  read: BadgeRead,
) {
  if (!badge) return;
  if (read.stacks <= 0) {
    badge.style.display = "none";
    return;
  }
  badge.style.display = "flex";
  setRingRemain(ring, badgeRemainFromRead(read, durationMsFor("soulRelayLinked")));
}

export function syncSpellbreakerBadge(
  badge: HTMLDivElement | null,
  stacksEl: HTMLSpanElement | null,
  ring: SVGCircleElement | null,
  read: BadgeRead,
  lastStacks: { current: number },
) {
  if (!badge) return;
  if (read.stacks <= 0) {
    badge.style.display = "none";
    lastStacks.current = 0;
    return;
  }
  badge.style.display = "flex";
  if (read.stacks !== lastStacks.current) {
    lastStacks.current = read.stacks;
    if (stacksEl) stacksEl.textContent = String(read.stacks);
  }
  setRingRemain(ring, badgeRemainFromRead(read, durationMsFor("spellbreakerCharge")));
}

export function syncSlowBadge(
  badge: HTMLDivElement | null,
  ring: SVGCircleElement | null,
  read: BadgeRead,
) {
  if (!badge) return;
  if (read.stacks <= 0) {
    badge.style.display = "none";
    return;
  }
  badge.style.display = "flex";
  const def = STATUSES[read.statusId ?? "slowed"];
  if (def?.isAura || read.statusId === "gravityFieldSlow") {
    setRingRemain(ring, 1);
    return;
  }
  setRingRemain(ring, badgeRemainFromRead(read, durationMsFor(read.statusId ?? "slowed")));
}
