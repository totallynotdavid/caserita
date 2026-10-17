import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import OpenAI from "openai";
import { describe, expect, test } from "vitest";
import { crearApp } from "../src/app.ts";
import { crearTranscriptor } from "../src/transcribe.ts";
import {
  guion,
  item,
  lectura,
  manejadorDe,
  transcriptorFalso,
} from "./helpers.ts";

const ATUNES = lectura({
  items: [item({ tipo: "venta", producto: "atún", cantidad: 3 })],
});
const RESPUESTA = lectura({
  respuesta_pendiente: { precio_unitario: 4.5, total_dicho: null },
});

function appDe(
  extra: {
    adminToken?: string;
    transcribir?: ReturnType<typeof transcriptorFalso>;
  } = {},
) {
  const { manejador, store } = manejadorDe(
    guion({
      "vendí 3 atunes": ATUNES,
      "a 4.50 cada uno": RESPUESTA,
      "pagué el agua 45": lectura({
        items: [item({ tipo: "gasto", producto: "agua", total_dicho: 45 })],
      }),
      "vendí 10 panes a 0.30": lectura({
        items: [
          item({
            tipo: "venta",
            producto: "pan",
            cantidad: 10,
            precio_unitario: 0.3,
          }),
        ],
      }),
      "fié 2 atunes a Rosa por 20": lectura({
        items: [
          item({
            tipo: "fiado",
            producto: "atún",
            cantidad: 2,
            total_dicho: 20,
            cliente: "Rosa",
          }),
        ],
      }),
      "Rosa pagó 20": lectura({
        items: [
          item({
            tipo: "cobro_fiado",
            producto: "atún",
            total_dicho: 20,
            cliente: "Rosa",
          }),
        ],
      }),
    }),
    extra.transcribir ? { transcribir: extra.transcribir } : {},
  );
  return crearApp({ manejador, store, adminToken: extra.adminToken });
}

const json = (cuerpo: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(cuerpo),
});

describe("POST /api/mensaje", () => {
  test("asks for the missing price, then fills the row from the answer", async () => {
    const app = appDe();
    const primera = await app.request(
      "/api/mensaje",
      json({ texto: "vendí 3 atunes" }),
    );
    expect(primera.status).toBe(200);
    const uno = (await primera.json()) as {
      respuesta: string;
      filas: { monto: string; requiere_confirmacion: string }[];
    };
    expect(uno.respuesta).toContain("¿En cuánto vendió 3 atunes?");
    expect(uno.filas[0]).toMatchObject({
      monto: "",
      requiere_confirmacion: "SI",
    });

    const segunda = await app.request(
      "/api/mensaje",
      json({ texto: "a 4.50 cada uno" }),
    );
    const dos = (await segunda.json()) as {
      filas: { monto: string; requiere_confirmacion: string }[];
    };
    expect(dos.filas[0]).toMatchObject({
      monto: "13.50",
      requiere_confirmacion: "NO",
    });
  });

  test("rejects a body with no text", async () => {
    const res = await appDe().request("/api/mensaje", json({ texto: "  " }));
    expect(res.status).toBe(400);
  });

  test("takes a voice note as multipart, transcribes it and returns the transcription", async () => {
    const app = appDe({
      transcribir: transcriptorFalso("vendí 10 panes a 0.30"),
    });
    const form = new FormData();
    form.set(
      "audio",
      new File([new Uint8Array([1, 2, 3])], "nota.webm", {
        type: "audio/webm;codecs=opus",
      }),
    );
    const res = await app.request("/api/mensaje", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(200);
    const cuerpo = (await res.json()) as {
      transcripcion: string;
      filas: { producto: string; monto: string }[];
    };
    expect(cuerpo.transcripcion).toBe("vendí 10 panes a 0.30");
    expect(cuerpo.filas[0]).toMatchObject({ producto: "pan", monto: "3.00" });
  });

  test("refuses an audio format Whisper does not take", async () => {
    const app = appDe({ transcribir: transcriptorFalso("x") });
    const form = new FormData();
    form.set(
      "audio",
      new File([new Uint8Array([1])], "nota.txt", { type: "text/plain" }),
    );
    const res = await app.request("/api/mensaje", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(415);
  });

  test("cuts off an oversized upload while it arrives, even with no Content-Length", async () => {
    let llamadas = 0;
    const app = appDe({
      transcribir: async () => {
        llamadas++;
        return "x";
      },
    });
    const trozo = new Uint8Array(1024 * 1024);
    let enviados = 0;
    const cuerpo = new ReadableStream<Uint8Array>({
      pull(control) {
        // Far more than the limit; a reader that buffers it all would take it.
        if (enviados++ < 200) control.enqueue(trozo);
        else control.close();
      },
    });
    const res = await app.request("/api/mensaje", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x" },
      body: cuerpo,
      duplex: "half",
    } as RequestInit);
    expect(res.status).toBe(413);
    expect(enviados).toBeLessThan(40);
    expect(llamadas).toBe(0);
  });

  test("refuses at once an upload that declares a size over the limit", async () => {
    const res = await appDe().request("/api/mensaje", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=x",
        "content-length": String(30 * 1024 * 1024),
      },
      body: "--x--",
    });
    expect(res.status).toBe(413);
  });

  test("refuses multipart without an audio file", async () => {
    const form = new FormData();
    form.set("texto", "hola");
    const res = await appDe().request("/api/mensaje", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/semana", () => {
  const csv =
    "﻿id_mensaje,dia,mensaje\nM1,lunes,vendí 10 panes a 0.30\nM2,lunes,pagué el agua 45\n";

  test("needs the admin token", async () => {
    const app = appDe({ adminToken: "secreto" });
    expect(
      (await app.request("/api/semana", { method: "POST", body: csv })).status,
    ).toBe(401);
    const mala = await app.request("/api/semana", {
      method: "POST",
      body: csv,
      headers: { authorization: "Bearer otro" },
    });
    expect(mala.status).toBe(401);
  });

  test("refuses everyone when no token is configured", async () => {
    const res = await appDe().request("/api/semana", {
      method: "POST",
      body: csv,
      headers: { authorization: "Bearer " },
    });
    expect(res.status).toBe(401);
  });

  test("replaces the week and returns the output CSV", async () => {
    const app = appDe({ adminToken: "secreto" });
    await app.request(
      "/api/mensaje",
      json({ texto: "pagué el agua 45", id: "viejo" }),
    );
    const res = await app.request("/api/semana", {
      method: "POST",
      body: csv,
      headers: { authorization: "Bearer secreto" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(await res.text()).toBe(
      "id_mensaje,tipo,producto,cantidad,monto,requiere_confirmacion\nM1,venta,pan,10,3.00,NO\nM2,gasto,agua,1,45.00,NO\n",
    );
  });
});

describe("GET /api/resumen", () => {
  test("gives the totals, the cash flow and the payment estimate", async () => {
    const app = appDe();
    await app.request("/api/mensaje", json({ texto: "vendí 10 panes a 0.30" }));
    await app.request("/api/mensaje", json({ texto: "pagué el agua 45" }));
    await app.request("/api/mensaje", json({ texto: "vendí 3 atunes" }));
    const resumen = (await (
      await app.request("/api/resumen")
    ).json()) as Record<string, unknown>;
    expect(resumen).toMatchObject({
      ventas: "3.00",
      gastos: "45.00",
      flujo_semanal: "-42.00",
      estimacion: { cuota: null },
    });
    expect(resumen["pendientes"]).toHaveLength(1);
  });
});

describe("movimientos", () => {
  test("lists rows with dates and edits the amount and quantity", async () => {
    const app = appDe();
    await app.request(
      "/api/mensaje",
      json({ texto: "vendí 10 panes a 0.30", id: "venta-1" }),
    );
    const before = (await (await app.request("/api/movimientos")).json()) as {
      id: number;
      monto: string;
      dia: string;
      hora: string;
    }[];
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ monto: "3.00" });
    expect(before[0]?.dia).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(before[0]?.hora).toMatch(/^\d{2}:\d{2}$/);

    const editado = await app.request(`/api/movimientos/${before[0]!.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cantidad: 2, monto: "8.50" }),
    });
    expect(editado.status).toBe(200);
    const resumen = (await (await app.request("/api/resumen")).json()) as {
      ventas: string;
    };
    expect(resumen.ventas).toBe("8.50");
    const despues = (await (await app.request("/api/movimientos")).json()) as {
      cantidad: string;
      monto: string;
      requiere_confirmacion: string;
    }[];
    expect(despues[0]).toMatchObject({
      cantidad: "2",
      monto: "8.50",
      requiere_confirmacion: "NO",
    });
  });

  test("deleting a paid credit also deletes its payment", async () => {
    const app = appDe();
    await app.request(
      "/api/mensaje",
      json({ texto: "fié 2 atunes a Rosa por 20", id: "fiado-1" }),
    );
    await app.request(
      "/api/mensaje",
      json({ texto: "Rosa pagó 20", id: "cobro-1" }),
    );
    const movimientos = (await (
      await app.request("/api/movimientos")
    ).json()) as { id: number; tipo: string }[];
    const fiado = movimientos.find((x) => x.tipo === "fiado");
    const borrado = await app.request(`/api/movimientos/${fiado!.id}`, {
      method: "DELETE",
    });
    expect(await borrado.json()).toMatchObject({
      borrado: true,
      cobro_borrado: true,
    });
    expect(await (await app.request("/api/movimientos")).json()).toEqual([]);
  });

  test("clearing the account removes rows and the message log", async () => {
    const app = appDe();
    await app.request(
      "/api/mensaje",
      json({ texto: "vendí 10 panes a 0.30", id: "para-borrar" }),
    );
    expect(await (await app.request("/api/movimientos")).json()).toHaveLength(
      1,
    );
    expect(
      await (
        await app.request("/api/movimientos", { method: "DELETE" })
      ).json(),
    ).toEqual({
      borrado: true,
    });
    expect(await (await app.request("/api/movimientos")).json()).toEqual([]);

    await app.request(
      "/api/mensaje",
      json({ texto: "vendí 10 panes a 0.30", id: "para-borrar" }),
    );
    expect(await (await app.request("/api/movimientos")).json()).toHaveLength(
      1,
    );
  });

  test("rejects malformed movement edits", async () => {
    const app = appDe();
    const res = await app.request("/api/movimientos/no", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ monto: "S/ 4" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "El id no es válido" });
  });
});

describe("the Whisper request", () => {
  test("sends the file, the model, Spanish and the shop vocabulary to Groq", async () => {
    let cuerpo = Buffer.alloc(0);
    const servidor = createServer((req, res) => {
      const trozos: Buffer[] = [];
      req.on("data", (t: Buffer) => trozos.push(t));
      req.on("end", () => {
        cuerpo = Buffer.concat(trozos);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ text: " vendí tres gaseosas " }));
      });
    });
    await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
    try {
      const { port } = servidor.address() as AddressInfo;
      const cliente = new OpenAI({
        apiKey: "k",
        baseURL: `http://127.0.0.1:${port}/openai/v1`,
        maxRetries: 0,
      });
      const texto = await crearTranscriptor(cliente)({
        bytes: new Uint8Array([79, 103, 103, 83]),
        mime: "audio/ogg; codecs=opus",
      });
      expect(texto).toBe("vendí tres gaseosas");
      const crudo = cuerpo.toString("latin1");
      expect(crudo).toContain("whisper-large-v3");
      expect(crudo).toContain('name="language"\r\n\r\nes');
      expect(crudo).toContain("fiado");
      expect(crudo).toContain('filename="audio.ogg"');
    } finally {
      servidor.close();
    }
  });
});
