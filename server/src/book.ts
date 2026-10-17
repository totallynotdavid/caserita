import { aCentavos, formatoMonto } from "./money.ts";
import type { CreditoAbierto, Fila, Item, Tipo, Transaccion } from "./types.ts";

export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll(/\s+/g, " ")
    .trim();
}

const TITULOS = new Set([
  "don",
  "dona",
  "senora",
  "senor",
  "sra",
  "sr",
  "la",
  "el",
]);

export function claveCliente(cliente: string): string {
  return normalizar(cliente)
    .replaceAll(".", "")
    .split(" ")
    .filter((p) => !TITULOS.has(p))
    .join(" ");
}

function coincide(a: string, b: string): boolean {
  const x = normalizar(a);
  const y = normalizar(b);
  return x !== "" && y !== "" && (x.includes(y) || y.includes(x));
}

export function cantidadDe(item: Pick<Item, "cantidad">): number {
  return item.cantidad !== null && item.cantidad > 0 ? item.cantidad : 1;
}

/**
 * The line total in cents: the stated total, else quantity times unit price
 * minus the discount, else null. Never 0 and never negative.
 */
export function montoDe(item: Item): number | null {
  let centavos: number | null = null;
  if (item.total_dicho !== null) {
    centavos = aCentavos(item.total_dicho);
  } else if (item.precio_unitario !== null) {
    const bruto = Math.round(
      Math.round(cantidadDe(item) * aCentavos(item.precio_unitario) * 1e6) /
        1e6,
    );
    centavos =
      bruto - (item.descuento !== null ? aCentavos(item.descuento) : 0);
  }
  return centavos !== null && centavos > 0 ? centavos : null;
}

/**
 * Credits that still owe money, oldest first. A full payment settles its own
 * credit; the other payments of the same customer reduce the oldest credits.
 * A credit whose amount was never given has nothing to collect.
 */
export function creditosAbiertos(txs: Transaccion[]): CreditoAbierto[] {
  const restante = new Map<number, number>();
  const porCliente = new Map<string, Transaccion[]>();
  for (const t of txs) {
    if (t.tipo !== "fiado" || t.centavos === null || t.cliente === null)
      continue;
    restante.set(t.id, t.centavos);
    const clave = claveCliente(t.cliente);
    porCliente.set(clave, [...(porCliente.get(clave) ?? []), t]);
  }
  const parciales = new Map<string, number>();
  for (const t of txs) {
    if (t.tipo !== "cobro_fiado" || t.centavos === null) continue;
    if (t.credito_id !== null && restante.has(t.credito_id)) {
      restante.set(
        t.credito_id,
        Math.max(0, (restante.get(t.credito_id) ?? 0) - t.centavos),
      );
    } else if (t.cliente !== null) {
      const clave = claveCliente(t.cliente);
      parciales.set(clave, (parciales.get(clave) ?? 0) + t.centavos);
    }
  }
  for (const [clave, pagado] of parciales) {
    let resto = pagado;
    for (const credito of porCliente.get(clave) ?? []) {
      const abierto = restante.get(credito.id) ?? 0;
      const baja = Math.min(abierto, resto);
      restante.set(credito.id, abierto - baja);
      resto -= baja;
    }
  }
  return txs.flatMap((t) => {
    const r = restante.get(t.id);
    return t.tipo === "fiado" && r !== undefined && r > 0 && t.cliente !== null
      ? [{ id: t.id, cliente: t.cliente, producto: t.producto, restante: r }]
      : [];
  });
}

export interface FilaNueva {
  tipo: Tipo;
  producto: string;
  cantidad: number;
  centavos: number | null;
  cliente: string | null;
  credito_id: number | null;
}

const SIEMPRE_PLURAL = new Map([
  ["huevo", "huevos"],
  ["galleta", "galletas"],
]);

export function nombreDe(producto: string): string {
  const limpio = producto.trim();
  return SIEMPRE_PLURAL.get(limpio.toLowerCase()) ?? limpio;
}

export function planificar(item: Item, txs: Transaccion[]): FilaNueva {
  if (item.tipo !== "cobro_fiado") {
    return {
      tipo: item.tipo,
      producto: nombreDe(item.producto),
      cantidad: cantidadDe(item),
      centavos: montoDe(item),
      cliente: item.cliente,
      credito_id: null,
    };
  }
  return planificarCobro(item, creditosAbiertos(txs));
}

function planificarCobro(item: Item, abiertos: CreditoAbierto[]): FilaNueva {
  const declarado = montoDe(item);
  let cliente = item.cliente;
  let delCliente = abiertos;
  if (cliente !== null) {
    const clave = claveCliente(cliente);
    delCliente = abiertos.filter((c) => claveCliente(c.cliente) === clave);
  } else {
    const porProducto = abiertos.filter((c) =>
      coincide(c.producto, item.producto),
    );
    const claves = new Set(porProducto.map((c) => claveCliente(c.cliente)));
    if (claves.size === 1) {
      cliente = porProducto[0]?.cliente ?? null;
      delCliente = porProducto;
    } else {
      delCliente = [];
    }
  }
  const nombre = cliente ?? "";
  const mismoProducto = delCliente.filter((c) =>
    coincide(c.producto, item.producto),
  );

  if (declarado !== null) {
    const completo =
      mismoProducto.find((c) => c.restante === declarado) ??
      delCliente.find((c) => c.restante === declarado);
    return completo
      ? cobro(completo.producto, declarado, cliente, completo.id)
      : cobro(`pago parcial ${nombre}`.trim(), declarado, cliente, null);
  }
  const elegido =
    mismoProducto.length === 1
      ? mismoProducto[0]
      : delCliente.length === 1
        ? delCliente[0]
        : undefined;
  return elegido
    ? cobro(elegido.producto, elegido.restante, cliente, elegido.id)
    : cobro(`pago fiado ${nombre}`.trim(), null, cliente, null);
}

function cobro(
  producto: string,
  centavos: number | null,
  cliente: string | null,
  credito_id: number | null,
): FilaNueva {
  return {
    tipo: "cobro_fiado",
    producto,
    cantidad: 1,
    centavos,
    cliente,
    credito_id,
  };
}

export function montoDeRespuesta(
  pendiente: Transaccion,
  respuesta: { precio_unitario: number | null; total_dicho: number | null },
): number | null {
  return montoDe({
    tipo: pendiente.tipo,
    producto: pendiente.producto,
    cantidad: pendiente.cantidad,
    precio_unitario: respuesta.precio_unitario,
    total_dicho: respuesta.total_dicho,
    descuento: null,
    cliente: pendiente.cliente,
  });
}

export interface Totales {
  ventas: number;
  cobros: number;
  gastos: number;
  flujo: number;
}

export function totales(txs: Transaccion[]): Totales {
  let ventas = 0;
  let cobros = 0;
  let gastos = 0;
  for (const t of txs) {
    if (t.centavos === null) continue;
    if (t.tipo === "venta") ventas += t.centavos;
    else if (t.tipo === "cobro_fiado") cobros += t.centavos;
    else if (t.tipo === "gasto") gastos += t.centavos;
  }
  return { ventas, cobros, gastos, flujo: ventas + cobros - gastos };
}

export const SEMANAS_POR_ANIO = 52;
export const MESES_POR_ANIO = 12;
export const PORCENTAJE_CUOTA = 30;
export const REDONDEO_CUOTA = 1000;

export interface Estimacion extends Totales {
  mensual: number;
  porcentaje: number;
  cuota: number | null;
  pendientes: Transaccion[];
}

/**
 * Monthly flow = weekly flow x 52 / 12. The suggested payment is 30% of it,
 * rounded down to a multiple of 10 soles. A flow of 0 or less gives no amount.
 */
export function estimarCuota(txs: Transaccion[]): Estimacion {
  const t = totales(txs);
  const mensual = Math.round((t.flujo * SEMANAS_POR_ANIO) / MESES_POR_ANIO);
  const porcentaje = Math.floor((mensual * PORCENTAJE_CUOTA) / 100);
  const redondeada = Math.floor(porcentaje / REDONDEO_CUOTA) * REDONDEO_CUOTA;
  return {
    ...t,
    mensual,
    porcentaje,
    cuota: t.flujo > 0 && redondeada > 0 ? redondeada : null,
    pendientes: txs.filter((x) => x.centavos === null),
  };
}

export function aFila(t: Transaccion): Fila {
  return {
    id_mensaje: t.mensaje_id,
    tipo: t.tipo,
    producto: t.producto,
    cantidad: String(t.cantidad),
    monto: t.centavos === null ? "" : formatoMonto(t.centavos),
    requiere_confirmacion: t.centavos === null ? "SI" : "NO",
  };
}
