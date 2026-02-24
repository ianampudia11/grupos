"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPixExpirationMinutes = getPixExpirationMinutes;
exports.getMpAccessToken = getMpAccessToken;
exports.createPixOrder = createPixOrder;
exports.getPublicKey = getPublicKey;
const axios_1 = __importDefault(require("axios"));
const systemSettingService_1 = require("./systemSettingService");
const MP_ACCESS_TOKEN = "mercadopago_access_token";
const MP_PUBLIC_KEY = "mercadopago_public_key";
const PIX_EXPIRATION = "pix_expiration_minutes";
/** Min 30 min, max 43200 (30 dias). Padrão 30 min. */
async function getPixExpirationMinutes() {
    const v = await (0, systemSettingService_1.getSetting)(PIX_EXPIRATION);
    const n = parseInt(v || "30", 10);
    return Math.min(43200, Math.max(30, isNaN(n) ? 30 : n));
}
async function getMpAccessToken() {
    const token = await (0, systemSettingService_1.getSetting)(MP_ACCESS_TOKEN);
    if (!token)
        throw new Error("Mercado Pago não configurado. Configure o token em Configurações.");
    return token;
}
/**
 * Cria pagamento PIX via Orders API.
 * Retorna qr_code (copia e cola), qr_code_base64 (imagem QR) e expiração.
 */
async function createPixOrder(params) {
    const token = await getMpAccessToken();
    const expMin = params.expirationMinutes ?? (await getPixExpirationMinutes());
    // ISO 8601 duration: PT30M, PT1H, PT24H. Min 30min, max 30 dias.
    const expMinutes = Math.min(43200, Math.max(30, expMin));
    const expDuration = `PT${expMinutes}M`;
    const payload = {
        type: "online",
        external_reference: params.externalReference,
        total_amount: params.amount.toFixed(2),
        processing_mode: "automatic",
        transactions: {
            payments: [
                {
                    amount: params.amount.toFixed(2),
                    payment_method: {
                        id: "pix",
                        type: "bank_transfer",
                    },
                    expiration_time: expDuration,
                },
            ],
        },
        payer: {
            email: params.payerEmail,
            ...(params.payerName?.trim() && {
                first_name: params.payerName.trim().split(/\s+/)[0] || params.payerName,
                last_name: params.payerName.trim().split(/\s+/).slice(1).join(" ") || undefined,
            }),
        },
        items: [
            {
                title: params.title,
                unit_price: params.amount.toFixed(2),
                quantity: 1,
                description: params.title,
            },
        ],
    };
    const res = await axios_1.default.post("https://api.mercadopago.com/v1/orders", payload, {
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Idempotency-Key": `${params.externalReference}-${Date.now()}`,
        },
    });
    const payments = res.data?.transactions?.payments ?? [];
    const payment = Array.isArray(payments) ? payments[0] : null;
    const pm = payment?.payment_method ?? payment;
    const qrCode = pm?.qr_code ?? pm?.qrCode ?? "";
    const qrCodeBase64 = pm?.qr_code_base64 ?? pm?.qrCodeBase64 ?? "";
    if (!qrCode || !qrCodeBase64) {
        const errDetail = res.data?.message ?? res.data?.error ?? JSON.stringify(res.data).slice(0, 200);
        throw new Error(`Mercado Pago não retornou QR PIX. Verifique as chaves PIX no painel MP. Detalhe: ${errDetail}`);
    }
    return {
        paymentId: payment?.id ?? "",
        qrCode,
        qrCodeBase64: qrCodeBase64.startsWith("data:") ? qrCodeBase64 : `data:image/png;base64,${qrCodeBase64}`,
        expirationMinutes: expMinutes,
    };
}
async function getPublicKey() {
    return (0, systemSettingService_1.getSetting)(MP_PUBLIC_KEY);
}
