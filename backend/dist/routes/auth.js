"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const authService_1 = require("../services/authService");
const auth_1 = require("../middleware/auth");
const prismaClient_1 = require("../prismaClient");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const security_1 = require("../security");
const securityLogger_1 = require("../security/securityLogger");
const systemSettingService_1 = require("../services/systemSettingService");
const recaptchaService_1 = require("../services/recaptchaService");
const router = (0, express_1.Router)();
const authSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(4),
    recaptchaToken: zod_1.z.string().optional(),
});
async function ensureRecaptcha(req, action) {
    const version = (await (0, systemSettingService_1.getSetting)("recaptcha_version")) || "off";
    if (version !== "v2" && version !== "v3")
        return { ok: true };
    const token = req.body?.recaptchaToken;
    if (!token || typeof token !== "string") {
        return { ok: false, message: "Verificação de segurança (reCAPTCHA) é obrigatória." };
    }
    const secret = version === "v2"
        ? await (0, systemSettingService_1.getSetting)("recaptcha_v2_secret_key")
        : await (0, systemSettingService_1.getSetting)("recaptcha_v3_secret_key");
    if (!secret)
        return { ok: true };
    const result = await (0, recaptchaService_1.verifyRecaptcha)(token, secret, {
        expectedAction: action,
        minScore: version === "v3" ? 0.5 : undefined,
    });
    if (!result.ok)
        return { ok: false, message: result.error || "Verificação de segurança falhou." };
    return { ok: true };
}
router.post("/register", security_1.registerRateLimiter, async (req, res) => {
    try {
        const recaptchaCheck = await ensureRecaptcha(req, "register");
        if (!recaptchaCheck.ok)
            return res.status(400).json({ message: recaptchaCheck.message });
        const schema = zod_1.z.object({
            email: zod_1.z.string().email(),
            password: zod_1.z.string().min(6),
            name: zod_1.z.string().optional(),
            companyName: zod_1.z.string().min(2, "Nome da empresa é obrigatório"),
            planId: zod_1.z.string().min(1, "Selecione um plano"),
        });
        const data = schema.parse(req.body);
        const user = await (0, authService_1.registerUser)(data);
        return res.status(201).json({
            id: user.id,
            email: user.email,
            company: user.company ? { id: user.company.id, name: user.company.name } : null,
        });
    }
    catch (err) {
        return res.status(400).json({ message: err.message || "Erro ao registrar" });
    }
});
router.post("/login", security_1.authRateLimiter, async (req, res) => {
    try {
        const recaptchaCheck = await ensureRecaptcha(req, "login");
        if (!recaptchaCheck.ok)
            return res.status(400).json({ message: recaptchaCheck.message });
        const { email, password } = authSchema.parse(req.body);
        const { user, token } = await (0, authService_1.loginUser)(email, password);
        return res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                companyId: user.companyId,
                company: user.company,
            },
        });
    }
    catch (err) {
        const email = req.body?.email ?? "?";
        securityLogger_1.securityLogger.logAuthFailure(req.ip ?? "unknown", email);
        return res.status(401).json({ message: err.message || "Erro ao autenticar" });
    }
});
router.post("/bootstrap-admin", security_1.registerRateLimiter, async (req, res) => {
    try {
        const schema = zod_1.z.object({
            name: zod_1.z.string().min(2).optional(),
            email: zod_1.z.string().email(),
            password: zod_1.z.string().min(6),
        });
        const { email, password, name } = schema.parse(req.body);
        const user = await (0, authService_1.bootstrapAdmin)(email, password, name);
        return res.status(201).json({ id: user.id, email: user.email, role: user.role });
    }
    catch (err) {
        return res.status(400).json({ message: err.message || "Erro no bootstrap" });
    }
});
router.get("/me", auth_1.authMiddleware, async (req, res) => {
    const userId = req.userId;
    const user = await prismaClient_1.prisma.user.findUnique({
        where: { id: userId },
        include: {
            company: {
                include: { subscription: { include: { plan: true } } },
            },
        },
    });
    if (!user)
        return res.status(404).json({ message: "Usuário não encontrado" });
    if (user.companyId && user.company?.isActive === false) {
        return res.status(403).json({ message: "Empresa desativada. Entre em contato com o suporte." });
    }
    const sub = user.company?.subscription;
    const trialEndsAt = sub?.trialEndsAt ?? null;
    const now = new Date();
    const isTrialExpired = trialEndsAt != null && now > trialEndsAt;
    const hasActivePaidAccess = sub && sub.currentPeriodEnd > now && (trialEndsAt == null || !isTrialExpired);
    const menuPermissions = user.menuPermissions;
    return res.json({
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        companyId: user.companyId,
        menuPermissions: Array.isArray(menuPermissions) ? menuPermissions : null,
        company: user.company
            ? {
                id: user.company.id,
                name: user.company.name,
                slug: user.company.slug,
            }
            : null,
        subscription: sub
            ? {
                trialEndsAt: trialEndsAt?.toISOString() ?? null,
                isTrialExpired,
                hasActivePaidAccess: !!hasActivePaidAccess,
                currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
                billingDay: sub.billingDay,
            }
            : null,
    });
});
router.put("/me", auth_1.authMiddleware, async (req, res) => {
    try {
        const userId = req.userId;
        const schema = zod_1.z.object({
            name: zod_1.z.string().min(2).optional(),
            email: zod_1.z.string().email().optional(),
            password: zod_1.z.string().min(6).optional(),
        });
        const data = schema.parse(req.body);
        const current = await prismaClient_1.prisma.user.findUnique({ where: { id: userId } });
        if (!current)
            return res.status(404).json({ message: "Usuário não encontrado" });
        if (data.email && data.email !== current.email) {
            const exists = await prismaClient_1.prisma.user.findUnique({ where: { email: data.email } });
            if (exists)
                return res.status(400).json({ message: "E-mail já cadastrado" });
        }
        const update = {};
        if (data.name !== undefined)
            update.name = data.name;
        if (data.email !== undefined)
            update.email = data.email;
        if (data.password)
            update.passwordHash = await bcryptjs_1.default.hash(data.password, 10);
        const user = await prismaClient_1.prisma.user.update({
            where: { id: userId },
            data: update,
            include: { company: true },
        });
        return res.json({
            id: user.id,
            email: user.email,
            role: user.role,
            name: user.name,
            companyId: user.companyId,
            company: user.company
                ? { id: user.company.id, name: user.company.name, slug: user.company.slug }
                : null,
        });
    }
    catch (err) {
        return res.status(400).json({ message: err.message || "Erro ao atualizar perfil" });
    }
});
exports.default = router;
