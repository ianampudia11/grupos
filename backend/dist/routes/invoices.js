"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const prismaClient_1 = require("../prismaClient");
const mercadopagoService_1 = require("../services/mercadopagoService");
const logger_1 = require("../utils/logger");
const router = (0, express_1.Router)();
router.use(auth_1.authMiddleware);
/** Lista planos disponíveis para upgrade */
router.get("/plans/upgrade", async (req, res) => {
    try {
        const userId = req.userId;
        const user = await prismaClient_1.prisma.user.findUnique({
            where: { id: userId },
            include: { company: { include: { subscription: true } } },
        });
        if (!user?.companyId)
            return res.json([]);
        const currentPlanId = user.company?.subscription?.planId;
        const plans = await prismaClient_1.prisma.plan.findMany({ where: { isActive: true }, orderBy: { price: "asc" } });
        res.json(plans.filter((p) => p.id !== currentPlanId));
    }
    catch (err) {
        res.status(400).json({ message: err?.message ?? "Erro ao listar planos" });
    }
});
/** Solicita upgrade de plano - cria fatura com vencimento no mesmo dia */
router.post("/upgrade", async (req, res) => {
    try {
        const userId = req.userId;
        const user = await prismaClient_1.prisma.user.findUnique({
            where: { id: userId },
            include: { company: { include: { subscription: { include: { plan: true } } } } },
        });
        if (!user?.companyId || !user.company) {
            return res.status(400).json({ message: "Usuário sem empresa" });
        }
        const planId = req.body?.planId;
        if (!planId)
            return res.status(400).json({ message: "Informe o plano (planId)" });
        const plan = await prismaClient_1.prisma.plan.findFirst({ where: { id: planId, isActive: true } });
        if (!plan)
            return res.status(404).json({ message: "Plano não encontrado" });
        const sub = user.company.subscription;
        if (!sub)
            return res.status(400).json({ message: "Empresa sem assinatura. Contate o suporte." });
        if (sub.planId === planId)
            return res.status(400).json({ message: "Você já está neste plano." });
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        const invoice = await prismaClient_1.prisma.invoice.create({
            data: {
                companyId: user.company.id,
                subscriptionId: sub.id,
                amount: plan.price,
                status: "pending",
                dueDate: today,
                upgradePlanId: planId,
            },
            include: { subscription: { include: { plan: true } } },
        });
        res.json(invoice);
    }
    catch (err) {
        res.status(400).json({ message: err?.message ?? "Erro ao solicitar upgrade" });
    }
});
/** Lista faturas da empresa do usuário */
router.get("/", async (req, res) => {
    try {
        const userId = req.userId;
        const user = await prismaClient_1.prisma.user.findUnique({
            where: { id: userId },
            select: { companyId: true },
        });
        if (!user?.companyId) {
            return res.json([]);
        }
        const invoices = await prismaClient_1.prisma.invoice.findMany({
            where: { companyId: user.companyId },
            orderBy: { dueDate: "desc" },
            include: { subscription: { include: { plan: true } } },
        });
        res.json(invoices);
    }
    catch (err) {
        res.status(400).json({ message: err?.message ?? "Erro ao listar faturas" });
    }
});
/** Gera pagamento PIX para uma fatura pendente */
router.post("/:id/pay", async (req, res) => {
    try {
        const userId = req.userId;
        const user = await prismaClient_1.prisma.user.findUnique({
            where: { id: userId },
            include: { company: true },
        });
        if (!user?.companyId || !user.company) {
            return res.status(400).json({ message: "Usuário sem empresa" });
        }
        const invoice = await prismaClient_1.prisma.invoice.findFirst({
            where: { id: req.params.id, companyId: user.companyId, status: "pending" },
        });
        if (!invoice) {
            return res.status(404).json({ message: "Fatura não encontrada ou já paga" });
        }
        const pix = await (0, mercadopagoService_1.createPixOrder)({
            title: `Fatura #${invoice.id.slice(-6)} - ${user.company.name}`,
            amount: invoice.amount,
            externalReference: invoice.id,
            payerEmail: user.company.email || user.email,
            payerName: user.name || user.company.name,
        });
        await prismaClient_1.prisma.invoice.update({
            where: { id: invoice.id },
            data: { mpPaymentId: pix.paymentId },
        });
        logger_1.logger.info("PIX", `Pay fatura ${invoice.id}: qr=${!!pix.qrCode} base64=${!!pix.qrCodeBase64}`);
        res.json({
            qrCode: pix.qrCode,
            qrCodeBase64: pix.qrCodeBase64,
            expirationMinutes: pix.expirationMinutes,
            amount: invoice.amount,
        });
    }
    catch (err) {
        res.status(400).json({ message: err?.message ?? "Erro ao gerar pagamento PIX" });
    }
});
exports.default = router;
