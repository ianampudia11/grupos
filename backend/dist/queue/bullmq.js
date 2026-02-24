"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QUEUE_NAMES = void 0;
exports.addJobSafe = addJobSafe;
exports.getCleanupQueue = getCleanupQueue;
exports.getInitQueue = getInitQueue;
exports.startBullMQWorkers = startBullMQWorkers;
exports.startWhatsAppQueueWorkers = startWhatsAppQueueWorkers;
exports.closeBullMQ = closeBullMQ;
/**
 * BullMQ: filas com nomes em hífen (sem :), conexão Redis estável.
 * Fallback em processo quando Redis 5.x retorna erro de Lua.
 */
const bullmq_1 = require("bullmq");
const redis_1 = require("../redis");
const logger_1 = require("../utils/logger");
const QUEUE_NAMES = {
    WA_INIT: "wa-initSession",
    WA_CLEANUP: "wa-cleanup",
    CAMPAIGNS: "campaigns-processScheduled",
    INVOICES_MONTHLY: "invoices-monthly",
    INVOICES_OVERDUE: "invoices-overdue",
};
exports.QUEUE_NAMES = QUEUE_NAMES;
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
                defaultJobOptions: { removeOnComplete: { count: 500 }, attempts: 2, backoff: { type: "exponential", delay: 1000 } },
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
/** Adiciona job à fila. Retorna { ok: true } ou { ok: false, luaError: true } para fallback. */
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
            logger_1.logger.warn("BULLMQ", "Redis 5.x detectado (erro Lua). Use Redis 6.2+ para filas. Fallback em processo.");
            return { ok: false, luaError: true };
        }
        logger_1.logger.error("BULLMQ", "Erro ao enfileirar", e);
        return { ok: false };
    }
}
function getCleanupQueue() {
    return getQueue(QUEUE_NAMES.WA_CLEANUP);
}
function getInitQueue() {
    return getQueue(QUEUE_NAMES.WA_INIT);
}
/** Processadores pesados: campanhas, faturas. Workers só rodam se Redis estiver ok. */
function startBullMQWorkers(handlers) {
    const conn = getConnection();
    if (!conn)
        return;
    try {
        const wCampaigns = new bullmq_1.Worker(QUEUE_NAMES.CAMPAIGNS, async (_job) => {
            await handlers.processScheduledCampaigns();
        }, { connection: conn, concurrency: 1 });
        wCampaigns.on("failed", (j, err) => logger_1.logger.error("BULLMQ", `Job ${j?.name} falhou`, err));
        workers.push(wCampaigns);
        const wMonthly = new bullmq_1.Worker(QUEUE_NAMES.INVOICES_MONTHLY, async (job) => {
            if (job.name === "run")
                await handlers.generateMonthlyInvoices();
        }, { connection: conn, concurrency: 1 });
        wMonthly.on("failed", (j, err) => logger_1.logger.error("BULLMQ", `Job ${j?.name} falhou`, err));
        workers.push(wMonthly);
        const wOverdue = new bullmq_1.Worker(QUEUE_NAMES.INVOICES_OVERDUE, async (job) => {
            if (job.name === "run")
                await handlers.markOverdueInvoices();
        }, { connection: conn, concurrency: 1 });
        wOverdue.on("failed", (j, err) => logger_1.logger.error("BULLMQ", `Job ${j?.name} falhou`, err));
        workers.push(wOverdue);
        logger_1.logger.info("BULLMQ", "Workers BullMQ iniciados (campanhas, faturas)");
    }
    catch (e) {
        logger_1.logger.warn("BULLMQ", "Falha ao iniciar workers", e);
    }
}
/** Workers para restart/disconnect/release de sessões WhatsApp (filas wa-initSession e wa-cleanup). */
function startWhatsAppQueueWorkers(handlers) {
    const conn = getConnection();
    if (!conn)
        return;
    try {
        const initWorker = new bullmq_1.Worker(QUEUE_NAMES.WA_INIT, async (job) => {
            const { sessionId, companyId } = job.data;
            if (job.name === "restart" && sessionId && companyId)
                await handlers.restart(sessionId, companyId);
        }, { connection: conn, concurrency: 2 });
        initWorker.on("failed", (j, err) => logger_1.logger.error("BULLMQ", `Job wa-init ${j?.name} falhou`, err));
        workers.push(initWorker);
        const cleanupWorker = new bullmq_1.Worker(QUEUE_NAMES.WA_CLEANUP, async (job) => {
            const { sessionId, companyId } = job.data;
            if (!sessionId || !companyId)
                return;
            if (job.name === "disconnect")
                await handlers.disconnect(sessionId, companyId);
            else if (job.name === "release")
                await handlers.release(sessionId, companyId);
        }, { connection: conn, concurrency: 2 });
        cleanupWorker.on("failed", (j, err) => logger_1.logger.error("BULLMQ", `Job wa-cleanup ${j?.name} falhou`, err));
        workers.push(cleanupWorker);
        logger_1.logger.info("BULLMQ", "Workers WhatsApp (init/cleanup) iniciados");
    }
    catch (e) {
        logger_1.logger.warn("BULLMQ", "Falha ao iniciar workers WhatsApp", e);
    }
}
async function closeBullMQ() {
    for (const w of workers)
        await w.close().catch(() => { });
    workers.length = 0;
    for (const q of queues.values())
        await q.close().catch(() => { });
    queues.clear();
}
