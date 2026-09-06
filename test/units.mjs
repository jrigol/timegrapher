/**
 * Comprobaciones que no necesitan navegador:
 *   - la aritmética de la calibración recupera un ppm conocido
 *   - las rutas de dibujado de la cinta y de los gráficos se ejecutan enteras
 *     (con y sin datos, con y sin cursor) sobre un contexto 2D simulado
 *
 *   node test/units.mjs
 */
let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FALLO'}  ${name}${detail ? '  ' + detail : ''}`);
}

/* ------------------------------------------------- stubs de navegador --- */

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const CTX_METHODS = [
  'setTransform', 'fillRect', 'strokeRect', 'clearRect', 'beginPath', 'moveTo',
  'lineTo', 'stroke', 'fill', 'arc', 'closePath', 'setLineDash', 'save', 'restore',
];
function makeCanvas(w = 460, h = 300) {
  const calls = { count: 0 };
  const ctx = { measureText: (t) => { calls.count++; return { width: t.length * 6 }; } };
  for (const m of CTX_METHODS) ctx[m] = () => { calls.count++; };
  ctx.fillText = () => { calls.count++; };
  return {
    calls,
    width: 0, height: 0,
    getBoundingClientRect: () => ({ width: w, height: h, left: 0, top: 0 }),
    getContext: () => ctx,
    addEventListener: () => {},
  };
}
globalThis.window = { devicePixelRatio: 2, addEventListener: () => {} };

/* ------------------------------------------------------- calibración --- */

const { ClockCalibration } = await import('../js/calibration.js');

console.log('\nCalibración del reloj de muestreo');
{
  const cal = new ClockCalibration();
  const NOMINAL = 48000;
  const TRUE_PPM = 104.3;                     // cristal que va rápido
  const fsReal = NOMINAL * (1 + TRUE_PPM / 1e6);
  cal.start(NOMINAL, 'dispositivo-de-prueba');

  // 30 min de bloques de 4096 muestras, con jitter de entrega de +-3 ms
  // (asimétrico, como en la realidad: los mensajes llegan tarde, nunca pronto).
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const blocks = Math.floor((1800 * fsReal) / 4096);
  for (let b = 0; b < blocks; b++) {
    const frame = b * 4096;
    const trueMs = (frame / fsReal) * 1000;
    cal.addPoint(frame, trueMs + rnd() * 6, 0);
  }
  const est = cal.estimate();
  check('estimación disponible', !!est);
  if (est) {
    check('ppm recuperado', Math.abs(est.ppm - TRUE_PPM) < 0.5,
      `${est.ppm.toFixed(3)} ppm (real ${TRUE_PPM})`);
    check('sigma plausible', est.sigmaPpm > 0 && est.sigmaPpm < 0.5,
      `±${est.sigmaPpm.toFixed(4)} ppm`);
    check('base temporal', Math.abs(est.seconds - 1800) < 5, `${est.seconds.toFixed(1)} s`);
  }

  cal.commit();
  check('factor aplicado', Math.abs(cal.ppm - TRUE_PPM) < 0.5);
  check('sesgo en s/día', Math.abs(cal.errorSecondsPerDay - TRUE_PPM * 86400 / 1e6) < 0.05,
    `${cal.errorSecondsPerDay.toFixed(2)} s/día`);

  // timeOf tiene que deshacer el error del cristal: 1 h de frames -> 1 h real.
  const oneHour = Math.round(fsReal * 3600);
  check('timeOf corrige la deriva', Math.abs(cal.timeOf(oneHour) - 3600) < 0.01,
    `${cal.timeOf(oneHour).toFixed(3)} s`);

  const cal2 = new ClockCalibration();
  check('se recupera de localStorage', cal2.load('dispositivo-de-prueba', 48000) &&
    Math.abs(cal2.ppm - TRUE_PPM) < 0.5);
  cal2.clear();
  check('borrado deja el factor a 1', cal2.factor === 1 && cal2.source === 'none');
}

/* Cada tarjeta lleva su propio cristal: dos dongles del mismo modelo se separan
   fácilmente 200 ppm. La corrección va por dispositivo o no vale para nada. */
console.log('\nCalibración por dispositivo');
{
  const feed = (cal, ppm, seconds = 300) => {
    const fsReal = 48000 * (1 + ppm / 1e6);
    const blocks = Math.floor((seconds * fsReal) / 4096);
    for (let b = 0; b < blocks; b++) {
      const frame = b * 4096;
      cal.addPoint(frame, (frame / fsReal) * 1000, 0);
    }
    return cal.commit();
  };

  const cal = new ClockCalibration();
  cal.start(48000, 'sonda-A', 'USB PnP Sound Device');
  feed(cal, 104.3);
  cal.start(48000, 'sonda-B', 'Otra tarjeta');
  feed(cal, -61.7);

  check('dos dispositivos, dos entradas', cal.list().length === 2);

  cal.load('sonda-A', 48000, 'USB PnP Sound Device');
  check('recupera A por id', cal.source === 'stored' && Math.abs(cal.ppm - 104.3) < 0.5,
    `${cal.ppm.toFixed(2)} ppm`);
  cal.load('sonda-B', 48000, 'Otra tarjeta');
  check('recupera B por id', cal.source === 'stored' && Math.abs(cal.ppm + 61.7) < 0.5,
    `${cal.ppm.toFixed(2)} ppm`);
  check('A no contamina a B', Math.abs(cal.ppm - 104.3) > 100);

  // Dispositivo nuevo sin nada guardado: no se aplica nada.
  cal.load('sonda-C', 48000, 'Tarjeta nunca vista');
  check('dispositivo desconocido queda sin calibrar', cal.source === 'none' && cal.factor === 1);
  check('sin candidata si el nombre no coincide', cal.candidate === null);

  // El deviceId cambió (datos del sitio borrados, otro puerto USB) pero el
  // nombre es el mismo y solo hay una guardada: se PROPONE, no se aplica sola.
  const r = cal.load('sonda-A-nuevo-id', 48000, 'USB PnP Sound Device');
  check('propone candidata por nombre', !r.applied && !!r.candidate);
  check('no la aplica por su cuenta', cal.source === 'none' && cal.factor === 1);
  cal.acceptCandidate();
  check('al aceptarla se aplica', Math.abs(cal.ppm - 104.3) < 0.5, `${cal.ppm.toFixed(2)} ppm`);
  check('se reclava y no duplica', cal.list().length === 2 &&
    cal.list().some((i) => i.deviceId === 'sonda-A-nuevo-id') &&
    !cal.list().some((i) => i.deviceId === 'sonda-A'));

  // Dos unidades del mismo modelo, ambas calibradas: el nombre ya no desempata,
  // así que no se propone ninguna. Aplicar la de otra unidad sería un error de
  // hasta 200 ppm.
  cal.start(48000, 'gemela-1', 'Dongle gemelo');
  feed(cal, 90);
  cal.start(48000, 'gemela-2', 'Dongle gemelo');
  feed(cal, -80);
  cal.load('gemela-3', 48000, 'Dongle gemelo');
  check('nombre ambiguo: no propone nada', cal.candidate === null && cal.source === 'none');

  cal.remove('gemela-1'); cal.remove('gemela-2');
  check('borrado quita la entrada', !cal.list().some((i) => i.deviceId === 'gemela-1'));
}

/* Reabrir la captura crea un AudioContext nuevo y currentFrame vuelve a cero:
   una medición a caballo entre los dos tramos da un resultado sin sentido. */
console.log('\nAbortar la medición al reabrir la captura');
{
  const cal = new ClockCalibration();
  cal.start(48000, 'sonda-X', 'X');
  const fsReal = 48000 * (1 + 104.3 / 1e6);
  for (let b = 0; b < 900; b++) cal.addPoint(b * 4096, ((b * 4096) / fsReal) * 1000, 0);
  check('hay medición en curso', cal.running && cal.n > 800);

  const wasRunning = cal.abort();
  check('abort() informa de que la había', wasRunning === true);
  check('abort() vacía la medición', !cal.running && cal.n === 0);

  // load() aborta por su cuenta: es el camino real cuando se cambia de equipo.
  cal.start(48000, 'sonda-X', 'X');
  for (let b = 0; b < 900; b++) cal.addPoint(b * 4096, ((b * 4096) / fsReal) * 1000, 0);
  cal.load('sonda-Y', 48000, 'Y');
  check('cambiar de dispositivo descarta la medición', !cal.running && cal.n === 0);
  check('y no la atribuye al nuevo', cal.source === 'none');
}

/* La duración recomendada en la interfaz sale de aquí, no de una intuición.
   La incertidumbre de una pendiente por mínimos cuadrados cae como D^1.5
   (D^0.5 por el número de puntos, D por el brazo de palanca temporal). */
console.log('\nPrecisión de la calibración frente a la duración');
{
  const NOMINAL = 48000, TRUE_PPM = 104.3;
  const fsReal = NOMINAL * (1 + TRUE_PPM / 1e6);
  const measure = (seconds, seed) => {
    const cal = new ClockCalibration();
    cal.start(NOMINAL, 'sweep');
    let s = seed >>> 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const blocks = Math.floor((seconds * fsReal) / 4096);
    for (let b = 0; b < blocks; b++) {
      const frame = b * 4096;
      cal.addPoint(frame, (frame / fsReal) * 1000 + rnd() * 6, 0); // jitter 0-6 ms
    }
    return cal.estimate();
  };
  const avgSigma = (D) => {
    let acc = 0;
    for (let k = 0; k < 5; k++) acc += measure(D, 7 + k * 977).sigmaPpm;
    return acc / 5;
  };

  const s120 = avgSigma(120), s300 = avgSigma(300), s1800 = avgSigma(1800);

  // Las dos constantes que gobiernan la interfaz (CAL_MIN_SECONDS = 120,
  // CAL_GOOD_SECONDS = 300) y lo que promete el README.
  check('2 min ≤ ±0,15 s/día', s120 * 0.0864 < 0.15, `±${(s120 * 0.0864).toFixed(3)} s/día`);
  check('5 min ≤ ±0,05 s/día', s300 * 0.0864 < 0.05, `±${(s300 * 0.0864).toFixed(3)} s/día`);

  // sigma ~ D^-1.5: al multiplicar por 15 la duración, cae ~58x.
  const ratio = s120 / s1800;
  check('escala como D^-1.5', Math.abs(ratio - Math.pow(15, 1.5)) / Math.pow(15, 1.5) < 0.1,
    `${ratio.toFixed(1)}x al pasar de 2 a 30 min (teoría ${Math.pow(15, 1.5).toFixed(1)}x)`);
}

/* ------------------------------------------------------ dibujado ------- */

const { PaperTape } = await import('../js/ui/paper.js');
const { TimeSeries } = await import('../js/ui/charts.js');
const { T } = await import('../js/ui/theme.js');

console.log('\nRutas de dibujado');
{
  const c = makeCanvas(460, 560);
  const tape = new PaperTape(c);
  let threw = null;
  try { tape.draw(); } catch (e) { threw = e; }
  check('cinta sin datos', !threw, threw ? threw.message : '');

  const pts = [];
  for (let i = 0; i < 400; i++) {
    // Fase que deriva y se sale del rango: ejercita el envolvente.
    pts.push({ t: i * 0.125, i, phase: i * 0.12 + (i % 2 ? 0.25 : -0.25) });
  }
  tape.setPoints(pts);
  threw = null;
  try { tape.draw(); } catch (e) { threw = e; }
  check('cinta con 400 tics', !threw, threw ? threw.message : '');
  check('cinta dibuja algo', c.calls.count > 100, `${c.calls.count} llamadas al contexto`);

  tape.cursor = { x: 200, y: 100 };
  threw = null;
  try { tape.draw(); } catch (e) { threw = e; }
  check('cinta con cursor', !threw, threw ? threw.message : '');

  for (const range of [2.5, 5, 10]) {
    tape.halfRange = range;
    try { tape.draw(); } catch (e) { check(`cinta rango ±${range}`, false, e.message); }
  }
  check('cinta en los tres rangos', true);
}

{
  const c = makeCanvas(700, 148);
  const ch = new TimeSeries(c, { title: 'Marcha', unit: 's/día', color: T.s1, decimals: 1, symmetric: true });
  let threw = null;
  try { ch.draw(); } catch (e) { threw = e; }
  check('gráfico vacío', !threw, threw ? threw.message : '');

  for (let i = 0; i < 600; i++) ch.push(i, 8 + 3 * Math.sin(i / 25));
  threw = null;
  try { ch.draw(); } catch (e) { threw = e; }
  check('gráfico con 600 puntos', !threw, threw ? threw.message : '');

  ch.cursor = { x: 400, y: 60 };
  threw = null;
  try { ch.draw(); } catch (e) { threw = e; }
  check('gráfico con cursor', !threw, threw ? threw.message : '');

  const banded = new TimeSeries(makeCanvas(700, 148),
    { title: 'Amplitud', unit: '°', color: T.s3, decimals: 0, band: { lo: 270, hi: 315 } });
  for (let i = 0; i < 200; i++) banded.push(i, 285 + 5 * Math.cos(i / 12));
  threw = null;
  try { banded.draw(); } catch (e) { threw = e; }
  check('gráfico con zona de referencia', !threw, threw ? threw.message : '');

  // Serie constante: rango cero, el caso que rompe los autoescalados ingenuos.
  const flat = new TimeSeries(makeCanvas(700, 148), { title: 'Batida', unit: 'ms', color: T.s2, decimals: 2 });
  for (let i = 0; i < 50; i++) flat.push(i, 0.25);
  threw = null;
  try { flat.draw(); } catch (e) { threw = e; }
  check('gráfico con serie constante', !threw, threw ? threw.message : '');

  // Un solo punto.
  const one = new TimeSeries(makeCanvas(700, 148), { title: 'X', unit: '', color: T.s1 });
  one.push(0, 5);
  threw = null;
  try { one.draw(); } catch (e) { threw = e; }
  check('gráfico con un solo punto', !threw, threw ? threw.message : '');
}

/* El logotipo viene en negro sobre transparente: sobre la cabecera oscura no se
   vería. Va inline, separado en icono y palabra, y con currentColor en ambos
   grupos para que el tema los coloree por separado sin tocar el SVG. */
console.log('\nLogotipo y favicon');
{
  const fs = await import('node:fs');
  const url = (f) => new URL(f, import.meta.url);
  const html = fs.readFileSync(url('../index.html'), 'utf8');
  const css = fs.readFileSync(url('../css/style.css'), 'utf8');

  const inline = html.match(/<svg class="logo"[\s\S]*?<\/svg>/);
  check('el logotipo va inline en la cabecera', !!inline);
  if (inline) {
    const svg = inline[0];
    const groups = [...svg.matchAll(/<g class="(mark|word)"[^>]*fill="currentColor"/g)];
    check('icono y palabra van en grupos separados', groups.length === 2,
      groups.map((g) => g[1]).join(', '));
    check('los 23 trazados siguen ahí',
      [...svg.matchAll(/<path /g)].length === 23,
      `${[...svg.matchAll(/<path /g)].length}`);
    check('no arrastra el negro del fichero', !/#000000/i.test(svg));
    check('no trae scripts ni referencias externas',
      !/<script|<image|xlink:href|https?:/i.test(svg));
    check('lo ignoran los lectores de pantalla', svg.includes('aria-hidden="true"'));
    check('conserva la proporción original', svg.includes('viewBox="0 0 1983 793"'));
  }
  check('el CSS colorea cada tinta',
    /\.logo \.mark \{[^}]*var\(--accent\)/.test(css) &&
    /\.logo \.word \{[^}]*var\(--ink\)/.test(css));
  check('el nombre queda accesible aparte',
    /<span class="sr-only" data-i18n="app.title">/.test(html));
  check('la clase sr-only existe en el CSS', css.includes('.sr-only'));

  const fav = fs.readFileSync(url('../assets/favicon.svg'), 'utf8');
  check('el favicon existe y es cuadrado', fav.includes('viewBox="0 0 512 512"'));
  check('el favicon lleva fondo propio', /<rect[^>]*fill="#1d2351"/.test(fav));
  check('el favicon usa solo el icono, no la palabra',
    [...fav.matchAll(/<path /g)].length === 11,
    `${[...fav.matchAll(/<path /g)].length} trazados`);
  check('hay respaldo PNG para quien no lea SVG',
    fs.existsSync(url('../assets/favicon.png')));
  check('los tres enlaces del favicon están en el HTML',
    html.includes('rel="icon"') && html.includes('rel="alternate icon"') &&
    html.includes('rel="apple-touch-icon"'));
}

/* La ayuda contextual solo sirve si está completa y dice algo. */
console.log('\nAyuda contextual');
{
  const fs = await import('node:fs');
  const i18n = await import('../js/i18n.js');
  const { t, setLang, keysOf } = i18n;

  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const usedKeys = [
    ...[...html.matchAll(/data-info="([^"]+)"/g)].map((m) => m[1]),
    ...[...app.matchAll(/'(info\.[a-zA-Z]+)'/g)].map((m) => m[1]),
  ];
  const used = new Set(usedKeys);
  const declared = keysOf('es').filter((k) => k.startsWith('info.'));

  check('hay botones de ayuda en el marcado',
    [...html.matchAll(/class="info"/g)].length >= 8,
    `${[...html.matchAll(/class="info"/g)].length} en index.html`);

  const unknown = [...used].filter((k) => !declared.includes(k));
  check('toda clave de ayuda usada existe', unknown.length === 0, unknown.join(', '));
  const orphan = declared.filter((k) => k !== 'info.more' && !used.has(k));
  check('no hay textos de ayuda huérfanos', orphan.length === 0, orphan.join(', '));

  // Un texto de ayuda de una línea no explica nada; el objetivo es enseñar.
  for (const lang of ['es', 'en']) {
    setLang(lang, { persist: false });
    const brief = declared.filter((k) => k !== 'info.more' && t(k).length < 120);
    check(`los textos de ${lang} explican de verdad`, brief.length === 0, brief.join(', '));
  }
  setLang('es', { persist: false });

  // Los conceptos que un novato no puede adivinar tienen que estar cubiertos.
  for (const k of ['info.rate', 'info.amplitude', 'info.beat', 'info.bph',
                   'info.delta', 'info.drop', 'info.tape', 'info.lift']) {
    check(`cubierto: ${k.slice(5)}`, used.has(k));
  }
}

/* La paleta no es cuestión de gusto: cada papel se asignó midiendo, y esta
   prueba fija ese contrato para que un retoque futuro no lo rompa en silencio. */
console.log('\nPaleta del tema');
{
  const fs = await import('node:fs');
  const { T } = await import('../js/ui/theme.js');

  const srgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  const lum = (h) => { const c = srgb(h).map(lin); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const contrast = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const oklab = (h) => {
    const [r, g, b] = srgb(h).map(lin);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s2 = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s2,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s2,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s2];
  };
  const deltaE = (a, b) => {
    const [x, y] = [oklab(a), oklab(b)];
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) * 100;
  };

  const PALETTE = ['#4e598c', '#ffffff', '#f9c784', '#fcaf58', '#ff8c42'];
  const used = new Set(Object.values(T).map((v) => String(v).toLowerCase()));
  const absent = PALETTE.filter((c) => !used.has(c));
  check('los cinco colores dados están en el tema', absent.length === 0, absent.join(', '));

  // Texto: 4,5:1. Marcas de datos: 3:1.
  for (const [name, hex] of [['ink', T.ink], ['ink2', T.ink2], ['muted', T.muted]]) {
    const c = contrast(hex, T.surface);
    check(`${name} legible como texto`, c >= 4.5, `${c.toFixed(2)}:1`);
  }
  // El índigo dado (#4e598c) es EJE, no marca: 2,2:1 es lo que se busca ahí, y
  // por eso no entra en esta lista.
  for (const [name, hex] of [['s1', T.s1], ['s2', T.s2], ['s3', T.s3], ['accent', T.accent],
                             ['good', T.good], ['warning', T.warning],
                             ['serious', T.serious], ['critical', T.critical]]) {
    const c = contrast(hex, T.surface);
    check(`${name} visible como marca`, c >= 3, `${c.toFixed(2)}:1`);
  }

  // La cinta es la única gráfica con dos series superpuestas: su par tiene que
  // estar muy por encima del suelo de 15, no rozarlo.
  const tape = deltaE(T.s1, T.s2);
  check('el par de la cinta separa de sobra', tape >= 25, `ΔE ${tape.toFixed(1)}`);

  // El óxido da 3,2:1: vale como marca y no como texto. Que nadie lo use para
  // pintar letras.
  const css = fs.readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
  check('el eje no se usa nunca como color de texto',
    !/color:\s*var\(--axis\)/.test(css));
  check('la superficie se distingue del plano', contrast(T.surface, T.plane) > 1.1,
    `${contrast(T.surface, T.plane).toFixed(2)}:1`);
}

/* Interfaz bilingüe. Lo que se comprueba no es la traducción -eso es criterio-
   sino que no haya huecos: una clave sin traducir se ve en pantalla. */
console.log('\nIdioma');
{
  const fs = await import('node:fs');
  const i18n = await import('../js/i18n.js');
  const { t, setLang, keysOf, langs, nf, signed, csvSep } = i18n;

  const [es, en] = langs().map(keysOf);
  check('los dos idiomas están declarados', langs().join(',') === 'es,en');
  check('mismo número de claves', es.length === en.length, `${es.length}`);
  const missing = es.filter((k) => !en.includes(k));
  const extra = en.filter((k) => !es.includes(k));
  check('sin claves sin traducir al inglés', missing.length === 0, missing.join(', '));
  check('sin claves sobrantes en inglés', extra.length === 0, extra.join(', '));

  // Ninguna traducción puede quedarse vacía ni conservar el texto español por
  // descuido en cadenas largas.
  setLang('en', { persist: false });
  const empty = en.filter((k) => !String(t(k)).trim());
  check('ninguna traducción vacía', empty.length === 0, empty.join(', '));

  // Los parámetros {x} tienen que coincidir en ambos idiomas o la frase inglesa
  // saldría con un hueco sin rellenar.
  const params = (k, lang) => {
    setLang(lang, { persist: false });
    return [...String(t(k)).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  };
  const mismatched = es.filter((k) => params(k, 'es') !== params(k, 'en'));
  check('los parámetros coinciden entre idiomas', mismatched.length === 0, mismatched.join(', '));

  // Toda clave que use el código debe existir; una clave suelta se ve en pantalla.
  const sources = ['../js/app.js', '../js/positions.js', '../js/ui/charts.js']
    .map((f) => fs.readFileSync(new URL(f, import.meta.url), 'utf8')).join('\n');
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const used = new Set([
    ...[...sources.matchAll(/\bt\(\s*'([a-zA-Z][\w.]*)'/g)].map((m) => m[1]),
    ...[...sources.matchAll(/t\(`([a-z]+)\.\$\{[^}]+\}`\)/g)].map(() => null).filter(Boolean),
    ...[...html.matchAll(/data-i18n[a-z-]*="([^"]+)"/g)].map((m) => m[1]),
  ]);
  const unknown = [...used].filter((k) => !es.includes(k));
  check('todas las claves usadas existen', unknown.length === 0, unknown.join(', '));
  check('el HTML usa claves de verdad', [...used].some((k) => k.startsWith('tile.')));

  // El formato numérico sigue al idioma, y con él el separador del CSV: un
  // Excel en español espera `;` porque la coma ya es el decimal.
  setLang('es', { persist: false });
  check('español usa coma decimal', nf(4.25, 2) === '4,25', nf(4.25, 2));
  check('español separa el CSV con ;', csvSep() === ';');
  check('el signo se antepone', signed(4.2, 1) === '+4,2', signed(4.2, 1));
  setLang('en', { persist: false });
  check('inglés usa punto decimal', nf(4.25, 2) === '4.25', nf(4.25, 2));
  check('inglés separa el CSV con ,', csvSep() === ',');
  setLang('es', { persist: false });
}

/* El bloque de posiciones es donde vive el trabajo real: el diagnóstico está en
   las diferencias entre posiciones, no en ninguna lectura suelta. */
console.log('\nSesión por posiciones');
{
  const { PositionSession, POSITIONS, judgeDelta, judgeDrop, posCode } =
    await import('../js/positions.js');

  const s = new PositionSession();
  check('arranca vacía', s.isEmpty && s.summary() === null);

  // Se capturan desordenadas a propósito.
  s.capture('crownDown', { rate: -6.2, amplitude: 251, beatError: 0.31 });
  s.capture('dialUp', { rate: 4.1, amplitude: 288, beatError: 0.22 });
  s.capture('dialDown', { rate: 2.8, amplitude: 284, beatError: 0.25 });
  s.capture('crownLeft', { rate: -1.4, amplitude: 259, beatError: 0.29 });

  check('cuenta las capturadas', s.count === 4);
  check('las devuelve en orden canónico',
    s.entries().map((e) => e.code).join(',') === 'EA,EB,CB,CI',
    s.entries().map((e) => e.code).join(','));

  const sum = s.summary();
  check('delta = máxima menos mínima', Math.abs(sum.delta - (4.1 - -6.2)) < 1e-9,
    `${sum.delta.toFixed(1)} s/día`);
  check('identifica los extremos', sum.max.code === 'EA' && sum.min.code === 'CB');

  // La caída horizontal->vertical: media de EA/EB contra media de las de corona.
  check('media horizontal', Math.abs(sum.horiz - 286) < 1e-9, `${sum.horiz}°`);
  check('media vertical', Math.abs(sum.vert - 255) < 1e-9, `${sum.vert}°`);
  check('caída de amplitud', Math.abs(sum.drop - 31) < 1e-9, `${sum.drop}°`);
  check('error de batida máximo', Math.abs(sum.beatMax - 0.31) < 1e-9);

  // Sin verticales no hay caída que calcular.
  const h = new PositionSession();
  h.capture('dialUp', { rate: 1, amplitude: 290, beatError: 0.1 });
  h.capture('dialDown', { rate: 2, amplitude: 288, beatError: 0.1 });
  check('sin verticales, no hay caída', h.summary().drop === null);

  // Una amplitud que no se resolvió no debe contaminar la media.
  const n = new PositionSession();
  n.capture('dialUp', { rate: 1, amplitude: 290, beatError: 0.1 });
  n.capture('crownUp', { rate: 2, amplitude: null, beatError: 0.1 });
  check('la amplitud sin resolver se excluye', n.summary().vert === null);

  // Una sola posición: hay resumen, pero el delta no significa nada.
  const one = new PositionSession();
  one.capture('dialUp', { rate: 5, amplitude: 280, beatError: 0.2 });
  check('con una sola posición el delta es 0', one.summary().delta === 0);
  check('y el juicio lo dice', judgeDelta(0, 1).text.includes('dos posiciones'));

  check('delta 8 s/día pasa criterio de cronómetro', judgeDelta(8, 5).level === 'good');
  check('delta 40 s/día manda revisar', judgeDelta(40, 5).level === 'serious');
  check('caída de 20° es normal', judgeDrop(20).level === 'good');
  check('caída de 70° no lo es', judgeDrop(70).level === 'serious');

  // Exportación: separador ;, coma decimal y comillas escapadas, que es lo que
  // espera un Excel en español.
  const csv = s.toCsv({ reference: 'Seiko "SKX"; nº 1', bph: 21600, liftAngle: 52 });
  const lines = csv.split('\n');
  check('el CSV escapa comillas y separadores',
    lines.some((l) => l.includes('"Seiko ""SKX""; nº 1"')));
  check('el CSV usa coma decimal', csv.includes('4,1') && csv.includes('0,22'));
  check('el CSV trae una fila por posición',
    POSITIONS.filter((p) => s.get(p.key)).every((p) => csv.includes(`;${posCode(p.key)};`)));
  check('el CSV cierra con el delta', /Delta \(EA-CB\);10,3/.test(csv));

  const txt = s.toText({ reference: 'X' });
  check('el texto lleva la tabla y el resumen',
    txt.includes('Esfera arriba') && txt.includes('Delta:') && txt.includes('Amplitud:'));
  check('el texto usa coma decimal, como el CSV',
    txt.includes('+4,1') && txt.includes('10,3') && !/\d\.\d/.test(txt));

  // Cambiar de idioma a media sesión reetiqueta, no pierde: la sesión se indexa
  // por la clave estable, no por el código, que sí cambia (EA -> DU).
  const i18n = await import('../js/i18n.js');
  i18n.setLang('en', { persist: false });
  check('el cambio de idioma conserva las medidas', s.count === 4);
  check('y reetiqueta los códigos',
    s.entries().map((e) => e.code).join(',') === 'DU,DD,CD,CL',
    s.entries().map((e) => e.code).join(','));
  check('y los nombres', s.entries()[0].name === 'Dial up', s.entries()[0].name);
  const csvEn = s.toCsv({ reference: 'a,b' });
  check('el CSV inglés separa con coma y escapa', csvEn.includes('"a,b"'));
  check('el CSV inglés usa punto decimal', /(^|,)4\.1(,|$)/m.test(csvEn));
  i18n.setLang('es', { persist: false });
  check('al volver, los códigos también', s.entries()[0].code === 'EA');

  s.clear('dialUp');
  check('se puede borrar una posición suelta', s.count === 3 && s.get('dialUp') === null);
  s.reset();
  check('reset la vacía entera', s.isEmpty);
}

/* Regresión de un fallo real: #cal-banner llevaba el atributo `hidden` y el CSS
   definía `.banner { display: flex }`. Una regla de autor gana a la hoja del
   navegador, así que el display:none que aporta [hidden] quedaba anulado y el
   elemento no se ocultaba nunca por mucho que el JS pusiera hidden = true. */
console.log('\nOcultación por atributo [hidden]');
{
  const fs = await import('node:fs');
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');

  // Los comentarios y los @media rompen un troceado ingenuo: sin quitarlos, el
  // selector capturado arrastra el comentario anterior y no casa con nada.
  const clean = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@media[^{]*\{/g, '');
  const rules = [...clean.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .map((m) => ({ sel: m[1].trim(), body: m[2] }));

  const guard = /\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/.test(clean);
  check('el CSS trae la guarda [hidden] { display: none !important }', guard);

  // Elementos que el JS oculta con el atributo, y sus selectores.
  const hiddenEls = [...html.matchAll(/<([a-z]+)\b([^>]*?)\/?>/g)]
    .filter((m) => /\shidden(\s|\/|$)/.test(m[2]))
    .map((m) => {
      const id = (m[2].match(/id="([^"]+)"/) || [])[1];
      const cls = (m[2].match(/class="([^"]+)"/) || [])[1];
      return { id, classes: cls ? cls.split(/\s+/) : [] };
    });
  check('hay elementos que se ocultan con [hidden]', hiddenEls.length > 0,
    `${hiddenEls.length} encontrados`);

  // Cuáles de ellos tienen una regla de autor que fija `display` y, por tanto,
  // dependen de la guarda para poder ocultarse.
  const atRisk = [];
  for (const el of hiddenEls) {
    const selectors = [...el.classes.map((c) => '.' + c), ...(el.id ? ['#' + el.id] : [])];
    for (const r of rules) {
      if (/\[hidden\]/.test(r.sel)) continue;
      if (!/(^|[^-\w])display\s*:/.test(r.body)) continue;
      if (selectors.some((sel) => r.sel.split(',').some((part) => part.trim() === sel))) {
        atRisk.push(`${el.id || el.classes.join('.')} (por «${r.sel}»)`);
      }
    }
  }
  // Que existan no es el fallo: el fallo sería que la guarda no estuviera. Pero
  // si esta lista sale vacía es que el cruce no está mirando bien, y entonces la
  // prueba no protege de nada.
  check('el cruce localiza los que dependen de la guarda', atRisk.length > 0,
    atRisk.join(', ') || 'ninguno — el análisis del CSS no está funcionando');
}

console.log(`\n${failures === 0 ? 'Todas las comprobaciones pasan.' : `${failures} comprobaciones fallan.`}`);
process.exit(failures ? 1 : 0);
