import { describe, expect, it } from "vitest";
import { extraerLote } from "../src/extract.ts";
import type { Peticion } from "../src/llm.ts";

const vacio = { pendiente: null, creditos: [] };

function resultado(n: number, producto: string) {
  return {
    n,
    personal: false,
    consulta: null,
    respuesta_pendiente: null,
    items: [
      {
        tipo: "venta",
        producto,
        cantidad: 1,
        precio_unitario: 2,
        total_dicho: null,
        descuento: null,
        cliente: null,
      },
    ],
  };
}

const vacia = async () => JSON.stringify({ resultados: [] });

describe("extraerLote", () => {
  it("keeps what the model answered and asks again only for the rest", async () => {
    const pedidos: Peticion[] = [];
    const respuestas = [
      { resultados: [resultado(1, "pan"), resultado(3, "leche")] },
      { resultados: [resultado(2, "huevos")] },
    ];
    const completar = async (p: Peticion) => {
      pedidos.push(p);
      return JSON.stringify(respuestas[pedidos.length - 1]);
    };

    const lectura = await extraerLote(completar, ["a", "b", "c"], vacio);

    expect(lectura.map((r) => r.items[0]?.producto)).toEqual([
      "pan",
      "huevos",
      "leche",
    ]);
    expect(pedidos).toHaveLength(2);
    expect(pedidos[1]!.user).toContain("RESPONDE SOLO LOS MENSAJES: 2");
    expect(pedidos[1]!.user).toContain("1. a\n2. b\n3. c");
    expect(pedidos[0]!.user).not.toContain("RESPONDE SOLO");
  });

  it("keeps the pending question and the numbering when it asks again", async () => {
    const pendiente = {
      id: 7,
      mensaje_id: "m0",
      tipo: "venta" as const,
      producto: "atún",
      cantidad: 3,
      centavos: null,
      cliente: null,
      credito_id: null,
    };
    let llamadas = 0;
    // A model that can only read an answer if the pending question is shown
    // with the message list.
    const completar = async (p: Peticion) => {
      llamadas++;
      const contexto = JSON.parse(
        p.user.slice("CONTEXTO: ".length, p.user.indexOf("\nMENSAJES:")),
      ) as { pendiente: string | null };
      if (llamadas === 1) {
        return JSON.stringify({ resultados: [resultado(2, "pan")] });
      }
      const respuesta = contexto.pendiente
        ? { precio_unitario: 4.5, total_dicho: null }
        : null;
      return JSON.stringify({
        resultados: [
          { ...resultado(1, "x"), items: [], respuesta_pendiente: respuesta },
        ],
      });
    };

    const lectura = await extraerLote(
      completar,
      ["a 4.50 cada uno", "vendí un pan a 2"],
      { pendiente, creditos: [] },
    );

    expect(lectura[0]?.respuesta_pendiente).toEqual({
      precio_unitario: 4.5,
      total_dicho: null,
    });
    expect(llamadas).toBe(2);
  });

  it("gives up when the model keeps leaving messages out", async () => {
    await expect(extraerLote(vacia, ["a"], vacio)).rejects.toThrow(
      "No pude leer",
    );
  });
});
