/**
 * Tiny object pool for reusable arrays / scratch objects.
 * Effect meshes are created per one-shot for now; this keeps trail buffers cheap.
 */
export class ObjectPool<T> {
  private free: T[] = [];

  constructor(
    private readonly factory: () => T,
    private readonly reset?: (item: T) => void,
  ) {}

  acquire(): T {
    return this.free.pop() ?? this.factory();
  }

  release(item: T): void {
    this.reset?.(item);
    this.free.push(item);
  }

  clear(): void {
    this.free.length = 0;
  }
}

export function createVec3Pool(): ObjectPool<{ x: number; y: number; z: number }> {
  return new ObjectPool(
    () => ({ x: 0, y: 0, z: 0 }),
    (v) => {
      v.x = 0;
      v.y = 0;
      v.z = 0;
    },
  );
}
