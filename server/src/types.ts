export const TIPOS = ["venta", "gasto", "fiado", "cobro_fiado"] as const;
export type Tipo = (typeof TIPOS)[number];

/** One operation the model read from a message. Amounts are in soles. */
export interface Item {
  tipo: Tipo;
  producto: string;
  cantidad: number | null;
  precio_unitario: number | null;
  total_dicho: number | null;
  descuento: number | null;
  cliente: string | null;
}

export type Consulta = "cuota" | "resumen";

/** What the model read from one message. */
export interface Extraccion {
  personal: boolean;
  consulta: Consulta | null;
  respuesta_pendiente: {
    precio_unitario: number | null;
    total_dicho: number | null;
  } | null;
  items: Item[];
}

/** A recorded transaction. `centavos` is null while the amount is missing. */
export interface Transaccion {
  id: number;
  mensaje_id: string;
  tipo: Tipo;
  producto: string;
  cantidad: number;
  centavos: number | null;
  cliente: string | null;
  /** The credit a full payment settles; null for every other row. */
  credito_id: number | null;
}

/** A row as the CSV and the API show it. */
export interface Fila {
  id_mensaje: string;
  tipo: Tipo;
  producto: string;
  cantidad: string;
  monto: string;
  requiere_confirmacion: "SI" | "NO";
}

/** What a channel gets back for one message. */
export interface Salida {
  respuesta: string;
  /** The rows this message created or filled in. */
  filas: Fila[];
  /** The words heard in a voice note; absent for text. */
  transcripcion?: string;
}

export interface CreditoAbierto {
  id: number;
  cliente: string;
  producto: string;
  restante: number;
}

/** The state the extractor sees alongside the message. */
export interface Contexto {
  pendiente: Transaccion | null;
  creditos: CreditoAbierto[];
}

export type Extractor = (texto: string, ctx: Contexto) => Promise<Extraccion>;

export interface Audio {
  bytes: Uint8Array;
  mime: string;
}
