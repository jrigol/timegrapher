import { T, fitCanvas, niceStep } from './theme.js';
import { t } from '../i18n.js';

/**
 * Serie temporal de una sola magnitud.
 *
 * Una serie por gráfico y nunca dos escalas en el mismo eje: marcha, amplitud y
 * error de batida tienen unidades y órdenes de magnitud distintos, así que van
 * en tres gráficos apilados que comparten el eje de tiempo. El título nombra la
 * serie, de modo que no hace falta leyenda.
 */
export class TimeSeries {
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.title = opts.title;
    this.unit = opts.unit || '';
    this.color = opts.color;
    this.decimals = opts.decimals ?? 1;
    this.band = opts.band || null;   // {lo, hi} zona de referencia
    this.symmetric = !!opts.symmetric;
    this.windowSeconds = 120;
    this.data = [];
    this.cursor = null;

    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.cursor = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.draw();
    });
    canvas.addEventListener('pointerleave', () => { this.cursor = null; this.draw(); });
  }

  push(t, v) {
    if (!isFinite(v)) return;
    this.data.push({ t, v });
    const cutoff = t - 3600;
    while (this.data.length && this.data[0].t < cutoff) this.data.shift();
  }

  clear() { this.data = []; }

  visible() {
    if (!this.data.length) return [];
    const tEnd = this.data[this.data.length - 1].t;
    const from = tEnd - this.windowSeconds;
    return this.data.filter((p) => p.t >= from);
  }

  draw() {
    const { ctx, w, h } = fitCanvas(this.canvas);
    const padL = 46, padR = 10, padT = 20, padB = 18;
    const pw = w - padL - padR, ph = h - padT - padB;

    ctx.fillStyle = T.surface;
    ctx.fillRect(0, 0, w, h);
    ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';

    ctx.textAlign = 'left';
    ctx.fillStyle = T.ink2;
    ctx.fillText(this.title, padL, 13);
    ctx.textAlign = 'right';
    ctx.fillStyle = T.muted;
    ctx.fillText(this.unit, w - padR, 13);

    const pts = this.visible();
    let lo, hi;
    if (pts.length) {
      lo = Infinity; hi = -Infinity;
      for (const p of pts) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; }
      if (this.band) { lo = Math.min(lo, this.band.lo); hi = Math.max(hi, this.band.hi); }
      if (this.symmetric) { const m = Math.max(Math.abs(lo), Math.abs(hi), 1); lo = -m; hi = m; }
      const pad = (hi - lo) * 0.15 || Math.max(1, Math.abs(hi) * 0.1);
      lo -= pad; hi += pad;
    } else { lo = this.symmetric ? -10 : 0; hi = 10; }

    const yOf = (v) => padT + ph - ((v - lo) / (hi - lo)) * ph;
    const tEnd = pts.length ? pts[pts.length - 1].t : 0;
    const xOf = (t) => padL + pw - ((tEnd - t) / this.windowSeconds) * pw;

    // Zona de referencia: un tinte de superficie, nunca un color de serie.
    if (this.band) {
      ctx.fillStyle = 'rgba(255,255,255,0.045)';
      const y1 = yOf(this.band.hi), y2 = yOf(this.band.lo);
      ctx.fillRect(padL, Math.min(y1, y2), pw, Math.abs(y2 - y1));
    }

    const step = niceStep(hi - lo, 4);
    ctx.textAlign = 'right';
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      const y = Math.round(yOf(v)) + 0.5;
      ctx.strokeStyle = Math.abs(v) < step / 1e6 ? T.axis : T.grid;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + pw, y); ctx.stroke();
      ctx.fillStyle = T.muted;
      ctx.fillText(fmtTick(v, step), padL - 6, y + 3.5);
    }

    if (pts.length > 1) {
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      let started = false;
      for (const p of pts) {
        const x = xOf(p.t), y = yOf(p.v);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Extremo de dato: ancla la lectura actual.
      const last = pts[pts.length - 1];
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(xOf(last.t), yOf(last.v), 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Eje de tiempo.
    ctx.strokeStyle = T.axis;
    ctx.beginPath();
    ctx.moveTo(padL, padT + ph + 0.5); ctx.lineTo(padL + pw, padT + ph + 0.5);
    ctx.stroke();
    ctx.fillStyle = T.muted;
    ctx.textAlign = 'left';
    ctx.fillText(`-${fmtDur(this.windowSeconds)}`, padL, h - 5);
    ctx.textAlign = 'right';
    ctx.fillText(t('chart.now'), w - padR, h - 5);

    if (this.cursor && pts.length) this._hover(ctx, pts, xOf, yOf, padL, pw, padT, ph, w);

    ctx.strokeStyle = T.border;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  }

  _hover(ctx, pts, xOf, yOf, padL, pw, padT, ph, w) {
    const cx = this.cursor.x;
    if (cx < padL || cx > padL + pw) return;
    let best = pts[0], bd = Infinity;
    for (const p of pts) {
      const d = Math.abs(xOf(p.t) - cx);
      if (d < bd) { bd = d; best = p; }
    }
    const x = xOf(best.t), y = yOf(best.v);
    ctx.strokeStyle = T.axis;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + ph); ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = T.surface;
    ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = this.color;
    ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();

    const tEnd = pts[pts.length - 1].t;
    const label = `${best.v.toFixed(this.decimals)} ${this.unit}  ·  -${fmtDur(tEnd - best.t)}`;
    ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
    const tw = ctx.measureText(label).width + 12;
    const bx = Math.min(Math.max(x - tw / 2, padL), padL + pw - tw);
    ctx.fillStyle = T.plane;
    ctx.fillRect(bx, padT + 2, tw, 18);
    ctx.strokeStyle = T.border;
    ctx.strokeRect(bx + 0.5, padT + 2.5, tw - 1, 17);
    ctx.fillStyle = T.ink;
    ctx.textAlign = 'center';
    ctx.fillText(label, bx + tw / 2, padT + 15);
  }
}

function fmtTick(v, step) {
  const d = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return v.toFixed(d);
}

function fmtDur(s) {
  s = Math.round(s);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m}m${String(s % 60).padStart(2, '0')}` : `${m}m`;
}
