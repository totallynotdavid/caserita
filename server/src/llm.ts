import OpenAI from "openai";

export interface Peticion {
  system: string;
  user: string;
  nombre: string;
  esquema: Record<string, unknown>;
}

export type Completar = (p: Peticion) => Promise<string>;

export interface Claves {
  groq?: string | undefined;
  gemini?: string | undefined;
}

export const GROQ_URL = "https://api.groq.com/openai/v1";
export const GROQ_MODELO = "openai/gpt-oss-120b";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
const GEMINI_MODELO = "gemini-3.5-flash";

export function clienteGroq(
  clave: string | undefined,
  base: string = GROQ_URL,
): OpenAI {
  if (!clave) throw new Error("Falta GROQ_API_KEY");
  return new OpenAI({
    apiKey: clave,
    baseURL: base,
    maxRetries: 0,
    timeout: 45_000,
  });
}

function sePuedeReintentarEnOtro(error: unknown): boolean {
  if (error instanceof OpenAI.APIConnectionError) return true;
  return (
    error instanceof OpenAI.APIError &&
    error.status !== undefined &&
    (error.status === 429 || error.status >= 500)
  );
}

async function pedir(
  cliente: OpenAI,
  modelo: string,
  p: Peticion,
  extra: object,
): Promise<string> {
  const respuesta = await cliente.chat.completions.create({
    model: modelo,
    temperature: 0,
    messages: [
      { role: "system", content: p.system },
      { role: "user", content: p.user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: p.nombre, strict: true, schema: p.esquema },
    },
    ...extra,
  });
  const texto = respuesta.choices[0]?.message.content;
  if (!texto) throw new Error("El modelo no devolvió contenido");
  return texto;
}

const ESPERA_CORTA_S = 15;
// Retry Groq when its rate-limit response gives a delay of at most 60 seconds.
const ESPERA_ULTIMA_S = 60;

function esperaPedida(error: unknown, maximo: number): number | null {
  if (!(error instanceof OpenAI.RateLimitError)) return null;
  const segundos = Number(error.headers?.get("retry-after"));
  return segundos > 0 && segundos <= maximo ? segundos : null;
}

const dormir = (s: number) => new Promise((ok) => setTimeout(ok, s * 1000));

export function crearLlm(
  claves: Claves,
  alCambiar?: (error: unknown) => void,
  bases: { groq?: string; gemini?: string } = {},
): Completar {
  const groq = clienteGroq(claves.groq, bases.groq);
  const gemini = claves.gemini
    ? new OpenAI({
        apiKey: claves.gemini,
        baseURL: bases.gemini ?? GEMINI_URL,
        maxRetries: 2,
        timeout: 60_000,
      })
    : null;
  return async (p) => {
    const enGroq = () =>
      pedir(groq, GROQ_MODELO, p, { reasoning_effort: "low" });
    let falloGroq: unknown;
    try {
      return await enGroq();
    } catch (error) {
      falloGroq = error;
    }
    const corta = esperaPedida(falloGroq, ESPERA_CORTA_S);
    if (corta !== null) {
      await dormir(corta + 0.5);
      try {
        return await enGroq();
      } catch (error) {
        falloGroq = error;
      }
    }
    if (!gemini || !sePuedeReintentarEnOtro(falloGroq)) throw falloGroq;
    alCambiar?.(falloGroq);
    try {
      return await pedir(gemini, GEMINI_MODELO, p, {});
    } catch (errorGemini) {
      const ultima = esperaPedida(falloGroq, ESPERA_ULTIMA_S);
      if (ultima === null) throw errorGemini;
      await dormir(ultima + 0.5);
      return enGroq();
    }
  };
}
