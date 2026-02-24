"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWaVersion = getWaVersion;
exports.setWhatsappEventEmitter = setWhatsappEventEmitter;
exports.onDestroySession = onDestroySession;
exports.setSessionLabel = setSessionLabel;
exports.getSessionDisplayName = getSessionDisplayName;
exports.getOrCreateClient = getOrCreateClient;
exports.getOrCreateClientSync = getOrCreateClientSync;
exports.getClientState = getClientState;
exports.isClientReady = isClientReady;
exports.getQrDataUrl = getQrDataUrl;
exports.getClientInfo = getClientInfo;
exports.logoutSession = logoutSession;
exports.destroyClient = destroyClient;
exports.releasePairingClient = releasePairingClient;
exports.restartClient = restartClient;
exports.getReadyClient = getReadyClient;
const libzapitu_rf_1 = __importStar(require("libzapitu-rf"));
const QRCode = __importStar(require("qrcode"));
const logger_1 = require("../utils/logger");
const redis_1 = require("../redis");
const prismaClient_1 = require("../prismaClient");
const whatsappPrismaAuthState_1 = require("./whatsappPrismaAuthState");
/** Fallback WA version quando a busca dinâmica falha (ex.: 405 por versão desatualizada). */
const FALLBACK_WA_VERSION = [2, 3000, 1015901307];
const WA_VERSION_CACHE_MS = 1000 * 60 * 60; // 1 hora
let cachedWaVersion = null;
/**
 * Obtém a versão do WhatsApp para a conexão. Tenta buscar dinamicamente (web.whatsapp.com
 * ou Baileys) para evitar erro 405; usa fallback fixo em caso de falha.
 */
async function getWaVersion() {
    const now = Date.now();
    if (cachedWaVersion && now - cachedWaVersion.at < WA_VERSION_CACHE_MS) {
        return cachedWaVersion.version;
    }
    try {
        const result = await (0, libzapitu_rf_1.fetchLatestWaWebVersion)({ timeout: 10000 });
        if (result.version && Array.isArray(result.version) && result.version.length >= 3) {
            cachedWaVersion = { version: result.version, at: now };
            logger_1.logger.info("WHATSAPP", `Versão WA obtida (web): [${result.version.join(", ")}]`);
            return cachedWaVersion.version;
        }
    }
    catch (e) {
        logger_1.logger.warn("WHATSAPP", "Falha ao buscar versão WA (web), tentando Baileys", { e });
    }
    try {
        const result = await (0, libzapitu_rf_1.fetchLatestBaileysVersion)({ timeout: 10000 });
        if (result.version && Array.isArray(result.version) && result.version.length >= 3) {
            cachedWaVersion = { version: result.version, at: now };
            logger_1.logger.info("WHATSAPP", `Versão WA obtida (baileys): [${result.version.join(", ")}]`);
            return cachedWaVersion.version;
        }
    }
    catch (e) {
        logger_1.logger.warn("WHATSAPP", "Falha ao buscar versão WA (baileys), usando fallback", { e });
    }
    cachedWaVersion = { version: FALLBACK_WA_VERSION, at: now };
    logger_1.logger.info("WHATSAPP", `Versão WA fallback: [${FALLBACK_WA_VERSION.join(", ")}]`);
    return FALLBACK_WA_VERSION;
}
let eventEmitter = null;
const onDestroySessionCallbacks = new Set();
function setWhatsappEventEmitter(emitter) {
    eventEmitter = emitter;
}
/** Registra callback chamado ao destruir uma sessão (ex.: limpar cache de grupos). */
function onDestroySession(cb) {
    onDestroySessionCallbacks.add(cb);
    return () => onDestroySessionCallbacks.delete(cb);
}
/** Rótulo para logs: empresa + nome da sessão (preenchido por restore e rotas). */
const sessionLabels = new Map();
function setSessionLabel(sessionId, data) {
    sessionLabels.set(sessionId, data);
}
function formatSession(sessionId) {
    const label = sessionLabels.get(sessionId);
    if (label)
        return `${label.companyName} / ${label.sessionName}`;
    return sessionId;
}
/** Retorna nome legível da sessão (empresa / sessão) para uso em logs. */
function getSessionDisplayName(sessionId) {
    return formatSession(sessionId);
}
const clients = new Map();
const pendingCreate = new Map();
const MAX_CONCURRENT_INITS = 1;
const INIT_SLOT_RELEASE_DELAY_MS = 8000;
function getBackoffDelayMs(attempt) {
    const baseMs = 5000;
    const maxMs = 120000;
    const delay = Math.min(baseMs * Math.pow(2, attempt - 1), maxMs);
    return Math.min(delay, maxMs);
}
/** Delay genérico após destroy antes de recriar (ex.: restartClient). */
const RESTART_DELAY_MS = 2500;
/** Máximo de tentativas de reconexão automática; após isso para e exige nova conexão manual. */
const MAX_RECONNECT_ATTEMPTS = 3;
/** Mínimo de intervalo entre atualizações de QR (evita loops que invalidam a sessão). */
const QR_MIN_INTERVAL_MS = 15000;
let currentInits = 0;
const initWaitQueue = [];
const lastQrAtBySession = new Map();
/** Contagem de falhas consecutivas (ex.: 405) por sessão; ao atingir MAX_RECONNECT_ATTEMPTS para de reconectar. */
const connectionFailureCountBySession = new Map();
function releaseInitSlot() {
    currentInits = Math.max(0, currentInits - 1);
    const next = initWaitQueue.shift();
    if (next)
        next();
}
function acquireInitSlot() {
    if (currentInits < MAX_CONCURRENT_INITS) {
        currentInits++;
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        initWaitQueue.push(() => {
            currentInits++;
            resolve();
        });
    });
}
/** Mensagens do Baileys que são transitórias (sessão/criptografia) e não precisam aparecer como ERROR. */
const BAILEYS_TRANSIENT_ERRORS = [
    "failed to decrypt message",
    "transaction failed, rolling back",
    "stream errored out",
    "timed out waiting for message",
    "error in handling message",
    "handling notification",
    "closing open session in favor of incoming prekey bundle",
];
function isTransientBaileysError(msg) {
    const lower = msg.toLowerCase();
    return BAILEYS_TRANSIENT_ERRORS.some((s) => lower.includes(s.toLowerCase()));
}
/** Logger compatível com ILogger do Baileys. Erros transitórios viram WARN em vez de ERROR. */
function makeBaileysLogger(sessionId) {
    const tag = formatSession(sessionId);
    return {
        level: "info",
        child() {
            return this;
        },
        trace() { },
        debug() { },
        info(_obj, msg) {
            if (msg)
                logger_1.logger.info("WHATSAPP", `${tag} | ${msg}`);
        },
        warn(_obj, msg) {
            if (msg)
                logger_1.logger.warn("WHATSAPP", `${tag} | ${msg}`);
        },
        error(_obj, msg) {
            if (!msg)
                return;
            if (isTransientBaileysError(msg)) {
                logger_1.logger.warn("WHATSAPP", `${tag} | ${msg}`);
            }
            else {
                logger_1.logger.error("WHATSAPP", `${tag} | ${msg}`);
            }
        },
    };
}
async function refreshSelfAvatar(sessionId) {
    const state = clients.get(sessionId);
    if (!state?.isReady || !state.wid)
        return;
    try {
        const url = await state.sock.profilePictureUrl(state.wid, "image");
        const current = clients.get(sessionId);
        if (current)
            current.avatarUrl = url ?? null;
    }
    catch {
        logger_1.logger.warn("WHATSAPP", `Avatar não obtido: ${formatSession(sessionId)}`);
    }
}
async function createClientForSession(sessionId) {
    const { state: authState, saveCreds } = await (0, whatsappPrismaAuthState_1.usePrismaAuthState)(sessionId);
    const version = await getWaVersion();
    const sock = (0, libzapitu_rf_1.default)({
        auth: authState,
        logger: makeBaileysLogger(sessionId),
        printQRInTerminal: false,
        emitOwnEvents: false,
        markOnlineOnConnect: false,
        browser: ["WAGrupos", "Desktop", "1.0.0"],
        version,
        defaultQueryTimeoutMs: 60000,
        getMessage: async () => undefined,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        shouldIgnoreJid: (jid) => (0, libzapitu_rf_1.isJidBroadcast)(jid) || (jid?.endsWith?.("@newsletter") === true),
    });
    const clientState = {
        sock,
        qrDataUrl: null,
        isReady: false,
        pushName: null,
        phone: null,
        wid: null,
        avatarUrl: null,
    };
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", async (update) => {
        const { connection, qr, lastDisconnect } = update;
        if (qr) {
            const now = Date.now();
            const lastQr = lastQrAtBySession.get(sessionId) ?? 0;
            const isFirstQr = lastQr === 0;
            const throttleOk = isFirstQr || now - lastQr >= QR_MIN_INTERVAL_MS;
            if (throttleOk) {
                lastQrAtBySession.set(sessionId, now);
                try {
                    const dataUrl = await QRCode.toDataURL(qr, { width: 320 });
                    const s = clients.get(sessionId);
                    if (s)
                        s.qrDataUrl = dataUrl;
                    eventEmitter?.("qr", sessionId, { qr: dataUrl });
                    await redis_1.sessionStore.setStatus(sessionId, "qr");
                    await redis_1.sessionStore.setQr(sessionId, dataUrl);
                    logger_1.logger.info("WHATSAPP", `QR gerado: ${formatSession(sessionId)}`);
                }
                catch (err) {
                    logger_1.logger.error("WHATSAPP", `Erro ao gerar QR: ${formatSession(sessionId)}`, err);
                }
            }
        }
        if (connection === "open") {
            connectionFailureCountBySession.set(sessionId, 0);
            const s = clients.get(sessionId);
            if (s) {
                s.isReady = true;
                s.qrDataUrl = null;
                const user = sock.user;
                if (user) {
                    s.pushName = user.name ?? null;
                    s.wid = user.id ?? null;
                    s.phone = user.id?.split?.("@")?.[0] ?? null;
                }
            }
            const s2 = clients.get(sessionId);
            const meta = {
                pushName: s2?.pushName ?? undefined,
                phone: s2?.phone ?? undefined,
                wid: s2?.wid ?? undefined,
            };
            await redis_1.sessionStore.setStatus(sessionId, "connected");
            await redis_1.sessionStore.setMeta(sessionId, meta);
            await redis_1.sessionStore.clearQr(sessionId);
            eventEmitter?.("ready", sessionId);
            void refreshSelfAvatar(sessionId);
            logger_1.logger.success("WHATSAPP", `Conectado: ${formatSession(sessionId)}`);
        }
        if (connection === "close") {
            const err = lastDisconnect?.error;
            const statusCode = err?.output?.statusCode;
            const reasonMessage = err?.message ?? (err ? String(err) : "unknown");
            const isLoggedOut = statusCode === libzapitu_rf_1.DisconnectReason.loggedOut;
            const isAuthFailure = statusCode === libzapitu_rf_1.DisconnectReason.badSession ||
                statusCode === libzapitu_rf_1.DisconnectReason.forbidden ||
                statusCode === libzapitu_rf_1.DisconnectReason.multideviceMismatch;
            const shouldReconnect = !isLoggedOut && !isAuthFailure;
            logger_1.logger.warn("WHATSAPP", `[Closing session] ${formatSession(sessionId)} | statusCode=${statusCode} | reason=${reasonMessage} | loggedOut=${isLoggedOut} | willReconnect=${shouldReconnect}`);
            const s = clients.get(sessionId);
            if (s) {
                s.isReady = false;
                s.qrDataUrl = null;
                s.pushName = null;
                s.phone = null;
                s.wid = null;
                s.avatarUrl = null;
            }
            await redis_1.sessionStore.setStatus(sessionId, "disconnected");
            await redis_1.sessionStore.clearQr(sessionId);
            await prismaClient_1.prisma.whatsappSession
                .updateMany({
                where: { id: sessionId },
                data: { status: "disconnected" },
            })
                .catch((e) => logger_1.logger.error("WHATSAPP", `Falha ao persistir disconnected: ${formatSession(sessionId)}`, e));
            if (isAuthFailure) {
                eventEmitter?.("auth_failure", sessionId, {
                    message: String(statusCode ?? "Falha de autenticação"),
                });
            }
            eventEmitter?.("disconnected", sessionId, {
                reason: isLoggedOut ? "loggedOut" : String(statusCode ?? "close"),
            });
            setImmediate(() => {
                destroyClient(sessionId).catch(() => { });
            });
            if (shouldReconnect) {
                const sid = sessionId;
                const failures = (connectionFailureCountBySession.get(sid) ?? 0) + 1;
                connectionFailureCountBySession.set(sid, failures);
                if (failures >= MAX_RECONNECT_ATTEMPTS) {
                    logger_1.logger.warn("WHATSAPP", `Limite de reconexões (${MAX_RECONNECT_ATTEMPTS}) atingido: ${formatSession(sid)}. Conexão encerrada; reconecte manualmente no painel.`);
                    connectionFailureCountBySession.delete(sid);
                    (0, whatsappPrismaAuthState_1.clearPrismaAuthState)(sid).catch((e) => logger_1.logger.warn("WHATSAPP", `Falha ao limpar auth: ${formatSession(sid)}`, e));
                    eventEmitter?.("disconnected", sid, { reason: "max_reconnect_attempts" });
                    return;
                }
                const delayMs = getBackoffDelayMs(failures);
                logger_1.logger.info("WHATSAPP", `Reconectando (tentativa ${failures}/${MAX_RECONNECT_ATTEMPTS}) em ${delayMs}ms: ${formatSession(sid)}`);
                setTimeout(() => {
                    getOrCreateClient(sid).catch((e) => logger_1.logger.error("WHATSAPP", `Falha ao reconectar: ${formatSession(sid)}`, e));
                }, delayMs);
            }
        }
    });
    clients.set(sessionId, clientState);
    return clientState;
}
/**
 * Obtém ou cria o client da sessão. Criação é serializada por sessionId
 * e limitada globalmente (1 por vez).
 */
async function getOrCreateClient(sessionId) {
    const existing = clients.get(sessionId);
    if (existing)
        return existing;
    const pending = pendingCreate.get(sessionId);
    if (pending)
        return pending;
    const promise = (async () => {
        const again = clients.get(sessionId);
        if (again)
            return again;
        await acquireInitSlot();
        try {
            const state = await createClientForSession(sessionId);
            setTimeout(() => releaseInitSlot(), INIT_SLOT_RELEASE_DELAY_MS);
            return state;
        }
        catch (e) {
            releaseInitSlot();
            pendingCreate.delete(sessionId);
            clients.delete(sessionId);
            await redis_1.sessionStore.setStatus(sessionId, "disconnected");
            await prismaClient_1.prisma.whatsappSession
                .updateMany({ where: { id: sessionId }, data: { status: "disconnected" } })
                .catch(() => { });
            throw e;
        }
    })();
    pendingCreate.set(sessionId, promise);
    try {
        const state = await promise;
        pendingCreate.delete(sessionId);
        return state;
    }
    catch (e) {
        pendingCreate.delete(sessionId);
        throw e;
    }
}
/** Síncrono: retorna o state se já existir. */
function getOrCreateClientSync(sessionId) {
    return clients.get(sessionId);
}
function getClientState(sessionId) {
    return clients.get(sessionId);
}
function isClientReady(sessionId) {
    const state = clients.get(sessionId);
    return state?.isReady === true;
}
function getQrDataUrl(sessionId) {
    const state = clients.get(sessionId);
    return state?.qrDataUrl ?? null;
}
function getClientInfo(sessionId) {
    const state = clients.get(sessionId);
    if (!state || !state.isReady)
        return null;
    return {
        pushName: state.pushName,
        phone: state.phone,
        wid: state.wid,
        avatarUrl: state.avatarUrl,
    };
}
/** Logout no WhatsApp (remove da lista "Meus dispositivos") e limpa auth no banco. */
async function logoutSession(sessionId) {
    const state = clients.get(sessionId);
    if (state?.sock) {
        try {
            await state.sock.logout();
            logger_1.logger.info("WHATSAPP", `Logout: ${formatSession(sessionId)} (removido de "Meus dispositivos")`);
        }
        catch (err) {
            logger_1.logger.warn("WHATSAPP", `Logout falhou: ${formatSession(sessionId)}`, { err });
        }
    }
    try {
        await (0, whatsappPrismaAuthState_1.clearPrismaAuthState)(sessionId);
    }
    catch (err) {
        logger_1.logger.warn("WHATSAPP", `Limpeza do auth state falhou: ${formatSession(sessionId)}`, { err });
    }
}
async function destroyClient(sessionId) {
    pendingCreate.delete(sessionId);
    lastQrAtBySession.delete(sessionId);
    const state = clients.get(sessionId);
    if (!state)
        return;
    clients.delete(sessionId);
    for (const cb of onDestroySessionCallbacks) {
        try {
            cb(sessionId);
        }
        catch (e) {
            logger_1.logger.warn("WHATSAPP", `onDestroySession callback: ${formatSession(sessionId)}`, { e });
        }
    }
    try {
        state.sock.end(undefined);
    }
    catch (err) {
        logger_1.logger.error("WHATSAPP", `Erro ao destruir: ${formatSession(sessionId)}`, err);
    }
}
/** Destrói o client apenas se estiver em modo pairing (aguardando QR). */
async function releasePairingClient(sessionId) {
    pendingCreate.delete(sessionId);
    const state = clients.get(sessionId);
    if (!state || state.isReady)
        return;
    clients.delete(sessionId);
    for (const cb of onDestroySessionCallbacks) {
        try {
            cb(sessionId);
        }
        catch (e) {
            logger_1.logger.warn("WHATSAPP", `onDestroySession callback: ${formatSession(sessionId)}`, { e });
        }
    }
    try {
        state.sock.end(undefined);
        logger_1.logger.info("WHATSAPP", `Pairing liberado: ${formatSession(sessionId)}`);
    }
    catch (err) {
        logger_1.logger.error("WHATSAPP", `Erro ao liberar pairing: ${formatSession(sessionId)}`, err);
    }
}
async function restartClient(sessionId) {
    await destroyClient(sessionId);
    await new Promise((r) => setTimeout(r, RESTART_DELAY_MS));
    await getOrCreateClient(sessionId);
}
/** Retorna o socket Baileys pronto para uso (enviar mensagem, buscar grupos, etc.). */
function getReadyClient(sessionId) {
    const state = clients.get(sessionId);
    if (!state || !state.isReady) {
        throw new Error("WhatsApp não está conectado. Conecte escaneando o QR code.");
    }
    return state.sock;
}
