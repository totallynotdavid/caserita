import type { Fila } from "./types.ts";

const COLUMNAS = [
  "tipo",
  "producto",
  "cantidad",
  "monto",
  "requiere_confirmacion",
] as const;

export interface Puntaje {
  esperadas: number;
  aciertos: number;
  sobrantes: Fila[];
  fallos: { esperada: Fila; obtenida: Fila | null }[];
}

const igual = (a: Fila, b: Fila) => COLUMNAS.every((k) => a[k] === b[k]);

export function puntuar(esperadas: Fila[], obtenidas: Fila[]): Puntaje {
  const libres = [...obtenidas];
  let aciertos = 0;
  const pendientes: Fila[] = [];
  for (const esperada of esperadas) {
    const i = libres.findIndex(
      (o) => o.id_mensaje === esperada.id_mensaje && igual(o, esperada),
    );
    if (i >= 0) {
      libres.splice(i, 1);
      aciertos++;
    } else {
      pendientes.push(esperada);
    }
  }
  const fallos = pendientes.map((esperada) => {
    const j = libres.findIndex((o) => o.id_mensaje === esperada.id_mensaje);
    const obtenida = j >= 0 ? (libres.splice(j, 1)[0] ?? null) : null;
    return { esperada, obtenida };
  });
  return { esperadas: esperadas.length, aciertos, sobrantes: libres, fallos };
}

export function describir(f: Fila): string {
  return `${f.id_mensaje} ${f.tipo} | ${f.producto} | ${f.cantidad} | ${f.monto || "(vacío)"} | ${f.requiere_confirmacion}`;
}
