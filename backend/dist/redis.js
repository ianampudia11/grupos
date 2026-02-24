"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionStore = void 0;
exports.getRedisClient = getRedisClient;
exports.getRedisConnectionOptions = getRedisConnectionOptions;
exports.isRedisLuaError = isRedisLuaError;
/**
 * Redis: conexão e session store (wa:session:*).
 * Suporta REDIS_URI ou variáveis IO_REDIS_* (Whaticket).
 */
const ioredis_1 = __importDefault(require("ioredis"));
const env_1 = require("./config/env");
const logger_1 = require("./utils/logger");
const SESSION_PREFIX = "wa:session:";
const SESSION_TTL_SEC = 86400; // 1 dia
let redisClient = null;
function getRedisClient() {
    if (!env_1.env.redisUri)
        return null;
    if (redisClient)
        return redisClient;
    try {
        redisClient = new ioredis_1.default(env_1.env.redisUri, {
            maxRetriesPerRequest: 3,
            retryStrategy(times) {
                if (times > 3)
                    return null;
                return Math.min(times * 200, 2000);
            },
            lazyConnect: true,
        });
        redisClient.on("error", (err) => logger_1.logger.warn("REDIS", "Redis client error", err));
        return redisClient;
    }
    catch (e) {
        logger_1.logger.warn("REDIS", "Falha ao criar cliente Redis", e);
        return null;
    }
}
/** Retorna opções de conexão para BullMQ (objeto connection). */
function getRedisConnectionOptions() {
    if (!env_1.env.redisUri)
        return null;
    try {
        const u = new URL(env_1.env.redisUri);
        const host = u.hostname || "127.0.0.1";
        const port = parseInt(u.port || "6379", 10);
        const password = u.password ? decodeURIComponent(u.password) : undefined;
        const db = u.pathname?.replace(/\//g, "") ? parseInt(u.pathname.replace(/\//g, ""), 10) : 0;
        if (Number.isNaN(db))
            return { host, port, password };
        return { host, port, password, db: Number.isNaN(db) ? undefined : db };
    }
    catch {
        return null;
    }
}
/** Verifica se o erro é o de Lua/msgpack do Redis 5.x (BullMQ requer Redis 6.2+). */
function isRedisLuaError(err) {
    const msg = err instanceof Error ? err.message : String(err);
    return /Lua redis\(\) command arguments must be strings or integers/i.test(msg) || /msgpack/i.test(msg);
}
/** Session store: sincroniza estado da sessão WhatsApp (qr, ready) para Redis. */
exports.sessionStore = {
    async setStatus(sessionId, status) {
        const client = getRedisClient();
        if (!client)
            return;
        const key = `${SESSION_PREFIX}${sessionId}:status`;
        try {
            await client.set(key, status, "EX", SESSION_TTL_SEC);
        }
        catch (e) {
            logger_1.logger.warn("REDIS", `sessionStore.setStatus ${sessionId}`, e);
        }
    },
    async setQr(sessionId, qr) {
        const client = getRedisClient();
        if (!client)
            return;
        const key = `${SESSION_PREFIX}${sessionId}:qr`;
        try {
            await client.set(key, qr, "EX", 90);
        }
        catch (e) {
            logger_1.logger.warn("REDIS", `sessionStore.setQr ${sessionId}`, e);
        }
    },
    async setMeta(sessionId, meta) {
        const client = getRedisClient();
        if (!client)
            return;
        const key = `${SESSION_PREFIX}${sessionId}:meta`;
        try {
            await client.set(key, JSON.stringify(meta), "EX", SESSION_TTL_SEC);
        }
        catch (e) {
            logger_1.logger.warn("REDIS", `sessionStore.setMeta ${sessionId}`, e);
        }
    },
    async clearQr(sessionId) {
        const client = getRedisClient();
        if (!client)
            return;
        try {
            await client.del(`${SESSION_PREFIX}${sessionId}:qr`);
        }
        catch (e) {
            logger_1.logger.warn("REDIS", `sessionStore.clearQr ${sessionId}`, e);
        }
    },
    async getStatus(sessionId) {
        const client = getRedisClient();
        if (!client)
            return null;
        try {
            const v = await client.get(`${SESSION_PREFIX}${sessionId}:status`);
            return v;
        }
        catch {
            return null;
        }
    },
    async getQr(sessionId) {
        const client = getRedisClient();
        if (!client)
            return null;
        try {
            return await client.get(`${SESSION_PREFIX}${sessionId}:qr`);
        }
        catch {
            return null;
        }
    },
};
