import { Room, Client } from "@colyseus/core";
import {
  TICK_MS,
  applyMovement,
  applyYaw,
  BASE_CITY_PORTALS,
  BASE_CITY_STANDS,
  COSMETIC_COLORS,
  INTERACT,
  type PlayerInput,
} from "@battlebeasts/shared";
import { verifyJoinOptions, type AuthJoinOptions } from "../auth.js";
import { BaseCityState, PlayerState } from "../schema/BaseCityState.js";

const INTERACT_RANGE = 2.5;

export class BaseCityRoom extends Room<{ state: BaseCityState }> {
  maxClients = 16;
  private inputs = new Map<string, PlayerInput[]>();
  private ownerId: string | null = null;

  onCreate(_options: AuthJoinOptions) {
    this.setState(new BaseCityState());
    this.setSimulationInterval((dt) => this.tick(dt), TICK_MS);

    this.onMessage("input", (client, message: { input: PlayerInput }) => {
      const queue = this.inputs.get(client.sessionId);
      if (!queue || !message?.input) return;
      queue.push(message.input);
      if (queue.length > 64) queue.shift();
    });

    this.onMessage("set_color", (client, message: { color: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if ((COSMETIC_COLORS as readonly string[]).includes(message.color)) {
        player.color = message.color;
      }
    });
  }

  async onAuth(_client: Client, options: AuthJoinOptions) {
    return verifyJoinOptions(options);
  }

  onJoin(client: Client, _options: AuthJoinOptions, identity?: Awaited<ReturnType<typeof verifyJoinOptions>>) {
    const verified = identity ?? {
      userId: client.sessionId,
      displayName: "Hunter",
      isGuest: true,
    };

    const player = new PlayerState();
    player.id = verified.userId;
    player.displayName = verified.displayName;
    player.color =
      verified.color && (COSMETIC_COLORS as readonly string[]).includes(verified.color)
        ? verified.color
        : COSMETIC_COLORS[0];
    player.x = (Math.random() - 0.5) * 2;
    player.z = (Math.random() - 0.5) * 2;
    this.state.players.set(client.sessionId, player);
    this.inputs.set(client.sessionId, []);

    if (!this.ownerId) this.ownerId = player.id;

    client.send("toast", {
      message: verified.isGuest ? "Welcome (guest)" : `Welcome, ${verified.displayName}`,
    });
  }

  async onLeave(client: Client, consented: boolean) {
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

        const next = applyMovement(
          { x: player.x, z: player.z },
          { moveX: input.moveX, moveZ: input.moveZ, dt: input.dt || dt },
        );
        player.x = next.x;
        player.z = next.z;
        player.yaw = applyYaw(player.yaw, input.yaw);

        if (input.interactId) {
          this.handleInteract(sessionId, player, input.interactId, now);
        }
      }
    }
  }

  private handleInteract(
    sessionId: string,
    player: PlayerState,
    interactId: string,
    _now: number,
  ) {
    const client = this.clients.find((c) => c.sessionId === sessionId);
    if (!client) return;

    const stand = BASE_CITY_STANDS.find((s) => s.id === interactId);
    if (stand) {
      const dist = Math.hypot(player.x - stand.x, player.z - stand.z);
      if (dist <= INTERACT_RANGE) {
        client.send("ui", { ui: stand.kind });
      }
      return;
    }

    const portal = BASE_CITY_PORTALS.find((p) => p.id === interactId);
    if (portal) {
      const dist = Math.hypot(player.x - portal.x, player.z - portal.z);
      if (dist <= INTERACT_RANGE) {
        client.send("ui", { ui: portal.id === "portal_pvp" ? "portal_pvp" : "portal_pve" });
      }
      return;
    }

    if (interactId === INTERACT.PRACTICE_DUMMY) {
      client.send("toast", { message: "Practice dummy — combat stubs come next" });
    }
  }
}
