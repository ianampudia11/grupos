"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConnectionStatus = getConnectionStatus;
exports.getQrCode = getQrCode;
exports.disconnect = disconnect;
exports.restart = restart;
exports.releasePairing = releasePairing;
const prismaClient_1 = require("../prismaClient");
const whatsappClientManager_1 = require("./whatsappClientManager");
const CONNECTED_GRACE_MS = 5 * 60 * 1000;
/**
 * Retorna status da conexão. Se a sessão está "connected" no DB mas o client
 * não está em memória (ex.: após restart), inicia o client em background para
 * restaurar a sessão e retorna o status do DB para o dashboard não mostrar
 * "Desconectado" enquanto restaura.
 */
async function getConnectionStatus(sessionId, companyId) {
    const session = await prismaClient_1.prisma.whatsappSession.findFirst({
        where: { id: sessionId, companyId },
        include: { company: { select: { name: true } } },
    });
    if (!session)
        throw new Error("Sessão não encontrada");
    (0, whatsappClientManager_1.setSessionLabel)(sessionId, { sessionName: session.name, companyName: session.company.name });
    const state = (0, whatsappClientManager_1.getClientState)(sessionId);
    const ready = (0, whatsappClientManager_1.isClientReady)(sessionId);
    const info = (0, whatsappClientManager_1.getClientInfo)(sessionId);
    const qr = (0, whatsappClientManager_1.getQrDataUrl)(sessionId);
    // Sessão conectada no DB mas client não em memória (ex.: após build/restart) → inicia restauração em background
    if (session.status === "connected" && !state) {
        void (0, whatsappClientManager_1.getOrCreateClient)(sessionId);
    }
    // Só atualiza DB quando temos client em memória (foi iniciado via getQrCode ou restauração)
    if (state) {
        if (ready && info) {
            await prismaClient_1.prisma.whatsappSession.update({
                where: { id: sessionId },
                data: {
                    status: "connected",
                    waPushName: info.pushName,
                    waPhone: info.phone,
                    waJid: info.wid,
                    waAvatarUrl: info.avatarUrl,
                    lastConnectedAt: new Date(),
                },
            });
        }
        else {
            const recentlyConnected = session.status === "connected" &&
                session.lastConnectedAt !== null &&
                Date.now() - session.lastConnectedAt.getTime() <= CONNECTED_GRACE_MS;
            // Não marcar como desconectado quando a sessão está "connected" no DB e não há QR: client pode estar restaurando (ex.: após restart)
            const likelyRestoring = session.status === "connected" && !qr;
            if (!likelyRestoring && (!recentlyConnected || qr)) {
                await prismaClient_1.prisma.whatsappSession.update({
                    where: { id: sessionId },
                    data: { status: "disconnected" },
                });
            }
        }
    }
    const updated = await prismaClient_1.prisma.whatsappSession.findUnique({
        where: { id: sessionId },
    });
    return {
        id: updated.id,
        name: updated.name,
        isDefault: updated.isDefault,
        status: updated.status,
        pushName: updated.waPushName,
        phone: updated.waPhone,
        jid: updated.waJid,
        avatarUrl: updated.waAvatarUrl,
        lastConnectedAt: updated.lastConnectedAt,
    };
}
/** QR gerado no processo da API (sem fila). Se já conectado, retorna alreadyConnected. */
async function getQrCode(sessionId, companyId) {
    const session = await prismaClient_1.prisma.whatsappSession.findFirst({
        where: { id: sessionId, companyId },
        include: { company: { select: { name: true } } },
    });
    if (!session)
        throw new Error("Sessão não encontrada");
    (0, whatsappClientManager_1.setSessionLabel)(sessionId, { sessionName: session.name, companyName: session.company.name });
    if ((0, whatsappClientManager_1.isClientReady)(sessionId)) {
        return { qr: null, message: "Sessão já conectada.", alreadyConnected: true };
    }
    await (0, whatsappClientManager_1.getOrCreateClient)(sessionId);
    const qr = (0, whatsappClientManager_1.getQrDataUrl)(sessionId);
    if (!qr) {
        return { qr: null, message: "QR ainda não foi gerado. Aguarde alguns segundos e tente novamente." };
    }
    return { qr };
}
async function disconnect(sessionId, companyId) {
    const session = await prismaClient_1.prisma.whatsappSession.findFirst({
        where: { id: sessionId, companyId },
    });
    if (!session)
        throw new Error("Sessão não encontrada");
    await (0, whatsappClientManager_1.logoutSession)(sessionId);
    await (0, whatsappClientManager_1.destroyClient)(sessionId);
    await prismaClient_1.prisma.whatsappSession.update({
        where: { id: sessionId },
        data: { status: "disconnected" },
    });
    return { ok: true };
}
async function restart(sessionId, companyId) {
    const session = await prismaClient_1.prisma.whatsappSession.findFirst({
        where: { id: sessionId, companyId },
    });
    if (!session)
        throw new Error("Sessão não encontrada");
    await (0, whatsappClientManager_1.restartClient)(sessionId);
    return { ok: true };
}
/** Libera o client em pairing quando o usuário fecha o modal sem conectar. Para de gerar QR. */
async function releasePairing(sessionId, companyId) {
    const session = await prismaClient_1.prisma.whatsappSession.findFirst({
        where: { id: sessionId, companyId },
    });
    if (!session)
        throw new Error("Sessão não encontrada");
    await (0, whatsappClientManager_1.releasePairingClient)(sessionId);
    return { ok: true };
}
