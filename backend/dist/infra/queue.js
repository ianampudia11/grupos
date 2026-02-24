"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QUEUE_NAMES = void 0;
exports.addJobSafe = addJobSafe;
exports.getSyncGroupsQueue = getSyncGroupsQueue;
exports.getInitQueue = getInitQueue;
exports.getCleanupQueue = getCleanupQueue;
exports.addSyncGroupsJobAndWait = addSyncGroupsJobAndWait;
exports.startWhatsAppQueueWorkers = startWhatsAppQueueWorkers;
exports.closeWhatsAppWorkers = closeWhatsAppWorkers;
const bullmq_1 = require("bullmq");
const redis_1 = require("../redis");
const logger_1 = require("../utils/logger");
const logger_2 = require("../utils/logger");
exports.QUEUE_NAMES = {
    WA_INIT: "wa-initSession",
    WA_CLEANUP: "wa-cleanup",
    WA_SYNC_GROUPS: "wa-sync-groups",
    CAMPAIGNS: "campaigns-processScheduled",
    INVOICES_MONTHLY: "invoices-monthly",
    INVOICES_OVERDUE: "invoices-overdue",
};
let connection = null;
const queues = new Map();
const workers = [];
function getConnection() {
    if (connection)
        return connection;
    connection = (0, redis_1.getRedisConnectionOptions)();
    return connection;
}
function getQueue(name) {
    const conn = getConnection();
    if (!conn)
        return null;
    let q = queues.get(name);
    if (!q) {
        try {
            q = new bullmq_1.Queue(name, {
                connection: conn,
                defaultJobOptions: {
                    removeOnComplete: { count: 500 },
                    attempts: 3,
                    backoff: { type: "exponential", delay: 2000 },
                },
            });
            queues.set(name, q);
        }
        catch (e) {
            logger_1.logger.warn("BULLMQ", `Falha ao criar fila ${name}`, e);
            return null;
        }
    }
    return q;
}
async function addJobSafe(queueName, jobName, data) {
    const queue = getQueue(queueName);
    if (!queue)
        return { ok: false };
    try {
        await queue.add(jobName, data);
        return { ok: true };
    }
    catch (e) {
        if ((0, redis_1.isRedisLuaError)(e)) {
            logger_1.logger.warn("BULLMQ", "Redis 5.x (erro Lua). Use Redis 6.2+. Fallback em processo.");
            return { ok: false, luaError: true };
        }
        logger_1.logger.error("BULLMQ", "Erro ao enfileirar", e);
        return { ok: false };
    }
}
function getSyncGroupsQueue() {
    return getQueue(exports.QUEUE_NAMES.WA_SYNC_GROUPS);
}
function getInitQueue() {
    return getQueue(exports.QUEUE_NAMES.WA_INIT);
}
function getCleanupQueue() {
    return getQueue(exports.QUEUE_NAMES.WA_CLEANUP);
}
const SYNC_POLL_MS = 800;
const SYNC_TIMEOUT_MS = 130000;
async function addSyncGroupsJobAndWait(companyId) {
    const queue = getSyncGroupsQueue();
    if (!queue) {
        logger_1.logger.error("SYNC", "Fila wa-sync-groups indisponivel (Redis?)");
        throw new Error("Sincronização indisponível. Redis/filas não configurados.");
    }
    const jobId = `sync-${companyId}-${Date.now()}`;
    const job = await queue.add("sync", { companyId }, { jobId });
    logger_2.logger.info("SYNC", "Job sync enfileirado", { companyId, jobId: job.id });
    const deadline = Date.now() + SYNC_TIMEOUT_MS;
    while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, SYNC_POLL_MS));
        const j = await queue.getJob(job.id);
        if (!j)
            continue;
        const state = await j.getState();
        if (state === "completed") {
            logger_2.logger.info("SYNC", "Job sync concluido", { companyId, jobId: job.id, durationMs: Date.now() - (deadline - SYNC_TIMEOUT_MS) });
            return j.returnvalue;
        }
        if (state === "failed") {
            const reason = String(j.failedReason ?? "Sincronização falhou");
            logger_2.logger.error("SYNC", "Job sync falhou", { companyId, jobId: job.id, reason });
            throw new Error(reason);
        }
    }
    logger_2.logger.error("SYNC", "Job sync timeout", { companyId, jobId: job.id });
    throw new Error("Sincronização em tempo limite. Tente novamente.");
}
/** 1 = um sync por vez (menos CPU, evita travar). Ajuste via SYNC_CONCURRENCY no .env se precisar. */
const GLOBAL_SYNC_CONCURRENCY = Math.max(1, Math.min(5, Number(process.env.SYNC_CONCURRENCY || 1)));
const INIT_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.INIT_CONCURRENCY || 1)));
const CLEANUP_CONCURRENCY = 2;
function startWhatsAppQueueWorkers(handlers) {
    const conn = getConnection();
    if (!conn)
        return;
    try {
        if (handlers.syncGroups) {
            const syncWorker = new bullmq_1.Worker(exports.QUEUE_NAMES.WA_SYNC_GROUPS, async (job) => {
                const { companyId } = job.data;
                if (!companyId) {
                    logger_2.logger.warn("SYNC", "Job sem companyId", { jobId: job.id });
                    return null;
                }
                const ctx = { companyId, jobId: String(job.id) };
                const start = Date.now();
                try {
                    const result = await handlers.syncGroups(companyId);
                    logger_2.logger.info("SYNC", "Job sync concluido", { ...ctx, durationMs: Date.now() - start });
                    return result;
                }
                catch (err) {
                    logger_2.logger.error("SYNC", "Job sync erro", { ...ctx, durationMs: Date.now() - start, err });
                    throw err;
                }
            }, { connection: conn, concurrency: GLOBAL_SYNC_CONCURRENCY });
            syncWorker.on("failed", (j, err) => logger_2.logger.error("SYNC", "Job wa-sync-groups falhou", { jobId: j?.id, err }));
            workers.push(syncWorker);
        }
        const initWorker = new bullmq_1.Worker(exports.QUEUE_NAMES.WA_INIT, async (job) => {
            const { sessionId, companyId } = job.data;
            if (!sessionId)
                return;
            if (job.name === "restart" && companyId)
                await handlers.restart(sessionId, companyId);
            else if (job.name === "ensure" && handlers.ensure)
                await handlers.ensure(sessionId);
        }, { connection: conn, concurrency: INIT_CONCURRENCY });
        initWorker.on("failed", (j, err) => logger_1.logger.error("BULLMQ", `Job wa-init ${j?.name} falhou`, err));
        workers.push(initWorker);
        const cleanupWorker = new bullmq_1.Worker(exports.QUEUE_NAMES.WA_CLEANUP, async (job) => {
            const { sessionId, companyId } = job.data;
            if (!sessionId || !companyId)
                return;
            if (job.name === "disconnect")
                await handlers.disconnect(sessionId, companyId);
            else if (job.name === "release")
                await handlers.release(sessionId, companyId);
        }, { connection: conn, concurrency: CLEANUP_CONCURRENCY });
        cleanupWorker.on("failed", (j, err) => logger_1.logger.error("BULLMQ", `Job wa-cleanup ${j?.name} falhou`, err));
        workers.push(cleanupWorker);
        logger_1.logger.info("BULLMQ", "Workers WhatsApp (init/cleanup/sync) iniciados");
    }
    catch (e) {
        logger_1.logger.warn("BULLMQ", "Falha ao iniciar workers WhatsApp", e);
    }
}
async function closeWhatsAppWorkers() {
    for (const w of workers)
        await w.close().catch(() => { });
    workers.length = 0;
}
