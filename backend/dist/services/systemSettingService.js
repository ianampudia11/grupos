"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSetting = getSetting;
exports.setSetting = setSetting;
const prismaClient_1 = require("../prismaClient");
async function getSetting(key) {
    const row = await prismaClient_1.prisma.systemSetting.findUnique({
        where: { key },
        select: { value: true },
    });
    return row?.value ?? null;
}
async function setSetting(key, value) {
    await prismaClient_1.prisma.systemSetting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
    });
}
