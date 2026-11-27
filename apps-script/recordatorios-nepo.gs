/* ============================================================
   NEPO — recordatorio automático de sesión
   Se agrega al MISMO proyecto de Apps Script donde ya tienes el doPost
   que manda los correos. No toca ni reemplaza nada de lo que ya funciona.

   Qué hace: una vez al día (a la hora que elijas) busca las sesiones de
   mañana que sigan programadas, manda el correo "Recordatorio de sesión"
   a cada familiar inscrito que tenga correo y marca la sesión como
   recordada. Si ya se mandó con el botón de la app, no lo repite.

   Los pasos para activarlo están en el README (sección NEPO).
   ============================================================ */

const PROYECTO   = 'valores-ibime';   // projectId de Firebase
const DIAS_ANTES = 1;                 // 1 = un día antes
const HORA_ENVIO = 8;                 // hora del día en que corre (0–23)
const ENVIAR_COMO = 'Capacitaciones NEPO · IBIME'; // nombre que ve quien recibe

const BASE = 'https://firestore.googleapis.com/v1/projects/' + PROYECTO + '/databases/(default)/documents';

/* Ejecuta esta función UNA vez a mano: crea el disparador diario. */
function instalarDisparador() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'enviarRecordatoriosNepo')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('enviarRecordatoriosNepo').timeBased().everyDays(1).atHour(HORA_ENVIO).create();
}

function enviarRecordatoriosNepo() {
  const tz = Session.getScriptTimeZone();
  const objetivo = new Date(); objetivo.setDate(objetivo.getDate() + DIAS_ANTES);
  const fecha = Utilities.formatDate(objetivo, tz, 'yyyy-MM-dd');

  const plantilla = leer('nepo_plantillas/recordatorio');
  if (!plantilla || !plantilla.html) { Logger.log('No hay plantilla de recordatorio cargada.'); return; }

  const sesiones = consultar('nepo_sesiones', { fecha: fecha, estado: 'programada' });
  sesiones.forEach(s => {
    if (s.datos.recordatorioEnviado) return;           // ya se mandó (botón o ejecución previa)
    const clase = leer('nepo_clases/' + s.datos.claseId) || {};
    const inscritos = consultar('nepo_inscripciones', { claseId: s.datos.claseId });

    let enviados = 0;
    inscritos.forEach(i => {
      const d = i.datos;
      if (d.activa === false || !d.correo) return;
      const llave = 'recordatorio__' + s.id + '__' + d.familiarId;
      if (leer('nepo_correos/' + llave)) return;       // a esta persona ya se le mandó

      const valores = {
        NOMBRE_FAMILIAR: d.nombre, NOMBRE_ALUMNO: d.alumnosTxt || '', CLASE: clase.nombre || s.datos.claseNombre || '',
        PLANTEL: clase.plantel || s.datos.plantel || '', DOCENTE: clase.docentesNombres || '',
        FECHA: fechaLarga(s.datos.fecha), HORA: s.datos.hora || clase.horario || '',
        LUGAR: s.datos.lugar || clase.lugar || '', TEMA: s.datos.tema || '', ASISTENCIAS: '', FALTAS: '', MENSAJE: ''
      };
      try {
        MailApp.sendEmail({
          to: d.correo, name: ENVIAR_COMO,
          subject: rellenar(plantilla.asunto || 'Recordatorio de sesión', valores).replace(/<[^>]*>/g, ''),
          htmlBody: rellenar(plantilla.html, valores)
        });
        crear('nepo_correos', llave, {
          tipo: 'recordatorio', sesionId: s.id, claseId: s.datos.claseId, familiarId: d.familiarId,
          correo: d.correo, enviado: { timestampValue: new Date().toISOString() }, por: 'automatico'
        });
        enviados++;
      } catch (e) { Logger.log('Falló ' + d.correo + ': ' + e); }
    });

    marcarRecordada(s.id);
    Logger.log(s.datos.claseNombre + ' ' + fecha + ': ' + enviados + ' recordatorios.');
  });
}

/* ---------- plantillas ---------- */
function escapar(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function rellenar(texto, valores) {
  let out = String(texto || '');
  Object.keys(valores).forEach(k => { out = out.split('{{' + k + '}}').join(escapar(valores[k])); });
  return out;
}
function fechaLarga(iso) {
  const p = String(iso).split('-').map(Number);
  return Utilities.formatDate(new Date(p[0], p[1] - 1, p[2]), Session.getScriptTimeZone(), "EEEE d 'de' MMMM");
}

/* ---------- Firestore (API REST, con la cuenta que ejecuta el script) ---------- */
function llamar(url, opciones) {
  const r = UrlFetchApp.fetch(url, Object.assign({
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    contentType: 'application/json', muteHttpExceptions: true
  }, opciones || {}));
  return { codigo: r.getResponseCode(), cuerpo: r.getContentText() };
}

function leer(ruta) {
  const r = llamar(BASE + '/' + ruta);
  if (r.codigo === 404) return null;
  if (r.codigo !== 200) throw new Error('Firestore ' + r.codigo + ': ' + r.cuerpo);
  return decodificar(JSON.parse(r.cuerpo).fields || {});
}

function consultar(coleccion, igualdades) {
  const filtros = Object.keys(igualdades).map(c => ({
    fieldFilter: { field: { fieldPath: c }, op: 'EQUAL', value: { stringValue: igualdades[c] } }
  }));
  const r = llamar(BASE + ':runQuery', { method: 'post', payload: JSON.stringify({
    structuredQuery: { from: [{ collectionId: coleccion }],
      where: filtros.length > 1 ? { compositeFilter: { op: 'AND', filters: filtros } } : filtros[0] }
  }) });
  if (r.codigo !== 200) throw new Error('Firestore ' + r.codigo + ': ' + r.cuerpo);
  return JSON.parse(r.cuerpo).filter(x => x.document).map(x => ({
    id: x.document.name.split('/').pop(), datos: decodificar(x.document.fields || {})
  }));
}

function crear(coleccion, id, campos) {
  const fields = {};
  Object.keys(campos).forEach(k => {
    const v = campos[k];
    fields[k] = (v && typeof v === 'object') ? v : { stringValue: String(v) };
  });
  llamar(BASE + '/' + coleccion + '?documentId=' + encodeURIComponent(id), { method: 'post', payload: JSON.stringify({ fields: fields }) });
}

function marcarRecordada(id) {
  llamar(BASE + '/nepo_sesiones/' + id + '?updateMask.fieldPaths=recordatorioEnviado', {
    method: 'patch', payload: JSON.stringify({ fields: { recordatorioEnviado: { timestampValue: new Date().toISOString() } } })
  });
}

function decodificar(fields) {
  const o = {};
  Object.keys(fields).forEach(k => { o[k] = valor(fields[k]); });
  return o;
}
function valor(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(valor);
  if ('mapValue' in v) return decodificar(v.mapValue.fields || {});
  return null;
}
