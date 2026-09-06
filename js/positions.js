/**
 * Sesión de medida por posiciones.
 *
 * El trabajo real de un relojero no es leer una cifra: es medir el reloj en
 * cinco o seis posiciones y COMPARARLAS. El diagnóstico está en las diferencias,
 * no en ninguna lectura suelta:
 *
 *  - El delta (marcha máxima menos mínima entre posiciones) es la cifra con la
 *    que se juzga un reloj; el propio COSC exige <= 10 s/día en cinco posiciones.
 *  - La caída de amplitud de horizontal a vertical delata pivotes sucios o
 *    gastados, poise del volante o un escape mal ajustado. Por encima de unos
 *    50 grados hay algo que mirar.
 */

/** Las seis posiciones estándar. `axis` separa horizontales de verticales. */
export const POSITIONS = [
  { key: 'EA', name: 'Esfera arriba', axis: 'H' },
  { key: 'EB', name: 'Esfera abajo', axis: 'H' },
  { key: 'CA', name: 'Corona arriba', axis: 'V' },
  { key: 'CB', name: 'Corona abajo', axis: 'V' },
  { key: 'CI', name: 'Corona izquierda', axis: 'V' },
  { key: 'CD', name: 'Corona derecha', axis: 'V' },
];

const KEYS = POSITIONS.map((p) => p.key);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/** Coma decimal en las dos salidas: la interfaz está en español. */
const num = (v, d = 1) => v.toFixed(d).replace('.', ',');
const signed = (v, d = 1) => (v >= 0 ? '+' : '') + num(v, d);

export class PositionSession {
  constructor() { this.reset(); }

  reset() {
    /** @type {Object<string, {rate:number, amplitude:number|null, beatError:number, at:Date}>} */
    this.data = {};
  }

  capture(key, reading) {
    if (!KEYS.includes(key)) return false;
    this.data[key] = { ...reading, at: reading.at || new Date() };
    return true;
  }

  clear(key) { delete this.data[key]; }
  get(key) { return this.data[key] || null; }
  get count() { return Object.keys(this.data).length; }
  get isEmpty() { return this.count === 0; }

  /** Posiciones capturadas, en el orden canónico. */
  entries() {
    return POSITIONS.filter((p) => this.data[p.key]).map((p) => ({ ...p, ...this.data[p.key] }));
  }

  /**
   * @returns {null|{delta:number, min:object, max:object, count:number,
   *                 horiz:number|null, vert:number|null, drop:number|null,
   *                 beatMax:number}}
   */
  summary() {
    const rows = this.entries();
    if (!rows.length) return null;

    let min = rows[0], max = rows[0];
    for (const r of rows) {
      if (r.rate < min.rate) min = r;
      if (r.rate > max.rate) max = r;
    }

    const amps = (axis) => rows.filter((r) => r.axis === axis && r.amplitude != null)
      .map((r) => r.amplitude);
    const horiz = mean(amps('H'));
    const vert = mean(amps('V'));

    return {
      delta: max.rate - min.rate,
      min, max,
      count: rows.length,
      horiz, vert,
      drop: horiz != null && vert != null ? horiz - vert : null,
      beatMax: Math.max(...rows.map((r) => r.beatError)),
    };
  }

  /** Cabecera común a los dos formatos de salida. */
  _meta(meta = {}) {
    const lines = [
      ['Fecha', new Date().toLocaleString('es-ES')],
      ['Referencia', meta.reference || '—'],
      ['Alternancias', meta.bph ? `${meta.bph} bph` : '—'],
      ['Ángulo de alzada', meta.liftAngle ? `${meta.liftAngle}°` : '—'],
      ['Calibración', meta.calibration || 'sin calibrar'],
    ];
    return lines;
  }

  toCsv(meta = {}) {
    const esc = (v) => {
      const s = String(v ?? '');
      return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const out = this._meta(meta).map(([k, v]) => `${esc(k)};${esc(v)}`);
    out.push('');
    out.push(['Posición', 'Código', 'Marcha (s/día)', 'Amplitud (°)', 'Error de batida (ms)', 'Hora'].join(';'));
    for (const r of this.entries()) {
      out.push([
        esc(r.name), r.key,
        num(r.rate),
        r.amplitude == null ? '' : Math.round(r.amplitude),
        num(r.beatError, 2),
        r.at.toLocaleTimeString('es-ES'),
      ].join(';'));
    }
    const s = this.summary();
    if (s) {
      out.push('');
      out.push(`Delta (${s.max.key}-${s.min.key});${num(s.delta)}`);
      if (s.drop != null) out.push(`Caída de amplitud H-V;${Math.round(s.drop)}`);
      out.push(`Error de batida máximo;${num(s.beatMax, 2)}`);
    }
    return out.join('\n');
  }

  toText(meta = {}) {
    const pad = (v, n) => String(v).padStart(n);
    const out = this._meta(meta).map(([k, v]) => `${k}: ${v}`);
    out.push('');
    out.push('Posición              Marcha   Ampl.   Batida');
    for (const r of this.entries()) {
      out.push(
        r.name.padEnd(20) +
        pad(signed(r.rate), 7) +
        pad(r.amplitude == null ? '—' : Math.round(r.amplitude) + '°', 8) +
        pad(num(r.beatError, 2), 9)
      );
    }
    const s = this.summary();
    if (s) {
      out.push('');
      out.push(`Delta: ${num(s.delta)} s/día  (${s.max.key} ${signed(s.max.rate)} · ${s.min.key} ${signed(s.min.rate)})`);
      if (s.drop != null) {
        out.push(`Amplitud: horizontal ${Math.round(s.horiz)}° · vertical ${Math.round(s.vert)}° · caída ${Math.round(s.drop)}°`);
      }
      out.push(`Error de batida máximo: ${num(s.beatMax, 2)} ms`);
    }
    return out.join('\n');
  }
}

/**
 * Juicio sobre el delta. Los umbrales siguen el criterio habitual de banco: el
 * COSC admite hasta 10 s/día de diferencia entre posiciones en un cronómetro.
 */
export function judgeDelta(delta, count) {
  if (count < 2) return { level: '', text: 'hacen falta al menos dos posiciones' };
  if (delta <= 10) return { level: 'good', text: 'dentro de criterio de cronómetro' };
  if (delta <= 25) return { level: 'warning', text: 'aceptable en un reloj corriente' };
  if (delta <= 60) return { level: 'serious', text: 'revisar poise y pivotes' };
  return { level: 'critical', text: 'algo va mal' };
}

/** Juicio sobre la caída de amplitud horizontal -> vertical. */
export function judgeDrop(drop) {
  if (drop == null) return { level: '', text: '' };
  if (drop <= 30) return { level: 'good', text: 'normal' };
  if (drop <= 50) return { level: 'warning', text: 'algo alta' };
  return { level: 'serious', text: 'pivotes o poise' };
}
