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

/** Un factor plausible: ningún cristal de audio se va más de un 1%. */
const usable = (r) => !!r && isFinite(r.factor) && Math.abs(r.factor - 1) < 0.01;

export class ClockCalibration {
  constructor() {
    this.nominal = 48000;
    this.deviceId = null;
    this.label = '';
    this.factor = 1;       // fs_real / fs_nominal
    this.source = 'none';  // 'none' | 'stored' | 'measured'
    this.storedAt = null;
    this.sigmaPpm = NaN;
    this.lastSeconds = 0;
    /** Calibración de otro deviceId con la misma etiqueta, a la espera de que
     *  el usuario confirme que es la misma sonda. Ver load(). */
    this.candidate = null;
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

  start(nominal, deviceId, label = '') {
    this.nominal = nominal;
    this.deviceId = deviceId;
    if (label) this.label = label;
    this.resetRun();
    this.running = true;
  }
  stop() { this.running = false; }

  /**
   * Descarta la medición en curso.
   *
   * Obligatorio siempre que se reabra la captura: el eje de frames pertenece al
   * AudioContext anterior y el nuevo empieza otra vez en cero, así que los
   * puntos acumulados y los nuevos no viven en la misma recta. Sin esto la
   * regresión mezcla dos tramos y devuelve un disparate sin avisar de nada.
   */
  abort() {
    const wasRunning = this.running;
    this.running = false;
    this.resetRun();
    return wasRunning;
  }

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
    this.lastSeconds = est.seconds;
    this.source = 'measured';
    this.storedAt = new Date().toISOString();
    this.candidate = null;
    this.save();
    return est;
  }

  clear() {
    this._forget();
    const all = readStore();
    if (this.deviceId) delete all[this.deviceId];
    writeStore(all);
  }

  _forget() {
    this.factor = 1;
    this.sigmaPpm = NaN;
    this.source = 'none';
    this.storedAt = null;
    this.lastSeconds = 0;
  }

  _adopt(rec, source) {
    this.factor = rec.factor;
    this.sigmaPpm = rec.sigmaPpm;
    this.storedAt = rec.storedAt;
    this.lastSeconds = rec.seconds || 0;
    this.source = source;
  }

  save() {
    if (!this.deviceId) return;
    const all = readStore();
    all[this.deviceId] = {
      factor: this.factor,
      nominal: this.nominal,
      sigmaPpm: this.sigmaPpm,
      storedAt: this.storedAt,
      label: this.label || '',
      seconds: this.lastSeconds,
    };
    writeStore(all);
  }

  /**
   * Recupera la corrección de ESTE dispositivo. Cada tarjeta lleva su propio
   * cristal —dos dongles del mismo modelo se separan fácilmente 200 ppm entre
   * sí—, así que la calibración es por dispositivo y nunca global.
   *
   * El problema es que `deviceId` no es un identificador duradero: es un hash
   * con sal por origen que cambia al borrar los datos del sitio, al revocar el
   * permiso, en algunos navegadores al cerrar la sesión, y a veces al cambiar de
   * puerto USB. Si el id no aparece pero hay UNA sola calibración guardada con
   * la misma etiqueta, se propone como candidata; NO se aplica sola, porque dos
   * unidades del mismo modelo comparten nombre y no comparten cristal.
   *
   * @returns {{applied: boolean, candidate: object|null}}
   */
  load(deviceId, nominal, label = '') {
    this.abort();
    this.deviceId = deviceId;
    this.nominal = nominal;
    this.label = label || '';
    this.candidate = null;
    this._forget();

    const all = readStore();
    if (usable(all[deviceId])) {
      this._adopt(all[deviceId], 'stored');
      return { applied: true, candidate: null };
    }

    if (this.label) {
      const hits = Object.entries(all).filter(([, r]) => usable(r) && r.label === this.label);
      if (hits.length === 1) {
        this.candidate = { deviceId: hits[0][0], rec: hits[0][1] };
        return { applied: false, candidate: this.candidate };
      }
    }
    return { applied: false, candidate: null };
  }

  /** Acepta la candidata: se reclava bajo el deviceId actual y se borra la vieja. */
  acceptCandidate() {
    if (!this.candidate) return false;
    const { deviceId: oldId, rec } = this.candidate;
    this._adopt(rec, 'stored');
    this.candidate = null;
    this.save();
    if (oldId !== this.deviceId) {
      const all = readStore();
      delete all[oldId];
      writeStore(all);
    }
    return true;
  }

  dismissCandidate() { this.candidate = null; }

  /** Todas las calibraciones guardadas, la más reciente primero. */
  list() {
    return Object.entries(readStore())
      .filter(([, r]) => usable(r))
      .map(([id, r]) => ({
        deviceId: id,
        label: r.label || 'dispositivo sin nombre',
        ppm: (r.factor - 1) * 1e6,
        sigmaPpm: r.sigmaPpm,
        storedAt: r.storedAt,
        seconds: r.seconds || 0,
        active: id === this.deviceId && this.source !== 'none',
      }))
      .sort((a, b) => String(b.storedAt).localeCompare(String(a.storedAt)));
  }

  remove(deviceId) {
    const all = readStore();
    delete all[deviceId];
    writeStore(all);
    if (deviceId === this.deviceId) this._forget();
  }
}

function readStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); }
  catch { return {}; }
}
function writeStore(obj) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(obj)); } catch { /* modo privado */ }
}
