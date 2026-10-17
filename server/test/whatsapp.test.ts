import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DisconnectReason } from "baileys";
import type { WAMessage } from "baileys";
import pino from "pino";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  crearReceptor,
  iniciarWhatsapp,
  permitirNumeros,
} from "../src/whatsapp.ts";
import type { SocketAbierto } from "../src/whatsapp.ts";
import {
  guion,
  item,
  lectura,
  manejadorDe,
  transcriptorFalso,
} from "./helpers.ts";

const RUTA = "51999111222@s.whatsapp.net";

const mensaje = (
  id: string,
  message: WAMessage["message"],
  key: Partial<WAMessage["key"]> = {},
): WAMessage => ({
  key: { remoteJid: RUTA, fromMe: false, id, ...key },
  messageTimestamp: 1_760_000_000,
  pushName: "Cliente",
  message,
});

const texto = (id: string, conversation: string, key = {}) =>
  mensaje(id, { conversation }, key);

const nota = (id: string, mimetype = "audio/ogg; codecs=opus") =>
  mensaje(id, {
    audioMessage: { mimetype, seconds: 4, ptt: true, fileLength: 5120 },
  });

const venta = lectura({
  items: [item({ tipo: "venta", producto: "pan", total_dicho: 2.5 })],
});

function canal(
  lecturas: Parameters<typeof guion>[0] = {},
  descargar: (m: WAMessage) => Promise<Uint8Array> = async () =>
    new Uint8Array([1, 2, 3]),
  permitido?: Parameters<typeof crearReceptor>[0]["permitido"],
) {
  const { manejador, store } = manejadorDe(guion(lecturas), {
    transcribir: transcriptorFalso("vendí pan 2.50"),
  });
  const enviados: { jid: string; texto: string }[] = [];
  const presencias: string[] = [];
  const lineas: string[] = [];
  const log = pino(
    { level: "info" },
    { write: (l: string) => void lineas.push(l) },
  );
  const recibir = crearReceptor({
    manejador,
    descargar,
    log,
    responder: async (jid, t) => void enviados.push({ jid, texto: t }),
    presencia: async (estado) => void presencias.push(estado),
    permitido,
  });
  return { recibir, store, enviados, presencias, lineas };
}

describe("only the listed numbers are answered", () => {
  const LID = "184467440737@lid";
  const LID_CONSULTADO = "777000111@lid";
  const permitido = permitirNumeros(["51999111222"], {
    pnDeLid: async (lid) => (lid === LID ? "51999111222@s.whatsapp.net" : null),
    lidDePn: async (pn) =>
      pn === "51999111222@s.whatsapp.net" ? "777000111:3@lid" : null,
  });

  test.each([
    ["by phone number", {}],
    ["from a linked device", { remoteJid: "51999111222:7@s.whatsapp.net" }],
    [
      "by LID with the number alongside",
      { remoteJid: "999@lid", remoteJidAlt: "51999111222@s.whatsapp.net" },
    ],
    ["by a LID the session maps to the number", { remoteJid: LID }],
    ["by a LID WhatsApp gives for the number", { remoteJid: LID_CONSULTADO }],
  ])("a listed sender addressed %s is answered", async (_n, key) => {
    const { recibir, enviados } = canal(
      { "vendí pan 2.50": venta },
      undefined,
      permitido,
    );
    await recibir({
      type: "notify",
      messages: [texto("P1", "vendí pan 2.50", key)],
    });
    expect(enviados).toHaveLength(1);
  });

  test.each([
    ["another number", { remoteJid: "51988000111@s.whatsapp.net" }],
    ["an unmapped LID", { remoteJid: "555@lid" }],
  ])("%s gets no reply and books nothing", async (_n, key) => {
    const { recibir, store, enviados, presencias } = canal(
      { "vendí pan 2.50": venta },
      undefined,
      permitido,
    );
    await recibir({
      type: "notify",
      messages: [texto("P2", "vendí pan 2.50", key)],
    });
    expect(store.transacciones()).toEqual([]);
    expect(enviados).toEqual([]);
    expect(presencias).toEqual([]);
  });

  test("an empty list answers everyone", () => {
    const nada = async () => null;
    expect(
      permitirNumeros([], { pnDeLid: nada, lidDePn: nada }),
    ).toBeUndefined();
  });
});

describe("which messages reach the handler", () => {
  test("a text message is booked and answered in the same chat", async () => {
    const { recibir, store, enviados } = canal({ "vendí pan 2.50": venta });
    await recibir({
      type: "notify",
      messages: [texto("A1", "vendí pan 2.50")],
    });
    expect(store.transacciones()).toHaveLength(1);
    expect(enviados).toHaveLength(1);
    expect(enviados[0]?.jid).toBe(RUTA);
    expect(enviados[0]?.texto).toContain("pan");
  });

  test("an extended text message, as WhatsApp sends links and replies, is read", async () => {
    const { recibir, store } = canal({ "vendí pan 2.50": venta });
    await recibir({
      type: "notify",
      messages: [
        mensaje("A2", { extendedTextMessage: { text: "vendí pan 2.50" } }),
      ],
    });
    expect(store.transacciones()).toHaveLength(1);
  });

  test("a voice note is downloaded, transcribed and booked", async () => {
    const bajados: string[] = [];
    const { recibir, store, enviados } = canal(
      { "vendí pan 2.50": venta },
      async (m) => {
        bajados.push(m.key.id ?? "");
        return new Uint8Array([9]);
      },
    );
    await recibir({ type: "notify", messages: [nota("V1")] });
    expect(bajados).toEqual(["V1"]);
    expect(store.transacciones()).toHaveLength(1);
    expect(enviados).toHaveLength(1);
  });

  test("a voice note that cannot be downloaded gets the apology and books nothing", async () => {
    const { recibir, store, enviados } = canal({}, async () => {
      throw new Error("expired media");
    });
    await recibir({ type: "notify", messages: [nota("V2")] });
    expect(store.transacciones()).toEqual([]);
    expect(enviados[0]?.texto).toContain("audio");
  });

  test.each([
    ["a group", texto("G1", "vendí pan 2.50", { remoteJid: "1203@g.us" })],
    [
      "a status update",
      texto("G2", "vendí pan 2.50", { remoteJid: "status@broadcast" }),
    ],
    [
      "a broadcast list",
      texto("G3", "vendí pan 2.50", { remoteJid: "1700000@broadcast" }),
    ],
    [
      "a channel",
      texto("G4", "vendí pan 2.50", { remoteJid: "1203@newsletter" }),
    ],
    [
      "a message the linked number sent",
      texto("G5", "vendí pan 2.50", { fromMe: true }),
    ],
    [
      "a sticker",
      mensaje("G6", { stickerMessage: { mimetype: "image/webp" } }),
    ],
    ["an image", mensaje("G7", { imageMessage: { mimetype: "image/jpeg" } })],
    ["a blank text", texto("G8", "   ")],
    ["a message WhatsApp could not decrypt", mensaje("G9", undefined)],
  ])("%s is ignored", async (_nombre, entrante) => {
    const { recibir, store, enviados, presencias } = canal({
      "vendí pan 2.50": venta,
    });
    await recibir({ type: "notify", messages: [entrante] });
    expect(store.transacciones()).toEqual([]);
    expect(enviados).toEqual([]);
    expect(presencias).toEqual([]);
  });

  test("history sync and appended messages are ignored", async () => {
    const { recibir, store, enviados } = canal({ "vendí pan 2.50": venta });
    await recibir({
      type: "append",
      messages: [texto("H1", "vendí pan 2.50")],
    });
    expect(store.transacciones()).toEqual([]);
    expect(enviados).toEqual([]);
  });

  test("a chat addressed by a LID is answered like any one-to-one chat", async () => {
    const { recibir, enviados } = canal({ "vendí pan 2.50": venta });
    const lid = "184467440737@lid";
    await recibir({
      type: "notify",
      messages: [texto("L1", "vendí pan 2.50", { remoteJid: lid })],
    });
    expect(enviados[0]?.jid).toBe(lid);
  });
});

describe("delivery", () => {
  test("a redelivered message adds no row and is answered with the same reply", async () => {
    const { recibir, store, enviados } = canal({ "vendí pan 2.50": venta });
    const entrante = texto("R1", "vendí pan 2.50");
    await recibir({ type: "notify", messages: [entrante] });
    await recibir({ type: "notify", messages: [entrante] });
    expect(store.transacciones()).toHaveLength(1);
    expect(enviados).toHaveLength(2);
    expect(enviados[1]?.texto).toBe(enviados[0]?.texto);
  });

  test("a payment sees the credit it pays even when its audio downloads slower", async () => {
    const fiado = lectura({
      items: [
        item({
          tipo: "fiado",
          producto: "aceite primor",
          total_dicho: 12,
          cliente: "don Pepe",
        }),
      ],
    });
    const pago = lectura({
      items: [
        item({
          tipo: "cobro_fiado",
          producto: "",
          total_dicho: 12,
          cliente: "don Pepe",
        }),
      ],
    });
    const { manejador, store } = manejadorDe(
      guion({ "fié aceite a don Pepe": fiado, "don Pepe pagó 12": pago }),
      { transcribir: transcriptorFalso("fié aceite a don Pepe") },
    );
    const enviados: string[] = [];
    const recibir = crearReceptor({
      manejador,
      log: pino({ level: "silent" }),
      descargar: () =>
        new Promise((listo) =>
          setTimeout(() => listo(new Uint8Array([1])), 40),
        ),
      responder: async (_jid, t) => void enviados.push(t),
      presencia: async () => undefined,
    });
    await Promise.all([
      recibir({ type: "notify", messages: [nota("O1")] }),
      recibir({ type: "notify", messages: [texto("O2", "don Pepe pagó 12")] }),
    ]);
    expect(store.transacciones().map((t) => t.tipo)).toEqual([
      "fiado",
      "cobro_fiado",
    ]);
    expect(store.transacciones()[1]?.producto).toBe("aceite primor");
    expect(enviados).toHaveLength(2);
  });

  test("it shows composing before the reply and a failure still gets an answer", async () => {
    const { recibir, presencias, enviados } = canal();
    await recibir({ type: "notify", messages: [texto("E1", "sin lectura")] });
    expect(presencias).toEqual(["composing", "paused"]);
    expect(enviados).toHaveLength(1);
    expect(enviados[0]?.texto).toContain("Intente de nuevo");
  });

  test("a failed send does not stop the next message", async () => {
    const { manejador, store } = manejadorDe(
      guion({ "vendí pan 2.50": venta }),
    );
    let intentos = 0;
    const recibir = crearReceptor({
      manejador,
      log: pino({ level: "silent" }),
      descargar: async () => new Uint8Array(),
      responder: async () => {
        intentos += 1;
        if (intentos === 1) throw new Error("socket closed");
      },
      presencia: async () => undefined,
    });
    await recibir({
      type: "notify",
      messages: [texto("S1", "vendí pan 2.50"), texto("S2", "vendí pan 2.50")],
    });
    expect(intentos).toBe(2);
    expect(store.transacciones()).toHaveLength(2);
  });
});

describe("logs", () => {
  test("info lines carry neither the message text nor the phone number", async () => {
    const { recibir, lineas } = canal({ "vendí pan 2.50": venta });
    await recibir({
      type: "notify",
      messages: [texto("P1", "vendí pan 2.50"), nota("P2")],
    });
    const info = lineas.join("");
    expect(info).not.toContain("pan 2.50");
    expect(info).not.toContain("51999111222");
  });
});

describe("the connection", () => {
  const carpetas: string[] = [];
  afterEach(() => {
    vi.useRealTimers();
    for (const c of carpetas.splice(0))
      rmSync(c, { recursive: true, force: true });
  });

  async function conectado() {
    const dataDir = mkdtempSync(join(tmpdir(), "caserita-wa-"));
    carpetas.push(dataDir);
    const sockets: { ev: EventEmitter; enviados: unknown[] }[] = [];
    const lineas: string[] = [];
    const { manejador } = manejadorDe(guion({ "vendí pan 2.50": venta }));
    await iniciarWhatsapp({
      dataDir,
      manejador,
      log: pino(
        { level: "info" },
        { write: (l: string) => void lineas.push(l) },
      ),
      abrir: async () => {
        const ev = new EventEmitter();
        const enviados: unknown[] = [];
        sockets.push({ ev, enviados });
        return {
          saveCreds: async () => undefined,
          socket: {
            ev,
            sendMessage: async (...args: unknown[]) => void enviados.push(args),
            sendPresenceUpdate: async () => undefined,
            updateMediaMessage: async (m: WAMessage) => m,
          } as unknown as SocketAbierto["socket"],
        };
      },
    });
    const cerrar = (statusCode: number) =>
      sockets.at(-1)?.ev.emit("connection.update", {
        connection: "close",
        lastDisconnect: { error: { output: { statusCode } } },
      });
    return { dataDir, sockets, lineas, cerrar };
  }

  test("each QR is logged and written to the QR file, which goes when the link opens", async () => {
    const { dataDir, sockets, lineas } = await conectado();
    const ev = sockets[0]?.ev;
    ev?.emit("connection.update", { qr: "2@primero" });
    ev?.emit("connection.update", { qr: "2@segundo" });
    await vi.waitFor(() =>
      expect(readFileSync(join(dataDir, "whatsapp-qr.txt"), "utf8")).toBe(
        "2@segundo",
      ),
    );
    expect(lineas.join("")).toContain("whatsapp qr: 2@primero");
    expect(lineas.join("")).toContain("whatsapp qr: 2@segundo");
    ev?.emit("connection.update", { connection: "open" });
    await vi.waitFor(() =>
      expect(existsSync(join(dataDir, "whatsapp-qr.txt"))).toBe(false),
    );
  });

  test("a QR followed at once by the link opening leaves no QR file", async () => {
    const { dataDir, sockets } = await conectado();
    const ev = sockets[0]?.ev;
    ev?.emit("connection.update", { qr: "2@ultimo" });
    ev?.emit("connection.update", { connection: "open" });
    await new Promise((listo) => setTimeout(listo, 100));
    expect(existsSync(join(dataDir, "whatsapp-qr.txt"))).toBe(false);
  });

  test("a text message arriving on the socket is answered through it", async () => {
    const { sockets } = await conectado();
    sockets[0]?.ev.emit("messages.upsert", {
      type: "notify",
      messages: [texto("C1", "vendí pan 2.50")],
    });
    await vi.waitFor(() => expect(sockets[0]?.enviados).toHaveLength(1));
    expect(sockets[0]?.enviados[0]).toEqual([
      RUTA,
      { text: expect.stringContaining("pan") },
    ]);
  });

  test("any close but a logout or a replaced session opens a new socket", async () => {
    vi.useFakeTimers();
    const { sockets, cerrar } = await conectado();
    cerrar(DisconnectReason.connectionLost);
    await vi.advanceTimersByTimeAsync(3000);
    expect(sockets).toHaveLength(2);
    cerrar(DisconnectReason.restartRequired);
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(3);
  });

  test.each([
    ["a logout", DisconnectReason.loggedOut, "cerró la sesión"],
    ["a replaced session", DisconnectReason.connectionReplaced, "otro cliente"],
  ])(
    "%s stops the channel with one clear line",
    async (_nombre, codigo, frase) => {
      vi.useFakeTimers();
      const { sockets, lineas, cerrar } = await conectado();
      cerrar(codigo);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(sockets).toHaveLength(1);
      expect(lineas.filter((l) => l.includes(frase))).toHaveLength(1);
    },
  );
});
