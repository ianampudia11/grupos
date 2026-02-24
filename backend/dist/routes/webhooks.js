"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const axios_1 = __importDefault(require("axios"));
const prismaClient_1 = require("../prismaClient");
const logger_1 = require("../utils/logger");
const systemSettingService_1 = require("../services/systemSettingService");
const socketIo_1 = require("../socketIo");
const router = (0, express_1.Router)();
async function markInvoicePaidAndEmit(invoice, paymentId) {
    if (!["pending", "overdue"].includes(invoice.status))
        return;
    await prismaClient_1.prisma.invoice.update({
        where: { id: invoice.id },
        data: {
            status: "paid",
            mpPaymentId: paymentId,
            paidAt: new Date(),
        },
    });
    if (invoice.subscription) {
        const sub = invoice.subscription;
        const updateData = {
            currentPeriodStart: sub.currentPeriodEnd,
            currentPeriodEnd: new Date(sub.currentPeriodEnd.getFullYear(), sub.currentPeriodEnd.getMonth() + 1, Math.min(sub.billingDay, 28)),
            trialEndsAt: null,
        };
        if (invoice.upgradePlanId) {
            updateData.planId = invoice.upgradePlanId;
        }
        await prismaClient_1.prisma.subscription.update({
            where: { id: sub.id },
            data: updateData,
        });
    }
    logger_1.logger.success("WEBHOOK", `Fatura ${invoice.id} marcada como paga`);
    (0, socketIo_1.emitInvoicePaid)(invoice.companyId, { invoiceId: invoice.id });
}
/** Webhook Mercado Pago - notificações de pagamento (payment) e pedido (order - Orders API) */
router.post("/mercadopago", async (req, res) => {
    try {
        const body = req.body;
        const type = body?.type;
        const dataId = body?.data?.id;
        if (!type || !dataId) {
            res.status(400).json({ message: "Payload inválido" });
            return;
        }
        const token = await (0, systemSettingService_1.getSetting)("mercadopago_access_token");
        if (!token) {
            logger_1.logger.warn("WEBHOOK", "MERCADOPAGO_ACCESS_TOKEN não configurado");
            res.status(200).send("OK");
            return;
        }
        const authHeader = { Authorization: `Bearer ${token}` };
        if (type === "payment") {
            const paymentRes = await axios_1.default.get(`https://api.mercadopago.com/v1/payments/${dataId}`, { headers: authHeader });
            const payment = paymentRes.data;
            const status = payment?.status;
            const externalRef = payment?.external_reference;
            let invoice = externalRef
                ? await prismaClient_1.prisma.invoice.findUnique({
                    where: { id: externalRef },
                    include: { subscription: true },
                })
                : await prismaClient_1.prisma.invoice.findFirst({
                    where: { mpPaymentId: String(dataId) },
                    include: { subscription: true },
                });
            if (status === "approved" && invoice) {
                await markInvoicePaidAndEmit(invoice, String(dataId));
            }
        }
        else if (type === "order") {
            // Orders API (PIX criado via /v1/orders) - notificação envia id do pedido
            try {
                const orderRes = await axios_1.default.get(`https://api.mercadopago.com/v1/orders/${dataId}`, { headers: authHeader });
                const order = orderRes.data;
                const externalRef = order?.external_reference;
                const orderStatus = order?.status;
                const payments = order?.payments ?? [];
                const approvedPayment = payments.find((p) => p.status === "approved" || p.status === "credited");
                if (!externalRef && !approvedPayment?.id) {
                    res.status(200).send("OK");
                    return;
                }
                let invoice = externalRef
                    ? await prismaClient_1.prisma.invoice.findUnique({
                        where: { id: externalRef },
                        include: { subscription: true },
                    })
                    : await prismaClient_1.prisma.invoice.findFirst({
                        where: { mpPaymentId: String(approvedPayment?.id ?? dataId) },
                        include: { subscription: true },
                    });
                const isPaid = orderStatus === "paid" || approvedPayment != null;
                if (isPaid && invoice) {
                    await markInvoicePaidAndEmit(invoice, String(approvedPayment?.id ?? dataId));
                }
            }
            catch (orderErr) {
                logger_1.logger.warn("WEBHOOK", "Erro ao buscar order MP", orderErr);
            }
        }
        res.status(200).send("OK");
    }
    catch (err) {
        logger_1.logger.error("WEBHOOK", "Erro ao processar webhook MP", err);
        res.status(500).json({ message: "Erro interno" });
    }
});
exports.default = router;
