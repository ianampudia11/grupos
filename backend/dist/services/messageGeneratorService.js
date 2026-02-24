"use strict";
/**
 * Gera mensagens a partir de templates com placeholders e spintax.
 * Spintax: {opção1|opção2|opção3} - escolhe uma variação aleatória.
 * Placeholders: {titulo}, {preco}, {precoAntigo}, {desconto}, {cupom}, {link}, {loja}, {categoria}
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_TEMPLATES = void 0;
exports.generateMessage = generateMessage;
function pickSpintax(text) {
    const regex = /\{([^{}]+)\}/g;
    return text.replace(regex, (_, options) => {
        const variants = options.split("|").map((s) => s.trim());
        return variants[Math.floor(Math.random() * variants.length)] || options;
    });
}
function replacePlaceholders(text, data) {
    let result = text;
    for (const [key, value] of Object.entries(data)) {
        result = result.replace(new RegExp(`\\{${key}\\}`, "gi"), value ?? "");
    }
    return result;
}
function generateMessage(templateBody, product, seed) {
    const data = {
        titulo: product?.title ?? "",
        preco: product?.price ?? "",
        precoAntigo: product?.oldPrice ?? "",
        desconto: product?.discountPercent != null
            ? `${product.discountPercent}%`
            : "",
        cupom: product?.coupon ?? "",
        link: product?.link ?? "",
        loja: product?.store ?? "",
        categoria: product?.category ?? "",
    };
    let result = replacePlaceholders(templateBody, data);
    if (seed != null) {
        const rng = (s) => () => ((s = (s * 9301 + 49297) % 233280), s / 233280);
        const random = rng(seed);
        result = result.replace(/\{([^{}]+)\}/g, (_, options) => {
            const variants = options.split("|").map((s) => s.trim());
            return variants[Math.floor(random() * variants.length)] || options;
        });
    }
    else {
        result = pickSpintax(result);
    }
    return result.trim();
}
exports.DEFAULT_TEMPLATES = [
    {
        name: "Oferta Relâmpago",
        templateType: "oferta_relampago",
        body: `⚡ *OFERTA RELÂMPAGO* ⚡

{titulo}

💰 De {precoAntigo} por apenas *{preco}*
🔥 {desconto} de desconto!

{cupom|🎫 Cupom: {cupom}|}

➡️ {link}

Não perca! {loja}`,
    },
    {
        name: "Cupom",
        templateType: "cupom",
        body: `🎫 *CUPOM EXCLUSIVO* 🎫

{titulo}

✅ Use o cupom: *{cupom}*
💰 {preco} {desconto|com {desconto} OFF|}

🔗 {link}
📦 {loja}`,
    },
    {
        name: "Frete grátis",
        templateType: "frete_gratis",
        body: `🚚 *FRETE GRÁTIS* 🚚

{titulo}

✨ Apenas *{preco}*
{cupom|🎁 Cupom {cupom}|}

👉 {link}
Loja: {loja}`,
    },
    {
        name: "Simples",
        templateType: "custom",
        body: `{titulo}

{preco} {desconto|{desconto} OFF|}
{link}`,
    },
];
