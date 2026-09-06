/**
 * Captura de audio para el timegrapher.
 *
 * Responsabilidades, deliberadamente mínimas para que el hilo de audio nunca
 * se retrase:
 *   - acumular muestras en bloques grandes (menos mensajes que un quantum de 128)
 *   - marcar cada bloque con su índice de frame absoluto (`currentFrame`), que
 *     es lo que permite calibrar el reloj de muestreo contra el del sistema
 *   - detectar huecos: si `process()` se salta un quantum, `currentFrame` avanza
 *     más de lo esperado. Un bloque nunca puede cruzar un hueco, porque el DSP
 *     asume continuidad temporal dentro del bloque.
 */
class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.blockSize = opts.blockSize || 4096;
    this.buf = new Float32Array(this.blockSize);
    this.n = 0;
    this.startFrame = 0;
    this.expected = -1;
    this.gapFrames = 0;
    this.gapCount = 0;
  }

  /** Envía el bloque acumulado. `discard` lo tira sin enviar (bloque roto). */
  flush(discard) {
    if (this.n > 0 && !discard) {
      const out = this.buf.slice(0, this.n);
      this.port.postMessage(
        {
          samples: out,
          startFrame: this.startFrame,
          gapFrames: this.gapFrames,
          gapCount: this.gapCount,
        },
        [out.buffer]
      );
    }
    this.n = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const ch = input && input[0];
    if (!ch || ch.length === 0) return true;

    // Hueco: el reloj del contexto avanzó más de lo que hemos procesado.
    if (this.expected >= 0 && currentFrame !== this.expected) {
      this.gapFrames += currentFrame - this.expected;
      this.gapCount++;
      this.flush(true); // el bloque parcial ya no es contiguo
    }
    this.expected = currentFrame + ch.length;

    let read = 0;
    while (read < ch.length) {
      if (this.n === 0) this.startFrame = currentFrame + read;
      const take = Math.min(ch.length - read, this.blockSize - this.n);
      this.buf.set(ch.subarray(read, read + take), this.n);
      this.n += take;
      read += take;
      if (this.n === this.blockSize) this.flush(false);
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
