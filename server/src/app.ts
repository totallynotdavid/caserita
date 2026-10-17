import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { aFila, creditosAbiertos, estimarCuota } from "./book.ts";
import { escribirFilas, leerMensajes } from "./csv.ts";
import type { Manejador } from "./handle.ts";
import { formatoMonto } from "./money.ts";
import { aCentavos } from "./money.ts";
import { NO_PUDE, textoCuota } from "./reply.ts";
import type { Store } from "./store.ts";
import { AUDIO_MAXIMO, extensionDe, tipoBase } from "./transcribe.ts";

export interface AppDeps {
  manejador: Manejador;
  store: Store;
  /** Without a token, /api/semana refuses every request. */
  adminToken?: string | undefined;
  log?: { error: (obj: unknown, msg: string) => void } | undefined;
}

/** Room for the other fields and boundaries around a 25 MB file. */
const MARGEN_MULTIPART = 1024 * 1024;

function digest(valor: string): Buffer {
  return createHash("sha256").update(valor).digest();
}

function esAdmin(
  cabecera: string | undefined,
  token: string | undefined,
): boolean {
  if (!token || !cabecera?.startsWith("Bearer ")) return false;
  return timingSafeEqual(digest(cabecera.slice(7)), digest(token));
}

function idDeParametro(valor: string): number | null {
  if (!/^\d+$/.test(valor)) return null;
  const id = Number(valor);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function cantidadDeCuerpo(valor: unknown): number | undefined | null {
  if (valor === undefined) return undefined;
  if (
    typeof valor !== "number" ||
    !Number.isFinite(valor) ||
    valor <= 0 ||
    valor > 1_000_000
  )
    return null;
  return valor;
}

function montoDeCuerpo(valor: unknown): number | undefined | null {
  if (valor === undefined) return undefined;
  if (
    typeof valor !== "string" ||
    !/^\d+(?:\.\d{1,2})?$/.test(valor) ||
    Number(valor) <= 0 ||
    Number(valor) > 1_000_000 ||
    !Number.isFinite(Number(valor))
  )
    return null;
  return aCentavos(Number(valor));
}

export function crearApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.onError((error, c) => {
    deps.log?.error(error, "error no controlado");
    return c.json({ error: NO_PUDE }, 500);
  });

  // Counts bytes as they arrive, so an oversized upload is cut off before it is
  // buffered, with or without a Content-Length header.
  const limite = bodyLimit({
    maxSize: AUDIO_MAXIMO + MARGEN_MULTIPART,
    onError: (c) => c.json({ error: "El audio es muy largo" }, 413),
  });

  app.post("/api/mensaje", limite, async (c) => {
    const tipo = tipoBase(c.req.header("content-type") ?? "");
    if (tipo === "multipart/form-data") {
      const form = await c.req.parseBody().catch(() => null);
      const audio = form?.["audio"];
      if (!(audio instanceof File)) {
        return c.json({ error: "Falta el archivo 'audio'" }, 400);
      }
      if (audio.size > AUDIO_MAXIMO) {
        return c.json({ error: "El audio es muy largo" }, 413);
      }
      if (!extensionDe(audio.type)) {
        return c.json(
          {
            error: `Formato de audio no soportado: ${audio.type || "desconocido"}`,
          },
          415,
        );
      }
      const id =
        typeof form?.["id"] === "string" && form["id"] !== ""
          ? form["id"]
          : undefined;
      const bytes = new Uint8Array(await audio.arrayBuffer());
      return c.json(
        await deps.manejador.handle({ id, audio: { bytes, mime: audio.type } }),
      );
    }
    const cuerpo = (await c.req.json().catch(() => null)) as {
      texto?: unknown;
      id?: unknown;
    } | null;
    if (typeof cuerpo?.texto !== "string" || cuerpo.texto.trim() === "") {
      return c.json({ error: "Falta 'texto'" }, 400);
    }
    const id =
      typeof cuerpo.id === "string" && cuerpo.id !== "" ? cuerpo.id : undefined;
    return c.json(await deps.manejador.handle({ id, texto: cuerpo.texto }));
  });

  app.post("/api/semana", async (c) => {
    if (!esAdmin(c.req.header("authorization"), deps.adminToken)) {
      return c.json({ error: "No autorizado" }, 401);
    }
    let mensajes;
    try {
      mensajes = leerMensajes(await c.req.text());
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "CSV inválido" },
        400,
      );
    }
    const filas = await deps.manejador.semana(mensajes);
    return c.body(escribirFilas(filas), 200, {
      "content-type": "text/csv; charset=utf-8",
    });
  });

  app.get("/api/movimientos", (c) => c.json(deps.store.movimientos()));

  app.patch("/api/movimientos/:id", async (c) => {
    const id = idDeParametro(c.req.param("id"));
    if (id === null) return c.json({ error: "El id no es válido" }, 400);
    const cuerpo = (await c.req.json().catch(() => null)) as {
      cantidad?: unknown;
      monto?: unknown;
    } | null;
    if (
      !cuerpo ||
      (cuerpo.cantidad === undefined && cuerpo.monto === undefined)
    )
      return c.json({ error: "Indique la cantidad o el monto" }, 400);
    const cantidad = cantidadDeCuerpo(cuerpo.cantidad);
    const centavos = montoDeCuerpo(cuerpo.monto);
    if (cantidad === null)
      return c.json(
        { error: "La cantidad debe ser un número mayor que cero" },
        400,
      );
    if (centavos === null)
      return c.json(
        { error: "El monto debe ser soles positivos, por ejemplo 12.50" },
        400,
      );
    const existe = deps.store.transaccion(() =>
      deps.store.actualizarMovimiento(id, { cantidad, centavos }),
    );
    if (!existe) return c.json({ error: "No encontré ese movimiento" }, 404);
    return c.json({
      movimiento: deps.store.movimientos().find((x) => x.id === id),
    });
  });

  app.delete("/api/movimientos/:id", (c) => {
    const id = idDeParametro(c.req.param("id"));
    if (id === null) return c.json({ error: "El id no es válido" }, 400);
    const resultado = deps.store.transaccion(() =>
      deps.store.borrarMovimiento(id),
    );
    if (!resultado) return c.json({ error: "No encontré ese movimiento" }, 404);
    return c.json({
      borrado: true,
      cobro_borrado: resultado.cobroBorrado,
      mensaje: resultado.cobroBorrado
        ? "También borré el cobro que pagaba este fiado."
        : "Movimiento borrado.",
    });
  });

  app.delete("/api/movimientos", (c) => {
    deps.store.reiniciar();
    return c.json({ borrado: true });
  });

  app.get("/api/resumen", (c) => {
    const txs = deps.store.transacciones();
    const e = estimarCuota(txs);
    return c.json({
      ventas: formatoMonto(e.ventas),
      cobros_fiado: formatoMonto(e.cobros),
      gastos: formatoMonto(e.gastos),
      flujo_semanal: formatoMonto(e.flujo),
      fiado_abierto: formatoMonto(
        creditosAbiertos(txs).reduce((s, x) => s + x.restante, 0),
      ),
      pendientes: e.pendientes.map(aFila),
      estimacion: {
        flujo_mensual: formatoMonto(e.mensual),
        cuota: e.cuota === null ? null : formatoMonto(e.cuota),
        explicacion: textoCuota(e),
      },
    });
  });

  return app;
}
