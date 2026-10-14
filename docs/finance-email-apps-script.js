/**
 * brahua-os · gastos desde correos (SPEC-finance-email, corte E4).
 *
 * Se instala en TU cuenta de Google (script.google.com), no en la app. Cada 5 minutos busca los
 * correos nuevos de BCP, BBVA y Yape en tu Gmail y los manda a brahua-os, que los deja como
 * «Sugerencias» en Finanzas (nada se registra solo). Guía paso a paso: docs/finance-email-setup.md.
 *
 * Propiedades del script (Configuración del proyecto → Propiedades del script), nunca en el código:
 *   FINANCE_EMAIL_URL     https://os.brahua.com/api/finance/email-ingest
 *   FINANCE_EMAIL_SECRET  el mismo valor que FINANCE_EMAIL_SECRET en Vercel
 *
 * Este archivo no lleva ningún secreto: se puede versionar y copiar tal cual.
 */

/* eslint-disable @typescript-eslint/no-unused-vars -- install, uninstall y resendWeek las ejecuta el editor de Google a mano */

// Debe coincidir con la app (src/modules/finance/email/constants.ts y parsers/index.ts): una prueba
// lo comprueba (tests/modules/finance-email/apps-script.test.ts).
var SENDERS = [
  'notificaciones@notificacionesbcp.com.pe',
  'procesos@bbva.com.pe',
  'notificaciones@yape.pe',
];
var BATCH_SIZE = 5; // la app acepta hasta 10 correos por petición
var TEXT_LIMIT = 8192; // la app rechaza textos más largos
var OVERLAP_MS = 10 * 60 * 1000; // se re-miran los últimos 10 minutos; la app no duplica por id
var MAX_THREADS = 50; // por ejecución
var STATE_KEY = 'LAST_SENT_MS';

function props_() {
  return PropertiesService.getScriptProperties();
}

/** Se corre UNA vez a mano: guarda desde cuándo mirar y crea el disparador de cada 5 minutos. */
function install() {
  var props = props_();
  if (!props.getProperty('FINANCE_EMAIL_URL') || !props.getProperty('FINANCE_EMAIL_SECRET')) {
    throw new Error('Faltan las propiedades FINANCE_EMAIL_URL y FINANCE_EMAIL_SECRET.');
  }
  // Los últimos 2 días entran como sugerencias (para ver que funciona); luego solo lo nuevo.
  props.setProperty(STATE_KEY, String(Date.now() - 2 * 24 * 60 * 60 * 1000));
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'run') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('run').timeBased().everyMinutes(5).create();
}

/** Quita el disparador (la app deja de recibir correos; lo ya enviado queda). */
function uninstall() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'run') ScriptApp.deleteTrigger(trigger);
  });
}

/**
 * Vuelve a mandar los últimos `days` días (p. ej. tras una regla nueva en la app: los correos que
 * eran «No pude leerlo» pasan a sugerencia; lo ya decidido no se toca). Se corre a mano.
 */
function resend(days) {
  props_().setProperty(STATE_KEY, String(Date.now() - (days || 2) * 24 * 60 * 60 * 1000));
  run();
}

/** Atajo para ejecutar desde el editor (no admite argumentos): vuelve a mandar la última semana. */
function resendWeek() {
  resend(7);
}

/** El disparador: busca, manda y recuerda hasta dónde llegó. */
function run() {
  var props = props_();
  var url = props.getProperty('FINANCE_EMAIL_URL');
  var secret = props.getProperty('FINANCE_EMAIL_SECRET');
  if (!url || !secret) throw new Error('Faltan las propiedades FINANCE_EMAIL_URL y FINANCE_EMAIL_SECRET.');

  var since = Number(props.getProperty(STATE_KEY)) || Date.now() - 24 * 60 * 60 * 1000;
  var from = since - OVERLAP_MS;
  // `after:` acepta segundos desde 1970. Gmail agrupa correos con el mismo asunto en un hilo:
  // por eso se recorren los mensajes (con su fecha) y no se etiquetan hilos.
  var query =
    '(' + SENDERS.map(function (sender) { return 'from:' + sender; }).join(' OR ') + ') after:' +
    Math.floor(from / 1000);
  var threads = GmailApp.search(query, 0, MAX_THREADS);

  var messages = [];
  var newest = since;
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (message) {
      var time = message.getDate().getTime();
      if (time < from) return;
      messages.push(toPayload_(message));
      if (time > newest) newest = time;
    });
  });
  if (messages.length === 0) return; // nada nuevo: no se llama a la app

  for (var i = 0; i < messages.length; i += BATCH_SIZE) {
    send_(url, secret, messages.slice(i, i + BATCH_SIZE));
  }
  // Solo si todo se mandó: si algo falló lanzó un error y se vuelve a intentar en 5 minutos.
  props.setProperty(STATE_KEY, String(newest));
}

function toPayload_(message) {
  return {
    id: message.getId(),
    from: message.getFrom(),
    subject: message.getSubject(),
    receivedAt: message.getDate().toISOString(),
    text: message.getPlainBody().slice(0, TEXT_LIMIT),
    auth: authResult_(message),
  };
}

/**
 * «pass» solo si Gmail comprobó al remitente (DMARC, o DKIM y SPF). Con otro resultado la app no
 * ofrece «Registrar» de un toque: pide revisar la sugerencia.
 */
function authResult_(message) {
  var header = '';
  try {
    header = message.getHeader('Authentication-Results') || '';
  } catch {
    return 'none';
  }
  if (/dmarc=pass/i.test(header) || (/dkim=pass/i.test(header) && /spf=pass/i.test(header))) {
    return 'pass';
  }
  return /(dkim|spf|dmarc)=fail/i.test(header) ? 'fail' : 'none';
}

function post_(url, secret, batch) {
  return UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + secret },
    payload: JSON.stringify({ messages: batch }),
    muteHttpExceptions: true,
  });
}

/**
 * 200: listo. 400 o 413: la app no aceptó ese lote; se prueba de uno en uno y el que siga
 * rechazado se salta (reintentarlo para siempre bloquearía los demás). 404: el secreto o la URL no
 * son los de la app. Cualquier otra cosa (5xx): error, se reintenta en la próxima ejecución.
 */
function send_(url, secret, batch) {
  var code = post_(url, secret, batch).getResponseCode();
  if (code === 200) return;
  if ((code === 400 || code === 413) && batch.length > 1) {
    batch.forEach(function (one) { send_(url, secret, [one]); });
    return;
  }
  if (code === 400 || code === 413) {
    console.warn('brahua-os no aceptó el correo ' + batch[0].id + ' (' + code + '); se omite.');
    return;
  }
  if (code === 404) {
    throw new Error('brahua-os respondió 404: revisa FINANCE_EMAIL_URL y FINANCE_EMAIL_SECRET.');
  }
  throw new Error('brahua-os respondió ' + code + '; se reintenta en la próxima ejecución.');
}
