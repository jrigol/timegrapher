# Timegrapher web

Cronocomparador para relojes mecánicos que corre entero en el navegador. Mide
**marcha** (s/día), **amplitud** (grados) y **error de batida** (ms), detecta las
**alternancias por hora** solo, y dibuja la traza clásica de cinta de papel más
la evolución temporal de las tres magnitudes.

No necesita servidor de aplicación, ni build, ni dependencias.

## El hardware

Está pensado para una sonda piezo/micrófono conectada a una **tarjeta de sonido
USB** — en este equipo, una `USB PnP Sound Device` de C-Media
(`VID 0x0D8C / PID 0x013C`, familia CM108). Es un dispositivo USB Audio Class
estándar, así que el navegador lee el audio crudo con `getUserMedia()` y todo el
proceso de señal ocurre en JavaScript: no hay protocolo propietario que descifrar
ni driver que instalar.

Techo del hardware: **48 kHz, 16 bit, mono** (USB Audio Class 1.0 a full-speed).
Una muestra son 20,8 µs, y el desfase se afina por debajo de la muestra
correlando cada tic contra una plantilla.

## Arrancar

**En línea:** <https://jrigol.github.io/timegrapher/>

Cada push a `main` pasa las pruebas y, solo si pasan, se republica
(`.github/workflows/pages.yml`). El audio no sale del equipo: la página se
descarga una vez y todo el proceso de señal ocurre en el navegador.

**En local:**

```sh
python3 -m http.server 8000
```

y abrir <http://localhost:8000>. Tiene que ser por HTTP: sobre `file://` no
funcionan ni los módulos ES ni el micrófono. Un origen seguro (HTTPS o
`localhost`) es obligatorio para `getUserMedia`.

Pulsa **Iniciar**, concede el permiso de micrófono y elige la entrada USB (se
preselecciona sola si el nombre delata una tarjeta USB).

## Lo primero de todo: calibrar

**La marcha sin calibrar no significa nada en términos absolutos.** Toda la
medida es una comparación contra el cristal de la tarjeta de sonido, y uno barato
se va ±50–100 ppm:

```
100 ppm × 86400 s = 8,64 s/día de error puro de medida
```

Más que toda la banda de tolerancia de un cronómetro COSC (−4/+6 s/d).

La corrección se guarda en `localStorage`, que está separado **por origen**: la
que midas en `localhost` no vale en `jrigol.github.io` ni al revés. Calibra en el
sitio donde vayas a usarlo.

Para corregirlo, en *Calibración del reloj de muestreo* → **Iniciar medición**,
con la captura en marcha y la pestaña en primer plano, y déjalo 20–30 minutos.
Compara el contador de frames del `AudioWorklet` con el reloj del sistema por
regresión sobre todos los bloques. Luego **Aplicar y guardar**: queda asociado al
`deviceId` en `localStorage` y se reaplica solo.

En la prueba sintética, media hora de base con ±3 ms de jitter de entrega da
±0,02 ppm. En vivo será peor —la entrega de mensajes se agrupa si la pestaña
pierde el foco—, pero el orden de magnitud es ese: décimas de ppm, o centésimas
de segundo al día. El panel muestra la incertidumbre real del ajuste.

El cristal se mueve con la temperatura unos pocos ppm, así que conviene rehacer la
calibración de vez en cuando; no prometas precisión absoluta mejor de 1–2 s/día.

**Solo afecta a la marcha.** El error de batida es una diferencia (100 ppm sobre
1 ms son 0,0001 ms) y la amplitud depende de `dt/T`, donde el factor se cancela.

## Cómo se calcula cada cosa

**Alternancias por hora.** Autocorrelación de la envolvente, en paralelo al
detector de picos y sin depender de él. Un umbral mal puesto pierde un tic de
cada dos y produce un error de octava silencioso; la autocorrelación no tiene ese
modo de fallo. Se puntúa cada candidato con `acf[L] + acf[2L]` —el segundo
armónico distingue un periodo real de un artefacto intra-tic— y entre los que
pasan se coge el retardo menor, que es la batida. El resultado se encaja al valor
estándar más cercano dentro de un ±2%; los dos valores más próximos de la tabla
(18000 y 19800) distan un 10%, así que no hay ambigüedad.

**Marcha y error de batida.** Mínimos cuadrados sobre

```
t_i = a + b·i + c·(−1)^i
```

El término alterno absorbe el error de batida y deja el periodo medio `b` limpio.
De ahí `marcha = (T_nominal − b)/T_nominal × 86400` y
`error de batida = 2|c|`, que es también la separación entre las dos trazas de la
cinta. Se ajusta la pendiente sobre toda la ventana en vez de promediar
intervalos: el error de temporización de cada tic se reparte sobre la base entera.

**Amplitud.** Se resuelven los tres ruidos del escape dentro de cada tic
(desenclavamiento, impulso, caída) y se mide el intervalo entre el primero y el
tercero:

```
A = ángulo_de_alzada / (2 · sin(π · dt / T))
```

con `T` el periodo de oscilación completa (dos batidas). Para 28800 bph, alzada
52° y amplitud 280°, `dt` ronda los 7,4 ms. El ángulo de alzada es un dato del
calibre, no medible desde el audio.

Es la medida delicada: depende de resolver dos chasquidos que apenas asoman sobre
el ruido. Si no sale, mira el indicador de **calidad de señal** antes que nada —
casi siempre es el acoplamiento del sensor, no el algoritmo.

## Cuando algo no sale

| Síntoma | Qué mirar |
|---|---|
| Amplitud en `—` | Calidad de señal. Asienta el reloj contra el sensor. Luego baja el *umbral de los ruidos del escape*. |
| Amplitud baja e inestable | La reverberación de la caja mete picos falsos: **sube** el umbral. |
| bph no se fija | *Ajustar* la banda del filtro. Con menos de ~12 dB de contraste la detección va justa. |
| Marcha ruidosa | Ventana de ajuste más larga; comprueba que el refinado por plantilla está activo. |
| Cortes de audio | Se cuentan en el panel de calibración. Cierra otras aplicaciones de audio. |

## Verificación

```sh
node test/synthetic.mjs   # cadena completa contra señal de parámetros conocidos
node test/units.mjs       # aritmética de calibración y rutas de dibujado
```

`synthetic.mjs` genera trenes de tics con marcha, error de batida, amplitud y bph
conocidos —incluidos los casos difíciles: tac 16× más flojo que el tic, y ruido
alto— y los pasa por la misma cadena que la aplicación, en bloques de 4096
muestras. Recupera la marcha con un error < 0,01 s/día, el error de batida
< 0,002 ms y la amplitud < 0,03°.

## Mapa de ficheros

```
index.html            interfaz
css/style.css
js/app.js             orquestación: cadena por bloque y pintado
js/audio.js           getUserMedia + AudioContext (procesado del navegador desactivado)
js/calibration.js     corrección del reloj de muestreo
js/worklet/
  capture-processor.js  captura, conteo de frames, detección de huecos
js/dsp/
  filters.js          paso banda Butterworth 4º orden + envolvente TKEO
  fft.js              FFT y autocorrelación insesgada
  bph.js              detección de alternancias
  ticks.js            historial circular, detector de tics, plantillas
  tracker.js          ajuste de marcha y error de batida
  amplitude.js        resolución de los ruidos del escape
js/ui/
  theme.js  paper.js  charts.js
test/
  synthetic.mjs  units.mjs
```

## Limitaciones conocidas

- Sin calibrar, la marcha absoluta arrastra el error del cristal (hasta ±8,6 s/día).
- La amplitud depende del ángulo de alzada, que hay que introducir a mano. Los
  valores del desplegable son los publicados habitualmente; confírmalos en la
  ficha del calibre.
- Solo relojes mecánicos. Un cuarzo (un tic por segundo) queda fuera del rango de
  busca del bph.
- **Sin probar todavía contra hardware real ni en un navegador.** La cadena de
  medida está verificada numéricamente con señal sintética (ver *Verificación*) y
  las rutas de dibujado con un contexto 2D simulado, pero la captura en vivo
  —permisos, `AudioWorklet`, la sonda de verdad— está pendiente de la primera
  sesión con un reloj puesto. Empieza por ahí.
