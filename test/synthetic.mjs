/**
 * Verificación numérica de la cadena de medida con señal sintética.
 *
 * Genera un tren de tics con marcha, error de batida, amplitud y bph conocidos,
 * lo pasa por exactamente la misma cadena que la aplicación (mismos bloques de
 * 4096 muestras) y comprueba que se recuperan los valores de partida.
 *
 *   node test/synthetic.mjs
 */
import { Bandpass, Envelope } from '../js/dsp/filters.js';
import { EnvHistory, TickDetector, TickAligner } from '../js/dsp/ticks.js';
import { BphDetector } from '../js/dsp/bph.js';
import { RateTracker } from '../js/dsp/tracker.js';
import { AmplitudeMeter, dtFromAmplitude } from '../js/dsp/amplitude.js';

const FS = 48000;
const BLOCK = 4096;

/* ------------------------------------------------------------- generador */

function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Ruido del escape: dos senoides amortiguadas, colocadas con precisión sub-muestra. */
function addBurst(x, t, amp) {
  const start = Math.floor(t * FS);
  const len = Math.round(0.004 * FS);
  for (let k = 0; k <= len; k++) {
    const idx = start + k;
    if (idx < 0 || idx >= x.length) continue;
    const u = idx / FS - t;
    if (u < 0) continue;
    const e = Math.exp(-u / 0.00025);
    x[idx] += amp * e * (Math.sin(2 * Math.PI * 3100 * u) + 0.7 * Math.sin(2 * Math.PI * 6300 * u + 1.1));
  }
}

function synth(cfg) {
  const { seconds, bph, rate, beatErrorMs, amplitude, liftAngle, noise, tockGain = 1 } = cfg;
  const Tbeat = 3600 / bph;
  const Tfull = 7200 / bph;
  const b = Tbeat * (1 - rate / 86400);      // periodo real de batida
  const c = beatErrorMs / 2 / 1000;          // término alterno del modelo
  const dt = dtFromAmplitude(amplitude, Tfull, liftAngle);

  const n = Math.round(seconds * FS);
  const x = new Float32Array(n);
  const rnd = makeRng(12345);
  for (let i = 0; i < n; i++) {
    // Box-Muller barato: suma de uniformes, suficiente para un suelo de ruido.
    x[i] = noise * ((rnd() + rnd() + rnd() + rnd() + rnd() + rnd()) - 3);
  }

  const t0 = 0.05;
  let count = 0;
  for (let i = 0; ; i++) {
    const t = t0 + b * i + c * (i % 2 ? -1 : 1);
    if (t + dt + 0.02 > seconds) break;
    const g = i % 2 ? tockGain : 1;
    addBurst(x, t, 0.50 * g);                // desenclavamiento
    addBurst(x, t + 0.30 * dt, 1.00 * g);    // impulso
    addBurst(x, t + dt, 0.45 * g);           // caída
    count++;
  }
  return { x, truth: { b, c, dt, Tbeat, Tfull, count } };
}

/* --------------------------------------------------------------- cadena */

function run(x, cfg) {
  const bandpass = new Bandpass(FS, 1000, 8000);
  const envelope = new Envelope(FS, 0.00035);
  const hist = new EnvHistory(19);
  const detector = new TickDetector(FS, hist);
  const aligner = new TickAligner(FS);
  const tracker = new RateTracker();
  const amp = new AmplitudeMeter(FS);
  amp.liftAngle = cfg.liftAngle;

  const decFactor = Math.round(FS / 2000);
  const bphDet = new BphDetector(FS / decFactor, 6);
  let acc = 0, dn = 0;

  // El bph se descubre solo; la cadena arranca con el nominal por defecto.
  let bph = 28800;
  detector.setBeatPeriod(3600 / bph);
  tracker.setBeatPeriod(3600 / bph);

  const envOut = new Float32Array(BLOCK);
  const decBuf = new Float32Array(BLOCK);
  const bphSeen = [];
  let lastAnalyze = 0;

  for (let off = 0; off + BLOCK <= x.length; off += BLOCK) {
    const blk = x.slice(off, off + BLOCK);
    bandpass.processInPlace(blk);
    envelope.process(blk, envOut);
    hist.write(off, envOut);

    let k = 0;
    for (let i = 0; i < BLOCK; i++) {
      acc += envOut[i];
      if (++dn === decFactor) { decBuf[k++] = acc / decFactor; acc = 0; dn = 0; }
    }
    bphDet.push(decBuf.subarray(0, k));

    if (off - lastAnalyze >= FS) {
      lastAnalyze = off;
      const r = bphDet.analyze();
      bphSeen.push(r);
      if (r.locked && r.bph && r.bph !== bph) {
        bph = r.bph;
        detector.setBeatPeriod(3600 / bph);
        tracker.setBeatPeriod(3600 / bph);
        aligner.reset();
        amp.reset();
      }
    }

    const dtMax = dtFromAmplitude(amp.minAmp, 7200 / bph, amp.liftAngle);
    const margin = Math.round(((isFinite(dtMax) ? dtMax : 0.03) + 0.010) * FS);
    for (const tk of detector.detect(hist.end - margin)) {
      const tProv = tk.frame / FS;
      const i = tracker.assign(tProv);
      if (i === null) continue;
      const parity = i & 1;
      const refined = aligner.refine(hist, tk.intFrame, parity);
      const t = isFinite(refined) ? refined / FS : tProv;
      tracker.lastT = t;
      tracker.add(i, t);
      aligner.learn(hist, tk.intFrame, parity);
      amp.measure(hist, tk.intFrame, 7200 / bph);
    }
  }

  return { bph, fit: tracker.fit(30), amp: amp.value(), coverage: amp.coverage, bphSeen, tracker };
}

/* ------------------------------------------------------------- casos ---- */

let failures = 0;
function check(name, got, want, tol, unit = '') {
  const ok = isFinite(got) && Math.abs(got - want) <= tol;
  if (!ok) failures++;
  const g = got === null || !isFinite(got) ? 'null' : got.toFixed(3);
  console.log(`  ${ok ? 'ok  ' : 'FALLO'}  ${name.padEnd(22)} ${g.padStart(10)} ${unit}  (esperado ${want}±${tol})`);
}

const CASES = [
  {
    name: 'ETA moderno · 28800 bph',
    seconds: 40, bph: 28800, rate: 12, beatErrorMs: 0.4,
    amplitude: 280, liftAngle: 52, noise: 0.004,
  },
  {
    name: 'Seiko lento · 21600 bph, muy desviado',
    seconds: 40, bph: 21600, rate: -47, beatErrorMs: 1.2,
    amplitude: 240, liftAngle: 52, noise: 0.005,
  },
  {
    name: 'Unitas 6497 · 18000 bph, alzada 44°',
    seconds: 40, bph: 18000, rate: 5, beatErrorMs: 0.15,
    amplitude: 300, liftAngle: 44, noise: 0.004,
  },
  {
    name: 'Trampa de octava · tac 16× más flojo',
    seconds: 40, bph: 28800, rate: -8, beatErrorMs: 0.5,
    amplitude: 275, liftAngle: 52, noise: 0.003, tockGain: 0.25,
  },
  {
    name: 'Señal pobre · ruido alto',
    seconds: 40, bph: 28800, rate: 20, beatErrorMs: 0.6,
    amplitude: 270, liftAngle: 52, noise: 0.03,
  },
];

for (const cfg of CASES) {
  console.log(`\n${cfg.name}`);
  const { x, truth } = synth(cfg);
  const r = run(x, cfg);
  console.log(`  (dt real ${(truth.dt * 1000).toFixed(2)} ms · ${truth.count} tics generados` +
              `${r.fit ? ` · ${r.fit.n} usados · rms ${r.fit.rms.toFixed(3)} ms` : ''})`);
  check('bph', r.bph, cfg.bph, 0);
  if (r.fit) {
    check('marcha', r.fit.rate, cfg.rate, 2.0, 's/día');
    check('error de batida', r.fit.beatError, cfg.beatErrorMs, 0.08, 'ms');
  } else { console.log('  FALLO  sin ajuste'); failures++; }
  check('amplitud', r.amp, cfg.amplitude, 8, '°');
}

console.log(`\n${failures === 0 ? 'Todas las comprobaciones pasan.' : `${failures} comprobaciones fallan.`}`);
process.exit(failures ? 1 : 0);
