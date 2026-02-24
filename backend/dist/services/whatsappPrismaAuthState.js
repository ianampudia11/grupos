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
Object.defineProperty(exports, "__esModule", { value: true });
exports.usePrismaAuthState = usePrismaAuthState;
exports.clearPrismaAuthState = clearPrismaAuthState;
/**
 * Auth state do Baileys/libzapitu persistido no Postgres via Prisma.
 * Substitui useMultiFileAuthState (pasta baileys_auth).
 */
const prismaClient_1 = require("../prismaClient");
const db = prismaClient_1.prisma;
/** Serialização de Buffer em JSON (compatível com Baileys). */
const BufferJSON = {
    replacer: (_k, v) => {
        if (Buffer.isBuffer(v)) {
            return { type: "Buffer", data: Array.from(v) };
        }
        return v;
    },
    reviver: (_k, v) => {
        if (v && typeof v === "object" && "type" in v && v.type === "Buffer" && "data" in v) {
            return Buffer.from(v.data);
        }
        return v;
    },
};
function fixFileName(file) {
    if (!file)
        return null;
    return file.replace(/\//g, "__").replace(/:/g, "-");
}
/**
 * Retorna estado de autenticação e saveCreds usando a tabela WhatsappAuthState.
 * Interface compatível com useMultiFileAuthState para makeWASocket({ auth: state }).
 */
async function usePrismaAuthState(sessionId) {
    const writeData = async (data, file) => {
        const key = fixFileName(file) ?? file;
        const value = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
        await db.whatsappAuthState.upsert({
            where: { sessionId_key: { sessionId, key } },
            create: { sessionId, key, value },
            update: { value },
        });
    };
    const readData = async (file) => {
        const key = fixFileName(file) ?? file;
        const row = await db.whatsappAuthState.findUnique({
            where: { sessionId_key: { sessionId, key } },
        });
        if (!row || row.value == null)
            return null;
        return JSON.parse(JSON.stringify(row.value), BufferJSON.reviver);
    };
    const removeData = async (file) => {
        const key = fixFileName(file) ?? file;
        await db.whatsappAuthState.deleteMany({
            where: { sessionId, key },
        });
    };
    const { initAuthCreds, proto } = await Promise.resolve().then(() => __importStar(require("libzapitu-rf")));
    const creds = (await readData("creds.json")) || initAuthCreds();
    const state = {
        creds,
        keys: {
            get: async (type, ids) => {
                const data = {};
                await Promise.all(ids.map(async (id) => {
                    let value = await readData(`${type}-${id}.json`);
                    if (type === "app-state-sync-key" && value && proto?.Message?.AppStateSyncKeyData) {
                        value = proto.Message.AppStateSyncKeyData.fromObject(value);
                    }
                    data[id] = value;
                }));
                return data;
            },
            set: async (data) => {
                const tasks = [];
                for (const category of Object.keys(data)) {
                    for (const id of Object.keys(data[category])) {
                        const value = data[category][id];
                        const file = `${category}-${id}.json`;
                        tasks.push(value ? writeData(value, file) : removeData(file));
                    }
                }
                await Promise.all(tasks);
            },
        },
    };
    const saveCreds = async () => {
        await writeData(creds, "creds.json");
    };
    return { state, saveCreds };
}
/** Remove todo o estado de autenticação de uma sessão (ex.: ao fazer logout). */
async function clearPrismaAuthState(sessionId) {
    await db.whatsappAuthState.deleteMany({ where: { sessionId } });
}
