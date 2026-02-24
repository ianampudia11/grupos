"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAuthLimiter = createAuthLimiter;
/**
 * Proteção contra brute-force em endpoints de autenticação
 */
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const securityLogger_1 = require("./securityLogger");
const env_1 = require("../config/env");
function createAuthLimiter() {
    return (0, express_rate_limit_1.default)({
        windowMs: 15 * 60 * 1000,
        max: env_1.env.security.rateLimitAuth ?? 10,
        message: { message: "Muitas tentativas. Aguarde 15 minutos." },
        standardHeaders: true,
        legacyHeaders: false,
        skipSuccessfulRequests: true,
        keyGenerator: (req) => {
            const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
            const email = req.body?.email ?? "";
            return `${ip}:${email.toLowerCase()}`;
        },
        handler: (req, res) => {
            securityLogger_1.securityLogger.logBruteForce(req.ip ?? "unknown", "login");
            res.status(429).json({ message: "Bloqueado por segurança. Tente novamente em 15 minutos." });
        },
    });
}
