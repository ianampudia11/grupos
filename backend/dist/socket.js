"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupSocket = setupSocket;
const socket_io_1 = require("socket.io");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prismaClient_1 = require("./prismaClient");
const whatsappClientManager_1 = require("./services/whatsappClientManager");
const env_1 = require("./config/env");
const socketIo_1 = require("./socketIo");
const jwtSecret = env_1.env.jwtSecret;
function setupSocket(httpServer) {
    const io = new socket_io_1.Server(httpServer, {
        cors: { origin: env_1.env.corsOrigin, credentials: true },
        path: "/socket.io",
    });
    io.on("connection", (socket) => {
        const token = socket.handshake.auth?.token ||
            socket.handshake.headers?.authorization?.replace("Bearer ", "");
        if (!token) {
            socket.disconnect(true);
            return;
        }
        let userId;
        try {
            const decoded = jsonwebtoken_1.default.verify(token, jwtSecret);
            const rawId = decoded.sub ?? decoded.userId;
            if (typeof rawId !== "string" || !rawId) {
                socket.disconnect(true);
                return;
            }
            userId = rawId;
        }
        catch {
            socket.disconnect(true);
            return;
        }
        socket.data.userId = userId;
        // Join company room so we can emit invoice:paid to all users of the company
        (async () => {
            const user = await prismaClient_1.prisma.user.findUnique({
                where: { id: userId },
                select: { companyId: true },
            });
            if (user?.companyId) {
                socket.join(`company:${user.companyId}`);
            }
        })();
        socket.on("join_session", async (sessionId, cb) => {
            if (typeof sessionId !== "string" || !sessionId.trim()) {
                cb?.(false);
                return;
            }
            const user = await prismaClient_1.prisma.user.findUnique({
                where: { id: userId },
                select: { companyId: true },
            });
            const companyId = user?.companyId;
            if (!companyId) {
                cb?.(false);
                return;
            }
            const session = await prismaClient_1.prisma.whatsappSession.findFirst({
                where: { id: sessionId.trim(), companyId },
            });
            if (!session) {
                cb?.(false);
                return;
            }
            socket.join(`session:${sessionId}`);
            cb?.(true);
        });
        socket.on("leave_session", (sessionId) => {
            if (typeof sessionId === "string") {
                socket.leave(`session:${sessionId}`);
            }
        });
    });
    (0, whatsappClientManager_1.setWhatsappEventEmitter)((event, sessionId, data) => {
        const payload = data && typeof data === "object" && !Array.isArray(data) && data !== null
            ? { sessionId, ...data }
            : { sessionId };
        io.to(`session:${sessionId}`).emit(`whatsapp:${event}`, payload);
    });
    (0, socketIo_1.setSocketIo)(io);
    return io;
}
