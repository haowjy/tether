/** Deletes `map`'s oldest keys (first inserted) until at most `limit` remain. */
export function trimOldest(map: Map<string, unknown>, limit: number): void {
  for (const [oldest] of map) {
    if (map.size <= limit) break;
    map.delete(oldest);
  }
}

/** A map that keeps the `limit` most recently set keys: setting a key again makes it the newest. */
export class Recent<V> {
  private readonly items = new Map<string, V>();

  constructor(private readonly limit: number) {}

  get(key: string): V | undefined {
    return this.items.get(key);
  }

  set(key: string, value: V): void {
    this.items.delete(key);
    this.items.set(key, value);
    trimOldest(this.items, this.limit);
  }

  delete(key: string): void {
    this.items.delete(key);
  }

  clear(): void {
    this.items.clear();
  }
}
