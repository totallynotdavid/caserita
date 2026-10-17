import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { totales } from "../src/book.ts";
import { escribirFilas, leerMensajes } from "../src/csv.ts";
import type { Extraccion } from "../src/types.ts";
import { manejadorDe } from "./helpers.ts";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");
const leer = (nombre: string) => readFileSync(join(FIXTURES, nombre), "utf8");

test("the recorded extractions of the 30 examples give the answer key and S/ 788.90", async () => {
  const grabadas = JSON.parse(leer("extracciones.json")) as Record<
    string,
    Extraccion
  >;
  const mensajes = leerMensajes(leer("ejemplos_mensajes.csv"));
  const { manejador, store } = manejadorDe(async (texto) => {
    const extraccion = grabadas[texto];
    if (!extraccion) throw new Error(`Falta la extracción de: ${texto}`);
    return extraccion;
  });

  const filas = await manejador.semana(mensajes);

  expect(escribirFilas(filas)).toBe(leer("ejemplos_respuestas.csv"));
  expect(totales(store.transacciones()).flujo).toBe(78890);
});
