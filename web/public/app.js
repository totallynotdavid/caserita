const chat = document.getElementById("chat");
const botonHablar = document.getElementById("hablar");
const textoHablar = document.getElementById("hablar-texto");
const formulario = document.getElementById("formulario");
const campo = document.getElementById("texto");
const botones = document.querySelectorAll("button, input");

const PREGUNTA_CUOTA = "¿Cuánto puedo pagar de cuota al mes?";
const FORMATOS_AUDIO = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"];
/** A hold sends the note when the user releases the button. */
const MS_MANTENER = 600;
const MS_MINIMO = 700;

const SALUDO =
  "Hola, Doña Rosa. Cuénteme lo que vendió, compró o fió. Puede hablarme o escribirme.";
const MSG_MICROFONO =
  "No pude usar el micrófono. Active el permiso del micrófono en su navegador y toque el botón otra vez. Mientras tanto puede escribirme.";
const MSG_SIN_MICROFONO =
  "Este teléfono no me deja grabar la voz desde esta página. Puede escribirme su mensaje.";
const MSG_FALLO = "Ahora no pude responder. Intente de nuevo en un momento.";
const MSG_SIN_RED = "No hay conexión. Revise su internet e intente de nuevo.";
const MSG_CORTO =
  "No alcancé a escuchar nada. Toque el botón, hable y vuelva a tocarlo para enviar.";

let ocupado = false;
let grabacion = null;
let hablando = null;

function bajar() {
  chat.scrollTop = chat.scrollHeight;
}

function agregar(quien, texto, { etiqueta, aviso, espera } = {}) {
  const fila = document.createElement("div");
  fila.className = `fila ${quien}`;
  const burbuja = document.createElement("div");
  burbuja.className = "burbuja";
  if (aviso) burbuja.classList.add("aviso");
  if (espera) burbuja.classList.add("espera");
  if (etiqueta) {
    const marca = document.createElement("span");
    marca.className = "etiqueta";
    marca.textContent = etiqueta;
    burbuja.append(marca);
  }
  const parrafo = document.createElement("p");
  parrafo.textContent = texto;
  burbuja.append(parrafo);
  if (quien === "ella" && !espera && "speechSynthesis" in window) {
    burbuja.append(botonEscuchar(texto));
  }
  fila.append(burbuja);
  chat.append(fila);
  bajar();
  return { fila, parrafo };
}

function botonEscuchar(texto) {
  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "escuchar";
  boton.textContent = "🔊 Escuchar";
  boton.setAttribute("aria-pressed", "false");
  boton.addEventListener("click", () => {
    if (hablando === boton) {
      detenerVoz();
      return;
    }
    detenerVoz();
    leerEnVoz(texto, boton);
  });
  return boton;
}

function detenerVoz() {
  speechSynthesis.cancel();
  if (hablando) {
    hablando.textContent = "🔊 Escuchar";
    hablando.setAttribute("aria-pressed", "false");
    hablando = null;
  }
}

function elegirVoz() {
  const voces = speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith("es"));
  for (const lang of ["es-pe", "es-419", "es-mx", "es-us"]) {
    const voz = voces.find(
      (v) => v.lang.toLowerCase().replace("_", "-") === lang,
    );
    if (voz) return voz;
  }
  return voces[0];
}

function leerEnVoz(texto, boton) {
  const frase = new SpeechSynthesisUtterance(texto);
  const voz = elegirVoz();
  frase.voice = voz ?? null;
  frase.lang = voz?.lang ?? "es-PE";
  const terminar = () => {
    if (hablando === boton) detenerVoz();
  };
  frase.addEventListener("end", terminar);
  frase.addEventListener("error", terminar);
  hablando = boton;
  boton.textContent = "⏹ Parar";
  boton.setAttribute("aria-pressed", "true");
  speechSynthesis.speak(frase);
}

function bloquear(valor) {
  ocupado = valor;
  for (const elemento of botones) {
    if (elemento.classList.contains("escuchar")) continue;
    elemento.disabled = valor;
  }
}

function nuevoId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function soles(monto) {
  return `S/ ${monto}`;
}

function textoResumen(r) {
  const lineas = [
    `Esta semana: ventas ${soles(r.ventas)}, cobros de fiado ${soles(r.cobros_fiado)} y gastos ${soles(r.gastos)}. Su flujo de caja es ${soles(r.flujo_semanal)}.`,
  ];
  if (Number(r.fiado_abierto) > 0) {
    lineas.push(`Le deben ${soles(r.fiado_abierto)} en fiados.`);
  }
  if (r.pendientes.length > 0) {
    lineas.push(
      `Faltan montos en ${r.pendientes.length} anotaciones, y no las conté.`,
    );
  }
  return lineas.join("\n");
}

async function pedir(url, opciones) {
  let respuesta;
  try {
    respuesta = await fetch(url, opciones);
  } catch {
    throw new Error(MSG_SIN_RED);
  }
  if (!respuesta.ok) {
    throw new Error(
      respuesta.status === 413
        ? "El audio es muy largo. Mándelo más corto."
        : MSG_FALLO,
    );
  }
  return respuesta.json();
}

async function conEspera(trabajo) {
  bloquear(true);
  const espera = agregar("ella", "Caserita está escribiendo…", {
    espera: true,
  });
  try {
    await trabajo();
  } catch (error) {
    agregar("ella", error.message, { aviso: true });
  } finally {
    espera.fila.remove();
    bloquear(false);
  }
}

async function enviarTexto(texto) {
  agregar("yo", texto);
  await conEspera(async () => {
    const datos = await pedir("/api/mensaje", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ texto, id: nuevoId() }),
    });
    agregar("ella", datos.respuesta);
  });
}

async function enviarAudio(blob) {
  const burbuja = agregar("yo", "Nota de voz", { etiqueta: "🎤" });
  await conEspera(async () => {
    const extension = blob.type.includes("mp4") ? "mp4" : "webm";
    const form = new FormData();
    form.append("audio", blob, `nota.${extension}`);
    form.append("id", nuevoId());
    const datos = await pedir("/api/mensaje", { method: "POST", body: form });
    if (datos.transcripcion) {
      burbuja.parrafo.textContent = datos.transcripcion;
      burbuja.parrafo.previousElementSibling.textContent = "🎤 Entendí:";
    }
    agregar("ella", datos.respuesta);
  });
}

async function pedirResumen() {
  agregar("yo", "Resumen de la semana");
  await conEspera(async () => {
    agregar("ella", textoResumen(await pedir("/api/resumen")));
  });
}

function formatoDeGrabacion() {
  return FORMATOS_AUDIO.find((tipo) => MediaRecorder.isTypeSupported(tipo));
}

async function empezarGrabacion() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    agregar("ella", MSG_SIN_MICROFONO, { aviso: true });
    return;
  }
  let flujo;
  try {
    flujo = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    agregar("ella", MSG_MICROFONO, { aviso: true });
    return;
  }
  detenerVoz();
  const tipo = formatoDeGrabacion();
  const grabador = new MediaRecorder(flujo, tipo ? { mimeType: tipo } : {});
  const trozos = [];
  grabador.addEventListener("dataavailable", (e) => trozos.push(e.data));
  grabador.addEventListener("stop", () => {
    for (const pista of flujo.getTracks()) pista.stop();
    const duracion = Date.now() - grabacion.inicio;
    const blob = new Blob(trozos, { type: grabador.mimeType || tipo });
    grabacion = null;
    mostrarGrabando(false);
    if (duracion < MS_MINIMO || blob.size === 0) {
      agregar("ella", MSG_CORTO, { aviso: true });
      return;
    }
    enviarAudio(blob);
  });
  grabacion = { grabador, inicio: Date.now(), soltado: false };
  grabador.start();
  mostrarGrabando(true);
}

function mostrarGrabando(si) {
  botonHablar.classList.toggle("grabando", si);
  textoHablar.textContent = si
    ? "Grabando… toque para enviar"
    : "Toque para hablar";
}

function terminarGrabacion() {
  if (grabacion?.grabador.state === "recording") grabacion.grabador.stop();
}

let preparando = false;

botonHablar.addEventListener("pointerdown", async (evento) => {
  if (ocupado || evento.button > 0) return;
  if (grabacion) {
    terminarGrabacion();
    return;
  }
  if (preparando) return;
  preparando = true;
  const inicio = Date.now();
  const soltar = () => {
    // A short tap keeps recording. Releasing a hold sends the note.
    if (grabacion && Date.now() - inicio > MS_MANTENER) terminarGrabacion();
  };
  addEventListener("pointerup", soltar, { once: true });
  addEventListener("pointercancel", soltar, { once: true });
  try {
    await empezarGrabacion();
  } finally {
    preparando = false;
  }
});

// A keyboard or screen reader activates with click and no pointer.
botonHablar.addEventListener("click", async (evento) => {
  if (evento.detail !== 0 || ocupado) return;
  if (grabacion) terminarGrabacion();
  else await empezarGrabacion();
});

botonHablar.addEventListener("contextmenu", (e) => e.preventDefault());

formulario.addEventListener("submit", (evento) => {
  evento.preventDefault();
  const texto = campo.value.trim();
  if (!texto || ocupado) return;
  campo.value = "";
  enviarTexto(texto);
});

document.getElementById("resumen").addEventListener("click", pedirResumen);
document
  .getElementById("cuota")
  .addEventListener("click", () => enviarTexto(PREGUNTA_CUOTA));

agregar("ella", SALUDO);
