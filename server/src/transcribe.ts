import type OpenAI from "openai";
import { toFile } from "openai";
import type { Audio } from "./types.ts";

export const MODELO_VOZ = "whisper-large-v3";
export const AUDIO_MAXIMO = 25 * 1024 * 1024;

/** Give Whisper the shop's vocabulary so it recognizes these terms. */
const VOCABULARIO =
  "Notas de una bodega en Lima: vendí, compré, pagué, fiado, le fié, me pagó, cobro, soles, céntimos, " +
  "gaseosa, cerveza, balón de gas, abarrotes sueltos, ventas sueltas, leche Gloria, aceite Primor, " +
  "atún, yogur, huevos, azúcar, proveedor, ayudante, mayorista, don Pepe, doña Rosa.";

const EXTENSIONES: Record<string, string> = {
  "audio/webm": "webm",
  "video/webm": "webm",
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "application/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/aac": "m4a",
  "video/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/flac": "flac",
};

export class TranscripcionError extends Error {}

/** The media type without parameters: "audio/ogg; codecs=opus" is "audio/ogg". */
export function tipoBase(mime: string): string {
  return (mime.split(";")[0] ?? "").trim().toLowerCase();
}

export function extensionDe(mime: string): string | undefined {
  return EXTENSIONES[tipoBase(mime)];
}

export type Transcriptor = (audio: Audio) => Promise<string>;

/** Audio bytes and a media type in, Spanish text out: Groq Whisper. */
export function crearTranscriptor(cliente: OpenAI): Transcriptor {
  return async (audio) => {
    const extension = extensionDe(audio.mime);
    if (!extension)
      throw new TranscripcionError(
        `Formato de audio no soportado: ${audio.mime}`,
      );
    if (audio.bytes.byteLength === 0)
      throw new TranscripcionError("El audio está vacío");
    if (audio.bytes.byteLength > AUDIO_MAXIMO)
      throw new TranscripcionError("El audio es muy largo");
    try {
      const archivo = await toFile(audio.bytes, `audio.${extension}`, {
        type: tipoBase(audio.mime),
      });
      const respuesta = await cliente.audio.transcriptions.create({
        file: archivo,
        model: MODELO_VOZ,
        language: "es",
        prompt: VOCABULARIO,
        temperature: 0,
        response_format: "json",
      });
      return respuesta.text.trim();
    } catch (error) {
      throw new TranscripcionError("No se pudo transcribir el audio", {
        cause: error,
      });
    }
  };
}
