"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestValidationMiddleware = requestValidationMiddleware;
const securityLogger_1 = require("./securityLogger");
const SQL_INJECTION_PATTERNS = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|EXEC|EXECUTE)\b)/i,
    /(\bOR\s+['"]?['"]?\s*=\s*['"]?['"]?)/i,
    /(\bAND\s+['"]?['"]?\s*=\s*['"]?['"]?)/i,
    /(--|#|\/\*|\*\/)/,
    /(\bwaitfor\s+delay\b)/i,
    /(\bsleep\s*\(\s*\d+\s*\))/i,
    /\binformation_schema\b/i,
    /\bpg_sleep\b/i,
];
/** NoSQL / MongoDB-style injection (operadores $where, $gt, etc em input) */
const NOSQL_INJECTION_PATTERNS = [
    /\$where\s*:/i,
    /\$gt\s*:\s*['"]?\s*['"]/i,
    /\$ne\s*:\s*null/i,
    /\$regex\s*:/i,
    /\$exists\s*:\s*true/i,
    /\.\s*find\s*\(/i,
    /\.\s*aggregate\s*\(/i,
    /\{\s*\$cond\s*:/i,
];
const PATH_TRAVERSAL_PATTERNS = [/\.\.\//, /\.\.\\/, /%2e%2e%2f/i, /%2e%2e\//i];
function requestValidationMiddleware(req, res, next) {
    const ip = req.ip ?? "unknown";
    // Path traversal
    const path = req.path + (req.url || "");
    if (PATH_TRAVERSAL_PATTERNS.some((p) => p.test(path))) {
        securityLogger_1.securityLogger.logPathTraversal(ip, path);
        return res.status(400).json({ message: "Requisição inválida." });
    }
    // SQL injection em query params
    const qs = JSON.stringify(req.query);
    if (SQL_INJECTION_PATTERNS.some((p) => p.test(qs))) {
        securityLogger_1.securityLogger.logSqlInjectionAttempt(ip, qs);
        return res.status(400).json({ message: "Requisição inválida." });
    }
    // SQL injection em body
    if (req.body && typeof req.body === "object") {
        const bodyStr = JSON.stringify(req.body);
        if (SQL_INJECTION_PATTERNS.some((p) => p.test(bodyStr))) {
            securityLogger_1.securityLogger.logSqlInjectionAttempt(ip, bodyStr);
            return res.status(400).json({ message: "Requisição inválida." });
        }
        if (NOSQL_INJECTION_PATTERNS.some((p) => p.test(bodyStr))) {
            securityLogger_1.securityLogger.logSqlInjectionAttempt(ip, bodyStr);
            return res.status(400).json({ message: "Requisição inválida." });
        }
    }
    // NoSQL em query
    if (NOSQL_INJECTION_PATTERNS.some((p) => p.test(qs))) {
        securityLogger_1.securityLogger.logSqlInjectionAttempt(ip, qs);
        return res.status(400).json({ message: "Requisição inválida." });
    }
    next();
}
