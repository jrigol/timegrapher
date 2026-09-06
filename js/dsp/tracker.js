/**
 * Seguimiento de fase: marcha y error de batida.
 *
 * Se ajusta por mínimos cuadrados el modelo
 *
 *     t_i = a + b*i + c*(-1)^i
 *
 * donde `i` es el número de batida. El término alterno absorbe el error de
 * batida, de modo que `b` -el periodo medio- queda limpio de él. Ajustar la
 * pendiente sobre toda la ventana es mucho más preciso que promediar intervalos:
 * el error de temporización de cada tic se reparte sobre toda la base.
 *
 * Los intervalos alternan b+2c y b-2c, así que la separación entre las dos
 * trazas de la cinta -que es lo que se llama error de batida- vale 2|c|.
 */
export class RateTracker {
  constructor() {
    this.beatPeriod = 0.125;
    this.ticks = [];      // {i, t}
    this.keepSeconds = 120;
    this.tolerance = 0.25; // fracción de batida admisible al encajar el índice
    this.anchors = 0;      // veces que se ha tenido que reanclar la numeración
    this.reset();
  }

  setBeatPeriod(T) {
    if (Math.abs(T - this.beatPeriod) > 1e-9) {
      this.beatPeriod = T;
      this.reset();
    }
  }

  reset() {
    this.ticks = [];
    this.lastT = NaN;
    this.lastI = 0;
    this.t0 = NaN;
    this.rejects = 0;
  }

  /**
   * Asigna número de batida a un tic nuevo. Contar desde el tic anterior (y no
   * desde el origen) hace que un tic perdido no desplace todo el resto.
   *
   * Un tic cuyo intervalo no cae cerca de un múltiplo entero de la batida se
   * RECHAZA en vez de numerarse: un golpe en la mesa o un disparo del ruido
   * desplazaría toda la numeración posterior y el ajuste se vendría abajo. El
   * periodo refractario ya garantiza más de media batida de separación, así que
   * un espurio siempre cae lejos de un entero. Tras varios rechazos seguidos se
   * asume que la referencia es la mala y se reancla.
   *
   * @returns {number|null} el índice, o null si el tic no encaja.
   */
  assign(t) {
    if (!isFinite(this.lastT)) return this._anchor(t);

    const d = (t - this.lastT) / this.beatPeriod;
    const dr = Math.round(d);
    if (dr < 1 || dr > 40 || Math.abs(d - dr) > this.tolerance) {
      if (++this.rejects >= 8) return this._anchor(t);
      return null;
    }
    this.rejects = 0;
    const i = this.lastI + dr;
    this.lastT = t; this.lastI = i;
    return i;
  }

  _anchor(t) {
    this.anchors++;   // señal dura de discontinuidad: se ha movido el reloj
    this.ticks = [];
    this.lastT = t; this.lastI = 0; this.t0 = t; this.rejects = 0;
    return 0;
  }

  add(i, t) {
    this.ticks.push({ i, t });
    const cutoff = t - this.keepSeconds;
    while (this.ticks.length && this.ticks[0].t < cutoff) this.ticks.shift();
  }

  /**
   * Ajusta sobre los últimos `windowSeconds`.
   * @returns {null|{rate:number, rateSigma:number, beatError:number, period:number,
   *                 n:number, rms:number}}
   */
  fit(windowSeconds) {
    const n0 = this.ticks.length;
    if (n0 < 8) return null;
    const tEnd = this.ticks[n0 - 1].t;
    const from = tEnd - windowSeconds;
    let start = 0;
    while (start < n0 && this.ticks[start].t < from) start++;
    let pts = this.ticks.slice(start);
    if (pts.length < 8) pts = this.ticks.slice(Math.max(0, n0 - 8));

    let sol = solve(pts);
    if (!sol) return null;

    // Una pasada de reponderación: un tic espurio (un golpe en la mesa) no debe
    // arrastrar la pendiente.
    const res = pts.map((p) => p.t - (sol.a + sol.b * (p.i - sol.ibar) + sol.c * (p.i & 1 ? -1 : 1)));
    const mad = median(res.map(Math.abs)) * 1.4826;
    if (mad > 0) {
      const keep = pts.filter((_, k) => Math.abs(res[k]) <= 4 * mad);
      if (keep.length >= 8 && keep.length < pts.length) {
        const s2 = solve(keep);
        if (s2) { sol = s2; pts = keep; }
      }
    }

    const T = this.beatPeriod;
    const rate = ((T - sol.b) / T) * 86400;
    const rateSigma = (sol.bSigma / T) * 86400;
    return {
      rate,
      rateSigma,
      beatError: Math.abs(2 * sol.c) * 1000,
      period: sol.b,
      n: pts.length,
      rms: sol.rms * 1000,
      span: pts[pts.length - 1].t - pts[0].t,
    };
  }

  /**
   * Desviación de fase de cada tic respecto a la cadencia NOMINAL, en ms.
   * Es lo que dibuja la cinta de papel: la inclinación de las trazas es la
   * marcha y su separación el error de batida.
   */
  phases(windowSeconds) {
    const out = [];
    if (!this.ticks.length || !isFinite(this.t0)) return out;
    const tEnd = this.ticks[this.ticks.length - 1].t;
    const from = tEnd - windowSeconds;
    for (const p of this.ticks) {
      if (p.t < from) continue;
      out.push({ t: p.t, i: p.i, phase: (p.t - this.t0 - p.i * this.beatPeriod) * 1000 });
    }
    return out;
  }
}

/** Mínimos cuadrados de t = a + b*(i - ibar) + c*(-1)^i. */
function solve(pts) {
  const n = pts.length;
  if (n < 4) return null;
  let ibar = 0;
  for (const p of pts) ibar += p.i;
  ibar /= n;

  let Suu = 0, Sus = 0, S1 = 0, St = 0, Sut = 0, Sst = 0;
  for (const p of pts) {
    const u = p.i - ibar;
    const s = p.i & 1 ? -1 : 1;
    Suu += u * u; Sus += u * s; S1 += s;
    St += p.t; Sut += u * p.t; Sst += s * p.t;
  }
  // [ n   0    S1  ][a]   [St ]
  // [ 0   Suu  Sus ][b] = [Sut]
  // [ S1  Sus  n   ][c]   [Sst]
  const M = [[n, 0, S1], [0, Suu, Sus], [S1, Sus, n]];
  const inv = invert3(M);
  if (!inv) return null;
  const v = [St, Sut, Sst];
  const a = inv[0][0] * v[0] + inv[0][1] * v[1] + inv[0][2] * v[2];
  const b = inv[1][0] * v[0] + inv[1][1] * v[1] + inv[1][2] * v[2];
  const c = inv[2][0] * v[0] + inv[2][1] * v[1] + inv[2][2] * v[2];

  let ss = 0;
  for (const p of pts) {
    const u = p.i - ibar;
    const s = p.i & 1 ? -1 : 1;
    const r = p.t - (a + b * u + c * s);
    ss += r * r;
  }
  const dof = Math.max(1, n - 3);
  const varRes = ss / dof;
  return {
    a, b, c, ibar,
    rms: Math.sqrt(varRes),
    bSigma: Math.sqrt(Math.max(0, varRes * inv[1][1])),
  };
}

function invert3(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!isFinite(det) || Math.abs(det) < 1e-12) return null;
  return [
    [A / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [C / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
