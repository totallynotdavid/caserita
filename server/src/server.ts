import { serve } from "@hono/node-server";
import pino from "pino";
import { crearApp } from "./app.ts";
import { cargarEnv, leerConfig } from "./config.ts";
import { crearManejador } from "./handle.ts";
import { dependenciasReales } from "./sistema.ts";
import { Store } from "./store.ts";
import { iniciarWhatsapp } from "./whatsapp.ts";

cargarEnv();
const config = leerConfig();
const log = pino();
const store = new Store(config.dbPath);
const manejador = crearManejador(
  dependenciasReales(config, store, (error) =>
    log.warn({ error }, "Groq falló; sigo con Gemini"),
  ),
);
const app = crearApp({ manejador, store, adminToken: config.adminToken, log });

serve({ fetch: app.fetch, port: config.port }, (info) => {
  log.info({ port: info.port, db: config.dbPath }, "caserita escuchando");
});

if (config.whatsapp) {
  await iniciarWhatsapp({ dataDir: config.dataDir, manejador, log });
}
