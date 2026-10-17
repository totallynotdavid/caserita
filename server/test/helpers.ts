import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { crearManejador } from "../src/handle.ts";
import type { Dependencias } from "../src/handle.ts";
import { Store } from "../src/store.ts";
import type { Transcriptor } from "../src/transcribe.ts";
import type { Extraccion, Extractor, Item } from "../src/types.ts";

const abiertas: { dir: string; store: Store }[] = [];

afterEach(() => {
  for (const { dir, store } of abiertas.splice(0)) {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

export function tiendaTemporal(): Store {
  const dir = mkdtempSync(join(tmpdir(), "caserita-"));
  const store = new Store(join(dir, "test.sqlite"));
  abiertas.push({ dir, store });
  return store;
}

export function item(
  parcial: Partial<Item> & Pick<Item, "tipo" | "producto">,
): Item {
  return {
    cantidad: null,
    precio_unitario: null,
    total_dicho: null,
    descuento: null,
    cliente: null,
    ...parcial,
  };
}

export function lectura(parcial: Partial<Extraccion> = {}): Extraccion {
  return {
    personal: false,
    consulta: null,
    respuesta_pendiente: null,
    items: [],
    ...parcial,
  };
}

export function guion(lecturas: Record<string, Extraccion>): Extractor {
  return async (texto) => {
    const leida = lecturas[texto];
    if (!leida) throw new Error(`Sin lectura para: ${texto}`);
    return leida;
  };
}

export function manejadorDe(
  extraer: Extractor,
  extra: Partial<Dependencias> = {},
) {
  const store = tiendaTemporal();
  const manejador = crearManejador({
    store,
    extraer,
    extraerSemana: () => extraer,
    ...extra,
  });
  return { store, manejador };
}

export function transcriptorFalso(texto: string): Transcriptor {
  return async () => texto;
}
