import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  isLidUser,
  isPnUser,
  jidDecode,
  normalizeMessageContent,
  useMultiFileAuthState,
} from "baileys";
import type { WAMessage, WAMessageKey } from "baileys";
import type { Logger } from "pino";
import type { Manejador } from "./handle.ts";
import { AUDIO_ILEGIBLE, NO_PUDE } from "./reply.ts";
import type { Audio } from "./types.ts";

type Log = Pick<Logger, "info" | "warn" | "error">;

export interface Receptor {
  manejador: Pick<Manejador, "handle">;
  descargar: (mensaje: WAMessage) => Promise<Uint8Array>;
  responder: (jid: string, texto: string) => Promise<unknown>;
  presencia: (estado: "composing" | "paused", jid: string) => Promise<unknown>;
  log: Log;
  /** Whether to answer this chat; every chat is answered when absent. */
  permitido?: (key: WAMessageKey) => Promise<boolean>;
}

const numero = (jid: string | null | undefined) =>
  jid && isPnUser(jid) ? jidDecode(jid)?.user : undefined;

/**
 * Builds the sender check for a list of phone numbers (digits only). A chat
 * can arrive addressed by its LID, as it does when the sender shows a username
 * instead of a number; then the phone number is `remoteJidAlt`, the session's
 * LID mapping, or the LID WhatsApp gives for each listed number. A fresh
 * session knows no mapping, so the last lookup is the one that usually works.
 */
export function permitirNumeros(
  numeros: string[],
  mapeo: {
    pnDeLid: (lid: string) => Promise<string | null>;
    lidDePn: (pn: string) => Promise<string | null>;
  },
): ((key: WAMessageKey) => Promise<boolean>) | undefined {
  if (numeros.length === 0) return undefined;
  const permitidos = new Set(numeros);
  return async ({ remoteJid, remoteJidAlt }) => {
    for (const jid of [remoteJid, remoteJidAlt]) {
      const n = numero(jid);
      if (n && permitidos.has(n)) return true;
    }
    if (!remoteJid || !isLidUser(remoteJid)) return false;
    const n = numero(await mapeo.pnDeLid(remoteJid).catch(() => null));
    if (n !== undefined && permitidos.has(n)) return true;
    const usuario = jidDecode(remoteJid)?.user;
    const lids = await Promise.all(
      [...permitidos].map((p) =>
        mapeo.lidDePn(`${p}@s.whatsapp.net`).catch(() => null),
      ),
    );
    return lids.some((lid) => lid && jidDecode(lid)?.user === usuario);
  };
}

interface Upsert {
  type: string;
  messages: WAMessage[];
}

type Contenido =
  | { tipo: "texto"; texto: string }
  | { tipo: "audio"; mime: string };

export const CARPETA_CREDENCIALES = "whatsapp";
export const ARCHIVO_QR = "whatsapp-qr.txt";

const RECONEXION_MS = 3000;

/**
 * Returns the supported message content, or null for groups, status and
 * broadcast lists, the linked number's own messages, and other message types.
 */
function leer(mensaje: WAMessage): Contenido | null {
  const { id, remoteJid, fromMe } = mensaje.key;
  if (!id || !remoteJid || fromMe) return null;
  if (!isPnUser(remoteJid) && !isLidUser(remoteJid)) return null;
  const contenido = normalizeMessageContent(mensaje.message);
  if (!contenido) return null;
  if (contenido.audioMessage) {
    return {
      tipo: "audio",
      mime: contenido.audioMessage.mimetype ?? "audio/ogg",
    };
  }
  const texto = contenido.conversation ?? contenido.extendedTextMessage?.text;
  if (!texto || texto.trim() === "") return null;
  return { tipo: "texto", texto };
}

/**
 * The handler for `messages.upsert`. Messages run one at a time in arrival
 * order, downloads included, so a reply never overtakes the message before it.
 * The returned promise settles when every message of the event is answered.
 */
export function crearReceptor(
  deps: Receptor,
): (evento: Upsert) => Promise<void> {
  const { manejador, log } = deps;
  let cola: Promise<void> = Promise.resolve();

  async function textoDeRespuesta(
    mensaje: WAMessage,
    id: string,
    contenido: Contenido,
  ): Promise<string> {
    let audio: Audio | undefined;
    if (contenido.tipo === "audio") {
      try {
        audio = { bytes: await deps.descargar(mensaje), mime: contenido.mime };
      } catch (error) {
        log.warn({ error }, "no pude bajar un audio de whatsapp");
        return AUDIO_ILEGIBLE;
      }
    }
    try {
      const salida = await manejador.handle(
        audio
          ? { id, audio }
          : { id, texto: contenido.tipo === "texto" ? contenido.texto : "" },
      );
      return salida.respuesta;
    } catch (error) {
      log.error({ error }, "no pude procesar un mensaje de whatsapp");
      return NO_PUDE;
    }
  }

  async function atender(mensaje: WAMessage): Promise<void> {
    const contenido = leer(mensaje);
    if (!contenido) return;
    if (deps.permitido && !(await deps.permitido(mensaje.key))) {
      log.info("whatsapp: remitente fuera de la lista; no respondo");
      return;
    }
    const { id, remoteJid: jid } = mensaje.key as {
      id: string;
      remoteJid: string;
    };
    log.info({ tipo: contenido.tipo }, "whatsapp: mensaje recibido");
    await deps.presencia("composing", jid).catch(() => undefined);
    const texto = await textoDeRespuesta(mensaje, id, contenido);
    await deps.presencia("paused", jid).catch(() => undefined);
    await deps.responder(jid, texto);
  }

  return (evento) => {
    // Baileys uses `append` for history sync, not live messages.
    if (evento.type !== "notify") return cola;
    for (const mensaje of evento.messages) {
      cola = cola.then(() =>
        atender(mensaje).catch((error: unknown) =>
          log.error({ error }, "no pude responder en whatsapp"),
        ),
      );
    }
    return cola;
  };
}

export interface OpcionesWhatsapp {
  /** Folder of the SQLite file. The session and QR file live in it. */
  dataDir: string;
  manejador: Pick<Manejador, "handle">;
  log: Logger;
  /** Phone numbers, digits only, whose chats are answered; empty answers all. */
  permitidos?: string[];
  /** Opens one socket on the saved session; tests stand in for the network. */
  abrir?: (opciones: AperturaSocket) => Promise<SocketAbierto>;
}

interface AperturaSocket {
  carpeta: string;
  logger: Logger;
}

type Socket = ReturnType<typeof makeWASocket>;

export interface SocketAbierto {
  socket: Pick<
    Socket,
    | "ev"
    | "sendMessage"
    | "sendPresenceUpdate"
    | "updateMediaMessage"
    | "signalRepository"
  >;
  saveCreds: () => Promise<void>;
}

async function abrirReal({
  carpeta,
  logger,
}: AperturaSocket): Promise<SocketAbierto> {
  const { state, saveCreds } = await useMultiFileAuthState(carpeta);
  const socket = makeWASocket({
    auth: state,
    logger,
    markOnlineOnConnect: false,
  });
  return { socket, saveCreds };
}

/**
 * Connects the linked number and answers its one-to-one chats. This process
 * owns the socket: the next one is opened only after the previous one closed.
 * Resolves once the first socket is created; reconnects on its own.
 */
export async function iniciarWhatsapp(
  opciones: OpcionesWhatsapp,
): Promise<void> {
  const {
    dataDir,
    manejador,
    log,
    permitidos = [],
    abrir = abrirReal,
  } = opciones;
  const rutaQr = join(dataDir, ARCHIVO_QR);
  const logBaileys = log.child({ canal: "baileys" }, { level: "warn" });
  let socket: SocketAbierto["socket"] | undefined;

  const recibir = crearReceptor({
    manejador,
    log,
    permitido: permitirNumeros(permitidos, {
      pnDeLid: async (lid) =>
        socket ? socket.signalRepository.lidMapping.getPNForLID(lid) : null,
      lidDePn: async (pn) =>
        socket ? socket.signalRepository.lidMapping.getLIDForPN(pn) : null,
    }),
    descargar: (mensaje) =>
      downloadMediaMessage(
        mensaje,
        "buffer",
        {},
        {
          reuploadRequest: (m) => {
            if (!socket) throw new Error("Sin conexión de WhatsApp");
            return socket.updateMediaMessage(m);
          },
          logger: logBaileys,
        },
      ),
    responder: (jid, texto) => {
      if (!socket) throw new Error("Sin conexión de WhatsApp");
      return socket.sendMessage(jid, { text: texto });
    },
    presencia: (estado, jid) => {
      if (!socket) throw new Error("Sin conexión de WhatsApp");
      return socket.sendPresenceUpdate(estado, jid);
    },
  });

  // Every write and delete of the QR file is appended here, so they land in
  // the order the events came and a delete never runs before a pending write.
  let qrPendiente: Promise<void> = Promise.resolve();

  function enFilaQr(trabajo: () => Promise<void>): void {
    qrPendiente = qrPendiente.then(trabajo).catch((error: unknown) => {
      log.warn({ error }, "no pude actualizar el archivo del QR de whatsapp");
    });
  }

  function guardarQr(qr: string): void {
    log.info(`whatsapp qr: ${qr}`);
    enFilaQr(async () => {
      await mkdir(dataDir, { recursive: true });
      await writeFile(rutaQr, qr);
    });
  }

  function borrarQr(): void {
    enFilaQr(() => rm(rutaQr, { force: true }));
  }

  function reconectar(demora: number): void {
    setTimeout(() => {
      conectar().catch((error: unknown) => {
        log.error({ error }, "no pude abrir whatsapp; reintento");
        reconectar(RECONEXION_MS);
      });
    }, demora);
  }

  async function conectar(): Promise<void> {
    const { socket: actual, saveCreds } = await abrir({
      carpeta: join(dataDir, CARPETA_CREDENCIALES),
      logger: logBaileys,
    });
    socket = actual;
    actual.ev.on("creds.update", saveCreds);
    actual.ev.on("messages.upsert", (evento) => void recibir(evento));
    actual.ev.on("connection.update", (cambio) => {
      if (cambio.qr) guardarQr(cambio.qr);
      if (cambio.connection === "open") {
        log.info("whatsapp conectado");
        borrarQr();
      }
      if (cambio.connection !== "close") return;
      const codigo = (
        cambio.lastDisconnect?.error as
          | { output?: { statusCode?: number } }
          | undefined
      )?.output?.statusCode;
      if (codigo === DisconnectReason.loggedOut) {
        log.error(
          "whatsapp cerró la sesión; borre la carpeta de credenciales y vincule de nuevo",
        );
        borrarQr();
        return;
      }
      // Another client holds the session. Reconnecting would displace it and
      // the two would take turns until WhatsApp restricts the number.
      if (codigo === DisconnectReason.connectionReplaced) {
        log.error(
          "whatsapp: otro cliente tomó la sesión de este número; detengo el canal para no competir con él",
        );
        return;
      }
      log.warn({ codigo }, "whatsapp se desconectó; reconecto");
      reconectar(
        codigo === DisconnectReason.restartRequired ? 0 : RECONEXION_MS,
      );
    });
  }

  await conectar();
}
