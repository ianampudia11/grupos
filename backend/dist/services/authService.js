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
exports.registerUser = registerUser;
exports.loginUser = loginUser;
exports.bootstrapAdmin = bootstrapAdmin;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prismaClient_1 = require("../prismaClient");
const env_1 = require("../config/env");
async function registerUser(data) {
    const existing = await prismaClient_1.prisma.user.findUnique({ where: { email: data.email } });
    if (existing) {
        throw new Error("E-mail já cadastrado");
    }
    const slug = data.companyName
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-");
    if (!slug)
        throw new Error("Nome da empresa inválido");
    const existingSlug = await prismaClient_1.prisma.company.findUnique({ where: { slug } });
    if (existingSlug) {
        throw new Error("Já existe uma empresa com esse nome. Use um nome diferente.");
    }
    const plan = await prismaClient_1.prisma.plan.findFirst({
        where: { id: data.planId, isActive: true },
    });
    if (!plan) {
        throw new Error("Plano inválido ou inativo");
    }
    const passwordHash = await bcryptjs_1.default.hash(data.password, 10);
    const { getSetting } = await Promise.resolve().then(() => __importStar(require("./systemSettingService")));
    const trialDays = parseInt((await getSetting("trial_days")) || "0", 10) || 0;
    const now = new Date();
    const billingDay = Math.min(28, Math.max(1, now.getDate()));
    const trialEndsAt = trialDays > 0 ? new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000) : null;
    // Durante o trial: currentPeriodEnd = fim do trial. Após pagar, webhook renova para o mês seguinte.
    const periodEnd = trialEndsAt ?? new Date(now.getFullYear(), now.getMonth() + 1, billingDay);
    const [user] = await prismaClient_1.prisma.$transaction([
        prismaClient_1.prisma.user.create({
            data: {
                email: data.email,
                name: data.name,
                passwordHash,
                role: "ADMIN",
                company: {
                    create: {
                        name: data.companyName,
                        slug,
                        email: data.email,
                        subscription: {
                            create: {
                                planId: plan.id,
                                billingDay,
                                currentPeriodStart: now,
                                currentPeriodEnd: periodEnd,
                                trialEndsAt,
                            },
                        },
                        whatsappSessions: {
                            create: { name: "Conexão Principal", isDefault: true },
                        },
                    },
                },
            },
            include: { company: { include: { subscription: { include: { plan: true } } } } },
        }),
    ]);
    // Cria fatura inicial para o cliente poder pagar quando o trial acabar
    if (trialEndsAt && user.company?.subscription) {
        const dueDate = new Date(trialEndsAt);
        dueDate.setDate(dueDate.getDate() + 2); // 2 dias após fim do trial para pagar
        await prismaClient_1.prisma.invoice.create({
            data: {
                companyId: user.company.id,
                subscriptionId: user.company.subscription.id,
                amount: plan.price,
                status: "pending",
                dueDate,
            },
        });
    }
    return user;
}
async function loginUser(email, password) {
    const user = await prismaClient_1.prisma.user.findUnique({
        where: { email },
        include: { company: true },
    });
    if (!user) {
        throw new Error("Credenciais inválidas");
    }
    const isValid = await bcryptjs_1.default.compare(password, user.passwordHash);
    if (!isValid) {
        throw new Error("Credenciais inválidas");
    }
    if (user.companyId && user.company && user.company.isActive === false) {
        throw new Error("Empresa desativada. Entre em contato com o suporte.");
    }
    if (user.role === "SUPERADMIN" && !user.companyId) {
        const sist = await prismaClient_1.prisma.company.findFirst({
            where: { slug: "sistema-administrativo" },
        });
        if (sist) {
            await prismaClient_1.prisma.user.update({
                where: { id: user.id },
                data: { companyId: sist.id },
            });
            user.companyId = sist.id;
            user.company = sist;
        }
    }
    const token = jsonwebtoken_1.default.sign({
        sub: user.id,
        email: user.email,
        role: user.role,
        companyId: user.companyId ?? undefined,
    }, env_1.env.jwtSecret, { expiresIn: "7d" });
    return {
        user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            companyId: user.companyId,
            company: user.company
                ? { id: user.company.id, name: user.company.name, slug: user.company.slug }
                : null,
        },
        token,
    };
}
async function bootstrapAdmin(email, password, name) {
    const count = await prismaClient_1.prisma.user.count();
    if (count > 0) {
        throw new Error("Bootstrap já foi executado");
    }
    let sistemCompany = await prismaClient_1.prisma.company.findFirst({
        where: { slug: "sistema-administrativo" },
    });
    if (!sistemCompany) {
        const plan = await prismaClient_1.prisma.plan.findFirst({ where: { slug: "vitalicio" } })
            ?? await prismaClient_1.prisma.plan.create({ data: { name: "Vitalício", slug: "vitalicio", price: 0, limits: {} } });
        sistemCompany = await prismaClient_1.prisma.company.create({
            data: {
                id: "company-superadmin-sistema",
                name: "Sistema Administrativo",
                slug: "sistema-administrativo",
                isActive: true,
            },
        });
        await prismaClient_1.prisma.subscription.create({
            data: {
                companyId: sistemCompany.id,
                planId: plan.id,
                status: "active",
                billingDay: 1,
                currentPeriodStart: new Date(),
                currentPeriodEnd: new Date("2093-12-31"),
            },
        });
    }
    const passwordHash = await bcryptjs_1.default.hash(password, 10);
    const user = await prismaClient_1.prisma.user.create({
        data: {
            email,
            passwordHash,
            role: "SUPERADMIN",
            name: name ?? "Super Admin",
            companyId: sistemCompany.id,
        },
    });
    return user;
}
