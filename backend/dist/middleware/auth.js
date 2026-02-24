"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = authMiddleware;
exports.enrichAuth = enrichAuth;
exports.superAdminMiddleware = superAdminMiddleware;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = require("../config/env");
const prismaClient_1 = require("../prismaClient");
const securityLogger_1 = require("../security/securityLogger");
function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ message: "Token não enviado" });
    }
    const [, token] = authHeader.split(" ");
    try {
        const decoded = jsonwebtoken_1.default.verify(token, env_1.env.jwtSecret);
        req.userId = decoded.sub;
        req.userRole = decoded.role;
        req.companyId = decoded.companyId ?? null;
        return next();
    }
    catch {
        securityLogger_1.securityLogger.logInvalidToken(req.ip ?? "unknown", req.path);
        return res.status(401).json({ message: "Token inválido" });
    }
}
/** Enriquecer req com dados frescos do usuário (role, companyId) */
async function enrichAuth(req) {
    if (!req.userId)
        return;
    const user = await prismaClient_1.prisma.user.findUnique({
        where: { id: req.userId },
        select: { role: true, companyId: true },
    });
    if (user) {
        req.userRole = user.role;
        req.companyId = user.companyId;
        if (user.role === "SUPERADMIN" && !user.companyId) {
            const sist = await prismaClient_1.prisma.company.findFirst({
                where: { slug: "sistema-administrativo" },
                select: { id: true },
            });
            if (sist)
                req.companyId = sist.id;
        }
    }
} /** Apenas SuperAdmin */
function superAdminMiddleware(req, res, next) {
    (async () => {
        try {
            if (req.userRole === "SUPERADMIN")
                return next();
            if (req.userId) {
                const user = await prismaClient_1.prisma.user.findUnique({
                    where: { id: req.userId },
                    select: { role: true },
                });
                if (user?.role === "SUPERADMIN")
                    return next();
            }
            res.status(403).json({ message: "Acesso restrito ao SuperAdmin" });
        }
        catch (e) {
            next(e);
        }
    })();
}
