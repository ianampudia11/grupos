"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const prismaClient_1 = require("../prismaClient");
const router = (0, express_1.Router)();
router.use(auth_1.authMiddleware);
router.use(auth_1.superAdminMiddleware);
/** Atribui/atualiza assinatura de uma empresa */
router.put("/company/:companyId", async (req, res) => {
    try {
        const schema = zod_1.z.object({
            planId: zod_1.z.string(),
        });
        const { planId } = schema.parse(req.body);
        const plan = await prismaClient_1.prisma.plan.findUnique({ where: { id: planId } });
        if (!plan)
            return res.status(404).json({ message: "Plano não encontrado" });
        const company = await prismaClient_1.prisma.company.findUnique({
            where: { id: req.params.companyId },
            include: { subscription: true },
        });
        if (!company)
            return res.status(404).json({ message: "Empresa não encontrada" });
        const now = new Date();
        const billingDay = Math.min(28, Math.max(1, now.getDate()));
        const periodEnd = new Date(now.getFullYear(), now.getMonth(), Math.min(billingDay, 28));
        periodEnd.setMonth(periodEnd.getMonth() + 1);
        if (company.subscription) {
            await prismaClient_1.prisma.subscription.update({
                where: { id: company.subscription.id },
                data: {
                    planId,
                    status: "active",
                    billingDay,
                    currentPeriodStart: now,
                    currentPeriodEnd: periodEnd,
                },
            });
        }
        else {
            await prismaClient_1.prisma.subscription.create({
                data: {
                    companyId: company.id,
                    planId,
                    billingDay,
                    currentPeriodStart: now,
                    currentPeriodEnd: periodEnd,
                },
            });
        }
        const updated = await prismaClient_1.prisma.company.findUnique({
            where: { id: company.id },
            include: { subscription: { include: { plan: true } } },
        });
        res.json(updated?.subscription);
    }
    catch (err) {
        res.status(400).json({ message: err?.message ?? "Erro ao atualizar assinatura" });
    }
});
/** Altera o dia de vencimento (ciclo) da assinatura */
router.put("/company/:companyId/cycle", async (req, res) => {
    try {
        const schema = zod_1.z.object({ billingDay: zod_1.z.number().min(1).max(28) });
        const { billingDay } = schema.parse(req.body);
        const company = await prismaClient_1.prisma.company.findUnique({
            where: { id: req.params.companyId },
            include: { subscription: true },
        });
        if (!company)
            return res.status(404).json({ message: "Empresa não encontrada" });
        if (!company.subscription)
            return res.status(400).json({ message: "Empresa sem assinatura" });
        await prismaClient_1.prisma.subscription.update({
            where: { id: company.subscription.id },
            data: { billingDay },
        });
        const updated = await prismaClient_1.prisma.company.findUnique({
            where: { id: company.id },
            include: { subscription: { include: { plan: true } } },
        });
        res.json(updated?.subscription);
    }
    catch (err) {
        res.status(400).json({ message: err?.message ?? "Erro ao alterar ciclo" });
    }
});
/** Dar baixa manual: marca fatura pendente como paga e avança período */
router.post("/company/:companyId/baixa", async (req, res) => {
    try {
        const company = await prismaClient_1.prisma.company.findUnique({
            where: { id: req.params.companyId },
            include: { subscription: { include: { plan: true } }, invoices: true },
        });
        if (!company)
            return res.status(404).json({ message: "Empresa não encontrada" });
        if (!company.subscription)
            return res.status(400).json({ message: "Empresa sem assinatura" });
        const sub = company.subscription;
        const pendingInv = company.invoices.find((i) => ["pending", "overdue"].includes(i.status));
        const now = new Date();
        if (pendingInv) {
            await prismaClient_1.prisma.invoice.update({
                where: { id: pendingInv.id },
                data: { status: "paid", paidAt: now },
            });
        }
        const { billingDay } = sub;
        const nextEnd = new Date(sub.currentPeriodEnd);
        nextEnd.setMonth(nextEnd.getMonth() + 1);
        const d = Math.min(billingDay, 28);
        nextEnd.setDate(d);
        await prismaClient_1.prisma.subscription.update({
            where: { id: sub.id },
            data: {
                currentPeriodStart: sub.currentPeriodEnd,
                currentPeriodEnd: nextEnd,
            },
        });
        const nextDue = new Date(nextEnd);
        await prismaClient_1.prisma.invoice.create({
            data: {
                companyId: company.id,
                subscriptionId: sub.id,
                amount: sub.plan.price,
                status: "pending",
                dueDate: nextDue,
            },
        });
        const updated = await prismaClient_1.prisma.company.findUnique({
            where: { id: company.id },
            include: { subscription: { include: { plan: true } } },
        });
        res.json(updated?.subscription);
    }
    catch (err) {
        res.status(400).json({ message: err?.message ?? "Erro ao dar baixa" });
    }
});
exports.default = router;
