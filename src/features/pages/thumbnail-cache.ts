interface CacheEntry<Value> {
  value: Value;
  sizeBytes: number;
}

export class ByteLruCache<Key, Value> {
  private readonly entries = new Map<Key, CacheEntry<Value>>();
  private currentBytes = 0;
  readonly maxBytes: number;
  private readonly sizeOf: (value: Value) => number;
  private readonly dispose: (value: Value) => void;

  constructor(
    maxBytes: number,
    sizeOf: (value: Value) => number,
    dispose: (value: Value) => void,
  ) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new RangeError('The cache byte limit must be a positive safe integer.');
    }
    this.maxBytes = maxBytes;
    this.sizeOf = sizeOf;
    this.dispose = dispose;
  }

  get bytesUsed(): number {
    return this.currentBytes;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: Key): Value | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: Key, value: Value): void {
    const sizeBytes = this.sizeOf(value);
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
      throw new RangeError('A cached value must have a non-negative safe byte size.');
    }

    const existing = this.entries.get(key);
    if (existing) {
      this.remove(key, existing.value !== value);
    }

    if (sizeBytes > this.maxBytes) {
      this.dispose(value);
      return;
    }

    while (this.currentBytes + sizeBytes > this.maxBytes) {
      const oldest = this.entries.keys().next();
      if (oldest.done) {
        break;
      }
      this.remove(oldest.value, true);
    }

    this.entries.set(key, { value, sizeBytes });
    this.currentBytes += sizeBytes;
  }

  clear(): void {
    for (const [key, entry] of this.entries) {
      this.remove(key, true, entry);
    }
  }

  private remove(
    key: Key,
    disposeValue: boolean,
    knownEntry?: CacheEntry<Value>,
  ): void {
    const entry = knownEntry ?? this.entries.get(key);
    if (!entry) {
      return;
    }

    this.entries.delete(key);
    this.currentBytes -= entry.sizeBytes;
    if (disposeValue) {
      this.dispose(entry.value);
    }
  }
}
