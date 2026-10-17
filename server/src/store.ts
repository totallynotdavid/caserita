import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { FilaNueva } from "./book.ts";
import type { Fila, Salida, Tipo, Transaccion } from "./types.ts";
import { aFila } from "./book.ts";

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS mensajes (
  id TEXT PRIMARY KEY,
  orden INTEGER NOT NULL,
  salida TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS transacciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mensaje_id TEXT NOT NULL REFERENCES mensajes(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('venta','gasto','fiado','cobro_fiado')),
  producto TEXT NOT NULL,
  cantidad REAL NOT NULL,
  centavos INTEGER CHECK (centavos IS NULL OR centavos > 0),
  cliente TEXT,
  credito_id INTEGER REFERENCES transacciones(id),
  pregunta INTEGER NOT NULL
);
`;

interface FilaSql {
  id: number;
  mensaje_id: string;
  tipo: string;
  producto: string;
  cantidad: number;
  centavos: number | null;
  cliente: string | null;
  credito_id: number | null;
}

function aTransaccion(r: FilaSql): Transaccion {
  return { ...r, tipo: r.tipo as Tipo };
}

/**
 * The one account: every row is Doña Rosa's week. The pending question is the
 * row without an amount whose message came last; its siblings follow in order.
 */
export class Store {
  readonly #db: DatabaseSync;

  constructor(ruta: string) {
    if (ruta !== ":memory:") mkdirSync(dirname(ruta), { recursive: true });
    this.#db = new DatabaseSync(ruta);
    this.#db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.#db.exec(ESQUEMA);
  }

  close(): void {
    this.#db.close();
  }

  /** Runs `fn` as one SQLite transaction; it rolls back if `fn` throws. */
  transaccion<T>(fn: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const resultado = fn();
      this.#db.exec("COMMIT");
      return resultado;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  reiniciar(): void {
    this.#db.exec("DELETE FROM transacciones; DELETE FROM mensajes;");
  }

  transacciones(): Transaccion[] {
    const filas = this.#db
      .prepare(
        "SELECT id, mensaje_id, tipo, producto, cantidad, centavos, cliente, credito_id FROM transacciones ORDER BY id",
      )
      .all() as unknown as FilaSql[];
    return filas.map(aTransaccion);
  }

  filas(): Fila[] {
    return this.transacciones().map(aFila);
  }

  /** The first answer given for a message already processed. */
  mensaje(id: string): Salida | undefined {
    const m = this.#db
      .prepare("SELECT salida FROM mensajes WHERE id = ?")
      .get(id) as { salida: string } | undefined;
    return m ? (JSON.parse(m.salida) as Salida) : undefined;
  }

  /** Registers a message. Returns its order, or null if the id was seen. */
  registrarMensaje(id: string): number | null {
    const previo = this.#db
      .prepare("SELECT 1 FROM mensajes WHERE id = ?")
      .get(id);
    if (previo) return null;
    const orden =
      ((
        this.#db.prepare("SELECT MAX(orden) AS m FROM mensajes").get() as {
          m: number | null;
        }
      ).m ?? 0) + 1;
    this.#db
      .prepare("INSERT INTO mensajes (id, orden, salida) VALUES (?, ?, '{}')")
      .run(id, orden);
    return orden;
  }

  fijarSalida(id: string, salida: Salida): void {
    this.#db
      .prepare("UPDATE mensajes SET salida = ? WHERE id = ?")
      .run(JSON.stringify(salida), id);
  }

  insertar(mensajeId: string, orden: number, fila: FilaNueva): Transaccion {
    const r = this.#db
      .prepare(
        "INSERT INTO transacciones (mensaje_id, tipo, producto, cantidad, centavos, cliente, credito_id, pregunta) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
      )
      .get(
        mensajeId,
        fila.tipo,
        fila.producto,
        fila.cantidad,
        fila.centavos,
        fila.cliente,
        fila.credito_id,
        orden,
      ) as { id: number };
    return {
      id: r.id,
      mensaje_id: mensajeId,
      tipo: fila.tipo,
      producto: fila.producto,
      cantidad: fila.cantidad,
      centavos: fila.centavos,
      cliente: fila.cliente,
      credito_id: fila.credito_id,
    };
  }

  /** Replaces what a pending row records once its amount is known. */
  completar(id: number, fila: FilaNueva): void {
    this.#db
      .prepare(
        "UPDATE transacciones SET producto = ?, centavos = ?, credito_id = ? WHERE id = ?",
      )
      .run(fila.producto, fila.centavos, fila.credito_id, id);
  }

  /**
   * Deletes the rows the latest message with rows added, and returns them. A
   * cobro always comes after the fiado it pays, so no kept row points at them.
   */
  borrarUltimas(): Transaccion[] {
    const filas = this.#db
      .prepare(
        "DELETE FROM transacciones WHERE pregunta = (SELECT MAX(pregunta) FROM transacciones) RETURNING id, mensaje_id, tipo, producto, cantidad, centavos, cliente, credito_id",
      )
      .all() as unknown as FilaSql[];
    return filas.map(aTransaccion).toSorted((a, b) => a.id - b.id);
  }

  /** The row the shopkeeper was last asked about, if any. */
  pendiente(): Transaccion | null {
    const r = this.#db
      .prepare(
        "SELECT id, mensaje_id, tipo, producto, cantidad, centavos, cliente, credito_id FROM transacciones WHERE centavos IS NULL ORDER BY pregunta DESC, id ASC LIMIT 1",
      )
      .get() as FilaSql | undefined;
    return r ? aTransaccion(r) : null;
  }
}
