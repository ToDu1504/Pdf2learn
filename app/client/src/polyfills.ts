/**
 * pdf.js 6 dùng Map/WeakMap.getOrInsert(Computed) (đề xuất "upsert"), Chromium 138 của Electron 37 chưa có:
 * thiếu thì mở PDF văng lỗi và trắng cả giao diện. Worker dùng bản legacy (có sẵn polyfill); đây là phần luồng chính.
 */
type Upsert<K, V> = {
  getOrInsert?(key: K, value: V): V;
  getOrInsertComputed?(key: K, fn: (key: K) => V): V;
  has(key: K): boolean;
  get(key: K): V | undefined;
  set(key: K, value: V): unknown;
};

for (const proto of [Map.prototype, WeakMap.prototype] as unknown as Upsert<unknown, unknown>[]) {
  if (!proto.getOrInsert)
    Object.defineProperty(proto, "getOrInsert", {
      configurable: true,
      writable: true,
      value(this: Upsert<unknown, unknown>, key: unknown, value: unknown) {
        if (!this.has(key)) this.set(key, value);
        return this.get(key);
      },
    });
  if (!proto.getOrInsertComputed)
    Object.defineProperty(proto, "getOrInsertComputed", {
      configurable: true,
      writable: true,
      value(this: Upsert<unknown, unknown>, key: unknown, fn: (key: unknown) => unknown) {
        if (!this.has(key)) this.set(key, fn(key));
        return this.get(key);
      },
    });
}

export {};
