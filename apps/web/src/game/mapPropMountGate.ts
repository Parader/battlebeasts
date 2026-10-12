type Listener = () => void;

const mounted = new Map<string, number>();
const listeners = new Set<Listener>();

function key(mapId: string, propKey: string): string {
  return `${mapId}\0${propKey}`;
}

function notify(): void {
  for (const fn of listeners) fn();
}

/** InstancedProp finished mounting into the live scene graph. */
export function reportMapPropMounted(mapId: string, propKey: string): void {
  const id = key(mapId, propKey);
  mounted.set(id, (mounted.get(id) ?? 0) + 1);
  notify();
}

export function reportMapPropUnmounted(mapId: string, propKey: string): void {
  const id = key(mapId, propKey);
  const next = (mounted.get(id) ?? 1) - 1;
  if (next <= 0) mounted.delete(id);
  else mounted.set(id, next);
  notify();
}

export function countMountedMapProps(mapId: string): number {
  const prefix = `${mapId}\0`;
  let n = 0;
  for (const id of mounted.keys()) {
    if (id.startsWith(prefix)) n += 1;
  }
  return n;
}

export function hasMountedMapProps(mapId: string, propKeys: readonly string[]): boolean {
  for (const propKey of propKeys) {
    if ((mounted.get(key(mapId, propKey)) ?? 0) <= 0) return false;
  }
  return true;
}

export function subscribeMapPropMounts(fn: Listener): () => void {
  listeners.add(fn);
  fn();
  return () => {
    listeners.delete(fn);
  };
}
