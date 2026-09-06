/**
 * Calibración del reloj de muestreo.
 *
 * Toda la medida es una comparación del reloj contra el cristal de la tarjeta de
 * sonido. Un cristal barato como el de un CM108 se va ±50-100 ppm, y
 *
 *     100 ppm x 86400 s = 8,64 s/día
 *
 * de error puro de medida: más que toda la banda de tolerancia de un cronómetro
 * COSC. Sin corregir, la cifra de marcha en términos absolutos no significa nada.
 *
 * La corrección sale de comparar el contador de frames (exacto, viene del
 * worklet) con el reloj del sistema, que si el equipo está sincronizado por NTP
 * es bueno a bastante menos de 1 ppm sobre bases largas. Se hace por regresión
 * sobre todos los bloques y no con dos extremos, para que el jitter de entrega
 * de los mensajes se promedie.
 *
 * Solo afecta a la MARCHA. El error de batida es una diferencia (100 ppm sobre
 * 1 ms son 0,0001 ms) y la amplitud depende de dt/T, donde el factor se cancela.
 */
const STORE_KEY = 'timegrapher.clockCalibration.v1';
const MAX_POINTS = 200000;

export class ClockCalibration {
  constructor() {
    this.nominal = 48000;
    this.deviceId = null;
    this.factor = 1;       // fs_real / fs_nominal
    this.source = 'none';  // 'none' | 'stored' | 'measured'
    this.storedAt = null;
    this.sigmaPpm = NaN;
    this.resetRun();
  }

  resetRun() {
    this.x = new Float64Array(4096);   // segundos desde el inicio (reloj sistema)
    this.y = new Float64Array(4096);   // frames desde el inicio
    this.n = 0;
    this.x0 = NaN;
    this.f0 = NaN;
    this.gaps = 0;
    this.running = false;
  }

  get fsReal() { return this.nominal * this.factor; }
  get ppm() { return (this.factor - 1) * 1e6; }
  /** Error de marcha que introduciría la tarjeta sin corregir, en s/día. */
  get errorSecondsPerDay() { return this.ppm * 86400 / 1e6; }

  /** Segundos absolutos de un índice de frame, ya corregidos. */
  timeOf(frame) { return frame / this.fsReal; }

  start(nominal, deviceId) {
    this.nominal = nominal;
    this.deviceId = deviceId;
    this.resetRun();
    this.running = true;
  }
  stop() { this.running = false; }

  /** Un punto por bloque recibido: índice de frame + marca del reloj del sistema. */
  addPoint(startFrame, nowMs, gapCount) {
    if (!this.running) return;
    if (!isFinite(this.x0)) { this.x0 = nowMs; this.f0 = startFrame; }
    this.gaps = gapCount;
    if (this.n >= MAX_POINTS) return;
    if (this.n >= this.x.length) {
      const nx = new Float64Array(this.x.length * 2);
      const ny = new Float64Array(this.y.length * 2);
      nx.set(this.x); ny.set(this.y);
      this.x = nx; this.y = ny;
    }
    this.x[this.n] = (nowMs - this.x0) / 1000;
    this.y[this.n] = startFrame - this.f0;
    this.n++;
  }

  get elapsedSeconds() { return this.n > 1 ? this.x[this.n - 1] : 0; }

  /**
   * Regresión centrada de frames sobre segundos.
   * @returns {null|{fsReal:number, ppm:number, sigmaPpm:number, seconds:number, n:number}}
   */
  estimate() {
    const n = this.n;
    if (n < 200) return null;
    let mx = 0, my = 0;
    for (let i = 0; i < n; i++) { mx += this.x[i]; my += this.y[i]; }
    mx /= n; my /= n;
    let Sxx = 0, Sxy = 0;
    for (let i = 0; i < n; i++) {
      const dx = this.x[i] - mx;
      Sxx += dx * dx;
      Sxy += dx * (this.y[i] - my);
    }
    if (Sxx <= 0) return null;
    const slope = Sxy / Sxx; // frames por segundo real
    let ss = 0;
    for (let i = 0; i < n; i++) {
      const r = (this.y[i] - my) - slope * (this.x[i] - mx);
      ss += r * r;
    }
    const varRes = ss / Math.max(1, n - 2);
    const slopeSigma = Math.sqrt(varRes / Sxx);
    return {
      fsReal: slope,
      ppm: (slope / this.nominal - 1) * 1e6,
      sigmaPpm: (slopeSigma / this.nominal) * 1e6,
      seconds: this.x[n - 1],
      n,
    };
  }

  /** Fija la corrección medida y la guarda para este dispositivo. */
  commit() {
    const est = this.estimate();
    if (!est) return null;
    this.factor = est.fsReal / this.nominal;
    this.sigmaPpm = est.sigmaPpm;
    this.source = 'measured';
    this.storedAt = new Date().toISOString();
    this.save();
    return est;
  }

  clear() {
    this.factor = 1;
    this.sigmaPpm = NaN;
    this.source = 'none';
    this.storedAt = null;
    const all = readStore();
    if (this.deviceId) delete all[this.deviceId];
    writeStore(all);
  }

  save() {
    if (!this.deviceId) return;
    const all = readStore();
    all[this.deviceId] = {
      factor: this.factor,
      nominal: this.nominal,
      sigmaPpm: this.sigmaPpm,
      storedAt: this.storedAt,
    };
    writeStore(all);
  }

  load(deviceId, nominal) {
    this.deviceId = deviceId;
    this.nominal = nominal;
    const rec = readStore()[deviceId];
    if (rec && isFinite(rec.factor) && Math.abs(rec.factor - 1) < 0.01) {
      this.factor = rec.factor;
      this.sigmaPpm = rec.sigmaPpm;
      this.storedAt = rec.storedAt;
      this.source = 'stored';
      return true;
    }
    this.factor = 1;
    this.source = 'none';
    this.sigmaPpm = NaN;
    this.storedAt = null;
    return false;
  }
}

function readStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); }
  catch { return {}; }
}
function writeStore(obj) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(obj)); } catch { /* modo privado */ }
}
