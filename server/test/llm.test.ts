import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, test } from "vitest";
import { crearLlm } from "../src/llm.ts";

const servidores: Server[] = [];
afterEach(() => {
  for (const s of servidores.splice(0)) s.close();
});

interface Respuesta {
  status: number;
  cuerpo: unknown;
  cabeceras?: Record<string, string>;
}

async function falso(respuestas: Respuesta[]) {
  const visto: string[] = [];
  const servidor = createServer((req, res) => {
    const trozos: Buffer[] = [];
    req.on("data", (t: Buffer) => trozos.push(t));
    req.on("end", () => {
      visto.push(JSON.parse(Buffer.concat(trozos).toString()).model);
      const r = respuestas.shift() ?? { status: 500, cuerpo: {} };
      res.writeHead(r.status, {
        "content-type": "application/json",
        ...r.cabeceras,
      });
      res.end(JSON.stringify(r.cuerpo));
    });
  });
  await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
  servidores.push(servidor);
  const { port } = servidor.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}/v1`, visto };
}

const ok = (texto: string): Respuesta => ({
  status: 200,
  cuerpo: { choices: [{ message: { content: texto } }] },
});
const PETICION = { system: "s", user: "u", nombre: "n", esquema: {} };

test("a 5xx from Groq is answered by Gemini", async () => {
  const groq = await falso([
    { status: 503, cuerpo: { error: { message: "caído" } } },
  ]);
  const gemini = await falso([ok('{"de":"gemini"}')]);
  const cambios: unknown[] = [];
  const completar = crearLlm(
    { groq: "k", gemini: "k" },
    (e) => cambios.push(e),
    { groq: groq.base, gemini: gemini.base },
  );
  expect(await completar(PETICION)).toBe('{"de":"gemini"}');
  expect(groq.visto).toEqual(["openai/gpt-oss-120b"]);
  expect(gemini.visto).toHaveLength(1);
  expect(cambios).toHaveLength(1);
});

test("a 429 with a short wait is retried on Groq before Gemini is used", async () => {
  const groq = await falso([
    {
      status: 429,
      cuerpo: { error: { message: "tpm" } },
      cabeceras: { "retry-after": "1" },
    },
    ok('{"de":"groq"}'),
  ]);
  const gemini = await falso([ok('{"de":"gemini"}')]);
  const completar = crearLlm({ groq: "k", gemini: "k" }, undefined, {
    groq: groq.base,
    gemini: gemini.base,
  });
  expect(await completar(PETICION)).toBe('{"de":"groq"}');
  expect(groq.visto).toHaveLength(2);
  expect(gemini.visto).toHaveLength(0);
});

test("a 429 with a long wait goes to Gemini at once", async () => {
  const groq = await falso([
    {
      status: 429,
      cuerpo: { error: { message: "tpm" } },
      cabeceras: { "retry-after": "40" },
    },
  ]);
  const gemini = await falso([ok('{"de":"gemini"}')]);
  const completar = crearLlm({ groq: "k", gemini: "k" }, undefined, {
    groq: groq.base,
    gemini: gemini.base,
  });
  expect(await completar(PETICION)).toBe('{"de":"gemini"}');
  expect(groq.visto).toHaveLength(1);
});

test("when Gemini is down too, Groq is tried again after its rate-limit wait", async () => {
  const limite: Respuesta = {
    status: 429,
    cuerpo: { error: { message: "tpm" } },
    cabeceras: { "retry-after": "1" },
  };
  const groq = await falso([limite, limite, ok('{"de":"groq"}')]);
  const gemini = await falso([]);
  const completar = crearLlm({ groq: "k", gemini: "k" }, undefined, {
    groq: groq.base,
    gemini: gemini.base,
  });
  expect(await completar(PETICION)).toBe('{"de":"groq"}');
  expect(groq.visto).toHaveLength(3);
  expect(gemini.visto.length).toBeGreaterThan(0);
}, 20_000);

test("a client error from Groq is not hidden by the fallback", async () => {
  const groq = await falso([
    { status: 400, cuerpo: { error: { message: "malo" } } },
  ]);
  const gemini = await falso([ok("{}")]);
  const completar = crearLlm({ groq: "k", gemini: "k" }, undefined, {
    groq: groq.base,
    gemini: gemini.base,
  });
  await expect(completar(PETICION)).rejects.toThrow(/400/);
  expect(gemini.visto).toHaveLength(0);
});
