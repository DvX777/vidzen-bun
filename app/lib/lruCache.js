/* ══════════════════════════════════════════════════
   LRU CACHE — Bounded, TTL-aware, zero-dependency.
   O(1) get/set via Map (insertion-order) + lazy eviction.
   No background timers — no memory leak risk.
   ══════════════════════════════════════════════════ */

export class LRUCache {
  constructor(maxSize = 100, ttl = 5 * 60_000) {
    this._map = new Map();
    this._maxSize = maxSize;
    this._ttl = ttl;
  }

  get(key) {
    const entry = this._map.get(key);
    if (!entry) return null;
    if (this._ttl && Date.now() - entry.t > this._ttl) {
      this._map.delete(key);
      return null;
    }
    this._map.delete(key);
    this._map.set(key, entry);
    return entry.v;
  }

  set(key, value) {
    if (this._map.has(key)) this._map.delete(key);
    while (this._map.size >= this._maxSize) {
      const oldest = this._map.keys().next().value;
      this._map.delete(oldest);
    }
    this._map.set(key, { v: value, t: Date.now() });
  }

  has(key) {
    const entry = this._map.get(key);
    if (!entry) return false;
    if (this._ttl && Date.now() - entry.t > this._ttl) {
      this._map.delete(key);
      return false;
    }
    return true;
  }

  delete(key) { return this._map.delete(key); }
  get size() { return this._map.size; }
  clear() { this._map.clear(); }
}
