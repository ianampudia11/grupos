/**
 * WhatsApp Group Sender SaaS - Backend
 * Site: plwdesign.online
 * Autor: Santos PLW / Alex
 */
import express from "express";
import fs from "fs";
import path from "path";
import { createServer } from "http";
import cors from "cors";
import { env } from "./config/env";
import { setupSocket } from "./socket";
import {
  generalRateLimiter,
  authRateLimiter,
  registerRateLimiter,
  sensitiveApiLimiter,
  securityHeaders,
  sanitizeInput,
  ipBlocklistMiddleware,
  bodySizeLimit,
} from "./security";
import { requestValidationMiddleware } from "./security/requestValidation";
import { hppMiddleware } from "./security/hpp";
import authRoutes from "./routes/auth";
import whatsappRoutes from "./routes/whatsapp";
import adminUsersRoutes from "./routes/adminUsers";
import campaignsRoutes from "./routes/campaigns";
import dashboardRoutes from "./routes/dashboard";
import productsRoutes from "./routes/products";
import messageTemplatesRoutes from "./routes/messageTemplates";
import templateTypesRoutes from "./routes/templateTypes";
import groupsRoutes from "./routes/groups";
import companiesRoutes from "./routes/companies";
import plansRoutes from "./routes/plans";
import subscriptionsRoutes from "./routes/subscriptions";
import invoicesRoutes from "./routes/invoices";
import adminInvoicesRoutes from "./routes/adminInvoices";
import settingsRoutes from "./routes/settings";
import webhooksRoutes from "./routes/webhooks";
import linkPreviewRoutes from "./routes/linkPreview";
import { logger } from "./utils/logger";
import { isScanRequest, recordScanAttempt } from "./security/scanProtection";
import { startQueue } from "./queue/queue";
import { startWhatsAppQueueWorkers } from "./queue/bullmq";
import { restart, disconnect, releasePairing } from "./services/whatsappConnectionService";
import { onDestroySession } from "./services/whatsappClientManager";
import { clearGroupsStoreForSession } from "./services/whatsappService";

const app = express();

// --- Segurança Cibernética ---
app.set("trust proxy", 1); // necessário para rate limit com proxy/nginx
app.use(securityHeaders);
app.use((_req, res, next) => {
  res.setHeader("Permissions-Policy", "accelerometer=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()");
  next();
});
// Blocklist: estática (BLOCKLIST_IPS) + dinâmica (IPs bloqueados por scan/ataque)
const staticBlocklist = env.security?.blocklistIps?.length
  ? new Set(env.security.blocklistIps)
  : new Set<string>();
app.use(ipBlocklistMiddleware(staticBlocklist));
app.use(requestValidationMiddleware);
app.use(hppMiddleware);
app.use(generalRateLimiter);
app.use(
  cors({
    origin: env.corsOrigin,
    credentials: true,
  })
);
app.use(express.json({ limit: bodySizeLimit }));
app.use(express.urlencoded({ extended: true, limit: bodySizeLimit }));
app.use(sanitizeInput);
/** Rótulos legíveis para logs HTTP (method + path prefix -> nome). Ordem: mais específico primeiro. */
function getHttpLogLabel(method: string, path: string): string {
  const p = path.split("?")[0];
  const routes: Array<[string, string, string]> = [
    ["POST", "/api/auth/login", "Login"],
    ["POST", "/api/auth/register", "Registro"],
    ["POST", "/api/groups/sync", "Sincronizar grupos"],
    ["GET", "/api/groups", "Listar grupos"],
    ["POST", "/api/campaigns", "Crear campaña"],
    ["GET", "/api/campaigns", "Listar campañas"],
    ["POST", "/api/campaigns/", "Enviar/pausar campaña"],
    ["DELETE", "/api/campaigns", "Eliminar campaña(s)"],
    ["GET", "/api/whatsapp/sessions", "Listar conexiones"],
    ["POST", "/api/whatsapp/sessions", "Crear conexión"],
    ["GET", "/api/whatsapp/sessions/", "Estado/QR conexión"],
    ["POST", "/api/whatsapp/sessions/", "Reiniciar/desconectar conexión"],
    ["POST", "/api/whatsapp/sync-groups", "Sincronizar grupos (whatsapp)"],
    ["GET", "/api/dashboard", "Dashboard"],
    ["GET", "/api/products", "Listar produtos"],
    ["POST", "/api/products", "Criar produto"],
    ["GET", "/api/invoices", "Listar faturas"],
    ["POST", "/api/invoices", "Pagar fatura"],
    ["GET", "/api/companies", "Empresas"],
    ["GET", "/api/plans", "Planos"],
    ["GET", "/api/subscriptions", "Suscripciones"],
    ["PUT", "/api/subscriptions", "Actualizar suscripción"],
    ["GET", "/api/admin", "Admin"],
    ["POST", "/api/admin", "Admin"],
    ["GET", "/api/settings", "Configuración"],
    ["PUT", "/api/settings", "Configuración"],
    ["GET", "/api/settings/dispatch", "Configuración de envíos"],
    ["PUT", "/api/settings/dispatch", "Configuración de envíos"],
    ["GET", "/api/message-templates", "Templates"],
    ["GET", "/api/template-types", "Tipos de template"],
    ["GET", "/api/webhooks", "Webhooks"],
    ["POST", "/api/webhooks", "Webhook"],
  ];
  for (const [m, prefix, label] of routes) {
    if (m !== method) continue;
    const match = prefix.endsWith("/") ? p.startsWith(prefix) : p === prefix || p.startsWith(prefix + "/");
    if (match) return label;
  }
  return `${method} ${p}`;
}

/** Captura o body enviado em res.json() para incluir no log de 4xx/5xx. */
app.use((_req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = function (body: unknown) {
    if (res.statusCode >= 400 && body && typeof body === "object" && "message" in body && typeof (body as { message?: unknown }).message === "string") {
      res.locals._responseMessage = (body as { message: string }).message;
    }
    return originalJson(body);
  };
  next();
});

app.use((req, res, next) => {
  const startedAt = Date.now();

  res.on("finish", async () => {
    const elapsed = Date.now() - startedAt;
    const isHealth = req.path === "/api/health";
    const is4xx = res.statusCode >= 400 && res.statusCode < 500;

    // Reduz ruído: requisições de scan (phpunit, think, etc.) que retornam 404 não viram WARN
    if (is4xx && res.statusCode === 404 && isScanRequest(req)) {
      const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
      const { skipLog } = await recordScanAttempt(ip, req.originalUrl || req.path, res.statusCode);
      if (skipLog) return; // não loga esta requisição
    }

    const shouldSkip = isHealth || (res.statusCode < 400 && req.method === "GET");
    if (shouldSkip) return;

    const scope = "HTTP";
    const label = getHttpLogLabel(req.method, req.originalUrl || req.path);
    const responseMsg = res.locals._responseMessage as string | undefined;
    const detail = responseMsg ? ` — ${responseMsg}` : "";
    const msg = `${label} ${res.statusCode} ${elapsed}ms${detail}`;
    if (res.statusCode >= 500) {
      logger.error(scope, msg);
      return;
    }
    if (res.statusCode >= 400) {
      logger.warn(scope, msg);
      return;
    }
    logger.info(scope, msg);
  });

  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Pasta base de uploads (pasta da empresa é criada automaticamente no multer)
const uploadsDir = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// arquivos enviados - imagens de produtos e campanhas (estrutura: uploads/{companyId}/)
app.use("/uploads", express.static(uploadsDir));
// mídias públicas (logotipos, etc) - permite carregar de outro origin (frontend em dev)
const publicDir = path.resolve(process.cwd(), "public");
app.use("/public", (req, res, next) => {
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Access-Control-Allow-Origin", env.corsOrigin);
  next();
}, express.static(publicDir));

app.use("/api/auth", authRoutes);
app.use("/api/whatsapp", whatsappRoutes);
app.use("/api/admin", adminUsersRoutes);
app.use("/api/campaigns", sensitiveApiLimiter, campaignsRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/products", productsRoutes);
app.use("/api/message-templates", messageTemplatesRoutes);
app.use("/api/template-types", templateTypesRoutes);
app.use("/api/groups", groupsRoutes);
app.use("/api/companies", companiesRoutes);
app.use("/api/plans", plansRoutes);
app.use("/api/subscriptions", subscriptionsRoutes);
app.use("/api/invoices", invoicesRoutes);
app.use("/api/admin-invoices", adminInvoicesRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/webhooks", sensitiveApiLimiter, webhooksRoutes);
app.use("/api/link-preview", linkPreviewRoutes);

app.use(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err.name === "MulterError" && err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ message: "Archivo demasiado grande. Logotipo: hasta 5 MB; favicon/ícono: hasta 512 KB." });
      return;
    }
    logger.error("API", "Error interno no manejado", err);
    res.status(500).json({ message: "Error interno del servidor" });
  }
);

const httpServer = createServer(app);
setupSocket(httpServer);
onDestroySession(clearGroupsStoreForSession);

httpServer.listen(env.port, () => {
  logger.success("SERVER", `Backend ejecutándose en el puerto ${env.port}`);
  startQueue();
  startWhatsAppQueueWorkers({
    restart: (sessionId, companyId) => restart(sessionId, companyId),
    disconnect: (sessionId, companyId) => disconnect(sessionId, companyId),
    release: (sessionId, companyId) => releasePairing(sessionId, companyId),
  });
});

