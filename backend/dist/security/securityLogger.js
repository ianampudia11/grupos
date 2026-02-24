"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.securityLogger = void 0;
/**
 * Logger de eventos de segurança - auditoria e detecção de ataques.
 * Nunca loga dados sensíveis em claro (emails completos, tokens, payloads).
 */
const logger_1 = require("../utils/logger");
const SECURITY_SCOPE = "SECURITY";
function maskEmail(email) {
    if (!email || typeof email !== "string")
        return "?";
    const at = email.indexOf("@");
    if (at <= 0)
        return "***";
    const local = email.slice(0, at);
    const domain = email.slice(at + 1);
    const maskedLocal = local.length <= 2 ? "**" : local[0] + "***" + local[local.length - 1];
    const maskedDomain = domain.length <= 2 ? "**" : domain[0] + "***." + (domain.split(".").pop() ?? "");
    return `${maskedLocal}@${maskedDomain}`;
}
function truncateForLog(payload, max = 80) {
    if (!payload || typeof payload !== "string")
        return "";
    const cleaned = payload.replace(/\s+/g, " ").trim();
    return cleaned.length <= max ? cleaned : cleaned.slice(0, max) + "...";
}
exports.securityLogger = {
    logBruteForce(ip, type) {
        logger_1.logger.warn(SECURITY_SCOPE, `[BRUTE-FORCE] IP=${ip} type=${type}`);
    },
    logThrottle(ip, path) {
        logger_1.logger.warn(SECURITY_SCOPE, `[THROTTLE] IP=${ip} path=${path}`);
    },
    logBlockedIp(ip) {
        logger_1.logger.warn(SECURITY_SCOPE, `[BLOCKED] IP=${ip}`);
    },
    logSuspicious(req, reason) {
        logger_1.logger.warn(SECURITY_SCOPE, `[SUSPICIOUS] IP=${req.ip ?? "?"} path=${req.path} method=${req.method} reason=${reason}`);
    },
    logAuthFailure(ip, email) {
        logger_1.logger.warn(SECURITY_SCOPE, `[AUTH-FAIL] IP=${ip} email=${maskEmail(email)}`);
    },
    logInvalidToken(ip, path) {
        logger_1.logger.warn(SECURITY_SCOPE, `[INVALID-TOKEN] IP=${ip} path=${path}`);
    },
    logSqlInjectionAttempt(ip, payload) {
        logger_1.logger.error(SECURITY_SCOPE, `[SQL-INJECTION] IP=${ip} payload=${truncateForLog(payload, 80)}`);
    },
    logPathTraversal(ip, path) {
        logger_1.logger.warn(SECURITY_SCOPE, `[PATH-TRAVERSAL] IP=${ip} path=${truncateForLog(path, 100)}`);
    },
};
