import { parabolic } from './ticks.js';

/**
 * Amplitud del volante a partir del intervalo entre el ruido de desenclavamiento
 * y el de caída.
 *
 * El volante oscila casi sinusoidalmente, theta(t) = A*sin(2*pi*t/T). Los dos
 * ruidos ocurren en los bordes del ángulo de alzada L, es decir en theta = -L/2
 * y theta = +L/2, simétricos respecto al paso por cero. De ahí:
 *
 *     sin(pi * dt / T) = L / (2A)     =>     A = L / (2 * sin(pi * dt / T))
 *
 * con T el periodo de oscilación COMPLETA (dos batidas) y dt el intervalo entre
 * el primer y el tercer ruido. Para 28800 bph y alzada 52 grados, una amplitud
 * de 280 grados da dt ~ 7,4 ms.
 *
 * El ángulo de alzada no es medible desde el audio: es un dato del calibre.
 */
export function amplitudeFromDt(dt, fullPeriod, liftAngle) {
  const s = Math.sin(Math.PI * dt / fullPeriod);
  if (s <= 1e-9) return NaN;
  return liftAngle / (2 * s);
}

/** Intervalo dt que corresponde a una amplitud dada (la inversa de la anterior). */
export function dtFromAmplitude(amp, fullPeriod, liftAngle) {
  const r = liftAngle / (2 * amp);
  if (r >= 1) return NaN;
  return (fullPeriod / Math.PI) * Math.asin(r);
}

export class AmplitudeMeter {
  constructor(fs) {
    this.fs = fs;
    this.liftAngle = 52;
    this.minAmp = 100;
    this.maxAmp = 340;
    this.relThreshold = 0.08;
    this.history = [];
    this.historyLen = 24;
    this.attempts = [];   // resuelto / no resuelto, para la cobertura
    this.lastDetail = null;
  }

  reset() { this.history = []; this.attempts = []; this.lastDetail = null; }

  _record(ok) {
    this.attempts.push(ok ? 1 : 0);
    if (this.attempts.length > 32) this.attempts.shift();
  }

  /**
   * Mide un tic. `fullPeriod` en segundos (2 batidas).
   * @returns {number|null} amplitud en grados, mediana de los últimos tics.
   */
  measure(hist, intFrame, fullPeriod) {
    const fs = this.fs;
    const dtMin = dtFromAmplitude(this.maxAmp, fullPeriod, this.liftAngle);
    const dtMax = dtFromAmplitude(this.minAmp, fullPeriod, this.liftAngle);
    if (!isFinite(dtMin) || !isFinite(dtMax)) return this.value();

    // Ventana SIMÉTRICA: el pico que dispara la detección es normalmente el
    // ruido de impulso, que va en medio de los tres. Una ventana que solo mire
    // hacia delante se deja fuera el desenclavamiento y sobreestima la
    // amplitud. El ancho, +/-(dtMax + 2 ms), nunca alcanza a la batida vecina.
    const half = Math.round((dtMax + 0.002) * fs);
    const from = intFrame - half;
    const to = intFrame + half;
    if (from < hist.oldest() || to >= hist.end) return this.value();

    let peak = 0;
    for (let f = from; f <= to; f++) {
      const v = hist.at(f);
      if (v > peak) peak = v;
    }
    if (peak <= 0) return this.value();
    const thr = peak * this.relThreshold;

    // Máximos locales con prominencia: la reverberación de la caja del reloj
    // genera ondulaciones por encima del umbral que no son ruidos del escape.
    const minSep = Math.max(2, Math.round(0.0004 * fs));
    const peaks = [];
    let lastMin = Infinity;
    for (let f = from + 1; f < to; f++) {
      const v = hist.at(f);
      if (v < lastMin) lastMin = v;
      if (v >= thr && v > hist.at(f - 1) && v >= hist.at(f + 1)) {
        if (v - lastMin >= thr) {
          const pos = f + parabolic(hist.at(f - 1), v, hist.at(f + 1));
          if (peaks.length === 0 || pos - peaks[peaks.length - 1] >= minSep) {
            peaks.push(pos);
          } else if (v > hist.at(Math.round(peaks[peaks.length - 1]))) {
            peaks[peaks.length - 1] = pos;
          }
          lastMin = Infinity;
        }
      }
    }

    let ok = false;
    if (peaks.length >= 2) {
      const dt = (peaks[peaks.length - 1] - peaks[0]) / fs;
      const amp = dt >= dtMin && dt <= dtMax
        ? amplitudeFromDt(dt, fullPeriod, this.liftAngle) : NaN;
      if (isFinite(amp)) {
        ok = true;
        this.history.push(amp);
        if (this.history.length > this.historyLen) this.history.shift();
        this.lastDetail = { dt, peaks: peaks.length, amp };
      } else {
        this.lastDetail = { dt, peaks: peaks.length, amp: null };
      }
    }
    this._record(ok);
    return this.value();
  }

  /** Mediana: un solo tic mal resuelto no debe mover la lectura. */
  value() {
    if (this.history.length < 5) return null;
    // Si hace rato que no se resuelve ningún tic (reloj retirado, sonda suelta),
    // la mediana anterior es historia: mejor no dar número que dar uno viejo.
    if (this.attempts.length >= 16 && this.coverage < 0.15) return null;
    const s = [...this.history].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /** Fracción de tics recientes en los que se han resuelto los ruidos del escape. */
  get coverage() {
    if (this.attempts.length < 8) return 0;
    return this.attempts.reduce((a, b) => a + b, 0) / this.attempts.length;
  }
}
