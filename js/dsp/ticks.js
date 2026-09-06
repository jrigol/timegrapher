/**
 * Historial circular de la envolvente, indexado por frame ABSOLUTO.
 *
 * Trabajar con el índice absoluto en vez de con offsets de bloque evita toda
 * una clase de errores al cruzar fronteras de bloque: las ventanas de amplitud
 * y las plantillas de alineación miran hacia atrás sin preocuparse de dónde
 * empezó el bloque actual.
 */
export class EnvHistory {
  constructor(sizeLog2 = 19) {
    this.size = 1 << sizeLog2;      // 2^19 / 48 kHz ~ 10,9 s
    this.mask = this.size - 1;
    this.buf = new Float32Array(this.size);
    this.end = 0;
  }
  reset() { this.buf.fill(0); this.end = 0; }
  write(startFrame, samples) {
    for (let i = 0; i < samples.length; i++) {
      this.buf[(startFrame + i) & this.mask] = samples[i];
    }
    this.end = startFrame + samples.length;
  }
  at(f) { return this.buf[f & this.mask]; }
  oldest() { return Math.max(0, this.end - this.size + 1024); }
}

/** Interpolación parabólica sobre 3 puntos: devuelve el desplazamiento en [-1, 1]. */
export function parabolic(yl, y0, yr) {
  const d = yl - 2 * y0 + yr;
  if (d === 0) return 0;
  const x = 0.5 * (yl - yr) / d;
  return Math.max(-1, Math.min(1, x));
}

/**
 * Detector de ticks sobre la envolvente.
 *
 * El umbral es relativo a un seguidor del nivel de ruido. Hay dos trampas:
 *
 *  - Una media simple está contaminada por los propios tics. Se evita saltando
 *    el periodo refractario tras cada detección: el seguidor solo recorre las
 *    muestras de entre tics.
 *  - Un seguidor asimétrico (rápido bajando, lento subiendo) parece la solución
 *    obvia, pero converge al MÍNIMO del ruido, no a su nivel típico. Con TKEO,
 *    cuya salida es muy picuda y roza el cero, el suelo se desploma, el umbral
 *    se va con él y dispara con todo. Aquí se usa una media exponencial con la
 *    entrada limitada a 4x el suelo actual: un pico aislado apenas la mueve,
 *    pero un cambio sostenido de nivel sí se sigue.
 */
export class TickDetector {
  constructor(fs, hist) {
    this.fs = fs;
    this.hist = hist;
    this.pos = 0;
    this.floor = 0;
    this.floorInit = false;
    this.warmSum = 0;
    this.warmCount = 0;
    this.warmN = Math.round(0.05 * fs);
    this.a = 1 - Math.exp(-1 / (0.25 * fs)); // ~250 ms
    this.k = 12;
    this.refractory = Math.round(0.04 * fs);
    this.lastPeak = -Infinity;
  }

  setBeatPeriod(T) {
    // 55% de la batida: deja pasar los tres ruidos del escape como un solo
    // evento y bloquea el siguiente golpe.
    this.refractory = Math.max(8, Math.round(0.55 * T * this.fs));
  }

  reset() {
    this.pos = this.hist.end;
    this.floor = 0;
    this.floorInit = false;
    this.warmSum = 0;
    this.warmCount = 0;
    this.lastPeak = -Infinity;
  }

  /**
   * Busca ticks hasta `limitFrame`. El llamante deja margen por delante para
   * que la ventana de amplitud de cada tic esté completa antes de analizarla.
   */
  detect(limitFrame) {
    const h = this.hist;
    const out = [];
    if (this.pos < h.oldest()) this.pos = h.oldest();
    const maxSearch = Math.round(0.02 * this.fs);

    while (this.pos < limitFrame) {
      const v = h.at(this.pos);
      if (!this.floorInit) {
        this.warmSum += v;
        if (++this.warmCount >= this.warmN) {
          this.floor = Math.max(this.warmSum / this.warmCount, 1e-30);
          this.floorInit = true;
        }
        this.pos++;
        continue;
      }
      this.floor += (Math.min(v, this.floor * 4) - this.floor) * this.a;
      const thr = this.floor * this.k;

      if (v > thr && this.pos - this.lastPeak >= this.refractory && this.floor > 0) {
        // Cima del grupo: máximo dentro de una ventana corta tras el cruce.
        const stop = Math.min(this.pos + maxSearch, limitFrame - 1);
        let best = this.pos, bestV = v;
        for (let f = this.pos + 1; f <= stop; f++) {
          const w = h.at(f);
          if (w > bestV) { bestV = w; best = f; }
        }
        const frac = parabolic(h.at(best - 1), bestV, h.at(best + 1));
        out.push({ frame: best + frac, intFrame: best, peak: bestV, floor: this.floor, thr });
        this.lastPeak = best;
        this.pos = best + this.refractory;
        continue;
      }
      this.pos++;
    }
    return out;
  }
}

/**
 * Refina la marca temporal de cada tic correlando su envolvente contra una
 * plantilla promediada.
 *
 * El máximo de la envolvente es un estimador ruidoso: el pico se mueve entre el
 * ruido de desenclavamiento y el de impulso según el acoplamiento. La plantilla
 * usa toda la forma del tic, que es mucho más estable.
 *
 * Hay una plantilla por paridad de batida (tic y tac suenan distinto). Ambas se
 * acumulan alineadas por el mismo criterio -el pico parabólico-, así que el
 * sesgo relativo entre ellas es el que ya tendría el método parabólico: el
 * refinado mejora el ruido sin desplazar el error de batida.
 */
export class TickAligner {
  constructor(fs, preMs = 1.5, postMs = 6.0, searchMs = 1.2) {
    this.fs = fs;
    this.pre = Math.round(preMs * fs / 1000);
    this.len = Math.round((preMs + postMs) * fs / 1000);
    this.search = Math.round(searchMs * fs / 1000);
    this.tpl = [new Float64Array(this.len), new Float64Array(this.len)];
    this.count = [0, 0];
    this.ready = [false, false];
    this.minCount = 24;
    this.enabled = true;
  }

  reset() {
    for (const t of this.tpl) t.fill(0);
    this.count = [0, 0];
    this.ready = [false, false];
  }

  /** Extrae y normaliza (media 0, norma 1) la ventana alrededor de `base`. */
  _window(hist, base, out) {
    let mean = 0;
    for (let j = 0; j < this.len; j++) {
      const v = hist.at(base - this.pre + j);
      out[j] = v;
      mean += v;
    }
    mean /= this.len;
    let norm = 0;
    for (let j = 0; j < this.len; j++) { out[j] -= mean; norm += out[j] * out[j]; }
    norm = Math.sqrt(norm);
    if (norm < 1e-20) return false;
    for (let j = 0; j < this.len; j++) out[j] /= norm;
    return true;
  }

  learn(hist, intFrame, parity) {
    const w = new Float64Array(this.len);
    if (!this._window(hist, intFrame, w)) return;
    const t = this.tpl[parity];
    const n = ++this.count[parity];
    const a = 1 / Math.min(n, 60); // media móvil exponencial tras las 60 primeras
    for (let j = 0; j < this.len; j++) t[j] += (w[j] - t[j]) * a;
    if (n >= this.minCount) this.ready[parity] = true;
  }

  /** @returns {number} frame refinado, o `NaN` si la plantilla aún no sirve. */
  refine(hist, intFrame, parity) {
    if (!this.enabled || !this.ready[parity]) return NaN;
    const t = this.tpl[parity];
    const w = new Float64Array(this.len);
    let bestS = 0, bestC = -Infinity;
    const corrs = new Float64Array(2 * this.search + 1);

    for (let s = -this.search; s <= this.search; s++) {
      if (!this._window(hist, intFrame + s, w)) continue;
      let c = 0;
      for (let j = 0; j < this.len; j++) c += w[j] * t[j];
      corrs[s + this.search] = c;
      if (c > bestC) { bestC = c; bestS = s; }
    }
    if (bestC <= 0) return NaN;
    const bi = bestS + this.search;
    if (bi <= 0 || bi >= corrs.length - 1) return intFrame + bestS;
    // El desplazamiento que maximiza la correlación ES el offset del tic.
    return intFrame + bestS + parabolic(corrs[bi - 1], bestC, corrs[bi + 1]);
  }
}
