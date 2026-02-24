"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const prismaClient_1 = require("../prismaClient");
const whatsappService_1 = require("../services/whatsappService");
const whatsappConnectionService_1 = require("../services/whatsappConnectionService");
const bullmq_1 = require("../queue/bullmq");
const router = (0, express_1.Router)();
router.use(auth_1.authMiddleware);
router.use(async (req, _res, next) => {
    await (0, auth_1.enrichAuth)(req);
    next();
});
function requireCompany(req) {
    const companyId = req.companyId;
    if (!companyId)
        throw new Error("Você precisa estar vinculado a uma empresa para acessar conexões.");
    return companyId;
}
/** Lista todas as sessões da empresa */
router.get("/sessions", async (req, res) => {
    try {
        const companyId = requireCompany(req);
        const sessions = await prismaClient_1.prisma.whatsappSession.findMany({
            where: { companyId },
            orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
            include: { _count: { select: { groups: true } }, company: { select: { name: true } } },
        });
        const { isClientReady, getOrCreateClient, setSessionLabel } = await Promise.resolve().then(() => __importStar(require("../services/whatsappClientManager")));
        for (const s of sessions) {
            setSessionLabel(s.id, { sessionName: s.name, companyName: s.company.name });
            if (s.status === "connected" && !isClientReady(s.id)) {
                void getOrCreateClient(s.id);
            }
        }
        const result = sessions.map((s) => ({
            id: s.id,
            name: s.name,
            isDefault: s.isDefault,
            status: isClientReady(s.id) ? "connected" : s.status,
            waPushName: s.waPushName,
            waPhone: s.waPhone,
            waAvatarUrl: s.waAvatarUrl,
            lastConnectedAt: s.lastConnectedAt,
            _count: s._count,
        }));
        res.json(result);
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao listar sessões" });
    }
});
/** Cria nova sessão */
router.post("/sessions", async (req, res) => {
    try {
        const companyId = requireCompany(req);
        const schema = zod_1.z.object({ name: zod_1.z.string().min(1).max(80) });
        const { name } = schema.parse(req.body);
        const { assertWithinLimit } = await Promise.resolve().then(() => __importStar(require("../services/planLimitsService")));
        await assertWithinLimit(companyId, "connections");
        const count = await prismaClient_1.prisma.whatsappSession.count({ where: { companyId } });
        const isDefault = count === 0;
        const session = await prismaClient_1.prisma.whatsappSession.create({
            data: { companyId, name: name.trim(), isDefault },
        });
        res.status(201).json(session);
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao criar sessão" });
    }
});
/** Atualiza sessão (nome) */
router.put("/sessions/:sessionId", async (req, res) => {
    try {
        const companyId = requireCompany(req);
        const schema = zod_1.z.object({ name: zod_1.z.string().min(1).max(80) });
        const { name } = schema.parse(req.body);
        const session = await prismaClient_1.prisma.whatsappSession.findFirst({
            where: { id: req.params.sessionId, companyId },
        });
        if (!session)
            return res.status(404).json({ message: "Sessão não encontrada" });
        const updated = await prismaClient_1.prisma.whatsappSession.update({
            where: { id: session.id },
            data: { name: name.trim() },
        });
        res.json(updated);
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao atualizar" });
    }
});
/** Define sessão como padrão */
router.put("/sessions/:sessionId/default", async (req, res) => {
    try {
        const companyId = requireCompany(req);
        const session = await prismaClient_1.prisma.whatsappSession.findFirst({
            where: { id: req.params.sessionId, companyId },
        });
        if (!session)
            return res.status(404).json({ message: "Sessão não encontrada" });
        await prismaClient_1.prisma.$transaction([
            prismaClient_1.prisma.whatsappSession.updateMany({
                where: { companyId },
                data: { isDefault: false },
            }),
            prismaClient_1.prisma.whatsappSession.update({
                where: { id: session.id },
                data: { isDefault: true },
            }),
        ]);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro" });
    }
});
/** Exclui sessão e dados vinculados (grupos da sessão, envios, alvos de campanha, etc.) */
router.delete("/sessions/:sessionId", async (req, res) => {
    try {
        const companyId = requireCompany(req);
        const session = await prismaClient_1.prisma.whatsappSession.findFirst({
            where: { id: req.params.sessionId, companyId },
        });
        if (!session)
            return res.status(404).json({ message: "Sessão não encontrada" });
        const { destroyClient } = await Promise.resolve().then(() => __importStar(require("../services/whatsappClientManager")));
        await destroyClient(session.id);
        const groupIds = await prismaClient_1.prisma.whatsappGroup.findMany({
            where: { sessionId: session.id },
            select: { id: true },
        });
        const ids = groupIds.map((g) => g.id);
        if (ids.length > 0) {
            await prismaClient_1.prisma.$transaction([
                prismaClient_1.prisma.linkClick.deleteMany({ where: { messageSend: { groupId: { in: ids } } } }),
                prismaClient_1.prisma.messageSend.deleteMany({ where: { groupId: { in: ids } } }),
                prismaClient_1.prisma.campaignTarget.deleteMany({ where: { groupId: { in: ids } } }),
                prismaClient_1.prisma.whatsappGroup.deleteMany({ where: { sessionId: session.id } }),
            ]);
        }
        // Campanhas desta sessão (sessionId) precisam ser removidas antes de excluir a sessão
        await prismaClient_1.prisma.campaign.deleteMany({ where: { sessionId: session.id } });
        await prismaClient_1.prisma.whatsappSession.delete({ where: { id: session.id } });
        const remaining = await prismaClient_1.prisma.whatsappSession.findFirst({
            where: { companyId },
        });
        if (remaining && !remaining.isDefault) {
            await prismaClient_1.prisma.whatsappSession.update({
                where: { id: remaining.id },
                data: { isDefault: true },
            });
        }
        res.json({ ok: true });
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao excluir" });
    }
});
/** Status de uma sessão */
router.get("/sessions/:sessionId/status", async (req, res) => {
    try {
        const companyId = requireCompany(req);
        const status = await (0, whatsappConnectionService_1.getConnectionStatus)(req.params.sessionId, companyId);
        res.json(status);
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao obter status" });
    }
});
/** QR Code de uma sessão */
router.get("/sessions/:sessionId/qr", async (req, res) => {
    try {
        const companyId = requireCompany(req);
        const qr = await (0, whatsappConnectionService_1.getQrCode)(req.params.sessionId, companyId);
        res.json(qr);
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao obter QR code" });
    }
});
/** Desconectar sessão. Enfileira quando Redis 6.2+; fallback em processo (Redis 5.x/Lua ou indisponível). */
router.post("/sessions/:sessionId/disconnect", async (req, res) => {
    try {
        const companyId = requireCompany(req);
        const sessionId = req.params.sessionId;
        const result = await (0, bullmq_1.addJobSafe)(bullmq_1.QUEUE_NAMES.WA_CLEANUP, "disconnect", { sessionId, companyId });
        if (!result.ok)
            await (0, whatsappConnectionService_1.disconnect)(sessionId, companyId);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao desconectar" });
    }
});
/** Reiniciar sessão. Enfileira quando Redis 6.2+; fallback em processo (Redis 5.x/Lua ou indisponível). */
router.post("/sessions/:sessionId/restart", async (req, res) => {
    try {
        const companyId = requireCompany(req);
        const sessionId = req.params.sessionId;
        const result = await (0, bullmq_1.addJobSafe)(bullmq_1.QUEUE_NAMES.WA_INIT, "restart", { sessionId, companyId });
        if (!result.ok)
            await (0, whatsappConnectionService_1.restart)(sessionId, companyId);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao reiniciar" });
    }
});
/** Libera client em pairing. Enfileira quando Redis 6.2+; fallback em processo (Redis 5.x/Lua ou indisponível). */
router.post("/sessions/:sessionId/release", async (req, res) => {
    try {
        const companyId = requireCompany(req);
        const sessionId = req.params.sessionId;
        const result = await (0, bullmq_1.addJobSafe)(bullmq_1.QUEUE_NAMES.WA_CLEANUP, "release", { sessionId, companyId });
        if (!result.ok)
            await (0, whatsappConnectionService_1.releasePairing)(sessionId, companyId);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro" });
    }
});
/** @deprecated Use /sessions - status da conexão principal (primeira sessão) */
router.get("/connection/status", async (req, res) => {
    try {
        const companyId = requireCompany(req);
        const session = await prismaClient_1.prisma.whatsappSession.findFirst({
            where: { companyId },
            orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        });
        if (!session) {
            const created = await prismaClient_1.prisma.whatsappSession.create({
                data: { companyId, name: "WhatsApp 1", isDefault: true, status: "disconnected" },
            });
            const status = await (0, whatsappConnectionService_1.getConnectionStatus)(created.id, companyId);
            return res.json({
                status: status.status,
                pushName: status.pushName,
                phone: status.phone,
                jid: status.jid,
                avatarUrl: status.avatarUrl,
                sessionName: status.name,
                lastConnectedAt: status.lastConnectedAt,
            });
        }
        const status = await (0, whatsappConnectionService_1.getConnectionStatus)(session.id, companyId);
        res.json({
            status: status.status,
            pushName: status.pushName,
            phone: status.phone,
            jid: status.jid,
            avatarUrl: status.avatarUrl,
            sessionName: status.name,
            lastConnectedAt: status.lastConnectedAt,
        });
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao obter status" });
    }
});
/** @deprecated Use /sessions/:id/qr */
router.get("/connection/qr", async (req, res) => {
    try {
        const companyId = requireCompany(req);
        let session = await prismaClient_1.prisma.whatsappSession.findFirst({
            where: { companyId },
            orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        });
        if (!session) {
            session = await prismaClient_1.prisma.whatsappSession.create({
                data: { companyId, name: "WhatsApp 1", isDefault: true, status: "disconnected" },
            });
        }
        const qr = await (0, whatsappConnectionService_1.getQrCode)(session.id, companyId);
        res.json(qr);
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao obter QR code" });
    }
});
/** @deprecated Use /sessions/:id/disconnect */
router.post("/connection/disconnect", async (req, res) => {
    try {
        const companyId = requireCompany(req);
        const session = await prismaClient_1.prisma.whatsappSession.findFirst({
            where: { companyId },
        });
        if (!session)
            return res.json({ ok: true });
        await (0, whatsappConnectionService_1.disconnect)(session.id, companyId);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao desconectar" });
    }
});
/** @deprecated Use /sessions/:id/restart */
router.post("/connection/restart", async (req, res) => {
    try {
        const companyId = requireCompany(req);
        const session = await prismaClient_1.prisma.whatsappSession.findFirst({
            where: { companyId },
        });
        if (!session)
            return res.status(404).json({ message: "Nenhuma sessão" });
        await (0, whatsappConnectionService_1.restart)(session.id, companyId);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao reiniciar" });
    }
});
router.post("/sync-groups", async (req, res) => {
    try {
        const companyId = requireCompany(req);
        const groups = await (0, whatsappService_1.fetchGroupsFromRemote)(companyId);
        res.json(groups);
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao sincronizar grupos" });
    }
});
router.get("/groups", async (req, res) => {
    try {
        const companyId = requireCompany(req);
        const groups = await (0, whatsappService_1.listGroups)(companyId);
        res.json(groups);
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao listar grupos" });
    }
});
router.post("/send", async (req, res) => {
    try {
        const schema = zod_1.z.object({
            groupId: zod_1.z.string().optional(),
            groupIds: zod_1.z.union([zod_1.z.string().array(), zod_1.z.string().transform((s) => [s])]).optional(),
            message: zod_1.z.string().min(1),
            mentionAll: zod_1.z.preprocess((v) => v === true || v === "true", zod_1.z.boolean().optional()).optional(),
        });
        const parsed = schema.parse(req.body);
        const companyId = requireCompany(req);
        const userId = req.userId;
        const message = parsed.message;
        const mentionAll = parsed.mentionAll === true;
        const groupIds = Array.isArray(parsed.groupIds)
            ? parsed.groupIds
            : parsed.groupId
                ? [parsed.groupId]
                : [];
        if (groupIds.length === 0) {
            res.status(400).json({ message: "Informe ao menos um grupo (groupId ou groupIds)." });
            return;
        }
        const { assertGroupSendsPerDay } = await Promise.resolve().then(() => __importStar(require("../services/planLimitsService")));
        await assertGroupSendsPerDay(companyId, groupIds.length);
        for (const groupId of groupIds) {
            await (0, whatsappService_1.sendMessageToGroup)(companyId, groupId, message, undefined, { userId, mentionAll });
        }
        res.json({ ok: true });
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao enviar mensagem" });
    }
});
exports.default = router;
