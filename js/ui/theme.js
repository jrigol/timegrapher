/**
 * Paleta del panel. Instrumento de banco: se compromete deliberadamente con el
 * modo oscuro, que es donde la traza de la cinta se lee mejor y lo que hacen los
 * timegrapher de mesa. Todos los valores son pasos validados contra la
 * superficie #1a1a19 (banda de luminosidad, croma, separación CVD y contraste).
 */
export const T = {
  surface: '#1a1a19',
  plane: '#0d0d0d',
  ink: '#ffffff',
  ink2: '#c3c2b7',
  muted: '#898781',
  grid: '#2c2c2a',
  axis: '#383835',
  border: 'rgba(255,255,255,0.10)',

  s1: '#3987e5', // azul   - marcha / traza del tic
  s2: '#d95926', // naranja- error de batida / traza del tac
  s3: '#199e70', // aqua   - amplitud

  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
};

/** Prepara un canvas para la densidad de pantalla. Devuelve {w,h} en px CSS. */
export function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width));
  const h = Math.max(1, Math.round(r.height));
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/** Pasos "bonitos" para un eje: 1, 2, 5 x 10^n. */
export function niceStep(range, target) {
  if (!(range > 0)) return 1;
  const raw = range / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
}
