import { crearExtractores } from "./extract.ts";
import type { Dependencias } from "./handle.ts";
import { clienteGroq, crearLlm } from "./llm.ts";
import { Store } from "./store.ts";
import { crearTranscriptor } from "./transcribe.ts";
import type { Config } from "./config.ts";

export function dependenciasReales(
  config: Config,
  store: Store,
  alCambiar?: (error: unknown) => void,
): Dependencias {
  const extractores = crearExtractores(
    crearLlm({ groq: config.groqKey, gemini: config.geminiKey }, alCambiar),
  );
  return {
    store,
    extraer: extractores.unico,
    extraerSemana: extractores.lote,
    transcribir: crearTranscriptor(clienteGroq(config.groqKey)),
  };
}
