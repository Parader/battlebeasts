/**
 * Which NPC the player is currently talking to.
 *
 * A one-value bus rather than React state because the consumers sit on
 * opposite sides of the tree -- the dialogue panel is in the DOM overlay, the
 * villager playing the talk gesture is in the canvas -- and threading a prop
 * between them would re-render every NPC in the town each time a conversation
 * opens.
 */

let current: string | null = null;
const listeners = new Set<() => void>();

/** Element id of the NPC being spoken to, or null when nobody is. */
export function talkingNpcId(): string | null {
  return current;
}

export function setTalkingNpc(id: string | null) {
  if (current === id) return;
  current = id;
  for (const listener of listeners) listener();
}

export function subscribeTalkingNpc(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
