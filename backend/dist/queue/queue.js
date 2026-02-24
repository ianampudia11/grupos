"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processScheduledCampaigns = processScheduledCampaigns;
exports.generateMonthlyInvoices = generateMonthlyInvoices;
exports.markOverdueInvoices = markOverdueInvoices;
exports.startQueue = startQueue;
/**
 * Filas: BullMQ + Redis quando disponível; fallback em processo (cron) quando Redis 5.x (erro Lua).
 * Scheduler apenas enfileira; processamento pesado fica no worker.
 */
const node_cron_1 = __importDefault(require("node-cron"));
const prismaClient_1 = require("../prismaClient");
const logger_1 = require("../utils/logger");
const campaignSendService_1 = require("../services/campaignSendService");
const bullmq_1 = require("./bullmq");
async function processScheduledCampaigns() {
    const now = new Date();
    const campaigns = await prismaClient_1.prisma.campaign.findMany({
        where: {
            status: "queued",
            scheduledAt: { lte: now },
        },
        orderBy: { scheduledAt: "asc" },
    });
    for (const c of campaigns) {
        try {
            await (0, campaignSendService_1.sendCampaign)(c.id, c.userId);
            if (c.repeatRule === "daily") {
                const next = new Date(c.scheduledAt);
                next.setDate(next.getDate() + 1);
                await prismaClient_1.prisma.campaign.update({
                    where: { id: c.id },
                    data: { scheduledAt: next, status: "queued", errorMessage: null },
                });
                logger_1.logger.info("QUEUE", `Campanha ${c.id} reagendada para ${next.toISOString()} (diário)`);
            }
            else if (c.repeatRule === "weekly") {
                const next = new Date(c.scheduledAt);
                next.setDate(next.getDate() + 7);
                await prismaClient_1.prisma.campaign.update({
                    where: { id: c.id },
                    data: { scheduledAt: next, status: "queued", errorMessage: null },
                });
                logger_1.logger.info("QUEUE", `Campanha ${c.id} reagendada para ${next.toISOString()} (semanal)`);
            }
            logger_1.logger.success("QUEUE", `Campanha ${c.id} enviada (${c.title || "Sem título"})`);
        }
        catch (err) {
            logger_1.logger.error("QUEUE", `Falha ao enviar campanha ${c.id}`, err);
            const isLimitError = err?.message?.includes("Limite diário") ?? false;
            const errorMessage = isLimitError
                ? "Limite diário de envios atingido. Reagende para amanhã e tente novamente."
                : err?.message ?? "Falha ao enviar. Reagende ou tente novamente.";
            await prismaClient_1.prisma.campaign.update({
                where: { id: c.id },
                data: { status: "failed", errorMessage },
            });
        }
    }
}
async function generateMonthlyInvoices() {
    const subs = await prismaClient_1.prisma.subscription.findMany({
        where: { status: "active" },
        include: { company: true, plan: true },
    });
    const now = new Date();
    const dueDate = new Date(now.getFullYear(), now.getMonth(), 5);
    for (const sub of subs) {
        const existing = await prismaClient_1.prisma.invoice.findFirst({
            where: {
                companyId: sub.companyId,
                subscriptionId: sub.id,
                dueDate: { gte: new Date(now.getFullYear(), now.getMonth(), 1) },
            },
        });
        if (existing)
            continue;
        await prismaClient_1.prisma.invoice.create({
            data: {
                companyId: sub.companyId,
                subscriptionId: sub.id,
                amount: sub.plan.price,
                status: "pending",
                dueDate,
            },
        });
        logger_1.logger.info("QUEUE", `Fatura criada para ${sub.company.name}`);
    }
}
async function markOverdueInvoices() {
    const result = await prismaClient_1.prisma.invoice.updateMany({
        where: {
            status: "pending",
            dueDate: { lt: new Date() },
        },
        data: { status: "overdue" },
    });
    if (result.count > 0) {
        logger_1.logger.info("QUEUE", `${result.count} fatura(s) marcada(s) como vencida`);
    }
}
/**
 * Agenda o job sem bloquear o event loop. Evita "node-cron missed execution" por IO/CPU bloqueante.
 * Se Redis estiver ok, enfileira no BullMQ. Se fallback, dispara runInProcess em background (não aguarda).
 */
function runWithFallback(enqueue, runInProcess, logLabel) {
    setImmediate(() => {
        enqueue()
            .then((result) => {
            if (result.ok)
                return;
            if (result.luaError) {
                logger_1.logger.warn("QUEUE", `BullMQ requer Redis 6.2+. Executando ${logLabel} em processo (fallback).`);
                void runInProcess().catch((err) => logger_1.logger.error("QUEUE", `Erro em ${logLabel}`, err));
            }
        })
            .catch((err) => logger_1.logger.error("QUEUE", `Erro ao enfileirar ${logLabel}`, err));
    });
}
function startQueue() {
    (0, bullmq_1.startBullMQWorkers)({
        processScheduledCampaigns,
        generateMonthlyInvoices,
        markOverdueInvoices,
    });
    node_cron_1.default.schedule("5 0 1 * *", () => runWithFallback(() => (0, bullmq_1.addJobSafe)(bullmq_1.QUEUE_NAMES.INVOICES_MONTHLY, "run", {}), generateMonthlyInvoices, "faturas mensais"));
    node_cron_1.default.schedule("0 1 * * *", () => runWithFallback(() => (0, bullmq_1.addJobSafe)(bullmq_1.QUEUE_NAMES.INVOICES_OVERDUE, "run", {}), markOverdueInvoices, "faturas vencidas"));
    node_cron_1.default.schedule("* * * * *", () => runWithFallback(() => (0, bullmq_1.addJobSafe)(bullmq_1.QUEUE_NAMES.CAMPAIGNS, "run", {}), processScheduledCampaigns, "campanhas agendadas"));
    logger_1.logger.info("QUEUE", "Scheduler iniciado (BullMQ ou fallback em processo)");
}
