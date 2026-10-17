import { z } from "zod";
import type { Completar } from "./llm.ts";
import { SISTEMA } from "./prompt.ts";
import { formatoMonto } from "./money.ts";
import { TIPOS } from "./types.ts";
import type { Contexto, Extraccion, Extractor } from "./types.ts";

const numero = z.number().nullable();

const ItemSchema = z.object({
  tipo: z.enum(TIPOS),
  producto: z.string(),
  cantidad: numero,
  precio_unitario: numero,
  total_dicho: numero,
  descuento: numero,
  cliente: z.string().nullable(),
});

const ResultadoSchema = z.object({
  n: z.number().int(),
  personal: z.boolean(),
  consulta: z.enum(["cuota", "resumen"]).nullable(),
  respuesta_pendiente: z
    .object({ precio_unitario: numero, total_dicho: numero })
    .nullable(),
  items: z.array(ItemSchema),
});

const LoteSchema = z.object({ resultados: z.array(ResultadoSchema) });

const ESQUEMA = (() => {
  const { $schema: _omitido, ...resto } = z.toJSONSchema(LoteSchema, {
    target: "draft-7",
  });
  return resto;
})();

const INTENTOS = 3;
export const MENSAJES_POR_LLAMADA = 30;

function describirContexto(ctx: Contexto): string {
  const pendiente = ctx.pendiente
    ? `${ctx.pendiente.tipo}: ${ctx.pendiente.cantidad} ${ctx.pendiente.producto}${ctx.pendiente.cliente ? ` (${ctx.pendiente.cliente})` : ""} (falta el monto)`
    : null;
  const fiados = ctx.creditos.map((c) => ({
    cliente: c.cliente,
    producto: c.producto,
    debe: formatoMonto(c.restante),
  }));
  return JSON.stringify({ pendiente, fiados_abiertos: fiados });
}

/**
 * Reads a list of messages; returns one result per message. A call that
 * answers only some of them keeps those and asks again for the rest.
 */
export async function extraerLote(
  completar: Completar,
  textos: string[],
  ctx: Contexto,
): Promise<Extraccion[]> {
  const leidos = new Map<number, Extraccion>();
  let ultimo: unknown;
  for (let intento = 0; intento < INTENTOS; intento++) {
    const faltan = textos.flatMap((_, i) => (leidos.has(i) ? [] : [i]));
    if (faltan.length === 0) break;
    // Every call lists all the messages with their own numbers: the context
    // describes the state before the first one, and a follow-up can only be
    // understood next to the message it answers.
    const soloFaltan =
      faltan.length < textos.length
        ? `\nRESPONDE SOLO LOS MENSAJES: ${faltan.map((i) => i + 1).join(", ")}`
        : "";
    const user = `CONTEXTO: ${describirContexto(ctx)}\nMENSAJES:\n${textos
      .map((t, i) => `${i + 1}. ${t.replaceAll(/\s*\n\s*/g, " ")}`)
      .join("\n")}${soloFaltan}`;
    try {
      // Retries must not overlap: each one follows an incomplete answer.
      // oxlint-disable-next-line no-await-in-loop
      const crudo = await completar({
        system: SISTEMA,
        user,
        nombre: "lectura_mensajes",
        esquema: ESQUEMA,
      });
      const { resultados } = LoteSchema.parse(JSON.parse(crudo));
      for (const i of faltan) {
        const r = resultados.find((x) => x.n === i + 1);
        if (r) {
          const { n: _n, ...extraccion } = r;
          leidos.set(i, extraccion);
        }
      }
      ultimo = new Error(
        `El modelo devolvió ${resultados.length} resultados para ${faltan.length} mensajes`,
      );
    } catch (error) {
      if (!(error instanceof SyntaxError || error instanceof z.ZodError)) {
        throw error;
      }
      ultimo = error;
    }
  }
  if (leidos.size < textos.length) {
    throw new Error("No pude leer la respuesta del modelo", { cause: ultimo });
  }
  return textos.map((_, i) => leidos.get(i)!);
}

export interface Extractores {
  unico: Extractor;
  lote: (textos: string[]) => Extractor;
}

export function crearExtractores(
  completar: Completar,
  porLlamada = MENSAJES_POR_LLAMADA,
): Extractores {
  return {
    unico: async (texto, ctx) => {
      const [extraccion] = await extraerLote(completar, [texto], ctx);
      return extraccion!;
    },
    lote(textos) {
      const leidos = new Map<number, Extraccion>();
      let cursor = 0;
      return async (texto, ctx) => {
        const i = textos.indexOf(texto, cursor);
        if (i < 0) throw new Error("Mensaje fuera de la lista del lote");
        cursor = i + 1;
        if (!leidos.has(i)) {
          const grupo = textos.slice(i, i + porLlamada);
          const resultados = await extraerLote(completar, grupo, ctx);
          resultados.forEach((r, k) => leidos.set(i + k, r));
        }
        return leidos.get(i)!;
      };
    },
  };
}
