import { Chat, MessageMedia } from "whatsapp-web.js";
import { getOrCreateClient, getReadyClient, isClientReady, getClientState } from "./whatsappClientManager";
import fs from "fs";
import path from "path";
import { prisma } from "../prismaClient";
import { logger } from "../utils/logger";
import { checkLimit } from "./planLimitsService";

type GroupData = {
  id: string;
  name: string;
  participantCount?: number;
  avatarUrl?: string | null;
};

const groupsStore: Map<string, GroupData[]> = new Map();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForClientReady = async (
  sessionId: string,
  timeoutMs = 20000,
  intervalMs = 500
) => {
  const startedAt = Date.now();
  await getOrCreateClient(sessionId);
  while (Date.now() - startedAt < timeoutMs) {
    if (isClientReady(sessionId)) return;
    await sleep(intervalMs);
  }
  throw new Error("WhatsApp ainda nao esta pronto. Aguarde alguns segundos e tente novamente.");
};

const normalizeGroups = (chats: Chat[]): GroupData[] => {
  const byId = new Map<string, GroupData>();

  for (const chat of chats) {
    if (!chat.isGroup) continue;

    const rawId = (chat as any)?.id?._serialized;
    if (!rawId || typeof rawId !== "string") continue;

    const rawName = (chat as any)?.name;
    const name =
      typeof rawName === "string" && rawName.trim().length > 0 ? rawName.trim() : rawId;

    byId.set(rawId, { id: rawId, name });
  }

  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
};

const WAIT_FOR_READY_MS = 90000; // 90s para restauração após restart
const READY_POLL_MS = 800;

type SessionForSync = { id: string; companyId: string; name: string; isDefault: boolean; status: string };

/** Garante que clients existam para sessões marcadas como conectadas no DB e aguarda até um ficar pronto (restauração após restart). */
const ensureClientsAndWaitReady = async (sessions: SessionForSync[]): Promise<SessionForSync[]> => {
  const connectedInDb = sessions.filter((s) => s.status === "connected");
  if (connectedInDb.length === 0) return [];

  logger.info("WHATSAPP", `Restaurando ${connectedInDb.length} sessão(ões) conectada(s) no DB para sync de grupos...`);
  try {
    await getOrCreateClient(connectedInDb[0].id);
  } catch (e) {
    logger.warn("WHATSAPP", "Falha ao restaurar primeira sessão para sync", e);
  }
  for (let i = 1; i < connectedInDb.length; i++) {
    void getOrCreateClient(connectedInDb[i].id);
  }

  const deadline = Date.now() + WAIT_FOR_READY_MS;
  while (Date.now() < deadline) {
    const ready = sessions.filter((s) => isClientReady(s.id));
    if (ready.length > 0) {
      logger.info("WHATSAPP", `${ready.length} sessão(ões) pronta(s) para sync de grupos.`);
      return ready;
    }
    const anyInitializing = sessions.some((s) => s.status === "connected" && getClientState(s.id) && !isClientReady(s.id));
    if (anyInitializing) {
      logger.info("WHATSAPP", "Aguardando cliente WhatsApp ficar pronto para sync...");
    }
    await sleep(READY_POLL_MS);
  }
  return sessions.filter((s) => isClientReady(s.id));
};

export const fetchGroupsFromRemote = async (companyId: string) => {
  const sessions = await prisma.whatsappSession.findMany({
    where: { companyId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true, companyId: true, name: true, isDefault: true, status: true },
  });

  let connectedSessions = sessions.filter((s) => isClientReady(s.id));
  if (connectedSessions.length === 0) {
    connectedSessions = await ensureClientsAndWaitReady(sessions);
  }

  if (connectedSessions.length === 0) {
    const hasConnectedInDb = sessions.some((s) => s.status === "connected");
    if (hasConnectedInDb) {
      throw new Error(
        "WhatsApp está conectado no painel mas ainda não ficou pronto. Aguarde cerca de 1 minuto e clique em Sincronizar novamente. Se o problema continuar, tente Desconectar e escanear o QR de novo."
      );
    }
    throw new Error("Nenhum WhatsApp conectado. Conecte ao menos uma sessão (QR Code) e tente novamente.");
  }

  const allGroups: GroupData[] = [];
  for (const session of connectedSessions) {
    await waitForClientReady(session.id);
    const client = getReadyClient(session.id);
    let chats: Chat[];
    try {
      chats = await client.getChats();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/timeout|timed out|protocolTimeout/i.test(msg)) {
        throw new Error(
          "A sincronização demorou mais que o esperado (muitos grupos ou conexão lenta). Tente novamente em alguns instantes."
        );
      }
      throw err;
    }
    const groups = normalizeGroups(chats);
    try {
      for (const group of groups) {
        const existing = await prisma.whatsappGroup.findUnique({
          where: { sessionId_waId: { sessionId: session.id, waId: group.id } },
        });
        if (!existing) {
          const { allowed } = await checkLimit(session.companyId, "groups");
          if (!allowed) continue;
        }
        let participantCount: number | undefined;
        let avatarUrl: string | null | undefined;
        try {
          const chat = await client.getChatById(group.id);
          if (chat && (chat as any).participants) {
            participantCount = (chat as any).participants?.length ?? undefined;
          }
          const pic = await client.getProfilePicUrl(group.id);
          avatarUrl = pic ?? null;
        } catch (_) {}
        await prisma.whatsappGroup.upsert({
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
    } catch (err) {
      logger.error("WHATSAPP", `Falha ao persistir grupos sessionId=${session.id}`, err);
    }
    allGroups.push(...groups);
  }
  groupsStore.delete(companyId);
  return allGroups;
};

export const listGroups = async (companyId: string) => {
  const rows = await prisma.whatsappGroup.findMany({
    where: { session: { companyId } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return rows.map((r: { id: string; name: string }) => ({ id: r.id, name: r.name }));
};

export type GroupFull = {
  id: string;
  waId: string;
  name: string;
  participantCount?: number | null;
  avatarUrl?: string | null;
  source: string;
  createdAt: string;
  sessionId: string;
  sessionName: string;
};

export const listGroupsFull = async (companyId: string): Promise<GroupFull[]> => {
  const rows = await prisma.whatsappGroup.findMany({
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
  return rows.map((r: { id: string; waId: string; name: string; participantCount?: number | null; avatarUrl?: string | null; source: string; createdAt: Date; sessionId: string; session: { name: string } }) => ({
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

export type SendMessageOptions = {
  imagePath?: string;
  campaignId?: string;
  linkUrl?: string;
  userId?: string;
  /** Se true, menciona todos os participantes do grupo no disparo. */
  mentionAll?: boolean;
};

export const sendMessageToGroup = async (
  companyId: string,
  groupId: string,
  message: string,
  imagePath?: string,
  opts?: SendMessageOptions
) => {
  const campaignId = opts?.campaignId ?? undefined;
  const linkUrl = opts?.linkUrl ?? undefined;
  const userId = opts?.userId;
  const mentionAll = opts?.mentionAll === true;

  const group = await prisma.whatsappGroup.findFirst({
    where: {
      OR: [{ id: groupId }, { waId: groupId }],
      session: { companyId },
    },
    select: { id: true, waId: true, sessionId: true },
  });
  if (!group) throw new Error("Grupo não encontrado");
  const client = getReadyClient(group.sessionId);
  const waId = group.waId;
  const dbGroupId = group.id;

  let sendRecord = await prisma.messageSend.create({
    data: {
      userId: userId!,
      groupId: dbGroupId,
      messageText: message,
      imagePath: imagePath ?? undefined,
      linkUrl: linkUrl ?? undefined,
      campaignId: campaignId ?? undefined,
      status: "pending",
    },
  });

  let mentionIds: string[] = [];
  if (mentionAll) {
    try {
      const chat = await client.getChatById(waId);
      let participants = (chat as any).participants;
      if (participants != null) {
        const list = Array.isArray(participants)
          ? participants
          : (participants as any)._models
            ? (participants as any)._models
            : typeof (participants as any)[Symbol.iterator] === "function"
              ? [...(participants as Iterable<any>)]
              : Object.values(participants);
        mentionIds = list
          .map((p: any) => p?.id?._serialized ?? (p?.id?.user ? `${p.id.user}@c.us` : null))
          .filter(Boolean);
      }
    } catch (e) {
      logger.warn("WHATSAPP", "Não foi possível obter participantes para mencionar todos", e);
    }
  }

  // Menção fantasma: envia com mentions para notificar todos, sem incluir @ na mensagem visível
  const sendOptions = mentionIds.length > 0 ? { mentions: mentionIds } : {};

  try {
    if (imagePath) {
      let absolutePath = imagePath;
      if (imagePath.startsWith("/uploads/")) {
        absolutePath = path.resolve(process.cwd(), imagePath.slice(1));
      } else if (!path.isAbsolute(imagePath)) {
        absolutePath = path.resolve(process.cwd(), imagePath);
      }

      if (!fs.existsSync(absolutePath)) {
        throw new Error("Arquivo de mídia não encontrado");
      }

      const media = MessageMedia.fromFilePath(absolutePath);
      const ext = path.extname(absolutePath).toLowerCase();
      const audioExts = [".ogg", ".opus", ".mp3", ".m4a", ".amr", ".aac", ".webm"];
      const isAudio = audioExts.includes(ext) || (media.mimetype || "").startsWith("audio/");

      if (isAudio) {
        await client.sendMessage(waId, media, {
          sendAudioAsVoice: true,
          caption: message || undefined,
          ...sendOptions,
        });
      } else {
        await client.sendMessage(waId, media, {
          caption: message,
          ...sendOptions,
        });
      }
    } else {
      await client.sendMessage(waId, message, sendOptions);
    }

    await prisma.messageSend.update({
      where: { id: sendRecord.id },
      data: { status: "sent" },
    });

    return { ok: true };
  } catch (err: any) {
    await prisma.messageSend.update({
      where: { id: sendRecord.id },
      data: { status: "failed", error: err?.message ?? "Erro desconhecido" },
    });
    throw err;
  }
};

