"use strict";
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
    const items = await prismaClient_1.prisma.product.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        include: { images: { orderBy: { sortOrder: "asc" } } },
    });
    res.json(items);
});
router.get("/:id", async (req, res) => {
    const userId = req.userId;
    const item = await prismaClient_1.prisma.product.findFirst({
        where: { id: req.params.id, userId },
        include: { images: { orderBy: { sortOrder: "asc" } } },
    });
    if (!item)
        return res.status(404).json({ message: "Produto não encontrado" });
    res.json(item);
});
router.post("/", multerCompanyUpload_1.productImageUpload.array("images", 10), async (req, res) => {
    try {
        const userId = req.userId;
        const schema = zod_1.z.object({
            title: zod_1.z.string().min(1),
            price: zod_1.z.string().min(1),
            oldPrice: zod_1.z.string().optional(),
            discountPercent: zod_1.z.coerce.number().optional(),
            coupon: zod_1.z.string().optional(),
            link: zod_1.z.string().optional(),
            store: zod_1.z.string().optional(),
            category: zod_1.z.string().optional(),
            tags: zod_1.z.string().optional(),
            validUntil: zod_1.z.string().optional(),
            status: zod_1.z.enum(["active", "expired"]).optional().default("active"),
        });
        const body = schema.parse(req.body);
        const files = req.files;
        const validUntil = body.validUntil ? new Date(body.validUntil) : undefined;
        const product = await prismaClient_1.prisma.product.create({
            data: {
                userId,
                title: body.title,
                price: body.price,
                oldPrice: body.oldPrice || undefined,
                discountPercent: body.discountPercent,
                coupon: body.coupon || undefined,
                link: body.link || undefined,
                store: body.store || undefined,
                category: body.category || undefined,
                tags: body.tags || undefined,
                validUntil,
                status: body.status,
            },
        });
        if (files?.length) {
            await prismaClient_1.prisma.productImage.createMany({
                data: files.map((f, i) => ({
                    productId: product.id,
                    filePath: (0, multerCompanyUpload_1.getFilePathForDb)(req, f.filename),
                    type: f.mimetype.startsWith("video/") ? "video" : "image",
                    sortOrder: i,
                })),
            });
        }
        const created = await prismaClient_1.prisma.product.findUnique({
            where: { id: product.id },
            include: { images: true },
        });
        res.status(201).json(created);
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao criar produto" });
    }
});
router.put("/:id", multerCompanyUpload_1.productImageUpload.array("images", 10), async (req, res) => {
    try {
        const userId = req.userId;
        const schema = zod_1.z.object({
            title: zod_1.z.string().min(1).optional(),
            price: zod_1.z.string().optional(),
            oldPrice: zod_1.z.string().optional(),
            discountPercent: zod_1.z.coerce.number().optional(),
            coupon: zod_1.z.string().optional(),
            link: zod_1.z.string().optional(),
            store: zod_1.z.string().optional(),
            category: zod_1.z.string().optional(),
            tags: zod_1.z.string().optional(),
            validUntil: zod_1.z.string().optional(),
            status: zod_1.z.enum(["active", "expired"]).optional(),
        });
        const body = schema.parse(req.body);
        const files = req.files;
        const existing = await prismaClient_1.prisma.product.findFirst({
            where: { id: req.params.id, userId },
        });
        if (!existing)
            return res.status(404).json({ message: "Produto não encontrado" });
        const validUntil = body.validUntil !== undefined ? (body.validUntil ? new Date(body.validUntil) : null) : undefined;
        await prismaClient_1.prisma.product.update({
            where: { id: req.params.id },
            data: {
                ...(body.title != null && { title: body.title }),
                ...(body.price != null && { price: body.price }),
                ...(body.oldPrice !== undefined && { oldPrice: body.oldPrice || null }),
                ...(body.discountPercent !== undefined && { discountPercent: body.discountPercent }),
                ...(body.coupon !== undefined && { coupon: body.coupon || null }),
                ...(body.link !== undefined && { link: body.link || null }),
                ...(body.store !== undefined && { store: body.store || null }),
                ...(body.category !== undefined && { category: body.category || null }),
                ...(body.tags !== undefined && { tags: body.tags || null }),
                ...(validUntil !== undefined && { validUntil }),
                ...(body.status != null && { status: body.status }),
            },
        });
        if (files?.length) {
            const maxOrder = await prismaClient_1.prisma.productImage.aggregate({
                where: { productId: req.params.id },
                _max: { sortOrder: true },
            });
            const startOrder = (maxOrder._max.sortOrder ?? -1) + 1;
            await prismaClient_1.prisma.productImage.createMany({
                data: files.map((f, i) => ({
                    productId: req.params.id,
                    filePath: (0, multerCompanyUpload_1.getFilePathForDb)(req, f.filename),
                    type: f.mimetype.startsWith("video/") ? "video" : "image",
                    sortOrder: startOrder + i,
                })),
            });
        }
        const updated = await prismaClient_1.prisma.product.findUnique({
            where: { id: req.params.id },
            include: { images: { orderBy: { sortOrder: "asc" } } },
        });
        res.json(updated);
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao atualizar produto" });
    }
});
router.delete("/:id", async (req, res) => {
    try {
        const userId = req.userId;
        const existing = await prismaClient_1.prisma.product.findFirst({
            where: { id: req.params.id, userId },
        });
        if (!existing)
            return res.status(404).json({ message: "Produto não encontrado" });
        await prismaClient_1.prisma.product.delete({ where: { id: req.params.id } });
        res.json({ ok: true });
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao remover produto" });
    }
});
exports.default = router;
