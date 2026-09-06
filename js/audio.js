/**
 * Entrada de audio.
 *
 * Dos detalles que no son opcionales:
 *
 *  - Hay que desactivar echoCancellation, noiseSuppression y autoGainControl.
 *    Con ellos activos el navegador aplasta justamente los transitorios del
 *    escape, y la amplitud (que se calcula midiendo el hueco entre dos de esos
 *    transitorios) sale sin sentido.
 *  - El AudioContext se crea a la frecuencia nativa del dispositivo para que
 *    CoreAudio no interponga un remuestreo entre la tarjeta y el grafo.
 *
 * `latencyHint: 'playback'` pide buffers grandes: aquí no hay ningún requisito
 * de latencia y los buffers grandes reducen los cortes.
 */
export const PREFERRED_RATE = 48000;

export async function requestPermission() {
  const s = await navigator.mediaDevices.getUserMedia({ audio: true });
  s.getTracks().forEach((t) => t.stop());
}

/** ¿Ya hay permiso? Si lo hay, enumerateDevices() devuelve etiquetas. */
export async function hasPermission() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.some((d) => d.kind === 'audioinput' && d.label);
}

export async function listInputs() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default');
}

/** Puntúa dispositivos para preseleccionar el que parece una sonda de timegrapher. */
export function guessProbe(devices) {
  const hints = [/pnp sound/i, /c-media/i, /usb.*audio/i, /audio.*usb/i, /usb/i];
  for (const re of hints) {
    const hit = devices.find((d) => re.test(d.label || ''));
    if (hit) return hit;
  }
  return devices[0] || null;
}

export class AudioCapture {
  /** @param {(msg:{samples:Float32Array,startFrame:number,gapFrames:number,gapCount:number}, arrivalMs:number)=>void} onBlock */
  constructor(onBlock) {
    this.onBlock = onBlock;
    this.ctx = null;
    this.stream = null;
    this.node = null;
    this.sink = null;
    this.source = null;
  }

  get sampleRate() { return this.ctx ? this.ctx.sampleRate : PREFERRED_RATE; }
  get active() { return !!this.ctx && this.ctx.state === 'running'; }

  async start(deviceId, blockSize = 4096) {
    await this.stop();

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
        sampleRate: PREFERRED_RATE,
      },
    });

    const track = this.stream.getAudioTracks()[0];
    const settings = track.getSettings ? track.getSettings() : {};
    const rate = settings.sampleRate || PREFERRED_RATE;

    this.ctx = new AudioContext({ sampleRate: rate, latencyHint: 'playback' });
    // Resuelta contra la URL de ESTE módulo, no contra la del documento: así
    // funciona igual servida en la raíz que bajo un subpath (GitHub Pages sirve
    // el proyecto en /<repo>/), y no depende de la barra final ni de un <base>.
    await this.ctx.audioWorklet.addModule(
      new URL('./worklet/capture-processor.js', import.meta.url).href
    );

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'capture-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { blockSize },
    });
    this.node.port.onmessage = (e) => this.onBlock(e.data, performance.now());

    // Un nodo de worklet solo se bombea si su salida llega al destino; con
    // ganancia cero para no devolver el tic por los altavoces.
    this.sink = this.ctx.createGain();
    this.sink.gain.value = 0;
    this.source.connect(this.node);
    this.node.connect(this.sink);
    this.sink.connect(this.ctx.destination);

    // No se espera a resume() indefinidamente. Si el permiso se acaba de
    // conceder, el diálogo ha consumido la activación de usuario del clic y
    // Chrome deja la promesa PENDIENTE para siempre en vez de rechazarla: se
    // colgaría aquí sin lanzar nada. Se sigue adelante y se informa del estado.
    if (this.ctx.state !== 'running') {
      await Promise.race([
        this.ctx.resume().catch(() => {}),
        new Promise((r) => setTimeout(r, 700)),
      ]);
    }

    return {
      sampleRate: this.ctx.sampleRate,
      label: track.label,
      requestedRate: PREFERRED_RATE,
      state: this.ctx.state,
      settings,
    };
  }

  /** Reintento de arranque sobre un gesto de usuario posterior. */
  async resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume().catch(() => {});
    }
    return this.ctx ? this.ctx.state : 'closed';
  }

  get state() { return this.ctx ? this.ctx.state : 'closed'; }

  async stop() {
    if (this.node) { this.node.port.onmessage = null; this.node.disconnect(); this.node = null; }
    if (this.source) { this.source.disconnect(); this.source = null; }
    if (this.sink) { this.sink.disconnect(); this.sink = null; }
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
    if (this.ctx) { await this.ctx.close().catch(() => {}); this.ctx = null; }
  }
}
