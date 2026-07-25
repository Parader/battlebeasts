import { Room, Client } from "@colyseus/core";
import {
  ABILITIES,
  COSMETIC_COLORS,
  DEFAULT_LOADOUT,
  HUB_SPAWN,
  INTERACT,
  LOADOUT_SIZE,
  MAX_TALENTS,
  SHOP_ITEMS,
  TALENTS,
  TICK_MS,
  addCoins,
  applyMovement,
  applyYaw,
  formatCoins,
  formatShopCost,
  formatWallet,
  HUB_PORTALS,
  HUB_PRACTICE_DUMMIES,
  HUB_STANDS,
  normalizeCoins,
  normalizeLoadout,
  phaseDurationMs,
  resolvePveTransfer,
  spendCoins,
  baseCityStaticColliders,
  pointInInteractZone,
  type PlayerInput,
  type Wallet,
} from "@battlebeasts/shared";
import { verifyJoinOptions, type AuthJoinOptions, type VerifiedIdentity } from "../auth.js";
import { dequeuePvp, enqueuePvp } from "../matchmaking/pvpQueue.js";
import {
  loadEconomy,
  saveInventory,
  saveLoadout,
  saveProfileColor,
  saveTalents,
} from "../persistence.js";
import { takePendingLoot } from "../pendingLoot.js";
import { CombatSystem } from "../combat/CombatSystem.js";
import { BaseCityState, PlayerState } from "../schema/BaseCityState.js";

const DUMMY_COOLDOWN_MS = 1500;
const DUMMY_COPPER_REWARD = 3;
const DUMMY_HIT_COPPER = 1;
/** How often an aggro'd dummy fires bolt at its attacker. */
/** Gap after recovery before the dummy starts another cast. */
const DUMMY_BOLT_GAP_MS = 420;

type DummyAggro = {
  attackerId: string;
  /** When the next cast windup may begin. */
  nextCastAt: number;
  /** Fire bolt at this time (0 = no pending release). */
  pendingReleaseAt: number;
  pendingAimYaw: number;
};

export class BaseCityRoom extends Room<{ state: BaseCityState }> {
  maxClients = 16;
  private inputs = new Map<string, PlayerInput[]>();
  private ownerId: string | null = null;
  private identities = new Map<string, VerifiedIdentity>();
  private dummyCooldownUntil = new Map<string, number>();
  private dummyAggro = new Map<string, DummyAggro>();
  private combat!: CombatSystem;

  onCreate(options: AuthJoinOptions) {
    this.setState(new BaseCityState());
    this.ownerId = options.hubOwnerId ?? null;
    this.combat = new CombatSystem(this as never, {
      canHurtPlayers: false,
      onPlayerDamaged: (sessionId) => {
        const player = this.state.players.get(sessionId);
        if (player && player.hp <= 0) {
          this.softRespawnPlayer(sessionId, player);
        }
      },
      onTargetDamaged: (targetId, _damage, attackerSessionId) => {
        if (!targetId.startsWith("practice_dummy")) return;
        const def = HUB_PRACTICE_DUMMIES.find((d) => d.id === targetId);
        // Left pad is passive practice; right dummy fights back.
        if (def?.retaliates !== false) {
          const prev = this.dummyAggro.get(targetId);
          this.dummyAggro.set(targetId, {
            attackerId: attackerSessionId,
            nextCastAt: prev?.nextCastAt ?? Date.now() + 180,
            pendingReleaseAt: prev?.pendingReleaseAt ?? 0,
            pendingAimYaw: prev?.pendingAimYaw ?? 0,
          });
        }
        const player = this.state.players.get(attackerSessionId);
        const client = this.clients.find((c) => c.sessionId === attackerSessionId);
        if (!player || !client) return;
        this.applyWallet(player, {
          ...addCoins(this.walletOf(player), { copper: DUMMY_HIT_COPPER }),
          essence: player.essence,
        });
        void this.persistInventory(attackerSessionId, player);
        this.sendInventory(client, player);
      },
      onTargetKilled: (targetId) => {
        this.clearDummyCast(targetId);
        this.dummyAggro.delete(targetId);
      },
    });
    for (const d of HUB_PRACTICE_DUMMIES) {
      this.combat.ensurePracticeDummy(d.x, d.z, d.id, d.rotationY ?? 0);
    }
    this.combat.setStaticColliders(baseCityStaticColliders());
    this.setPatchRate(1000 / 30);
    this.setSimulationInterval((dt) => this.tick(dt), TICK_MS);

    this.onMessage("input", (client, message: { input: PlayerInput }) => {
      const queue = this.inputs.get(client.sessionId);
      if (!queue || !message?.input) return;
      queue.push(message.input);
      if (queue.length > 64) queue.shift();
    });

    this.onMessage("set_color", (client, message: { color: string }) => {
      void this.handleSetColor(client, message.color);
    });

    this.onMessage("shop_buy", (client, message: { itemId: string }) => {
      void this.handleShopBuy(client, message.itemId);
    });

    this.onMessage("set_loadout", (client, message: { abilityIds: string[] }) => {
      void this.handleSetLoadout(client, message.abilityIds ?? []);
    });

    this.onMessage("set_talents", (client, message: { talentIds: string[] }) => {
      void this.handleSetTalents(client, message.talentIds ?? []);
    });

    this.onMessage(
      "portal_confirm",
      (
        client,
        message: { portal: "pvp" | "pve"; params?: { modes?: string[]; content?: string; modifiers?: string[] } },
      ) => {
        this.handlePortalConfirm(client, message);
      },
    );

    this.onMessage("queue_cancel", (client) => {
      if (dequeuePvp(this.queueKey(client))) {
        client.send("queue_status", { queued: false });
        client.send("toast", { message: "Left queue" });
      }
    });
  }

  async onAuth(_client: Client, options: AuthJoinOptions) {
    if (!options.hubOwnerId) {
      throw new Error("hubOwnerId is required");
    }
    return verifyJoinOptions(options);
  }

  async onJoin(client: Client, options: AuthJoinOptions, identity?: VerifiedIdentity) {
    const verified =
      identity ??
      ({
        userId: client.sessionId,
        displayName: "Hunter",
        isGuest: true,
      } satisfies VerifiedIdentity);

    this.identities.set(client.sessionId, verified);

    const player = new PlayerState();
    player.id = verified.userId;
    player.displayName = verified.displayName;
    player.x = HUB_SPAWN.x + (Math.random() - 0.5) * 1.2;
    player.z = HUB_SPAWN.z + (Math.random() - 0.5) * 1.2;
    player.loadout = DEFAULT_LOADOUT.join(",");
    player.talents = "";

    if (verified.isGuest) {
      const starter = normalizeCoins({ copper: 75, silver: 2, gold: 0 });
      player.copper = starter.copper;
      player.silver = starter.silver;
      player.gold = starter.gold;
      player.essence = 3;
      player.color =
        verified.color && (COSMETIC_COLORS as readonly string[]).includes(verified.color)
          ? verified.color
          : COSMETIC_COLORS[0];
    } else {
      const eco = await loadEconomy(verified.userId);
      player.copper = eco.copper;
      player.silver = eco.silver;
      player.gold = eco.gold;
      player.essence = eco.essence;
      player.loadout = normalizeLoadout(eco.abilityIds).join(",");
      player.talents = eco.talentIds.slice(0, MAX_TALENTS).join(",");
      player.color =
        (eco.color && (COSMETIC_COLORS as readonly string[]).includes(eco.color)
          ? eco.color
          : verified.color && (COSMETIC_COLORS as readonly string[]).includes(verified.color)
            ? verified.color
            : COSMETIC_COLORS[0]);
      if (player.copper === 0 && player.silver === 0 && player.gold === 0 && player.essence === 0) {
        const soft = normalizeCoins({ copper: 50, silver: 1, gold: 0 });
        player.copper = soft.copper;
        player.silver = soft.silver;
        player.gold = soft.gold;
        player.essence = 2;
        void saveInventory(verified.userId, this.walletOf(player));
      }
    }

    this.state.players.set(client.sessionId, player);
    this.inputs.set(client.sessionId, []);

    const loot = takePendingLoot(verified.userId);
    if (loot && (loot.copper > 0 || loot.silver > 0 || loot.gold > 0 || loot.essence > 0)) {
      const coins = addCoins(this.walletOf(player), loot);
      this.applyWallet(player, { ...coins, essence: player.essence + loot.essence });
      void this.persistInventory(client.sessionId, player);
      client.send("toast", {
        message: `Loot: ${formatWallet(loot)}`,
      });
    }

    if (!this.ownerId) this.ownerId = options.hubOwnerId ?? verified.userId;

    const visiting = this.ownerId && verified.userId !== this.ownerId;
    client.send("toast", {
      message: verified.isGuest
        ? "Welcome (guest) — blast the dummy with abilities for copper"
        : visiting
          ? `Visiting hub`
          : `Welcome home, ${verified.displayName}`,
    });
    this.sendInventory(client, player);
  }

  async onLeave(client: Client, consented: boolean) {
    dequeuePvp(this.queueKey(client));
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    player.disconnected = true;

    try {
      if (!consented) {
        await this.allowReconnection(client, 60);
        player.disconnected = false;
        return;
      }
    } catch {
      // reconnection window expired
    }

    this.state.players.delete(client.sessionId);
    this.inputs.delete(client.sessionId);
    this.identities.delete(client.sessionId);
    this.dummyCooldownUntil.delete(client.sessionId);
    this.combat.clearSession(client.sessionId);
  }

  private queueKey(client: Client) {
    return `${this.roomId}:${client.sessionId}`;
  }

  private walletOf(player: PlayerState): Wallet {
    return {
      copper: player.copper,
      silver: player.silver,
      gold: player.gold,
      essence: player.essence,
    };
  }

  private applyWallet(player: PlayerState, wallet: Wallet) {
    const coins = normalizeCoins(wallet);
    player.copper = coins.copper;
    player.silver = coins.silver;
    player.gold = coins.gold;
    player.essence = wallet.essence;
  }

  private sendInventory(client: Client, player: PlayerState) {
    const wallet = this.walletOf(player);
    client.send("inventory", {
      resources: {
        copper: wallet.copper,
        silver: wallet.silver,
        gold: wallet.gold,
        essence: wallet.essence,
      },
      loadout: player.loadout.split(",").filter(Boolean),
      talents: player.talents.split(",").filter(Boolean),
    });
  }

  private async persistInventory(sessionId: string, player: PlayerState) {
    const identity = this.identities.get(sessionId);
    if (!identity || identity.isGuest) return;
    await saveInventory(identity.userId, this.walletOf(player));
  }

  private async handleSetColor(client: Client, color: string) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    if (!(COSMETIC_COLORS as readonly string[]).includes(color)) return;
    player.color = color;
    const identity = this.identities.get(client.sessionId);
    if (identity && !identity.isGuest) {
      await saveProfileColor(identity.userId, color);
    }
    client.send("toast", { message: "Color updated" });
  }

  private async handleShopBuy(client: Client, itemId: string) {
    const player = this.state.players.get(client.sessionId);
    const item = SHOP_ITEMS[itemId];
    if (!player || !item) {
      client.send("toast", { message: "Unknown item" });
      return;
    }

    if (item.cost.kind === "coins") {
      const next = spendCoins(this.walletOf(player), item.cost.copper);
      if (!next) {
        client.send("toast", { message: `Need ${formatShopCost(item.cost)}` });
        return;
      }
      this.applyWallet(player, { ...next, essence: player.essence });
    } else {
      if (player.essence < item.cost.amount) {
        client.send("toast", { message: `Need ${item.cost.amount} essence` });
        return;
      }
      player.essence -= item.cost.amount;
    }

    if (itemId === "health_tonic") {
      player.hp = Math.min(player.maxHp, player.hp + 25);
      client.send("toast", { message: "Health tonic — +25 HP" });
    } else if (itemId === "paint_red") {
      player.color = "#ef4444";
      const identity = this.identities.get(client.sessionId);
      if (identity && !identity.isGuest) await saveProfileColor(identity.userId, player.color);
      client.send("toast", { message: "Crimson paint applied" });
    } else if (itemId === "copper_pouch") {
      this.applyWallet(player, { ...addCoins(this.walletOf(player), { copper: 80 }), essence: player.essence });
      client.send("toast", { message: `+${formatCoins({ copper: 80, silver: 0, gold: 0 })}` });
    } else {
      client.send("toast", { message: `Bought ${item.name}` });
    }

    await this.persistInventory(client.sessionId, player);
    this.sendInventory(client, player);
  }

  private async handleSetLoadout(client: Client, abilityIds: string[]) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const cleaned = abilityIds.filter((id) => id in ABILITIES);
    if (cleaned.length !== LOADOUT_SIZE) {
      client.send("toast", { message: `Assign all ${LOADOUT_SIZE} slots` });
      return;
    }
    if (new Set(cleaned).size !== cleaned.length) {
      client.send("toast", { message: "Duplicate abilities not allowed" });
      return;
    }

    player.loadout = cleaned.join(",");
    const identity = this.identities.get(client.sessionId);
    if (identity && !identity.isGuest) await saveLoadout(identity.userId, cleaned);
    this.sendInventory(client, player);
    client.send("toast", { message: "Loadout saved" });
  }

  private async handleSetTalents(client: Client, talentIds: string[]) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const cleaned = talentIds.filter((id) => id in TALENTS).slice(0, MAX_TALENTS);
    if (new Set(cleaned).size !== cleaned.length) {
      client.send("toast", { message: "Duplicate talents not allowed" });
      return;
    }

    player.talents = cleaned.join(",");
    // Apply shallow effects for v0
    player.maxHp = 100 + (cleaned.includes("tough") ? 10 : 0);
    player.hp = Math.min(player.hp, player.maxHp);

    const identity = this.identities.get(client.sessionId);
    if (identity && !identity.isGuest) await saveTalents(identity.userId, cleaned);
    this.sendInventory(client, player);
    client.send("toast", { message: cleaned.length ? "Talents updated" : "Talents cleared" });
  }

  private handlePortalConfirm(
    client: Client,
    message: { portal: "pvp" | "pve"; params?: { modes?: string[]; content?: string; modifiers?: string[] } },
  ) {
    if (!message?.portal) return;

    if (message.portal === "pvp") {
      const modes = (message.params?.modes ?? []).filter(Boolean);
      if (modes.length === 0) {
        client.send("toast", { message: "Pick at least one PvP mode" });
        return;
      }

      enqueuePvp({
        key: this.queueKey(client),
        client,
        modes,
        hubOwnerId: this.ownerId,
      });
      return;
    }

    const contentId = message.params?.content ?? "dungeon";
    const modifiers = message.params?.modifiers ?? [];
    const transfer = resolvePveTransfer(contentId);
    client.send("transfer", {
      room: transfer.room,
      options: {
        mode: transfer.mode,
        modifiers,
        hubOwnerId: this.ownerId,
        matchId: `pve_${transfer.mode}_${client.sessionId}`,
      },
    });
  }

  private tick(dtMs: number) {
    const dt = dtMs / 1000;
    this.state.tick += 1;
    const now = Date.now();

    for (const [sessionId, player] of this.state.players.entries()) {
      if (player.disconnected) continue;

      const queue = this.inputs.get(sessionId) ?? [];
      while (queue.length > 0) {
        const input = queue.shift()!;
        player.lastInputSeq = input.seq;

        const speed = this.combat.getEffectiveMoveSpeed(sessionId);
        const from = { x: player.x, z: player.z };
        const desired = applyMovement(
          from,
          { moveX: input.moveX, moveZ: input.moveZ, dt: input.dt || dt },
          speed,
        );
        const next = this.combat.movePlayer(sessionId, from, desired);
        player.x = next.x;
        player.z = next.z;
        player.yaw = applyYaw(player.yaw, input.yaw);

        if (input.cancelCast) {
          this.combat.tryCancelCast(sessionId, player, now);
        }
          if (input.castId) {
            this.combat.tryBeginCast(sessionId, player, input.castId, now, {
              moveX: input.moveX,
              moveZ: input.moveZ,
            });
          }

        if (input.interactId) {
          this.handleInteract(sessionId, player, input.interactId, now);
        }
      }
    }

    this.combat.tick(dt, now);
    this.tickDummyAggro(now);
  }

  /** Aggro'd practice dummies cast bolt (with anim) at their attacker until death. */
  private clearDummyCast(dummyId: string) {
    const dummy = this.state.targets.get(dummyId);
    if (!dummy) return;
    dummy.castAbilityId = "";
    dummy.castPhase = "";
    dummy.castLockUntil = 0;
  }

  private clearAllDummyAggro() {
    for (const dummyId of this.dummyAggro.keys()) {
      this.clearDummyCast(dummyId);
    }
    this.dummyAggro.clear();
  }

  /** Soft-death: full HP at town center, deaggro every dummy. */
  private softRespawnPlayer(sessionId: string, player: PlayerState) {
    player.hp = player.maxHp;
    player.x = HUB_SPAWN.x;
    player.z = HUB_SPAWN.z;
    player.yaw = 0;
    player.castAbilityId = "";
    player.castPhase = "";
    player.castLockUntil = 0;
    player.castPhaseEndsAt = 0;
    player.castComboHit = 0;
    player.invulnerable = false;
    player.statuses.clear();
    this.combat.clearSession(sessionId);
    this.clearAllDummyAggro();
  }

  private tickDummyAggro(now: number) {
    const bolt = ABILITIES.bolt;
    if (!bolt) return;
    const windupMs =
      phaseDurationMs(bolt, "anticipation") + phaseDurationMs(bolt, "cast");
    const impactMs = phaseDurationMs(bolt, "impact");
    const recoveryMs = phaseDurationMs(bolt, "recovery");
    const totalMs = windupMs + impactMs + recoveryMs;
    const maxRange = bolt.range ?? 12;

    for (const [dummyId, aggro] of [...this.dummyAggro.entries()]) {
      const dummy = this.state.targets.get(dummyId);
      const player = this.state.players.get(aggro.attackerId);
      if (
        !dummy ||
        !player ||
        player.disconnected ||
        !dummyId.startsWith("practice_dummy")
      ) {
        this.clearDummyCast(dummyId);
        this.dummyAggro.delete(dummyId);
        continue;
      }
      if (player.hp <= 0) {
        this.softRespawnPlayer(aggro.attackerId, player);
        continue;
      }

      // While cloaked, shoot the drifting decoy — never the invisible player.
      const aimAt = this.resolveDummyAimPoint(aggro.attackerId);
      if (!aimAt) {
        // Cloaked with no decoy left: hold fire, stay aggro'd.
        if (aggro.pendingReleaseAt > 0) {
          aggro.pendingReleaseAt = 0;
          this.clearDummyCast(dummyId);
        }
        continue;
      }

      const dx = aimAt.x - dummy.x;
      const dz = aimAt.z - dummy.z;
      const dist = Math.hypot(dx, dz);
      const aimYaw = dist > 1e-4 ? Math.atan2(dx, dz) : dummy.yaw;
      dummy.yaw = aimYaw;
      // Keep mid-cast bolts tracking the decoy as it drifts.
      if (aggro.pendingReleaseAt > 0) {
        aggro.pendingAimYaw = aimYaw;
      }

      // Release: fire projectile at end of cast windup.
      if (aggro.pendingReleaseAt > 0 && now >= aggro.pendingReleaseAt) {
        this.combat.fireProjectileFrom(
          dummyId,
          {
            id: dummyId,
            x: dummy.x,
            z: dummy.z,
            yaw: aggro.pendingAimYaw,
            hp: dummy.hp,
            maxHp: dummy.maxHp,
            vulnerable: true,
          },
          "bolt",
        );
        dummy.castPhase = "impact";
        aggro.pendingReleaseAt = 0;
        aggro.nextCastAt = now + impactMs + recoveryMs + DUMMY_BOLT_GAP_MS;
      }

      // Advance impact → recovery using the stable castLockUntil end stamp.
      if (dummy.castAbilityId === "bolt" && dummy.castLockUntil > 0) {
        const castEnd = dummy.castLockUntil;
        const recoveryStart = castEnd - recoveryMs;
        const impactStart = recoveryStart - impactMs;
        if (now >= castEnd) {
          this.clearDummyCast(dummyId);
        } else if (now >= recoveryStart) {
          dummy.castPhase = "recovery";
        } else if (now >= impactStart) {
          dummy.castPhase = "impact";
        }
      }

      if (dist > maxRange + 0.5 || dist < 1e-4) {
        // Stay aggro'd but don't start casts out of range.
        continue;
      }

      // Begin next cast windup (castLockUntil stays fixed for the whole cast → stable anim key).
      if (
        aggro.pendingReleaseAt <= 0 &&
        now >= aggro.nextCastAt &&
        !dummy.castAbilityId
      ) {
        dummy.castAbilityId = "bolt";
        dummy.castPhase = "cast";
        dummy.castLockUntil = now + totalMs;
        dummy.yaw = aimYaw;
        aggro.pendingAimYaw = aimYaw;
        aggro.pendingReleaseAt = now + windupMs;
      }
    }
  }

  /**
   * Aim point for dummy retaliation.
   * Cloaked → owner's decoy (null if none). Otherwise → player.
   */
  private resolveDummyAimPoint(attackerId: string): { x: number; z: number } | null {
    const player = this.state.players.get(attackerId);
    if (!player) return null;
    if (player.statuses.get("cloaked")) {
      let decoy: { x: number; z: number } | null = null;
      this.state.decoys.forEach((d) => {
        if (!decoy && d.ownerSessionId === attackerId) {
          decoy = { x: d.x, z: d.z };
        }
      });
      return decoy;
    }
    return { x: player.x, z: player.z };
  }

  private handleInteract(sessionId: string, player: PlayerState, interactId: string, now: number) {
    const client = this.clients.find((c) => c.sessionId === sessionId);
    if (!client) return;

    this.combat.revealCloak(sessionId);

    const stand = HUB_STANDS.find((s) => s.id === interactId);
    if (stand) {
      if (pointInInteractZone(player.x, player.z, stand)) {
        client.send("ui", { ui: stand.kind });
        this.sendInventory(client, player);
      }
      return;
    }

    const portal = HUB_PORTALS.find((p) => p.id === interactId);
    if (portal) {
      if (pointInInteractZone(player.x, player.z, portal)) {
        client.send("ui", { ui: portal.id === "portal_pvp" ? "portal_pvp" : "portal_pve" });
      }
      return;
    }

    const dummy = HUB_PRACTICE_DUMMIES.find((d) => d.id === interactId);
    if (dummy || interactId === INTERACT.PRACTICE_DUMMY) {
      const target = dummy ?? HUB_PRACTICE_DUMMIES[0]!;
      if (!pointInInteractZone(player.x, player.z, target)) return;

      const until = this.dummyCooldownUntil.get(sessionId) ?? 0;
      if (now < until) {
        client.send("toast", { message: "Dummy recovering…" });
        return;
      }
      this.dummyCooldownUntil.set(sessionId, now + DUMMY_COOLDOWN_MS);
      this.applyWallet(player, {
        ...addCoins(this.walletOf(player), { copper: DUMMY_COPPER_REWARD }),
        essence: player.essence,
      });
      void this.persistInventory(sessionId, player);
      this.sendInventory(client, player);
      client.send("toast", { message: `+${DUMMY_COPPER_REWARD}c` });
    }
  }
}
