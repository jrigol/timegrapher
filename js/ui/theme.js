/**
 * Paleta del panel: fcde9c · ffa552 · ba5624 · 381d2a · c4d6b0.
 *
 * El reparto de papeles no es estético, sale de medir. Los cinco colores se
 * validaron contra la superficie #381d2a con el comprobador de la paleta:
 *
 *  - Crema (L 0,91) y salvia (L 0,85) son PÁLIDOS y de croma bajo: como marcas
 *    de datos no se distinguen entre sí (ΔE 8,4 con visión normal, por debajo
 *    del suelo de 15). No son colores de serie, son colores de TINTA, y ahí
 *    rinden de sobra: 11,7:1 y 9,9:1 de contraste.
 *  - La cinta es la única gráfica con dos series juntas, así que se lleva el
 *    par mejor separado: crema contra óxido, ΔE 35,4 con visión normal y 33,5
 *    bajo deuteranopia. Los pares que parecían obvios a ojo -naranja contra
 *    salvia- son justo los que fallan (ΔE 14,4, por debajo del suelo).
 *  - El naranja queda para lo interactivo: botones, progreso, medida en curso.
 *  - El óxido da 3,23:1. Sirve como marca, NUNCA para texto.
 *
 * Los colores de estado no se tematizan a propósito: bueno/malo tiene que ser
 * inequívoco y no debe confundirse con la identidad decorativa de una serie.
 * Los cuatro pasan el contraste sobre la superficie nueva, y en la interfaz
 * siempre van con etiqueta, nunca solo con el color.
 */
export const T = {
  surface: '#381d2a',   // berenjena de la paleta
  plane: '#250c19',     // paso más oscuro del mismo tono
  ink: '#fcde9c',       // crema
  ink2: '#c4d6b0',      // salvia
  muted: '#9c8d94',     // berenjena desaturada, 4,8:1
  grid: '#4a2c3a',
  axis: '#5b3d4b',
  border: 'rgba(252, 222, 156, 0.14)',

  s1: '#fcde9c', // crema   - traza del tic y marcha
  s2: '#ba5624', // óxido   - traza del tac y error de batida
  s3: '#c4d6b0', // salvia  - amplitud
  accent: '#ffa552', // naranja - botones, progreso, medida en curso

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
