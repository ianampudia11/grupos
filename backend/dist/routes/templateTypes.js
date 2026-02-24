"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const prismaClient_1 = require("../prismaClient");
const DEFAULT_TYPES = [
    { slug: "oferta_relampago", label: "Oferta Relâmpago", sortOrder: 0 },
    { slug: "cupom", label: "Cupom", sortOrder: 1 },
    { slug: "frete_gratis", label: "Frete Grátis", sortOrder: 2 },
    { slug: "custom", label: "Personalizado", sortOrder: 3 },
];
const router = (0, express_1.Router)();
router.use(auth_1.authMiddleware);
router.get("/", async (req, res) => {
    const userId = req.userId;
    let types = await prismaClient_1.prisma.templateType.findMany({
        where: { userId },
        orderBy: { sortOrder: "asc" },
    });
    if (types.length === 0) {
        await prismaClient_1.prisma.templateType.createMany({
            data: DEFAULT_TYPES.map((t) => ({ userId, ...t })),
        });
        types = await prismaClient_1.prisma.templateType.findMany({
            where: { userId },
            orderBy: { sortOrder: "asc" },
        });
    }
    res.json(types);
});
router.post("/", async (req, res) => {
    try {
        const userId = req.userId;
        const schema = zod_1.z.object({
            slug: zod_1.z.string().min(1).regex(/^[a-z0-9_]+$/, "Use apenas letras minúsculas, números e _"),
            label: zod_1.z.string().min(1),
        });
        const body = schema.parse(req.body);
        const existing = await prismaClient_1.prisma.templateType.findUnique({
            where: { userId_slug: { userId, slug: body.slug } },
        });
        if (existing)
            return res.status(400).json({ message: "Já existe um tipo com este slug" });
        const maxOrder = await prismaClient_1.prisma.templateType.aggregate({
            where: { userId },
            _max: { sortOrder: true },
        });
        const type = await prismaClient_1.prisma.templateType.create({
            data: {
                userId,
                slug: body.slug,
                label: body.label,
                sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
            },
        });
        res.status(201).json(type);
    }
    catch (err) {
        res.status(400).json({ message: err.message ?? "Erro ao criar tipo" });
    }
});
router.put("/:id", async (req, res) => {
    try {
        const userId = req.userId;
        const schema = zod_1.z.object({
            slug: zod_1.z.string().min(1).regex(/^[a-z0-9_]+$/).optional(),
            label: zod_1.z.string().min(1).optional(),
        });
        const body = schema.parse(req.body);
        const existing = await prismaClient_1.prisma.templateType.findFirst({
            where: { id: req.params.id, userId },
        });
        if (!existing)
            return res.status(404).json({ message: "Tipo não encontrado" });
        if (body.slug) {
            const dup = await prismaClient_1.prisma.templateType.findFirst({
                where: { userId, slug: body.slug, id: { not: req.params.id } },
            });
            if (dup)
                return res.status(400).json({ message: "Já existe um tipo com este slug" });
        }
        const type = await prismaClient_1.prisma.templateType.update({
            where: { id: req.params.id },
            data: body,
        });
        res.json(type);
    }
    catch (err) {
        res.status(400).json({ message: err.message ?? "Erro ao atualizar tipo" });
    }
});
router.delete("/:id", async (req, res) => {
    try {
        const userId = req.userId;
        const existing = await prismaClient_1.prisma.templateType.findFirst({
            where: { id: req.params.id, userId },
        });
        if (!existing)
            return res.status(404).json({ message: "Tipo não encontrado" });
        await prismaClient_1.prisma.templateType.delete({ where: { id: req.params.id } });
        await prismaClient_1.prisma.messageTemplate.updateMany({
            where: { userId, templateType: existing.slug },
            data: { templateType: "custom" },
        });
        res.json({ ok: true });
    }
    catch (err) {
        res.status(400).json({ message: err.message ?? "Erro ao remover tipo" });
    }
});
exports.default = router;
