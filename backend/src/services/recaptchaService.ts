/**
 * Verificação de token Google reCAPTCHA v2 e v3
 * https://developers.google.com/recaptcha/docs/verify
 */

const SITEVERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";

export type RecaptchaVerifyResult = {
  success: boolean;
  score?: number;
  action?: string;
  challenge_ts?: string;
  hostname?: string;
  "error-codes"?: string[];
};

export async function verifyRecaptcha(
  token: string,
  secretKey: string,
  options?: { expectedAction?: string; minScore?: number }
): Promise<{ ok: boolean; error?: string }> {
  if (!token || !secretKey) {
    return { ok: false, error: "Token o clave no proporcionados" };
  }

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: secretKey, response: token }),
    });

    const data = (await res.json()) as RecaptchaVerifyResult;
    if (!data.success) {
      const codes = data["error-codes"] ?? [];
      return { ok: false, error: codes.length ? codes.join(", ") : "La verificación de reCAPTCHA falló" };
    }

    // v3: validar action e score se fornecidos
    if (options?.expectedAction && data.action && data.action !== options.expectedAction) {
      return { ok: false, error: "Acción de reCAPTCHA inválida" };
    }
    if (options?.minScore != null && typeof data.score === "number" && data.score < options.minScore) {
      return { ok: false, error: "Puntuación de reCAPTCHA muy baja" };
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: "Fallo al verificar reCAPTCHA" };
  }
}
