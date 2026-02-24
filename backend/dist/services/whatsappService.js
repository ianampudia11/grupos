"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendMessageToGroup = exports.listGroupsFull = exports.listGroups = exports.fetchGroupsFromRemote = void 0;
exports.clearGroupsStoreForSession = clearGroupsStoreForSession;
const whatsappClientManager_1 = require("./whatsappClientManager");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const prismaClient_1 = require("../prismaClient");
const logger_1 = require("../utils/logger");
const planLimitsService_1 = require("./planLimitsService");
/** Store em memória: grupos por sessionId (evita consultas repetitivas ao WhatsApp enquanto a sessão estiver ativa). */
const groupsStoreBySession = new Map();
const GROUPS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
/** Limpa o cache de grupos de uma sessão (chamado ao destruir a sessão). */
function clearGroupsStoreForSession(sessionId) {
    groupsStoreBySession.delete(sessionId);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitForClientReady = async (sessionId, timeoutMs = 20000, intervalMs = 500) => {
    const startedAt = Date.now();
    await (0, whatsappClientManager_1.getOrCreateClient)(sessionId);
    while (Date.now() - startedAt < timeoutMs) {
        if ((0, whatsappClientManager_1.isClientReady)(sessionId))
            return;
        await sleep(intervalMs);
    }
    throw new Error("WhatsApp ainda não está pronto. Aguarde alguns segundos e tente novamente.");
};
const WAIT_FOR_READY_MS = 90000;
const READY_POLL_MS = 800;
const ensureClientsAndWaitReady = async (sessions) => {
    const connectedInDb = sessions.filter((s) => s.status === "connected");
    if (connectedInDb.length === 0)
        return [];
    try {
        await (0, whatsappClientManager_1.getOrCreateClient)(connectedInDb[0].id);
    }
    catch (e) {
        logger_1.logger.warn("WHATSAPP", "Falha ao restaurar sessão para sync de grupos", e);
    }
    for (let i = 1; i < connectedInDb.length; i++) {
        void (0, whatsappClientManager_1.getOrCreateClient)(connectedInDb[i].id);
    }
    const deadline = Date.now() + WAIT_FOR_READY_MS;
    while (Date.now() < deadline) {
        const ready = sessions.filter((s) => (0, whatsappClientManager_1.isClientReady)(s.id));
        if (ready.length > 0) {
            logger_1.logger.success("WHATSAPP", `${ready.length} sessão(ões) pronta(s) para sync.`);
            return ready;
        }
        await sleep(READY_POLL_MS);
    }
    return sessions.filter((s) => (0, whatsappClientManager_1.isClientReady)(s.id));
};
const fetchGroupsFromRemote = async (companyId) => {
    const sessions = await prismaClient_1.prisma.whatsappSession.findMany({
        where: { companyId },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        select: {
            id: true,
            companyId: true,
            name: true,
            isDefault: true,
            status: true,
            company: { select: { name: true } },
        },
    });
    for (const s of sessions) {
        (0, whatsappClientManager_1.setSessionLabel)(s.id, { sessionName: s.name, companyName: s.company.name });
    }
    let connectedSessions = sessions.filter((s) => (0, whatsappClientManager_1.isClientReady)(s.id));
    if (connectedSessions.length === 0) {
        connectedSessions = await ensureClientsAndWaitReady(sessions);
    }
    if (connectedSessions.length === 0) {
        const hasConnectedInDb = sessions.some((s) => s.status === "connected");
        if (hasConnectedInDb) {
            throw new Error("WhatsApp está conectado no painel mas ainda não ficou pronto. Aguarde cerca de 1 minuto e clique em Sincronizar novamente. Se o problema continuar, tente Desconectar e escanear o QR de novo.");
        }
        throw new Error("Nenhum WhatsApp conectado. Conecte ao menos uma sessão (QR Code) e tente novamente.");
    }
    const allGroups = [];
    for (const session of connectedSessions) {
        await waitForClientReady(session.id);
        const sock = (0, whatsappClientManager_1.getReadyClient)(session.id);
        const cached = groupsStoreBySession.get(session.id);
        if (cached && Date.now() - cached.fetchedAt < GROUPS_CACHE_TTL_MS) {
            for (const g of cached.groups) {
                allGroups.push(g);
            }
            continue;
        }
        // groupFetchAllParticipating: busca todos os grupos em uma única chamada (sem processar mensagens de cada grupo na carga inicial).
        let groupsMap;
        try {
            groupsMap = (await sock.groupFetchAllParticipating());
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (/timeout|timed out|protocolTimeout/i.test(msg)) {
                throw new Error("A sincronização demorou mais que o esperado (muitos grupos ou conexão lenta). Tente novamente em alguns instantes.");
            }
            throw err;
        }
        const groupEntries = Object.entries(groupsMap);
        const groups = groupEntries.map(([jid, meta]) => ({
            id: jid,
            name: (meta.subject && meta.subject.trim()) ? meta.subject.trim() : jid,
            participantCount: meta.size ?? meta.participants?.length,
        }));
        for (const group of groups) {
            try {
                const existing = await prismaClient_1.prisma.whatsappGroup.findUnique({
                    where: { sessionId_waId: { sessionId: session.id, waId: group.id } },
                });
                if (!existing) {
                    const { allowed } = await (0, planLimitsService_1.checkLimit)(session.companyId, "groups");
                    if (!allowed)
                        continue;
                }
                let participantCount = group.participantCount;
                let avatarUrl;
                try {
                    const pic = await sock.profilePictureUrl(group.id, "image");
                    avatarUrl = pic ?? null;
                }
                catch {
                    avatarUrl = null;
                }
                await prismaClient_1.prisma.whatsappGroup.upsert({
                    where: { sessionId_waId: { sessionId: session.id, waId: group.id } },
                    create: {
                        waId: group.id,
                        name: group.name,
                        sessionId: session.id,
                        participantCount,
                        avatarUrl: avatarUrl ?? undefined,
                        source: "whatsapp",
                    },
                    update: {
                        waId: group.id,
                        name: group.name,
                        participantCount,
                        avatarUrl: avatarUrl ?? undefined,
                        source: "whatsapp",
                    },
                });
            }
            catch (err) {
                logger_1.logger.error("WHATSAPP", `Falha ao persistir grupos: ${(0, whatsappClientManager_1.getSessionDisplayName)(session.id)}`, err);
            }
        }
        groupsStoreBySession.set(session.id, { groups, fetchedAt: Date.now() });
        allGroups.push(...groups);
    }
    return allGroups;
};
exports.fetchGroupsFromRemote = fetchGroupsFromRemote;
const listGroups = async (companyId) => {
    const rows = await prismaClient_1.prisma.whatsappGroup.findMany({
        where: { session: { companyId } },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
    });
    return rows.map((r) => ({ id: r.id, name: r.name }));
};
exports.listGroups = listGroups;
const listGroupsFull = async (companyId) => {
    const rows = await prismaClient_1.prisma.whatsappGroup.findMany({
        where: { session: { companyId } },
        orderBy: [{ session: { isDefault: "desc" } }, { session: { createdAt: "asc" } }, { name: "asc" }],
        select: {
            id: true,
            waId: true,
            name: true,
            participantCount: true,
            avatarUrl: true,
            source: true,
            createdAt: true,
            sessionId: true,
            session: { select: { name: true } },
        },
    });
    return rows.map((r) => ({
        id: r.id,
        waId: r.waId,
        name: r.name,
        participantCount: r.participantCount,
        avatarUrl: r.avatarUrl,
        source: r.source,
        createdAt: r.createdAt.toISOString(),
        sessionId: r.sessionId,
        sessionName: r.session.name,
    }));
};
exports.listGroupsFull = listGroupsFull;
const sendMessageToGroup = async (companyId, groupId, message, imagePath, opts) => {
    const campaignId = opts?.campaignId ?? undefined;
    const linkUrl = opts?.linkUrl ?? undefined;
    const userId = opts?.userId;
    const mentionAll = opts?.mentionAll === true;
    const group = await prismaClient_1.prisma.whatsappGroup.findFirst({
        where: {
            OR: [{ id: groupId }, { waId: groupId }],
            session: { companyId },
        },
        select: { id: true, waId: true, sessionId: true },
    });
    if (!group)
        throw new Error("Grupo não encontrado");
    const sock = (0, whatsappClientManager_1.getReadyClient)(group.sessionId);
    const waId = group.waId;
    const dbGroupId = group.id;
    const sendRecord = await prismaClient_1.prisma.messageSend.create({
        data: {
            userId: userId,
            groupId: dbGroupId,
            messageText: message,
            imagePath: imagePath ?? undefined,
            linkUrl: linkUrl ?? undefined,
            campaignId: campaignId ?? undefined,
            status: "pending",
        },
    });
    let mentionIds = [];
    if (mentionAll) {
        try {
            const meta = await sock.groupMetadata(waId);
            if (meta.participants?.length) {
                mentionIds = meta.participants
                    .map((p) => p.id)
                    .filter((id) => Boolean(id));
            }
        }
        catch (e) {
            logger_1.logger.warn("WHATSAPP", "Participantes para @todos não obtidos; enviando sem menções.", e);
        }
    }
    const mentionPayload = mentionIds.length > 0 ? { mentions: mentionIds } : {};
    try {
        if (imagePath) {
            let absolutePath = imagePath;
            if (imagePath.startsWith("/uploads/")) {
                absolutePath = path_1.default.resolve(process.cwd(), imagePath.slice(1));
            }
            else if (!path_1.default.isAbsolute(imagePath)) {
                absolutePath = path_1.default.resolve(process.cwd(), imagePath);
            }
            if (!fs_1.default.existsSync(absolutePath)) {
                throw new Error("Arquivo de mídia não encontrado");
            }
            const buffer = fs_1.default.readFileSync(absolutePath);
            const ext = path_1.default.extname(absolutePath).toLowerCase();
            const audioExts = [".ogg", ".opus", ".mp3", ".m4a", ".amr", ".aac", ".webm"];
            const isAudio = audioExts.includes(ext);
            if (isAudio) {
                await sock.sendMessage(waId, {
                    audio: buffer,
                    ptt: true,
                    ...(message ? { caption: message } : {}),
                    ...mentionPayload,
                });
            }
            else {
                await sock.sendMessage(waId, {
                    image: buffer,
                    caption: message || undefined,
                    ...mentionPayload,
                });
            }
        }
        else {
            await sock.sendMessage(waId, {
                text: message,
                ...mentionPayload,
            });
        }
        await prismaClient_1.prisma.messageSend.update({
            where: { id: sendRecord.id },
            data: { status: "sent" },
        });
        return { ok: true };
    }
    catch (err) {
        const errMsg = err instanceof Error ? err.message : "Erro desconhecido";
        await prismaClient_1.prisma.messageSend.update({
            where: { id: sendRecord.id },
            data: { status: "failed", error: errMsg },
        });
        throw err;
    }
};
exports.sendMessageToGroup = sendMessageToGroup;
