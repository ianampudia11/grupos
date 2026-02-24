"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendCampaign = sendCampaign;
/**
 * Envia uma campanha para todos os alvos.
 * Usado por POST /campaigns/:id/send e pelo cron de agendamento.
 * Respeita delay e lote configurados em Configurações > Disparos.
 */
const prismaClient_1 = require("../prismaClient");
const whatsappService_1 = require("./whatsappService");
const messageGeneratorService_1 = require("./messageGeneratorService");
const planLimitsService_1 = require("./planLimitsService");
const dispatchSettingsService_1 = require("./dispatchSettingsService");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
async function sendCampaign(campaignId, userId) {
    const campaign = await prismaClient_1.prisma.campaign.findFirst({
        where: { id: campaignId, userId },
        include: {
            user: { select: { companyId: true } },
            targets: { include: { group: { include: { session: { select: { companyId: true } } } } } },
            product: true,
            template: true,
        },
    });
    if (!campaign || campaign.userId !== userId) {
        throw new Error("Campanha não encontrada");
    }
    let companyId = campaign.user.companyId;
    if (!companyId && campaign.user) {
        const u = await prismaClient_1.prisma.user.findUnique({
            where: { id: campaign.userId },
            select: { role: true },
        });
        if (u?.role === "SUPERADMIN") {
            const sist = await prismaClient_1.prisma.company.findFirst({
                where: { slug: "sistema-administrativo" },
                select: { id: true },
            });
            if (sist)
                companyId = sist.id;
        }
    }
    if (!companyId) {
        throw new Error("Usuário deve estar vinculado a uma empresa para enviar campanhas.");
    }
    await (0, planLimitsService_1.assertCampaignsPerDay)(companyId);
    const dispatch = await (0, dispatchSettingsService_1.getResolvedDispatchSettings)(companyId);
    const product = campaign.product;
    const template = campaign.template;
    const useGenerator = template && product;
    const linkUrl = campaign.linkUrl || product?.link || undefined;
    for (let i = 0; i < campaign.targets.length; i++) {
        const t = campaign.targets[i];
        const delaySec = randomBetween(dispatch.delayMinSec, dispatch.delayMaxSec);
        await sleep(delaySec * 1000);
        const productData = product
            ? {
                title: product.title,
                price: product.price,
                oldPrice: product.oldPrice ?? undefined,
                discountPercent: product.discountPercent ?? undefined,
                coupon: product.coupon ?? undefined,
                link: product.link ?? undefined,
                store: product.store ?? undefined,
                category: product.category ?? undefined,
            }
            : null;
        const msg = useGenerator
            ? (0, messageGeneratorService_1.generateMessage)(template.body, productData, i + Date.now())
            : campaign.messageText;
        await (0, whatsappService_1.sendMessageToGroup)(companyId, t.groupId, msg, campaign.imagePath ?? undefined, {
            campaignId: campaign.id,
            linkUrl: linkUrl ?? undefined,
            userId,
            mentionAll: campaign.mentionAll ?? false,
        });
        const sentInBatch = (i + 1) % dispatch.batchSize === 0;
        if (sentInBatch && i < campaign.targets.length - 1 && dispatch.pauseBetweenBatchesSec > 0) {
            await sleep(dispatch.pauseBetweenBatchesSec * 1000);
        }
    }
    await prismaClient_1.prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: "sent", sentAt: new Date() },
    });
}
