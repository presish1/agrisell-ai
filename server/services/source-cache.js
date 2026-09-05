// Short-lived public-source cache; never cache farmer stock or confirmation.
export class SourceCache {
  constructor({ ttlMs = 300000, limit = 128, now = Date.now } = {}) {
    Object.assign(this, { ttlMs, limit, now });
    this.entries = new Map();
  }
  get(key, load, usable = () => true) {
    const existing = this.entries.get(key);
    if (existing && (existing.pending || existing.expires > this.now()))
      return existing.promise;
    this.entries.delete(key);
    while (this.entries.size >= this.limit)
      this.entries.delete(this.entries.keys().next().value);
    const entry = { pending: true, expires: 0 };
    entry.promise = Promise.resolve()
      .then(load)
      .then(
        (value) => {
          entry.pending = false;
          entry.expires = this.now() + this.ttlMs;
          if (!usable(value) && this.entries.get(key) === entry)
            this.entries.delete(key);
          return value;
        },
        (error) => {
          if (this.entries.get(key) === entry) this.entries.delete(key);
          throw error;
        },
      );
    this.entries.set(key, entry);
    return entry.promise;
  }
}
