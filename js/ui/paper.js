import { T, fitCanvas } from './theme.js';

/**
 * Cinta de papel.
 *
 * Cada tic es un punto: el eje X es su desviación de fase respecto a la cadencia
 * nominal y el eje Y el tiempo, con lo más reciente arriba. La INCLINACIÓN de
 * las trazas es la marcha y la SEPARACIÓN entre las dos es el error de batida.
 *
 * La fase se envuelve dentro del rango visible, igual que la cinta de papel de
 * un aparato de mesa: un reloj a +100 s/día se desplaza 35 ms en 30 s y sin
 * envolver se saldría de la pantalla en un par de segundos.
 */
export class PaperTape {
  constructor(canvas) {
    this.canvas = canvas;
    this.halfRange = 5;      // ms a cada lado
    this.windowSeconds = 30;
    this.points = [];
    this.cursor = null;

    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.cursor = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.draw();
    });
    canvas.addEventListener('pointerleave', () => { this.cursor = null; this.draw(); });
  }

  setPoints(points) { this.points = points; }

  draw() {
    const { ctx, w, h } = fitCanvas(this.canvas);
    const padL = 8, padR = 8, padT = 18, padB = 22;
    const pw = w - padL - padR, ph = h - padT - padB;

    ctx.fillStyle = T.surface;
    ctx.fillRect(0, 0, w, h);

    const half = this.halfRange;
    const xOf = (ms) => padL + ((ms + half) / (2 * half)) * pw;

    // Rejilla vertical, recesiva.
    const step = half >= 10 ? 5 : half >= 5 ? 2 : 1;
    ctx.font = '10px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    for (let ms = -Math.floor(half / step) * step; ms <= half; ms += step) {
      const x = xOf(ms);
      ctx.strokeStyle = ms === 0 ? T.axis : T.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, padT);
      ctx.lineTo(Math.round(x) + 0.5, padT + ph);
      ctx.stroke();
      ctx.fillStyle = T.muted;
      ctx.fillText(`${ms > 0 ? '+' : ''}${ms}`, x, h - 8);
    }
    ctx.fillStyle = T.muted;
    ctx.textAlign = 'right';
    ctx.fillText('ms', w - padR, padT - 6);

    const pts = this.points;
    if (pts.length) {
      const tEnd = pts[pts.length - 1].t;
      const span = this.windowSeconds;
      const wrap = 2 * half;
      for (const p of pts) {
        const age = tEnd - p.t;
        if (age > span) continue;
        let ph2 = p.phase;
        // Envolver al rango visible.
        ph2 = ((((ph2 + half) % wrap) + wrap) % wrap) - half;
        const x = xOf(ph2);
        const y = padT + (age / span) * ph;
        ctx.fillStyle = (p.i & 1) ? T.s2 : T.s1;
        ctx.fillRect(Math.round(x) - 1, Math.round(y), 2.5, 2.5);
      }
    }

    // Crosshair: sirve para leer directamente la separación entre trazas.
    if (this.cursor && this.cursor.x >= padL && this.cursor.x <= padL + pw) {
      const ms = ((this.cursor.x - padL) / pw) * 2 * half - half;
      ctx.strokeStyle = T.ink2;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(this.cursor.x, padT);
      ctx.lineTo(this.cursor.x, padT + ph);
      ctx.stroke();
      ctx.setLineDash([]);
      const label = `${ms >= 0 ? '+' : ''}${ms.toFixed(2)} ms`;
      ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
      const tw = ctx.measureText(label).width + 10;
      const bx = Math.min(Math.max(this.cursor.x - tw / 2, padL), padL + pw - tw);
      ctx.fillStyle = T.plane;
      ctx.fillRect(bx, padT + 2, tw, 18);
      ctx.strokeStyle = T.border;
      ctx.strokeRect(bx + 0.5, padT + 2.5, tw - 1, 17);
      ctx.fillStyle = T.ink;
      ctx.textAlign = 'center';
      ctx.fillText(label, bx + tw / 2, padT + 15);
    }

    ctx.strokeStyle = T.border;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  }
}
