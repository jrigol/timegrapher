import { AudioCapture, listInputs, requestPermission, hasPermission, guessProbe } from './audio.js';
import { Bandpass, Envelope } from './dsp/filters.js';
import { EnvHistory, TickDetector, TickAligner } from './dsp/ticks.js';
import { BphDetector, STANDARD_BPH } from './dsp/bph.js';
import { RateTracker } from './dsp/tracker.js';
import { AmplitudeMeter, dtFromAmplitude } from './dsp/amplitude.js';
import { ClockCalibration } from './calibration.js';
import { POSITIONS, PositionSession, judgeDelta, judgeDrop, posName, posCode } from './positions.js';
import { t, nf, signed, int, locale, setLang, getLang, detectLang, applyStatic, LANGS } from './i18n.js';
import { PaperTape } from './ui/paper.js';
import { TimeSeries } from './ui/charts.js';
import { T } from './ui/theme.js';

const $ = (id) => document.getElementById(id);

// Antes que nada: lo que se construye a nivel de módulo -los gráficos- ya toma
// sus títulos del idioma activo, sin depender de que applyLanguage() los pise.
setLang(detectLang(), { persist: false });

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

const session = new PositionSession();

/**
 * Criterios de estabilidad.
 *
 * Al rotar el reloj la ventana deslizante del ajuste mezcla durante unos
 * segundos la posición vieja con la nueva, y ese es justo el momento en que uno
 * está mirando la pantalla esperando el número. Se exige, antes de dar la
 * lectura por buena: una ventana entera de datos posteriores a la colocación,
 * que la marcha no se mueva, y que la amplitud tampoco.
 */
const SETTLE_LOOKBACK = 5;      // s de historia que se examinan
const SETTLE_RATE_SPREAD = 2.0; // s/día de recorrido admitido
const SETTLE_AMP_SPREAD = 6;    // grados
const SETTLE_MIN_SAMPLES = 12;

/** Medida de posición en curso. */
const M = { key: null, startedAt: 0, recent: [], anchorsAt: 0 };

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
    setStatus(t('status.blockError', { msg: e.message }), true);
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
const chRate = new TimeSeries($('ch-rate'), { title: t('tile.rate'), unit: t('tile.rateUnit'), color: T.s1, decimals: 1, symmetric: true });
const chAmp = new TimeSeries($('ch-amp'), { title: t('tile.amplitude'), unit: '°', color: T.s3, decimals: 0, band: { lo: 270, hi: 315 } });
const chBeat = new TimeSeries($('ch-beat'), { title: t('tile.beat'), unit: 'ms', color: T.s2, decimals: 2 });
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
  try { updateInner(); } catch (e) { setStatus(t('status.paintError', { msg: e.message }), true); }
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

  measureStep(fit, amp, now);
  paintCalibration();
  paintCalBanner();
  paintDiag();
  redraw();
}

/** Arranca (o reinicia) la medida de una posición. */
function measureStart(key) {
  if (!S.running) { setStatus(t('pos.needCapture'), true); return; }
  M.key = key;
  M.startedAt = performance.now() / 1000;
  M.recent = [];
  M.anchorsAt = P.tracker.anchors;
  // Se descarta lo medido en la posición anterior: son datos de otro montaje.
  P.tracker.reset();
  P.amp.reset();
  paintPositions();
}

function measureCancel() {
  M.key = null;
  paintPositions();
}

/**
 * @returns {{ready:boolean, progress:number, why:string}}
 */
function settleState(fit, amp, now) {
  const elapsed = now - M.startedAt;
  const progress = Math.max(0, Math.min(1, elapsed / S.fitWindow));

  // Un reanclaje del contador de batidas es una discontinuidad dura: el reloj
  // se ha movido. Se reinicia el cronómetro de asentamiento.
  if (P.tracker.anchors !== M.anchorsAt) {
    M.anchorsAt = P.tracker.anchors;
    M.startedAt = now;
    M.recent = [];
    return { ready: false, progress: 0, why: t('pos.why.moved') };
  }
  if (!fit) return { ready: false, progress, why: t('pos.why.noSignal') };
  if (elapsed < S.fitWindow) return { ready: false, progress, why: t('pos.why.filling') };
  if (M.recent.length < SETTLE_MIN_SAMPLES) return { ready: false, progress, why: t('pos.why.samples') };

  const rates = M.recent.map((r) => r.rate).filter(isFinite);
  const spread = Math.max(...rates) - Math.min(...rates);
  if (spread > SETTLE_RATE_SPREAD) {
    return { ready: false, progress, why: t('pos.why.rate', { v: nf(spread, 1) }) };
  }
  const amps = M.recent.map((r) => r.amp).filter((v) => v != null && isFinite(v));
  if (amps.length >= SETTLE_MIN_SAMPLES / 2) {
    const aSpread = Math.max(...amps) - Math.min(...amps);
    if (aSpread > SETTLE_AMP_SPREAD) {
      return { ready: false, progress, why: t('pos.why.amp', { v: Math.round(aSpread) }) };
    }
  }
  return { ready: true, progress: 1, why: '' };
}

function measureStep(fit, amp, now) {
  if (!M.key) return;
  if (!S.running) { measureCancel(); return; }

  M.recent.push({ t: now, rate: fit ? fit.rate : NaN, amp });
  while (M.recent.length && M.recent[0].t < now - SETTLE_LOOKBACK) M.recent.shift();

  const st = settleState(fit, amp, now);
  if (st.ready && fit) {
    session.capture(M.key, {
      rate: fit.rate,
      amplitude: amp,
      beatError: fit.beatError,
      sigma: fit.rateSigma,
    });
    setStatus(t('pos.captured', {
      name: posName(M.key), rate: signed(fit.rate, 1),
      amp: amp != null ? ` · ${int(amp)}°` : '', beat: nf(fit.beatError, 2),
    }));
    M.key = null;
  }
  paintPositions(st);
}

/* --------------------------------------------------------- posiciones --- */

function paintPositions(st) {
  const grid = $('pos-grid');
  if (grid.childElementCount !== POSITIONS.length) {
    grid.innerHTML = '';
    POSITIONS.forEach((p, i) => {
      const b = document.createElement('button');
      b.className = 'pos-cell';
      b.dataset.key = p.key;
      b.title = t('pos.keyHint', { name: posName(p.key), n: i + 1 });
      b.addEventListener('click', () => {
        if (M.key === p.key) measureCancel();
        else measureStart(p.key);
      });
      grid.appendChild(b);
    });
  }

  const sum = session.summary();
  for (const el of grid.children) {
    const key = el.dataset.key;
    const p = POSITIONS.find((q) => q.key === key);
    const rec = session.get(key);
    const busy = M.key === key;
    el.className = 'pos-cell'
      + (busy ? ' busy' : rec ? ' filled' : '')
      + (!busy && rec && sum && sum.count > 1 && sum.max.key === key ? ' extreme-hi' : '')
      + (!busy && rec && sum && sum.count > 1 && sum.min.key === key ? ' extreme-lo' : '');

    const code = posCode(p.key), name = escapeHtml(posName(p.key));
    if (busy) {
      const pct = Math.round((st ? st.progress : 0) * 100);
      el.innerHTML =
        `<span class="pk">${code} · ${t('pos.measuring')}</span>` +
        `<span class="pn">${name}</span>` +
        `<span class="ps">${escapeHtml(st && st.ready === false ? st.why : t('pos.settling'))}</span>` +
        `<div class="pos-bar"><div style="width:${pct}%"></div></div>`;
    } else if (rec) {
      el.innerHTML =
        `<span class="pk">${code}</span>` +
        `<span class="pn">${name}</span>` +
        `<span class="pv">${signed(rec.rate, 1)}<small style="font-size:11px;font-weight:400"> ${t('tile.rateUnit')}</small></span>` +
        `<span class="ps">${rec.amplitude == null ? '—' : int(rec.amplitude) + '°'} · ${nf(rec.beatError, 2)} ms</span>`;
    } else {
      el.innerHTML =
        `<span class="pk">${code}</span>` +
        `<span class="pn">${name}</span>` +
        `<span class="ps">${t('pos.unmeasured')}</span>`;
    }
  }

  paintPosSummary(sum);
}

function paintPosSummary(sum) {
  const el = $('pos-summary');
  if (!sum) {
    el.innerHTML = `<div class="pos-empty">${t('pos.empty')}</div>`;
    return;
  }
  const dj = judgeDelta(sum.delta, sum.count);
  const rj = judgeDrop(sum.drop);
  const stat = (cls, k, v, n) =>
    `<div class="pos-stat ${cls}"><span class="k">${k}</span><span class="v">${v}</span><span class="n">${n}</span></div>`;

  let html = stat(dj.level, t('pos.delta'),
    sum.count > 1 ? `${nf(sum.delta, 1)} ${t('tile.rateUnit')}` : '—',
    sum.count > 1
      ? t('pos.deltaDetail', {
          max: `${sum.max.code} ${signed(sum.max.rate, 1)}`,
          min: `${sum.min.code} ${signed(sum.min.rate, 1)}`,
          verdict: dj.text,
        })
      : dj.text);

  if (sum.drop != null) {
    html += stat(rj.level, t('pos.drop'), `${Math.round(sum.drop)}°`,
      t('pos.dropDetail', { h: Math.round(sum.horiz), v: Math.round(sum.vert), verdict: rj.text }));
  } else {
    html += stat('', t('pos.drop'), '—', t('pos.dropNeed'));
  }

  html += stat('', t('pos.beatMax'), `${nf(sum.beatMax, 2)} ms`,
    t('pos.beatMaxDetail', { n: sum.count }));
  el.innerHTML = html;
}

function sessionMeta() {
  return {
    reference: $('pos-ref').value.trim(),
    bph: S.bph,
    liftAngle: P.amp ? P.amp.liftAngle : Number($('lift').value),
    calibration: cal.source === 'none'
      ? t('export.uncalibrated')
      : `${signed(cal.ppm, 2)} ppm (${t(cal.source === 'measured' ? 'cal.sourceMeasured' : 'cal.sourceStored')})`,
  };
}

const fmtSd = (ppm) => `±${nf(Math.abs(ppm * 0.0864), Math.abs(ppm * 0.0864) < 0.1 ? 3 : 2)} ${t('tile.rateUnit')}`;

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
      const quality = t(secs >= CAL_GOOD_SECONDS ? 'banner.readyAmple' : 'banner.readyUsable');
      show(t('banner.readyTitle'),
        t('banner.readyText', {
          clock: fmtClock(secs), ppm: signed(est.ppm, 2), sd: fmtSd(est.sigmaPpm), quality,
        }),
        'ready', { 'cb-adopt': false, 'cb-start': false, 'cb-apply': true, 'cb-cancel': true, 'cb-hide': false });
    } else {
      const left = Math.max(0, CAL_MIN_SECONDS - secs);
      show(t('banner.measuringTitle'),
        est
          ? t('banner.measuringLive', {
              clock: fmtClock(secs), ppm: signed(est.ppm, 2),
              sd: fmtSd(est.sigmaPpm), left: fmtClock(left),
            })
          : t('banner.measuringGathering', { clock: fmtClock(secs) }),
        'measuring', { 'cb-adopt': false, 'cb-start': false, 'cb-apply': false, 'cb-cancel': true, 'cb-hide': false });
    }
    return;
  }

  if (cal.candidate && !calDismissed()) {
    const c = cal.candidate.rec;
    const when = c.storedAt ? new Date(c.storedAt).toLocaleDateString(locale()) : '—';
    show(t('banner.candidateTitle'),
      t('banner.candidateText',
        { label: c.label, ppm: signed((c.factor - 1) * 1e6, 2), date: when }),
      '', { 'cb-adopt': true, 'cb-start': true, 'cb-apply': false, 'cb-cancel': false, 'cb-hide': true });
    $('cb-start').textContent = t('banner.calibrateAgain');
    return;
  }

  if (cal.source === 'none' && !calDismissed()) {
    show(t('banner.noneTitle'), t('banner.noneText'),
      '', { 'cb-adopt': false, 'cb-start': true, 'cb-apply': false, 'cb-cancel': false, 'cb-hide': true });
    $('cb-start').textContent = t('banner.calibrateNow');
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
    el.innerHTML = `<div class="cal-empty">${t('cal.storedEmpty')}</div>`;
    return;
  }
  for (const it of items) {
    const row = document.createElement('div');
    row.className = `cal-row${it.active ? ' active' : ''}`;
    const when = it.storedAt ? new Date(it.storedAt).toLocaleDateString(locale()) : '—';
    row.innerHTML =
      `<span class="name">${escapeHtml(it.label)}</span>` +
      `<span class="val">${signed(it.ppm, 2)} ppm</span>` +
      `<span class="when">${when}</span>` +
      (it.active ? `<span class="tag">${t('cal.inUse')}</span>` : '');
    const del = document.createElement('button');
    del.className = 'ghost';
    del.textContent = t('cal.deleteBtn');
    del.addEventListener('click', () => {
      // Son minutos de medición: no se tira sin preguntar.
      if (!confirm(t('cal.confirmRemove', { label: it.label, ppm: signed(it.ppm, 2) }))) return;
      cal.remove(it.deviceId);
      paintCalList();
      setStatus(t('cal.removed', { label: it.label }));
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
  if (!S.running) { setStatus(t('cal.needCapture'), true); return; }
  cal.start(S.fs, $('device').value, S.deviceLabel);
  $('btn-cal').textContent = t('cal.stopBtn');
  $('cal-details').open = true;
}

function applyCalibration() {
  const est = cal.commit();
  if (!est) return;
  cal.stop();
  $('btn-cal').textContent = t('cal.startBtn');
  $('btn-cal-apply').disabled = true;
  $('cal-live').textContent = t('cal.appliedPanel', {
    ppm: signed(est.ppm, 2), sigma: nf(est.sigmaPpm, 2),
    clock: fmtClock(est.seconds), sd: fmtSd(est.sigmaPpm),
  });
  setStatus(t('cal.appliedStatus',
    { ppm: signed(est.ppm, 2), sd: signed(cal.errorSecondsPerDay, 2) }));
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
    el.textContent = t('diag.suspended', { state: st });
    return;
  }

  const since = performance.now() - S.lastBlockMs;
  if (!S.blocks) {
    el.className = 'diag err';
    el.textContent = t('diag.noBlocks');
    return;
  }
  if (since > 1500) {
    el.className = 'diag err';
    el.textContent = t('diag.interrupted', { s: nf(since / 1000, 1), n: S.blocks });
    return;
  }

  const tps = S.tickTimes.length / 3;
  const parts = [
    t('diag.blocks', { n: S.blocks }),
    t('diag.level', { rms: dbfs(S.level), peak: dbfs(S.peak) }),
    t('diag.ticks', { v: nf(tps, 1) }),
    `${S.fs} Hz`,
    st,
  ];
  if (S.level < 3e-5) {
    el.className = 'diag err';
    parts.push(t('diag.silent'));
  } else if (tps < 0.5) {
    el.className = 'diag warn';
    parts.push(t('diag.noTicks'));
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
    setChip($('c-rate'), '', t('chip.noSignal'));
    $('n-rate').textContent = '';
    return;
  }
  const r = fit.rate;
  $('v-rate').textContent = signed(r, 1);
  const a = Math.abs(r);
  setChip($('c-rate'),
    a <= 10 ? 'good' : a <= 30 ? 'warning' : a <= 90 ? 'serious' : 'critical',
    t(a <= 10 ? 'chip.rate.good' : a <= 30 ? 'chip.rate.warning'
      : a <= 90 ? 'chip.rate.serious' : 'chip.rate.critical'));
  const parts = [t('note.fitSigma', { v: nf(fit.rateSigma, 1) })];
  if (cal.source === 'none') parts.push(t('note.uncalibrated'));
  else parts.push(t('note.corrected', { v: signed(cal.ppm, 1) }));
  $('n-rate').textContent = parts.join(' · ');
}

function paintAmp(amp) {
  const cov = P.amp ? P.amp.coverage : 0;
  if (amp === null) {
    $('v-amp').textContent = '—';
    setChip($('c-amp'), '', t(cov > 0 ? 'chip.amp.unresolved' : 'chip.noSignal'));
    $('n-amp').textContent = P.amp && P.amp.lastDetail
      ? t('note.dtOutOfRange', { v: nf(P.amp.lastDetail.dt * 1000, 1) }) : '';
    return;
  }
  $('v-amp').textContent = int(amp);
  const level = amp >= 270 && amp <= 320 ? 'good'
    : amp >= 240 && amp <= 330 ? 'warning'
    : amp >= 200 ? 'serious' : 'critical';
  setChip($('c-amp'), level, t(`chip.amp.${level}`));
  $('n-amp').textContent = t('note.liftCoverage',
    { lift: P.amp.liftAngle, pct: Math.round(cov * 100) });
}

function paintBeat(fit) {
  if (!fit) {
    $('v-beat').textContent = '—';
    setChip($('c-beat'), '', t('chip.noSignal'));
    $('n-beat').textContent = '';
    return;
  }
  const be = fit.beatError;
  $('v-beat').textContent = nf(be, 2);
  setChip($('c-beat'),
    be <= 0.3 ? 'good' : be <= 0.6 ? 'warning' : be <= 1.0 ? 'serious' : 'critical',
    t(be <= 0.3 ? 'chip.beat.good' : be <= 0.6 ? 'chip.beat.warning'
      : be <= 1.0 ? 'chip.beat.serious' : 'chip.beat.critical'));
  $('n-beat').textContent = t('note.beatsIn', { n: fit.n, s: Math.round(fit.span) });
}

function paintBph(r) {
  $('v-bph').textContent = int(S.bph);
  if (!S.bphAuto) {
    setChip($('c-bph'), 'good', t('chip.bph.manual'));
    $('n-bph').textContent = r && r.bphRaw ? t('note.bphMeasured', { v: int(r.bphRaw) }) : '';
    return;
  }
  if (S.bphLocked) {
    setChip($('c-bph'), 'good', t('chip.bph.detected'));
    $('n-bph').textContent = t('note.bphRaw',
      { v: int(S.bphRaw), c: Math.round(r.confidence * 100) });
  } else {
    setChip($('c-bph'), 'warning', t('chip.searching'));
    $('n-bph').textContent = r && r.bphRaw
      ? t('note.bphNoFit', { v: int(r.bphRaw) })
      : t('note.bphNone');
  }
}

function paintQuality(fit) {
  const q = S.quality.length >= 8 ? median(S.quality) : NaN;
  const bar = $('quality-bar');
  if (!isFinite(q)) {
    bar.style.width = '0%';
    $('quality-note').textContent = t('quality.none');
    return;
  }
  const pct = Math.max(0, Math.min(100, (q / 40) * 100));
  bar.style.width = `${pct}%`;
  bar.style.background = q >= 20 ? T.good : q >= 12 ? T.warning : T.critical;

  let cov = NaN;
  if (fit && fit.span > 0) cov = fit.n / (fit.span / (3600 / S.bph) + 1);
  const cov2 = isFinite(cov) ? t('quality.coverage', { pct: Math.round(Math.min(1, cov) * 100) }) : '';
  const args = { db: Math.round(q), cov: cov2 };
  $('quality-note').textContent =
    t(q >= 20 ? 'quality.good' : q >= 12 ? 'quality.fair' : 'quality.poor', args);
}

function paintTable() {
  const tb = $('table').querySelector('tbody');
  tb.innerHTML = '';
  for (const r of rows.slice(-120).reverse()) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.clock.toLocaleTimeString(locale())}</td>` +
      `<td>${signed(r.rate, 1)}</td>` +
      `<td>${r.amp === null ? '—' : int(r.amp)}</td>` +
      `<td>${nf(r.beat, 2)}</td>`;
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
    ? t('cal.none') : `${signed(cal.ppm, 2)} ppm`;
  $('cal-source').textContent = cal.source === 'measured' ? t('cal.sourceMeasured')
    : cal.source === 'stored'
      ? (cal.storedAt
          ? t('cal.sourceStoredOn', { date: new Date(cal.storedAt).toLocaleDateString(locale()) })
          : t('cal.sourceStored'))
      : t('cal.sourceNone');
  $('cal-bias').textContent = cal.source === 'none'
    ? '—' : `${signed(cal.errorSecondsPerDay, 2)} ${t('tile.rateUnit')}`;

  if (!cal.running) return;
  const est = cal.estimate();
  const secs = cal.elapsedSeconds;
  if (!est) {
    $('cal-live').textContent = t('cal.gathering', { s: Math.round(secs), n: cal.n });
    $('btn-cal-apply').disabled = true;
    return;
  }
  const sd = est.ppm * 86400 / 1e6;
  const sdSigma = est.sigmaPpm * 86400 / 1e6;
  const ready = secs >= CAL_MIN_SECONDS;
  $('btn-cal-apply').disabled = !ready;
  const conf = t(secs >= CAL_GOOD_SECONDS ? 'cal.confAmple'
    : secs >= CAL_MIN_SECONDS ? 'cal.confUsable' : 'cal.confShort');
  $('cal-live').textContent = t('cal.live', {
    clock: fmtClock(secs), fs: nf(est.fsReal, 3), ppm: signed(est.ppm, 2),
    sigma: nf(est.sigmaPpm, 2), sd: signed(sd, 2), sdSigma: nf(sdSigma, 2), conf,
  }) + (cal.gaps ? t('cal.gaps', { n: cal.gaps }) : '');
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
  if (!S.running || !P.raw) { setStatus(t('status.needCapture'), true); return; }
  const need = Math.round(2.5 * S.fs);
  const end = P.raw.end;
  const start = Math.max(P.raw.oldest(), end - need);
  const n = end - start;
  if (n < S.fs) { setStatus(t('status.tuneNeedAudio'), true); return; }

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
  setStatus(t('status.tuned', { lo: best.lo, hi: Math.round(best.hi), db: Math.round(best.score) }));
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
    sel.innerHTML = `<option>${t('status.noDevices')}</option>`;
    return null;
  }
  const labelled = devs.some((d) => d.label);
  for (const d of devs) {
    const o = document.createElement('option');
    o.value = d.deviceId;
    o.textContent = d.label || t('status.inputN', { n: sel.children.length + 1 });
    sel.appendChild(o);
  }
  const pick = (preferId && devs.find((d) => d.deviceId === preferId)) || guessProbe(devs);
  if (pick) sel.value = pick.deviceId;
  if (!labelled) setStatus(t('status.grantHint'));
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
    $('btn-cal').textContent = t('cal.startBtn');
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

    $('toggle').textContent = t('app.stop');
    $('toggle').classList.add('on');
    const rateNote = info.sampleRate === info.requestedRate
      ? `${info.sampleRate} Hz`
      : t('status.rateRequested', { fs: info.sampleRate, want: info.requestedRate });
    if (calWasRunning) {
      setStatus(t('status.calAborted'), true);
    } else if (info.state !== 'running') {
      setStatus(t('status.suspended'), true);
    } else {
      setStatus(t('status.capturing', { label: info.label || '—', rate: rateNote }));
    }
  } catch (e) {
    setStatus(t('status.openFailed', { msg: e.message }), true);
  }
}

async function stop() {
  S.running = false;
  cal.stop();
  await capture.stop();
  $('toggle').textContent = t('app.start');
  $('toggle').classList.remove('on');
  $('btn-cal').textContent = t('cal.startBtn');
  setStatus(t('status.stopped'));
}

/**
 * Vuelve a pintar todo lo que se genera desde JS. El marcado estático lo cubre
 * applyStatic(); esto es el resto: títulos de gráficos, notas con parámetros,
 * rejilla de posiciones y estado de la calibración.
 */
function applyLanguage() {
  applyStatic();
  document.title = t('app.title');
  $('toggle').textContent = t(S.running ? 'app.stop' : 'app.start');
  $('btn-cal').textContent = t(cal.running ? 'cal.stopBtn' : 'cal.startBtn');
  $('btn-table').textContent = t($('table-wrap').hidden ? 'chart.showData' : 'chart.hideData');
  $('sens-note').textContent = t('set.sensNote', { k: Number($('sens').value) });
  $('amp-thr-note').textContent = t('set.ampThrNote', { v: Number($('amp-thr').value) });

  chRate.title = t('tile.rate'); chRate.unit = t('tile.rateUnit');
  chAmp.title = t('tile.amplitude'); chAmp.unit = '°';
  chBeat.title = t('tile.beat'); chBeat.unit = 'ms';

  buildLiftPresets();
  // La rejilla se reconstruye para que los títulos de tecla se retraduzcan.
  $('pos-grid').innerHTML = '';
  paintPositions();
  paintCalList();
  if (!S.running) paintCalibration();
  if (rows.length && !$('table-wrap').hidden) paintTable();
  redraw();
}

/** Valores publicados habitualmente; conviene confirmarlos en la ficha del calibre. */
const LIFTS = [
  ['ETA 2824-2 / 2892', 50], ['ETA / Valjoux 7750', 50], ['ETA 6497 / 6498', 44],
  ['Sellita SW200', 50], ['Seiko NH35 / 7S26', 52], ['Miyota 8215', 51],
  ['Rolex 3135', 50], [null, 52],
];

function buildLiftPresets() {
  const sel = $('lift-preset');
  const keep = sel.value;
  sel.innerHTML = `<option value="">${t('set.caliber')}</option>`;
  for (const [name, ang] of LIFTS) {
    const o = document.createElement('option');
    o.value = String(ang);
    o.textContent = `${name || t('set.generic')} — ${ang}°`;
    sel.appendChild(o);
  }
  sel.value = keep;
}

function wire() {
  const langSel = $('lang');
  for (const [code, name] of Object.entries(LANGS)) {
    const o = document.createElement('option');
    o.value = code; o.textContent = name;
    langSel.appendChild(o);
  }
  langSel.value = getLang();
  langSel.addEventListener('change', (e) => {
    setLang(e.target.value);
    applyLanguage();
  });

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
  buildLiftPresets();
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
    $('sens-note').textContent = t('set.sensNote', { k });
    if (P.detector) P.detector.k = k;
  });
  $('amp-thr').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    $('amp-thr-note').textContent = t('set.ampThrNote', { v });
    if (P.amp) { P.amp.relThreshold = v / 100; P.amp.reset(); }
  });
  $('align').addEventListener('change', (e) => {
    if (P.aligner) { P.aligner.enabled = e.target.checked; P.aligner.reset(); }
  });

  $('btn-table').addEventListener('click', () => {
    const w = $('table-wrap');
    w.hidden = !w.hidden;
    $('btn-table').setAttribute('aria-expanded', String(!w.hidden));
    $('btn-table').textContent = t(w.hidden ? 'chart.showData' : 'chart.hideData');
    if (!w.hidden) paintTable();
  });

  $('btn-cal').addEventListener('click', () => {
    if (cal.running) {
      cal.stop();
      $('btn-cal').textContent = t('cal.startBtn');
      $('cal-live').textContent = t('cal.stopped');
    } else {
      startCalibration();
    }
  });
  $('btn-cal-apply').addEventListener('click', applyCalibration);

  $('cb-start').addEventListener('click', startCalibration);
  $('cb-apply').addEventListener('click', applyCalibration);
  $('cb-cancel').addEventListener('click', () => {
    cal.stop();
    $('btn-cal').textContent = t('cal.startBtn');
    $('cal-live').textContent = t('cal.stopped');
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
    setStatus(t('cal.adopted', { label, ppm: signed(cal.ppm, 2) }));
  });

  $('btn-cal-clear').addEventListener('click', paintCalList);
  $('btn-cal-clear').addEventListener('click', () => {
    cal.clear();
    $('cal-live').textContent = t('cal.cleared');
  });

  $('pos-clear').addEventListener('click', () => {
    if (session.isEmpty) return;
    if (!confirm(t('pos.confirmClear', { n: session.count }))) return;
    session.reset();
    measureCancel();
  });
  $('pos-copy').addEventListener('click', async () => {
    if (session.isEmpty) { setStatus(t('pos.nothingToCopy'), true); return; }
    try {
      await navigator.clipboard.writeText(session.toText(sessionMeta()));
      setStatus(t('pos.copied'));
    } catch {
      setStatus(t('pos.copyFailed'), true);
    }
  });
  $('pos-csv').addEventListener('click', () => {
    if (session.isEmpty) { setStatus(t('pos.nothingToExport'), true); return; }
    const meta = sessionMeta();
    const name = (meta.reference || 'timegrapher').replace(/[^\w\-]+/g, '_');
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    // BOM para que Excel en español no destroce los acentos.
    const blob = new Blob(['\ufeff' + session.toCsv(meta)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name}-${stamp}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  // Manos ocupadas: 1-6 eligen posición, Esc cancela la medida en curso.
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape' && M.key) { measureCancel(); return; }
    const n = Number(e.key);
    if (n >= 1 && n <= POSITIONS.length) {
      e.preventDefault();
      const key = POSITIONS[n - 1].key;
      if (M.key === key) measureCancel(); else measureStart(key);
    }
  });

  window.addEventListener('resize', redraw);

  // Red de seguridad: si el contexto quedó suspendido, cualquier gesto
  // posterior lo arranca. Es el patrón estándar contra la política de
  // reproducción automática, y aquí resuelve el caso de la primera visita a un
  // origen nuevo, donde el diálogo de permiso se come la activación del clic.
  const wake = async () => {
    if (capture.state !== 'suspended') return;
    if ((await capture.resume()) === 'running') {
      setStatus(t('status.audioStarted'));
    }
  };
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
    document.addEventListener(ev, wake, { passive: true });
  }
}

/* -------------------------------------------------------------- arranque */

async function init() {
  applyStatic();

  if (location.protocol === 'file:') {
    setStatus(t('status.fileProtocol'), true);
    $('toggle').disabled = true;
    return;
  }
  if (!navigator.mediaDevices || !window.AudioWorkletNode) {
    setStatus(t('status.unsupported'), true);
    $('toggle').disabled = true;
    return;
  }
  // Sin esto, cualquier excepción en el bucle de pintado o en una promesa
  // rechazada es invisible salvo que se abran las herramientas de desarrollo,
  // cosa poco práctica en un banco de trabajo o en el móvil.
  window.addEventListener('error', (e) => {
    setStatus(t('status.error', { msg: `${e.message} (${e.filename || ''}:${e.lineno || ''})` }), true);
  });
  window.addEventListener('unhandledrejection', (e) => {
    setStatus(t('status.unhandled', { msg: e.reason && e.reason.message ? e.reason.message : e.reason }), true);
  });

  wire();
  try {
    await refreshDevices();
  } catch {
    setStatus(t('app.permissionHint'));
  }
  navigator.mediaDevices.addEventListener?.('devicechange', () => refreshDevices($('device').value));
  applyLanguage();
  setInterval(update, 200);
}

init();
