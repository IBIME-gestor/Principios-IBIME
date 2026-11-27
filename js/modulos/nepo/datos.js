/* Piezas compartidas de NEPO: lectura de datos, permisos por clase y correos. */

import {
  db, collection, doc, getDoc, getDocs, setDoc, updateDoc, serverTimestamp, query, where
} from "../../firebase.js";
import { estado, esAdmin } from "../../app.js";
import { NEPO } from "../../config.js";
import { esc, enviarCorreo, norm } from "../../utils.js";

export const TIPOS_CORREO = {
  recordatorio: { nombre: "Recordatorio de sesión", ayuda: "Se manda un día antes de cada sesión, solo o con el botón." },
  asistencia:   { nombre: "Asistencia confirmada",  ayuda: "Se manda al marcar a un familiar como presente." },
  falta:        { nombre: "Te extrañamos",          ayuda: "Se manda al cerrar la sesión a quien no asistió." },
  general:      { nombre: "Aviso general",          ayuda: "Para avisos libres a toda una clase. Usa {{MENSAJE}} donde irá el texto." }
};

export const MARCADORES = [
  "NOMBRE_FAMILIAR", "NOMBRE_ALUMNO", "CLASE", "PLANTEL", "DOCENTE",
  "FECHA", "HORA", "LUGAR", "TEMA", "ASISTENCIAS", "FALTAS", "MENSAJE"
];

export const miCorreo = () => (estado.usuario?.email || estado.perfil?.correo || "").toLowerCase();

export const listaCorreos = txt => [...new Set(String(txt || "").split(/[\s,;]+/)
  .map(c => c.trim().toLowerCase()).filter(c => c.includes("@")))];

/* ---------- lectura ---------- */
const traer = async (nombre, ...filtros) => {
  const ref = collection(db, nombre);
  const snap = await getDocs(filtros.length ? query(ref, ...filtros) : ref);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};
export { traer };

/* Clases que esta persona puede ver: todas si administra, las suyas si es docente. */
export async function clasesVisibles({ incluirArchivadas = false } = {}) {
  const todas = await traer("nepo_clases");
  const yo = miCorreo();
  return todas
    .filter(c => incluirArchivadas || c.activa !== false)
    .filter(c => esAdmin() || (c.docentes || []).includes(yo))
    .sort((a, b) => (a.plantel + a.nombre).localeCompare(b.plantel + b.nombre, "es"));
}

/* ---------- datos para los correos ---------- */
export function datosCorreo({ clase = {}, sesion = {}, insc = {}, familiar = {}, resumen = {}, mensaje = "" }) {
  return {
    NOMBRE_FAMILIAR: insc.nombre || familiar.nombre || "",
    NOMBRE_ALUMNO:   insc.alumnosTxt || familiar.alumnosTxt || "",
    CLASE:    clase.nombre || sesion.claseNombre || "",
    PLANTEL:  clase.plantel || sesion.plantel || "",
    DOCENTE:  clase.docentesNombres || "",
    FECHA:    sesion.fecha ? fechaDe(sesion.fecha) : "",
    HORA:     sesion.hora || clase.horario || "",
    LUGAR:    sesion.lugar || clase.lugar || "",
    TEMA:     sesion.tema || "",
    ASISTENCIAS: resumen.presentes ?? "",
    FALTAS:      resumen.faltas ?? "",
    MENSAJE:  mensaje
  };
}

export function fechaDe(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
}

export function personalizarNepo(html, datos) {
  let out = String(html || "");
  for (const [k, v] of Object.entries(datos)) {
    const texto = k === "MENSAJE" ? esc(v).replace(/\n/g, "<br>") : esc(v ?? "");
    out = out.replaceAll(`{{${k}}}`, texto);
  }
  return out;
}

let cachePlantillas = null;
export async function plantillas(forzar = false) {
  if (cachePlantillas && !forzar) return cachePlantillas;
  const lista = await traer("nepo_plantillas");
  cachePlantillas = Object.fromEntries(lista.map(p => [p.id, p]));
  return cachePlantillas;
}
export const olvidarPlantillas = () => { cachePlantillas = null; };

/* Manda un correo de NEPO y deja constancia para no repetirlo.
   Devuelve "enviado", "repetido", "sin-correo" o "sin-plantilla". */
export async function mandar({ tipo, sesion, clase, insc, resumen, mensaje, reenviar = false }) {
  if (!insc.correo) return "sin-correo";
  const pl = (await plantillas())[tipo];
  if (!pl?.html) return "sin-plantilla";

  const llave = tipo === "general" ? null : `${tipo}__${sesion?.id}__${insc.familiarId}`;
  if (llave && !reenviar) {
    const previo = await getDoc(doc(db, "nepo_correos", llave));
    if (previo.exists()) return "repetido";
  }

  const datos = datosCorreo({ clase, sesion, insc, resumen, mensaje });
  await enviarCorreo({
    to: insc.correo,
    subject: personalizarNepo(pl.asunto || TIPOS_CORREO[tipo].nombre, datos).replace(/<[^>]*>/g, ""),
    html: personalizarNepo(pl.html, datos)
  });

  if (llave) {
    await setDoc(doc(db, "nepo_correos", llave), {
      tipo, sesionId: sesion?.id || "", claseId: clase?.id || "", familiarId: insc.familiarId,
      correo: insc.correo, enviado: serverTimestamp(), por: miCorreo()
    });
  }
  return "enviado";
}

/* Envío en lote con avance. Devuelve cuántos salieron y por qué no salieron los demás. */
export async function mandarLote({ tipo, sesion, clase, inscs, resumenDe, mensaje, reenviar = false, alAvanzar }) {
  const cuenta = { enviado: 0, repetido: 0, "sin-correo": 0, "sin-plantilla": 0, error: 0 };
  for (const [i, insc] of inscs.entries()) {
    try {
      const r = await mandar({ tipo, sesion, clase, insc, mensaje, reenviar, resumen: resumenDe?.(insc) });
      cuenta[r]++;
      if (r === "sin-plantilla") break;
    } catch (e) { console.error(e); cuenta.error++; }
    alAvanzar?.(i + 1, inscs.length);
    await new Promise(r => setTimeout(r, NEPO.pausaEntreCorreos));
  }
  return cuenta;
}

export function resumenCuenta(c) {
  const partes = [];
  if (c.enviado) partes.push(`${c.enviado} enviado${c.enviado > 1 ? "s" : ""}`);
  if (c.repetido) partes.push(`${c.repetido} ya se habían mandado`);
  if (c["sin-correo"]) partes.push(`${c["sin-correo"]} sin correo registrado`);
  if (c.error) partes.push(`${c.error} con error`);
  if (c["sin-plantilla"]) return "Todavía no hay plantilla cargada para este correo. Súbela en Plantillas de correo.";
  return partes.join(" · ") || "No había a quién enviar.";
}

/* ---------- porcentajes ---------- */
export function tally(filas) {
  const t = { presentes: 0, faltas: 0, justificadas: 0 };
  for (const f of filas) {
    if (f.estado === "presente") t.presentes++;
    else if (f.estado === "falta") t.faltas++;
    else if (f.estado === "justificada") t.justificadas++;
  }
  t.total = t.presentes + t.faltas + t.justificadas;
  t.pct = t.total ? Math.round((t.presentes / t.total) * 100) : null;
  return t;
}
export const pillPct = p => p === null ? `<span class="pill">—</span>`
  : `<span class="pill ${p >= 80 ? "pill--ok" : p >= 60 ? "pill--alerta" : "pill--rojo"}">${p}%</span>`;

export const clave = s => norm(s).replace(/\s+/g, "-");
export { updateDoc, where };
