"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const auth_1 = require("../middleware/auth");
const admin_1 = require("../middleware/admin");
const prismaClient_1 = require("../prismaClient");
const menuPermissions_1 = require("../constants/menuPermissions");
const router = (0, express_1.Router)();
router.use(auth_1.authMiddleware);
router.use(admin_1.adminMiddleware);
router.get("/menu-keys", (_req, res) => {
    res.json({ menuKeys: menuPermissions_1.MENU_KEYS });
});
router.get("/users", async (req, res) => {
    const me = await prismaClient_1.prisma.user.findUnique({
        where: { id: req.userId },
        select: { role: true, companyId: true },
    });
    const companyIdParam = typeof req.query.companyId === "string" ? req.query.companyId : undefined;
    let where = me?.role === "SUPERADMIN"
        ? companyIdParam
            ? { companyId: companyIdParam }
            : {}
        : { companyId: me?.companyId ?? "none" };
    const users = await prismaClient_1.prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        select: { id: true, email: true, name: true, role: true, companyId: true, menuPermissions: true, createdAt: true },
    });
    res.json(users);
});
router.post("/users", async (req, res) => {
    try {
        const schema = zod_1.z.object({
            name: zod_1.z.string().min(2).optional(),
            email: zod_1.z.string().email(),
            password: zod_1.z.string().min(6),
            role: zod_1.z.enum(["ADMIN", "SUPERVISOR", "USER"]).default("USER"),
            companyId: zod_1.z.string().nullable().optional(),
            menuPermissions: zod_1.z.array(zod_1.z.string()).optional(),
        });
        const { email, password, role, name, companyId, menuPermissions } = schema.parse(req.body);
        const me = await prismaClient_1.prisma.user.findUnique({
            where: { id: req.userId },
            select: { role: true, companyId: true },
        });
        const targetCompanyId = me?.role === "SUPERADMIN" ? companyId ?? me?.companyId : me?.companyId;
        if (me?.role !== "SUPERADMIN" && !targetCompanyId) {
            return res.status(400).json({ message: "Usuário precisa estar em uma empresa" });
        }
        if (me?.role === "ADMIN" && role === "ADMIN") {
            return res.status(400).json({ message: "Apenas SuperAdmin pode criar outros administradores." });
        }
        const existing = await prismaClient_1.prisma.user.findUnique({ where: { email } });
        if (existing)
            return res.status(400).json({ message: "E-mail já cadastrado" });
        if (targetCompanyId) {
            const { assertWithinLimit } = await Promise.resolve().then(() => __importStar(require("../services/planLimitsService")));
            await assertWithinLimit(targetCompanyId, "users");
        }
        const validMenuPerms = menuPermissions?.filter((k) => menuPermissions_1.MENU_KEYS_LIST.includes(k));
        const passwordHash = await bcryptjs_1.default.hash(password, 10);
        const user = await prismaClient_1.prisma.user.create({
            data: {
                email,
                passwordHash,
                role,
                name,
                companyId: targetCompanyId ?? undefined,
                menuPermissions: validMenuPerms?.length ? validMenuPerms : undefined,
            },
            select: { id: true, email: true, name: true, role: true, companyId: true, menuPermissions: true, createdAt: true },
        });
        res.status(201).json(user);
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao criar usuário" });
    }
});
router.put("/users/:id", async (req, res) => {
    try {
        const me = await prismaClient_1.prisma.user.findUnique({
            where: { id: req.userId },
            select: { role: true, companyId: true },
        });
        const target = await prismaClient_1.prisma.user.findUnique({
            where: { id: req.params.id },
            select: { companyId: true, role: true },
        });
        if (!target)
            return res.status(404).json({ message: "Usuário não encontrado" });
        if (me?.role === "ADMIN" && target.companyId !== me?.companyId) {
            return res.status(403).json({ message: "Sem permissão para editar este usuário." });
        }
        const schema = zod_1.z.object({
            name: zod_1.z.string().min(2).nullable().optional(),
            email: zod_1.z.string().email().optional(),
            password: zod_1.z.string().min(6).optional(),
            role: zod_1.z.enum(["ADMIN", "SUPERVISOR", "USER"]).optional(),
            menuPermissions: zod_1.z.array(zod_1.z.string()).nullable().optional(),
        });
        const data = schema.parse(req.body);
        if (me?.role === "ADMIN" && data.role === "ADMIN") {
            return res.status(400).json({ message: "Apenas SuperAdmin pode promover a administrador." });
        }
        const update = {};
        if (data.name !== undefined)
            update.name = data.name;
        if (data.email !== undefined)
            update.email = data.email;
        if (data.role !== undefined)
            update.role = data.role;
        if (data.password)
            update.passwordHash = await bcryptjs_1.default.hash(data.password, 10);
        if (data.menuPermissions !== undefined) {
            update.menuPermissions =
                data.menuPermissions === null || !data.menuPermissions?.length
                    ? null
                    : data.menuPermissions.filter((k) => menuPermissions_1.MENU_KEYS_LIST.includes(k));
        }
        const user = await prismaClient_1.prisma.user.update({
            where: { id: req.params.id },
            data: update,
            select: { id: true, email: true, name: true, role: true, companyId: true, menuPermissions: true, createdAt: true },
        });
        res.json(user);
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao atualizar usuário" });
    }
});
router.delete("/users/:id", async (req, res) => {
    try {
        const me = await prismaClient_1.prisma.user.findUnique({
            where: { id: req.userId },
            select: { role: true, companyId: true },
        });
        const target = await prismaClient_1.prisma.user.findUnique({
            where: { id: req.params.id },
            select: { companyId: true },
        });
        if (!target)
            return res.status(404).json({ message: "Usuário não encontrado" });
        if (me?.role === "ADMIN" && target.companyId !== me?.companyId) {
            return res.status(403).json({ message: "Sem permissão para remover este usuário." });
        }
        await prismaClient_1.prisma.user.delete({ where: { id: req.params.id } });
        res.json({ ok: true });
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao remover usuário" });
    }
});
exports.default = router;
