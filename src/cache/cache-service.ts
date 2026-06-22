import { createClient, RedisClientType } from 'redis';

export class CacheService {
  private client: RedisClientType | null = null;
  private connected: boolean = false;
  private defaultTtlMs: number = 300_000; // 5 minutes

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      console.warn('[Cache] No REDIS_URL configured, running without cache...');
      return;
    }

    try {
      this.client = createClient({
        url: redisUrl,
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > 10) return new Error('Max retries reached');
            return Math.min(retries * 100, 3000);
          },
        },
      });

      this.client.on('error', (err) => {
        console.error('[Cache] Redis error:', err.message);
        this.connected = false;
      });

      this.client.on('connect', () => {
        console.log('[Cache] Redis connected');
        this.connected = true;
      });

      this.client.on('disconnect', () => {
        console.warn('[Cache] Redis disconnected');
        this.connected = false;
      });

      await this.client.connect();
    } catch (err: any) {
      console.warn('[Cache] Failed to connect to Redis:', err.message);
      this.connected = false;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.connected || !this.client) return null;

    try {
      const data = await this.client.get(key);
      if (!data) return null;
      return JSON.parse(data) as T;
    } catch {
      return null;
    }
  }

  async set(key: string, value: any, ttlMs?: number): Promise<void> {
    if (!this.connected || !this.client) return;

    try {
      const ttl = ttlMs || this.defaultTtlMs;
      const ttlSeconds = Math.ceil(ttl / 1000);
      await this.client.setEx(key, ttlSeconds, JSON.stringify(value));
    } catch (err: any) {
      console.warn('[Cache] Failed to set key:', err.message);
    }
  }

  async del(key: string): Promise<void> {
    if (!this.connected || !this.client) return;

    try {
      await this.client.del(key);
    } catch {
      // Ignore errors
    }
  }

  async has(key: string): Promise<boolean> {
    if (!this.connected || !this.client) return false;

    try {
      const exists = await this.client.exists(key);
      return exists === 1;
    } catch {
      return false;
    }
  }

  async getOrSet<T>(key: string, fetchFn: () => Promise<T>, ttlMs?: number): Promise<T | null> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const value = await fetchFn();
    if (value !== null && value !== undefined) {
      await this.set(key, value, ttlMs);
    }
    return value;
  }

  async increment(key: string, ttlMs?: number): Promise<number> {
    if (!this.connected || !this.client) return 0;

    try {
      const count = await this.client.incr(key);
      if (ttlMs && count === 1) {
        const ttlSeconds = Math.ceil(ttlMs / 1000);
        await this.client.expire(key, ttlSeconds);
      }
      return count;
    } catch {
      return 0;
    }
  }

  async getMultiple<T>(keys: string[]): Promise<Map<string, T | null>> {
    const result = new Map<string, T | null>();
    if (!this.connected || !this.client) return result;

    try {
      const values = await this.client.mGet(keys);
      keys.forEach((key, index) => {
        const data = values[index];
        result.set(key, data ? JSON.parse(data) as T : null);
      });
    } catch {
      // Return empty map on error
    }

    return result;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      console.log('[Cache] Redis disconnected');
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}
