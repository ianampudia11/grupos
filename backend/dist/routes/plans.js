"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const prismaClient_1 = require("../prismaClient");
const router = (0, express_1.Router)();
/** Lista planos ativos (público - usado no registro). Exclui vitalício (só para SuperAdmin). */
router.get("/public", async (_req, res) => {
    const list = await prismaClient_1.prisma.plan.findMany({
        where: {
            isActive: true,
            slug: { not: "vitalicio" },
        },
        orderBy: { price: "asc" },
        select: { id: true, name: true, slug: true, price: true, limits: true },
    });
    res.json(list);
});
router.use(auth_1.authMiddleware);
router.use(auth_1.superAdminMiddleware);
const defaultLimits = {
    connections: 1,
    campaigns: 50,
    users: 5,
    groups: 200,
};
router.get("/", async (_req, res) => {
    const list = await prismaClient_1.prisma.plan.findMany({
        orderBy: { price: "asc" },
        include: { _count: { select: { subscriptions: true } } },
    });
    res.json(list);
});
router.post("/", async (req, res) => {
    try {
        const schema = zod_1.z.object({
            name: zod_1.z.string().min(2),
            slug: zod_1.z.string().min(2).regex(/^[a-z0-9-]+$/),
            price: zod_1.z.number().min(0),
            limits: zod_1.z
                .object({
                connections: zod_1.z.number().int().min(0).optional(),
                campaigns: zod_1.z.number().int().min(0).optional(),
                users: zod_1.z.number().int().min(0).optional(),
                groups: zod_1.z.number().int().min(0).optional(),
            })
                .optional(),
        });
        const data = schema.parse(req.body);
        const existing = await prismaClient_1.prisma.plan.findUnique({ where: { slug: data.slug } });
        if (existing)
            return res.status(400).json({ message: "Slug já existe" });
        const limits = { ...defaultLimits, ...data.limits };
        const plan = await prismaClient_1.prisma.plan.create({
            data: {
                name: data.name,
                slug: data.slug,
                price: data.price,
                limits: limits,
            },
        });
        res.status(201).json(plan);
    }
    catch (err) {
        res.status(400).json({ message: err.message ?? "Erro ao criar plano" });
    }
});
router.put("/:id", async (req, res) => {
    try {
        const schema = zod_1.z.object({
            name: zod_1.z.string().min(2).optional(),
            slug: zod_1.z.string().min(2).regex(/^[a-z0-9-]+$/).optional(),
            price: zod_1.z.number().min(0).optional(),
            limits: zod_1.z.record(zod_1.z.any()).optional(),
            isActive: zod_1.z.boolean().optional(),
        });
        const data = schema.parse(req.body);
        const plan = await prismaClient_1.prisma.plan.update({
            where: { id: req.params.id },
            data: data,
        });
        res.json(plan);
    }
    catch (err) {
        res.status(400).json({ message: err.message ?? "Erro ao atualizar" });
    }
});
router.delete("/:id", async (req, res) => {
    try {
        const subs = await prismaClient_1.prisma.subscription.count({ where: { planId: req.params.id } });
        if (subs > 0) {
            return res.status(400).json({ message: "Plano em uso. Desative-o em vez de excluir." });
        }
        await prismaClient_1.prisma.plan.delete({ where: { id: req.params.id } });
        res.json({ ok: true });
    }
    catch (err) {
        res.status(400).json({ message: err.message ?? "Erro ao remover" });
    }
});
exports.default = router;
