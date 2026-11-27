/* Plantillas de correo de NEPO: cuatro espacios para subir tu HTML. */

import { db, doc, setDoc, serverTimestamp } from "../../firebase.js";
import { titulo, estado } from "../../app.js";
import { $, $$, esc, avisar, cargando, archivoATexto, enviarCorreo } from "../../utils.js";
import { TIPOS_CORREO, MARCADORES, plantillas, olvidarPlantillas, personalizarNepo, miCorreo } from "./datos.js";

const MUESTRA = {
  NOMBRE_FAMILIAR: "María Pérez", NOMBRE_ALUMNO: "Ana y Luis Pérez", CLASE: "NEPO · Grupo A",
  PLANTEL: "Plantel Centro", DOCENTE: "Profr. Ejemplo", FECHA: "martes 3 de diciembre",
  HORA: "17:00", LUGAR: "Aula 4", TEMA: "Tema de ejemplo", ASISTENCIAS: 5, FALTAS: 1,
  MENSAJE: "Aquí irá el mensaje que escriba el docente."
};

let guardadas = {};
const pendiente = {};   // tipo → html recién subido, aún sin guardar

export async function render(cont) {
  titulo("Plantillas de correo", "Sube tu HTML para cada tipo de correo de NEPO");
  cont.innerHTML = cargando();
  guardadas = await plantillas(true);

  cont.innerHTML = `
    <div class="cascada">
      <div class="aviso"><div>
        <strong>Cómo funciona.</strong> Diseña tu correo aparte, guárdalo como archivo <strong>.html</strong> y súbelo en el tipo que corresponda.
        Dentro del HTML puedes poner estos marcadores y se llenan solos con los datos de cada familiar:
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
          ${MARCADORES.map(m => `<span class="pill">{{${m}}}</span>`).join("")}
        </div>
      </div></div>
      <div class="cols2">${Object.keys(TIPOS_CORREO).map(tarjeta).join("")}</div>
    </div>`;

  Object.keys(TIPOS_CORREO).forEach(conectar);
}

function tarjeta(tipo) {
  const t = TIPOS_CORREO[tipo], g = guardadas[tipo];
  return `
    <div class="caja" data-tipo="${tipo}">
      <div class="caja__cab"><div><h2>${esc(t.nombre)}</h2><p>${esc(t.ayuda)}</p></div>
        <span class="pill ${g?.html ? "pill--ok" : "pill--alerta"}" data-estado>${g?.html ? "Cargada" : "Sin cargar"}</span></div>
      <div class="campo"><label>Asunto</label>
        <input data-asunto type="text" maxlength="140" value="${esc(g?.asunto || "")}" placeholder="Ej. Te esperamos mañana en NEPO"></div>
      <div class="campo" style="margin-top:12px"><label>Archivo .html</label>
        <input data-archivo type="file" accept=".html,text/html"></div>
      <iframe class="preview" data-vista sandbox="" style="margin-top:12px" title="Vista previa"
        srcdoc="${esc(g?.html ? personalizarNepo(g.html, MUESTRA) : "<p style='font:14px sans-serif;color:#888;padding:16px'>Aún no hay plantilla.</p>")}"></iframe>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">
        <button class="btn" data-guardar>Guardar</button>
        <button class="btn btn--suave" data-prueba>Enviarme una prueba</button>
      </div>
    </div>`;
}

function conectar(tipo) {
  const caja = $(`[data-tipo="${tipo}"]`);
  const html = () => pendiente[tipo] ?? guardadas[tipo]?.html ?? "";

  $("[data-archivo]", caja).addEventListener("change", async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      pendiente[tipo] = await archivoATexto(f);
      $("[data-vista]", caja).srcdoc = personalizarNepo(pendiente[tipo], MUESTRA);
      avisar("Archivo cargado. Falta guardar.", "aviso", 2200);
    } catch (err) { avisar(err.message, "mal"); }
  });

  $("[data-guardar]", caja).addEventListener("click", async b => {
    const btn = b.currentTarget, asunto = $("[data-asunto]", caja).value.trim();
    if (!html()) return avisar("Primero sube el archivo .html.", "aviso");
    btn.disabled = true;
    try {
      await setDoc(doc(db, "nepo_plantillas", tipo), {
        asunto, html: html(), actualizado: serverTimestamp(), actualizadoPor: miCorreo()
      });
      guardadas[tipo] = { id: tipo, asunto, html: html() };
      delete pendiente[tipo]; olvidarPlantillas();
      const p = $("[data-estado]", caja); p.textContent = "Cargada"; p.className = "pill pill--ok";
      avisar("Plantilla guardada.", "ok");
    } catch (err) { console.error(err); avisar("No se pudo guardar. Revisa las reglas de Firestore.", "mal"); }
    finally { btn.disabled = false; }
  });

  $("[data-prueba]", caja).addEventListener("click", async b => {
    if (!html()) return avisar("Primero sube el archivo .html.", "aviso");
    const btn = b.currentTarget; btn.disabled = true;
    const asunto = $("[data-asunto]", caja).value.trim() || TIPOS_CORREO[tipo].nombre;
    await enviarCorreo({
      to: miCorreo(), subject: `[Prueba] ${asunto}`, html: personalizarNepo(html(), MUESTRA)
    });
    avisar(`Prueba enviada a ${miCorreo()}.`, "ok");
    btn.disabled = false;
  });
}
