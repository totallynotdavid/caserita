import { readFileSync, writeFileSync } from "node:fs";
import { cargarEnv, leerConfig } from "../src/config.ts";
import { escribirFilas, leerMensajes } from "../src/csv.ts";
import { crearManejador } from "../src/handle.ts";
import { dependenciasReales } from "../src/sistema.ts";
import { Store } from "../src/store.ts";

const [entrada, salida] = process.argv.slice(2);
if (!entrada || !salida) {
  console.error("Uso: node server/bin/batch.ts <entrada.csv> <salida.csv>");
  process.exit(2);
}

cargarEnv();
const inicio = performance.now();
const store = new Store(":memory:");
const manejador = crearManejador(
  dependenciasReales(leerConfig(), store, (error) =>
    console.error(`Groq falló (${String(error)}); sigo con Gemini`),
  ),
);
const mensajes = leerMensajes(readFileSync(entrada, "utf8"));
const filas = await manejador.semana(mensajes);
writeFileSync(salida, escribirFilas(filas));
const segundos = ((performance.now() - inicio) / 1000).toFixed(1);
console.error(
  `${mensajes.length} mensajes, ${filas.length} filas, ${segundos} s`,
);
