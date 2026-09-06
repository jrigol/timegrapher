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
