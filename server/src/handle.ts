import { randomUUID } from "node:crypto";
import {
  aFila,
  creditosAbiertos,
  estimarCuota,
  montoDeRespuesta,
  planificar,
  totales,
} from "./book.ts";
import type { MensajeEntrada } from "./csv.ts";
import {
  AUDIO_ILEGIBLE,
  MONTO_NO_ENTENDIDO,
  PERSONAL,
  SIN_NADA,
  confirmacion,
  pregunta,
  respuestaCompletada,
  textoCuota,
  textoResumen,
} from "./reply.ts";
import type { Store } from "./store.ts";
import { TranscripcionError } from "./transcribe.ts";
import type { Transcriptor } from "./transcribe.ts";
import type {
  Audio,
  Extraccion,
  Extractor,
  Fila,
  Salida,
  Transaccion,
} from "./types.ts";

export type Entrada = { id?: string } & (
  | { texto: string; audio?: undefined }
  | { audio: Audio; texto?: undefined }
);

export interface Dependencias {
  store: Store;
  extraer: Extractor;
  extraerSemana: (textos: string[]) => Extractor;
  transcribir?: Transcriptor | undefined;
}

export interface Manejador {
  handle: (entrada: Entrada) => Promise<Salida>;
  semana: (mensajes: MensajeEntrada[]) => Promise<Fila[]>;
}

/**
 * Messages run one at a time, in arrival order, so each extraction sees the
 * state left by the preceding message.
 */
export function crearManejador(deps: Dependencias): Manejador {
  const { store } = deps;
  let cola: Promise<unknown> = Promise.resolve();

  function enCola<T>(trabajo: () => Promise<T>): Promise<T> {
    const resultado = cola.then(trabajo, trabajo);
    cola = resultado.catch(() => undefined);
    return resultado;
  }

  async function procesar(
    entrada: Entrada,
    extraer: Extractor,
  ): Promise<Salida> {
    const id = entrada.id ?? randomUUID();
    const previo = store.mensaje(id);
    if (previo) return previo;

    let texto: string;
    let transcripcion: string | undefined;
    if (entrada.audio) {
      if (!deps.transcribir)
        throw new Error("La transcripción no está configurada");
      try {
        transcripcion = await deps.transcribir(entrada.audio);
      } catch (error) {
        if (!(error instanceof TranscripcionError)) throw error;
        return { respuesta: AUDIO_ILEGIBLE, filas: [], transcripcion: "" };
      }
      if (transcripcion === "") {
        return { respuesta: AUDIO_ILEGIBLE, filas: [], transcripcion };
      }
      texto = transcripcion;
    } else {
      texto = entrada.texto;
    }

    const txs = store.transacciones();
    const extraccion = await extraer(texto, {
      pendiente: store.pendiente(),
      creditos: creditosAbiertos(txs),
    });
    return store.transaccion(() => aplicar(id, extraccion, transcripcion));
  }

  function aplicar(
    id: string,
    ext: Extraccion,
    transcripcion: string | undefined,
  ): Salida {
    const orden = store.registrarMensaje(id);
    if (orden === null) throw new Error(`Mensaje repetido: ${id}`);

    const tocadas: number[] = [];
    let completada: Transaccion | null = null;
    let noEntendido = false;

    const pendiente = store.pendiente();
    if (pendiente && ext.respuesta_pendiente) {
      const monto = montoDeRespuesta(pendiente, ext.respuesta_pendiente);
      if (monto === null) {
        noEntendido = true;
      } else {
        const otras = store
          .transacciones()
          .filter((t) => t.id !== pendiente.id);
        const fila = planificar(
          {
            tipo: pendiente.tipo,
            producto:
              pendiente.tipo === "cobro_fiado" ? "" : pendiente.producto,
            cantidad: pendiente.cantidad,
            precio_unitario: ext.respuesta_pendiente.precio_unitario,
            total_dicho: ext.respuesta_pendiente.total_dicho,
            descuento: null,
            cliente: pendiente.cliente,
          },
          otras,
        );
        store.completar(pendiente.id, fila);
        tocadas.push(pendiente.id);
        completada = { ...pendiente, ...fila, id: pendiente.id };
      }
    }

    const nuevas: Transaccion[] = [];
    if (!ext.personal) {
      for (const item of ext.items) {
        const fila = planificar(item, store.transacciones());
        nuevas.push(store.insertar(id, orden, fila));
      }
    }
    tocadas.push(...nuevas.map((t) => t.id));

    const todas = store.transacciones();
    const cabeza = store.pendiente();
    const partes: string[] = [];
    if (completada) {
      partes.push(
        respuestaCompletada(completada, nuevas.length > 0 ? null : cabeza),
      );
    }
    if (nuevas.length > 0) {
      const preguntar = nuevas.some((t) => t.centavos === null) ? cabeza : null;
      partes.push(confirmacion(nuevas, preguntar));
    }
    if (ext.consulta === "cuota") partes.push(textoCuota(estimarCuota(todas)));
    if (ext.consulta === "resumen") {
      const fiados = creditosAbiertos(todas).reduce(
        (s, c) => s + c.restante,
        0,
      );
      partes.push(
        textoResumen(
          totales(todas),
          todas.filter((t) => t.centavos === null),
          fiados,
        ),
      );
    }
    if (partes.length === 0) {
      if (noEntendido && cabeza)
        partes.push(`${MONTO_NO_ENTENDIDO} ${pregunta(cabeza)}`);
      else partes.push(ext.personal ? PERSONAL : SIN_NADA);
    }
    const respuesta = partes.join("\n");
    const salida: Salida = {
      respuesta,
      filas: todas.filter((t) => tocadas.includes(t.id)).map(aFila),
    };
    if (transcripcion !== undefined) salida.transcripcion = transcripcion;
    store.fijarSalida(id, salida);
    return salida;
  }

  return {
    handle: (entrada) => enCola(() => procesar(entrada, deps.extraer)),
    semana: (mensajes) =>
      enCola(async () => {
        store.reiniciar();
        const textos = mensajes.map((m) => m.texto);
        const extraer = deps.extraerSemana(textos);
        for (const [i, m] of mensajes.entries()) {
          // Each message must finish before the next one reads the store.
          // oxlint-disable-next-line no-await-in-loop
          await procesar(
            { id: m.id || `fila-${i + 1}`, texto: m.texto },
            extraer,
          );
        }
        return store.filas();
      }),
  };
}
