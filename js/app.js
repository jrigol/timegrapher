import { AudioCapture, listInputs, requestPermission, hasPermission, guessProbe } from './audio.js';
import { Bandpass, Envelope } from './dsp/filters.js';
import { EnvHistory, TickDetector, TickAligner } from './dsp/ticks.js';
import { BphDetector, STANDARD_BPH } from './dsp/bph.js';
import { RateTracker } from './dsp/tracker.js';
import { AmplitudeMeter, dtFromAmplitude } from './dsp/amplitude.js';
import { ClockCalibration } from './calibration.js';
import { PaperTape } from './ui/paper.js';
import { TimeSeries } from './ui/charts.js';
import { T } from './ui/theme.js';

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ estado */

const S = {
  fs: 48000,
  bph: 28800,
  bphAuto: true,
  bphLocked: false,
  bphRaw: 0,
  fitWindow: 20,
  running: false,
  lastGapCount: 0,
  envTau: 0.00035,
  quality: [],
  // Contadores de diagnóstico: sin esto, «no llega audio», «llega en silencio»
  // y «llega bien pero no hay tics» se ven exactamente igual en pantalla.
  blocks: 0,
  lastBlockMs: 0,
  level: 0,
  peak: 0,
  tickTimes: [],
  deviceLabel: '',
};

const cal = new ClockCalibration();
const capture = new AudioCapture(onBlock);

/**
 * Duraciones de calibración.
 *
 * La incertidumbre estadística sigue sigma[ppm] ~ 1750 / D^1.5 (verificado
 * contra el estimador en test/units.mjs): 2 min dan ±0,12 s/día y 5 min
 * ±0,03 s/día. Pedir media hora para bajar a ±0,002 s/día no tiene sentido
 * cuando la deriva térmica del propio cristal ya limita la exactitud absoluta
 * a 1-2 s/día. Por debajo de 2 min sí conviene no fiarse: ahí el jitter de
 * entrega, que es a rachas y no se promedia como ruido blanco, pesa demasiado.
 */
const CAL_MIN_SECONDS = 120;
const CAL_GOOD_SECONDS = 300;

/** deviceId para el que se pulsó «Ahora no». El descarte es de ESE dispositivo:
 *  al cambiar de sonda el aviso vuelve, que para la nueva sigue siendo cierto. */
let calDismissedFor = null;
const calDismissed = () => calDismissedFor !== null && calDismissedFor === cal.deviceId;

/** Todo lo que depende de la frecuencia de muestreo se construye al arrancar. */
const P = {
  bandpass: null, envelope: null, hist: null, raw: null,
  detector: null, aligner: null, bphDet: null,
  tracker: new RateTracker(), amp: null,
  envOut: new Float32Array(0), decBuf: new Float32Array(0), decim: null,
};

/** Media de bloques consecutivos: hace de antialias y de diezmado a la vez. */
class Decimator {
  constructor(factor) { this.factor = factor; this.acc = 0; this.n = 0; }
  reset() { this.acc = 0; this.n = 0; }
  process(x, out) {
    let k = 0;
    for (let i = 0; i < x.length; i++) {
      this.acc += x[i];
      if (++this.n === this.factor) { out[k++] = this.acc / this.factor; this.acc = 0; this.n = 0; }
    }
    return k;
  }
}

const DEC_TARGET = 2000; // Hz para la autocorrelación: sobra para resolver el periodo

function buildPipeline(fs) {
  S.fs = fs;
  const lo = Number($('band-lo').value) || 1000;
  const hi = Number($('band-hi').value) || 8000;
  P.bandpass = new Bandpass(fs, lo, hi);
  P.envelope = new Envelope(fs, S.envTau);
  P.hist = new EnvHistory(19);
  P.raw = new EnvHistory(18);           // ~5,5 s de audio crudo para el autoajuste
  P.detector = new TickDetector(fs, P.hist);
  P.detector.k = Number($('sens').value);
  P.aligner = new TickAligner(fs);
  P.aligner.enabled = $('align').checked;
  const factor = Math.max(1, Math.round(fs / DEC_TARGET));
  P.decim = new Decimator(factor);
  P.bphDet = new BphDetector(fs / factor, 6);
  P.amp = new AmplitudeMeter(fs);
  P.amp.liftAngle = Number($('lift').value) || 52;
  P.amp.relThreshold = (Number($('amp-thr').value) || 8) / 100;
  P.tracker.reset();
  applyBph(S.bph, true);
  S.quality = [];
}

function applyBph(bph, force = false) {
  if (!force && bph === S.bph) return;
  S.bph = bph;
  if (P.detector) P.detector.setBeatPeriod(3600 / bph);
  P.tracker.setBeatPeriod(3600 / bph);
  if (P.aligner) P.aligner.reset();
  if (P.amp) P.amp.reset();
}

/** Guarda que asegura que la ventana de amplitud de un tic está completa. */
function ampMargin() {
  const full = 7200 / S.bph;
  const dtMax = dtFromAmplitude(P.amp ? P.amp.minAmp : 100, full, P.amp ? P.amp.liftAngle : 52);
  // Cubre el medio ancho de la ventana de amplitud más un margen.
  return Math.round(((isFinite(dtMax) ? dtMax : 0.03) + 0.010) * S.fs);
}

/* ------------------------------------------------------- cadena por bloque */

function onBlock(msg, arrivalMs) {
  try {
    onBlockInner(msg, arrivalMs);
  } catch (e) {
    // Una excepción aquí mataba la cadena en silencio: el intervalo de pintado
    // seguía corriendo y la pantalla se quedaba a «—» sin ninguna pista.
    setStatus(`Error procesando audio: ${e.message}`, true);
    S.running = false;
  }
}

function onBlockInner(msg, arrivalMs) {
  if (!P.hist) return;
  cal.addPoint(msg.startFrame, arrivalMs, msg.gapCount);

  const gapped = msg.gapCount !== S.lastGapCount;
  S.lastGapCount = msg.gapCount;

  const x = msg.samples;

  // Nivel de entrada, antes de filtrar nada: es el único indicador que
  // distingue «no llega audio» de «llega audio pero no hay tics».
  let sum = 0, pk = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    sum += v * v;
    const a = v < 0 ? -v : v;
    if (a > pk) pk = a;
  }
  S.level = Math.sqrt(sum / x.length);
  S.peak = Math.max(S.peak * 0.9, pk);
  S.blocks++;
  S.lastBlockMs = performance.now();

  P.raw.write(msg.startFrame, x);   // crudo, antes de filtrar

  P.bandpass.processInPlace(x);
  if (P.envOut.length !== x.length) {
    P.envOut = new Float32Array(x.length);
    P.decBuf = new Float32Array(Math.ceil(x.length / P.decim.factor) + 2);
  }
  P.envelope.process(x, P.envOut);
  P.hist.write(msg.startFrame, P.envOut);

  if (gapped) {
    // El anillo tiene datos rancios en el hueco: no hay que escanearlos, y la
    // numeración de batidas anterior ya no encadena con la nueva.
    P.detector.pos = msg.startFrame;
    P.detector.floorInit = false;
    P.detector.lastPeak = -Infinity;
    P.tracker.lastT = NaN;
    P.decim.reset();
  }

  const nd = P.decim.process(P.envOut, P.decBuf);
  if (nd) P.bphDet.push(P.decBuf.subarray(0, nd));

  for (const tk of P.detector.detect(P.hist.end - ampMargin())) {
    S.tickTimes.push(S.lastBlockMs);
    processTick(tk);
  }
  const cutoff = S.lastBlockMs - 3000;
  while (S.tickTimes.length && S.tickTimes[0] < cutoff) S.tickTimes.shift();
}

function processTick(tk) {
  const tProv = cal.timeOf(tk.frame);
  const i = P.tracker.assign(tProv);
  if (i === null) return;   // espurio: ni se numera ni entrena la plantilla
  const parity = i & 1;

  const refined = P.aligner.refine(P.hist, tk.intFrame, parity);
  const t = isFinite(refined) ? cal.timeOf(refined) : tProv;
  P.tracker.lastT = t;   // la siguiente batida se numera desde el valor refinado
  P.tracker.add(i, t);
  P.aligner.learn(P.hist, tk.intFrame, parity);

  P.amp.measure(P.hist, tk.intFrame, 7200 / S.bph);

  if (tk.floor > 0 && tk.peak > 0) {
    S.quality.push(10 * Math.log10(tk.peak / tk.floor));
    if (S.quality.length > 64) S.quality.shift();
  }
}

/* ------------------------------------------------------------------- vista */

const tape = new PaperTape($('tape'));
const chRate = new TimeSeries($('ch-rate'), { title: 'Marcha', unit: 's/día', color: T.s1, decimals: 1, symmetric: true });
const chAmp = new TimeSeries($('ch-amp'), { title: 'Amplitud', unit: '°', color: T.s3, decimals: 0, band: { lo: 270, hi: 315 } });
const chBeat = new TimeSeries($('ch-beat'), { title: 'Error de batida', unit: 'ms', color: T.s2, decimals: 2 });
const charts = [chRate, chAmp, chBeat];

const rows = [];
let lastChartPush = 0;
let lastBphCheck = 0;
let t0Wall = 0;

function redraw() {
  tape.draw();
  for (const c of charts) c.draw();
}

function update() {
  try { updateInner(); } catch (e) { setStatus(`Error al refrescar: ${e.message}`, true); }
}

function updateInner() {
  if (!S.running) { paintDiag(); return; }
  const now = performance.now() / 1000;

  // --- bph automático ---
  if (now - lastBphCheck > 1) {
    lastBphCheck = now;
    const r = P.bphDet.analyze();
    S.bphRaw = r.bphRaw;
    S.bphLocked = r.locked;
    if (S.bphAuto && r.locked && r.bph && r.bph !== S.bph) applyBph(r.bph);
    paintBph(r);
  }

  const fit = P.tracker.fit(S.fitWindow);
  const amp = P.amp.value();

  paintRate(fit);
  paintAmp(amp);
  paintBeat(fit);
  paintQuality(fit);

  tape.setPoints(P.tracker.phases(tape.windowSeconds));

  if (fit && now - lastChartPush >= 1) {
    lastChartPush = now;
    const t = now - t0Wall;
    chRate.push(t, fit.rate);
    chBeat.push(t, fit.beatError);
    if (amp !== null) chAmp.push(t, amp);
    if (rows.length === 0 || t - rows[rows.length - 1].t >= 5) {
      rows.push({ t, clock: new Date(), rate: fit.rate, amp, beat: fit.beatError });
      if (rows.length > 400) rows.shift();
      if (!$('table-wrap').hidden) paintTable();
    }
  }

  paintCalibration();
  paintCalBanner();
  paintDiag();
  redraw();
}

const fmtSd = (ppm) => `±${Math.abs(ppm * 0.0864).toFixed(ppm * 0.0864 < 0.1 ? 3 : 2)} s/día`;

/**
 * Aviso de «este dispositivo no está calibrado», con la acción a mano.
 *
 * Sin esto, la única pista era una línea pequeña bajo la marcha, y arrancar la
 * medición exigía saber que el panel de calibración existe y desplegarlo.
 */
function paintCalBanner() {
  const el = $('cal-banner');
  const show = (title, text, cls, buttons) => {
    el.hidden = false;
    el.className = `banner ${cls}`;
    $('cb-title').textContent = title;
    $('cb-text').textContent = text;
    for (const [id, visible] of Object.entries(buttons)) $(id).hidden = !visible;
  };

  if (!S.running) { el.hidden = true; return; }

  if (cal.running) {
    const est = cal.estimate();
    const secs = cal.elapsedSeconds;
    if (est && secs >= CAL_MIN_SECONDS) {
      const quality = secs >= CAL_GOOD_SECONDS ? 'De sobra.' : 'Ya es utilizable; a los 5 min baja a ±0,03 s/día.';
      show('Calibración lista para aplicar',
        `${fmtClock(secs)} · ${est.ppm >= 0 ? '+' : ''}${est.ppm.toFixed(2)} ppm ` +
        `· incertidumbre ${fmtSd(est.sigmaPpm)}. ${quality}`,
        'ready', { 'cb-adopt': false, 'cb-start': false, 'cb-apply': true, 'cb-cancel': true, 'cb-hide': false });
    } else {
      const left = Math.max(0, CAL_MIN_SECONDS - secs);
      show('Calibrando el reloj de muestreo…',
        est
          ? `${fmtClock(secs)} · ${est.ppm >= 0 ? '+' : ''}${est.ppm.toFixed(2)} ppm ` +
            `· incertidumbre ${fmtSd(est.sigmaPpm)} · ${fmtClock(left)} para poder aplicarla`
          : `${fmtClock(secs)} · reuniendo bloques. Deja la pestaña en primer plano.`,
        'measuring', { 'cb-adopt': false, 'cb-start': false, 'cb-apply': false, 'cb-cancel': true, 'cb-hide': false });
    }
    return;
  }

  if (cal.candidate && !calDismissed()) {
    const c = cal.candidate.rec;
    const when = c.storedAt ? new Date(c.storedAt).toLocaleDateString('es-ES') : 'fecha desconocida';
    show('Hay una calibración guardada con este mismo nombre',
      `«${c.label}» · ${((c.factor - 1) * 1e6).toFixed(2)} ppm · ${when}. ` +
      'El identificador del dispositivo ha cambiado, cosa que pasa al borrar los datos del ' +
      'sitio o al cambiar de puerto USB. Si es la misma sonda, aplícala; si es otra unidad ' +
      'del mismo modelo, calibra de nuevo: comparten nombre pero no cristal.',
      '', { 'cb-adopt': true, 'cb-start': true, 'cb-apply': false, 'cb-cancel': false, 'cb-hide': true });
    $('cb-start').textContent = 'Calibrar de nuevo';
    return;
  }

  if (cal.source === 'none' && !calDismissed()) {
    show('Este dispositivo no está calibrado',
      'La marcha arrastra el error del cristal de la tarjeta de sonido: hasta ±8,6 s/día, ' +
      'más que toda la banda de un cronómetro. La amplitud y el error de batida no se ven afectados. ' +
      'Bastan 2 minutos; 5 lo dejan fino.',
      '', { 'cb-adopt': false, 'cb-start': true, 'cb-apply': false, 'cb-cancel': false, 'cb-hide': true });
    $('cb-start').textContent = 'Calibrar ahora';
    return;
  }

  el.hidden = true;
}

/** Lista de calibraciones guardadas, con la activa marcada. */
function paintCalList() {
  const el = $('cal-list');
  const items = cal.list();
  el.innerHTML = '';
  if (!items.length) {
    el.innerHTML = '<div class="cal-empty">Ninguna todavía.</div>';
    return;
  }
  for (const it of items) {
    const row = document.createElement('div');
    row.className = `cal-row${it.active ? ' active' : ''}`;
    const when = it.storedAt ? new Date(it.storedAt).toLocaleDateString('es-ES') : '—';
    row.innerHTML =
      `<span class="name">${escapeHtml(it.label)}</span>` +
      `<span class="val">${it.ppm >= 0 ? '+' : ''}${it.ppm.toFixed(2)} ppm</span>` +
      `<span class="when">${when}</span>` +
      (it.active ? '<span class="tag">en uso</span>' : '');
    const del = document.createElement('button');
    del.className = 'ghost';
    del.textContent = 'Borrar';
    del.addEventListener('click', () => {
      cal.remove(it.deviceId);
      paintCalList();
      setStatus(`Calibración de «${it.label}» borrada.`);
    });
    row.appendChild(del);
    el.appendChild(row);
  }
}

function escapeHtml(t) {
  return String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** Arranca la medición y deja el panel a la vista. */
function startCalibration() {
  if (!S.running) { setStatus('La calibración necesita la captura en marcha.', true); return; }
  cal.start(S.fs, $('device').value, S.deviceLabel);
  $('btn-cal').textContent = 'Detener medición';
  $('cal-details').open = true;
}

function applyCalibration() {
  const est = cal.commit();
  if (!est) return;
  cal.stop();
  $('btn-cal').textContent = 'Iniciar medición';
  $('btn-cal-apply').disabled = true;
  $('cal-live').textContent =
    `Corrección aplicada y guardada para este dispositivo: ${est.ppm.toFixed(2)} ± ${est.sigmaPpm.toFixed(2)} ppm ` +
    `sobre ${fmtClock(est.seconds)} (${fmtSd(est.sigmaPpm)}).`;
  setStatus(`Calibración aplicada: ${est.ppm >= 0 ? '+' : ''}${est.ppm.toFixed(2)} ppm, ` +
    `corrige ${cal.errorSecondsPerDay >= 0 ? '+' : ''}${cal.errorSecondsPerDay.toFixed(2)} s/día.`);
  paintCalList();
  P.tracker.reset();
}

const dbfs = (v) => (v > 1e-7 ? (20 * Math.log10(v)).toFixed(0) : '-inf');

/**
 * Estado de la cadena en una línea. Responde, por orden, a las tres preguntas
 * que hay que hacerse cuando no aparece ninguna lectura: ¿llegan bloques?,
 * ¿traen señal?, ¿se está detectando algo?
 */
function paintDiag() {
  const el = $('diag');
  if (!S.running) { el.hidden = true; return; }
  el.hidden = false;

  const st = capture.state;
  if (st !== 'running') {
    el.className = 'diag err';
    el.textContent = `AudioContext en estado «${st}»: no se está procesando nada. `
      + 'Pulsa en cualquier parte de la página para arrancarlo.';
    return;
  }

  const since = performance.now() - S.lastBlockMs;
  if (!S.blocks) {
    el.className = 'diag err';
    el.textContent = 'Sin audio: el contexto corre pero el worklet no ha entregado ni un bloque. '
      + 'La entrada elegida no está produciendo muestras.';
    return;
  }
  if (since > 1500) {
    el.className = 'diag err';
    el.textContent = `Audio interrumpido hace ${(since / 1000).toFixed(1)} s `
      + `(${S.blocks} bloques recibidos). El dispositivo ha dejado de entregar muestras.`;
    return;
  }

  const tps = S.tickTimes.length / 3;
  const parts = [
    `${S.blocks} bloques`,
    `nivel ${dbfs(S.level)} dBFS (pico ${dbfs(S.peak)})`,
    `${tps.toFixed(1)} tics/s`,
    `${S.fs} Hz`,
    st,
  ];
  if (S.level < 3e-5) {
    el.className = 'diag err';
    parts.push('— entrada en SILENCIO: dispositivo equivocado o entrada muteada');
  } else if (tps < 0.5) {
    el.className = 'diag warn';
    parts.push('— hay señal pero no se detectan tics: baja la sensibilidad o ajusta la banda');
  } else {
    el.className = 'diag';
  }
  el.textContent = parts.join(' · ');
}

function setChip(el, level, text) {
  el.className = `chip ${level}`;
  el.querySelector('.chip-text').textContent = text;
}

function paintRate(fit) {
  if (!fit) {
    $('v-rate').textContent = '—';
    setChip($('c-rate'), '', 'sin señal');
    $('n-rate').textContent = '';
    return;
  }
  const r = fit.rate;
  $('v-rate').textContent = (r >= 0 ? '+' : '') + r.toFixed(1);
  const a = Math.abs(r);
  setChip($('c-rate'),
    a <= 10 ? 'good' : a <= 30 ? 'warning' : a <= 90 ? 'serious' : 'critical',
    a <= 10 ? 'buena marcha' : a <= 30 ? 'regulable' : a <= 90 ? 'muy desviada' : 'revisar reloj');
  const parts = [`±${fit.rateSigma.toFixed(1)} (ajuste)`];
  if (cal.source === 'none') parts.push('sin calibrar: hasta ±8,6 s/día de sesgo');
  else parts.push(`corregido ${cal.ppm >= 0 ? '+' : ''}${cal.ppm.toFixed(1)} ppm`);
  $('n-rate').textContent = parts.join(' · ');
}

function paintAmp(amp) {
  const cov = P.amp ? P.amp.coverage : 0;
  if (amp === null) {
    $('v-amp').textContent = '—';
    setChip($('c-amp'), '', cov > 0 ? 'sin resolver' : 'sin señal');
    $('n-amp').textContent = P.amp && P.amp.lastDetail
      ? `dt fuera de rango (${(P.amp.lastDetail.dt * 1000).toFixed(1)} ms)` : '';
    return;
  }
  $('v-amp').textContent = Math.round(amp).toString();
  const level = amp >= 270 && amp <= 320 ? 'good'
    : amp >= 240 && amp <= 330 ? 'warning'
    : amp >= 200 ? 'serious' : 'critical';
  const label = level === 'good' ? 'sana'
    : level === 'warning' ? 'aceptable'
    : level === 'serious' ? 'baja' : 'muy baja';
  setChip($('c-amp'), level, label);
  $('n-amp').textContent = `alzada ${P.amp.liftAngle}° · ${Math.round(cov * 100)}% de tics resueltos`;
}

function paintBeat(fit) {
  if (!fit) {
    $('v-beat').textContent = '—';
    setChip($('c-beat'), '', 'sin señal');
    $('n-beat').textContent = '';
    return;
  }
  const be = fit.beatError;
  $('v-beat').textContent = be.toFixed(2);
  setChip($('c-beat'),
    be <= 0.3 ? 'good' : be <= 0.6 ? 'warning' : be <= 1.0 ? 'serious' : 'critical',
    be <= 0.3 ? 'centrado' : be <= 0.6 ? 'aceptable' : be <= 1.0 ? 'descentrado' : 'muy descentrado');
  $('n-beat').textContent = `${fit.n} batidas en ${fit.span.toFixed(0)} s`;
}

function paintBph(r) {
  $('v-bph').textContent = S.bph.toLocaleString('es-ES');
  if (!S.bphAuto) {
    setChip($('c-bph'), 'good', 'manual');
    $('n-bph').textContent = r && r.bphRaw ? `medido ${Math.round(r.bphRaw).toLocaleString('es-ES')}` : '';
    return;
  }
  if (S.bphLocked) {
    setChip($('c-bph'), 'good', 'detectado');
    $('n-bph').textContent = `bruto ${Math.round(S.bphRaw).toLocaleString('es-ES')} · confianza ${(r.confidence * 100).toFixed(0)}%`;
  } else {
    setChip($('c-bph'), 'warning', 'buscando');
    $('n-bph').textContent = r && r.bphRaw
      ? `bruto ${Math.round(r.bphRaw).toLocaleString('es-ES')}, sin encajar en la tabla`
      : 'sin periodicidad clara';
  }
}

function paintQuality(fit) {
  const q = S.quality.length >= 8 ? median(S.quality) : NaN;
  const bar = $('quality-bar');
  if (!isFinite(q)) {
    bar.style.width = '0%';
    $('quality-note').textContent = 'Sin señal.';
    return;
  }
  const pct = Math.max(0, Math.min(100, (q / 40) * 100));
  bar.style.width = `${pct}%`;
  bar.style.background = q >= 20 ? T.good : q >= 12 ? T.warning : T.critical;

  let cov = NaN;
  if (fit && fit.span > 0) cov = fit.n / (fit.span / (3600 / S.bph) + 1);
  const covTxt = isFinite(cov) ? ` · ${Math.round(Math.min(1, cov) * 100)}% de batidas detectadas` : '';
  $('quality-note').textContent = q >= 20
    ? `Buena (${q.toFixed(0)} dB sobre el ruido)${covTxt}`
    : q >= 12
      ? `Justa (${q.toFixed(0)} dB)${covTxt}. Recolocar el reloj mejorará sobre todo la amplitud.`
      : `Pobre (${q.toFixed(0)} dB)${covTxt}. Asienta el reloj contra el sensor antes de fiarte de la amplitud.`;
}

function paintTable() {
  const tb = $('table').querySelector('tbody');
  tb.innerHTML = '';
  for (const r of rows.slice(-120).reverse()) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.clock.toLocaleTimeString('es-ES')}</td>` +
      `<td>${(r.rate >= 0 ? '+' : '') + r.rate.toFixed(1)}</td>` +
      `<td>${r.amp === null ? '—' : Math.round(r.amp)}</td>` +
      `<td>${r.beat.toFixed(2)}</td>`;
    tb.appendChild(tr);
  }
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/* ------------------------------------------------------------ calibración */

function paintCalibration() {
  $('cal-active').textContent = cal.source === 'none'
    ? 'ninguna' : `${cal.ppm >= 0 ? '+' : ''}${cal.ppm.toFixed(2)} ppm`;
  $('cal-source').textContent = cal.source === 'measured' ? 'medida en esta sesión'
    : cal.source === 'stored' ? `guardada${cal.storedAt ? ` (${new Date(cal.storedAt).toLocaleDateString('es-ES')})` : ''}`
    : 'sin calibrar';
  $('cal-bias').textContent = cal.source === 'none'
    ? '—' : `${cal.errorSecondsPerDay >= 0 ? '+' : ''}${cal.errorSecondsPerDay.toFixed(2)} s/día`;

  if (!cal.running) return;
  const est = cal.estimate();
  const secs = cal.elapsedSeconds;
  if (!est) {
    $('cal-live').textContent = `Midiendo… ${secs.toFixed(0)} s, ${cal.n} bloques. Hacen falta unos segundos más.`;
    $('btn-cal-apply').disabled = true;
    return;
  }
  const sd = est.ppm * 86400 / 1e6;
  const sdSigma = est.sigmaPpm * 86400 / 1e6;
  const ready = secs >= CAL_MIN_SECONDS;
  $('btn-cal-apply').disabled = !ready;
  const conf = secs >= CAL_GOOD_SECONDS ? 'de sobra'
    : secs >= CAL_MIN_SECONDS ? 'utilizable' : 'corta todavía';
  $('cal-live').textContent =
    `Midiendo… ${fmtClock(secs)} · fs = ${est.fsReal.toFixed(3)} Hz · ` +
    `${est.ppm >= 0 ? '+' : ''}${est.ppm.toFixed(2)} ± ${est.sigmaPpm.toFixed(2)} ppm ` +
    `(equivale a ${sd >= 0 ? '+' : ''}${sd.toFixed(2)} ± ${sdSigma.toFixed(2)} s/día) · base ${conf}` +
    (cal.gaps ? ` · ${cal.gaps} cortes de audio` : '');
}

function fmtClock(s) {
  const m = Math.floor(s / 60);
  return m ? `${m} min ${String(Math.round(s % 60)).padStart(2, '0')} s` : `${Math.round(s)} s`;
}

/* ------------------------------------------------------------- autoajuste */

const BAND_CANDIDATES = [
  [500, 3000], [800, 4000], [1000, 6000], [1500, 8000],
  [2000, 10000], [3000, 12000], [4000, 16000], [800, 15000], [6000, 18000],
];

function autotune() {
  if (!S.running || !P.raw) { setStatus('Arranca la captura antes de ajustar.', true); return; }
  const need = Math.round(2.5 * S.fs);
  const end = P.raw.end;
  const start = Math.max(P.raw.oldest(), end - need);
  const n = end - start;
  if (n < S.fs) { setStatus('Necesito un par de segundos de captura para ajustar.', true); return; }

  const src = new Float32Array(n);
  for (let i = 0; i < n; i++) src[i] = P.raw.at(start + i);
  const tmp = new Float32Array(n), env = new Float32Array(n);
  const nyq = S.fs / 2;

  let best = null;
  for (const [lo, hi] of BAND_CANDIDATES) {
    if (lo >= nyq * 0.9) continue;
    tmp.set(src);
    new Bandpass(S.fs, lo, Math.min(hi, nyq * 0.9)).processInPlace(tmp);
    new Envelope(S.fs, S.envTau).process(tmp, env);
    const score = peakToFloorDb(env);
    if (!best || score > best.score) best = { lo, hi: Math.min(hi, nyq * 0.9), score };
  }
  if (!best) return;

  $('band-lo').value = best.lo;
  $('band-hi').value = Math.round(best.hi);
  P.bandpass.setBand(best.lo, best.hi);
  P.envelope.reset();
  P.detector.floorInit = false;
  S.quality = [];
  setStatus(`Banda ajustada a ${best.lo}–${Math.round(best.hi)} Hz (${best.score.toFixed(0)} dB de contraste tic/ruido).`);
}

/** Contraste entre los picos y el fondo: p99 frente a p30, en dB. */
function peakToFloorDb(env) {
  const step = Math.max(1, Math.floor(env.length / 20000));
  const s = [];
  for (let i = 0; i < env.length; i += step) s.push(env[i]);
  s.sort((a, b) => a - b);
  const p = (q) => s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
  const hi = p(0.99), lo = p(0.30);
  if (!(hi > 0) || !(lo > 0)) return -Infinity;
  return 10 * Math.log10(hi / lo);
}

/* ------------------------------------------------------------------ mandos */

function setStatus(text, isErr = false) {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('err', isErr);
}

async function refreshDevices(preferId) {
  const devs = await listInputs();
  const sel = $('device');
  sel.innerHTML = '';
  if (!devs.length) {
    sel.innerHTML = '<option>Sin dispositivos de entrada</option>';
    return null;
  }
  const labelled = devs.some((d) => d.label);
  for (const d of devs) {
    const o = document.createElement('option');
    o.value = d.deviceId;
    o.textContent = d.label || `Entrada ${sel.children.length + 1}`;
    sel.appendChild(o);
  }
  const pick = (preferId && devs.find((d) => d.deviceId === preferId)) || guessProbe(devs);
  if (pick) sel.value = pick.deviceId;
  if (!labelled) setStatus('Pulsa Iniciar para conceder permiso y ver los nombres de los dispositivos.');
  return pick ? pick.deviceId : devs[0].deviceId;
}

async function start() {
  try {
    // Solo se pide permiso si hace falta: el diálogo consume la activación de
    // usuario del clic, y pedirlo cuando ya está concedido la gasta para nada.
    if (!(await hasPermission())) await requestPermission();
    await refreshDevices($('device').value);
    const deviceId = $('device').value;

    // Una medición en curso no sobrevive a reabrir la captura: el nuevo
    // AudioContext reinicia el contador de frames y la regresión quedaría
    // partida en dos tramos. Se descarta antes de tocar nada.
    const calWasRunning = cal.abort();

    const info = await capture.start(deviceId, 4096);

    S.deviceLabel = info.label || '';
    cal.load(deviceId, info.sampleRate, S.deviceLabel);
    cal.nominal = info.sampleRate;
    $('btn-cal').textContent = 'Iniciar medición';
    paintCalList();
    buildPipeline(info.sampleRate);
    P.detector.reset();

    S.running = true;
    S.lastGapCount = 0;
    S.blocks = 0;
    S.level = 0;
    S.peak = 0;
    S.tickTimes = [];
    S.lastBlockMs = performance.now();
    t0Wall = performance.now() / 1000;
    for (const c of charts) c.clear();
    rows.length = 0;

    $('toggle').textContent = 'Detener';
    $('toggle').classList.add('on');
    const rateNote = info.sampleRate === info.requestedRate
      ? `${info.sampleRate} Hz`
      : `${info.sampleRate} Hz (se pidieron ${info.requestedRate})`;
    if (calWasRunning) {
      setStatus('Se descartó la calibración en curso: al reabrir la entrada el contador '
        + 'de frames vuelve a cero y la medición ya no sería válida. Vuelve a lanzarla.', true);
    } else if (info.state !== 'running') {
      setStatus('El navegador ha dejado el audio SUSPENDIDO: el diálogo de permiso '
        + 'consumió el gesto del clic. Pulsa en cualquier parte de la página para arrancarlo.', true);
    } else {
      setStatus(`Capturando · ${info.label || 'entrada'} · ${rateNote} · procesado del navegador desactivado.`);
    }
  } catch (e) {
    setStatus(`No se pudo abrir la entrada: ${e.message}`, true);
  }
}

async function stop() {
  S.running = false;
  cal.stop();
  await capture.stop();
  $('toggle').textContent = 'Iniciar';
  $('toggle').classList.remove('on');
  $('btn-cal').textContent = 'Iniciar medición';
  setStatus('Detenido.');
}

function wire() {
  $('toggle').addEventListener('click', () => (S.running ? stop() : start()));
  $('device').addEventListener('change', () => { if (S.running) start(); });

  const bphSel = $('bph-manual');
  for (const b of STANDARD_BPH) {
    const o = document.createElement('option');
    o.value = String(b);
    o.textContent = b.toLocaleString('es-ES');
    if (b === 28800) o.selected = true;
    bphSel.appendChild(o);
  }
  bphSel.disabled = true;
  $('bph-auto').addEventListener('change', (e) => {
    S.bphAuto = e.target.checked;
    bphSel.disabled = S.bphAuto;
    if (!S.bphAuto) applyBph(Number(bphSel.value));
  });
  bphSel.addEventListener('change', () => { if (!S.bphAuto) applyBph(Number(bphSel.value)); });

  // Valores publicados habitualmente; conviene confirmarlos en la ficha del calibre.
  const LIFTS = [
    ['ETA 2824-2 / 2892', 50], ['ETA / Valjoux 7750', 50], ['ETA 6497 / 6498', 44],
    ['Sellita SW200', 50], ['Seiko NH35 / 7S26', 52], ['Miyota 8215', 51],
    ['Rolex 3135', 50], ['Genérico', 52],
  ];
  for (const [name, ang] of LIFTS) {
    const o = document.createElement('option');
    o.value = String(ang);
    o.textContent = `${name} — ${ang}°`;
    $('lift-preset').appendChild(o);
  }
  $('lift-preset').addEventListener('change', (e) => {
    if (!e.target.value) return;
    $('lift').value = e.target.value;
    if (P.amp) { P.amp.liftAngle = Number(e.target.value); P.amp.reset(); }
  });
  $('lift').addEventListener('change', (e) => {
    if (P.amp) { P.amp.liftAngle = Number(e.target.value) || 52; P.amp.reset(); }
    $('lift-preset').value = '';
  });

  $('fit-window').addEventListener('change', (e) => { S.fitWindow = Number(e.target.value); });
  $('tape-range').addEventListener('change', (e) => { tape.halfRange = Number(e.target.value); redraw(); });
  $('tape-span').addEventListener('change', (e) => { tape.windowSeconds = Number(e.target.value); redraw(); });
  $('chart-span').addEventListener('change', (e) => {
    for (const c of charts) c.windowSeconds = Number(e.target.value);
    redraw();
  });

  for (const id of ['band-lo', 'band-hi']) {
    $(id).addEventListener('change', () => {
      if (!P.bandpass) return;
      const lo = Number($('band-lo').value), hi = Number($('band-hi').value);
      if (lo > 0 && hi > lo) {
        P.bandpass.setBand(lo, hi);
        P.envelope.reset();
        P.detector.floorInit = false;
        S.quality = [];
      }
    });
  }
  $('btn-autotune').addEventListener('click', autotune);

  $('sens').addEventListener('input', (e) => {
    const k = Number(e.target.value);
    $('sens-note').textContent = `umbral = ${k}× el suelo de ruido`;
    if (P.detector) P.detector.k = k;
  });
  $('amp-thr').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    $('amp-thr-note').textContent =
      `${v}% del pico del tic. Bájalo si la amplitud no se resuelve; súbelo si la reverberación de la caja la falsea.`;
    if (P.amp) { P.amp.relThreshold = v / 100; P.amp.reset(); }
  });
  $('align').addEventListener('change', (e) => {
    if (P.aligner) { P.aligner.enabled = e.target.checked; P.aligner.reset(); }
  });

  $('btn-table').addEventListener('click', () => {
    const w = $('table-wrap');
    w.hidden = !w.hidden;
    $('btn-table').setAttribute('aria-expanded', String(!w.hidden));
    $('btn-table').textContent = w.hidden ? 'Ver datos' : 'Ocultar datos';
    if (!w.hidden) paintTable();
  });

  $('btn-cal').addEventListener('click', () => {
    if (cal.running) {
      cal.stop();
      $('btn-cal').textContent = 'Iniciar medición';
      $('cal-live').textContent = 'Medición detenida.';
    } else {
      startCalibration();
    }
  });
  $('btn-cal-apply').addEventListener('click', applyCalibration);

  $('cb-start').addEventListener('click', startCalibration);
  $('cb-apply').addEventListener('click', applyCalibration);
  $('cb-cancel').addEventListener('click', () => {
    cal.stop();
    $('btn-cal').textContent = 'Iniciar medición';
    $('cal-live').textContent = 'Medición detenida.';
  });
  $('cb-hide').addEventListener('click', () => {
    calDismissedFor = cal.deviceId;
    $('cal-banner').hidden = true;
  });
  $('cb-adopt').addEventListener('click', () => {
    const label = cal.candidate ? cal.candidate.rec.label : '';
    if (!cal.acceptCandidate()) return;
    paintCalList();
    P.tracker.reset();
    setStatus(`Calibración de «${label}» reasignada a este dispositivo: ` +
      `${cal.ppm >= 0 ? '+' : ''}${cal.ppm.toFixed(2)} ppm.`);
  });

  $('btn-cal-clear').addEventListener('click', paintCalList);
  $('btn-cal-clear').addEventListener('click', () => {
    cal.clear();
    $('cal-live').textContent = 'Corrección borrada: la marcha vuelve a depender del cristal sin corregir.';
  });

  window.addEventListener('resize', redraw);

  // Red de seguridad: si el contexto quedó suspendido, cualquier gesto
  // posterior lo arranca. Es el patrón estándar contra la política de
  // reproducción automática, y aquí resuelve el caso de la primera visita a un
  // origen nuevo, donde el diálogo de permiso se come la activación del clic.
  const wake = async () => {
    if (capture.state !== 'suspended') return;
    if ((await capture.resume()) === 'running') {
      setStatus('Audio arrancado. Capturando.');
    }
  };
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
    document.addEventListener(ev, wake, { passive: true });
  }
}

/* -------------------------------------------------------------- arranque */

async function init() {
  if (location.protocol === 'file:') {
    setStatus('Ábrelo por HTTP: los módulos ES y el micrófono no funcionan sobre file://. Ejecuta «python3 -m http.server 8000» en esta carpeta.', true);
    $('toggle').disabled = true;
    return;
  }
  if (!navigator.mediaDevices || !window.AudioWorkletNode) {
    setStatus('Este navegador no soporta getUserMedia + AudioWorklet.', true);
    $('toggle').disabled = true;
    return;
  }
  // Sin esto, cualquier excepción en el bucle de pintado o en una promesa
  // rechazada es invisible salvo que se abran las herramientas de desarrollo,
  // cosa poco práctica en un banco de trabajo o en el móvil.
  window.addEventListener('error', (e) => {
    setStatus(`Error: ${e.message} (${e.filename || ''}:${e.lineno || ''})`, true);
  });
  window.addEventListener('unhandledrejection', (e) => {
    setStatus(`Error sin capturar: ${e.reason && e.reason.message ? e.reason.message : e.reason}`, true);
  });

  wire();
  try {
    await refreshDevices();
  } catch {
    setStatus('Pulsa Iniciar para conceder permiso de micrófono.');
  }
  navigator.mediaDevices.addEventListener?.('devicechange', () => refreshDevices($('device').value));
  paintCalList();
  redraw();
  setInterval(update, 200);
}

init();
