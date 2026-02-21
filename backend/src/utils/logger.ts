const COLORS = {
  INFO: "\x1b[36m",
  WARN: "\x1b[33m",
  ERROR: "\x1b[31m",
  SUCCESS: "\x1b[32m",
  DEBUG: "\x1b[90m",
} as const;
const RESET = "\x1b[0m";

const now = () => new Date().toISOString();
const isProduction = process.env.NODE_ENV === "production";

/** Evita vazamento de stack e dados sensíveis em logs (produção) */
function safeMeta(meta: unknown): unknown {
  if (meta === undefined) return undefined;
  if (isProduction && meta instanceof Error) {
    return { name: meta.name, message: meta.message };
  }
  return meta;
}

function write(
  level: keyof typeof COLORS,
  scope: string,
  message: string,
  meta?: unknown
): void {
  const color = COLORS[level];
  const prefix = `${color}[${now()}] [${level}] [${scope}]${RESET}`;
  const safe = safeMeta(meta);
  if (safe === undefined) {
    console.log(`${prefix} ${message}`);
    return;
  }
  console.log(`${prefix} ${message}`, safe);
}

export const logger = {
  info: (scope: string, message: string, meta?: unknown) =>
    write("INFO", scope, message, meta),
  warn: (scope: string, message: string, meta?: unknown) =>
    write("WARN", scope, message, meta),
  error: (scope: string, message: string, meta?: unknown) =>
    write("ERROR", scope, message, meta),
  success: (scope: string, message: string, meta?: unknown) =>
    write("SUCCESS", scope, message, meta),
  debug: (scope: string, message: string, meta?: unknown) =>
    write("DEBUG", scope, message, meta),
};
