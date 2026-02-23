import { Client, LocalAuth } from "whatsapp-web.js";
import * as QRCode from "qrcode";
import path from "path";
import { logger } from "../utils/logger";
import { env } from "../config/env";
import { sessionStore, getRedisClient } from "../redis";
import { prisma } from "../prismaClient";

export interface ClientState {
  client: Client;
  qrDataUrl: string | null;
  isReady: boolean;
  pushName: string | null;
  phone: string | null;
  wid: string | null;
  avatarUrl: string | null;
}

const BACKOFF_MS = [2000, 5000, 10000, 30000];
const DEBOUNCE_RECONNECT_MS = 2000;
const RESTART_DELAY_MS = 5000;
const MAX_CONCURRENT_INITS = 1;
const INIT_SLOT_RELEASE_DELAY_MS = 8000;

function sanitizeClientId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function getSessionPath(): string {
  return path.resolve(process.cwd(), ".wwebjs_auth");
}

function getPuppeteerConfig(): {
  headless: boolean;
  executablePath?: string;
  browserWSEndpoint?: string;
  args: string[];
  protocolTimeout?: number;
} {
  const args =
    env.chromeArgs && env.chromeArgs.length > 0
      ? env.chromeArgs
      : [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--no-zygote",
          "--disable-gpu",
          "--no-first-run",
          "--disable-accelerated-2d-canvas",
        ];
  const base: {
    headless: boolean;
    executablePath?: string;
    browserWSEndpoint?: string;
    args: string[];
    protocolTimeout?: number;
  } = {
    headless: true,
    args,
    protocolTimeout: env.chromeProtocolTimeout,
  };
  if (env.chromeWs) {
    base.browserWSEndpoint = env.chromeWs;
  } else if (env.chromeBin) {
    base.executablePath = env.chromeBin;
  }
  return base;
}

export type WhatsappEventCallback = (
  event: string,
  sessionId: string,
  data?: { qr?: string; message?: string; reason?: string }
) => void;

export type QrStreamSend = (data: { qr?: string; status?: string }) => void;

let publishQrToRedis: ((sessionId: string, qr: string) => void) | null = null;

export function setPublishQrToRedis(fn: (sessionId: string, qr: string) => void): void {
  publishQrToRedis = fn;
}

const sessions = new Map<string, ClientState>();
const initLocks = new Map<string, Promise<void>>();
const pendingCreate = new Map<string, Promise<ClientState>>();
const reconnectTimeouts = new Map<string, NodeJS.Timeout>();
const reconnectAttempts = new Map<string, number>();
const qrStreamListeners = new Map<string, Set<QrStreamSend>>();

let currentInits = 0;
const initWaitQueue: Array<() => void> = [];
let eventEmitter: WhatsappEventCallback | null = null;

export function setWhatsappEventEmitter(emitter: WhatsappEventCallback): void {
  eventEmitter = emitter;
}

export function addQrStreamListener(sessionId: string, send: QrStreamSend): void {
  let set = qrStreamListeners.get(sessionId);
  if (!set) {
    set = new Set();
    qrStreamListeners.set(sessionId, set);
  }
  set.add(send);
}

export function removeQrStreamListener(sessionId: string, send: QrStreamSend): void {
  const set = qrStreamListeners.get(sessionId);
  if (set) {
    set.delete(send);
    if (set.size === 0) qrStreamListeners.delete(sessionId);
  }
}

function releaseInitSlot(): void {
  currentInits = Math.max(0, currentInits - 1);
  const next = initWaitQueue.shift();
  if (next) next();
}

function acquireInitSlot(): Promise<void> {
  if (currentInits < MAX_CONCURRENT_INITS) {
    currentInits++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    initWaitQueue.push(() => {
      currentInits++;
      resolve();
    });
  });
}

function clearReconnectState(sessionId: string): void {
  const t = reconnectTimeouts.get(sessionId);
  if (t) {
    clearTimeout(t);
    reconnectTimeouts.delete(sessionId);
  }
  reconnectAttempts.delete(sessionId);
}

function notifyQrStream(sessionId: string, data: { qr?: string; status?: string }): void {
  const set = qrStreamListeners.get(sessionId);
  if (!set) return;
  for (const send of set) {
    try {
      send(data);
    } catch (_) {}
  }
}

async function refreshSelfAvatar(sessionId: string): Promise<void> {
  const state = sessions.get(sessionId);
  if (!state || !state.isReady) return;
  const wid = state.client.info?.wid?._serialized;
  if (!wid) return;
  try {
    const profilePic = await state.client.getProfilePicUrl(wid);
    const current = sessions.get(sessionId);
    if (current) current.avatarUrl = profilePic || null;
  } catch {
    logger.warn("WHATSAPP", `Avatar nao obtido sessionId=${sessionId}`);
  }
}

function createClient(sessionId: string): ClientState {
  const clientId = sanitizeClientId(sessionId);
  const client = new Client({
    authStrategy: new LocalAuth({
      clientId,
      dataPath: getSessionPath(),
    }),
    puppeteer: getPuppeteerConfig(),
  });

  const state: ClientState = {
    client,
    qrDataUrl: null,
    isReady: false,
    pushName: null,
    phone: null,
    wid: null,
    avatarUrl: null,
  };

  client.on("qr", async (qr) => {
    try {
      const dataUrl = await QRCode.toDataURL(qr, { width: 320 });
      const s = sessions.get(sessionId);
      if (s) s.qrDataUrl = dataUrl;
      await sessionStore.setStatus(sessionId, "qr");
      await sessionStore.setQr(sessionId, dataUrl);
      eventEmitter?.("qr", sessionId, { qr: dataUrl });
      notifyQrStream(sessionId, { qr: dataUrl, status: "qr" });
      publishQrToRedis?.(sessionId, dataUrl);
      logger.info("WHATSAPP", `QR gerado sessionId=${sessionId}`);
    } catch (err) {
      logger.error("WHATSAPP", `Erro QR sessionId=${sessionId}`, err);
    }
  });

  client.on("ready", () => {
    const s = sessions.get(sessionId);
    if (s) {
      s.isReady = true;
      s.qrDataUrl = null;
      const info = client.info;
      if (info) {
        s.pushName = info.pushname || null;
        s.wid = info.wid?._serialized || null;
        s.phone = info.wid?.user || null;
      }
    }
    const s2 = sessions.get(sessionId);
    const meta = {
      pushName: s2?.pushName ?? undefined,
      phone: s2?.phone ?? undefined,
      wid: s2?.wid ?? undefined,
    };
    void sessionStore.setStatus(sessionId, "connected");
    void sessionStore.setMeta(sessionId, meta);
    void sessionStore.clearQr(sessionId);
    eventEmitter?.("ready", sessionId);
    notifyQrStream(sessionId, { status: "connected" });
    const redis = getRedisClient();
    if (redis) redis.publish("wa:ready", sessionId).catch(() => {});
    void refreshSelfAvatar(sessionId);
    clearReconnectState(sessionId);
    logger.success("WHATSAPP", `Cliente pronto sessionId=${sessionId}`);
  });

  client.on("authenticated", () => {
    logger.success("WHATSAPP", `Autenticado sessionId=${sessionId}`);
  });

  client.on("auth_failure", (msg: string) => {
    logger.error("WHATSAPP", `Falha auth sessionId=${sessionId}: ${msg}`);
    const s = sessions.get(sessionId);
    if (s) s.isReady = false;
    eventEmitter?.("auth_failure", sessionId, { message: msg });
  });

  client.on("disconnected", (reason: string) => {
    logger.warn("WHATSAPP", `Desconectado sessionId=${sessionId}: ${reason}`);
    const s = sessions.get(sessionId);
    if (s) {
      s.isReady = false;
      s.qrDataUrl = null;
      s.pushName = null;
      s.phone = null;
      s.wid = null;
      s.avatarUrl = null;
    }
    void sessionStore.setStatus(sessionId, "disconnected");
    void sessionStore.clearQr(sessionId);
    eventEmitter?.("disconnected", sessionId, { reason });
    scheduleReconnect(sessionId);
  });

  return state;
}

function scheduleReconnect(sessionId: string): void {
  if (reconnectTimeouts.get(sessionId)) return;
  const attempt = reconnectAttempts.get(sessionId) ?? 0;
  const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
  const timeout = setTimeout(() => {
    reconnectTimeouts.delete(sessionId);
    reconnectAttempts.set(sessionId, attempt + 1);
    const existing = sessions.get(sessionId);
    if (existing) return;
    logger.info("WHATSAPP", `Reconectando sessionId=${sessionId} tentativa=${attempt + 1}`);
    void initSession(sessionId);
  }, DEBOUNCE_RECONNECT_MS + delay);
  reconnectTimeouts.set(sessionId, timeout);
}

export async function removeSession(sessionId: string): Promise<void> {
  clearReconnectState(sessionId);
  pendingCreate.delete(sessionId);
  initLocks.delete(sessionId);
  const state = sessions.get(sessionId);
  if (!state) return;
  sessions.delete(sessionId);
  qrStreamListeners.delete(sessionId);
  try {
    await state.client.destroy();
  } catch (err) {
    logger.error("WHATSAPP", `Erro destroy sessionId=${sessionId}`, err);
  }
}

export async function initSession(sessionId: string): Promise<ClientState> {
  const existing = sessions.get(sessionId);
  if (existing) return existing;

  let lock = initLocks.get(sessionId);
  if (lock) {
    await lock;
    const after = sessions.get(sessionId);
    if (after) return after;
  }

  const lockPromise = (async (): Promise<void> => {
    await removeSession(sessionId);
  })();
  initLocks.set(sessionId, lockPromise);
  await lockPromise;

  const pending = pendingCreate.get(sessionId);
  if (pending) return pending;

  const createPromise = (async (): Promise<ClientState> => {
    const again = sessions.get(sessionId);
    if (again) return again;
    await acquireInitSlot();
    try {
      const state = createClient(sessionId);
      sessions.set(sessionId, state);
      state.client.initialize().catch(async (err) => {
        logger.error("WHATSAPP", `Erro init sessionId=${sessionId}`, err);
        pendingCreate.delete(sessionId);
        await removeSession(sessionId);
        try {
          await sessionStore.setStatus(sessionId, "disconnected");
          await prisma.whatsappSession.updateMany({
            where: { id: sessionId },
            data: { status: "disconnected" },
          });
        } catch (_) {}
      });
      setTimeout(() => releaseInitSlot(), INIT_SLOT_RELEASE_DELAY_MS);
      return state;
    } catch (e) {
      releaseInitSlot();
      throw e;
    }
  })();

  pendingCreate.set(sessionId, createPromise);
  try {
    const state = await createPromise;
    pendingCreate.delete(sessionId);
    initLocks.delete(sessionId);
    return state;
  } catch (e) {
    pendingCreate.delete(sessionId);
    initLocks.delete(sessionId);
    throw e;
  }
}

export function getClientState(sessionId: string): ClientState | undefined {
  return sessions.get(sessionId);
}

export function isClientReady(sessionId: string): boolean {
  const state = sessions.get(sessionId);
  return state?.isReady === true;
}

export function getQrDataUrl(sessionId: string): string | null {
  const state = sessions.get(sessionId);
  return state?.qrDataUrl ?? null;
}

export function getClientInfo(sessionId: string): {
  pushName: string | null;
  phone: string | null;
  wid: string | null;
  avatarUrl: string | null;
} | null {
  const state = sessions.get(sessionId);
  if (!state || !state.isReady) return null;
  return {
    pushName: state.pushName,
    phone: state.phone,
    wid: state.wid,
    avatarUrl: state.avatarUrl,
  };
}

export async function destroyClient(sessionId: string): Promise<void> {
  await removeSession(sessionId);
}

export async function releasePairingClient(sessionId: string): Promise<void> {
  const state = sessions.get(sessionId);
  if (!state || state.isReady) return;
  await removeSession(sessionId);
  logger.info("WHATSAPP", `Pairing liberado sessionId=${sessionId}`);
}

export async function restartClient(sessionId: string): Promise<ClientState> {
  await removeSession(sessionId);
  await new Promise((r) => setTimeout(r, RESTART_DELAY_MS));
  return initSession(sessionId);
}

export function getReadyClient(sessionId: string): Client {
  const state = sessions.get(sessionId);
  if (!state || !state.isReady) {
    throw new Error("WhatsApp nao esta conectado. Conecte escaneando o QR code.");
  }
  return state.client;
}
