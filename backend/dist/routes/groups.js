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
const multer_1 = __importDefault(require("multer"));
const XLSX = __importStar(require("xlsx"));
const auth_1 = require("../middleware/auth");
const prismaClient_1 = require("../prismaClient");
const whatsappService_1 = require("../services/whatsappService");
const planLimitsService_1 = require("../services/planLimitsService");
const logger_1 = require("../utils/logger");
const router = (0, express_1.Router)();
router.use(auth_1.authMiddleware);
router.use(async (req, _res, next) => {
    await (0, auth_1.enrichAuth)(req);
    next();
});
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (_req, file, cb) => {
        const ok = /\.(csv|xlsx?)$/i.test(file.originalname);
        cb(null, !!ok);
    },
});
/** Lista todos os grupos com dados completos */
router.get("/", async (req, res) => {
    try {
        const companyId = requireCompany(req);
        const groups = await (0, whatsappService_1.listGroupsFull)(companyId);
        res.json(groups);
    }
    catch (err) {
        res.status(400).json({ message: err?.message ?? "Erro ao listar grupos" });
    }
});
/** Sincroniza grupos do WhatsApp e atualiza fotos/participantes */
router.post("/sync", async (req, res) => {
    try {
        const companyId = requireCompany(req);
        await (0, whatsappService_1.fetchGroupsFromRemote)(companyId);
        const groups = await (0, whatsappService_1.listGroupsFull)(companyId);
        res.json(groups);
    }
    catch (err) {
        const message = err?.message ?? "Erro ao sincronizar";
        logger_1.logger.warn("GROUPS", `POST /sync 400: ${message}`);
        res.status(400).json({ message });
    }
});
/** Exporta grupos em CSV */
router.get("/export", async (req, res) => {
    try {
        const companyId = requireCompany(req);
        const groups = await (0, whatsappService_1.listGroupsFull)(companyId);
        const header = "waId;nome;participantes;fonte\n";
        const rows = groups
            .map((g) => `${escapeCsv(g.waId)};${escapeCsv(g.name)};${g.participantCount ?? ""};${g.source}`)
            .join("\n");
        const csv = "\uFEFF" + header + rows; // BOM para Excel
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", "attachment; filename=grupos.csv");
        res.send(csv);
    }
    catch (err) {
        res.status(400).json({ message: err?.message ?? "Erro ao exportar" });
    }
});
function escapeCsv(s) {
    if (/[;"\n]/.test(s))
        return `"${s.replace(/"/g, '""')}"`;
    return s;
}
function requireCompany(req) {
    const companyId = req.companyId;
    if (!companyId)
        throw new Error("Usuário precisa estar vinculado a uma empresa.");
    return companyId;
}
/** Importa grupos de CSV ou Excel */
router.post("/import", upload.single("file"), async (req, res) => {
    try {
        const companyId = requireCompany(req);
        const file = req.file;
        if (!file?.buffer) {
            return res.status(400).json({ message: "Nenhum arquivo enviado" });
        }
        const session = await prismaClient_1.prisma.whatsappSession.findFirst({
            where: { companyId },
            orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        });
        if (!session) {
            return res.status(400).json({
                message: "Crie uma conexão WhatsApp antes de importar grupos",
            });
        }
        const rows = parseFile(file.buffer, file.originalname);
        if (rows.length === 0) {
            return res.status(400).json({
                message: "Arquivo vazio ou sem dados válidos",
            });
        }
        let created = 0;
        for (const row of rows) {
            const waId = normalizeWaId(row.waId);
            const name = (row.name || row.nome || waId).trim();
            if (!waId || !name)
                continue;
            try {
                const existing = await prismaClient_1.prisma.whatsappGroup.findUnique({
                    where: { sessionId_waId: { sessionId: session.id, waId } },
                });
                if (!existing) {
                    const { allowed } = await (0, planLimitsService_1.checkLimit)(companyId, "groups");
                    if (!allowed)
                        continue;
                }
                await prismaClient_1.prisma.whatsappGroup.upsert({
                    where: {
                        sessionId_waId: { sessionId: session.id, waId },
                    },
                    create: {
                        waId,
                        name,
                        sessionId: session.id,
                        source: "imported",
                    },
                    update: {
                        name,
                        source: "imported",
                    },
                });
                created++;
            }
            catch (_) {
                // ignorar duplicatas
            }
        }
        const groups = await (0, whatsappService_1.listGroupsFull)(companyId);
        res.json({ created, total: groups.length, groups });
    }
    catch (err) {
        res.status(400).json({ message: err?.message ?? "Erro ao importar" });
    }
});
function normalizeWaId(value) {
    if (!value || typeof value !== "string")
        return "";
    let s = value.trim();
    if (s.startsWith("https://chat.whatsapp.com/")) {
        // link de convite - não conseguimos resolver para waId sem API adicional
        return "";
    }
    if (!s.includes("@")) {
        s = s.replace(/\D/g, "") + "@g.us";
    }
    return s;
}
function parseFile(buffer, filename) {
    const ext = (filename || "").toLowerCase();
    if (ext.endsWith(".csv")) {
        return parseCsv(buffer.toString("utf-8"));
    }
    if (ext.endsWith(".xlsx") || ext.endsWith(".xls")) {
        return parseExcel(buffer);
    }
    return [];
}
function parseCsv(content) {
    const lines = content.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2)
        return [];
    const sep = lines[0].includes(";") ? ";" : ",";
    const headers = lines[0].toLowerCase().split(sep).map((h) => h.trim());
    const waIdx = headers.findIndex((h) => /waid|wa_id|id|grupo/.test(h));
    const nameIdx = headers.findIndex((h) => /nome|name|nome do grupo/.test(h));
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const cells = parseCsvLine(lines[i], sep);
        const waId = waIdx >= 0 ? cells[waIdx]?.trim() : cells[0]?.trim();
        const name = nameIdx >= 0 ? cells[nameIdx]?.trim() : cells[1]?.trim();
        if (waId)
            rows.push({ waId, name });
    }
    return rows;
}
function parseCsvLine(line, sep) {
    const out = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            inQuotes = !inQuotes;
        }
        else if (inQuotes) {
            cur += c;
        }
        else if (c === sep) {
            out.push(cur.trim());
            cur = "";
        }
        else {
            cur += c;
        }
    }
    out.push(cur.trim());
    return out;
}
function parseExcel(buffer) {
    const wb = XLSX.read(buffer, { type: "buffer" });
    const first = Object.keys(wb.Sheets)[0];
    if (!first)
        return [];
    const sheet = wb.Sheets[first];
    const data = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
    });
    if (!data.length)
        return [];
    const headers = (data[0] || []).map((h) => String(h || "").toLowerCase());
    const waIdx = headers.findIndex((h) => /waid|wa_id|id|grupo/.test(h));
    const nameIdx = headers.findIndex((h) => /nome|name/.test(h));
    const rows = [];
    for (let i = 1; i < data.length; i++) {
        const row = data[i] || [];
        const waId = String(waIdx >= 0 ? row[waIdx] : row[0] ?? "").trim();
        const name = String(nameIdx >= 0 ? row[nameIdx] : row[1] ?? "").trim();
        if (waId)
            rows.push({ waId, name });
    }
    return rows;
}
exports.default = router;
