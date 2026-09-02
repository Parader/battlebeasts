import { getStateCallbacks } from "colyseus.js";
import type { Room } from "colyseus.js";
import { useEffect, useState } from "react";

type StringMap = { forEach: (fn: (value: unknown, key: string) => void) => void };

function sortedKeys(map: StringMap, filter?: (value: unknown, key: string) => boolean): string[] {
  const out: string[] = [];
  map.forEach((v, k) => {
    if (!filter || filter(v, k)) out.push(k);
  });
  out.sort();
  return out;
}

function keysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function syncMapKeys(
  setKeys: (value: string[] | ((prev: string[]) => string[])) => void,
  map: StringMap | undefined,
  filter?: (value: unknown, key: string) => boolean,
) {
  if (!map) {
    setKeys([]);
    return;
  }
  const next = sortedKeys(map, filter);
  setKeys((prev) => (keysEqual(prev, next) ? prev : next));
}

function bindMapCollection(
  room: Room,
  pick: ($: NonNullable<ReturnType<typeof getStateCallbacks>>, state: Room["state"]) => {
    onAdd: (cb: (value: unknown, key: string) => void) => () => void;
    onRemove: (cb: (value: unknown, key: string) => void) => () => void;
  },
  sync: () => void,
  onItemAdd?: (value: unknown, key: string) => void,
): (() => void) | undefined {
  const $ = getStateCallbacks(room);
  if (!$) return undefined;
  const bound = pick($, room.state);
  const offAdd = bound.onAdd((value, key) => {
    onItemAdd?.(value, key);
    sync();
  });
  const offRemove = bound.onRemove(() => sync());
  return () => {
    offAdd();
    offRemove();
  };
}

export function useRemotePlayerIds(
  room: Room | null,
  localSessionId: string | null,
): string[] {
  const [keys, setKeys] = useState<string[]>([]);

  useEffect(() => {
    setKeys([]);
    if (!room?.state) return;

    const filter = (_v: unknown, id: string) => {
      if (id === localSessionId) return false;
      const p = room.state?.players?.get(id) as
        | { disconnected?: boolean; id?: string; role?: string }
        | undefined;
      if (!p || p.disconnected || p.role === "spectator") return false;
      const localUserId =
        (localSessionId &&
          (room.state?.players?.get(localSessionId) as { id?: string } | undefined)?.id) ||
        "";
      return !(localUserId && p.id && p.id === localUserId);
    };

    const sync = () => syncMapKeys(setKeys, room.state?.players as StringMap | undefined, filter);

    sync();
    return bindMapCollection(
      room,
      ($, state) => {
        const coll = $(state).players as {
          onAdd: (cb: (v: unknown, k: string) => void) => () => void;
          onRemove: (cb: (v: unknown, k: string) => void) => () => void;
        };
        return coll;
      },
      sync,
    );
  }, [room, room?.roomId, localSessionId]);

  return keys;
}

export function useProjectileIds(
  room: Room | null,
  onBoltCast?: (ownerSessionId: string) => void,
): string[] {
  const [keys, setKeys] = useState<string[]>([]);

  useEffect(() => {
    setKeys([]);
    if (!room?.state) return;

    const sync = () => syncMapKeys(setKeys, room.state?.projectiles as StringMap | undefined);

    sync();
    return bindMapCollection(
      room,
      ($, state) => $(state).projectiles as {
        onAdd: (cb: (v: unknown, k: string) => void) => () => void;
        onRemove: (cb: (v: unknown, k: string) => void) => () => void;
      },
      sync,
      (value) => {
        const p = value as { abilityId?: string; ownerSessionId?: string };
        if (p.abilityId === "bolt") onBoltCast?.(p.ownerSessionId || "");
      },
    );
  }, [room, room?.roomId, onBoltCast]);

  return keys;
}

export function useHubBallIds(room: Room | null): string[] {
  const [keys, setKeys] = useState<string[]>([]);

  useEffect(() => {
    setKeys([]);
    if (!room?.state) return;

    const sync = () => syncMapKeys(setKeys, room.state?.hubBalls as StringMap | undefined);

    sync();
    return bindMapCollection(
      room,
      ($, state) => $(state).hubBalls as {
        onAdd: (cb: (v: unknown, k: string) => void) => () => void;
        onRemove: (cb: (v: unknown, k: string) => void) => () => void;
      },
      sync,
    );
  }, [room, room?.roomId]);

  return keys;
}

export function useDecoyIds(room: Room | null): string[] {
  const [keys, setKeys] = useState<string[]>([]);

  useEffect(() => {
    setKeys([]);
    if (!room?.state) return;

    const sync = () => syncMapKeys(setKeys, room.state?.decoys as StringMap | undefined);

    sync();
    return bindMapCollection(
      room,
      ($, state) => $(state).decoys as {
        onAdd: (cb: (v: unknown, k: string) => void) => () => void;
        onRemove: (cb: (v: unknown, k: string) => void) => () => void;
      },
      sync,
    );
  }, [room, room?.roomId]);

  return keys;
}

export function useWorldTargetIds(room: Room | null): string[] {
  const [keys, setKeys] = useState<string[]>([]);

  useEffect(() => {
    if (!room?.state) {
      setKeys([]);
      return;
    }

    const sync = () => {
      const map = room.state?.targets as StringMap | undefined;
      if (!map) {
        setKeys([]);
        return;
      }
      const next = sortedKeys(map);
      setKeys((prev) => (keysEqual(prev, next) ? prev : next));
    };

    sync();
    return bindMapCollection(
      room,
      ($, state) => $(state).targets as {
        onAdd: (cb: (v: unknown, k: string) => void) => () => void;
        onRemove: (cb: (v: unknown, k: string) => void) => () => void;
      },
      sync,
    );
  }, [room, room?.roomId]);

  return keys;
}
