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
const messageGeneratorService_1 = require("../services/messageGeneratorService");
const router = (0, express_1.Router)();
router.use(auth_1.authMiddleware);
router.get("/", async (req, res) => {
    const userId = req.userId;
    const custom = await prismaClient_1.prisma.messageTemplate.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
    });
    res.json({ builtin: messageGeneratorService_1.DEFAULT_TEMPLATES, custom });
});
router.post("/generate", async (req, res) => {
    try {
        const { generateMessage } = await Promise.resolve().then(() => __importStar(require("../services/messageGeneratorService")));
        const schema = zod_1.z.object({
            templateBody: zod_1.z.string().min(1),
            productId: zod_1.z.string().optional(),
            seed: zod_1.z.number().optional(),
        });
        const { templateBody, productId, seed } = schema.parse(req.body);
        const userId = req.userId;
        let product = null;
        if (productId) {
            const p = await prismaClient_1.prisma.product.findFirst({
                where: { id: productId, userId },
            });
            if (p)
                product = {
                    title: p.title,
                    price: p.price,
                    oldPrice: p.oldPrice ?? undefined,
                    discountPercent: p.discountPercent ?? undefined,
                    coupon: p.coupon ?? undefined,
                    link: p.link ?? undefined,
                    store: p.store ?? undefined,
                    category: p.category ?? undefined,
                };
        }
        const message = generateMessage(templateBody, product, seed);
        res.json({ message });
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao gerar mensagem" });
    }
});
router.post("/", async (req, res) => {
    try {
        const userId = req.userId;
        const schema = zod_1.z.object({
            name: zod_1.z.string().min(1),
            templateType: zod_1.z.string(),
            body: zod_1.z.string().min(1),
            cta: zod_1.z.string().optional(),
        });
        const body = schema.parse(req.body);
        const template = await prismaClient_1.prisma.messageTemplate.create({
            data: { userId, ...body },
        });
        res.status(201).json(template);
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao criar template" });
    }
});
router.put("/:id", async (req, res) => {
    try {
        const userId = req.userId;
        const schema = zod_1.z.object({
            name: zod_1.z.string().min(1).optional(),
            templateType: zod_1.z.string().optional(),
            body: zod_1.z.string().min(1).optional(),
            cta: zod_1.z.string().optional(),
        });
        const body = schema.parse(req.body);
        const existing = await prismaClient_1.prisma.messageTemplate.findFirst({
            where: { id: req.params.id, userId },
        });
        if (!existing)
            return res.status(404).json({ message: "Template não encontrado" });
        const template = await prismaClient_1.prisma.messageTemplate.update({
            where: { id: req.params.id },
            data: body,
        });
        res.json(template);
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao atualizar template" });
    }
});
router.delete("/:id", async (req, res) => {
    try {
        const userId = req.userId;
        const existing = await prismaClient_1.prisma.messageTemplate.findFirst({
            where: { id: req.params.id, userId },
        });
        if (!existing)
            return res.status(404).json({ message: "Template não encontrado" });
        await prismaClient_1.prisma.messageTemplate.delete({ where: { id: req.params.id } });
        res.json({ ok: true });
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao remover template" });
    }
});
exports.default = router;
