/**
 * In-memory seats for hunters who still belong in a live content match.
 *
 * Colyseus reconnection tokens die with the socket. This registry lets the
 * same userId joinById / bounce from hub and reclaim their fighter.
 */

export type ActiveMatchSeat = {
  userId: string;
  roomId: string;
  roomName: string;
  matchId: string;
  mode: string;
  matchKind?: string;
  team: "a" | "b" | "c" | "";
  role: "fighter" | "spectator";
  spawnSlot?: number;
  hubOwnerId: string;
};

const seats = new Map<string, ActiveMatchSeat>();

export function rememberActiveMatch(seat: ActiveMatchSeat): void {
  if (!seat.userId || !seat.roomId) return;
  seats.set(seat.userId, seat);
}

export function getActiveMatch(userId: string): ActiveMatchSeat | undefined {
  if (!userId) return undefined;
  return seats.get(userId);
}

export function releaseActiveMatch(userId: string, roomId?: string): void {
  if (!userId) return;
  const cur = seats.get(userId);
  if (!cur) return;
  if (roomId && cur.roomId !== roomId) return;
  seats.delete(userId);
}

export function releaseMatchesForRoom(roomId: string): void {
  if (!roomId) return;
  for (const [userId, seat] of [...seats.entries()]) {
    if (seat.roomId === roomId) seats.delete(userId);
  }
}
