/* Lab typecheck does not compile apps/web. Vite still resolves the real sources. */

declare module "@web/game/characterVisual" {
  export const CHARACTER_URL: string;
  export function prepareCharacterScene(scene: unknown, opts?: unknown): any;
}

declare module "@web/game/animation" {
  export class CharacterAnimationController {
    constructor(...args: any[]);
    dispose(): void;
    setMovementFromYaw(vel: unknown, yaw: number, scale?: number): void;
    update(dt: number): void;
  }
  export const heroAnimationConfig: { idle: string; [key: string]: unknown };
}

declare module "@web/game/characterRoots" {
  export function registerCharacterRoot(id: string, root: unknown): void;
  export function getCombatOwnerPose(
    room: unknown,
    ownerId: string | null | undefined,
  ): { x?: number; z?: number; yaw?: number } | undefined;
}

declare module "@web/game/syncPlayerCast" {
  export function syncAbilityCast(...args: any[]): void;
}

declare module "@web/game/FixedFollowCamera" {
  export function FixedFollowCamera(props: any): any;
}

declare module "@web/game/FollowSun" {
  export function FollowSun(props: any): any;
}

declare module "@web/game/PerfHud" {
  export function PerfProbe(): any;
  export function PerfOverlay(): any;
}

declare module "@web/game/perfHudRuntime" {
  export const SPIKE_MS: number;
  export function setPerfExtraLine(
    line: { label: string; value: string; warn?: boolean } | null,
  ): void;
  export function setPerfSampling(on: boolean): void;
  export function getPerfLatest(): {
    fps: number;
    avgMs: number;
    p95Ms: number;
    worstMs: number;
    spikes: number;
    calls: number;
    triangles: number;
    programs: number;
    geometries: number;
    textures: number;
    peakMs: number;
    peakCalls: number;
    newPrograms: number;
  };
  export function subscribePerfData(fn: () => void): () => void;
}

declare module "@web/game/CombatVfx" {
  export function CombatFxMeshes(props?: any): any;
  export function Projectiles(props?: any): any;
  export function Volcanoes(props?: any): any;
  export function RockWalls(props?: any): any;
  export function WorldTrees(props?: any): any;
  export function ProtectionBubbles(props?: any): any;
  export function OrbitingWisps(props?: any): any;
  export function AstralChains(props?: any): any;
  export function SoulSevers(props?: any): any;
  export function RiftPortals(props?: any): any;
  export function Shrooms(props?: any): any;
}

declare module "@web/game/vfx" {
  export function SpellVfxBridge(props?: any): any;
  export function VfxWorld(props?: any): any;
  export function getAbilityVfxProfile(id: string): any;
  export function hasCatalogImpactFx(id: string): boolean;
  export function hasCatalogProjectile(id: string): boolean;
  export function isOwnedByCastProjectile(id: string): boolean;
}

declare module "@web/game/vfx/spellLights" {
  export function SpellLightPool(props?: any): any;
}

declare module "@web/game/vfx/preloadVfx" {
  export function warmSpellMaterials(...args: any[]): void;
}

declare module "@web/game/vfx/vfxRoomLike" {
  export type VfxMapLike<T = unknown> = {
    get: (id: string) => T | undefined;
    forEach: (fn: (value: T, key: string) => void) => void;
  };
  export type VfxActorLike = {
    x?: number;
    z?: number;
    yaw?: number;
    kind?: string;
    role?: string;
    castPhase?: string;
    castAbilityId?: string;
    castPhaseEndsAt?: number;
    castComboHit?: number;
  };
  export type VfxProjectileLike = {
    x: number;
    z: number;
    vx?: number;
    vz?: number;
    abilityId?: string;
    ownerSessionId?: string;
  };
  export type VfxWorldState = Record<string, unknown>;
  export type VfxRoomLike = {
    roomId?: string;
    state?: any;
    subscribeMaps?: (fn: () => void) => () => void;
  };
}

declare module "@web/game/combatOverlayRuntime" {
  export const combatOverlayRuntime: {
    pushBurst: (burst: unknown) => void;
    clear: () => void;
  };
}

declare module "@web/game/groundAimRuntime" {
  export function setGroundAim(x: number, z: number): void;
}

declare module "@web/game/castAimRuntime" {
  export const castAimRuntime: {
    set: (abilityId: string | null, phase: string, comboHit?: number) => void;
    clear: () => void;
  };
}

declare module "@web/game/vfx/engines" {
  export const castEngines: Record<
    string,
    {
      onPhaseChange: (ctx: any) => void;
      tick?: (ctx: any) => void;
    }
  >;
}

declare module "@web/game/vfx/combatFxDispatch" {
  export function dispatchCombatFxVfx(msg: unknown, ctx: unknown): unknown;
}

declare module "@web/game/vfx/crescentSpawn" {
  export function clearCrescentSpawnState(ownerId: string): void;
}

declare module "@web/game/vfx/profiles/registry" {
  export function getAbilityVfxProfile(id: string): any;
}

declare module "@web/game/vfx/runtime" {
  export function cancelFollowOwnerVfx(abilityId: string, ownerId: string): void;
  export const vfxRuntime: {
    getShots: () => { length: number };
    clear: () => void;
  };
}

declare module "@web/game/vfx/runtime/playerVfxRuntime" {
  export function cancelPlayerCastHandles(id: string): void;
  export function cleanupPlayerVfx(id: string): void;
  export function getPlayerVfxRuntime(id: string): { lastPhase: string };
}

declare module "@web/game/vfx/timing" {
  export function getFlightDurationMs(...args: any[]): number;
}

declare module "@web/game/propTextureUrls" {
  export function installSharedPropTextureResolver(): void;
}

declare module "@web/game/PaintedGround" {
  export const PaintedGround: any;
}
