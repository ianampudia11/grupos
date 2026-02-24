"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * WhatsApp Group Sender SaaS - Backend
 * Site: plwdesign.online
 * Autor: Santos PLW / Alex
 */
const express_1 = __importDefault(require("express"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const http_1 = require("http");
const cors_1 = __importDefault(require("cors"));
const env_1 = require("./config/env");
const socket_1 = require("./socket");
const security_1 = require("./security");
const requestValidation_1 = require("./security/requestValidation");
const hpp_1 = require("./security/hpp");
const auth_1 = __importDefault(require("./routes/auth"));
const whatsapp_1 = __importDefault(require("./routes/whatsapp"));
const adminUsers_1 = __importDefault(require("./routes/adminUsers"));
const campaigns_1 = __importDefault(require("./routes/campaigns"));
const dashboard_1 = __importDefault(require("./routes/dashboard"));
const products_1 = __importDefault(require("./routes/products"));
const messageTemplates_1 = __importDefault(require("./routes/messageTemplates"));
const templateTypes_1 = __importDefault(require("./routes/templateTypes"));
const groups_1 = __importDefault(require("./routes/groups"));
const companies_1 = __importDefault(require("./routes/companies"));
const plans_1 = __importDefault(require("./routes/plans"));
const subscriptions_1 = __importDefault(require("./routes/subscriptions"));
const invoices_1 = __importDefault(require("./routes/invoices"));
const adminInvoices_1 = __importDefault(require("./routes/adminInvoices"));
const settings_1 = __importDefault(require("./routes/settings"));
const webhooks_1 = __importDefault(require("./routes/webhooks"));
const linkPreview_1 = __importDefault(require("./routes/linkPreview"));
const logger_1 = require("./utils/logger");
const scanProtection_1 = require("./security/scanProtection");
const queue_1 = require("./queue/queue");
const bullmq_1 = require("./queue/bullmq");
const whatsappConnectionService_1 = require("./services/whatsappConnectionService");
const whatsappClientManager_1 = require("./services/whatsappClientManager");
const whatsappService_1 = require("./services/whatsappService");
const app = (0, express_1.default)();
// --- Segurança Cibernética ---
app.set("trust proxy", 1); // necessário para rate limit com proxy/nginx
app.use(security_1.securityHeaders);
app.use((_req, res, next) => {
    res.setHeader("Permissions-Policy", "accelerometer=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()");
    next();
});
// Blocklist: estática (BLOCKLIST_IPS) + dinâmica (IPs bloqueados por scan/ataque)
const staticBlocklist = env_1.env.security?.blocklistIps?.length
    ? new Set(env_1.env.security.blocklistIps)
    : new Set();
app.use((0, security_1.ipBlocklistMiddleware)(staticBlocklist));
app.use(requestValidation_1.requestValidationMiddleware);
app.use(hpp_1.hppMiddleware);
app.use(security_1.generalRateLimiter);
app.use((0, cors_1.default)({
    origin: env_1.env.corsOrigin,
    credentials: true,
}));
app.use(express_1.default.json({ limit: security_1.bodySizeLimit }));
app.use(express_1.default.urlencoded({ extended: true, limit: security_1.bodySizeLimit }));
app.use(security_1.sanitizeInput);
/** Rótulos legíveis para logs HTTP (method + path prefix -> nome). Ordem: mais específico primeiro. */
function getHttpLogLabel(method, path) {
    const p = path.split("?")[0];
    const routes = [
        ["POST", "/api/auth/login", "Login"],
        ["POST", "/api/auth/register", "Registro"],
        ["POST", "/api/groups/sync", "Sync grupos"],
        ["GET", "/api/groups", "Listar grupos"],
        ["POST", "/api/campaigns", "Criar campanha"],
        ["GET", "/api/campaigns", "Listar campanhas"],
        ["POST", "/api/campaigns/", "Enviar/pausar campanha"],
        ["DELETE", "/api/campaigns", "Excluir campanha(s)"],
        ["GET", "/api/whatsapp/sessions", "Listar conexões"],
        ["POST", "/api/whatsapp/sessions", "Criar conexão"],
        ["GET", "/api/whatsapp/sessions/", "Status/QR conexão"],
        ["POST", "/api/whatsapp/sessions/", "Restart/disconnect conexão"],
        ["POST", "/api/whatsapp/sync-groups", "Sync grupos (whatsapp)"],
        ["GET", "/api/dashboard", "Dashboard"],
        ["GET", "/api/products", "Listar produtos"],
        ["POST", "/api/products", "Criar produto"],
        ["GET", "/api/invoices", "Listar faturas"],
        ["POST", "/api/invoices", "Pagar fatura"],
        ["GET", "/api/companies", "Empresas"],
        ["GET", "/api/plans", "Planos"],
        ["GET", "/api/subscriptions", "Assinaturas"],
        ["PUT", "/api/subscriptions", "Atualizar assinatura"],
        ["GET", "/api/admin", "Admin"],
        ["POST", "/api/admin", "Admin"],
        ["GET", "/api/settings", "Configurações"],
        ["PUT", "/api/settings", "Configurações"],
        ["GET", "/api/settings/dispatch", "Config disparos"],
        ["PUT", "/api/settings/dispatch", "Config disparos"],
        ["GET", "/api/message-templates", "Templates"],
        ["GET", "/api/template-types", "Tipos de template"],
        ["GET", "/api/webhooks", "Webhooks"],
        ["POST", "/api/webhooks", "Webhook"],
    ];
    for (const [m, prefix, label] of routes) {
        if (m !== method)
            continue;
        const match = prefix.endsWith("/") ? p.startsWith(prefix) : p === prefix || p.startsWith(prefix + "/");
        if (match)
            return label;
    }
    return `${method} ${p}`;
}
/** Captura o body enviado em res.json() para incluir no log de 4xx/5xx. */
app.use((_req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = function (body) {
        if (res.statusCode >= 400 && body && typeof body === "object" && "message" in body && typeof body.message === "string") {
            res.locals._responseMessage = body.message;
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
        if (is4xx && res.statusCode === 404 && (0, scanProtection_1.isScanRequest)(req)) {
            const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
            const { skipLog } = await (0, scanProtection_1.recordScanAttempt)(ip, req.originalUrl || req.path, res.statusCode);
            if (skipLog)
                return; // não loga esta requisição
        }
        const shouldSkip = isHealth || (res.statusCode < 400 && req.method === "GET");
        if (shouldSkip)
            return;
        const scope = "HTTP";
        const label = getHttpLogLabel(req.method, req.originalUrl || req.path);
        const responseMsg = res.locals._responseMessage;
        const detail = responseMsg ? ` — ${responseMsg}` : "";
        const msg = `${label} ${res.statusCode} ${elapsed}ms${detail}`;
        if (res.statusCode >= 500) {
            logger_1.logger.error(scope, msg);
            return;
        }
        if (res.statusCode >= 400) {
            logger_1.logger.warn(scope, msg);
            return;
        }
        logger_1.logger.info(scope, msg);
    });
    next();
});
app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
});
// Pasta base de uploads (pasta da empresa é criada automaticamente no multer)
const uploadsDir = path_1.default.resolve(process.cwd(), "uploads");
if (!fs_1.default.existsSync(uploadsDir))
    fs_1.default.mkdirSync(uploadsDir, { recursive: true });
// arquivos enviados - imagens de produtos e campanhas (estrutura: uploads/{companyId}/)
app.use("/uploads", express_1.default.static(uploadsDir));
// mídias públicas (logotipos, etc) - permite carregar de outro origin (frontend em dev)
const publicDir = path_1.default.resolve(process.cwd(), "public");
app.use("/public", (req, res, next) => {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Access-Control-Allow-Origin", env_1.env.corsOrigin);
    next();
}, express_1.default.static(publicDir));
app.use("/api/auth", auth_1.default);
app.use("/api/whatsapp", whatsapp_1.default);
app.use("/api/admin", adminUsers_1.default);
app.use("/api/campaigns", security_1.sensitiveApiLimiter, campaigns_1.default);
app.use("/api/dashboard", dashboard_1.default);
app.use("/api/products", products_1.default);
app.use("/api/message-templates", messageTemplates_1.default);
app.use("/api/template-types", templateTypes_1.default);
app.use("/api/groups", groups_1.default);
app.use("/api/companies", companies_1.default);
app.use("/api/plans", plans_1.default);
app.use("/api/subscriptions", subscriptions_1.default);
app.use("/api/invoices", invoices_1.default);
app.use("/api/admin-invoices", adminInvoices_1.default);
app.use("/api/settings", settings_1.default);
app.use("/api/webhooks", security_1.sensitiveApiLimiter, webhooks_1.default);
app.use("/api/link-preview", linkPreview_1.default);
app.use(
// eslint-disable-next-line @typescript-eslint/no-unused-vars
(err, _req, res, _next) => {
    if (err.name === "MulterError" && err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ message: "Arquivo muito grande. Logo: até 5 MB; favicon/ícone: até 512 KB." });
        return;
    }
    logger_1.logger.error("API", "Erro interno não tratado", err);
    res.status(500).json({ message: "Erro interno do servidor" });
});
const httpServer = (0, http_1.createServer)(app);
(0, socket_1.setupSocket)(httpServer);
(0, whatsappClientManager_1.onDestroySession)(whatsappService_1.clearGroupsStoreForSession);
httpServer.listen(env_1.env.port, () => {
    logger_1.logger.success("SERVER", `Backend rodando na porta ${env_1.env.port}`);
    (0, queue_1.startQueue)();
    (0, bullmq_1.startWhatsAppQueueWorkers)({
        restart: (sessionId, companyId) => (0, whatsappConnectionService_1.restart)(sessionId, companyId),
        disconnect: (sessionId, companyId) => (0, whatsappConnectionService_1.disconnect)(sessionId, companyId),
        release: (sessionId, companyId) => (0, whatsappConnectionService_1.releasePairing)(sessionId, companyId),
    });
});
