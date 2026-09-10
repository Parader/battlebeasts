import { getStateCallbacks, type Room } from "colyseus.js";
import { useEffect, useState } from "react";
import {
  DEFAULT_COSMETIC_BODY,
  normalizeCosmeticBody,
  type CosmeticBodyId,
} from "@battlebeasts/shared";

/**
 * Live Mixamo vessel for a player. Shop preview polls appearance; the world
 * avatar used to keep the useState default (`female`) until a gated useFrame
 * update, so male cuts (fileMale) never swapped in-game.
 */
export function usePlayerVessel(
  room: Room | null,
  sessionId: string | null,
): CosmeticBodyId {
  const [vessel, setVessel] = useState<CosmeticBodyId>(DEFAULT_COSMETIC_BODY);

  useEffect(() => {
    if (!room || !sessionId) {
      setVessel(DEFAULT_COSMETIC_BODY);
      return;
    }

    const read = () => {
      const me = room.state?.players?.get(sessionId) as { vessel?: string } | undefined;
      const next = normalizeCosmeticBody(me?.vessel);
      setVessel((prev) => (prev === next ? prev : next));
    };
    read();

    let unsub: (() => void) | undefined;
    try {
      const $ = getStateCallbacks(room);
      const player = room.state?.players?.get(sessionId);
      if ($ && player) {
        unsub = $(player).listen("vessel", (value: string) => {
          setVessel(normalizeCosmeticBody(value));
        });
      }
    } catch {
      /* schema callbacks unavailable — interval below is enough */
    }

    const id = window.setInterval(read, 250);
    return () => {
      unsub?.();
      window.clearInterval(id);
    };
  }, [room, sessionId]);

  return vessel;
}
