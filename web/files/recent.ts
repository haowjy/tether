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
    for (const [oldest] of this.items) {
      if (this.items.size <= this.limit) break;
      this.items.delete(oldest);
    }
  }

  delete(key: string): void {
    this.items.delete(key);
  }

  clear(): void {
    this.items.clear();
  }
}
