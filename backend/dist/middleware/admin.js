"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminMiddleware = adminMiddleware;
const prismaClient_1 = require("../prismaClient");
async function adminMiddleware(req, res, next) {
    const userId = req.userId;
    if (!userId) {
        return res.status(401).json({ message: "Não autenticado" });
    }
    const user = await prismaClient_1.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !["ADMIN", "SUPERADMIN"].includes(user.role)) {
        return res.status(403).json({ message: "Acesso negado" });
    }
    return next();
}
