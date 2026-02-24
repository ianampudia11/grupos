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
const router = (0, express_1.Router)();
router.use(auth_1.authMiddleware);
router.use(auth_1.superAdminMiddleware);
router.get("/", async (_req, res) => {
    const list = await prismaClient_1.prisma.company.findMany({
        orderBy: { name: "asc" },
        include: {
            subscription: {
                include: { plan: true },
            },
            _count: { select: { users: true } },
        },
    });
    res.json(list);
});
/** SuperAdmin: desconectar uma sessão WhatsApp de qualquer empresa (antes de /:id) */
router.post("/sessions/:sessionId/disconnect", async (req, res) => {
    try {
        const session = await prismaClient_1.prisma.whatsappSession.findUnique({
            where: { id: req.params.sessionId },
        });
        if (!session)
            return res.status(404).json({ message: "Sessão não encontrada" });
        const { destroyClient } = await Promise.resolve().then(() => __importStar(require("../services/whatsappClientManager")));
        await destroyClient(session.id);
        await prismaClient_1.prisma.whatsappSession.update({
            where: { id: session.id },
            data: { status: "disconnected" },
        });
        res.json({ ok: true });
    }
    catch (err) {
        res.status(400).json({ message: err.message ?? "Erro ao desconectar" });
    }
});
/** Detalhe da empresa: usuários, conexões WhatsApp (sessões são da empresa, não do usuário) */
router.get("/:id", async (req, res) => {
    const company = await prismaClient_1.prisma.company.findUnique({
        where: { id: req.params.id },
        include: {
            subscription: { include: { plan: true } },
            users: {
                select: {
                    id: true,
                    email: true,
                    name: true,
                    role: true,
                    createdAt: true,
                },
            },
            whatsappSessions: {
                select: {
                    id: true,
                    name: true,
                    status: true,
                    waPushName: true,
                    waPhone: true,
                    waAvatarUrl: true,
                    lastConnectedAt: true,
                    isDefault: true,
                },
            },
        },
    });
    if (!company)
        return res.status(404).json({ message: "Empresa não encontrada" });
    const { isClientReady } = await Promise.resolve().then(() => __importStar(require("../services/whatsappClientManager")));
    const sessionsWithStatus = company.whatsappSessions.map((s) => ({
        ...s,
        status: isClientReady(s.id) ? "connected" : s.status,
    }));
    res.json({ ...company, whatsappSessions: sessionsWithStatus });
});
router.post("/", async (req, res) => {
    try {
        const schema = zod_1.z.object({
            name: zod_1.z.string().min(2),
            slug: zod_1.z.string().min(2).regex(/^[a-z0-9-]+$/),
            email: zod_1.z.string().email().optional(),
            phone: zod_1.z.string().optional(),
            document: zod_1.z.string().optional(),
        });
        const data = schema.parse(req.body);
        const existing = await prismaClient_1.prisma.company.findUnique({ where: { slug: data.slug } });
        if (existing)
            return res.status(400).json({ message: "Slug já existe" });
        const company = await prismaClient_1.prisma.company.create({
            data,
        });
        await prismaClient_1.prisma.whatsappSession.create({
            data: { companyId: company.id, name: "Conexão Principal", isDefault: true },
        });
        const companyWithSession = await prismaClient_1.prisma.company.findUnique({
            where: { id: company.id },
            include: { _count: { select: { whatsappSessions: true } } },
        });
        res.status(201).json(companyWithSession ?? company);
    }
    catch (err) {
        res.status(400).json({ message: err.message ?? "Erro ao criar empresa" });
    }
});
/** SuperAdmin: desativar empresa */
router.post("/:id/deactivate", async (req, res) => {
    try {
        const company = await prismaClient_1.prisma.company.update({
            where: { id: req.params.id },
            data: { isActive: false },
        });
        res.json(company);
    }
    catch (err) {
        if (err?.code === "P2025")
            return res.status(404).json({ message: "Empresa não encontrada" });
        res.status(400).json({ message: err.message ?? "Erro ao desativar" });
    }
});
/** SuperAdmin: reativar empresa */
router.post("/:id/activate", async (req, res) => {
    try {
        const company = await prismaClient_1.prisma.company.update({
            where: { id: req.params.id },
            data: { isActive: true },
        });
        res.json(company);
    }
    catch (err) {
        if (err?.code === "P2025")
            return res.status(404).json({ message: "Empresa não encontrada" });
        res.status(400).json({ message: err.message ?? "Erro ao reativar" });
    }
});
router.put("/:id", async (req, res) => {
    try {
        const schema = zod_1.z.object({
            name: zod_1.z.string().min(2).optional(),
            slug: zod_1.z.string().min(2).regex(/^[a-z0-9-]+$/).optional(),
            email: zod_1.z.string().email().nullable().optional(),
            phone: zod_1.z.string().nullable().optional(),
            document: zod_1.z.string().nullable().optional(),
            isActive: zod_1.z.boolean().optional(),
        });
        const data = schema.parse(req.body);
        const company = await prismaClient_1.prisma.company.update({
            where: { id: req.params.id },
            data,
        });
        res.json(company);
    }
    catch (err) {
        res.status(400).json({ message: err.message ?? "Erro ao atualizar" });
    }
});
router.delete("/:id", async (req, res) => {
    try {
        await prismaClient_1.prisma.company.delete({ where: { id: req.params.id } });
        res.json({ ok: true });
    }
    catch (err) {
        if (err?.code === "P2025")
            return res.status(404).json({ message: "Empresa não encontrada" });
        res.status(400).json({ message: err.message ?? "Erro ao remover" });
    }
});
exports.default = router;
