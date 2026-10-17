import { describe, expect, test } from "vitest";
import { TranscripcionError } from "../src/transcribe.ts";
import {
  guion,
  item,
  lectura,
  manejadorDe,
  transcriptorFalso,
} from "./helpers.ts";

const montos = (filas: { monto: string }[]) => filas.map((f) => f.monto);

describe("amounts", () => {
  test("a price per unit is exact to the cent and a discount comes off the line", async () => {
    const { manejador } = manejadorDe(
      guion({
        a: lectura({
          items: [
            item({
              tipo: "venta",
              producto: "chicle",
              cantidad: 7,
              precio_unitario: 1.15,
            }),
            item({
              tipo: "gasto",
              producto: "saco de arroz",
              cantidad: 2,
              precio_unitario: 95.5,
              descuento: 4.25,
            }),
          ],
        }),
      }),
    );
    const { filas } = await manejador.handle({ id: "a", texto: "a" });
    expect(montos(filas)).toEqual(["8.05", "186.75"]);
  });

  test("a stated total wins over quantity times price", async () => {
    const { manejador } = manejadorDe(
      guion({
        a: lectura({
          items: [
            item({
              tipo: "venta",
              producto: "pan",
              cantidad: 10,
              precio_unitario: 0.3,
              total_dicho: 2.5,
            }),
          ],
        }),
      }),
    );
    const { filas } = await manejador.handle({ id: "a", texto: "a" });
    expect(montos(filas)).toEqual(["2.50"]);
  });

  test("goods the key names in the plural keep that name, whatever the model wrote", async () => {
    const { manejador } = manejadorDe(
      guion({
        a: lectura({
          items: [
            item({
              tipo: "venta",
              producto: "Huevo",
              cantidad: 6,
              precio_unitario: 0.5,
            }),
          ],
        }),
      }),
    );
    const { filas } = await manejador.handle({ id: "a", texto: "a" });
    expect(filas.map((f) => f.producto)).toEqual(["huevos"]);
  });

  test("a personal purchase gives no row", async () => {
    const { manejador, store } = manejadorDe(
      guion({
        a: lectura({
          personal: true,
          items: [
            item({ tipo: "gasto", producto: "fideos", total_dicho: 5.6 }),
          ],
        }),
      }),
    );
    const salida = await manejador.handle({ id: "a", texto: "a" });
    expect(salida.filas).toEqual([]);
    expect(store.transacciones()).toEqual([]);
    expect(salida.respuesta).toContain("personal");
  });

  test("a repeated id adds no row and returns the first reply", async () => {
    const { manejador, store } = manejadorDe(
      guion({
        a: lectura({
          items: [item({ tipo: "gasto", producto: "agua", total_dicho: 45 })],
        }),
      }),
    );
    const primera = await manejador.handle({ id: "m1", texto: "a" });
    const segunda = await manejador.handle({ id: "m1", texto: "a" });
    expect(segunda).toEqual(primera);
    expect(store.transacciones()).toHaveLength(1);
  });
});

describe("a missing amount", () => {
  const atunes = lectura({
    items: [item({ tipo: "venta", producto: "atún", cantidad: 3 })],
  });

  test("is asked for, then a follow-up fills the row and clears SI", async () => {
    const { manejador, store } = manejadorDe(
      guion({
        "vendí 3 atunes": atunes,
        "a 4.50 cada uno": lectura({
          respuesta_pendiente: { precio_unitario: 4.5, total_dicho: null },
        }),
      }),
    );
    const primera = await manejador.handle({
      id: "1",
      texto: "vendí 3 atunes",
    });
    expect(primera.respuesta).toContain("¿En cuánto vendió 3 atunes?");
    expect(primera.respuesta).not.toContain("anoté");
    expect(primera.filas).toEqual([
      {
        id_mensaje: "1",
        tipo: "venta",
        producto: "atún",
        cantidad: "3",
        monto: "",
        requiere_confirmacion: "SI",
      },
    ]);

    const segunda = await manejador.handle({
      id: "2",
      texto: "a 4.50 cada uno",
    });
    expect(segunda.filas).toEqual([
      {
        id_mensaje: "1",
        tipo: "venta",
        producto: "atún",
        cantidad: "3",
        monto: "13.50",
        requiere_confirmacion: "NO",
      },
    ]);
    expect(store.transacciones()).toHaveLength(1);
    expect(store.pendiente()).toBeNull();
  });

  test("stays pending when the next message is about something else", async () => {
    const { manejador, store } = manejadorDe(
      guion({
        "vendí 3 atunes": atunes,
        "pagué el agua 45": lectura({
          items: [item({ tipo: "gasto", producto: "agua", total_dicho: 45 })],
        }),
      }),
    );
    await manejador.handle({ id: "1", texto: "vendí 3 atunes" });
    const otra = await manejador.handle({ id: "2", texto: "pagué el agua 45" });
    expect(otra.respuesta).not.toContain("atunes");
    expect(store.pendiente()?.producto).toBe("atún");
  });

  test("an answer with no figure asks again and changes nothing", async () => {
    const { manejador, store } = manejadorDe(
      guion({
        "vendí 3 atunes": atunes,
        "no sé": lectura({
          respuesta_pendiente: { precio_unitario: null, total_dicho: null },
        }),
      }),
    );
    await manejador.handle({ id: "1", texto: "vendí 3 atunes" });
    const respuesta = await manejador.handle({ id: "2", texto: "no sé" });
    expect(respuesta.respuesta).toContain("¿En cuánto vendió 3 atunes?");
    expect(store.pendiente()?.centavos).toBeNull();
  });

  test("the newest question is answered first and the older one comes back after", async () => {
    const { manejador } = manejadorDe(
      guion({
        "vendí 3 atunes": atunes,
        "compré bolsas": lectura({
          items: [item({ tipo: "gasto", producto: "bolsas" })],
        }),
        "fueron 12": lectura({
          respuesta_pendiente: { precio_unitario: null, total_dicho: 12 },
        }),
      }),
    );
    await manejador.handle({ id: "1", texto: "vendí 3 atunes" });
    const segunda = await manejador.handle({ id: "2", texto: "compré bolsas" });
    expect(segunda.respuesta).toContain("¿Cuánto pagó por bolsas?");
    const tercera = await manejador.handle({ id: "3", texto: "fueron 12" });
    expect(tercera.filas[0]).toMatchObject({
      id_mensaje: "2",
      producto: "bolsas",
      monto: "12.00",
    });
    expect(tercera.respuesta).toContain("¿En cuánto vendió 3 atunes?");
  });

  test("a message with nothing to book asks the open question again", async () => {
    const { manejador } = manejadorDe(
      guion({ "vendí 3 atunes": atunes, "como dije": lectura() }),
    );
    await manejador.handle({ id: "1", texto: "vendí 3 atunes" });
    const respuesta = await manejador.handle({ id: "2", texto: "como dije" });
    expect(respuesta.respuesta).toBe(
      "Perdone, no le entendí. ¿En cuánto vendió 3 atunes?",
    );
  });
});

describe("borra lo último", () => {
  test("deletes the latest message's rows without a model call and asks the open question", async () => {
    const { manejador, store } = manejadorDe(
      guion({
        "vendí 3 atunes": lectura({
          items: [item({ tipo: "venta", producto: "atún", cantidad: 3 })],
        }),
        "vendí 2 panes y compré 2 piñas a 1": lectura({
          items: [
            item({
              tipo: "venta",
              producto: "pan",
              cantidad: 2,
              total_dicho: 1,
            }),
            item({
              tipo: "gasto",
              producto: "piña",
              cantidad: 2,
              precio_unitario: 1,
            }),
          ],
        }),
      }),
    );
    await manejador.handle({ id: "1", texto: "vendí 3 atunes" });
    await manejador.handle({
      id: "2",
      texto: "vendí 2 panes y compré 2 piñas a 1",
    });
    const borrado = await manejador.handle({
      id: "3",
      texto: "Bórralo último... no, ¡borra lo último!",
    });
    expect(borrado.respuesta).toBe(
      "Listo, borré: venta de 2 panes por S/ 1.00; gasto de 2 piñas por S/ 2.00. ¿En cuánto vendió 3 atunes?",
    );
    expect(store.transacciones().map((t) => t.producto)).toEqual(["atún"]);

    await manejador.handle({ id: "4", texto: "Borra lo último." });
    const vacio = await manejador.handle({ id: "5", texto: "borra lo último" });
    expect(vacio.respuesta).toBe("No hay nada anotado para borrar.");
    expect(store.transacciones()).toEqual([]);
  });
});

describe("credit", () => {
  const fiado = lectura({
    items: [
      item({
        tipo: "fiado",
        producto: "arroz",
        cantidad: 2,
        total_dicho: 30,
        cliente: "doña Carmen",
      }),
    ],
  });

  test("a credit paid in two parts: the first is partial, the second takes what is left", async () => {
    const { manejador, store } = manejadorDe(
      guion({
        fiado,
        "me dio 10": lectura({
          items: [
            item({
              tipo: "cobro_fiado",
              producto: "",
              total_dicho: 10,
              cliente: "Doña Carmen",
            }),
          ],
        }),
        "pagó el resto": lectura({
          items: [
            item({
              tipo: "cobro_fiado",
              producto: "arroz",
              cliente: "doña Carmen",
            }),
          ],
        }),
      }),
    );
    await manejador.handle({ id: "1", texto: "fiado" });
    const parcial = await manejador.handle({ id: "2", texto: "me dio 10" });
    expect(parcial.filas[0]).toMatchObject({
      producto: "pago parcial Doña Carmen",
      monto: "10.00",
    });
    const resto = await manejador.handle({ id: "3", texto: "pagó el resto" });
    expect(resto.filas[0]).toMatchObject({
      tipo: "cobro_fiado",
      producto: "arroz",
      monto: "20.00",
      requiere_confirmacion: "NO",
    });
    const sobra = await manejador.handle({ id: "4", texto: "pagó el resto" });
    expect(sobra.filas[0]).toMatchObject({
      monto: "",
      requiere_confirmacion: "SI",
    });
    expect(store.transacciones().map((t) => t.centavos)).toEqual([
      3000,
      1000,
      2000,
      null,
    ]);
  });

  test("a payment with no amount for a credit whose amount was never given stays empty", async () => {
    const { manejador } = manejadorDe(
      guion({
        "le fié 2 cervezas a don Pepe": lectura({
          items: [
            item({
              tipo: "fiado",
              producto: "cerveza",
              cantidad: 2,
              cliente: "don Pepe",
            }),
          ],
        }),
        "don Pepe me pagó": lectura({
          items: [
            item({ tipo: "cobro_fiado", producto: "", cliente: "don Pepe" }),
          ],
        }),
        "eran 14": lectura({
          respuesta_pendiente: { precio_unitario: null, total_dicho: 14 },
        }),
      }),
    );
    await manejador.handle({ id: "1", texto: "le fié 2 cervezas a don Pepe" });
    const pago = await manejador.handle({ id: "2", texto: "don Pepe me pagó" });
    expect(pago.filas[0]).toMatchObject({
      tipo: "cobro_fiado",
      monto: "",
      requiere_confirmacion: "SI",
    });
    expect(pago.respuesta).toContain("¿Cuánto le pagó don Pepe?");
    const respuesta = await manejador.handle({ id: "3", texto: "eran 14" });
    expect(respuesta.filas[0]).toMatchObject({
      id_mensaje: "2",
      monto: "14.00",
      requiere_confirmacion: "NO",
    });
  });

  test("two customers with the same product do not mix", async () => {
    const { manejador } = manejadorDe(
      guion({
        a: lectura({
          items: [
            item({
              tipo: "fiado",
              producto: "aceite",
              total_dicho: 11,
              cliente: "Ana",
            }),
          ],
        }),
        b: lectura({
          items: [
            item({
              tipo: "fiado",
              producto: "aceite",
              total_dicho: 9,
              cliente: "Luis",
            }),
          ],
        }),
        c: lectura({
          items: [
            item({ tipo: "cobro_fiado", producto: "aceite", cliente: "Luis" }),
          ],
        }),
      }),
    );
    await manejador.handle({ id: "1", texto: "a" });
    await manejador.handle({ id: "2", texto: "b" });
    const cobro = await manejador.handle({ id: "3", texto: "c" });
    expect(cobro.filas[0]).toMatchObject({ producto: "aceite", monto: "9.00" });
  });
});

describe("the monthly payment question", () => {
  const ventas = lectura({
    items: [
      item({ tipo: "venta", producto: "ventas sueltas", total_dicho: 788.9 }),
    ],
  });
  const pregunta = lectura({ consulta: "cuota" });

  test("shows each step, rounds down to 10 soles and is not a loan approval", async () => {
    const { manejador } = manejadorDe(guion({ v: ventas, q: pregunta }));
    await manejador.handle({ id: "1", texto: "v" });
    const { respuesta } = await manejador.handle({ id: "2", texto: "q" });
    expect(respuesta).toContain(
      "Flujo semanal: S/ 788.90 + S/ 0.00 - S/ 0.00 = S/ 788.90.",
    );
    expect(respuesta).toContain(
      "Al mes: S/ 788.90 x 52 semanas / 12 meses = S/ 3418.57.",
    );
    expect(respuesta).toContain(
      "S/ 3418.57 x 30% = S/ 1025.57, redondeado hacia abajo de 10 en 10 soles",
    );
    expect(respuesta).toContain("unos S/ 1020.00 al mes");
    expect(respuesta).toContain("No es la aprobación de un préstamo");
  });

  test("names the rows still waiting for an amount and leaves them out", async () => {
    const { manejador } = manejadorDe(
      guion({
        v: ventas,
        atunes: lectura({
          items: [item({ tipo: "venta", producto: "atún", cantidad: 3 })],
        }),
        q: pregunta,
      }),
    );
    await manejador.handle({ id: "1", texto: "v" });
    await manejador.handle({ id: "2", texto: "atunes" });
    const { respuesta } = await manejador.handle({ id: "3", texto: "q" });
    expect(respuesta).toContain("unos S/ 1020.00");
    expect(respuesta).toContain("les falta el monto: venta de 3 atunes");
  });

  test("a flow of zero or less gives no amount and says why", async () => {
    const { manejador } = manejadorDe(
      guion({
        g: lectura({
          items: [item({ tipo: "gasto", producto: "agua", total_dicho: 45 })],
        }),
        q: pregunta,
      }),
    );
    await manejador.handle({ id: "1", texto: "g" });
    const { respuesta } = await manejador.handle({ id: "2", texto: "q" });
    expect(respuesta).toContain("S/ -45.00");
    expect(respuesta).toContain("no sobra plata");
    expect(respuesta).not.toContain("Podría pagar");
  });
});

describe("voice notes", () => {
  const venta = lectura({
    items: [
      item({
        tipo: "venta",
        producto: "pan",
        cantidad: 4,
        precio_unitario: 0.3,
      }),
    ],
  });

  test("are transcribed and handled like text, and the transcription comes back", async () => {
    const { manejador } = manejadorDe(
      guion({ "vendí 4 panes a 0.30": venta }),
      {
        transcribir: transcriptorFalso("vendí 4 panes a 0.30"),
      },
    );
    const salida = await manejador.handle({
      id: "v1",
      audio: {
        bytes: new Uint8Array([1, 2, 3]),
        mime: "audio/ogg; codecs=opus",
      },
    });
    expect(salida.transcripcion).toBe("vendí 4 panes a 0.30");
    expect(montos(salida.filas)).toEqual(["1.20"]);
  });

  test("a repeated note id returns the first answer, transcription included, without hearing it again", async () => {
    let oidos = 0;
    const { manejador } = manejadorDe(
      guion({ "vendí 4 panes a 0.30": venta }),
      {
        transcribir: async () => {
          oidos++;
          return "vendí 4 panes a 0.30";
        },
      },
    );
    const nota = {
      id: "v1",
      audio: { bytes: new Uint8Array([1, 2, 3]), mime: "audio/ogg" },
    };
    const primera = await manejador.handle(nota);
    const repetida = await manejador.handle(nota);
    expect(repetida).toEqual(primera);
    expect(repetida.transcripcion).toBe("vendí 4 panes a 0.30");
    expect(oidos).toBe(1);
  });

  test("a repeated id returns the rows the first answer showed, also one it filled in", async () => {
    const { manejador, store } = manejadorDe(
      guion({
        "vendí 3 atunes": lectura({
          items: [item({ tipo: "venta", producto: "atún", cantidad: 3 })],
        }),
        "a 4.50 cada uno": lectura({
          respuesta_pendiente: { precio_unitario: 4.5, total_dicho: null },
        }),
      }),
    );
    await manejador.handle({ id: "m1", texto: "vendí 3 atunes" });
    const primera = await manejador.handle({
      id: "m2",
      texto: "a 4.50 cada uno",
    });
    expect(montos(primera.filas)).toEqual(["13.50"]);
    expect(
      await manejador.handle({ id: "m2", texto: "a 4.50 cada uno" }),
    ).toEqual(primera);
    expect(store.transacciones()).toHaveLength(1);
  });

  test("an unreadable note records nothing and asks to send it again", async () => {
    const { manejador, store } = manejadorDe(guion({}), {
      transcribir: async () => {
        throw new TranscripcionError("no");
      },
    });
    const salida = await manejador.handle({
      id: "v1",
      audio: { bytes: new Uint8Array([1]), mime: "audio/webm" },
    });
    expect(salida.filas).toEqual([]);
    expect(salida.respuesta).toContain("audio");
    expect(store.mensaje("v1")).toBeUndefined();
  });

  test("a silent note is not recorded either", async () => {
    const { manejador } = manejadorDe(guion({}), {
      transcribir: transcriptorFalso(""),
    });
    const salida = await manejador.handle({
      audio: { bytes: new Uint8Array([1]), mime: "audio/webm" },
    });
    expect(salida.filas).toEqual([]);
    expect(salida.transcripcion).toBe("");
  });
});
