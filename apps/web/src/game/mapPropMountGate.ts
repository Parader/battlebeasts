type Listener = () => void;

const mounted = new Set<string>();
const listeners = new Set<Listener>();

function key(mapId: string, propKey: string): string {
  return `${mapId}\0${propKey}`;
}

function notify(): void {
  for (const fn of listeners) fn();
}

/** InstancedProp finished mounting into the live scene graph. */
export function reportMapPropMounted(mapId: string, propKey: string): void {
  mounted.add(key(mapId, propKey));
  notify();
}

export function reportMapPropUnmounted(mapId: string, propKey: string): void {
  mounted.delete(key(mapId, propKey));
  notify();
}

export function countMountedMapProps(mapId: string): number {
  const prefix = `${mapId}\0`;
  let n = 0;
  for (const id of mounted) {
    if (id.startsWith(prefix)) n += 1;
  }
  return n;
}

export function subscribeMapPropMounts(fn: Listener): () => void {
  listeners.add(fn);
  fn();
  return () => {
    listeners.delete(fn);
  };
}
