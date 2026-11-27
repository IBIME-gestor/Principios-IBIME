/* Pase de lista de NEPO: se marca a cada familiar, se confirma por correo
   a quien llegó y, al cerrar la sesión, se avisa a quien faltó. */

import {
  db, doc, setDoc, deleteDoc, updateDoc, writeBatch, onSnapshot, collection, query, where, serverTimestamp
} from "../../firebase.js";
import { titulo, parametros, estado } from "../../app.js";
import { $, $$, esc, avisar, confirmar, abrirModal, cargando, vacio, norm, hoyISO, rebote, pitido, vibrar } from "../../utils.js";
import {
  clasesVisibles, traer, tally, fechaDe, mandar, mandarLote, resumenCuenta, plantillas
} from "./datos.js";
import { inscripcionDe } from "./clases.js";

let clases = [], sesiones = [], clase = null, sesion = null, inscs = [], hist = [], marcas = new Map();
let baja = null, avisoPlantilla = false;

export const salir = () => { baja?.(); baja = null; };

export async function render(cont) {
  titulo("Pase de lista", "Marca quién llegó; los correos salen solos");
  cont.innerHTML = cargando();
  clases = await clasesVisibles();
  if (!clases.length) {
    cont.innerHTML = `<div class="caja">${vacio({ titulo: "Sin clases asignadas", texto: "Cuando tengas una clase, aquí pasarás lista." })}</div>`; return;
  }
  const ids = new Set(clases.map(c => c.id));
  sesiones = (await traer("nepo_sesiones")).filter(s => ids.has(s.claseId));

  const pedida = sesiones.find(s => s.id === parametros().get("s"));
  const hoy = hoyISO();
  const sugerida = pedida
    || sesiones.filter(s => s.fecha === hoy)[0]
    || [...sesiones].filter(s => s.estado !== "cerrada" && s.fecha >= hoy).sort((a, b) => (a.fecha > b.fecha ? 1 : -1))[0]
    || [...sesiones].sort((a, b) => (a.fecha < b.fecha ? 1 : -1))[0];

  cont.innerHTML = `<div class="cascada">
    <div class="caja no-print"><div class="filtros">
      <div class="campo"><label>Clase</label><select id="s-clase">${clases.map(c =>
        `<option value="${c.id}">${esc(c.nombre)} · ${esc(c.plantel || "")}</option>`).join("")}</select></div>
      <div class="campo"><label>Sesión</label><select id="s-sesion"></select></div>
    </div></div>
    <div id="lista"></div></div>`;

  if (sugerida) $("#s-clase").value = sugerida.claseId;
  $("#s-clase").addEventListener("change", () => elegirClase(cont));
  $("#s-sesion").addEventListener("change", () => abrirSesion(cont, $("#s-sesion").value));
  await elegirClase(cont, sugerida?.id);
}

async function elegirClase(cont, sesionId) {
  clase = clases.find(c => c.id === $("#s-clase").value);
  const ss = sesiones.filter(s => s.claseId === clase.id).sort((a, b) => (a.fecha > b.fecha ? 1 : -1));
  $("#s-sesion").innerHTML = ss.map(s =>
    `<option value="${s.id}">${esc(fechaDe(s.fecha))}${s.hora ? " · " + esc(s.hora) : ""}${s.estado === "cerrada" ? " (cerrada)" : ""}</option>`).join("");

  if (!ss.length) { baja?.(); $("#lista").innerHTML = `<div class="caja">${vacio({ titulo: "Esta clase no tiene sesiones", texto: "Créalas en Clases → Abrir → Nueva sesión." })}</div>`; return; }
  [inscs, hist] = await Promise.all([
    traer("nepo_inscripciones", where("claseId", "==", clase.id)),
    traer("nepo_asistencias", where("claseId", "==", clase.id))
  ]);
  inscs = inscs.filter(i => i.activa !== false).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const elegida = sesionId && ss.some(s => s.id === sesionId) ? sesionId
    : (ss.find(s => s.fecha === hoyISO()) || ss.find(s => s.estado !== "cerrada" && s.fecha >= hoyISO()) || ss[ss.length - 1]).id;
  $("#s-sesion").value = elegida;
  abrirSesion(cont, elegida);
}

function abrirSesion(cont, sid) {
  baja?.();
  sesion = sesiones.find(s => s.id === sid);
  marcas = new Map();
  baja = onSnapshot(query(collection(db, "nepo_asistencias"), where("sesionId", "==", sid)), snap => {
    marcas = new Map(snap.docs.map(d => [d.data().familiarId, d.data()]));
    pintar();
  }, err => { console.error(err); avisar("No se pudo leer la asistencia en vivo.", "mal"); });
  pintar();
}

const resumenDe = fid => tally([
  ...hist.filter(a => a.familiarId === fid && a.sesionId !== sesion.id),
  ...[marcas.get(fid)].filter(Boolean)
]);

function pintar() {
  if (!sesion) return;
  const cont = $("#lista"); if (!cont) return;
  const t = tally([...marcas.values()]);
  const sin = inscs.filter(i => !marcas.has(i.familiarId)).length;
  const q = norm($("#q")?.value || "");

  cont.innerHTML = `
    <div class="rejilla rejilla--4" style="margin-bottom:16px">
      <div class="dato"><b>${t.presentes}</b><span>presentes</span></div>
      <div class="dato dato--rojo"><b>${t.faltas}</b><span>faltas</span></div>
      <div class="dato"><b>${t.justificadas}</b><span>justificadas</span></div>
      <div class="dato"><b>${sin}</b><span>sin marcar de ${inscs.length}</span></div>
    </div>
    <div class="caja" style="padding:0">
      <div style="padding:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;border-bottom:1px solid var(--linea)">
        <div class="campo" style="flex:1 1 220px"><input id="q" type="search" placeholder="Buscar familiar" value="${esc($("#q")?.value || "")}"></div>
        <button class="btn btn--linea btn--chico" id="b-extra">Agregar a alguien no inscrito</button>
        <button class="btn btn--linea btn--chico" id="b-recordar">Recordatorio</button>
        ${sesion.estado === "cerrada"
          ? `<button class="btn btn--suave btn--chico" id="b-reabrir">Reabrir sesión</button>`
          : `<button class="btn btn--chico" id="b-cerrar">Cerrar sesión</button>`}
      </div>
      ${sesion.estado === "cerrada" ? `<div class="aviso aviso--ambar" style="margin:12px 16px"><div>Esta sesión está cerrada. Puedes corregir marcas; la confirmación se manda al marcar presente.</div></div>` : ""}
      ${inscs.filter(i => !q || norm(i.nombre + " " + (i.familia || "")).includes(q)).map(i => {
        const e = marcas.get(i.familiarId)?.estado;
        return `<div class="filaasis">
          <div class="filaasis__quien"><strong>${esc(i.nombre)}</strong>
            <span>${esc([i.familia, i.alumnosTxt].filter(Boolean).join(" · "))}${i.correo ? "" : " · sin correo"}</span></div>
          <div class="seg" data-f="${i.familiarId}">
            <button data-e="presente" class="${e === "presente" ? "on-presente" : ""}">Presente</button>
            <button data-e="falta" class="${e === "falta" ? "on-falta" : ""}">Falta</button>
            <button data-e="justificada" class="${e === "justificada" ? "on-justificada" : ""}">Justif.</button>
          </div></div>`;
      }).join("") || `<div style="padding:16px">${vacio({ titulo: "Sin familiares", texto: "Inscribe familiares en la clase para pasar lista." })}</div>`}
    </div>`;

  $("#q").addEventListener("input", rebote(() => { pintar(); $("#q").focus(); $("#q").setSelectionRange(99, 99); }));
  $$(".seg button").forEach(b => b.addEventListener("click", () => marcar(b.closest(".seg").dataset.f, b.dataset.e)));
  $("#b-extra").addEventListener("click", agregarExtra);
  $("#b-recordar").addEventListener("click", recordar);
  $("#b-cerrar")?.addEventListener("click", cerrar);
  $("#b-reabrir")?.addEventListener("click", async () => {
    await updateDoc(doc(db, "nepo_sesiones", sesion.id), { estado: "programada" }); sesion.estado = "programada"; pintar(); });
}

const idAsis = fid => `${sesion.id}__${fid}`;
const docAsis = (i, est) => ({
  sesionId: sesion.id, claseId: clase.id, claseNombre: clase.nombre, plantel: clase.plantel || "",
  fecha: sesion.fecha, periodo: sesion.periodo || sesion.fecha.slice(0, 7),
  familiarId: i.familiarId, nombre: i.nombre, familiaId: i.familiaId || i.familiarId, familia: i.familia || i.nombre,
  estado: est, registradoPorUid: estado.usuario.uid, registradoPorNombre: estado.perfil?.nombre || "", ts: serverTimestamp()
});

async function marcar(fid, est) {
  const i = inscs.find(x => x.familiarId === fid);
  try {
    if (marcas.get(fid)?.estado === est) { await deleteDoc(doc(db, "nepo_asistencias", idAsis(fid))); vibrar(); return; }
    await setDoc(doc(db, "nepo_asistencias", idAsis(fid)), docAsis(i, est));
    pitido(est === "presente"); vibrar();
    if (est === "presente") confirmacion(i);
  } catch (err) { console.error(err); pitido(false); avisar("No se pudo guardar. Revisa tu conexión.", "mal"); }
}

/* Confirmación por correo: sin esperar y sin repetirla si se corrige la marca. */
async function confirmacion(i) {
  try {
    const r = await mandar({ tipo: "asistencia", sesion, clase, insc: i, resumen: resumenDe(i.familiarId) });
    if (r === "sin-plantilla" && !avisoPlantilla) { avisoPlantilla = true; avisar("Aún no hay plantilla de asistencia confirmada; no se mandaron correos.", "aviso", 5000); }
  } catch (e) { console.error(e); }
}

function agregarExtra() {
  traer("nepo_familiares").then(todos => {
    const ya = new Set(inscs.map(i => i.familiarId));
    const lista = todos.filter(f => f.activo !== false && !ya.has(f.id)).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    abrirModal({
      titulo: "Agregar a alguien no inscrito", sub: "Se inscribe en la clase y se marca presente.",
      cuerpo: `<div class="campo"><input id="e-q" type="search" placeholder="Buscar en el catálogo"></div>
        <div id="e-lista" style="max-height:320px;overflow:auto;margin-top:10px;display:grid;gap:6px"></div>`,
      acciones: [{ texto: "Cerrar" }],
      alAbrir: dlg => {
        const pinta = () => {
          const q = norm($("#e-q", dlg).value);
          $("#e-lista", dlg).innerHTML = lista.filter(f => q && norm(f.nombre + " " + (f.familia || "")).includes(q)).slice(0, 12).map(f =>
            `<button class="btn btn--suave" data-id="${f.id}" style="justify-content:flex-start">${esc(f.nombre)} <small>${esc(f.familia || "")}</small></button>`).join("")
            || `<p style="color:var(--tinta-suave);font-size:.88rem">Escribe para buscar. Si no aparece, agrégalo primero en Familias.</p>`;
          $$("[data-id]", dlg).forEach(b => b.addEventListener("click", async () => {
            const f = lista.find(x => x.id === b.dataset.id);
            const d = inscripcionDe(clase, f);
            await setDoc(doc(db, "nepo_inscripciones", `${clase.id}__${f.id}`), d);
            inscs.push({ id: `${clase.id}__${f.id}`, ...d }); inscs.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
            dlg.close(); marcar(f.id, "presente");
          }));
        };
        $("#e-q", dlg).addEventListener("input", rebote(pinta)); pinta();
      }
    });
  });
}

async function recordar() {
  const reenviar = !!sesion.recordatorioEnviado;
  if (!await confirmar(reenviar ? "¿Volver a mandar el recordatorio?" : "¿Mandar el recordatorio ahora?",
    `Se envía a los ${inscs.length} familiares inscritos.`, "Enviar")) return;
  avisar("Enviando…", "aviso", 1500);
  const r = await mandarLote({ tipo: "recordatorio", sesion, clase, inscs, reenviar });
  if (r.enviado || r.repetido) { await updateDoc(doc(db, "nepo_sesiones", sesion.id), { recordatorioEnviado: serverTimestamp() }); sesion.recordatorioEnviado = true; }
  avisar(resumenCuenta(r), r.enviado ? "ok" : "aviso", 5000);
}

async function cerrar() {
  const sin = inscs.filter(i => !marcas.has(i.familiarId));
  const faltarian = inscs.filter(i => (marcas.get(i.familiarId)?.estado || "falta") === "falta");
  if (!await confirmar("¿Cerrar la sesión?",
    `${sin.length ? `${sin.length} sin marcar quedarán como falta. ` : ""}Se mandará “te extrañamos” a ${faltarian.length} familiar${faltarian.length === 1 ? "" : "es"} que no asistieron (los que tengan correo).`,
    "Cerrar y enviar")) return;

  try {
    if (sin.length) {
      const lote = writeBatch(db);
      sin.forEach(i => lote.set(doc(db, "nepo_asistencias", idAsis(i.familiarId)), docAsis(i, "falta")));
      await lote.commit();
      sin.forEach(i => marcas.set(i.familiarId, { ...docAsis(i, "falta") }));
    }
    await updateDoc(doc(db, "nepo_sesiones", sesion.id), { estado: "cerrada", cerrada: serverTimestamp() });
    sesion.estado = "cerrada"; pintar();
    avisar("Sesión cerrada. Enviando correos…", "ok", 2500);

    const r = await mandarLote({ tipo: "falta", sesion, clase, inscs: faltarian, resumenDe: i => resumenDe(i.familiarId) });
    avisar(resumenCuenta(r), r.enviado ? "ok" : "aviso", 6000);
  } catch (err) { console.error(err); avisar("No se pudo cerrar la sesión. Intenta de nuevo.", "mal"); }
}
