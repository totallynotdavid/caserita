import { dirname } from "node:path";

export interface Config {
  port: number;
  dbPath: string;
  dataDir: string;
  whatsapp: boolean;
  /** Phone numbers, digits only, whose chats WhatsApp answers; empty answers all. */
  whatsappPermitidos: string[];
  adminToken: string | undefined;
  groqKey: string | undefined;
  geminiKey: string | undefined;
}

/** Reads `.env` from the working directory when it exists; real variables win. */
export function cargarEnv(): void {
  try {
    process.loadEnvFile(".env");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

const vacioANada = (v: string | undefined) => (v === "" ? undefined : v);

export function leerConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dbPath = vacioANada(env["DB_PATH"]) ?? "data/caserita.sqlite";
  return {
    port: Number(vacioANada(env["PORT"]) ?? 8787),
    dbPath,
    dataDir: dirname(dbPath),
    whatsapp: env["WHATSAPP"] === "on",
    whatsappPermitidos: (env["WHATSAPP_PERMITIDOS"] ?? "")
      .split(",")
      .map((n) => n.replace(/\D/g, ""))
      .filter((n) => n !== ""),
    adminToken: vacioANada(env["ADMIN_TOKEN"]),
    groqKey: vacioANada(env["GROQ_API_KEY"]),
    geminiKey: vacioANada(env["GEMINI_API_KEY"]),
  };
}
