import { Router } from "express";
import { z } from "zod";
import { authMiddleware, enrichAuth, AuthRequest } from "../middleware/auth";
import { prisma } from "../prismaClient";
import {
  fetchGroupsFromRemote,
  listGroups,
  sendMessageToGroup,
} from "../services/whatsappService";
import {
  disconnect,
  getConnectionStatus,
  getQrCode,
  restart,
  releasePairing,
} from "../services/whatsappConnectionService";
import {
  addWhatsappQrStreamListener,
  removeWhatsappQrStreamListener,
  isClientReady,
  getOrCreateClient,
} from "../services/whatsappClientManager";
import { addQrBridgeListener, removeQrBridgeListener } from "../whatsapp/qrStreamBridge";
import { addJobSafe, QUEUE_NAMES } from "../queue/bullmq";

const PROCESS_TYPE = process.env.PROCESS_TYPE || "";
const API_ONLY = PROCESS_TYPE === "api";

const QR_CACHE_TTL_MS = 90000;
const QR_RATE_LIMIT_MS = 2000;
const qrCache = new Map<string, { qr: string; ts: number }>();
const qrRateLimit = new Map<string, number>();

function getQrCacheKey(sessionId: string): string {
  return `qr:${sessionId}`;
}

function getRateLimitKey(ip: string, sessionId: string): string {
  return `rl:${ip}:${sessionId}`;
}

const router = Router();
router.use(authMiddleware);
router.use(async (req, _res, next) => {
  await enrichAuth(req as AuthRequest);
  next();
});

function requireCompany(req: AuthRequest) {
  const companyId = req.companyId;
  if (!companyId) throw new Error("Você precisa estar vinculado a uma empresa para acessar conexões.");
  return companyId;
}

/** Lista todas as sessões da empresa */
router.get("/sessions", async (req: AuthRequest, res) => {
  try {
    const companyId = requireCompany(req);
    const sessions = await prisma.whatsappSession.findMany({
      where: { companyId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      include: { _count: { select: { groups: true } } },
    });
    const { isClientReady, getOrCreateClient } = await import("../services/whatsappClientManager");
    // Sessão "connected" no DB mas client não em memória (ex.: após restart) → inicia restauração em background
    for (const s of sessions) {
      if (s.status === "connected" && !isClientReady(s.id)) {
        void getOrCreateClient(s.id);
      }
    }
    const result = sessions.map((s) => ({
      id: s.id,
      name: s.name,
      isDefault: s.isDefault,
      status: isClientReady(s.id) ? "connected" : s.status,
      waPushName: s.waPushName,
      waPhone: s.waPhone,
      waAvatarUrl: s.waAvatarUrl,
      lastConnectedAt: s.lastConnectedAt,
      _count: s._count,
    }));
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ message: err.message || "Erro ao listar sessões" });
  }
});

/** Cria nova sessão */
router.post("/sessions", async (req: AuthRequest, res) => {
  try {
    const companyId = requireCompany(req);
    const schema = z.object({ name: z.string().min(1).max(80) });
    const { name } = schema.parse(req.body);

    const { assertWithinLimit } = await import("../services/planLimitsService");
    await assertWithinLimit(companyId, "connections");

    const count = await prisma.whatsappSession.count({ where: { companyId } });
    const isDefault = count === 0;

    const session = await prisma.whatsappSession.create({
      data: { companyId, name: name.trim(), isDefault },
    });
    res.status(201).json(session);
  } catch (err: any) {
    res.status(400).json({ message: err.message || "Erro ao criar sessão" });
  }
});

/** Atualiza sessão (nome) */
router.put("/sessions/:sessionId", async (req: AuthRequest, res) => {
  try {
    const companyId = requireCompany(req);
    const schema = z.object({ name: z.string().min(1).max(80) });
    const { name } = schema.parse(req.body);
    const session = await prisma.whatsappSession.findFirst({
      where: { id: req.params.sessionId, companyId },
    });
    if (!session) return res.status(404).json({ message: "Sessão não encontrada" });
    const updated = await prisma.whatsappSession.update({
      where: { id: session.id },
      data: { name: name.trim() },
    });
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ message: err.message || "Erro ao atualizar" });
  }
});

/** Define sessão como padrão */
router.put("/sessions/:sessionId/default", async (req: AuthRequest, res) => {
  try {
    const companyId = requireCompany(req);
    const session = await prisma.whatsappSession.findFirst({
      where: { id: req.params.sessionId, companyId },
    });
    if (!session) return res.status(404).json({ message: "Sessão não encontrada" });
    await prisma.$transaction([
      prisma.whatsappSession.updateMany({
        where: { companyId },
        data: { isDefault: false },
      }),
      prisma.whatsappSession.update({
        where: { id: session.id },
        data: { isDefault: true },
      }),
    ]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ message: err.message || "Erro" });
  }
});

/** Exclui sessão e dados vinculados (grupos da sessão, envios, alvos de campanha, etc.) */
router.delete("/sessions/:sessionId", async (req: AuthRequest, res) => {
  try {
    const companyId = requireCompany(req);
    const session = await prisma.whatsappSession.findFirst({
      where: { id: req.params.sessionId, companyId },
    });
    if (!session) return res.status(404).json({ message: "Sessão não encontrada" });
    const { destroyClient } = await import("../services/whatsappClientManager");
    await destroyClient(session.id);

    const groupIds = await prisma.whatsappGroup.findMany({
      where: { sessionId: session.id },
      select: { id: true },
    });
    const ids = groupIds.map((g) => g.id);
    if (ids.length > 0) {
      await prisma.$transaction([
        prisma.linkClick.deleteMany({ where: { messageSend: { groupId: { in: ids } } } }),
        prisma.messageSend.deleteMany({ where: { groupId: { in: ids } } }),
        prisma.campaignTarget.deleteMany({ where: { groupId: { in: ids } } }),
        prisma.whatsappGroup.deleteMany({ where: { sessionId: session.id } }),
      ]);
    }
    // Campanhas desta sessão (sessionId) precisam ser removidas antes de excluir a sessão
    await prisma.campaign.deleteMany({ where: { sessionId: session.id } });
    await prisma.whatsappSession.delete({ where: { id: session.id } });

    const remaining = await prisma.whatsappSession.findFirst({
      where: { companyId },
    });
    if (remaining && !remaining.isDefault) {
      await prisma.whatsappSession.update({
        where: { id: remaining.id },
        data: { isDefault: true },
      });
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ message: err.message || "Erro ao excluir" });
  }
});

/** Status de uma sessão */
router.get("/sessions/:sessionId/status", async (req: AuthRequest, res) => {
  try {
    const companyId = requireCompany(req);
    const status = await getConnectionStatus(req.params.sessionId, companyId);
    res.json(status);
  } catch (err: any) {
    res.status(400).json({ message: err.message || "Erro ao obter status" });
  }
});

/** SSE: stream de QR para a sessão (evita polling). Token em query para EventSource. */
router.get("/sessions/:sessionId/qr/stream", async (req: AuthRequest, res) => {
  try {
    const companyId = requireCompany(req);
    const sessionId = req.params.sessionId;
    const session = await prisma.whatsappSession.findFirst({
      where: { id: sessionId, companyId },
    });
    if (!session) {
      res.status(404).json({ message: "Sessão não encontrada" });
      return;
    }
    const alreadyConnected = API_ONLY ? session.status === "connected" : isClientReady(sessionId);
    if (alreadyConnected) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`event: status\ndata: ${JSON.stringify({ status: "connected" })}\n\n`);
      res.end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const send = (data: { qr?: string; status?: string }) => {
      if (res.writableEnded) return;
      const payload = JSON.stringify(data);
      res.write(`event: ${data.status === "connected" ? "status" : "qr"}\ndata: ${payload}\n\n`);
      if (data.status === "connected") res.end();
    };
    if (API_ONLY) {
      void addJobSafe(QUEUE_NAMES.WA_INIT, "ensure", { sessionId, companyId });
      addQrBridgeListener(sessionId, send);
      req.on("close", () => removeQrBridgeListener(sessionId, send));
    } else {
      void getOrCreateClient(sessionId);
      addWhatsappQrStreamListener(sessionId, send);
      req.on("close", () => removeWhatsappQrStreamListener(sessionId, send));
    }
  } catch (err: any) {
    if (!res.headersSent) res.status(400).json({ message: err.message || "Erro ao abrir stream" });
  }
});

/** QR Code de uma sessão (cache + rate limit; preferir /qr/stream). */
router.get("/sessions/:sessionId/qr", async (req: AuthRequest, res) => {
  try {
    const companyId = requireCompany(req);
    const sessionId = req.params.sessionId;
    const ip = (req.ip ?? req.socket?.remoteAddress ?? "unknown").toString();
    const rlKey = getRateLimitKey(ip, sessionId);
    const now = Date.now();
    const last = qrRateLimit.get(rlKey) ?? 0;
    if (now - last < QR_RATE_LIMIT_MS) {
      const cached = qrCache.get(getQrCacheKey(sessionId));
      if (cached && now - cached.ts < QR_CACHE_TTL_MS) {
        res.status(200).json({ qr: cached.qr });
        return;
      }
      res.status(204).end();
      return;
    }
    qrRateLimit.set(rlKey, now);
    const qr = await getQrCode(sessionId, companyId);
    if (qr.alreadyConnected) {
      res.json(qr);
      return;
    }
    if (qr.qr) {
      qrCache.set(getQrCacheKey(sessionId), { qr: qr.qr, ts: now });
      res.json({ qr: qr.qr });
      return;
    }
    const cached = qrCache.get(getQrCacheKey(sessionId));
    if (cached && now - cached.ts < QR_CACHE_TTL_MS) {
      res.json({ qr: cached.qr });
      return;
    }
    res.json(qr);
  } catch (err: any) {
    res.status(400).json({ message: err.message || "Erro ao obter QR code" });
  }
});

/** Desconectar sessão. Enfileira quando Redis 6.2+; fallback em processo (Redis 5.x/Lua ou indisponível). */
router.post("/sessions/:sessionId/disconnect", async (req: AuthRequest, res) => {
  try {
    const companyId = requireCompany(req);
    const sessionId = req.params.sessionId;
    const result = await addJobSafe(QUEUE_NAMES.WA_CLEANUP, "disconnect", { sessionId, companyId });
    if (!result.ok) await disconnect(sessionId, companyId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ message: err.message || "Erro ao desconectar" });
  }
});

/** Reiniciar sessão. Enfileira quando Redis 6.2+; fallback em processo (Redis 5.x/Lua ou indisponível). */
router.post("/sessions/:sessionId/restart", async (req: AuthRequest, res) => {
  try {
    const companyId = requireCompany(req);
    const sessionId = req.params.sessionId;
    const result = await addJobSafe(QUEUE_NAMES.WA_INIT, "restart", { sessionId, companyId });
    if (!result.ok) await restart(sessionId, companyId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ message: err.message || "Erro ao reiniciar" });
  }
});

/** Libera client em pairing. Enfileira quando Redis 6.2+; fallback em processo (Redis 5.x/Lua ou indisponível). */
router.post("/sessions/:sessionId/release", async (req: AuthRequest, res) => {
  try {
    const companyId = requireCompany(req);
    const sessionId = req.params.sessionId;
    const result = await addJobSafe(QUEUE_NAMES.WA_CLEANUP, "release", { sessionId, companyId });
    if (!result.ok) await releasePairing(sessionId, companyId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ message: err.message || "Erro" });
  }
});

/** @deprecated Use /sessions - status da conexão principal (primeira sessão) */
router.get("/connection/status", async (req: AuthRequest, res) => {
  try {
    const companyId = requireCompany(req);
    const session = await prisma.whatsappSession.findFirst({
      where: { companyId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    if (!session) {
      const created = await prisma.whatsappSession.create({
        data: { companyId, name: "WhatsApp 1", isDefault: true, status: "disconnected" },
      });
      const status = await getConnectionStatus(created.id, companyId);
      return res.json({
        status: status.status,
        pushName: status.pushName,
        phone: status.phone,
        jid: status.jid,
        avatarUrl: status.avatarUrl,
        sessionName: status.name,
        lastConnectedAt: status.lastConnectedAt,
      });
    }
    const status = await getConnectionStatus(session.id, companyId);
    res.json({
      status: status.status,
      pushName: status.pushName,
      phone: status.phone,
      jid: status.jid,
      avatarUrl: status.avatarUrl,
      sessionName: status.name,
      lastConnectedAt: status.lastConnectedAt,
    });
  } catch (err: any) {
    res.status(400).json({ message: err.message || "Erro ao obter status" });
  }
});

/** @deprecated Use /sessions/:id/qr */
router.get("/connection/qr", async (req: AuthRequest, res) => {
  try {
    const companyId = requireCompany(req);
    let session = await prisma.whatsappSession.findFirst({
      where: { companyId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    if (!session) {
      session = await prisma.whatsappSession.create({
        data: { companyId, name: "WhatsApp 1", isDefault: true, status: "disconnected" },
      });
    }
    const qr = await getQrCode(session.id, companyId);
    res.json(qr);
  } catch (err: any) {
    res.status(400).json({ message: err.message || "Erro ao obter QR code" });
  }
});

/** @deprecated Use /sessions/:id/disconnect */
router.post("/connection/disconnect", async (req: AuthRequest, res) => {
  try {
    const companyId = requireCompany(req);
    const session = await prisma.whatsappSession.findFirst({
      where: { companyId },
    });
    if (!session) return res.json({ ok: true });
    await disconnect(session.id, companyId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ message: err.message || "Erro ao desconectar" });
  }
});

/** @deprecated Use /sessions/:id/restart */
router.post("/connection/restart", async (req: AuthRequest, res) => {
  try {
    const companyId = requireCompany(req);
    const session = await prisma.whatsappSession.findFirst({
      where: { companyId },
    });
    if (!session) return res.status(404).json({ message: "Nenhuma sessão" });
    await restart(session.id, companyId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ message: err.message || "Erro ao reiniciar" });
  }
});

router.post(
  "/sync-groups",
  async (req: AuthRequest, res): Promise<void> => {
    try {
      const companyId = requireCompany(req);
      const groups = await fetchGroupsFromRemote(companyId);
      res.json(groups);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Erro ao sincronizar grupos" });
    }
  }
);

router.get(
  "/groups",
  async (req: AuthRequest, res): Promise<void> => {
    try {
      const companyId = requireCompany(req);
      const groups = await listGroups(companyId);
      res.json(groups);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Erro ao listar grupos" });
    }
  }
);

router.post(
  "/send",
  async (req: AuthRequest, res): Promise<void> => {
    try {
      const schema = z.object({
        groupId: z.string(),
        message: z.string().min(1),
        mentionAll: z.preprocess((v) => v === true || v === "true", z.boolean().optional()).optional(),
      });
      const { groupId, message, mentionAll } = schema.parse(req.body);
      const companyId = requireCompany(req);
      const userId = req.userId!;
      const { assertGroupSendsPerDay } = await import("../services/planLimitsService");
      await assertGroupSendsPerDay(companyId);
      await sendMessageToGroup(companyId, groupId, message, undefined, { userId, mentionAll: mentionAll === true });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Erro ao enviar mensagem" });
    }
  }
);

export default router;
