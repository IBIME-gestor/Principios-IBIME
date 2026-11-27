/* Familias y familiares: catálogo, importación, ficha con asistencias y seguimiento. */

import {
  db, doc, addDoc, setDoc, updateDoc, writeBatch, collection, serverTimestamp, where
} from "../../firebase.js";
import { titulo, esAdmin, parametros, estado, cargarCatalogo } from "../../app.js";
import {
  $, $$, esc, avisar, confirmar, abrirModal, cargando, vacio, norm, limpiaMatricula,
  rebote, cargarSheetJS, fechaCorta
} from "../../utils.js";
import { clasesVisibles, traer, miCorreo, tally, pillPct, clave, fechaDe } from "./datos.js";
import { inscripcionDe } from "./clases.js";

let familiares = [], clases = [];

export async function render(cont) {
  const id = parametros().get("id");
  return id ? ficha(cont, id) : listado(cont);
}

/* ============================================================ LISTADO */
async function listado(cont) {
  titulo("Familias", "Catálogo de familiares que toman las capacitaciones");
  cont.innerHTML = cargando();
  [familiares, clases] = await Promise.all([traer("nepo_familiares"), clasesVisibles()]);
  familiares.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  cont.innerHTML = `
    <div class="cascada">
      <div class="caja">
        <div class="caja__cab"><div><h2>Familiares</h2><p>${familiares.length} registrados. Toca un nombre para ver su seguimiento.</p></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn--suave" id="b-importar">Importar Excel</button>
            <button class="btn" id="b-nuevo">Nuevo familiar</button></div></div>
        <div class="campo" style="margin-bottom:14px"><input id="f-buscar" type="search" placeholder="Buscar por nombre, familia, alumno o plantel"></div>
        <div id="tabla"></div>
      </div>
    </div>`;

  const pinta = () => {
    const q = norm($("#f-buscar").value);
    const lista = familiares.filter(f => !q || norm([f.nombre, f.familia, f.alumnosTxt, f.plantel].join(" ")).includes(q));
    $("#tabla").innerHTML = lista.length ? `<div class="tablabox"><table>
      <thead><tr><th>Familiar</th><th>Familia</th><th>Parentesco</th><th>Alumnos</th><th>Plantel</th><th>Correo</th></tr></thead>
      <tbody>${lista.map(f => `<tr>
        <td><a href="#/nepo/familias?id=${f.id}"><strong>${esc(f.nombre)}</strong></a>${f.activo === false ? ` <span class="pill">Baja</span>` : ""}</td>
        <td>${esc(f.familia || "—")}</td><td>${esc(f.parentesco || "—")}</td>
        <td style="font-size:.84rem">${esc(f.alumnosTxt || "—")}</td><td>${esc(f.plantel || "—")}</td>
        <td style="font-size:.84rem">${f.correo ? esc(f.correo) : `<span class="pill pill--alerta">Sin correo</span>`}</td></tr>`).join("")}
      </tbody></table></div>`
      : vacio({ titulo: "Sin resultados", texto: "Agrega familiares uno por uno o importa un Excel." });
  };
  pinta();
  $("#f-buscar").addEventListener("input", rebote(pinta));
  $("#b-nuevo").addEventListener("click", () => formFamiliar(null, () => render(cont)));
  $("#b-importar").addEventListener("click", () => importar(cont));
}

/* ---------- resolver alumnos y familia ---------- */
async function resolverAlumnos(txt) {
  if (!estado.catalogoListo) await cargarCatalogo();
  const mats = String(txt || "").split(/[\s,;]+/).map(limpiaMatricula).filter(Boolean);
  const alumnos = mats.map(m => estado.porMatricula.get(m)).filter(Boolean);
  return {
    matriculas: mats,
    alumnosTxt: alumnos.map(a => a.nombre).join(", "),
    plantel: alumnos[0]?.plantel || "",
    noEncontradas: mats.filter(m => !estado.porMatricula.has(m))
  };
}

function datosFamiliar(b, al) {
  const familia = (b.familia || "").trim();
  return {
    nombre: b.nombre.trim(), parentesco: (b.parentesco || "").trim(), correo: (b.correo || "").trim().toLowerCase(),
    telefono: (b.telefono || "").trim(), familia, familiaId: familia ? clave(familia) : "",
    matriculas: al.matriculas, alumnosTxt: al.alumnosTxt, plantel: (b.plantel || "").trim() || al.plantel
  };
}

/* ---------- alta y edición ---------- */
function formFamiliar(f, alTerminar) {
  const familias = [...new Set(familiares.map(x => x.familia).filter(Boolean))].sort();
  abrirModal({
    titulo: f ? "Editar familiar" : "Nuevo familiar",
    cuerpo: `<div style="display:grid;gap:12px">
      <div class="campo"><label>Nombre completo</label><input id="p-nombre" value="${esc(f?.nombre || "")}"></div>
      <div class="filtros">
        <div class="campo"><label>Parentesco</label><input id="p-par" value="${esc(f?.parentesco || "")}" placeholder="Mamá, papá, tutor…"></div>
        <div class="campo"><label>Teléfono</label><input id="p-tel" value="${esc(f?.telefono || "")}" inputmode="tel"></div>
      </div>
      <div class="campo"><label>Correo</label><input id="p-correo" type="email" value="${esc(f?.correo || "")}">
        <small>Sin correo no se le pueden mandar avisos, pero sí pasarle lista.</small></div>
      <div class="campo"><label>Familia</label>
        <input id="p-familia" list="p-familias" value="${esc(f?.familia || "")}" placeholder="Ej. Familia Pérez">
        <datalist id="p-familias">${familias.map(x => `<option value="${esc(x)}">`).join("")}</datalist>
        <small>Quienes comparten el mismo nombre de familia se suman en los informes por familia.</small></div>
      <div class="campo"><label>Matrículas de sus alumnos</label>
        <input id="p-mats" value="${esc((f?.matriculas || []).join(", "))}" placeholder="Separadas por coma"></div>
      <div class="campo"><label>Plantel</label><input id="p-plantel" value="${esc(f?.plantel || "")}"></div>
      ${f ? "" : `<div class="campo"><label>Inscribir en la clase</label>
        <select id="p-clase"><option value="">— más tarde —</option>${clases.map(c => `<option value="${c.id}">${esc(c.nombre)} · ${esc(c.plantel || "")}</option>`).join("")}</select></div>`}
    </div>`,
    acciones: [
      { texto: "Cancelar" },
      ...(f && esAdmin() ? [{ texto: f.activo === false ? "Reactivar" : "Dar de baja", fn: async () => {
        await updateDoc(doc(db, "nepo_familiares", f.id), { activo: f.activo === false }); avisar("Listo.", "ok"); alTerminar(); } }] : []),
      { texto: "Guardar", clase: "btn", fn: async dlg => {
        const nombre = $("#p-nombre", dlg).value.trim();
        if (!nombre) { avisar("Falta el nombre.", "aviso"); return false; }
        const al = await resolverAlumnos($("#p-mats", dlg).value);
        if (al.noEncontradas.length) avisar(`No encontré estas matrículas: ${al.noEncontradas.join(", ")}`, "aviso", 5000);
        const d = datosFamiliar({
          nombre, parentesco: $("#p-par", dlg).value, correo: $("#p-correo", dlg).value, telefono: $("#p-tel", dlg).value,
          familia: $("#p-familia", dlg).value, plantel: $("#p-plantel", dlg).value
        }, al);

        let id = f?.id;
        if (f) await updateDoc(doc(db, "nepo_familiares", id), d);
        else id = (await addDoc(collection(db, "nepo_familiares"), { ...d, activo: true, creado: serverTimestamp() })).id;
        if (!d.familiaId) await updateDoc(doc(db, "nepo_familiares", id), { familiaId: id, familia: d.nombre });

        const completo = { id, ...d, familiaId: d.familiaId || id, familia: d.familia || d.nombre };
        if (f) await refrescarInscripciones(completo);
        const cid = $("#p-clase", dlg)?.value;
        if (cid) { const c = clases.find(x => x.id === cid);
          await setDoc(doc(db, "nepo_inscripciones", `${cid}__${id}`), inscripcionDe(c, completo)); }
        avisar("Familiar guardado.", "ok"); alTerminar();
      } }
    ]
  });
}

/* Los datos del familiar viajan copiados en sus inscripciones; se mantienen al día. */
async function refrescarInscripciones(f) {
  const insc = await traer("nepo_inscripciones", where("familiarId", "==", f.id));
  if (!insc.length) return;
  const lote = writeBatch(db);
  insc.forEach(i => lote.update(doc(db, "nepo_inscripciones", i.id),
    { nombre: f.nombre, correo: f.correo, familiaId: f.familiaId, familia: f.familia, alumnosTxt: f.alumnosTxt }));
  await lote.commit();
}

/* ---------- importar Excel ---------- */
function importar(cont) {
  abrirModal({
    titulo: "Importar familiares",
    sub: "Archivo .xlsx, .xls o .csv. Las columnas pueden ir en cualquier orden.",
    cuerpo: `<p style="font-size:.88rem;color:var(--tinta-suave);margin-bottom:12px">
      Columnas: <strong>FAMILIAR</strong> (obligatoria), PARENTESCO, CORREO, TELEFONO, FAMILIA, MATRICULAS (separadas por coma), PLANTEL y CLASE
      (si pones el nombre exacto de una de tus clases, lo inscribe).</p>
      <div class="campo"><input id="x-archivo" type="file" accept=".xlsx,.xls,.csv"></div>
      <div id="x-res" style="margin-top:12px;font-size:.88rem"></div>`,
    acciones: [{ texto: "Cerrar" }, { texto: "Importar", clase: "btn", fn: async dlg => {
      const f = $("#x-archivo", dlg).files[0];
      if (!f) { avisar("Elige un archivo.", "aviso"); return false; }
      const XLSX = await cargarSheetJS();
      const libro = XLSX.read(await f.arrayBuffer());
      const filas = XLSX.utils.sheet_to_json(libro.Sheets[libro.SheetNames[0]], { defval: "", raw: false });
      const col = (fila, ...nombres) => { const k = Object.keys(fila).find(h => nombres.includes(norm(h))); return k ? String(fila[k]).trim() : ""; };

      let nuevos = 0, actualizados = 0, saltados = 0, inscritos = 0;
      for (const fila of filas) {
        const nombre = col(fila, "familiar", "nombre", "nombre familiar");
        if (!nombre) { saltados++; continue; }
        const al = await resolverAlumnos(col(fila, "matriculas", "matricula"));
        const d = datosFamiliar({
          nombre, parentesco: col(fila, "parentesco"), correo: col(fila, "correo", "email"), telefono: col(fila, "telefono", "tel"),
          familia: col(fila, "familia"), plantel: col(fila, "plantel")
        }, al);
        const previo = familiares.find(x => (d.correo && x.correo === d.correo) || (!d.correo && norm(x.nombre) === norm(d.nombre)));
        let id = previo?.id;
        if (previo) { await updateDoc(doc(db, "nepo_familiares", id), d); actualizados++; }
        else {
          const r = await addDoc(collection(db, "nepo_familiares"), { ...d, activo: true, creado: serverTimestamp() }); id = r.id;
          if (!d.familiaId) await updateDoc(r, { familiaId: id, familia: d.nombre });
          familiares.push({ id, ...d }); nuevos++;
        }
        const c = clases.find(x => norm(x.nombre) === norm(col(fila, "clase")));
        if (c) { await setDoc(doc(db, "nepo_inscripciones", `${c.id}__${id}`),
          inscripcionDe(c, { id, ...d, familiaId: d.familiaId || id, familia: d.familia || d.nombre })); inscritos++; }
      }
      avisar(`Listo: ${nuevos} nuevos, ${actualizados} actualizados, ${inscritos} inscritos${saltados ? `, ${saltados} filas sin nombre` : ""}.`, "ok", 6000);
      render(cont);
    } }]
  });
}

/* ============================================================ FICHA */
async function ficha(cont, id) {
  cont.innerHTML = cargando();
  const todos = await traer("nepo_familiares");
  const f = todos.find(x => x.id === id);
  if (!f) { cont.innerHTML = `<div class="caja">${vacio({ titulo: "No encontré a esa persona", texto: "Pudo haberse eliminado." })}</div>`; return; }
  titulo(f.nombre, [f.parentesco, f.familia].filter(Boolean).join(" · "));

  const yo = miCorreo();
  const [insc, asis, notasTodas, cls] = await Promise.all([
    traer("nepo_inscripciones", where("familiarId", "==", id)),
    traer("nepo_asistencias", where("familiarId", "==", id)),
    esAdmin() ? traer("nepo_notas", where("familiarId", "==", id)) : traer("nepo_notas", where("docentes", "array-contains", yo)),
    clasesVisibles({ incluirArchivadas: true })
  ]);
  const misIds = new Set(cls.map(c => c.id));
  const notas = notasTodas.filter(n => n.familiarId === id).sort((a, b) => (b.fecha?.seconds || 0) - (a.fecha?.seconds || 0));
  const hermanos = f.familiaId ? todos.filter(x => x.familiaId === f.familiaId && x.id !== id && x.activo !== false) : [];
  const asisFamilia = hermanos.length ? await traer("nepo_asistencias", where("familiaId", "==", f.familiaId)) : asis;

  const t = tally(asis), tf = tally(asisFamilia);
  const verAsis = asis.filter(a => esAdmin() || misIds.has(a.claseId)).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  const clasesIns = insc.filter(i => i.activa !== false && misIds.has(i.claseId));

  cont.innerHTML = `
    <div class="cascada">
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <a class="btn btn--linea btn--chico" href="#/nepo/familias">← Familias</a>
        <button class="btn btn--suave btn--chico" id="b-editar">Editar datos</button></div>

      <div class="rejilla rejilla--4">
        <div class="dato dato--rojo"><b>${t.pct === null ? "—" : t.pct + "%"}</b><span>asistencia individual</span></div>
        <div class="dato"><b>${t.presentes}</b><span>sesiones asistidas</span></div>
        <div class="dato"><b>${t.faltas}</b><span>faltas</span></div>
        <div class="dato"><b>${hermanos.length ? (tf.pct === null ? "—" : tf.pct + "%") : "—"}</b><span>asistencia de la familia</span></div>
      </div>

      <div class="cols2">
        <div class="caja"><div class="caja__cab"><div><h2>Datos</h2></div></div>
          <p style="font-size:.92rem;line-height:1.7">
            <strong>Correo:</strong> ${esc(f.correo || "—")}<br><strong>Teléfono:</strong> ${esc(f.telefono || "—")}<br>
            <strong>Plantel:</strong> ${esc(f.plantel || "—")}<br><strong>Alumnos:</strong> ${esc(f.alumnosTxt || (f.matriculas || []).join(", ") || "—")}<br>
            <strong>Clases:</strong> ${clasesIns.map(i => esc(i.claseNombre)).join(", ") || "—"}</p>
          ${hermanos.length ? `<p style="margin-top:12px;font-size:.88rem"><strong>Otros de la familia:</strong> ${hermanos.map(h =>
            `<a href="#/nepo/familias?id=${h.id}">${esc(h.nombre)}</a>`).join(", ")}</p>` : ""}
        </div>

        <div class="caja"><div class="caja__cab"><div><h2>Seguimiento</h2><p>Solo lo ven los docentes de la clase y la administración.</p></div></div>
          ${clasesIns.length ? `<div class="campo"><select id="n-clase">${clasesIns.map(i => `<option value="${i.claseId}">${esc(i.claseNombre)}</option>`).join("")}</select>
            <textarea id="n-texto" placeholder="Escribe un comentario de seguimiento…" style="margin-top:8px"></textarea></div>
            <button class="btn btn--chico" id="b-nota" style="margin-top:10px">Guardar comentario</button>`
            : `<p style="color:var(--tinta-suave);font-size:.88rem">Para comentar, la persona debe estar inscrita en una de tus clases.</p>`}
          <div style="margin-top:16px">${notas.map(n => `<div class="nota"><small>${esc(n.autorNombre || n.autorCorreo)} · ${esc(n.claseNombre || "")} · ${n.fecha?.seconds ? fechaCorta(new Date(n.fecha.seconds * 1000)) : ""}</small>${esc(n.texto)}</div>`).join("")
            || `<p style="color:var(--tinta-suave);font-size:.88rem">Todavía no hay comentarios.</p>`}</div>
        </div>
      </div>

      <div class="caja"><div class="caja__cab"><div><h2>Historial de asistencia</h2></div></div>
        ${verAsis.length ? `<div class="tablabox"><table><thead><tr><th>Fecha</th><th>Clase</th><th>Estado</th></tr></thead>
          <tbody>${verAsis.map(a => `<tr><td>${esc(fechaDe(a.fecha))}</td><td>${esc(a.claseNombre)}</td>
            <td><span class="pill ${a.estado === "presente" ? "pill--ok" : a.estado === "falta" ? "pill--rojo" : "pill--alerta"}">${esc(a.estado)}</span></td></tr>`).join("")}
          </tbody></table></div>` : `<p style="color:var(--tinta-suave);font-size:.9rem">Aún sin asistencias registradas.</p>`}
      </div>
    </div>`;

  $("#b-editar").addEventListener("click", async () => {
    clases = await clasesVisibles(); familiares = todos; formFamiliar(f, () => ficha(cont, id)); });
  $("#b-nota")?.addEventListener("click", async () => {
    const texto = $("#n-texto").value.trim(); if (!texto) return avisar("Escribe el comentario.", "aviso");
    const c = cls.find(x => x.id === $("#n-clase").value);
    await addDoc(collection(db, "nepo_notas"), {
      familiarId: id, claseId: c.id, claseNombre: c.nombre, texto, fecha: serverTimestamp(),
      autorNombre: estado.perfil?.nombre || "", autorCorreo: yo, docentes: [...new Set([...(c.docentes || []), yo])]
    });
    avisar("Comentario guardado.", "ok"); ficha(cont, id);
  });
}
