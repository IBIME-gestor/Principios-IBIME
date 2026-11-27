/* Panel de NEPO: lo próximo, lo pendiente y cómo va la asistencia. */

import { titulo } from "../../app.js";
import { $, $$, esc, cargando, hoyISO, vacio } from "../../utils.js";
import { clasesVisibles, traer, tally, pillPct, fechaDe } from "./datos.js";
import { NEPO } from "../../config.js";

export async function render(cont) {
  titulo("NEPO", NEPO.nombreCompleto);
  cont.innerHTML = cargando();
  const clases = await clasesVisibles();
  const ids = new Set(clases.map(c => c.id));
  const hoy = hoyISO(), mes = hoy.slice(0, 7);

  const [sess, inscs, asis] = await Promise.all([
    traer("nepo_sesiones"), traer("nepo_inscripciones"), traer("nepo_asistencias")
  ]);
  const ss = sess.filter(s => ids.has(s.claseId));
  const ins = inscs.filter(i => ids.has(i.claseId) && i.activa !== false);
  const delMes = asis.filter(a => ids.has(a.claseId) && a.periodo === mes);
  const t = tally(delMes);

  const proximas = ss.filter(s => s.estado !== "cerrada" && s.fecha >= hoy).sort((a, b) => (a.fecha > b.fecha ? 1 : -1)).slice(0, 6);
  const sinCerrar = ss.filter(s => s.estado !== "cerrada" && s.fecha < hoy).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  const nombreClase = id => clases.find(c => c.id === id)?.nombre || "";

  if (!clases.length) { cont.innerHTML = `<div class="cascada"><div class="nepohero"><img src="assets/nepo-banner.jpg" alt="NEPO · IBIME"></div><div class="caja">${vacio({ titulo: "Aún no tienes clases", texto: "Cuando la administración te asigne una, aparecerá aquí." })}</div></div>`; return; }

  cont.innerHTML = `<div class="cascada">
    <div class="nepohero">
      <img src="assets/nepo-banner.jpg" alt="NEPO · IBIME: el niño con su ábaco, junto a la familia jaguar">
      <div class="nepohero__pie"><strong>NEPO</strong><span>${esc(NEPO.nombreCompleto)} · capacitaciones para familias</span>
        <a class="btn btn--chico" href="#/nepo/asistencia">Pasar lista</a></div>
    </div>
    <div class="rejilla rejilla--4">
      <div class="dato"><b>${clases.length}</b><span>clases activas</span></div>
      <div class="dato"><b>${new Set(ins.map(i => i.familiarId)).size}</b><span>familiares inscritos</span></div>
      <div class="dato"><b>${proximas.length}</b><span>sesiones próximas</span></div>
      <div class="dato dato--rojo"><b>${t.pct === null ? "—" : t.pct + "%"}</b><span>asistencia de este mes</span></div>
    </div>
    ${sinCerrar.length ? `<div class="aviso aviso--ambar"><div><strong>Sesiones pasadas sin cerrar:</strong> al cerrarlas se avisa a quienes faltaron.
      ${sinCerrar.slice(0, 5).map(s => `<a href="#/nepo/asistencia?s=${s.id}" style="margin-left:8px">${esc(nombreClase(s.claseId))} · ${esc(fechaDe(s.fecha))}</a>`).join("")}</div></div>` : ""}
    <div class="caja"><div class="caja__cab"><div><h2>Próximas sesiones</h2></div></div>
      ${proximas.length ? `<div class="tablabox"><table><thead><tr><th>Fecha</th><th>Clase</th><th>Hora</th><th>Recordatorio</th><th></th></tr></thead>
        <tbody>${proximas.map(s => `<tr><td><strong>${esc(fechaDe(s.fecha))}</strong>${s.fecha === hoy ? ` <span class="pill pill--ok">Hoy</span>` : ""}</td>
          <td>${esc(nombreClase(s.claseId))}</td><td class="num">${esc(s.hora || "—")}</td>
          <td>${s.recordatorioEnviado ? `<span class="pill pill--ok">Enviado</span>` : `<span class="pill">Pendiente</span>`}</td>
          <td><a class="btn btn--suave btn--chico" href="#/nepo/asistencia?s=${s.id}">Pasar lista</a></td></tr>`).join("")}</tbody></table></div>`
      : `<p style="color:var(--tinta-suave);font-size:.9rem">No hay sesiones próximas. Créalas dentro de cada clase.</p>`}
    </div></div>`;
}
