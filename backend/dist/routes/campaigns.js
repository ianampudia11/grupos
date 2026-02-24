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
const multerCompanyUpload_1 = require("../utils/multerCompanyUpload");
const router = (0, express_1.Router)();
router.use(auth_1.authMiddleware);
router.use(async (req, _res, next) => {
    await (0, auth_1.enrichAuth)(req);
    next();
});
router.get("/", async (req, res) => {
    const userId = req.userId;
    const items = await prismaClient_1.prisma.campaign.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        include: { targets: { include: { group: true } }, product: true },
    });
    res.json(items);
});
/** Limites do plano para campanhas (campanhas/dia, grupos por campanha) */
router.get("/limits", async (req, res) => {
    try {
        const companyId = req.companyId;
        if (!companyId) {
            return res.json({
                campaignsPerDay: { usedToday: 0, limit: 50 },
                groupsPerCampaign: 200,
            });
        }
        const { getCompanyLimits, checkCampaignsPerDay } = await Promise.resolve().then(() => __importStar(require("../services/planLimitsService")));
        const limits = await getCompanyLimits(companyId);
        const campaignsPerDay = await checkCampaignsPerDay(companyId);
        res.json({
            campaignsPerDay: { usedToday: campaignsPerDay.usedToday, limit: campaignsPerDay.limit },
            groupsPerCampaign: limits.groupsPerCampaign,
        });
    }
    catch (err) {
        res.status(400).json({ message: err?.message ?? "Erro ao obter limites" });
    }
});
router.post("/", multerCompanyUpload_1.campaignImageUpload.single("image"), async (req, res) => {
    try {
        const userId = req.userId;
        const schema = zod_1.z.object({
            sessionId: zod_1.z.string().optional(),
            title: zod_1.z.string().min(2).optional(),
            messageText: zod_1.z.string().min(1),
            productId: zod_1.z.string().optional(),
            templateId: zod_1.z.string().optional(),
            scheduledAt: zod_1.z.string().optional(), // ISO date
            repeatRule: zod_1.z.enum(["none", "daily", "weekly"]).optional().default("none"),
            linkUrl: zod_1.z.preprocess((v) => {
                if (v === null || v === undefined)
                    return undefined;
                const s = String(v).trim();
                if (!s || s.toLowerCase() === "null" || s.toLowerCase() === "undefined")
                    return undefined;
                return s;
            }, zod_1.z.string().url().optional()),
            groupIds: zod_1.z.string().min(1),
            sendNow: zod_1.z.string().optional(),
            mentionAll: zod_1.z.preprocess((v) => v === "true" || v === true, zod_1.z.boolean().optional()).optional(),
        });
        const parsed = schema.parse(req.body);
        const scheduledAtParsed = parsed.scheduledAt ? new Date(parsed.scheduledAt) : undefined;
        const groupIds = parsed.groupIds
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        if (!groupIds.length)
            return res.status(400).json({ message: "Selecione ao menos 1 grupo" });
        const companyId = req.companyId;
        if (!companyId)
            return res.status(400).json({ message: "Usuário precisa estar vinculado a uma empresa" });
        const { assertCampaignsPerDay, assertCampaignGroupsLimit } = await Promise.resolve().then(() => __importStar(require("../services/planLimitsService")));
        await assertCampaignGroupsLimit(companyId, groupIds.length);
        if (parsed.sendNow === "true") {
            await assertCampaignsPerDay(companyId);
        }
        const session = parsed.sessionId
            ? await prismaClient_1.prisma.whatsappSession.findFirst({
                where: { id: parsed.sessionId, companyId },
            })
            : await prismaClient_1.prisma.whatsappSession.findFirst({ where: { companyId } });
        if (!session)
            return res.status(400).json({ message: "Sessão WhatsApp não encontrada" });
        const imagePath = req.file ? (0, multerCompanyUpload_1.getFilePathForDb)(req, req.file.filename) : undefined;
        const existingGroups = await prismaClient_1.prisma.whatsappGroup.findMany({
            where: { id: { in: groupIds }, sessionId: session.id },
            select: { id: true },
        });
        const existingSet = new Set(existingGroups.map((g) => g.id));
        const missing = groupIds.filter((id) => !existingSet.has(id));
        if (missing.length) {
            await prismaClient_1.prisma.whatsappGroup.createMany({
                data: missing.map((id) => ({ id, waId: id, name: id, sessionId: session.id })),
                skipDuplicates: true,
            });
        }
        const status = parsed.sendNow === "true" ? "queued" : scheduledAtParsed && scheduledAtParsed > new Date() ? "queued" : "draft";
        let imagePathFinal = imagePath;
        let linkUrlFinal = parsed.linkUrl;
        if (parsed.productId) {
            const product = await prismaClient_1.prisma.product.findFirst({
                where: { id: parsed.productId, userId },
                include: { images: { orderBy: { sortOrder: "asc" }, take: 1 } },
            });
            if (product) {
                if (!imagePathFinal && product.images[0]?.filePath)
                    imagePathFinal = product.images[0].filePath;
                if (!linkUrlFinal && product.link)
                    linkUrlFinal = product.link;
            }
        }
        const campaign = await prismaClient_1.prisma.campaign.create({
            data: {
                userId,
                sessionId: session.id,
                title: parsed.title,
                messageText: parsed.messageText,
                linkUrl: linkUrlFinal,
                imagePath: imagePathFinal,
                productId: parsed.productId || undefined,
                templateId: parsed.templateId || undefined,
                status,
                scheduledAt: scheduledAtParsed,
                repeatRule: parsed.repeatRule === "none" ? undefined : parsed.repeatRule,
                mentionAll: parsed.mentionAll === true,
                targets: {
                    create: groupIds.map((gid) => ({ groupId: gid })),
                },
            },
            include: { targets: { include: { group: true } } },
        });
        if (parsed.sendNow === "true") {
            const { sendCampaign } = await Promise.resolve().then(() => __importStar(require("../services/campaignSendService")));
            await sendCampaign(campaign.id, userId);
        }
        res.status(201).json(campaign);
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao criar campanha" });
    }
});
router.post("/:id/send", async (req, res) => {
    try {
        const userId = req.userId;
        const { sendCampaign } = await Promise.resolve().then(() => __importStar(require("../services/campaignSendService")));
        await sendCampaign(req.params.id, userId);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao enviar campanha" });
    }
});
router.patch("/:id/pause", async (req, res) => {
    try {
        const userId = req.userId;
        const campaign = await prismaClient_1.prisma.campaign.findUnique({ where: { id: req.params.id } });
        if (!campaign || campaign.userId !== userId) {
            return res.status(404).json({ message: "Campanha não encontrada" });
        }
        await prismaClient_1.prisma.campaign.update({
            where: { id: campaign.id },
            data: { status: "paused" },
        });
        res.json({ ok: true });
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao pausar" });
    }
});
router.patch("/:id/resume", async (req, res) => {
    try {
        const userId = req.userId;
        const campaign = await prismaClient_1.prisma.campaign.findUnique({ where: { id: req.params.id } });
        if (!campaign || campaign.userId !== userId) {
            return res.status(404).json({ message: "Campanha não encontrada" });
        }
        await prismaClient_1.prisma.campaign.update({
            where: { id: campaign.id },
            data: { status: campaign.scheduledAt && campaign.scheduledAt > new Date() ? "queued" : "draft" },
        });
        res.json({ ok: true });
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao retomar" });
    }
});
router.delete("/all", async (req, res) => {
    try {
        const userId = req.userId;
        const campaigns = await prismaClient_1.prisma.campaign.findMany({ where: { userId }, select: { id: true } });
        const ids = campaigns.map((c) => c.id);
        if (ids.length === 0) {
            return res.json({ ok: true, deleted: 0 });
        }
        await prismaClient_1.prisma.$transaction([
            prismaClient_1.prisma.messageSend.updateMany({ where: { campaignId: { in: ids } }, data: { campaignId: null } }),
            prismaClient_1.prisma.campaignTarget.deleteMany({ where: { campaignId: { in: ids } } }),
            prismaClient_1.prisma.campaign.deleteMany({ where: { userId } }),
        ]);
        res.json({ ok: true, deleted: ids.length });
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao limpar" });
    }
});
router.delete("/:id", async (req, res) => {
    try {
        const userId = req.userId;
        const campaign = await prismaClient_1.prisma.campaign.findFirst({
            where: { id: req.params.id, userId },
        });
        if (!campaign)
            return res.status(404).json({ message: "Campanha não encontrada" });
        await prismaClient_1.prisma.$transaction([
            prismaClient_1.prisma.messageSend.updateMany({ where: { campaignId: campaign.id }, data: { campaignId: null } }),
            prismaClient_1.prisma.campaignTarget.deleteMany({ where: { campaignId: campaign.id } }),
            prismaClient_1.prisma.campaign.delete({ where: { id: campaign.id } }),
        ]);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao excluir" });
    }
});
exports.default = router;
