import { getRedisClient } from "../redis";
import { logger } from "../utils/logger";

export type QrStreamSend = (data: { qr?: string; status?: string }) => void;

const listeners = new Map<string, Set<QrStreamSend>>();
let subscribed = false;

function ensureSubscribed(): void {
  if (subscribed) return;
  const redis = getRedisClient();
  if (!redis) return;
  subscribed = true;
  redis.subscribe("wa:qr", "wa:ready", (err) => {
    if (err) {
      logger.warn("QR_BRIDGE", "Subscribe Redis falhou", err);
      subscribed = false;
      return;
    }
    logger.info("QR_BRIDGE", "Inscrito em wa:qr e wa:ready");
  });
  redis.on("message", (channel: string, message: string) => {
    if (channel === "wa:qr") {
      try {
        const { sessionId, qr } = JSON.parse(message) as { sessionId: string; qr: string };
        const set = listeners.get(sessionId);
        if (set) for (const send of set) try { send({ qr, status: "qr" }); } catch (_) {}
      } catch (_) {}
    } else if (channel === "wa:ready") {
      const sessionId = message;
      const set = listeners.get(sessionId);
      if (set) for (const send of set) try { send({ status: "connected" }); } catch (_) {}
    }
  });
}

export function addQrBridgeListener(sessionId: string, send: QrStreamSend): void {
  ensureSubscribed();
  let set = listeners.get(sessionId);
  if (!set) {
    set = new Set();
    listeners.set(sessionId, set);
  }
  set.add(send);
}

export function removeQrBridgeListener(sessionId: string, send: QrStreamSend): void {
  const set = listeners.get(sessionId);
  if (set) {
    set.delete(send);
    if (set.size === 0) listeners.delete(sessionId);
  }
}
