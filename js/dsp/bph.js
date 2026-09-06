import { autocorr } from './fft.js';

/** Alternancias/hora estándar. 72000 es rarísimo pero cabe en el rango de busca. */
export const STANDARD_BPH = [
  12000, 14400, 18000, 19800, 21600, 25200, 28800, 36000, 43200, 72000,
];

/** Los dos valores más próximos de la tabla distan un 10%; ±2% no es ambiguo. */
const SNAP_TOLERANCE = 0.02;

const MIN_BEAT_S = 0.045; //  80000 bph
const MAX_BEAT_S = 0.320; //  11250 bph
const MAX_LAG_S = 2 * MAX_BEAT_S + 0.04; // hace falta el 2º armónico de la batida más lenta

/**
 * Detección de bph por autocorrelación de la envolvente.
 *
 * Va deliberadamente en paralelo al detector de picos y no depende de él: un
 * umbral mal puesto hace perder un tic de cada dos y eso, sobre los intervalos,
 * da un error de octava silencioso (28800 leído como 14400). La autocorrelación
 * no usa umbral, así que no tiene ese modo de fallo.
 *
 * La señal es periódica en T_completo = 2*T_batida y la ACF tiene picos en todos
 * los múltiplos de T_batida. Elegir entre ellos tiene dos trampas opuestas:
 *
 *   - Quedarse con el pico más ALTO da T_completo (o un múltiplo), es decir la
 *     mitad del bph real. Pasa siempre que el tac suena distinto del tic.
 *   - Quedarse con el pico más PEQUEÑO puede enganchar el hueco entre dos
 *     ruidos del escape dentro de un mismo tic, que a amplitudes bajas y bph
 *     lentos cae dentro del rango de busca.
 *
 * La discriminación es el 2º armónico: un periodo verdadero tiene un pico fuerte
 * también en 2L, y un artefacto intra-tic no. Se puntúa cada candidato con
 * acf[L] + acf[2L], se descartan los que no llegan, y entre los que sobreviven
 * se coge el retardo MENOR: ese es la batida.
 */
export class BphDetector {
  constructor(envRate, windowSeconds = 6) {
    this.rate = envRate;
    this.size = Math.ceil(envRate * windowSeconds);
    this.buf = new Float32Array(this.size);
    this.written = 0;
    this.history = [];
  }

  reset() {
    this.written = 0;
    this.buf.fill(0);
    this.history = [];
  }

  push(samples) {
    for (let i = 0; i < samples.length; i++) {
      this.buf[this.written % this.size] = samples[i];
      this.written++;
    }
  }

  get seconds() { return Math.min(this.written, this.size) / this.rate; }

  /** @returns {{bph:number|null, bphRaw:number, confidence:number, locked:boolean}} */
  analyze() {
    const n = Math.min(this.written, this.size);
    const none = { bph: null, bphRaw: 0, confidence: 0, locked: false };
    if (n < this.rate * 3) return none;

    // Linealiza el anillo en orden cronológico.
    const x = new Float32Array(n);
    const start = this.written - n;
    for (let i = 0; i < n; i++) x[i] = this.buf[(start + i) % this.size];

    const maxLag = Math.min(Math.ceil(MAX_LAG_S * this.rate), Math.floor(n * 0.6));
    const hiLag = Math.min(Math.ceil(MAX_BEAT_S * this.rate), Math.floor(maxLag / 2));
    const loLag = Math.floor(MIN_BEAT_S * this.rate);
    if (hiLag <= loLag + 4) return none;

    const acf = autocorr(x, maxLag);

    // Máximos locales con algo de vecindad, para no coger la ondulación fina.
    const cands = [];
    for (let k = loLag + 2; k <= hiLag - 2; k++) {
      const v = acf[k];
      if (v < 0.05) continue;
      if (v >= acf[k - 1] && v >= acf[k + 1] && v > acf[k - 2] && v > acf[k + 2]) {
        const prev = cands[cands.length - 1];
        if (prev !== undefined && k - prev <= 3) {
          if (v > acf[prev]) cands[cands.length - 1] = k;
        } else {
          cands.push(k);
        }
      }
    }
    if (!cands.length) return none;

    // El armónico se busca en un ENTORNO de 2L, no en el índice exacto: el pico
    // de la batida se desdobla por el error de batida (los intervalos alternan
    // b+2c y b-2c), así que 2L cae uno o dos samples fuera del pico del periodo
    // completo, que es estrecho. Buscarlo exacto lo daba por inexistente y la
    // detección se iba a la mitad del bph.
    const win = (k) => Math.max(2, Math.min(8, Math.round(0.012 * k)));
    const harmonic = (k) => {
      const h = 2 * k;
      if (h + 1 > maxLag) return 0;
      const w = win(k);
      let m = 0;
      for (let j = Math.max(1, h - w); j <= Math.min(maxLag, h + w); j++) {
        if (acf[j] > m) m = acf[j];
      }
      return Math.max(0, m);
    };
    const score = (k) => acf[k] + harmonic(k);

    let best = -Infinity;
    for (const k of cands) best = Math.max(best, score(k));
    if (best < 0.35) return none; // nada suficientemente periódico

    let lag = -1;
    for (const k of cands) {
      if (score(k) >= 0.45 * best) { lag = k; break; } // cands ya va en orden creciente
    }
    if (lag < 1 || lag + 1 > maxLag) return none;

    // El periodo se afina sobre el 2º armónico cuando existe: ese pico NO se
    // desdobla con el error de batida, así que localiza la batida mejor que el
    // pico de primer orden.
    let beatSamples = lag + refine(acf, lag);
    const h2 = peakNear(acf, 2 * lag, win(lag), maxLag);
    if (h2 > 0) beatSamples = h2 / 2;
    const beat = beatSamples / this.rate;

    const bphRaw = 3600 / beat;
    let snapped = null, closest = Infinity;
    for (const cand of STANDARD_BPH) {
      const rel = Math.abs(bphRaw - cand) / cand;
      if (rel < closest && rel <= SNAP_TOLERANCE) { closest = rel; snapped = cand; }
    }

    const confidence = Math.max(0, Math.min(1, score(lag) / 2));
    this.history.push(snapped);
    if (this.history.length > 4) this.history.shift();
    const locked =
      snapped !== null &&
      this.history.length >= 3 &&
      this.history.slice(-3).every((v) => v === snapped);

    return { bph: snapped, bphRaw, confidence, locked };
  }
}

/** Desplazamiento sub-muestra del pico en `k` por interpolación parabólica. */
function refine(acf, k) {
  const d = acf[k - 1] - 2 * acf[k] + acf[k + 1];
  if (d === 0) return 0;
  return Math.max(-1, Math.min(1, 0.5 * (acf[k - 1] - acf[k + 1]) / d));
}

/** Posición refinada del máximo en [c-w, c+w], o 0 si ahí no hay pico. */
function peakNear(acf, c, w, maxLag) {
  let bi = -1, bv = -Infinity;
  for (let j = Math.max(2, c - w); j <= Math.min(maxLag - 2, c + w); j++) {
    if (acf[j] > bv) { bv = acf[j]; bi = j; }
  }
  if (bi < 2 || bv < 0.2) return 0;
  if (!(acf[bi] >= acf[bi - 1] && acf[bi] >= acf[bi + 1])) return 0;
  return bi + refine(acf, bi);
}
