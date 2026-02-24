"use strict";
/**
 * Verificação de token Google reCAPTCHA v2 e v3
 * https://developers.google.com/recaptcha/docs/verify
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyRecaptcha = verifyRecaptcha;
const SITEVERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";
async function verifyRecaptcha(token, secretKey, options) {
    if (!token || !secretKey) {
        return { ok: false, error: "Token ou chave não fornecidos" };
    }
    try {
        const res = await fetch(SITEVERIFY_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ secret: secretKey, response: token }),
        });
        const data = (await res.json());
        if (!data.success) {
            const codes = data["error-codes"] ?? [];
            return { ok: false, error: codes.length ? codes.join(", ") : "Verificação reCAPTCHA falhou" };
        }
        // v3: validar action e score se fornecidos
        if (options?.expectedAction && data.action && data.action !== options.expectedAction) {
            return { ok: false, error: "Ação reCAPTCHA inválida" };
        }
        if (options?.minScore != null && typeof data.score === "number" && data.score < options.minScore) {
            return { ok: false, error: "Score reCAPTCHA muito baixo" };
        }
        return { ok: true };
    }
    catch (e) {
        return { ok: false, error: "Falha ao verificar reCAPTCHA" };
    }
}
