"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.restoreWhatsAppSessions = restoreWhatsAppSessions;
/**
 * Restaura sessões WhatsApp marcadas como "connected" no banco após restart do processo.
 * Deve ser chamado no startup do wa-worker e do backend (quando não for API only).
 */
const logger_1 = require("../utils/logger");
const prismaClient_1 = require("../prismaClient");
const whatsappClientManager_1 = require("../services/whatsappClientManager");
async function restoreWhatsAppSessions() {
    const sessions = await prismaClient_1.prisma.whatsappSession.findMany({
        where: { status: "connected" },
        select: { id: true, name: true, company: { select: { name: true } } },
    });
    if (sessions.length === 0) {
        logger_1.logger.info("WHATSAPP", "Nenhuma sessão marcada como conectada no banco.");
        return;
    }
    for (const s of sessions) {
        (0, whatsappClientManager_1.setSessionLabel)(s.id, { sessionName: s.name, companyName: s.company.name });
    }
    logger_1.logger.info("WHATSAPP", `Restaurando ${sessions.length} sessão(ões) conectada(s)...`);
    const delayBetweenSessionsMs = sessions.length > 1 ? 5000 : 2000;
    for (const s of sessions) {
        try {
            await (0, whatsappClientManager_1.getOrCreateClient)(s.id);
        }
        catch (err) {
            logger_1.logger.warn("WHATSAPP", `Restore falhou: ${s.company.name} / ${s.name}`, { err });
        }
        await new Promise((r) => setTimeout(r, delayBetweenSessionsMs));
    }
}
