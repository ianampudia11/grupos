import {
  setWhatsappEventEmitter as setSessionManagerEmitter,
  addQrStreamListener,
  removeQrStreamListener,
  initSession,
  removeSession,
  getClientState,
  isClientReady,
  getQrDataUrl,
  getClientInfo,
  getReadyClient,
  destroyClient as destroySession,
  releasePairingClient as releasePairingSession,
  restartClient as restartSession,
  type ClientState,
  type WhatsappEventCallback,
  type QrStreamSend,
} from "../whatsapp/sessionManager";

export type { ClientState };

export function setWhatsappEventEmitter(emitter: WhatsappEventCallback): void {
  setSessionManagerEmitter(emitter);
}

export function addWhatsappQrStreamListener(sessionId: string, send: QrStreamSend): void {
  addQrStreamListener(sessionId, send);
}

export function removeWhatsappQrStreamListener(sessionId: string, send: QrStreamSend): void {
  removeQrStreamListener(sessionId, send);
}

export async function getOrCreateClient(sessionId: string): Promise<ClientState> {
  return initSession(sessionId);
}

export function getOrCreateClientSync(sessionId: string): ClientState | undefined {
  return getClientState(sessionId);
}

export { getClientState, isClientReady, getQrDataUrl, getClientInfo, getReadyClient };

export async function destroyClient(sessionId: string): Promise<void> {
  await destroySession(sessionId);
}

export async function releasePairingClient(sessionId: string): Promise<void> {
  await releasePairingSession(sessionId);
}

export async function restartClient(sessionId: string): Promise<void> {
  await restartSession(sessionId);
}
