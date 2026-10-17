const chat = document.getElementById("chat");
const botonHablar = document.getElementById("hablar");
const textoHablar = document.getElementById("hablar-texto");
const formulario = document.getElementById("formulario");
const campo = document.getElementById("texto");
const botones = document.querySelectorAll("button, input");
const vistaChat = document.getElementById("chat-vista");
const vistaCuentas = document.getElementById("cuentas-vista");
const tabChat = document.getElementById("tab-chat");
const tabCuentas = document.getElementById("tab-cuentas");
const cuentasContenido = document.getElementById("cuentas-contenido");
const editor = document.getElementById("editor");
const editorForm = document.getElementById("editor-form");
const editorTitulo = document.getElementById("editor-titulo");
const editorCantidad = document.getElementById("editor-cantidad");
const editorMonto = document.getElementById("editor-monto");
const editorAviso = document.getElementById("editor-aviso");
const borrarPaso = document.getElementById("borrar-paso");
const borrarPregunta = document.getElementById("borrar-pregunta");
const limpiarDialogo = document.getElementById("limpiar-dialogo");

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
let movimientoActual = null;

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
  if (!("speechSynthesis" in window)) return;
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
  for (const control of botones) {
    if (control.classList.contains("escuchar")) continue;
    control.disabled = valor;
  }
}

function nuevoId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function soles(monto) {
  return `S/ ${monto || "0.00"}`;
}

function sumarSoles(...montos) {
  const centavos = montos.reduce(
    (total, monto) => total + Math.round(Number(monto || 0) * 100),
    0,
  );
  const signo = centavos < 0 ? "-" : "";
  const valor = Math.abs(centavos);
  return `${signo}${Math.floor(valor / 100)}.${String(valor % 100).padStart(2, "0")}`;
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
  const datos = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    throw new Error(
      datos?.error ||
        (respuesta.status === 413
          ? "El audio es muy largo. Mándelo más corto."
          : MSG_FALLO),
    );
  }
  return datos;
}

async function conEspera(trabajo) {
  bloquear(true);
  const espera = agregar("ella", "Caserita está escribiendo…", {
    espera: true,
  });
  try {
    await trabajo();
  } catch (error) {
    agregar("ella", error instanceof Error ? error.message : MSG_FALLO, {
      aviso: true,
    });
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

function elemento(tipo, clase, texto) {
  const nodo = document.createElement(tipo);
  if (clase) nodo.className = clase;
  if (texto !== undefined) nodo.textContent = texto;
  return nodo;
}

const TIPO = {
  venta: { palabra: "Venta", clase: "entra", verbo: "venta" },
  gasto: { palabra: "Gasto", clase: "sale", verbo: "gasto" },
  fiado: { palabra: "Fiado", clase: "fiado", verbo: "fiado" },
  cobro_fiado: { palabra: "Cobro", clase: "entra", verbo: "cobro" },
};

function formatoDia(dia) {
  const partes = dia.split("-").map(Number);
  if (partes.length !== 3 || partes.some((x) => !x)) return dia;
  const fecha = new Date(Date.UTC(partes[0], partes[1] - 1, partes[2]));
  const texto = new Intl.DateTimeFormat("es-PE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(fecha);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function detalleMovimiento(movimiento) {
  const tipo = TIPO[movimiento.tipo] || TIPO.venta;
  const cantidad = movimiento.cantidad === "1" ? "1" : movimiento.cantidad;
  const titulo = elemento(
    "strong",
    "movimiento-producto",
    `${cantidad} ${movimiento.producto}`,
  );
  const meta = elemento("span", "movimiento-meta", tipo.palabra);
  if (movimiento.cliente) meta.append(` · ${movimiento.cliente}`);
  const info = elemento("span", "movimiento-info");
  info.append(meta, titulo);
  return info;
}

function descripcionBorrado(movimiento) {
  const tipo = TIPO[movimiento.tipo] || TIPO.venta;
  return `¿Borrar esta ${tipo.verbo} de ${movimiento.cantidad} ${movimiento.producto}?`;
}

function botonMovimiento(movimiento) {
  const tipo = TIPO[movimiento.tipo] || TIPO.venta;
  const boton = elemento("button", `movimiento ${tipo.clase}`);
  boton.type = "button";
  const marca = elemento("span", "movimiento-marca", tipo.palabra);
  const monto = elemento(
    "strong",
    `movimiento-monto ${movimiento.tipo === "gasto" ? "negativo" : ""}`,
    movimiento.monto ? soles(movimiento.monto) : "Falta monto",
  );
  boton.append(marca, detalleMovimiento(movimiento), monto);
  boton.addEventListener("click", () => abrirEditor(movimiento));
  return boton;
}

function campoPendiente(movimiento) {
  const articulo = elemento("article", "pendiente-fila");
  const cabecera = elemento("div", "pendiente-cabecera");
  cabecera.append(
    elemento("span", "pendiente-etiqueta", "Falta monto"),
    elemento("span", "pendiente-hora", movimiento.hora),
  );
  const titulo = elemento(
    "strong",
    "pendiente-titulo",
    `${movimiento.cantidad} ${movimiento.producto}`,
  );
  const tipo = TIPO[movimiento.tipo] || TIPO.venta;
  const descripcion = elemento(
    "p",
    "pendiente-descripcion",
    `${tipo.palabra}${movimiento.cliente ? ` · ${movimiento.cliente}` : ""}`,
  );
  const form = elemento("form", "pendiente-form");
  const input = elemento("input");
  input.type = "text";
  input.inputMode = "decimal";
  input.placeholder = "¿Cuánto fue?";
  input.setAttribute("aria-label", `Monto de ${movimiento.producto}`);
  const guardar = elemento("button", "boton-principal", "Guardar");
  guardar.type = "submit";
  form.append(input, guardar);
  form.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    if (!input.value.trim()) return input.focus();
    await cambiarMovimiento(movimiento.id, { monto: input.value.trim() });
  });
  articulo.append(cabecera, titulo, descripcion, form);
  articulo.addEventListener("click", (evento) => {
    if (evento.target === articulo || evento.target === titulo)
      abrirEditor(movimiento);
  });
  return articulo;
}

function crearResumen(resumen) {
  const bloque = elemento("section", "resumen-cuentas");
  const encabezado = elemento("div", "cuentas-encabezado");
  encabezado.append(
    elemento("div", "cuentas-titulo", "Esta semana"),
    elemento("span", "cuentas-subtitulo", "Sus cuentas al día"),
  );
  const cifras = elemento("div", "cifras");
  const datos = [
    ["Entró", sumarSoles(resumen.ventas, resumen.cobros_fiado), "cifra-entra"],
    ["Salió", resumen.gastos, "cifra-sale"],
    [
      "Quedó",
      resumen.flujo_semanal,
      Number(resumen.flujo_semanal) < 0 ? "cifra-sale" : "cifra-flujo",
    ],
  ];
  for (const [nombre, monto, clase] of datos) {
    const cifra = elemento("div", `cifra ${clase}`);
    cifra.append(
      elemento("span", "cifra-nombre", nombre),
      elemento("strong", "cifra-monto", soles(monto)),
    );
    cifras.append(cifra);
  }
  const fiado = elemento("div", "fiado-total");
  fiado.append(
    elemento("span", "fiado-label", "Le deben"),
    elemento("strong", "fiado-monto", soles(resumen.fiado_abierto)),
  );
  const estimacion = elemento(
    "p",
    "estimacion",
    resumen.estimacion.explicacion,
  );
  bloque.append(encabezado, cifras, fiado, estimacion, crearBotonLimpiar());
  return bloque;
}

function crearMovimientos(movimientos) {
  const bloque = elemento("section", "lista-cuentas");
  const confirmados = movimientos.filter((movimiento) => movimiento.monto);
  if (confirmados.length === 0) return bloque;
  const grupos = new Map();
  for (const movimiento of confirmados) {
    const grupo = grupos.get(movimiento.dia) || [];
    grupo.push(movimiento);
    grupos.set(movimiento.dia, grupo);
  }
  for (const [dia, filas] of grupos) {
    bloque.append(elemento("h3", "dia-titulo", formatoDia(dia)));
    const lista = elemento("div", "movimientos-dia");
    for (const movimiento of filas) lista.append(botonMovimiento(movimiento));
    bloque.append(lista);
  }
  return bloque;
}

function crearVacio() {
  const vacio = elemento("div", "vacio");
  vacio.append(
    elemento("div", "vacio-icono", "✦"),
    elemento("h2", "", "Aquí aparecerán sus cuentas"),
    elemento("p", "", "Anote una venta, un gasto o un fiado desde el chat."),
  );
  return vacio;
}

function crearPendientes(movimientos) {
  const pendientes = movimientos.filter((movimiento) => !movimiento.monto);
  if (pendientes.length === 0) return null;
  const bloque = elemento("section", "pendientes");
  bloque.append(
    elemento("h2", "seccion-titulo", "Falta completar"),
    elemento(
      "p",
      "seccion-ayuda",
      "Escriba el monto para que entre en sus cuentas.",
    ),
  );
  for (const movimiento of pendientes)
    bloque.append(campoPendiente(movimiento));
  return bloque;
}

function crearBotonLimpiar() {
  const boton = elemento("button", "empezar-cero", "Empezar de cero");
  boton.type = "button";
  boton.addEventListener("click", () => limpiarDialogo.showModal());
  return boton;
}

function pintarCuentas(resumen, movimientos) {
  cuentasContenido.replaceChildren();
  cuentasContenido.append(crearResumen(resumen));
  const pendientes = crearPendientes(movimientos);
  if (pendientes) cuentasContenido.append(pendientes);
  cuentasContenido.append(crearMovimientos(movimientos));
  if (movimientos.length === 0) cuentasContenido.append(crearVacio());
}

async function cargarCuentas() {
  cuentasContenido.replaceChildren(
    elemento("p", "cargando", "Cargando sus cuentas…"),
  );
  try {
    const [resumen, movimientos] = await Promise.all([
      pedir("/api/resumen"),
      pedir("/api/movimientos"),
    ]);
    pintarCuentas(resumen, movimientos);
  } catch (error) {
    cuentasContenido.replaceChildren(
      elemento(
        "p",
        "error-cuentas",
        error instanceof Error ? error.message : MSG_FALLO,
      ),
    );
  }
}

function activarTab(tab) {
  const cuentas = tab === "cuentas";
  vistaChat.hidden = cuentas;
  vistaCuentas.hidden = !cuentas;
  tabChat.classList.toggle("activa", !cuentas);
  tabCuentas.classList.toggle("activa", cuentas);
  if (cuentas) {
    tabCuentas.setAttribute("aria-current", "page");
    tabChat.removeAttribute("aria-current");
    cargarCuentas();
  } else {
    tabChat.setAttribute("aria-current", "page");
    tabCuentas.removeAttribute("aria-current");
  }
}

function abrirEditor(movimiento) {
  movimientoActual = movimiento;
  const tipo = TIPO[movimiento.tipo] || TIPO.venta;
  editorTitulo.textContent = `${tipo.palabra}: ${movimiento.producto}`;
  editorCantidad.value = movimiento.cantidad;
  editorMonto.value = movimiento.monto;
  editorAviso.hidden = movimiento.tipo !== "fiado";
  editorAviso.textContent =
    "Si ya recibió un cobro de este fiado, también se borrará.";
  borrarPaso.hidden = true;
  document.getElementById("editor-borrar").hidden = false;
  editor.showModal();
}

async function cambiarMovimiento(id, cambios) {
  bloquear(true);
  try {
    await pedir(`/api/movimientos/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cambios),
    });
    if (editor.open) editor.close();
    await cargarCuentas();
  } catch (error) {
    alert(error instanceof Error ? error.message : MSG_FALLO);
  } finally {
    bloquear(false);
  }
}

async function borrarMovimiento() {
  if (!movimientoActual) return;
  bloquear(true);
  try {
    await pedir(`/api/movimientos/${movimientoActual.id}`, {
      method: "DELETE",
    });
    editor.close();
    await cargarCuentas();
  } catch (error) {
    alert(error instanceof Error ? error.message : MSG_FALLO);
  } finally {
    bloquear(false);
  }
}

editorForm.addEventListener("submit", (evento) => {
  evento.preventDefault();
  if (!movimientoActual) return;
  const cambios = {
    cantidad: Number(editorCantidad.value),
    monto: editorMonto.value.trim(),
  };
  cambiarMovimiento(movimientoActual.id, cambios);
});

document
  .getElementById("editor-cancelar")
  .addEventListener("click", () => editor.close());
document.getElementById("editor-borrar").addEventListener("click", () => {
  borrarPregunta.textContent = descripcionBorrado(movimientoActual);
  borrarPaso.hidden = false;
  document.getElementById("editor-borrar").hidden = true;
});
document.getElementById("borrar-cancelar").addEventListener("click", () => {
  borrarPaso.hidden = true;
  document.getElementById("editor-borrar").hidden = false;
});
document
  .getElementById("borrar-confirmar")
  .addEventListener("click", borrarMovimiento);
document
  .getElementById("limpiar-cancelar")
  .addEventListener("click", () => limpiarDialogo.close());
document
  .getElementById("limpiar-form")
  .addEventListener("submit", async (evento) => {
    evento.preventDefault();
    bloquear(true);
    try {
      await pedir("/api/movimientos", { method: "DELETE" });
      limpiarDialogo.close();
      await cargarCuentas();
    } catch (error) {
      alert(error instanceof Error ? error.message : MSG_FALLO);
    } finally {
      bloquear(false);
    }
  });

tabChat.addEventListener("click", () => activarTab("chat"));
tabCuentas.addEventListener("click", () => activarTab("cuentas"));

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
