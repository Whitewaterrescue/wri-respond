/* WRI Respond — plain words, English / Español (G4 persona, 2026-11-10).
 *
 * Static text: elements with data-i18n="key" (textContent), data-i18n-html="key"
 * (innerHTML, trusted strings from this file only) or data-i18n-ph="key" (placeholder).
 * Script text: window.t('key', {name: ...}) with {name} placeholders.
 * What crews type (timeline, assignments, notes) is never translated here.
 * The choice is per phone (localStorage 'wri_respond_lang'); default English.
 */
(function () {
  'use strict';
  var KEY = 'wri_respond_lang';

  var S = {
    en: {
      'lang.label': 'Language',
      // tabs + header
      'tab.map': 'Map', 'tab.live': 'Video', 'tab.recon': 'Report', 'tab.sitstat': 'Status', 'tab.resources': 'Equipment',
      'hdr.help': 'Get help', 'hdr.checkout': 'Check out', 'fab.log': 'My log',
      // code screen
      'pin.msg': 'Enter the code the crew gave you.', 'pin.enter': 'Enter',
      // check-in
      'si.incident': 'Incident', 'si.observer': "I'm watching from somewhere else (not working here)",
      'si.safety': 'I will get a safety talk before I start work.',
      'si.name': 'Your name', 'si.org': 'Company', 'si.contact': 'Phone or email',
      'si.equip': 'I brought trucks, boats or a crew', 'si.btn': 'Check in',
      'si.needSafety': 'Tick the safety talk box, or tick "watching from somewhere else".',
      // report
      'rc.where': '1 · Where is it?', 'rc.whereHint': 'Tap the map where it is.', 'rc.here': "📍 I'm there now",
      'rc.what': '2 · What is it?', 'rc.more': '3 · Tell us more', 'rc.desc': 'What did you see? Is anyone hurt?',
      'rc.photos': 'Photos (you can skip this)', 'rc.crew': 'More details (crew name)', 'rc.send': 'Send report',
      'rc.sending': 'Sending…', 'rc.sentTitle': 'Report sent', 'rc.sentMap': 'It is on the incident map.',
      'rc.another': 'Send another', 'rc.pickType': 'Pick what it is first.', 'rc.noPlace': 'Tap the map to show where it is, or tap "I\'m there now".',
      'cat.Observations': 'What I see', 'cat.Response Actions': 'Work', 'cat.Safety': 'Safety',
      'type.injury': 'Someone is hurt or sick', 'type.stop_work': 'Stop work', 'type.near_miss': 'Close call',
      'type.other_safety': 'Other danger', 'type.oil_spotted': 'Oil', 'type.river_hazard': 'River danger',
      'type.injured_wildlife': 'Hurt animal',
      // alert result
      'al.coming': 'Help is coming.', 'al.told': 'We told: {who}.', 'al.callNow': 'Call {name} now', 'al.radio': 'Also radio or shout for help nearby.',
      'al.none': 'We could not reach anyone by message. Call or radio now.', 'al.ref': 'Report number: {ref}',
      'al.logged': 'The Safety Officer will see it in the safety log.',
      // get help
      'gh.title': 'Get help', 'gh.first': 'Someone badly hurt? Call 911 first.', 'gh.911': 'Call 911',
      'gh.sofr': 'Call the Safety Officer', 'gh.line': 'Call the WRI 24-hour line', 'gh.injury': 'Report someone hurt or sick',
      'gh.stop': 'Stop work (something is unsafe)', 'gh.hospital': 'Nearest hospital', 'gh.directions': 'Directions',
      'gh.close': 'Close', 'gh.loading': 'Getting phone numbers…', 'gh.noSofr': 'No Safety Officer phone is listed yet. Use the 24-hour line.',
      // first stop + safety + status
      'fs.title': 'Your first stop', 'fs.go': 'Go to:', 'fs.show': 'Show on map', 'fs.ask': 'Ask for:', 'fs.call': 'Call',
      'fs.job': 'Your job on the chart:', 'fs.noPlace': 'Ask at check-in where to go.',
      'role.stam': 'Staging Manager', 'role.sofr': 'Safety Officer', 'role.ic': 'Incident Commander',
      'ss.checked': 'Checked {time}', 'ss.newest': 'newest info {ago}',
      'sf.title': 'Safety today', 'sf.wear': 'Wear:', 'sf.meet': 'If there is an emergency, meet at:',
      'sf.rule': 'Anyone can stop work. If something feels unsafe, or you feel sick, stop, move away and tell your boss.',
      'sf.from208': 'Safety message', 'sf.hazards': 'Dangers:',
      'st.title': 'Current status', 'st.newest': 'Newest information:', 'st.oldTail': "Nothing newer has been posted. Call the incident team for today's status.",
      'st.latest': 'Latest:', 'st.people': 'People:', 'st.checkedIn': '{n} checked in', 'st.onChart': '{n} on the work chart',
      'st.noCheckins': 'check-ins not available', 'st.equip': 'Equipment:', 'st.req': 'Open requests:', 'st.safety': 'Safety:',
      'st.updating': 'Updating…',
      // check-out
      'co.title': 'Check out?', 'co.body': "This ends your check-in. Anything you haven't sent will be lost.",
      'co.cancel': 'Cancel', 'co.ok': 'Check out', 'ty.title': 'Thank you', 'ty.reports': 'Reports sent',
      'help.title': 'How this app works', 'help.radio': 'Your radio is still the fastest way to get help.',
      'help.l1': '<b>&#127384; Get help</b>: the red button at the top. Call 911 or the Safety Officer, or report someone hurt.',
      'help.l2': '<b>&#128205; Report</b>: tell us what you see. Oil, a danger, someone hurt.',
      'help.l3': '<b>&#128202; Status</b>: where to go, who to ask, and today\'s safety rules.',
      'help.l4': '<b>&#128506; Map</b>: where things are. &#127919; takes you back to the incident.',
      'help.l5': '<b>&#128221; My log</b>: write down what you did. Tap <b>Check out</b> when you leave.',
      'help.more': 'More words', 'help.ok': 'Got it',
      'lv.title': 'Drone video', 'lv.checking': 'Checking for drone video…', 'lv.watch': 'Watch drone video',
      'lv.none': 'No drone video right now. It shows here when a WRI drone is flying and streaming.',
      'lv.live': '{n} drone(s) streaming now.', 'lv.unknown': "Couldn't check for drone video. You can still try.",
      'lv.other': 'Other video feed (Nova)',
      'sf.everyone': 'Everyone', 'sf.water': 'On or near the water', 'sf.task': 'If your task needs it (ask your boss)',
      'kp.button': 'Key places', 'kp.title': 'Key places', 'kp.incident': 'Incident location',
      'kp.straight': 'Distances are straight-line from the incident location, not driving distance.',
      'kp.finding': 'Finding places near the incident…', 'kp.atIncident': 'at the incident', 'kp.byRoad': 'by road',
      'kp.failed': "Couldn't reach the incident's places (slow signal?). Close and tap Key places again.",
      'kp.noStaging': 'No staging area mapped for this incident yet: ask your supervisor.',
      'kp.icp': 'Command post', 'kp.staging': 'Staging', 'kp.ramp': 'Boat ramps', 'kp.decon': 'Decon',
      'kp.lz': 'Landing zones', 'kp.aid': 'Aid stations', 'kp.hospital': 'Hospitals',
      'kp.t.icp': 'Incident Command Post', 'kp.t.staging': 'Staging area', 'kp.t.planned': 'Planned staging area',
      'kp.t.ramp': 'Boat ramp', 'kp.t.decon': 'Decon', 'kp.t.lz': 'Landing zone', 'kp.t.aid': 'Aid station', 'kp.t.hospital': 'Hospital',
      'ty.reqs': 'Your supply requests: {ids}. To follow them, call the WRI 24-hour line {line}.'
    },
    es: {
      'lang.label': 'Idioma',
      'tab.map': 'Mapa', 'tab.live': 'Video', 'tab.recon': 'Reportar', 'tab.sitstat': 'Estado', 'tab.resources': 'Equipo',
      'hdr.help': 'Ayuda', 'hdr.checkout': 'Salir', 'fab.log': 'Mi registro',
      'pin.msg': 'Escriba el código que le dio el equipo.', 'pin.enter': 'Entrar',
      'si.incident': 'Incidente', 'si.observer': 'Estoy mirando desde otro lugar (no trabajo aquí)',
      'si.safety': 'Recibiré una charla de seguridad antes de empezar a trabajar.',
      'si.name': 'Su nombre', 'si.org': 'Compañía', 'si.contact': 'Teléfono o correo',
      'si.equip': 'Traje camiones, botes o un equipo de trabajo', 'si.btn': 'Registrarme',
      'si.needSafety': 'Marque la charla de seguridad, o marque "mirando desde otro lugar".',
      'rc.where': '1 · ¿Dónde está?', 'rc.whereHint': 'Toque el mapa donde está.', 'rc.here': '📍 Estoy ahí ahora',
      'rc.what': '2 · ¿Qué es?', 'rc.more': '3 · Cuéntenos más', 'rc.desc': '¿Qué vio? ¿Hay alguien herido?',
      'rc.photos': 'Fotos (puede saltar esto)', 'rc.crew': 'Más detalles (nombre del equipo)', 'rc.send': 'Enviar reporte',
      'rc.sending': 'Enviando…', 'rc.sentTitle': 'Reporte enviado', 'rc.sentMap': 'Está en el mapa del incidente.',
      'rc.another': 'Enviar otro', 'rc.pickType': 'Primero elija qué es.', 'rc.noPlace': 'Toque el mapa para mostrar dónde está, o toque "Estoy ahí ahora".',
      'cat.Observations': 'Lo que veo', 'cat.Response Actions': 'Trabajo', 'cat.Safety': 'Seguridad',
      'type.injury': 'Alguien está herido o enfermo', 'type.stop_work': 'Parar el trabajo', 'type.near_miss': 'Casi accidente',
      'type.other_safety': 'Otro peligro', 'type.oil_spotted': 'Aceite', 'type.river_hazard': 'Peligro en el río',
      'type.injured_wildlife': 'Animal herido',
      'al.coming': 'La ayuda viene en camino.', 'al.told': 'Avisamos a: {who}.', 'al.callNow': 'Llame a {name} ahora',
      'al.radio': 'También pida ayuda por radio o a gritos a quien esté cerca.',
      'al.none': 'No pudimos avisar a nadie por mensaje. Llame o use el radio ahora.', 'al.ref': 'Número de reporte: {ref}',
      'al.logged': 'El Oficial de Seguridad lo verá en el registro de seguridad.',
      'gh.title': 'Pedir ayuda', 'gh.first': '¿Alguien muy herido? Llame primero al 911.', 'gh.911': 'Llamar al 911',
      'gh.sofr': 'Llamar al Oficial de Seguridad', 'gh.line': 'Llamar a la línea de WRI (24 horas)',
      'gh.injury': 'Reportar a alguien herido o enfermo', 'gh.stop': 'Parar el trabajo (algo no es seguro)',
      'gh.hospital': 'Hospital más cercano', 'gh.directions': 'Cómo llegar', 'gh.close': 'Cerrar',
      'gh.loading': 'Buscando los teléfonos…', 'gh.noSofr': 'Todavía no hay teléfono del Oficial de Seguridad. Use la línea de 24 horas.',
      'fs.title': 'Su primera parada', 'fs.go': 'Vaya a:', 'fs.show': 'Ver en el mapa', 'fs.ask': 'Pregunte por:', 'fs.call': 'Llamar',
      'fs.job': 'Su puesto:', 'fs.noPlace': 'Pregunte en el registro adónde ir.',
      'role.stam': 'Encargado del área de espera', 'role.sofr': 'Oficial de Seguridad', 'role.ic': 'Comandante del Incidente',
      'ss.checked': 'Revisado {time}', 'ss.newest': 'información más reciente: {ago}',
      'sf.title': 'Seguridad hoy', 'sf.wear': 'Use:', 'sf.meet': 'Si hay una emergencia, reúnase en:',
      'sf.rule': 'Cualquiera puede parar el trabajo. Si algo no es seguro, o se siente mal, pare, aléjese y avise a su jefe.',
      'sf.from208': 'Mensaje de seguridad', 'sf.hazards': 'Peligros:',
      'st.title': 'Estado actual', 'st.newest': 'Información más reciente:', 'st.oldTail': 'No hay nada más nuevo. Llame al equipo del incidente para el estado de hoy.',
      'st.latest': 'Último:', 'st.people': 'Personas:', 'st.checkedIn': '{n} registrados', 'st.onChart': '{n} en el organigrama',
      'st.noCheckins': 'registros no disponibles', 'st.equip': 'Equipo:', 'st.req': 'Pedidos abiertos:', 'st.safety': 'Seguridad:',
      'st.updating': 'Actualizando…',
      'co.title': '¿Salir?', 'co.body': 'Esto termina su registro. Lo que no haya enviado se perderá.',
      'co.cancel': 'Cancelar', 'co.ok': 'Salir', 'ty.title': 'Gracias', 'ty.reports': 'Reportes enviados',
      'help.title': 'Cómo funciona', 'help.radio': 'El radio sigue siendo la forma más rápida de pedir ayuda.',
      'help.l1': '<b>&#127384; Ayuda</b>: el botón rojo arriba. Llame al 911 o al Oficial de Seguridad, o reporte a alguien herido.',
      'help.l2': '<b>&#128205; Reportar</b>: díganos lo que ve. Aceite, un peligro, alguien herido.',
      'help.l3': '<b>&#128202; Estado</b>: adónde ir, a quién preguntar y las reglas de seguridad de hoy.',
      'help.l4': '<b>&#128506; Mapa</b>: dónde están las cosas. &#127919; lo regresa al incidente.',
      'help.l5': '<b>&#128221; Mi registro</b>: anote lo que hizo. Toque <b>Salir</b> cuando se vaya.',
      'help.more': 'Más palabras (en inglés)', 'help.ok': 'Entendido',
      'lv.title': 'Video del dron', 'lv.checking': 'Buscando video del dron…', 'lv.watch': 'Ver video del dron',
      'lv.none': 'No hay video del dron ahora. Aparece aquí cuando un dron de WRI está volando y transmitiendo.',
      'lv.live': '{n} dron(es) transmitiendo ahora.', 'lv.unknown': 'No pudimos revisar si hay video. Puede intentarlo igual.',
      'lv.other': 'Otra transmisión (Nova)',
      'sf.everyone': 'Todos', 'sf.water': 'En el agua o cerca del agua', 'sf.task': 'Si su tarea lo necesita (pregunte a su jefe)',
      'kp.button': 'Lugares clave', 'kp.title': 'Lugares clave', 'kp.incident': 'Lugar del incidente',
      'kp.straight': 'Las distancias son en línea recta desde el incidente, no por carretera.',
      'kp.finding': 'Buscando lugares cerca del incidente…', 'kp.atIncident': 'en el incidente', 'kp.byRoad': 'por carretera',
      'kp.failed': 'No pudimos cargar los lugares (¿poca señal?). Cierre y toque Lugares clave otra vez.',
      'kp.noStaging': 'Todavía no hay un área de espera en el mapa: pregunte a su supervisor.',
      'kp.icp': 'Puesto de mando', 'kp.staging': 'Área de espera', 'kp.ramp': 'Rampas para botes', 'kp.decon': 'Descontaminación',
      'kp.lz': 'Zonas de aterrizaje', 'kp.aid': 'Puestos de primeros auxilios', 'kp.hospital': 'Hospitales',
      'kp.t.icp': 'Puesto de mando del incidente', 'kp.t.staging': 'Área de espera', 'kp.t.planned': 'Área de espera planeada',
      'kp.t.ramp': 'Rampa para botes', 'kp.t.decon': 'Descontaminación', 'kp.t.lz': 'Zona de aterrizaje', 'kp.t.aid': 'Primeros auxilios', 'kp.t.hospital': 'Hospital',
      'ty.reqs': 'Sus pedidos: {ids}. Para seguirlos, llame a la línea de WRI de 24 horas {line}.'
    }
  };

  // Safety gear words from the HASP (PPE list) and the picture shown next to each
  var PPE = {
    'gloves': ['🧤', 'Gloves', 'Guantes'], 'steel-toe boots': ['🥾', 'Steel-toe boots', 'Botas con punta de acero'],
    'boots': ['🥾', 'Boots', 'Botas'], 'face shield': ['🛡️', 'Face shield', 'Careta'],
    'chemical goggles': ['🥽', 'Chemical goggles', 'Gafas para químicos'], 'goggles': ['🥽', 'Goggles', 'Gafas'],
    'hard hat': ['⛑️', 'Hard hat', 'Casco'], 'helmet': ['⛑️', 'Helmet', 'Casco'],
    'safety glasses': ['🕶️', 'Safety glasses', 'Lentes de seguridad'], 'coverall': ['🥼', 'Coverall', 'Overol'],
    'respirator': ['😷', 'Respirator', 'Respirador'], 'pfd': ['🦺', 'Life jacket (PFD)', 'Chaleco salvavidas'],
    'life jacket': ['🦺', 'Life jacket', 'Chaleco salvavidas'], 'drysuit': ['🌊', 'Drysuit', 'Traje seco'],
    'hi-vis vest': ['🦺', 'Bright safety vest', 'Chaleco reflectante'], 'safety vest': ['🦺', 'Bright safety vest', 'Chaleco reflectante'],
    'hearing protection': ['🎧', 'Ear protection', 'Protección para oídos'], 'tyvek': ['🥼', 'Tyvek suit', 'Traje Tyvek']
  };

  function lang() {
    try { var l = localStorage.getItem(KEY); return S[l] ? l : 'en'; } catch (e) { return 'en'; }
  }
  window.lang = lang;
  window.t = function (k, vars) {
    var s = (S[lang()] && S[lang()][k]) || S.en[k] || k;
    if (vars) Object.keys(vars).forEach(function (n) { s = s.split('{' + n + '}').join(String(vars[n])); });
    return s;
  };
  window.tType = function (code, fallback) {   // report type label (English list label as the fallback)
    var k = 'type.' + code;
    return (S[lang()][k] || (lang() === 'en' ? '' : S.en[k])) || fallback || code;
  };
  window.ppeItem = function (name) {
    var k = String(name || '').trim().toLowerCase();
    var p = PPE[k];
    if (!p) { Object.keys(PPE).some(function (x) { if (k.indexOf(x) > -1) { p = PPE[x]; return true; } return false; }); }
    if (!p) return { icon: '•', label: String(name || '') };
    return { icon: p[0], label: lang() === 'es' ? p[2] : p[1] };
  };

  function apply(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    root.querySelectorAll('[data-i18n-html]').forEach(function (el) { el.innerHTML = t(el.getAttribute('data-i18n-html')); });
    root.querySelectorAll('[data-i18n-ph]').forEach(function (el) { el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph'))); });
    document.documentElement.lang = lang();
    document.querySelectorAll('.lang-btn').forEach(function (b) { b.classList.toggle('selected', b.getAttribute('data-lang') === lang()); });
  }
  window.applyI18n = apply;
  window.setLang = function (l) {
    try { localStorage.setItem(KEY, S[l] ? l : 'en'); } catch (e) {}
    apply();
    try { window.dispatchEvent(new CustomEvent('wri-lang')); } catch (e) {}
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { apply(); }); else apply();
})();
