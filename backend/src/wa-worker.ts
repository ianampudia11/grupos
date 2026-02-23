import "./config/env";
import { getRedisClient } from "./redis";
import { setPublishQrToRedis } from "./whatsapp/sessionManager";
import { initSession } from "./whatsapp/sessionManager";
import { prisma } from "./prismaClient";
import { startQueue } from "./queue/queue";
import { startWhatsAppQueueWorkers } from "./queue/bullmq";
import { restart, disconnect, releasePairing } from "./services/whatsappConnectionService";
import { logger } from "./utils/logger";

const redis = getRedisClient();
if (redis) {
  setPublishQrToRedis((sessionId, qr) => {
    redis.publish("wa:qr", JSON.stringify({ sessionId, qr })).catch(() => {});
  });
}

async function restoreSessions(): Promise<void> {
  const sessions = await prisma.whatsappSession.findMany({
    where: { status: "connected" },
    select: { id: true },
  });
  for (const s of sessions) {
    try {
      await initSession(s.id);
    } catch (err) {
      logger.warn("WA_WORKER", `Restore session ${s.id} falhou`, err);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (sessions.length > 0) logger.info("WA_WORKER", `${sessions.length} sessao(oes) em restauracao`);
}

startQueue();
startWhatsAppQueueWorkers({
  restart: (sessionId, companyId) => restart(sessionId, companyId),
  ensure: (sessionId) => initSession(sessionId),
  disconnect: (sessionId, companyId) => disconnect(sessionId, companyId),
  release: (sessionId, companyId) => releasePairing(sessionId, companyId),
});

void restoreSessions();
logger.info("WA_WORKER", "Processo wa-worker em execucao (sessoes + jobs BullMQ)");
