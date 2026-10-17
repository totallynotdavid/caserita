import type { Estimacion, Totales } from "./book.ts";
import {
  MESES_POR_ANIO,
  PORCENTAJE_CUOTA,
  REDONDEO_CUOTA,
  SEMANAS_POR_ANIO,
} from "./book.ts";
import { soles } from "./money.ts";
import type { Transaccion } from "./types.ts";

const SIN_TILDE: Record<string, string> = {
  ó: "o",
  á: "a",
  é: "e",
  í: "i",
  ú: "u",
};

/** Plural of the first word: "atún" to "atunes", "leche gloria" to "leches gloria". */
export function plural(producto: string): string {
  const [primera = "", ...resto] = producto.split(" ");
  let p: string;
  if (primera.endsWith("s")) p = primera;
  else if (primera.endsWith("z")) p = `${primera.slice(0, -1)}ces`;
  else if (/[aeiouáéíóú]$/.test(primera)) p = `${primera}s`;
  else
    p = `${primera.replace(/([áéíóú])n$/, (_, v: string) => `${SIN_TILDE[v]}n`)}es`;
  return [p, ...resto].join(" ");
}

function cosas(t: Transaccion): string {
  return t.cantidad === 1
    ? `1 ${t.producto}`
    : `${t.cantidad} ${plural(t.producto)}`;
}

/** Asks for a missing amount without an article, so there is no gender to get wrong. */
export function pregunta(t: Transaccion): string {
  switch (t.tipo) {
    case "venta":
      return `¿En cuánto vendió ${cosas(t)}?`;
    case "gasto":
      return `¿Cuánto pagó por ${t.cantidad === 1 ? t.producto : cosas(t)}?`;
    case "fiado":
      return `¿De cuánto fue el fiado de ${cosas(t)}${t.cliente ? ` a ${t.cliente}` : ""}?`;
    case "cobro_fiado":
      return t.cliente
        ? `¿Cuánto le pagó ${t.cliente}?`
        : "¿Cuánto le pagaron?";
  }
}

export function frase(t: Transaccion): string {
  const monto = t.centavos === null ? "" : ` por ${soles(t.centavos)}`;
  switch (t.tipo) {
    case "venta":
      return `venta de ${cosas(t)}${monto}`;
    case "gasto":
      return `gasto de ${t.cantidad === 1 ? t.producto : cosas(t)}${monto}`;
    case "fiado":
      return `fiado de ${cosas(t)}${t.cliente ? ` a ${t.cliente}` : ""}${monto}`;
    case "cobro_fiado":
      return `cobro de ${t.producto}${monto}`;
  }
}

export function confirmacion(
  nuevas: Transaccion[],
  pendiente: Transaccion | null,
): string {
  const partes: string[] = [];
  const completas = nuevas.filter((t) => t.centavos !== null);
  if (completas.length > 0)
    partes.push(`Listo, anoté: ${completas.map(frase).join("; ")}.`);
  if (pendiente) partes.push(pregunta(pendiente));
  return partes.join(" ");
}

export function respuestaCompletada(
  t: Transaccion,
  siguiente: Transaccion | null,
): string {
  const partes = [`Listo, completé: ${frase(t)}.`];
  if (siguiente) partes.push(pregunta(siguiente));
  return partes.join(" ");
}

export const SIN_NADA =
  "No encontré nada para anotar. ¿Me lo cuenta de otra forma?";
export const PERSONAL =
  "Eso parece una compra personal, no del negocio, así que no lo anoté.";
export const AUDIO_ILEGIBLE =
  "No pude escuchar bien el audio. ¿Me lo manda otra vez o me lo escribe?";
export const NO_PUDE = "No pude procesar el mensaje. Intente de nuevo.";
export const MONTO_NO_ENTENDIDO = "Perdone, no entendí el monto.";
export const NO_ENTENDI = "Perdone, no le entendí.";
export const NADA_QUE_BORRAR = "No hay nada anotado para borrar.";

export function borradas(filas: Transaccion[]): string {
  return `Listo, borré: ${filas.map(frase).join("; ")}.`;
}

function sinMonto(pendientes: Transaccion[]): string {
  return pendientes.length === 0
    ? ""
    : `\nNo conté estas filas porque les falta el monto: ${pendientes.map(frase).join("; ")}.`;
}

export function textoResumen(
  t: Totales,
  pendientes: Transaccion[],
  fiados: number,
): string {
  return (
    `Esta semana: ventas ${soles(t.ventas)}, cobros de fiado ${soles(t.cobros)} y gastos ${soles(t.gastos)}. ` +
    `Su flujo de caja es ${soles(t.flujo)}.` +
    (fiados > 0 ? `\nLe deben ${soles(fiados)} en fiados.` : "") +
    sinMonto(pendientes)
  );
}

export function textoCuota(e: Estimacion): string {
  const lineas = [
    `Esta semana entraron ${soles(e.ventas + e.cobros)} (ventas ${soles(e.ventas)} y cobros de fiado ${soles(e.cobros)}) y salieron ${soles(e.gastos)} en gastos.`,
    `Flujo semanal: ${soles(e.ventas)} + ${soles(e.cobros)} - ${soles(e.gastos)} = ${soles(e.flujo)}.`,
  ];
  if (e.flujo <= 0) {
    lineas.push(
      "Con ese flujo no sobra plata, así que no le puedo sugerir una cuota por ahora. Primero hay que lograr que lo que entra sea mayor a lo que sale.",
    );
  } else {
    lineas.push(
      `Al mes: ${soles(e.flujo)} x ${SEMANAS_POR_ANIO} semanas / ${MESES_POR_ANIO} meses = ${soles(e.mensual)}.`,
      `La cuota se calcula con el ${PORCENTAJE_CUOTA}% de eso: ${soles(e.mensual)} x ${PORCENTAJE_CUOTA}% = ${soles(e.porcentaje)}, redondeado hacia abajo de ${REDONDEO_CUOTA / 100} en ${REDONDEO_CUOTA / 100} soles.`,
    );
    lineas.push(
      e.cuota === null
        ? `Ese ${PORCENTAJE_CUOTA}% no llega a ${soles(REDONDEO_CUOTA)}, así que no le puedo sugerir una cuota por ahora.`
        : `Podría pagar de cuota unos ${soles(e.cuota)} al mes.`,
    );
  }
  lineas.push(
    "Es solo un estimado con lo anotado. No es la aprobación de un préstamo.",
  );
  return lineas.join("\n") + sinMonto(e.pendientes);
}
