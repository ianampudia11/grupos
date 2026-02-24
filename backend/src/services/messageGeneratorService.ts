/**
 * Gera mensagens a partir de templates com placeholders e spintax.
 * Spintax: {opção1|opção2|opção3} - escolhe uma variação aleatória.
 * Placeholders: {titulo}, {preco}, {precoAntigo}, {desconto}, {cupom}, {link}, {loja}, {categoria}
 */

export interface ProductData {
  title?: string | null;
  price?: string | null;
  oldPrice?: string | null;
  discountPercent?: number | null;
  coupon?: string | null;
  link?: string | null;
  store?: string | null;
  category?: string | null;
}

function pickSpintax(text: string): string {
  const regex = /\{([^{}]+)\}/g;
  return text.replace(regex, (_, options) => {
    const variants = options.split("|").map((s: string) => s.trim());
    return variants[Math.floor(Math.random() * variants.length)] || options;
  });
}

function replacePlaceholders(
  text: string,
  data: Record<string, string | undefined>
): string {
  let result = text;
  for (const [key, value] of Object.entries(data)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "gi"), value ?? "");
  }
  return result;
}

export function generateMessage(
  templateBody: string,
  product: ProductData | null | undefined,
  seed?: number
): string {
  const data: Record<string, string> = {
    titulo: product?.title ?? "",
    precio: product?.price ?? "",
    precioAnterior: product?.oldPrice ?? "",
    descuento:
      product?.discountPercent != null
        ? `${product.discountPercent}%`
        : "",
    cupon: product?.coupon ?? "",
    link: product?.link ?? "",
    tienda: product?.store ?? "",
    categoria: product?.category ?? "",
  };
  let result = replacePlaceholders(templateBody, data);
  if (seed != null) {
    const rng = (s: number) => () => ((s = (s * 9301 + 49297) % 233280), s / 233280);
    const random = rng(seed);
    result = result.replace(/\{([^{}]+)\}/g, (_, options) => {
      const variants = options.split("|").map((s: string) => s.trim());
      return variants[Math.floor(random() * variants.length)] || options;
    });
  } else {
    result = pickSpintax(result);
  }
  return result.trim();
}

export const DEFAULT_TEMPLATES = [
  {
    name: "Oferta Relámpago",
    templateType: "oferta_relampago",
    body: `⚡ *OFERTA RELÁMPAGO* ⚡

{titulo}

💰 De {precioAnterior} por solo *{precio}*
🔥 {descuento} de descuento!

{cupon|🎫 Cupón: {cupon}|}

➡️ {link}

¡No te lo pierdas! {tienda}`,
  },
  {
    name: "Cupón",
    templateType: "cupom",
    body: `🎫 *CUPÓN EXCLUSIVO* 🎫

{titulo}

✅ Usa el cupón: *{cupon}*
💰 {precio} {descuento|con {descuento} OFF|}

🔗 {link}
📦 {tienda}`,
  },
  {
    name: "Envío gratis",
    templateType: "frete_gratis",
    body: `🚚 *ENVÍO GRATIS* 🚚

{titulo}

 ✨ Solo *{precio}*
{cupon|🎁 Cupón {cupon}|}

👉 {link}
Tienda: {tienda}`,
  },
  {
    name: "Simple",
    templateType: "custom",
    body: `{titulo}

{precio} {descuento|{descuento} OFF|}
{link}`,
  },
];
