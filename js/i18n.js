/**
 * Interfaz bilingüe español / inglés.
 *
 * Las claves son independientes del idioma, incluidas las de las posiciones:
 * los códigos cambian (EA/EB/CA en español, DU/DD/CU en inglés) pero la sesión
 * de medida se indexa por la clave estable, así que cambiar de idioma a media
 * sesión no pierde nada.
 *
 * El idioma arrastra también el formato numérico —coma decimal en español,
 * punto en inglés— y con él el separador del CSV: un Excel en español espera
 * `;` porque la coma ya es el decimal.
 */

export const LANGS = { es: 'Español', en: 'English' };
const STORE_KEY = 'timegrapher.lang';
const LOCALES = { es: 'es-ES', en: 'en-GB' };

const DICT = {
  es: {
    'app.title': 'Timegrapher',
    'app.start': 'Iniciar',
    'app.stop': 'Detener',
    'app.device': 'Dispositivo de entrada',
    'app.language': 'Idioma',
    'app.readings': 'Lecturas',
    'app.permissionHint': 'Concede permiso de micrófono para listar los dispositivos.',

    'tile.rate': 'Marcha',
    'tile.rateUnit': 's/día',
    'tile.amplitude': 'Amplitud',
    'tile.amplitudeUnit': 'grados',
    'tile.beat': 'Error de batida',
    'tile.beatUnit': 'ms',
    'tile.bph': 'Alternancias',
    'tile.bphUnit': 'bph',

    'chip.noSignal': 'sin señal',
    'chip.searching': 'buscando',
    'chip.rate.good': 'buena marcha',
    'chip.rate.warning': 'regulable',
    'chip.rate.serious': 'muy desviada',
    'chip.rate.critical': 'revisar reloj',
    'chip.amp.good': 'sana',
    'chip.amp.warning': 'aceptable',
    'chip.amp.serious': 'baja',
    'chip.amp.critical': 'muy baja',
    'chip.amp.unresolved': 'sin resolver',
    'chip.beat.good': 'centrado',
    'chip.beat.warning': 'aceptable',
    'chip.beat.serious': 'descentrado',
    'chip.beat.critical': 'muy descentrado',
    'chip.bph.detected': 'detectado',
    'chip.bph.manual': 'manual',

    'note.fitSigma': '±{v} (ajuste)',
    'note.uncalibrated': 'sin calibrar: hasta ±8,6 s/día de sesgo',
    'note.corrected': 'corregido {v} ppm',
    'note.liftCoverage': 'alzada {lift}° · {pct}% de tics resueltos',
    'note.dtOutOfRange': 'dt fuera de rango ({v} ms)',
    'note.beatsIn': '{n} batidas en {s} s',
    'note.bphRaw': 'bruto {v} · confianza {c}%',
    'note.bphNoFit': 'bruto {v}, sin encajar en la tabla',
    'note.bphNone': 'sin periodicidad clara',
    'note.bphMeasured': 'medido {v}',

    'pos.section': 'Posiciones',
    'pos.copy': 'Copiar',
    'pos.csv': 'CSV',
    'pos.clearAll': 'Vaciar',
    'pos.reference': 'Reloj o referencia',
    'pos.hint': 'Coloca el reloj y pulsa la posición (o su número, del 1 al 6). Mide sola en cuanto la lectura se estabiliza.',
    'pos.unmeasured': 'sin medir',
    'pos.measuring': 'midiendo',
    'pos.settling': 'estabilizando…',
    'pos.why.moved': 'movimiento detectado',
    'pos.why.noSignal': 'sin señal',
    'pos.why.filling': 'llenando la ventana',
    'pos.why.samples': 'reuniendo muestras',
    'pos.why.rate': 'marcha aún moviéndose ({v} s/día)',
    'pos.why.amp': 'amplitud aún moviéndose ({v}°)',
    'pos.captured': '{name}: {rate} s/día{amp} · {beat} ms. Capturado.',
    'pos.needCapture': 'Arranca la captura antes de medir posiciones.',
    'pos.empty': 'Sin posiciones medidas. El delta necesita al menos dos.',
    'pos.delta': 'Delta de marcha',
    'pos.deltaDetail': '{max} · {min} — {verdict}',
    'pos.drop': 'Caída de amplitud',
    'pos.dropDetail': 'horizontal {h}° · vertical {v}° — {verdict}',
    'pos.dropNeed': 'hacen falta una horizontal y una vertical',
    'pos.beatMax': 'Error de batida máximo',
    'pos.beatMaxDetail': 'en {n} de 6 posiciones',
    'pos.confirmClear': 'Se borrarán las {n} posiciones medidas. ¿Seguir?',
    'pos.copied': 'Tabla de posiciones copiada al portapapeles.',
    'pos.copyFailed': 'El navegador no ha dejado copiar. Usa CSV.',
    'pos.nothingToCopy': 'No hay posiciones que copiar.',
    'pos.nothingToExport': 'No hay posiciones que exportar.',
    'pos.keyHint': '{name} — tecla {n}',

    'pos.dialUp.name': 'Esfera arriba', 'pos.dialUp.code': 'EA',
    'pos.dialDown.name': 'Esfera abajo', 'pos.dialDown.code': 'EB',
    'pos.crownUp.name': 'Corona arriba', 'pos.crownUp.code': 'CA',
    'pos.crownDown.name': 'Corona abajo', 'pos.crownDown.code': 'CB',
    'pos.crownLeft.name': 'Corona izquierda', 'pos.crownLeft.code': 'CI',
    'pos.crownRight.name': 'Corona derecha', 'pos.crownRight.code': 'CD',

    'judge.delta.need': 'hacen falta al menos dos posiciones',
    'judge.delta.good': 'dentro de criterio de cronómetro',
    'judge.delta.warning': 'aceptable en un reloj corriente',
    'judge.delta.serious': 'revisar poise y pivotes',
    'judge.delta.critical': 'algo va mal',
    'judge.drop.good': 'normal',
    'judge.drop.warning': 'algo alta',
    'judge.drop.serious': 'pivotes o poise',

    'export.date': 'Fecha',
    'export.reference': 'Referencia',
    'export.bph': 'Alternancias',
    'export.lift': 'Ángulo de alzada',
    'export.calibration': 'Calibración',
    'export.none': '—',
    'export.uncalibrated': 'sin calibrar',
    'export.position': 'Posición',
    'export.code': 'Código',
    'export.rate': 'Marcha (s/día)',
    'export.amplitude': 'Amplitud (°)',
    'export.beat': 'Error de batida (ms)',
    'export.time': 'Hora',
    'export.deltaLabel': 'Delta',
    'export.dropLabel': 'Caída de amplitud H-V',
    'export.beatMaxLabel': 'Error de batida máximo',
    'export.tableHead': 'Posición              Marcha   Ampl.   Batida',
    'export.amplitudeLine': 'Amplitud: horizontal {h}° · vertical {v}° · caída {d}°',

    'tape.section': 'Cinta',
    'tape.tic': 'tic',
    'tape.tac': 'tac',
    'tape.range': 'Rango',
    'tape.span': 'Duración',
    'tape.alt': 'Traza de la cinta de papel',
    'tape.hint': 'La inclinación de las trazas es la marcha; su separación, el error de batida. Pasa el cursor para leer la posición en ms.',

    'chart.section': 'Evolución',
    'chart.window': 'Ventana',
    'chart.now': 'ahora',
    'chart.showData': 'Ver datos',
    'chart.hideData': 'Ocultar datos',
    'chart.caption': 'Últimas lecturas registradas',
    'chart.colTime': 'Hora',
    'chart.colRate': 'Marcha (s/día)',
    'chart.colAmp': 'Amplitud (°)',
    'chart.colBeat': 'Batida (ms)',

    'set.measure': 'Medida',
    'set.bph': 'Alternancias por hora',
    'set.auto': 'auto',
    'set.lift': 'Ángulo de alzada',
    'set.caliber': 'calibre…',
    'set.liftHelp': 'Dato del calibre, no medible desde el audio. Verifícalo en su ficha técnica.',
    'set.fitWindow': 'Ventana de ajuste',
    'set.fitWindowHelp': 'Más larga: más precisión, menos reactividad.',
    'set.probe': 'Sonda y detección',
    'set.band': 'Banda del filtro (Hz)',
    'set.tune': 'Ajustar',
    'set.bandHelp': '«Ajustar» escucha unos segundos y elige la banda con mejor relación tic/ruido.',
    'set.sens': 'Sensibilidad del detector',
    'set.sensNote': 'umbral = {k}× el suelo de ruido',
    'set.quality': 'Calidad de señal',
    'set.ampThr': 'Umbral de los ruidos del escape',
    'set.ampThrNote': '{v}% del pico del tic. Bájalo si la amplitud no se resuelve; súbelo si la reverberación de la caja la falsea.',
    'set.align': 'Refinado por plantilla',
    'set.alignOn': 'activo',
    'set.alignHelp': 'Correla cada tic contra la forma media en vez de usar solo el pico: reduce el ruido de la marcha.',
    'set.generic': 'Genérico',

    'quality.none': 'Sin señal.',
    'quality.good': 'Buena ({db} dB sobre el ruido){cov}',
    'quality.fair': 'Justa ({db} dB){cov}. Recolocar el reloj mejorará sobre todo la amplitud.',
    'quality.poor': 'Pobre ({db} dB){cov}. Asienta el reloj contra el sensor antes de fiarte de la amplitud.',
    'quality.coverage': ' · {pct}% de batidas detectadas',

    'cal.section': 'Calibración del reloj de muestreo',
    'cal.why': 'Todo se mide contra el cristal de la tarjeta de sonido. Uno barato se va <strong>±50–100 ppm</strong>, y 100 ppm son <strong>8,6 s/día</strong> de error puro de medida — más que toda la banda de un cronómetro COSC. Esta corrección afecta <em>solo a la marcha</em>: el error de batida es una diferencia y la amplitud depende de dt/T, donde el factor se cancela.',
    'cal.active': 'Corrección activa',
    'cal.none': 'ninguna',
    'cal.source': 'Origen',
    'cal.sourceMeasured': 'medida en esta sesión',
    'cal.sourceStored': 'guardada',
    'cal.sourceStoredOn': 'guardada ({date})',
    'cal.sourceNone': 'sin calibrar',
    'cal.bias': 'Sesgo que corrige',
    'cal.startBtn': 'Iniciar medición',
    'cal.stopBtn': 'Detener medición',
    'cal.applyBtn': 'Aplicar y guardar',
    'cal.deleteBtn': 'Borrar',
    'cal.storedHead': 'Calibraciones guardadas en este navegador',
    'cal.storedHelp': 'Una por dispositivo: cada tarjeta lleva su propio cristal. Se guardan en <code>localStorage</code>, que va por origen, así que no viajan entre <code>localhost</code> y el sitio publicado.',
    'cal.storedEmpty': 'Ninguna todavía.',
    'cal.storedUnnamed': 'dispositivo sin nombre',
    'cal.inUse': 'en uso',
    'cal.idleHelp': 'Requiere la captura en marcha, con la pestaña en primer plano. La incertidumbre cae como D<sup>1,5</sup>: 2 min dan ±0,12 s/día y 5 min ±0,03 s/día, de sobra para lo que resuelve el aparato.',
    'cal.gathering': 'Midiendo… {s} s, {n} bloques. Hacen falta unos segundos más.',
    'cal.live': 'Midiendo… {clock} · fs = {fs} Hz · {ppm} ± {sigma} ppm (equivale a {sd} ± {sdSigma} s/día) · base {conf}',
    'cal.gaps': ' · {n} cortes de audio',
    'cal.confAmple': 'de sobra',
    'cal.confUsable': 'utilizable',
    'cal.confShort': 'corta todavía',
    'cal.stopped': 'Medición detenida.',
    'cal.appliedPanel': 'Corrección aplicada y guardada para este dispositivo: {ppm} ± {sigma} ppm sobre {clock} ({sd}).',
    'cal.appliedStatus': 'Calibración aplicada: {ppm} ppm, corrige {sd} s/día.',
    'cal.cleared': 'Corrección borrada: la marcha vuelve a depender del cristal sin corregir.',
    'cal.removed': 'Calibración de «{label}» borrada.',
    'cal.confirmRemove': 'Se borrará la calibración de «{label}» ({ppm} ppm). Volver a medirla lleva unos minutos. ¿Seguir?',
    'cal.needCapture': 'La calibración necesita la captura en marcha.',
    'cal.adopted': 'Calibración de «{label}» reasignada a este dispositivo: {ppm} ppm.',

    'banner.noneTitle': 'Este dispositivo no está calibrado',
    'banner.noneText': 'La marcha arrastra el error del cristal de la tarjeta de sonido: hasta ±8,6 s/día, más que toda la banda de un cronómetro. La amplitud y el error de batida no se ven afectados. Bastan 2 minutos; 5 lo dejan fino.',
    'banner.calibrateNow': 'Calibrar ahora',
    'banner.calibrateAgain': 'Calibrar de nuevo',
    'banner.notNow': 'Ahora no',
    'banner.cancel': 'Cancelar',
    'banner.adopt': 'Aplicar esta',
    'banner.candidateTitle': 'Hay una calibración guardada con este mismo nombre',
    'banner.candidateText': '«{label}» · {ppm} ppm · {date}. El identificador del dispositivo ha cambiado, cosa que pasa al borrar los datos del sitio o al cambiar de puerto USB. Si es la misma sonda, aplícala; si es otra unidad del mismo modelo, calibra de nuevo: comparten nombre pero no cristal.',
    'banner.measuringTitle': 'Calibrando el reloj de muestreo…',
    'banner.measuringGathering': '{clock} · reuniendo bloques. Deja la pestaña en primer plano.',
    'banner.measuringLive': '{clock} · {ppm} ppm · incertidumbre {sd} · {left} para poder aplicarla',
    'banner.readyTitle': 'Calibración lista para aplicar',
    'banner.readyText': '{clock} · {ppm} ppm · incertidumbre {sd}. {quality}',
    'banner.readyAmple': 'De sobra.',
    'banner.readyUsable': 'Ya es utilizable; a los 5 min baja a ±0,03 s/día.',

    'diag.suspended': 'AudioContext en estado «{state}»: no se está procesando nada. Pulsa en cualquier parte de la página para arrancarlo.',
    'diag.noBlocks': 'Sin audio: el contexto corre pero el worklet no ha entregado ni un bloque. La entrada elegida no está produciendo muestras.',
    'diag.interrupted': 'Audio interrumpido hace {s} s ({n} bloques recibidos). El dispositivo ha dejado de entregar muestras.',
    'diag.blocks': '{n} bloques',
    'diag.level': 'nivel {rms} dBFS (pico {peak})',
    'diag.ticks': '{v} tics/s',
    'diag.silent': '— entrada en SILENCIO: dispositivo equivocado o entrada muteada',
    'diag.noTicks': '— hay señal pero no se detectan tics: baja la sensibilidad o ajusta la banda',

    'status.capturing': 'Capturando · {label} · {rate} · procesado del navegador desactivado.',
    'status.rateRequested': '{fs} Hz (se pidieron {want})',
    'status.stopped': 'Detenido.',
    'status.openFailed': 'No se pudo abrir la entrada: {msg}',
    'status.suspended': 'El navegador ha dejado el audio SUSPENDIDO: el diálogo de permiso consumió el gesto del clic. Pulsa en cualquier parte de la página para arrancarlo.',
    'status.audioStarted': 'Audio arrancado. Capturando.',
    'status.calAborted': 'Se descartó la calibración en curso: al reabrir la entrada el contador de frames vuelve a cero y la medición ya no sería válida. Vuelve a lanzarla.',
    'status.needCapture': 'Arranca la captura antes de ajustar.',
    'status.tuneNeedAudio': 'Necesito un par de segundos de captura para ajustar.',
    'status.tuned': 'Banda ajustada a {lo}–{hi} Hz ({db} dB de contraste tic/ruido).',
    'status.noDevices': 'Sin dispositivos de entrada',
    'status.inputN': 'Entrada {n}',
    'status.grantHint': 'Pulsa Iniciar para conceder permiso y ver los nombres de los dispositivos.',
    'status.fileProtocol': 'Ábrelo por HTTP: los módulos ES y el micrófono no funcionan sobre file://. Ejecuta «python3 -m http.server 8000» en esta carpeta.',
    'status.unsupported': 'Este navegador no soporta getUserMedia + AudioWorklet.',
    'status.error': 'Error: {msg}',
    'status.unhandled': 'Error sin capturar: {msg}',
    'status.blockError': 'Error procesando audio: {msg}',
    'status.paintError': 'Error al refrescar: {msg}',

    'info.more': 'Más información',
    'info.rate': 'Cuánto adelanta o atrasa el reloj, en segundos por día; positivo es adelantar. Sale de ajustar por mínimos cuadrados la deriva de fase sobre toda la ventana, no de promediar intervalos: así el error de temporización de cada tic se reparte y la cifra queda mucho más estable. Sin calibrar el reloj de muestreo arrastra el error del cristal de la tarjeta de sonido, que puede ser de ±8,6 s/día.',
    'info.amplitude': 'Cuánto gira el volante a cada lado de su reposo, en grados. Entre 270° y 320° en horizontal es sano; por debajo de 240° hay algo que mirar: lubricante seco, suciedad, o un muelle real cansado. Se obtiene midiendo el hueco entre el ruido de desenclavamiento y el de caída, y depende del ángulo de alzada del calibre, que hay que introducir a mano.',
    'info.beat': 'Lo descentrado que está el volante respecto al áncora: la diferencia de tiempo entre el «tic» y el «tac». Por debajo de 0,3 ms está bien; por encima de 1 ms el reloj puede no arrancar con poca cuerda. Se corrige girando el collarín de la espiral. En la cinta es la separación entre las dos trazas.',
    'info.bph': 'Alternancias por hora: cuántas veces bate el volante. 28800 (4 Hz) es lo normal en un reloj moderno; 21600, 18000 y 36000 también son frecuentes. Se detecta sola por autocorrelación y se encaja al valor estándar más cercano. No es una medida del reloj: es la confirmación de que el aparato lo ha entendido.',
    'info.positions': 'El diagnóstico no está en ninguna lectura suelta sino en las diferencias entre posiciones. Un reloj bien ajustado se comporta parecido en todas; las discrepancias apuntan a poise del volante, pivotes gastados o un escape mal repartido. Coloca el reloj, pulsa la posición (o su número del 1 al 6) y captura sola al estabilizarse.',
    'info.delta': 'La diferencia entre la marcha máxima y la mínima de las posiciones medidas. Es el criterio con el que se juzga un reloj: el COSC admite hasta 10 s/día en un cronómetro. Un delta grande con marchas individuales buenas sigue siendo un reloj mal ajustado.',
    'info.drop': 'Cuánta amplitud se pierde al pasar de horizontal (esfera arriba o abajo) a vertical (las de corona). Hasta unos 30° es normal, porque en vertical el volante apoya sobre los pivotes laterales. Por encima de 50° conviene mirar pivotes sucios o gastados, o el poise del volante.',
    'info.beatMax': 'El peor error de batida de todas las posiciones medidas. Interesa el máximo y no la media: basta con que el reloj esté descentrado en una sola posición para que dé problemas de arranque.',
    'info.tape': 'Cada punto es un tic. El eje horizontal es su desviación respecto a la cadencia teórica y el vertical el tiempo, con lo más reciente arriba. La INCLINACIÓN de las trazas es la marcha; su SEPARACIÓN, el error de batida. Al llegar a un borde la traza reaparece por el otro, igual que la cinta de papel de un aparato de mesa. Una traza gruesa o difusa delata ruido o un escape irregular.',
    'info.charts': 'Evolución de las tres medidas en el tiempo. Sirve para ver si el reloj se asienta tras darle cuerda, si la amplitud cae según se descarga el muelle, o si hay saltos que delatan un golpe o que el sensor se ha movido.',
    'info.lift': 'El arco que recorre el volante mientras el áncora le da impulso. Es un dato fijo de cada calibre, no se puede medir desde el audio, y la amplitud depende directamente de él: poner 52° donde tocaban 44° da una amplitud un 18% más larga de la real. Búscalo en la ficha del calibre; 52° es un valor genérico razonable si no lo sabes.',
    'info.quality': 'Cuánto sobresalen los tics sobre el ruido de fondo, en decibelios. Por encima de 20 dB va sobrado. Por debajo de 12 la marcha todavía sale, pero la amplitud es poco fiable, porque depende de resolver dos chasquidos flojos dentro de cada tic. Casi siempre se arregla asentando mejor el reloj contra el sensor, no tocando ajustes.',
    'info.calibration': 'El aparato mide contra el cristal de la tarjeta de sonido, que en una barata se va ±50–100 ppm: hasta 8,6 s/día de error propio. La calibración lo compara con el reloj del sistema y guarda la corrección para ese dispositivo. Solo afecta a la marcha: el error de batida es una diferencia y la amplitud depende de un cociente, así que ahí el factor se cancela.',
  },

  en: {
    'app.title': 'Timegrapher',
    'app.start': 'Start',
    'app.stop': 'Stop',
    'app.device': 'Input device',
    'app.language': 'Language',
    'app.readings': 'Readings',
    'app.permissionHint': 'Grant microphone permission to list the devices.',

    'tile.rate': 'Rate',
    'tile.rateUnit': 's/day',
    'tile.amplitude': 'Amplitude',
    'tile.amplitudeUnit': 'degrees',
    'tile.beat': 'Beat error',
    'tile.beatUnit': 'ms',
    'tile.bph': 'Beat rate',
    'tile.bphUnit': 'bph',

    'chip.noSignal': 'no signal',
    'chip.searching': 'searching',
    'chip.rate.good': 'running well',
    'chip.rate.warning': 'adjustable',
    'chip.rate.serious': 'well off',
    'chip.rate.critical': 'needs attention',
    'chip.amp.good': 'healthy',
    'chip.amp.warning': 'acceptable',
    'chip.amp.serious': 'low',
    'chip.amp.critical': 'very low',
    'chip.amp.unresolved': 'unresolved',
    'chip.beat.good': 'in beat',
    'chip.beat.warning': 'acceptable',
    'chip.beat.serious': 'out of beat',
    'chip.beat.critical': 'badly out of beat',
    'chip.bph.detected': 'detected',
    'chip.bph.manual': 'manual',

    'note.fitSigma': '±{v} (fit)',
    'note.uncalibrated': 'uncalibrated: up to ±8.6 s/day of bias',
    'note.corrected': 'corrected {v} ppm',
    'note.liftCoverage': 'lift {lift}° · {pct}% of ticks resolved',
    'note.dtOutOfRange': 'dt out of range ({v} ms)',
    'note.beatsIn': '{n} beats over {s} s',
    'note.bphRaw': 'raw {v} · confidence {c}%',
    'note.bphNoFit': 'raw {v}, no match in the table',
    'note.bphNone': 'no clear periodicity',
    'note.bphMeasured': 'measured {v}',

    'pos.section': 'Positions',
    'pos.copy': 'Copy',
    'pos.csv': 'CSV',
    'pos.clearAll': 'Clear',
    'pos.reference': 'Watch or reference',
    'pos.hint': 'Place the watch and press the position (or its number, 1 to 6). It captures on its own once the reading settles.',
    'pos.unmeasured': 'not measured',
    'pos.measuring': 'measuring',
    'pos.settling': 'settling…',
    'pos.why.moved': 'movement detected',
    'pos.why.noSignal': 'no signal',
    'pos.why.filling': 'filling the window',
    'pos.why.samples': 'gathering samples',
    'pos.why.rate': 'rate still moving ({v} s/day)',
    'pos.why.amp': 'amplitude still moving ({v}°)',
    'pos.captured': '{name}: {rate} s/day{amp} · {beat} ms. Captured.',
    'pos.needCapture': 'Start the capture before measuring positions.',
    'pos.empty': 'No positions measured. Delta needs at least two.',
    'pos.delta': 'Rate delta',
    'pos.deltaDetail': '{max} · {min} — {verdict}',
    'pos.drop': 'Amplitude drop',
    'pos.dropDetail': 'horizontal {h}° · vertical {v}° — {verdict}',
    'pos.dropNeed': 'needs one horizontal and one vertical',
    'pos.beatMax': 'Worst beat error',
    'pos.beatMaxDetail': 'across {n} of 6 positions',
    'pos.confirmClear': 'This will clear the {n} measured positions. Continue?',
    'pos.copied': 'Position table copied to the clipboard.',
    'pos.copyFailed': 'The browser refused to copy. Use CSV instead.',
    'pos.nothingToCopy': 'Nothing to copy yet.',
    'pos.nothingToExport': 'Nothing to export yet.',
    'pos.keyHint': '{name} — key {n}',

    'pos.dialUp.name': 'Dial up', 'pos.dialUp.code': 'DU',
    'pos.dialDown.name': 'Dial down', 'pos.dialDown.code': 'DD',
    'pos.crownUp.name': 'Crown up', 'pos.crownUp.code': 'CU',
    'pos.crownDown.name': 'Crown down', 'pos.crownDown.code': 'CD',
    'pos.crownLeft.name': 'Crown left', 'pos.crownLeft.code': 'CL',
    'pos.crownRight.name': 'Crown right', 'pos.crownRight.code': 'CR',

    'judge.delta.need': 'at least two positions needed',
    'judge.delta.good': 'within chronometer criteria',
    'judge.delta.warning': 'acceptable for an ordinary watch',
    'judge.delta.serious': 'check poise and pivots',
    'judge.delta.critical': 'something is wrong',
    'judge.drop.good': 'normal',
    'judge.drop.warning': 'a little high',
    'judge.drop.serious': 'pivots or poise',

    'export.date': 'Date',
    'export.reference': 'Reference',
    'export.bph': 'Beat rate',
    'export.lift': 'Lift angle',
    'export.calibration': 'Calibration',
    'export.none': '—',
    'export.uncalibrated': 'uncalibrated',
    'export.position': 'Position',
    'export.code': 'Code',
    'export.rate': 'Rate (s/day)',
    'export.amplitude': 'Amplitude (°)',
    'export.beat': 'Beat error (ms)',
    'export.time': 'Time',
    'export.deltaLabel': 'Delta',
    'export.dropLabel': 'Amplitude drop H-V',
    'export.beatMaxLabel': 'Worst beat error',
    'export.tableHead': 'Position               Rate   Ampl.     Beat',
    'export.amplitudeLine': 'Amplitude: horizontal {h}° · vertical {v}° · drop {d}°',

    'tape.section': 'Tape',
    'tape.tic': 'tick',
    'tape.tac': 'tock',
    'tape.range': 'Range',
    'tape.span': 'Span',
    'tape.alt': 'Paper-tape trace',
    'tape.hint': 'The slope of the traces is the rate; their separation, the beat error. Hover to read the position in ms.',

    'chart.section': 'Over time',
    'chart.window': 'Window',
    'chart.now': 'now',
    'chart.showData': 'Show data',
    'chart.hideData': 'Hide data',
    'chart.caption': 'Most recent recorded readings',
    'chart.colTime': 'Time',
    'chart.colRate': 'Rate (s/day)',
    'chart.colAmp': 'Amplitude (°)',
    'chart.colBeat': 'Beat (ms)',

    'set.measure': 'Measurement',
    'set.bph': 'Beats per hour',
    'set.auto': 'auto',
    'set.lift': 'Lift angle',
    'set.caliber': 'calibre…',
    'set.liftHelp': 'A property of the calibre, not measurable from the audio. Check its data sheet.',
    'set.fitWindow': 'Fit window',
    'set.fitWindowHelp': 'Longer: more precision, less responsiveness.',
    'set.probe': 'Probe and detection',
    'set.band': 'Filter band (Hz)',
    'set.tune': 'Tune',
    'set.bandHelp': '“Tune” listens for a few seconds and picks the band with the best tick-to-noise ratio.',
    'set.sens': 'Detector sensitivity',
    'set.sensNote': 'threshold = {k}× the noise floor',
    'set.quality': 'Signal quality',
    'set.ampThr': 'Escapement noise threshold',
    'set.ampThrNote': '{v}% of the tick peak. Lower it if the amplitude will not resolve; raise it if case reverberation skews it.',
    'set.align': 'Template refinement',
    'set.alignOn': 'on',
    'set.alignHelp': 'Correlates each tick against the average shape instead of using the peak alone: less noise on the rate.',
    'set.generic': 'Generic',

    'quality.none': 'No signal.',
    'quality.good': 'Good ({db} dB above the noise){cov}',
    'quality.fair': 'Fair ({db} dB){cov}. Reseating the watch will mostly help the amplitude.',
    'quality.poor': 'Poor ({db} dB){cov}. Seat the watch against the sensor before trusting the amplitude.',
    'quality.coverage': ' · {pct}% of beats detected',

    'cal.section': 'Sample-clock calibration',
    'cal.why': 'Everything is measured against the sound card’s crystal. A cheap one drifts <strong>±50–100 ppm</strong>, and 100 ppm is <strong>8.6 s/day</strong> of pure measurement error — more than the entire tolerance band of a COSC chronometer. This correction affects <em>the rate only</em>: beat error is a difference, and amplitude depends on dt/T, where the factor cancels out.',
    'cal.active': 'Active correction',
    'cal.none': 'none',
    'cal.source': 'Source',
    'cal.sourceMeasured': 'measured this session',
    'cal.sourceStored': 'stored',
    'cal.sourceStoredOn': 'stored ({date})',
    'cal.sourceNone': 'uncalibrated',
    'cal.bias': 'Bias it corrects',
    'cal.startBtn': 'Start measuring',
    'cal.stopBtn': 'Stop measuring',
    'cal.applyBtn': 'Apply and save',
    'cal.deleteBtn': 'Delete',
    'cal.storedHead': 'Calibrations stored in this browser',
    'cal.storedHelp': 'One per device: each card has its own crystal. They live in <code>localStorage</code>, which is per origin, so they do not travel between <code>localhost</code> and the published site.',
    'cal.storedEmpty': 'None yet.',
    'cal.storedUnnamed': 'unnamed device',
    'cal.inUse': 'in use',
    'cal.idleHelp': 'Needs the capture running, with the tab in the foreground. Uncertainty falls as D<sup>1.5</sup>: 2 min gives ±0.12 s/day and 5 min ±0.03 s/day, ample for what the instrument resolves.',
    'cal.gathering': 'Measuring… {s} s, {n} blocks. A few more seconds needed.',
    'cal.live': 'Measuring… {clock} · fs = {fs} Hz · {ppm} ± {sigma} ppm (equals {sd} ± {sdSigma} s/day) · baseline {conf}',
    'cal.gaps': ' · {n} audio dropouts',
    'cal.confAmple': 'ample',
    'cal.confUsable': 'usable',
    'cal.confShort': 'still short',
    'cal.stopped': 'Measurement stopped.',
    'cal.appliedPanel': 'Correction applied and saved for this device: {ppm} ± {sigma} ppm over {clock} ({sd}).',
    'cal.appliedStatus': 'Calibration applied: {ppm} ppm, corrects {sd} s/day.',
    'cal.cleared': 'Correction deleted: the rate depends on the uncorrected crystal again.',
    'cal.removed': 'Calibration for “{label}” deleted.',
    'cal.confirmRemove': 'This will delete the calibration for “{label}” ({ppm} ppm). Measuring it again takes a few minutes. Continue?',
    'cal.needCapture': 'Calibration needs the capture running.',
    'cal.adopted': 'Calibration for “{label}” reassigned to this device: {ppm} ppm.',

    'banner.noneTitle': 'This device is not calibrated',
    'banner.noneText': 'The rate carries the error of the sound card’s crystal: up to ±8.6 s/day, more than a chronometer’s entire tolerance band. Amplitude and beat error are unaffected. Two minutes is enough; five makes it tidy.',
    'banner.calibrateNow': 'Calibrate now',
    'banner.calibrateAgain': 'Calibrate again',
    'banner.notNow': 'Not now',
    'banner.cancel': 'Cancel',
    'banner.adopt': 'Apply this one',
    'banner.candidateTitle': 'There is a stored calibration under this same name',
    'banner.candidateText': '“{label}” · {ppm} ppm · {date}. The device identifier has changed, which happens when site data is cleared or the USB port changes. If it is the same probe, apply it; if it is another unit of the same model, calibrate again: they share a name but not a crystal.',
    'banner.measuringTitle': 'Calibrating the sample clock…',
    'banner.measuringGathering': '{clock} · gathering blocks. Keep the tab in the foreground.',
    'banner.measuringLive': '{clock} · {ppm} ppm · uncertainty {sd} · {left} until it can be applied',
    'banner.readyTitle': 'Calibration ready to apply',
    'banner.readyText': '{clock} · {ppm} ppm · uncertainty {sd}. {quality}',
    'banner.readyAmple': 'Ample.',
    'banner.readyUsable': 'Already usable; at 5 min it drops to ±0.03 s/day.',

    'diag.suspended': 'AudioContext is “{state}”: nothing is being processed. Click anywhere on the page to start it.',
    'diag.noBlocks': 'No audio: the context is running but the worklet has not delivered a single block. The selected input is not producing samples.',
    'diag.interrupted': 'Audio interrupted {s} s ago ({n} blocks received). The device stopped delivering samples.',
    'diag.blocks': '{n} blocks',
    'diag.level': 'level {rms} dBFS (peak {peak})',
    'diag.ticks': '{v} ticks/s',
    'diag.silent': '— input is SILENT: wrong device or muted input',
    'diag.noTicks': '— there is signal but no ticks are detected: lower the sensitivity or tune the band',

    'status.capturing': 'Capturing · {label} · {rate} · browser processing disabled.',
    'status.rateRequested': '{fs} Hz ({want} requested)',
    'status.stopped': 'Stopped.',
    'status.openFailed': 'Could not open the input: {msg}',
    'status.suspended': 'The browser left the audio SUSPENDED: the permission dialog consumed the click gesture. Click anywhere on the page to start it.',
    'status.audioStarted': 'Audio started. Capturing.',
    'status.calAborted': 'The calibration in progress was discarded: reopening the input resets the frame counter, so the measurement would no longer be valid. Launch it again.',
    'status.needCapture': 'Start the capture before tuning.',
    'status.tuneNeedAudio': 'I need a couple of seconds of capture to tune.',
    'status.tuned': 'Band tuned to {lo}–{hi} Hz ({db} dB of tick-to-noise contrast).',
    'status.noDevices': 'No input devices',
    'status.inputN': 'Input {n}',
    'status.grantHint': 'Press Start to grant permission and see the device names.',
    'status.fileProtocol': 'Open it over HTTP: ES modules and the microphone do not work over file://. Run “python3 -m http.server 8000” in this folder.',
    'status.unsupported': 'This browser does not support getUserMedia + AudioWorklet.',
    'status.error': 'Error: {msg}',
    'status.unhandled': 'Unhandled error: {msg}',
    'status.blockError': 'Error processing audio: {msg}',
    'status.paintError': 'Error refreshing: {msg}',

    'info.more': 'More information',
    'info.rate': 'How fast or slow the watch runs, in seconds per day; positive means gaining. It comes from a least-squares fit of the phase drift across the whole window rather than averaging intervals, so each tick\u2019s timing error is spread out and the figure is far steadier. Without calibrating the sample clock it carries the error of the sound card\u2019s crystal, which can be ±8.6 s/day.',
    'info.amplitude': 'How far the balance swings either side of rest, in degrees. Between 270° and 320° horizontal is healthy; below 240° something wants looking at: dry lubricant, dirt, or a tired mainspring. It is derived from the gap between the unlocking and drop noises, and depends on the calibre\u2019s lift angle, which you have to enter by hand.',
    'info.beat': 'How far off-centre the balance sits relative to the pallet fork: the time difference between the “tick” and the “tock”. Under 0.3 ms is fine; above 1 ms the watch may fail to start on a low wind. It is corrected by turning the hairspring collet. On the tape it is the gap between the two traces.',
    'info.bph': 'Beats per hour: how often the balance beats. 28800 (4 Hz) is usual in a modern watch; 21600, 18000 and 36000 are also common. It is detected automatically by autocorrelation and snapped to the nearest standard value. It is not a measurement of the watch — it confirms the instrument has understood it.',
    'info.positions': 'The diagnosis lives in the differences between positions, not in any single reading. A well-adjusted watch behaves similarly in all of them; discrepancies point to balance poise, worn pivots, or an unevenly distributed escapement. Place the watch, press the position (or its number, 1 to 6), and it captures on its own once settled.',
    'info.delta': 'The difference between the highest and lowest rate across the measured positions. It is the criterion a watch is judged by: COSC allows up to 10 s/day for a chronometer. A large delta with good individual rates is still a poorly adjusted watch.',
    'info.drop': 'How much amplitude is lost going from horizontal (dial up or down) to vertical (the crown positions). Up to about 30° is normal, since vertically the balance rides on its side pivots. Above 50° it is worth checking for dirty or worn pivots, or balance poise.',
    'info.beatMax': 'The worst beat error across all measured positions. The maximum matters more than the average: the watch being off-centre in a single position is enough to cause starting trouble.',
    'info.tape': 'Each dot is one tick. The horizontal axis is its deviation from the theoretical beat and the vertical axis is time, most recent at the top. The SLOPE of the traces is the rate; their SEPARATION is the beat error. When a trace reaches one edge it reappears at the other, just like the paper tape of a bench machine. A thick or fuzzy trace means noise or an irregular escapement.',
    'info.charts': 'How the three measurements evolve over time. Useful for seeing whether the watch settles after winding, whether amplitude falls as the mainspring runs down, or whether jumps betray a knock or a sensor that has shifted.',
    'info.lift': 'The arc the balance travels while the pallet fork gives it impulse. It is a fixed property of each calibre, cannot be measured from the audio, and the amplitude depends on it directly: entering 52° where 44° was correct gives an amplitude 18% higher than reality. Look it up in the calibre data sheet; 52° is a reasonable generic value if you do not know it.',
    'info.quality': 'How far the ticks stand above the background noise, in decibels. Above 20 dB is ample. Below 12 the rate still comes out, but the amplitude is unreliable, because it depends on resolving two faint clicks inside each tick. It is almost always fixed by seating the watch better against the sensor, not by changing settings.',
    'info.calibration': 'The instrument measures against the sound card\u2019s crystal, which on a cheap one drifts ±50–100 ppm: up to 8.6 s/day of error of its own. Calibration compares it with the system clock and stores the correction for that device. It affects the rate only: beat error is a difference and amplitude depends on a ratio, so the factor cancels out there.',
  },
};

let current = 'es';

/** Idioma inicial: el guardado, si no el del navegador, si no español. */
export function detectLang() {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved && DICT[saved]) return saved;
  } catch { /* modo privado */ }
  const nav = (typeof navigator !== 'undefined' && navigator.language) || 'es';
  return nav.toLowerCase().startsWith('en') ? 'en' : 'es';
}

export function getLang() { return current; }

export function setLang(lang, { persist = true } = {}) {
  if (!DICT[lang]) return false;
  current = lang;
  if (persist) {
    try { localStorage.setItem(STORE_KEY, lang); } catch { /* modo privado */ }
  }
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  return true;
}

/** Traduce. Los parámetros se sustituyen como `{nombre}`. */
export function t(key, params) {
  let s = DICT[current][key];
  if (s === undefined) s = DICT.es[key];
  if (s === undefined) return key;   // clave suelta: visible, no silenciosa
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}

export function locale() { return LOCALES[current]; }

/** Número con el separador decimal del idioma. */
export function nf(v, decimals = 1) {
  if (!isFinite(v)) return '—';
  return v.toLocaleString(LOCALES[current], {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function signed(v, decimals = 1) {
  if (!isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + nf(v, decimals);
}

export function int(v) {
  return Math.round(v).toLocaleString(LOCALES[current]);
}

/**
 * Separador del CSV. En español la coma ya es el decimal, así que un Excel en
 * español espera `;`; en inglés, la coma.
 */
export function csvSep() { return current === 'es' ? ';' : ','; }

/** Aplica las traducciones al marcado estático. */
export function applyStatic(root = document) {
  const set = (attr, fn) => {
    for (const el of root.querySelectorAll(`[${attr}]`)) fn(el, t(el.getAttribute(attr)));
  };
  set('data-i18n', (el, v) => { el.textContent = v; });
  set('data-i18n-html', (el, v) => { el.innerHTML = v; });
  set('data-i18n-placeholder', (el, v) => { el.placeholder = v; });
  set('data-i18n-title', (el, v) => { el.title = v; });
  set('data-i18n-aria', (el, v) => { el.setAttribute('aria-label', v); });
}

/** Todas las claves de un idioma: lo usa la prueba de completitud. */
export function keysOf(lang) { return Object.keys(DICT[lang]); }
export function langs() { return Object.keys(DICT); }
