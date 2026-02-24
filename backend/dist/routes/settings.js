"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const multer_1 = __importDefault(require("multer"));
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const systemSettingService_1 = require("../services/systemSettingService");
const dispatchSettingsService_1 = require("../services/dispatchSettingsService");
const router = (0, express_1.Router)();
const publicDir = path_1.default.resolve(process.cwd(), "public");
const logotiposDir = path_1.default.join(publicDir, "logotipos");
const logoStorage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        if (!fs_1.default.existsSync(logotiposDir))
            fs_1.default.mkdirSync(logotiposDir, { recursive: true });
        cb(null, logotiposDir);
    },
    filename: (_req, file, cb) => {
        const ext = (file.originalname.match(/\.(png|jpg|jpeg|svg|webp)$/i)?.[1] ?? "png").toLowerCase();
        cb(null, `logo.${ext}`);
    },
});
const logoDarkStorage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        if (!fs_1.default.existsSync(logotiposDir))
            fs_1.default.mkdirSync(logotiposDir, { recursive: true });
        cb(null, logotiposDir);
    },
    filename: (_req, file, cb) => {
        const ext = (file.originalname.match(/\.(png|jpg|jpeg|svg|webp)$/i)?.[1] ?? "png").toLowerCase();
        cb(null, `logo-dark.${ext}`);
    },
});
const faviconStorage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        if (!fs_1.default.existsSync(logotiposDir))
            fs_1.default.mkdirSync(logotiposDir, { recursive: true });
        cb(null, logotiposDir);
    },
    filename: (_req, file, cb) => {
        const ext = (file.originalname.match(/\.(ico|png)$/i)?.[1] ?? "ico").toLowerCase();
        cb(null, `favicon.${ext}`);
    },
});
const iconStorage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        if (!fs_1.default.existsSync(logotiposDir))
            fs_1.default.mkdirSync(logotiposDir, { recursive: true });
        cb(null, logotiposDir);
    },
    filename: (_req, file, cb) => {
        const ext = (file.originalname.match(/\.(png|jpg|jpeg|svg|webp)$/i)?.[1] ?? "png").toLowerCase();
        cb(null, `icon.${ext}`);
    },
});
const LOGO_MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const uploadLogo = (0, multer_1.default)({ storage: logoStorage, limits: { fileSize: LOGO_MAX_SIZE } });
const uploadLogoDark = (0, multer_1.default)({ storage: logoDarkStorage, limits: { fileSize: LOGO_MAX_SIZE } });
const uploadFavicon = (0, multer_1.default)({ storage: faviconStorage, limits: { fileSize: 512 * 1024 } });
const uploadIcon = (0, multer_1.default)({ storage: iconStorage, limits: { fileSize: 512 * 1024 } });
const LOGO_EXTS = ["logo.svg", "logo.webp", "logo.png", "logo.jpg", "logo.jpeg"];
const LOGO_DARK_EXTS = ["logo-dark.svg", "logo-dark.webp", "logo-dark.png", "logo-dark.jpg", "logo-dark.jpeg"];
const FAVICON_EXTS = ["favicon.ico", "favicon.png"];
const ICON_EXTS = ["icon.svg", "icon.webp", "icon.png", "icon.jpg", "icon.jpeg"];
/** Branding público (sem auth) - logo, favicon, título */
router.get("/branding", async (_req, res) => {
    const systemTitle = (await (0, systemSettingService_1.getSetting)("system_title")) || "Painel de disparos WhatsApp";
    const logoFile = LOGO_EXTS.find((f) => fs_1.default.existsSync(path_1.default.join(logotiposDir, f)));
    const logoDarkFile = LOGO_DARK_EXTS.find((f) => fs_1.default.existsSync(path_1.default.join(logotiposDir, f)));
    const faviconFile = FAVICON_EXTS.find((f) => fs_1.default.existsSync(path_1.default.join(logotiposDir, f)));
    const iconFile = ICON_EXTS.find((f) => fs_1.default.existsSync(path_1.default.join(logotiposDir, f)));
    res.json({
        systemTitle,
        logoUrl: logoFile ? `/public/logotipos/${logoFile}` : null,
        logoDarkUrl: logoDarkFile ? `/public/logotipos/${logoDarkFile}` : null,
        faviconUrl: faviconFile ? `/public/logotipos/${faviconFile}` : null,
        iconUrl: iconFile ? `/public/logotipos/${iconFile}` : null,
    });
});
/** Configuração pública do reCAPTCHA (sem auth) - para login/registro carregarem o script correto */
router.get("/recaptcha-public", async (_req, res) => {
    const version = (await (0, systemSettingService_1.getSetting)("recaptcha_version")) || "off";
    const v2Site = await (0, systemSettingService_1.getSetting)("recaptcha_v2_site_key");
    const v3Site = await (0, systemSettingService_1.getSetting)("recaptcha_v3_site_key");
    const enabled = version === "v2" ? !!v2Site : version === "v3" ? !!v3Site : false;
    const siteKey = version === "v2" ? v2Site : version === "v3" ? v3Site : null;
    res.json({
        enabled: !!enabled,
        version: enabled ? version : null,
        siteKey: siteKey || null,
    });
});
router.use(auth_1.authMiddleware);
/** Delay dos disparos (por empresa) - qualquer usuário autenticado com companyId */
router.get("/dispatch", async (req, res) => {
    await (0, auth_1.enrichAuth)(req);
    const companyId = req.companyId;
    if (!companyId)
        return res.status(403).json({ message: "Você precisa estar vinculado a uma empresa." });
    try {
        const settings = await (0, dispatchSettingsService_1.getDispatchSettings)(companyId);
        res.json(settings);
    }
    catch (e) {
        res.status(400).json({ message: e?.message ?? "Erro ao carregar configuração de disparos." });
    }
});
router.put("/dispatch", async (req, res) => {
    await (0, auth_1.enrichAuth)(req);
    const companyId = req.companyId;
    if (!companyId)
        return res.status(403).json({ message: "Você precisa estar vinculado a uma empresa." });
    try {
        const schema = zod_1.z.object({
            preset: zod_1.z.enum(["seguro", "equilibrado", "rapido"]).optional(),
            delayMinSec: zod_1.z.number().min(1).max(60).optional(),
            delayMaxSec: zod_1.z.number().min(1).max(120).optional(),
            batchSize: zod_1.z.number().min(1).max(100).optional(),
            pauseBetweenBatchesSec: zod_1.z.number().min(0).max(600).optional(),
            acceptApiTerms: zod_1.z.boolean().optional(),
        });
        const data = schema.parse(req.body);
        const result = await (0, dispatchSettingsService_1.setDispatchSettings)(companyId, data);
        res.json(result);
    }
    catch (e) {
        res.status(400).json({ message: e?.message ?? "Erro ao salvar configuração de disparos." });
    }
});
router.use(auth_1.superAdminMiddleware);
const MP_KEYS = ["mercadopago_access_token", "mercadopago_public_key"];
const RECAPTCHA_KEYS = [
    "recaptcha_version",
    "recaptcha_v2_site_key",
    "recaptcha_v2_secret_key",
    "recaptcha_v3_site_key",
    "recaptcha_v3_secret_key",
];
/** Lista configurações do sistema (valores mascarados) */
router.get("/system", async (_req, res) => {
    const token = await (0, systemSettingService_1.getSetting)("mercadopago_access_token");
    const publicKey = await (0, systemSettingService_1.getSetting)("mercadopago_public_key");
    const trialDays = await (0, systemSettingService_1.getSetting)("trial_days");
    const pixExpiration = await (0, systemSettingService_1.getSetting)("pix_expiration_minutes");
    const recaptchaVersion = await (0, systemSettingService_1.getSetting)("recaptcha_version");
    const recaptchaV2Site = await (0, systemSettingService_1.getSetting)("recaptcha_v2_site_key");
    const recaptchaV2Secret = await (0, systemSettingService_1.getSetting)("recaptcha_v2_secret_key");
    const recaptchaV3Site = await (0, systemSettingService_1.getSetting)("recaptcha_v3_site_key");
    const recaptchaV3Secret = await (0, systemSettingService_1.getSetting)("recaptcha_v3_secret_key");
    res.json({
        mercadopago_access_token: token ? "••••••••" : "",
        mercadopago_public_key: publicKey ?? "",
        trial_days: trialDays ?? "0",
        pix_expiration_minutes: pixExpiration ?? "30",
        recaptcha_version: recaptchaVersion ?? "off",
        recaptcha_v2_site_key: recaptchaV2Site ?? "",
        recaptcha_v2_secret_key: recaptchaV2Secret ? "••••••••" : "",
        recaptcha_v3_site_key: recaptchaV3Site ?? "",
        recaptcha_v3_secret_key: recaptchaV3Secret ? "••••••••" : "",
    });
});
/** Atualiza configurações (SuperAdmin) */
router.put("/system", async (req, res) => {
    try {
        const schema = zod_1.z.object({
            mercadopago_access_token: zod_1.z.string().optional(),
            mercadopago_public_key: zod_1.z.string().optional(),
            system_title: zod_1.z.string().min(1).max(80).optional(),
            trial_days: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).optional(),
            pix_expiration_minutes: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).optional(),
            recaptcha_version: zod_1.z.enum(["off", "v2", "v3"]).optional(),
            recaptcha_v2_site_key: zod_1.z.string().optional(),
            recaptcha_v2_secret_key: zod_1.z.string().optional(),
            recaptcha_v3_site_key: zod_1.z.string().optional(),
            recaptcha_v3_secret_key: zod_1.z.string().optional(),
        });
        const data = schema.parse(req.body);
        if (data.mercadopago_access_token !== undefined) {
            await (0, systemSettingService_1.setSetting)("mercadopago_access_token", data.mercadopago_access_token);
        }
        if (data.mercadopago_public_key !== undefined) {
            await (0, systemSettingService_1.setSetting)("mercadopago_public_key", data.mercadopago_public_key);
        }
        if (data.system_title !== undefined) {
            await (0, systemSettingService_1.setSetting)("system_title", data.system_title);
        }
        if (data.trial_days !== undefined) {
            const v = typeof data.trial_days === "number" ? String(data.trial_days) : data.trial_days;
            await (0, systemSettingService_1.setSetting)("trial_days", v);
        }
        if (data.pix_expiration_minutes !== undefined) {
            const v = typeof data.pix_expiration_minutes === "number" ? String(data.pix_expiration_minutes) : data.pix_expiration_minutes;
            await (0, systemSettingService_1.setSetting)("pix_expiration_minutes", v);
        }
        for (const key of RECAPTCHA_KEYS) {
            const val = data[key];
            if (val !== undefined)
                await (0, systemSettingService_1.setSetting)(key, val);
        }
        res.json({ ok: true });
    }
    catch (err) {
        res.status(400).json({ message: err?.message ?? "Erro ao salvar" });
    }
});
/** Upload logo (SuperAdmin) */
router.post("/branding/logo", uploadLogo.single("file"), async (req, res) => {
    if (!req.file)
        return res.status(400).json({ message: "Arquivo não enviado" });
    ["logo.png", "logo.jpg", "logo.jpeg", "logo.svg", "logo.webp"].forEach((f) => {
        const p = path_1.default.join(logotiposDir, f);
        if (fs_1.default.existsSync(p) && f !== req.file.filename)
            fs_1.default.unlinkSync(p);
    });
    res.json({ url: `/public/logotipos/${req.file.filename}` });
});
/** Upload logo dark mode (SuperAdmin) */
router.post("/branding/logo-dark", uploadLogoDark.single("file"), async (req, res) => {
    if (!req.file)
        return res.status(400).json({ message: "Arquivo não enviado" });
    LOGO_DARK_EXTS.forEach((f) => {
        const p = path_1.default.join(logotiposDir, f);
        if (fs_1.default.existsSync(p) && f !== req.file.filename)
            fs_1.default.unlinkSync(p);
    });
    res.json({ url: `/public/logotipos/${req.file.filename}` });
});
/** Upload favicon (SuperAdmin) */
router.post("/branding/favicon", uploadFavicon.single("file"), async (req, res) => {
    if (!req.file)
        return res.status(400).json({ message: "Arquivo não enviado" });
    ["favicon.ico", "favicon.png"].forEach((f) => {
        const p = path_1.default.join(logotiposDir, f);
        if (fs_1.default.existsSync(p) && f !== req.file.filename)
            fs_1.default.unlinkSync(p);
    });
    res.json({ url: `/public/logotipos/${req.file.filename}` });
});
/** Upload ícone sidebar fechada (SuperAdmin) */
router.post("/branding/icon", uploadIcon.single("file"), async (req, res) => {
    if (!req.file)
        return res.status(400).json({ message: "Arquivo não enviado" });
    ICON_EXTS.forEach((f) => {
        const p = path_1.default.join(logotiposDir, f);
        if (fs_1.default.existsSync(p) && f !== req.file.filename)
            fs_1.default.unlinkSync(p);
    });
    res.json({ url: `/public/logotipos/${req.file.filename}` });
});
/** Atualiza título do sistema (SuperAdmin) */
router.put("/branding/title", async (req, res) => {
    try {
        const schema = zod_1.z.object({ system_title: zod_1.z.string().min(1).max(80) });
        const { system_title } = schema.parse(req.body);
        await (0, systemSettingService_1.setSetting)("system_title", system_title);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(400).json({ message: err?.message ?? "Erro ao salvar" });
    }
});
exports.default = router;
