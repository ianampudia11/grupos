"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bodySizeLimit = exports.securityHeaders = exports.sensitiveApiLimiter = exports.registerRateLimiter = exports.authRateLimiter = exports.generalRateLimiter = exports.createAuthLimiter = exports.securityLogger = void 0;
exports.sanitizeInput = sanitizeInput;
exports.ipBlocklistMiddleware = ipBlocklistMiddleware;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const helmet_1 = __importDefault(require("helmet"));
const env_1 = require("../config/env");
const securityLogger_1 = require("./securityLogger");
const scanProtection_1 = require("./scanProtection");
// Re-export para uso externo
var securityLogger_2 = require("./securityLogger");
Object.defineProperty(exports, "securityLogger", { enumerable: true, get: function () { return securityLogger_2.securityLogger; } });
var bruteForceProtection_1 = require("./bruteForceProtection");
Object.defineProperty(exports, "createAuthLimiter", { enumerable: true, get: function () { return bruteForceProtection_1.createAuthLimiter; } });
/**
 * Rate limit geral - Anti-DDoS e abuso de API
 * Limita requisições por IP em janela de tempo
 */
exports.generalRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 1 * 60 * 1000, // 1 minuto
    max: env_1.env.security.rateLimitGeneral ?? 100,
    message: { message: "Muitas requisições. Tente novamente em alguns minutos." },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === "/api/health",
    handler: (req, res) => {
        securityLogger_1.securityLogger.logThrottle(req.ip ?? "unknown", req.path);
        res.status(429).json({ message: "Limite de requisições excedido. Tente novamente em 1 minuto." });
    },
});
/**
 * Rate limit estrito para auth - anti brute-force
 */
exports.authRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: env_1.env.security.rateLimitAuth ?? 10,
    message: { message: "Muitas tentativas de login. Aguarde 15 minutos." },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true, // só conta falhas
    handler: (req, res) => {
        securityLogger_1.securityLogger.logBruteForce(req.ip ?? "unknown", "login");
        res.status(429).json({ message: "Bloqueado por segurança. Tente novamente em 15 minutos." });
    },
});
/**
 * Rate limit para registro - anti spam de contas
 */
exports.registerRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 60 * 1000, // 1 hora
    max: env_1.env.security.rateLimitRegister ?? 5,
    message: { message: "Muitos registros. Tente novamente em 1 hora." },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        securityLogger_1.securityLogger.logBruteForce(req.ip ?? "unknown", "register");
        res.status(429).json({ message: "Limite de cadastros excedido. Tente novamente mais tarde." });
    },
});
/**
 * Rate limit para APIs sensíveis (campanhas, webhooks, etc)
 */
exports.sensitiveApiLimiter = (0, express_rate_limit_1.default)({
    windowMs: 1 * 60 * 1000, // 1 minuto
    max: env_1.env.security.rateLimitSensitive ?? 30,
    message: { message: "Limite de operações excedido. Aguarde um momento." },
    standardHeaders: true,
    legacyHeaders: false,
});
/**
 * Configuração Helmet reforçada - headers de segurança
 */
exports.securityHeaders = (0, helmet_1.default)({
    contentSecurityPolicy: env_1.env.nodeEnv === "production",
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: env_1.env.nodeEnv === "production"
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false,
    noSniff: true,
    xssFilter: true,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    frameguard: { action: "deny" },
    ieNoOpen: true,
    permittedCrossDomainPolicies: { permittedPolicies: "none" },
});
/**
 * Middleware de sanitização - remove caracteres perigosos (injeção, XSS)
 */
function sanitizeInput(req, _res, next) {
    if (req.body && typeof req.body === "object") {
        req.body = sanitizeObject(req.body);
    }
    if (req.query && typeof req.query === "object") {
        req.query = sanitizeObject(req.query);
    }
    next();
}
function sanitizeObject(obj, depth = 0) {
    if (depth > 10)
        return obj; // proteção contra objetos circulares profundos
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "string") {
            result[k] = sanitizeString(v);
        }
        else if (v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
            result[k] = sanitizeObject(v, depth + 1);
        }
        else if (Array.isArray(v)) {
            result[k] = v.map((item) => typeof item === "string" ? sanitizeString(item) : item);
        }
        else {
            result[k] = v;
        }
    }
    return result;
}
function sanitizeString(s) {
    return s
        .replace(/\0/g, "")
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/javascript:/gi, "")
        .replace(/vbscript:/gi, "")
        .replace(/data:\s*text\/html/gi, "")
        .replace(/data:\s*image\/svg\+xml/gi, "")
        .replace(/expression\s*\(/gi, "")
        .replace(/on\w+\s*=/gi, "")
        .replace(/<\s*iframe/gi, "")
        .trim();
}
/**
 * Middleware - bloqueia IPs na blocklist estática (env) + dinâmica (scan → Redis/memória)
 */
function ipBlocklistMiddleware(staticBlocklist) {
    return async (req, res, next) => {
        const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
        const normalizedIp = ip.replace(/^::ffff:/, "");
        if (staticBlocklist.has(normalizedIp) || staticBlocklist.has(ip)) {
            securityLogger_1.securityLogger.logBlockedIp(ip);
            return res.status(403).json({ message: "Acesso negado." });
        }
        try {
            if (await (0, scanProtection_1.isInDynamicBlocklist)(ip)) {
                securityLogger_1.securityLogger.logBlockedIp(ip);
                return res.status(403).json({ message: "Acesso negado." });
            }
        }
        catch (_) {
            // falha ao checar Redis: deixa passar
        }
        next();
    };
}
/**
 * Limite de tamanho do body - anti payload grande (DoS)
 */
exports.bodySizeLimit = "2mb";
