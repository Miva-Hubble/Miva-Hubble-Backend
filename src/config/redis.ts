import "dotenv/config";
import { RedisOptions } from "ioredis";

const REDIS_URL = process.env.UPSTASH_REDIS_URL || process.env.REDIS_URL;

export const getRedisConnectionOptions = (): RedisOptions => {
  if (!REDIS_URL) {
    console.warn(
      "⚠️ UPSTASH_REDIS_URL or REDIS_URL is not set in environment variables. Queue operations will require Redis configuration."
    );
    return {
      host: process.env.REDIS_HOST || "localhost",
      port: Number(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    };
  }

  const url = new URL(REDIS_URL);
  const isTls = url.protocol === "rediss:";

  return {
    host: url.hostname,
    port: Number(url.port) || (isTls ? 6379 : 6379),
    username: url.username || "default",
    password: decodeURIComponent(url.password),
    tls: isTls ? { rejectUnauthorized: false } : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
};

export const redisConnectionOptions = getRedisConnectionOptions();
