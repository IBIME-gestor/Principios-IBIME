/* Clases NEPO: grupos de familias con sus docentes, sesiones e inscritos. */

import {
  db, doc, setDoc, updateDoc, deleteDoc, addDoc, collection, writeBatch, serverTimestamp, where
} from "../../firebase.js";
import { titulo, esAdmin, parametros } from "../../app.js";
import {
  $, $$, esc, avisar, confirmar, abrirModal, cargando, vacio, norm, hoyISO, rebote
} from "../../utils.js";
import {
  clasesVisibles, traer, listaCorreos, miCorreo, fechaDe, mandarLote, resumenCuenta, tally, pillPct
} from "./datos.js";

let clase = null, sesiones = [], inscritos = [], asistencias = [];

export async function render(cont) {
  const id = parametros().get("id");
  return id ? detalle(cont, id) : listado(cont);
}

/* ============================================================ LISTADO */
async function listado(cont) {
  titulo("Clases", "Cada clase reúne a las familias de un plantel con su docente");
  cont.innerHTML = cargando();
  const [clases, inscs, sess] = await Promise.all([
    clasesVisibles({ incluirArchivadas: true }), traer("nepo_inscripciones"), traer("nepo_sesiones")
  ]);

  const nIns = c => inscs.filter(i => i.claseId === c.id && i.activa !== false).length;
  const nSes = c => sess.filter(s => s.claseId === c.id).length;

  cont.innerHTML = `
    <div class="cascada">
      <div class="caja">
        <div class="caja__cab"><div><h2>Mis clases</h2>
          <p>${esAdmin() ? "Tú creas las clases y asignas a sus docentes." : "Solo ves las clases donde estás como docente."}</p></div>
          ${esAdmin() ? `<button class="btn" id="b-nueva">Nueva clase</button>` : ""}</div>
        ${clases.length ? `<div class="tablabox"><table>
          <thead><tr><th>Clase</th><th>Plantel</th><th>Docentes</th><th>Horario</th><th>Familiares</th><th>Sesiones</th><th></th></tr></thead>
          <tbody>${clases.map(c => `<tr>
            <td><strong>${esc(c.nombre)}</strong>${c.activa === false ? ` <span class="pill">Archivada</span>` : ""}
              <br><span style="font-size:.8rem;color:var(--tinta-suave)">${esc(c.ciclo || "")}</span></td>
            <td>${esc(c.plantel || "—")}</td>
            <td style="font-size:.86rem">${esc(c.docentesNombres || (c.docentes || []).join(", ") || "—")}</td>
            <td style="font-size:.86rem">${esc(c.horario || "—")}</td>
            <td class="num">${nIns(c)}</td><td class="num">${nSes(c)}</td>
            <td><a class="btn btn--suave btn--chico" href="#/nepo/clases?id=${c.id}">Abrir</a></td></tr>`).join("")}
          </tbody></table></div>`
        : vacio({ titulo: "Aún no hay clases", texto: esAdmin() ? "Crea la primera para empezar." : "Pide a la administración que te asigne como docente." ,
            boton: esAdmin() ? { id: "b-nueva2", texto: "Nueva clase" } : null })}
      </div>
    </div>`;

  $("#b-nueva")?.addEventListener("click", () => formClase(null));
  $("#b-nueva2")?.addEventListener("click", () => formClase(null));
}

function formClase(c) {
  abrirModal({
    titulo: c ? "Editar clase" : "Nueva clase",
    cuerpo: `<div style="display:grid;gap:12px">
      <div class="campo"><label>Nombre de la clase</label><input id="c-nombre" value="${esc(c?.nombre || "")}" placeholder="Ej. NEPO · Grupo A"></div>
      <div class="filtros">
        <div class="campo"><label>Plantel</label><input id="c-plantel" value="${esc(c?.plantel || "")}"></div>
        <div class="campo"><label>Ciclo o periodo</label><input id="c-ciclo" value="${esc(c?.ciclo || "")}" placeholder="Ej. Ago–Dic 2026"></div>
      </div>
      <div class="filtros">
        <div class="campo"><label>Horario</label><input id="c-horario" value="${esc(c?.horario || "")}" placeholder="Martes 17:00"></div>
        <div class="campo"><label>Lugar</label><input id="c-lugar" value="${esc(c?.lugar || "")}"></div>
      </div>
      <div class="campo"><label>Nombre del docente (como saldrá en los correos)</label><input id="c-docnom" value="${esc(c?.docentesNombres || "")}"></div>
      <div class="campo"><label>Correos de los docentes</label>
        <textarea id="c-docs" placeholder="uno@ibime.edu.mx, otro@ibime.edu.mx">${esc((c?.docentes || []).join(", "))}</textarea>
        <small>Cada docente debe tener activado el módulo NEPO en “Personas con acceso”.</small></div>
    </div>`,
    acciones: [
      { texto: "Cancelar" },
      ...(c ? [{ texto: c.activa === false ? "Reactivar" : "Archivar", fn: async () => {
        await updateDoc(doc(db, "nepo_clases", c.id), { activa: c.activa === false });
        avisar("Listo.", "ok"); location.hash = "#/nepo/clases"; location.reload(); } }] : []),
      { texto: "Guardar", clase: "btn", fn: async dlg => {
        const nombre = $("#c-nombre", dlg).value.trim();
        if (!nombre) { avisar("Ponle nombre a la clase.", "aviso"); return false; }
        const datos = {
          nombre, plantel: $("#c-plantel", dlg).value.trim(), ciclo: $("#c-ciclo", dlg).value.trim(),
          horario: $("#c-horario", dlg).value.trim(), lugar: $("#c-lugar", dlg).value.trim(),
          docentesNombres: $("#c-docnom", dlg).value.trim(), docentes: listaCorreos($("#c-docs", dlg).value)
        };
        if (c) await updateDoc(doc(db, "nepo_clases", c.id), datos);
        else await addDoc(collection(db, "nepo_clases"), { ...datos, activa: true, creado: serverTimestamp() });
        avisar("Clase guardada.", "ok");
        location.hash.includes("id=") ? location.reload() : (location.hash = "#/nepo/clases", location.reload());
      } }
    ]
  });
}

/* ============================================================ DETALLE */
async function detalle(cont, id) {
  cont.innerHTML = cargando();
  const clases = await clasesVisibles({ incluirArchivadas: true });
  clase = clases.find(c => c.id === id);
  if (!clase) { cont.innerHTML = `<div class="caja">${vacio({ titulo: "No encontré esa clase", texto: "Puede que no tengas acceso a ella." })}</div>`; return; }
  titulo(clase.nombre, [clase.plantel, clase.ciclo, clase.horario].filter(Boolean).join(" · "));

  [sesiones, inscritos, asistencias] = await Promise.all([
    traer("nepo_sesiones", where("claseId", "==", id)),
    traer("nepo_inscripciones", where("claseId", "==", id)),
    traer("nepo_asistencias", where("claseId", "==", id))
  ]);
  pintar(cont);
}

function pintar(cont) {
  const ins = inscritos.filter(i => i.activa !== false).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const ses = [...sesiones].sort((a, b) => (a.fecha + a.hora > b.fecha + b.hora ? 1 : -1));
  const t = tally(asistencias);

  cont.innerHTML = `
    <div class="cascada">
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <a class="btn btn--linea btn--chico" href="#/nepo/clases">← Todas las clases</a>
        ${esAdmin() ? `<button class="btn btn--linea btn--chico" id="b-editar">Editar clase</button>` : ""}
        <button class="btn btn--suave btn--chico" id="b-aviso">Enviar aviso general</button>
      </div>

      <div class="rejilla rejilla--4">
        <div class="dato"><b>${ins.length}</b><span>familiares inscritos</span></div>
        <div class="dato"><b>${ses.length}</b><span>sesiones</span></div>
        <div class="dato"><b>${ses.filter(s => s.estado === "cerrada").length}</b><span>sesiones cerradas</span></div>
        <div class="dato dato--rojo"><b>${t.pct === null ? "—" : t.pct + "%"}</b><span>asistencia de la clase</span></div>
      </div>

      <div class="caja">
        <div class="caja__cab"><div><h2>Sesiones</h2><p>Cada sesión tiene su pase de lista y sus correos.</p></div>
          <button class="btn" id="b-sesion">Nueva sesión</button></div>
        ${ses.length ? `<div class="tablabox"><table>
          <thead><tr><th>Fecha</th><th>Hora</th><th>Tema</th><th>Estado</th><th>Asistencia</th><th>Recordatorio</th><th></th></tr></thead>
          <tbody>${ses.map(s => {
            const ts = tally(asistencias.filter(a => a.sesionId === s.id));
            return `<tr>
              <td><strong>${esc(fechaDe(s.fecha))}</strong></td><td class="num">${esc(s.hora || "—")}</td>
              <td>${esc(s.tema || "—")}</td>
              <td><span class="pill ${s.estado === "cerrada" ? "pill--ok" : ""}">${s.estado === "cerrada" ? "Cerrada" : "Programada"}</span></td>
              <td class="num">${ts.total ? `${ts.presentes} de ${ins.length}` : "—"}</td>
              <td>${s.recordatorioEnviado ? `<span class="pill pill--ok">Enviado</span>` : `<span class="pill">Pendiente</span>`}</td>
              <td style="white-space:nowrap;display:flex;gap:6px">
                <a class="btn btn--suave btn--chico" href="#/nepo/asistencia?s=${s.id}">Pasar lista</a>
                <button class="btn btn--linea btn--chico" data-recordar="${s.id}">Recordatorio</button>
                <button class="btn btn--linea btn--chico" data-quitar="${s.id}">Quitar</button></td></tr>`;
          }).join("")}</tbody></table></div>`
        : `<p style="color:var(--tinta-suave);font-size:.9rem">Todavía no hay sesiones. Crea la primera, o varias de golpe repitiéndola cada semana.</p>`}
      </div>

      <div class="caja">
        <div class="caja__cab"><div><h2>Familiares inscritos</h2><p>Quienes aparecerán en el pase de lista.</p></div>
          <button class="btn" id="b-inscribir">Inscribir familiares</button></div>
        ${ins.length ? `<div class="tablabox"><table>
          <thead><tr><th>Familiar</th><th>Familia</th><th>Alumnos</th><th>Correo</th><th>Asistencia</th><th></th></tr></thead>
          <tbody>${ins.map(i => {
            const ti = tally(asistencias.filter(a => a.familiarId === i.familiarId));
            return `<tr><td><a href="#/nepo/familias?id=${i.familiarId}"><strong>${esc(i.nombre)}</strong></a></td>
              <td>${esc(i.familia || "—")}</td><td style="font-size:.84rem">${esc(i.alumnosTxt || "—")}</td>
              <td style="font-size:.84rem">${i.correo ? esc(i.correo) : `<span class="pill pill--alerta">Sin correo</span>`}</td>
              <td>${pillPct(ti.pct)}</td>
              <td><button class="btn btn--linea btn--chico" data-baja="${i.id}">Dar de baja</button></td></tr>`;
          }).join("")}</tbody></table></div>`
        : `<p style="color:var(--tinta-suave);font-size:.9rem">Aún no hay familiares inscritos.</p>`}
      </div>
    </div>`;

  $("#b-editar")?.addEventListener("click", () => formClase(clase));
  $("#b-sesion").addEventListener("click", () => formSesion(cont));
  $("#b-inscribir").addEventListener("click", () => inscribir(cont));
  $("#b-aviso").addEventListener("click", () => aviso(ins));
  $$("[data-recordar]").forEach(b => b.addEventListener("click", () => recordatorio(b.dataset.recordar, ins, cont)));
  $$("[data-quitar]").forEach(b => b.addEventListener("click", async () => {
    if (!await confirmar("¿Quitar la sesión?", "Las asistencias ya registradas en ella se conservan en los informes.", "Quitar")) return;
    await deleteDoc(doc(db, "nepo_sesiones", b.dataset.quitar));
    sesiones = sesiones.filter(s => s.id !== b.dataset.quitar); pintar(cont);
  }));
  $$("[data-baja]").forEach(b => b.addEventListener("click", async () => {
    if (!await confirmar("¿Dar de baja de la clase?", "Su historial de asistencias se conserva.", "Dar de baja")) return;
    await updateDoc(doc(db, "nepo_inscripciones", b.dataset.baja), { activa: false });
    inscritos.find(i => i.id === b.dataset.baja).activa = false; pintar(cont);
  }));
}

/* ---------- nueva sesión (una o varias semanas seguidas) ---------- */
function formSesion(cont) {
  abrirModal({
    titulo: "Nueva sesión",
    cuerpo: `<div style="display:grid;gap:12px">
      <div class="filtros">
        <div class="campo"><label>Fecha</label><input id="s-fecha" type="date" value="${hoyISO()}"></div>
        <div class="campo"><label>Hora</label><input id="s-hora" type="time" value="${esc(((clase.horario || "").match(/\d{1,2}:\d{2}/) || [""])[0].padStart(5, "0"))}"></div>
      </div>
      <div class="campo"><label>Tema</label><input id="s-tema" placeholder="Opcional"></div>
      <div class="campo"><label>Lugar</label><input id="s-lugar" value="${esc(clase.lugar || "")}"></div>
      <div class="campo"><label>¿Cuántas sesiones crear? (una por semana)</label>
        <input id="s-n" type="number" min="1" max="30" value="1"><small>Si pones 8, se crean 8 sesiones el mismo día de cada semana.</small></div>
    </div>`,
    acciones: [{ texto: "Cancelar" }, { texto: "Crear", clase: "btn", fn: async dlg => {
      const f0 = $("#s-fecha", dlg).value, n = Math.max(1, Math.min(30, +$("#s-n", dlg).value || 1));
      if (!f0) { avisar("Elige la fecha.", "aviso"); return false; }
      const lote = writeBatch(db);
      for (let k = 0; k < n; k++) {
        const d = new Date(f0 + "T12:00:00"); d.setDate(d.getDate() + 7 * k);
        const fecha = d.toLocaleDateString("sv-SE");
        const ref = doc(collection(db, "nepo_sesiones"));
        const s = {
          claseId: clase.id, claseNombre: clase.nombre, plantel: clase.plantel || "", fecha, periodo: fecha.slice(0, 7),
          hora: $("#s-hora", dlg).value, tema: $("#s-tema", dlg).value.trim(), lugar: $("#s-lugar", dlg).value.trim(),
          estado: "programada", recordatorioEnviado: null, creado: serverTimestamp()
        };
        lote.set(ref, s); sesiones.push({ id: ref.id, ...s });
      }
      await lote.commit(); avisar(n > 1 ? `${n} sesiones creadas.` : "Sesión creada.", "ok"); pintar(cont);
    } }]
  });
}

/* ---------- inscribir familiares del catálogo ---------- */
async function inscribir(cont) {
  const fams = await traer("nepo_familiares");
  const ya = new Set(inscritos.filter(i => i.activa !== false).map(i => i.familiarId));
  const libres = fams.filter(f => f.activo !== false && !ya.has(f.id))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  abrirModal({
    titulo: "Inscribir familiares", sub: "Elige del catálogo. Si falta alguien, primero agrégalo en Familias.",
    cuerpo: `<div class="campo"><input id="i-buscar" type="search" placeholder="Buscar por nombre, familia o plantel"></div>
      <div id="i-lista" style="max-height:340px;overflow:auto;margin-top:10px;display:grid;gap:4px">
      ${libres.map(f => `<label data-t="${esc(norm(f.nombre + " " + (f.familia || "") + " " + (f.plantel || "")))}" style="display:flex;gap:10px;align-items:center;padding:8px;border:1px solid var(--linea);border-radius:8px">
        <input type="checkbox" value="${f.id}"><span><strong>${esc(f.nombre)}</strong>
        <small style="display:block;color:var(--tinta-suave)">${esc([f.familia, f.plantel, f.alumnosTxt].filter(Boolean).join(" · "))}</small></span></label>`).join("")
        || `<p style="color:var(--tinta-suave)">No hay familiares disponibles. Agrégalos en Familias.</p>`}</div>`,
    alAbrir: dlg => $("#i-buscar", dlg).addEventListener("input", rebote(e => {
      const q = norm(e.target.value);
      $$("#i-lista label", dlg).forEach(l => { l.style.display = l.dataset.t.includes(q) ? "" : "none"; });
    })),
    acciones: [{ texto: "Cancelar" }, { texto: "Inscribir", clase: "btn", fn: async dlg => {
      const marcados = $$("#i-lista input:checked", dlg).map(i => i.value);
      if (!marcados.length) { avisar("Marca al menos a una persona.", "aviso"); return false; }
      const lote = writeBatch(db);
      for (const fid of marcados) {
        const f = fams.find(x => x.id === fid), ref = doc(db, "nepo_inscripciones", `${clase.id}__${fid}`);
        const d = inscripcionDe(clase, f);
        lote.set(ref, d); const previo = inscritos.find(i => i.id === ref.id);
        previo ? Object.assign(previo, d) : inscritos.push({ id: ref.id, ...d });
      }
      await lote.commit(); avisar(`${marcados.length} inscrito${marcados.length > 1 ? "s" : ""}.`, "ok"); pintar(cont);
    } }]
  });
}

export const inscripcionDe = (c, f) => ({
  claseId: c.id, claseNombre: c.nombre, plantel: c.plantel || "", familiarId: f.id, nombre: f.nombre,
  correo: f.correo || "", familiaId: f.familiaId || f.id, familia: f.familia || f.nombre,
  alumnosTxt: f.alumnosTxt || "", activa: true
});

/* ---------- recordatorio y aviso ---------- */
async function recordatorio(sid, ins, cont) {
  const s = sesiones.find(x => x.id === sid);
  const reenviar = !!s.recordatorioEnviado;
  if (!await confirmar(reenviar ? "¿Volver a mandar el recordatorio?" : "¿Mandar el recordatorio ahora?",
    `Se envía a los ${ins.length} familiares inscritos de la sesión del ${fechaDe(s.fecha)}.`, "Enviar")) return;
  avisar("Enviando…", "aviso", 1500);
  const r = await mandarLote({ tipo: "recordatorio", sesion: s, clase, inscs: ins, reenviar });
  if (r.enviado || r.repetido) { await updateDoc(doc(db, "nepo_sesiones", sid), { recordatorioEnviado: serverTimestamp() }); s.recordatorioEnviado = true; }
  avisar(resumenCuenta(r), r.enviado ? "ok" : "aviso", 5000); pintar(cont);
}

function aviso(ins) {
  abrirModal({
    titulo: "Aviso general", sub: `Llega a los ${ins.length} familiares de esta clase que tienen correo.`,
    cuerpo: `<div style="display:grid;gap:12px">
      <div class="campo"><label>Asunto</label><input id="a-asunto" maxlength="140"></div>
      <div class="campo"><label>Mensaje</label><textarea id="a-msg" style="min-height:140px"></textarea>
        <small>Se coloca donde tu plantilla de aviso general tenga {{MENSAJE}}.</small></div></div>`,
    acciones: [{ texto: "Cancelar" }, { texto: "Enviar aviso", clase: "btn", fn: async dlg => {
      const mensaje = $("#a-msg", dlg).value.trim();
      if (!mensaje) { avisar("Escribe el mensaje.", "aviso"); return false; }
      const asunto = $("#a-asunto", dlg).value.trim();
      const { plantillas } = await import("./datos.js");
      const pl = (await plantillas()).general;
      if (!pl?.html) { avisar("Primero sube la plantilla de aviso general.", "aviso"); return false; }
      const original = pl.asunto; if (asunto) pl.asunto = asunto;
      const r = await mandarLote({ tipo: "general", clase, inscs: ins, mensaje, sesion: {} });
      pl.asunto = original;
      avisar(resumenCuenta(r), r.enviado ? "ok" : "aviso", 5000);
    } }]
  });
}
