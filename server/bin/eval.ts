import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { totales } from "../src/book.ts";
import { cargarEnv, leerConfig } from "../src/config.ts";
import { leerFilas, leerMensajes } from "../src/csv.ts";
import { crearExtractores } from "../src/extract.ts";
import { crearManejador } from "../src/handle.ts";
import { crearLlm } from "../src/llm.ts";
import { soles } from "../src/money.ts";
import { describir, puntuar } from "../src/score.ts";
import { Store } from "../src/store.ts";
import type { Extraccion, Extractor } from "../src/types.ts";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");
const FLUJO_ESPERADO = 78890;

cargarEnv();
const config = leerConfig();
const mensajes = leerMensajes(
  readFileSync(join(FIXTURES, "ejemplos_mensajes.csv"), "utf8"),
);
const esperadas = leerFilas(
  readFileSync(join(FIXTURES, "ejemplos_respuestas.csv"), "utf8"),
);

const grabadas: Record<string, Extraccion> = {};
const extractores = crearExtractores(
  crearLlm({ groq: config.groqKey, gemini: config.geminiKey }, (error) =>
    console.error(`Groq falló (${String(error)}); sigo con Gemini`),
  ),
);
const lote = extractores.lote(mensajes.map((m) => m.texto));
const grabar: Extractor = async (texto, ctx) => {
  const extraccion = await lote(texto, ctx);
  grabadas[texto] = extraccion;
  return extraccion;
};

const store = new Store(":memory:");
const manejador = crearManejador({
  store,
  extraer: grabar,
  extraerSemana: () => grabar,
});
const inicio = performance.now();
const obtenidas = await manejador.semana(mensajes);
const segundos = ((performance.now() - inicio) / 1000).toFixed(1);

const puntaje = puntuar(esperadas, obtenidas);
for (const { esperada, obtenida } of puntaje.fallos) {
  console.log(`FALLA  esperada: ${describir(esperada)}`);
  console.log(
    `       obtenida: ${obtenida ? describir(obtenida) : "(ninguna)"}`,
  );
}
for (const fila of puntaje.sobrantes) {
  console.log(`SOBRA  ${describir(fila)}`);
}
const flujo = totales(store.transacciones()).flujo;
console.log(`Filas: ${puntaje.aciertos}/${puntaje.esperadas}`);
console.log(`Filas de más: ${puntaje.sobrantes.length}`);
console.log(`Flujo de caja semanal: ${soles(flujo)}`);
console.log(`Tiempo: ${segundos} s`);

const perfecto =
  puntaje.aciertos === puntaje.esperadas &&
  puntaje.sobrantes.length === 0 &&
  flujo === FLUJO_ESPERADO;
if (perfecto) {
  writeFileSync(
    join(FIXTURES, "extracciones.json"),
    `${JSON.stringify(grabadas, null, 2)}\n`,
  );
  console.log("Extracciones guardadas en server/fixtures/extracciones.json");
}
process.exit(perfecto ? 0 : 1);
