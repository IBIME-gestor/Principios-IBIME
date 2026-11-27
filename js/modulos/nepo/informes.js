/* Informes de NEPO: por familiar, familia, clase, sesión o detalle completo. */

import { where } from "../../firebase.js";
import { titulo, esAdmin } from "../../app.js";
import { $, $$, esc, cargando, vacio, exportarExcel, exportarCSV, hoyISO } from "../../utils.js";
import { clasesVisibles, traer, tally, pillPct, fechaDe } from "./datos.js";

const VISTAS = [
  ["familiar", "Por familiar"], ["familia", "Por familia"], ["clase", "Por clase"],
  ["sesion", "Por sesión"], ["detalle", "Detalle"]
];
let clases = [], datos = [], vista = "familiar", f = {};

export async function render(cont) {
  titulo("Informes", "Asistencia por familiar, familia, clase, sesión y periodo");
  cont.innerHTML = cargando();
  clases = await clasesVisibles({ incluirArchivadas: true });
  const hoy = hoyISO();
  f = { desde: `${hoy.slice(0, 4)}-01`, hasta: hoy.slice(0, 7), plantel: "", clase: "", menos: false };
  const planteles = [...new Set(clases.map(c => c.plantel).filter(Boolean))].sort();

  cont.innerHTML = `<div class="cascada">
    <div class="caja no-print">
      <div class="filtros">
        <div class="campo"><label>Desde (mes)</label><input id="f-desde" type="month" value="${f.desde}"></div>
        <div class="campo"><label>Hasta (mes)</label><input id="f-hasta" type="month" value="${f.hasta}"></div>
        <div class="campo"><label>Plantel</label><select id="f-plantel"><option value="">Todos</option>${planteles.map(p => `<option>${esc(p)}</option>`).join("")}</select></div>
        <div class="campo"><label>Clase</label><select id="f-clase"><option value="">Todas</option>${clases.map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("")}</select></div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:14px">
        <div class="pestanas" id="vistas">${VISTAS.map(([id, t]) => `<button class="btn btn--chico ${id === vista ? "" : "btn--suave"}" data-v="${id}">${t}</button>`).join("")}</div>
        <label style="display:flex;gap:6px;align-items:center;font-size:.86rem"><input id="f-menos" type="checkbox"> Primero quienes menos asisten</label>
        <span style="flex:1"></span>
        <button class="btn btn--suave btn--chico" id="b-xlsx">Excel</button>
        <button class="btn btn--suave btn--chico" id="b-csv">CSV</button>
        <button class="btn btn--suave btn--chico" id="b-imp">Imprimir</button>
      </div>
    </div>
    <div class="caja" id="res"></div></div>`;

  const recargar = () => cargar();
  ["#f-desde", "#f-hasta"].forEach(s => $(s).addEventListener("change", recargar));
  $("#f-plantel").addEventListener("change", e => { f.plantel = e.target.value; pintar(); });
  $("#f-clase").addEventListener("change", e => { f.clase = e.target.value; pintar(); });
  $("#f-menos").addEventListener("change", e => { f.menos = e.target.checked; pintar(); });
  $$("#vistas button").forEach(b => b.addEventListener("click", () => {
    vista = b.dataset.v; $$("#vistas button").forEach(x => x.classList.toggle("btn--suave", x !== b)); pintar(); }));
  $("#b-imp").addEventListener("click", () => window.print());
  $("#b-xlsx").addEventListener("click", () => exportarExcel(filasExport(), `NEPO-${vista}-${f.desde}-a-${f.hasta}`, "NEPO"));
  $("#b-csv").addEventListener("click", () => exportarCSV(filasExport(), `NEPO-${vista}-${f.desde}-a-${f.hasta}`));
  cargar();
}

async function cargar() {
  f.desde = $("#f-desde").value; f.hasta = $("#f-hasta").value;
  $("#res").innerHTML = cargando();
  const mias = new Set(clases.map(c => c.id));
  datos = (await traer("nepo_asistencias", where("periodo", ">=", f.desde), where("periodo", "<=", f.hasta)))
    .filter(a => mias.has(a.claseId));
  pintar();
}

const filtrados = () => datos.filter(a => (!f.plantel || a.plantel === f.plantel) && (!f.clase || a.claseId === f.clase));

/* Agrupa y devuelve { cols, filas } listas para tabla y exportación. */
function armar() {
  const rows = filtrados();
  if (vista === "detalle") {
    return { cols: ["Fecha", "Clase", "Plantel", "Familiar", "Familia", "Estado"],
      filas: [...rows].sort((a, b) => (a.fecha < b.fecha ? 1 : -1)).map(a => ({
        Fecha: a.fecha, Clase: a.claseNombre, Plantel: a.plantel, Familiar: a.nombre, Familia: a.familia, Estado: a.estado })) };
  }
  const cfg = {
    familiar: { k: a => a.familiarId, cab: ["Familiar", "Familia", "Clase"], r: g => [g[0].nombre, g[0].familia, [...new Set(g.map(x => x.claseNombre))].join(", ")] },
    familia:  { k: a => a.familiaId,  cab: ["Familia", "Integrantes", "Clase"], r: g => [g[0].familia, new Set(g.map(x => x.familiarId)).size, [...new Set(g.map(x => x.claseNombre))].join(", ")] },
    clase:    { k: a => a.claseId,    cab: ["Clase", "Plantel", "Familiares"], r: g => [g[0].claseNombre, g[0].plantel, new Set(g.map(x => x.familiarId)).size] },
    sesion:   { k: a => a.sesionId,   cab: ["Fecha", "Clase", "Plantel"], r: g => [g[0].fecha, g[0].claseNombre, g[0].plantel] }
  }[vista];

  const grupos = new Map();
  rows.forEach(a => { const k = cfg.k(a); (grupos.get(k) || grupos.set(k, []).get(k)).push(a); });
  let filas = [...grupos.values()].map(g => {
    const t = tally(g), base = cfg.r(g), o = {};
    cfg.cab.forEach((c, i) => { o[c] = base[i]; });
    return { ...o, Sesiones: t.total, Presentes: t.presentes, Faltas: t.faltas, Justificadas: t.justificadas, "% asistencia": t.pct };
  });
  filas.sort(f.menos
    ? (a, b) => (a["% asistencia"] ?? 101) - (b["% asistencia"] ?? 101)
    : (a, b) => String(vista === "sesion" ? b[cfg.cab[0]] : a[cfg.cab[0]]).localeCompare(String(vista === "sesion" ? a[cfg.cab[0]] : b[cfg.cab[0]]), "es"));
  return { cols: [...cfg.cab, "Sesiones", "Presentes", "Faltas", "Justificadas", "% asistencia"], filas };
}

const filasExport = () => armar().filas.map(o => ({ ...o, ...(("% asistencia" in o) ? { "% asistencia": o["% asistencia"] ?? "" } : {}) }));

function pintar() {
  const { cols, filas } = armar();
  const t = tally(filtrados());
  $("#res").innerHTML = `
    <div class="caja__cab"><div><h2>${VISTAS.find(v => v[0] === vista)[1]}</h2>
      <p>${f.desde} a ${f.hasta} · asistencia general ${t.pct === null ? "—" : t.pct + "%"} (${t.presentes} presentes, ${t.faltas} faltas, ${t.justificadas} justificadas)</p></div></div>
    ${filas.length ? `<div class="tablabox"><table><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${filas.map(o => `<tr>${cols.map(c => {
        if (c === "% asistencia") return `<td>${pillPct(o[c])}</td>`;
        if (c === "Estado") return `<td><span class="pill ${o[c] === "presente" ? "pill--ok" : o[c] === "falta" ? "pill--rojo" : "pill--alerta"}">${esc(o[c])}</span></td>`;
        if (c === "Fecha") return `<td>${esc(vista === "detalle" ? o[c] : fechaDe(o[c]))}</td>`;
        return `<td${typeof o[c] === "number" ? ` class="num"` : ""}>${esc(o[c] ?? "")}</td>`;
      }).join("")}</tr>`).join("")}</tbody></table></div>
      <p style="margin-top:12px;font-size:.8rem;color:var(--tinta-suave)">El porcentaje es presentes entre todas las sesiones registradas de esa persona, clase o sesión.</p>`
    : vacio({ titulo: "Sin registros", texto: "No hay asistencias en ese periodo con esos filtros." })}`;
}
