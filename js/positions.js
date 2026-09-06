import { t, nf, signed, locale, csvSep } from './i18n.js';

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
  { key: 'dialUp', axis: 'H' },
  { key: 'dialDown', axis: 'H' },
  { key: 'crownUp', axis: 'V' },
  { key: 'crownDown', axis: 'V' },
  { key: 'crownLeft', axis: 'V' },
  { key: 'crownRight', axis: 'V' },
];

/** Nombre y código dependen del idioma; la clave, no. Cambiar de idioma a
 *  media sesión reetiqueta la tabla sin perder ninguna medida. */
export const posName = (key) => t(`pos.${key}.name`);
export const posCode = (key) => t(`pos.${key}.code`);

const KEYS = POSITIONS.map((p) => p.key);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

// El separador decimal lo pone el idioma activo, en la interfaz y en las salidas.
const num = nf;

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
    return POSITIONS.filter((p) => this.data[p.key])
      .map((p) => ({ ...p, name: posName(p.key), code: posCode(p.key), ...this.data[p.key] }));
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
    const dash = t('export.none');
    return [
      [t('export.date'), new Date().toLocaleString(locale())],
      [t('export.reference'), meta.reference || dash],
      [t('export.bph'), meta.bph ? `${meta.bph} bph` : dash],
      [t('export.lift'), meta.liftAngle ? `${meta.liftAngle}°` : dash],
      [t('export.calibration'), meta.calibration || t('export.uncalibrated')],
    ];
  }

  toCsv(meta = {}) {
    const sep = csvSep();
    const esc = (v) => {
      const s = String(v ?? '');
      return new RegExp(`["${sep}\n]`).test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const out = this._meta(meta).map(([k, v]) => `${esc(k)}${sep}${esc(v)}`);
    out.push('');
    out.push([t('export.position'), t('export.code'), t('export.rate'),
      t('export.amplitude'), t('export.beat'), t('export.time')].map(esc).join(sep));
    for (const r of this.entries()) {
      out.push([
        esc(r.name), r.code,
        esc(num(r.rate)),
        r.amplitude == null ? '' : Math.round(r.amplitude),
        esc(num(r.beatError, 2)),
        r.at.toLocaleTimeString(locale()),
      ].join(sep));
    }
    const s = this.summary();
    if (s) {
      out.push('');
      out.push(`${esc(`${t('export.deltaLabel')} (${s.max.code}-${s.min.code})`)}${sep}${esc(num(s.delta))}`);
      if (s.drop != null) out.push(`${esc(t('export.dropLabel'))}${sep}${Math.round(s.drop)}`);
      out.push(`${esc(t('export.beatMaxLabel'))}${sep}${esc(num(s.beatMax, 2))}`);
    }
    return out.join('\n');
  }

  toText(meta = {}) {
    const pad = (v, n) => String(v).padStart(n);
    const out = this._meta(meta).map(([k, v]) => `${k}: ${v}`);
    out.push('');
    out.push(t('export.tableHead'));
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
      out.push(`${t('export.deltaLabel')}: ${num(s.delta)} ${t('tile.rateUnit')}  ` +
        `(${s.max.code} ${signed(s.max.rate)} · ${s.min.code} ${signed(s.min.rate)})`);
      if (s.drop != null) {
        out.push(t('export.amplitudeLine',
          { h: Math.round(s.horiz), v: Math.round(s.vert), d: Math.round(s.drop) }));
      }
      out.push(`${t('export.beatMaxLabel')}: ${num(s.beatMax, 2)} ms`);
    }
    return out.join('\n');
  }
}

/**
 * Juicio sobre el delta. Los umbrales siguen el criterio habitual de banco: el
 * COSC admite hasta 10 s/día de diferencia entre posiciones en un cronómetro.
 */
export function judgeDelta(delta, count) {
  if (count < 2) return { level: '', text: t('judge.delta.need') };
  if (delta <= 10) return { level: 'good', text: t('judge.delta.good') };
  if (delta <= 25) return { level: 'warning', text: t('judge.delta.warning') };
  if (delta <= 60) return { level: 'serious', text: t('judge.delta.serious') };
  return { level: 'critical', text: t('judge.delta.critical') };
}

/** Juicio sobre la caída de amplitud horizontal -> vertical. */
export function judgeDrop(drop) {
  if (drop == null) return { level: '', text: '' };
  if (drop <= 30) return { level: 'good', text: t('judge.drop.good') };
  if (drop <= 50) return { level: 'warning', text: t('judge.drop.warning') };
  return { level: 'serious', text: t('judge.drop.serious') };
}
