import { Client, LocalAuth } from "whatsapp-web.js";
import * as QRCode from "qrcode";
import path from "path";
import { logger } from "../utils/logger";
import { env } from "../config/env";
import { sessionStore } from "../redis";
import { prisma } from "../prismaClient";

type WhatsappEventCallback = (
  event: string,
  sessionId: string,
  data?: { qr?: string; message?: string; reason?: string }
) => void;

/** Sanitiza sessionId para uso como clientId (apenas alfanumérico, _ e -) */
function sanitizeClientId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

let eventEmitter: WhatsappEventCallback | null = null;

export function setWhatsappEventEmitter(emitter: WhatsappEventCallback): void {
  eventEmitter = emitter;
}

interface ClientState {
  client: Client;
  qrDataUrl: string | null;
  isReady: boolean;
  pushName: string | null;
  phone: string | null;
  wid: string | null;
  avatarUrl: string | null;
}

const clients = new Map<string, ClientState>();
/** Evita criar dois clients para a mesma sessão ao mesmo tempo (evita "browser already running"). */
const pendingCreate = new Map<string, Promise<ClientState>>();

/** Máximo de clients inicializando ao mesmo tempo (evita OOM e bloqueio do event loop). */
const MAX_CONCURRENT_INITS = 1;
const INIT_SLOT_RELEASE_DELAY_MS = 8000;
let currentInits = 0;
const initWaitQueue: Array<() => void> = [];

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

async function refreshSelfAvatar(sessionId: string): Promise<void> {
  const state = clients.get(sessionId);
  if (!state || !state.isReady) return;
  const wid = state.client.info?.wid?._serialized;
  if (!wid) return;
  try {
    const profilePic = await state.client.getProfilePicUrl(wid);
    const current = clients.get(sessionId);
    if (current) {
      current.avatarUrl = profilePic || null;
    }
  } catch (err) {
    logger.warn(
      "WHATSAPP",
      `Nao foi possivel obter avatar para sessionId=${sessionId}`
    );
  }
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
      : ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"];
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
  if (env.chromeBin) base.executablePath = env.chromeBin;
  if (env.chromeWs) base.browserWSEndpoint = env.chromeWs;
  return base;
}

function createClientForSession(sessionId: string): ClientState {
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
      const s = clients.get(sessionId);
      if (s) s.qrDataUrl = dataUrl;
      await sessionStore.setStatus(sessionId, "qr");
      await sessionStore.setQr(sessionId, dataUrl);
      eventEmitter?.("qr", sessionId, { qr: dataUrl });
      logger.info("WHATSAPP", `QR gerado para sessionId=${sessionId}`);
    } catch (err) {
      logger.error(
        "WHATSAPP",
        `Erro ao gerar QR data URL sessionId=${sessionId}`,
        err
      );
    }
  });

  client.on("ready", () => {
    const s = clients.get(sessionId);
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
    const s2 = clients.get(sessionId);
    const meta = {
      pushName: s2?.pushName ?? undefined,
      phone: s2?.phone ?? undefined,
      wid: s2?.wid ?? undefined,
    };
    void sessionStore.setStatus(sessionId, "connected");
    void sessionStore.setMeta(sessionId, meta);
    void sessionStore.clearQr(sessionId);
    eventEmitter?.("ready", sessionId);
    void refreshSelfAvatar(sessionId);
    logger.success("WHATSAPP", `Cliente pronto para sessionId=${sessionId}`);
  });

  client.on("authenticated", () => {
    logger.success("WHATSAPP", `Autenticado para sessionId=${sessionId}`);
  });

  client.on("auth_failure", (msg: string) => {
    logger.error(
      "WHATSAPP",
      `Falha de autenticacao para sessionId=${sessionId}: ${msg}`
    );
    const s = clients.get(sessionId);
    if (s) s.isReady = false;
    eventEmitter?.("auth_failure", sessionId, { message: msg });
  });

  client.on("disconnected", (reason: string) => {
    logger.warn(
      "WHATSAPP",
      `Desconectado sessionId=${sessionId}: ${reason}`
    );
    const s = clients.get(sessionId);
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
  });

  clients.set(sessionId, state);
  client.initialize().catch(async (err) => {
    logger.error(
      "WHATSAPP",
      `Erro ao inicializar client para sessionId=${sessionId}`,
      err
    );
    pendingCreate.delete(sessionId);
    clients.delete(sessionId);
    try {
      await sessionStore.setStatus(sessionId, "disconnected");
      await prisma.whatsappSession.updateMany({
        where: { id: sessionId },
        data: { status: "disconnected" },
      });
    } catch (_) {}
  });
  return state;
}

/**
 * Obtém ou cria o client da sessão. Criação é serializada por sessionId
 * e limitada globalmente (1 por vez) para evitar bloqueio e OOM.
 */
export async function getOrCreateClient(sessionId: string): Promise<ClientState> {
  const existing = clients.get(sessionId);
  if (existing) return existing;

  const pending = pendingCreate.get(sessionId);
  if (pending) return pending;

  const promise = (async (): Promise<ClientState> => {
    const again = clients.get(sessionId);
    if (again) return again;
    await acquireInitSlot();
    try {
      const state = createClientForSession(sessionId);
      setTimeout(() => releaseInitSlot(), INIT_SLOT_RELEASE_DELAY_MS);
      return state;
    } catch (e) {
      releaseInitSlot();
      throw e;
    }
  })();
  pendingCreate.set(sessionId, promise);
  try {
    const state = await promise;
    pendingCreate.delete(sessionId);
    return state;
  } catch (e) {
    pendingCreate.delete(sessionId);
    throw e;
  }
}

/** Síncrono: retorna o state se já existir (para chamadas que não podem esperar). */
export function getOrCreateClientSync(sessionId: string): ClientState | undefined {
  return clients.get(sessionId);
}

export function getClientState(sessionId: string): ClientState | undefined {
  return clients.get(sessionId);
}

export function isClientReady(sessionId: string): boolean {
  const state = clients.get(sessionId);
  return state?.isReady === true;
}

export function getQrDataUrl(sessionId: string): string | null {
  const state = clients.get(sessionId);
  return state?.qrDataUrl ?? null;
}

export function getClientInfo(sessionId: string): {
  pushName: string | null;
  phone: string | null;
  wid: string | null;
  avatarUrl: string | null;
} | null {
  const state = clients.get(sessionId);
  if (!state || !state.isReady) return null;
  return {
    pushName: state.pushName,
    phone: state.phone,
    wid: state.wid,
    avatarUrl: state.avatarUrl,
  };
}

export async function destroyClient(sessionId: string): Promise<void> {
  pendingCreate.delete(sessionId);
  const state = clients.get(sessionId);
  if (!state) return;
  clients.delete(sessionId);
  try {
    await state.client.destroy();
  } catch (err) {
    logger.error(
      "WHATSAPP",
      `Erro ao destruir client sessionId=${sessionId}`,
      err
    );
  }
}

/** Destrói o client apenas se estiver em modo pairing (aguardando QR). Não desconecta sessões já conectadas. */
export async function releasePairingClient(sessionId: string): Promise<void> {
  pendingCreate.delete(sessionId);
  const state = clients.get(sessionId);
  if (!state || state.isReady) return;
  clients.delete(sessionId);
  try {
    await state.client.destroy();
    logger.info("WHATSAPP", `Client pairing liberado sessionId=${sessionId}`);
  } catch (err) {
    logger.error(
      "WHATSAPP",
      `Erro ao liberar client sessionId=${sessionId}`,
      err
    );
  }
}

/** Delay (ms) após destroy para o browser fechar e evitar "Target closed" no próximo init. */
const RESTART_DELAY_MS = 5000;

export async function restartClient(sessionId: string): Promise<void> {
  await destroyClient(sessionId);
  await new Promise((r) => setTimeout(r, RESTART_DELAY_MS));
  await getOrCreateClient(sessionId);
}

export function getReadyClient(sessionId: string): Client {
  const state = clients.get(sessionId);
  if (!state || !state.isReady) {
    throw new Error(
      "WhatsApp nao esta conectado. Conecte escaneando o QR code."
    );
  }
  return state.client;
}
