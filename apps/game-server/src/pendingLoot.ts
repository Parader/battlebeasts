import type { Wallet } from "@battlebeasts/shared";
import { addCoins } from "@battlebeasts/shared";

const pending = new Map<string, Wallet>();

function emptyWallet(): Wallet {
  return { copper: 0, silver: 0, gold: 0, essence: 0, rubies: 0 };
}

export function grantPendingLoot(userId: string, loot: Partial<Wallet>) {
  const prev = pending.get(userId) ?? emptyWallet();
  const coins = addCoins(prev, loot);
  pending.set(userId, {
    ...coins,
    essence: prev.essence + (loot.essence ?? 0),
    rubies: prev.rubies + (loot.rubies ?? 0),
  });
}

export function takePendingLoot(userId: string): Wallet | null {
  const loot = pending.get(userId);
  if (!loot) return null;
  pending.delete(userId);
  return loot;
}
