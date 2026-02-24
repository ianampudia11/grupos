"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const COLORS = {
    INFO: "\x1b[36m",
    WARN: "\x1b[33m",
    ERROR: "\x1b[31m",
    SUCCESS: "\x1b[32m",
    DEBUG: "\x1b[90m",
};
const RESET = "\x1b[0m";
const now = () => new Date().toISOString();
const isProduction = process.env.NODE_ENV === "production";
/** Níveis habilitados (carregado uma vez; use LOG_LEVEL no .env). */
function enabledLevels() {
    const raw = process.env.LOG_LEVEL?.trim();
    if (!raw) {
        return new Set(isProduction ? ["WARN", "SUCCESS", "ERROR"] : ["INFO", "WARN", "ERROR", "SUCCESS"]);
    }
    const list = raw.split(",").map((s) => s.trim().toUpperCase());
    return new Set(list);
}
let _cachedLevels = null;
function isLevelEnabled(level) {
    if (!_cachedLevels)
        _cachedLevels = enabledLevels();
    return _cachedLevels.has(level);
}
/** Evita vazamento de stack e dados sensíveis em logs (produção) */
function safeMeta(meta) {
    if (meta === undefined)
        return undefined;
    if (isProduction && meta instanceof Error) {
        return { name: meta.name, message: meta.message };
    }
    return meta;
}
function write(level, scope, message, meta) {
    if (!isLevelEnabled(level))
        return;
    const color = COLORS[level];
    const prefix = `${color}[${now()}] [${level}] [${scope}]${RESET}`;
    const safe = safeMeta(meta);
    if (safe === undefined) {
        console.log(`${prefix} ${message}`);
        return;
    }
    console.log(`${prefix} ${message}`, safe);
}
exports.logger = {
    info: (scope, message, meta) => write("INFO", scope, message, meta),
    warn: (scope, message, meta) => write("WARN", scope, message, meta),
    error: (scope, message, meta) => write("ERROR", scope, message, meta),
    success: (scope, message, meta) => write("SUCCESS", scope, message, meta),
    debug: (scope, message, meta) => write("DEBUG", scope, message, meta),
};
