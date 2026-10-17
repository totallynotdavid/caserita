import type { Fila } from "./types.ts";

export const ENCABEZADO_SALIDA = [
  "id_mensaje",
  "tipo",
  "producto",
  "cantidad",
  "monto",
  "requiere_confirmacion",
] as const;

/** Parses RFC 4180 CSV text. A leading BOM is dropped. */
export function parseCsv(texto: string): string[][] {
  const src = texto.startsWith("﻿") ? texto.slice(1) : texto;
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let entreComillas = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (entreComillas) {
      if (c === '"' && src[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') {
        entreComillas = false;
      } else {
        campo += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === ",") {
      fila.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      fila.push(campo);
      campo = "";
      filas.push(fila);
      fila = [];
    } else {
      campo += c;
    }
  }
  if (campo !== "" || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas.filter((f) => f.some((x) => x !== ""));
}

export interface MensajeEntrada {
  id: string;
  dia: string;
  texto: string;
}

/** Reads the input format: id_mensaje,dia,mensaje. */
export function leerMensajes(texto: string): MensajeEntrada[] {
  const [encabezado, ...filas] = parseCsv(texto);
  if (!encabezado) throw new Error("El CSV está vacío");
  const col = (nombre: string) => {
    const i = encabezado.indexOf(nombre);
    if (i < 0) throw new Error(`Falta la columna ${nombre}`);
    return i;
  };
  const iId = col("id_mensaje");
  const iDia = col("dia");
  const iTexto = col("mensaje");
  return filas.map((f) => ({
    id: f[iId] ?? "",
    dia: f[iDia] ?? "",
    texto: f[iTexto] ?? "",
  }));
}

function escapar(valor: string): string {
  return /[",\n\r]/.test(valor) ? `"${valor.replaceAll('"', '""')}"` : valor;
}

/** Writes the output format, header included, with `\n` line ends. */
export function escribirFilas(filas: Fila[]): string {
  const lineas = [ENCABEZADO_SALIDA.join(",")];
  for (const f of filas) {
    lineas.push(ENCABEZADO_SALIDA.map((k) => escapar(f[k])).join(","));
  }
  return `${lineas.join("\n")}\n`;
}

/** Reads the output format back into rows. */
export function leerFilas(texto: string): Fila[] {
  const [, ...filas] = parseCsv(texto);
  return filas.map(([id, tipo, producto, cantidad, monto, req]) => ({
    id_mensaje: id ?? "",
    tipo: tipo as Fila["tipo"],
    producto: producto ?? "",
    cantidad: cantidad ?? "",
    monto: monto ?? "",
    requiere_confirmacion: req === "SI" ? "SI" : "NO",
  }));
}
