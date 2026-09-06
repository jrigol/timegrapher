/** FFT compleja in-place, radix-2 iterativa. `re`/`im` deben tener longitud potencia de 2. */
export function fft(re, im, inverse = false) {
  const n = re.length;
  // Permutación por inversión de bits.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + len / 2], bi = im[i + k + len / 2];
        const tr = br * cr - bi * ci, ti = br * ci + bi * cr;
        re[i + k] = ar + tr; im[i + k] = ai + ti;
        re[i + k + len / 2] = ar - tr; im[i + k + len / 2] = ai - ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

export function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * Autocorrelación lineal insesgada de `x` (se le resta la media), vía FFT.
 *
 * El relleno a >= 2N evita el solape circular. La normalización por (N-k)
 * compensa la caída triangular: sin ella el pico del periodo completo queda
 * sistemáticamente por debajo del pico de la media batida y la detección de
 * bph se equivocaría de octava.
 */
export function autocorr(x, maxLag) {
  const n = x.length;
  const m = nextPow2(2 * n);
  const re = new Float64Array(m), im = new Float64Array(m);

  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= n;
  for (let i = 0; i < n; i++) re[i] = x[i] - mean;

  fft(re, im, false);
  for (let i = 0; i < m; i++) {
    re[i] = re[i] * re[i] + im[i] * im[i];
    im[i] = 0;
  }
  fft(re, im, true);

  const lags = Math.min(maxLag, n - 1);
  const out = new Float64Array(lags + 1);
  const r0 = re[0] / n;
  if (r0 <= 0) return out;
  for (let k = 0; k <= lags; k++) out[k] = (re[k] / (n - k)) / r0;
  return out;
}
