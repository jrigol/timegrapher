/**
 * Paleta del panel: 4e598c · ffffff · f9c784 · fcaf58 · ff8c42.
 *
 * Tomada al pie de la letra esta paleta no funciona, y conviene saber por qué:
 *
 *  - Los tres naranjas son UNA rampa, no tres colores. Entre sí dan ΔE 6,0,
 *    7,7 y 13,3 (OKLab ×100), los tres por debajo del suelo de 15. Sirven como
 *    pasos de intensidad, nunca como categorías que haya que distinguir.
 *  - El blanco no puede ser la superficie: sobre blanco los naranjas caen a
 *    1,55–2,31:1, invisibles como marcas. Un tema claro con esta paleta no
 *    puede mostrar datos.
 *  - El índigo tal cual tampoco: con él de fondo, #ff8c42 da 2,90:1, por
 *    debajo del mínimo de 3:1.
 *
 * Lo que sí funciona es derivar las superficies del TONO índigo. Con la tarjeta
 * en #1d2351 todo entra en rango, y el #4e598c original encuentra su papel
 * natural en ejes y bordes, donde 2,2:1 es justo lo que se quiere: recesivo.
 *
 * La cinta -única gráfica con dos series superpuestas- usa el par mejor
 * separado: naranja fuego contra un periwinkle del tono índigo, ΔE 27,2 con
 * visión normal y 22,5 en protanopia. Son tonos casi opuestos, y ambos salen de
 * las dos familias de la paleta.
 *
 * Los colores de estado no se tematizan a propósito: bueno/malo tiene que ser
 * inequívoco y no confundirse con la identidad decorativa de una serie.
 */
export const T = {
  surface: '#1d2351',   // paso oscuro del tono índigo
  plane: '#0c0e3b',
  ink: '#ffffff',       // blanco de la paleta, 14,9:1
  ink2: '#c7d0ef',
  muted: '#969db8',
  grid: '#2c345e',
  axis: '#4e598c',      // el índigo dado: recesivo a propósito
  border: 'rgba(255, 255, 255, 0.13)',

  s1: '#ff8c42', // fuego      - traza del tic y marcha
  s2: '#7d8dd6', // periwinkle - traza del tac y error de batida
  s3: '#f9c784', // albaricoque- amplitud
  accent: '#fcaf58', // naranja - botones, progreso, medida en curso

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
