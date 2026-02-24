"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prismaClient_1 = require("../prismaClient");
const logger_1 = require("../utils/logger");
async function getOrCreateSistemaCompany() {
    let company = await prismaClient_1.prisma.company.findUnique({
        where: { slug: "sistema-administrativo" },
    });
    if (company)
        return company.id;
    const plan = await prismaClient_1.prisma.plan.findFirst({
        where: { slug: "vitalicio" },
    }) ?? await prismaClient_1.prisma.plan.create({
        data: { name: "Vitalício", slug: "vitalicio", price: 0, limits: {} },
    });
    const now = new Date();
    const periodEnd = new Date("2093-12-31");
    company = await prismaClient_1.prisma.company.create({
        data: {
            id: "company-superadmin-sistema",
            name: "Sistema Administrativo",
            slug: "sistema-administrativo",
            isActive: true,
        },
    });
    await prismaClient_1.prisma.subscription.create({
        data: {
            companyId: company.id,
            planId: plan.id,
            status: "active",
            billingDay: 1,
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
        },
    });
    return company.id;
}
async function run() {
    const email = (process.env.ADMIN_EMAIL || "admin@admin.com").trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD || "123456";
    const name = (process.env.ADMIN_NAME || "Administrador").trim();
    if (password.length < 6) {
        throw new Error("ADMIN_PASSWORD precisa ter pelo menos 6 caracteres.");
    }
    const sistemaCompanyId = await getOrCreateSistemaCompany();
    const existing = await prismaClient_1.prisma.user.findUnique({ where: { email } });
    if (existing) {
        if (existing.role !== "SUPERADMIN") {
            await prismaClient_1.prisma.user.update({
                where: { id: existing.id },
                data: {
                    role: "SUPERADMIN",
                    name: existing.name ?? name,
                    companyId: sistemaCompanyId,
                },
            });
            logger_1.logger.success("SEED", `Usuario promovido para SUPERADMIN: ${email}`);
            return;
        }
        if (!existing.companyId || existing.companyId !== sistemaCompanyId) {
            await prismaClient_1.prisma.user.update({
                where: { id: existing.id },
                data: { companyId: sistemaCompanyId },
            });
            logger_1.logger.success("SEED", `Admin vinculado a Sistema Administrativo: ${email}`);
        }
        logger_1.logger.info("SEED", `Admin ja existe: ${email}`);
        return;
    }
    const passwordHash = await bcryptjs_1.default.hash(password, 10);
    await prismaClient_1.prisma.user.create({
        data: {
            email,
            name,
            passwordHash,
            role: "SUPERADMIN",
            companyId: sistemaCompanyId,
        },
    });
    logger_1.logger.success("SEED", `Admin criado: ${email}`);
}
run()
    .catch((err) => {
    logger_1.logger.error("SEED", "Falha ao criar admin inicial", err);
    process.exit(1);
})
    .finally(async () => {
    await prismaClient_1.prisma.$disconnect();
});
