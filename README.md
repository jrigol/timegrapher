# Timegrapher web

Cronocomparador para relojes mecánicos que corre entero en el navegador. Mide
**marcha** (s/día), **amplitud** (grados) y **error de batida** (ms), detecta las
**alternancias por hora** solo, y dibuja la traza clásica de cinta de papel más
la evolución temporal de las tres magnitudes.

No necesita servidor de aplicación, ni build, ni dependencias.

Interfaz en **español e inglés**, con selector en la barra superior. Al abrirla
por primera vez toma el idioma del navegador y luego recuerda la elección. El
idioma arrastra el formato numérico —coma decimal en español, punto en inglés—,
los códigos de posición (EA/EB/CA frente a DU/DD/CU) y el separador del CSV, que
en español es `;` porque la coma ya es el decimal.

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

Si el dispositivo no está calibrado, la aplicación lo avisa al arrancar y ofrece
el botón para hacerlo. También está en *Calibración del reloj de muestreo* →
**Iniciar medición**. Compara el contador de frames del `AudioWorklet` con el
reloj del sistema por regresión sobre todos los bloques; luego **Aplicar y
guardar** lo asocia al `deviceId` en `localStorage` y se reaplica solo.

### Una calibración por dispositivo

Cada tarjeta lleva su propio cristal: dos dongles del mismo modelo se separan
fácilmente 200 ppm entre sí. La corrección se guarda por `deviceId`, y el panel
lista las que hay para verlas y borrarlas.

Con un matiz que conviene conocer: **`deviceId` no es un identificador
duradero.** Es un hash con sal por origen y cambia al borrar los datos del sitio,
al revocar el permiso, en algunos navegadores al cerrar la sesión, y a veces al
cambiar de puerto USB. Si el id no aparece pero hay *una sola* calibración
guardada con la misma etiqueta de dispositivo, la aplicación la propone — no la
aplica sola, porque dos unidades del mismo modelo comparten nombre y no comparten
cristal. Si hay dos con ese nombre, no propone ninguna.

### ¿Cuánto hay que dejarlo?

Menos de lo que parece. La incertidumbre de la pendiente cae como `D^1.5` —`D^0.5`
por el número de puntos y otro `D` por el brazo de palanca temporal—, así que en
la práctica sale `σ[ppm] ≈ 1750 / D^1.5`:

| Duración | σ | En s/día |
|---|---|---|
| 1 min | ±3,8 ppm | ±0,33 |
| **2 min** | ±1,3 ppm | ±0,12 |
| **5 min** | ±0,34 ppm | ±0,029 |
| 10 min | ±0,12 ppm | ±0,010 |
| 30 min | ±0,023 ppm | ±0,002 |

**Cinco minutos sobran** para lo que resuelve el aparato. La interfaz habilita
*Aplicar* a los 2 minutos y considera 5 de sobra; las dos constantes están
respaldadas por `test/units.mjs`.

Dos avisos. Esas cifras salen de un modelo de jitter limpio y no correlacionado;
en vivo la entrega de mensajes va a rachas (recolección de basura, carga del
sistema, pestaña en segundo plano) y eso no se promedia como ruido blanco, así
que por debajo de 2 minutos no conviene fiarse. Y el panel muestra siempre la σ
calculada sobre los residuos reales, que es la cifra honesta.

El cristal se mueve con la temperatura unos pocos ppm, así que conviene rehacer la
calibración de vez en cuando; no prometas precisión absoluta mejor de 1–2 s/día.

**Solo afecta a la marcha.** El error de batida es una diferencia (100 ppm sobre
1 ms son 0,0001 ms) y la amplitud depende de `dt/T`, donde el factor se cancela.

## Medir por posiciones

El diagnóstico de un reloj no está en ninguna lectura suelta, sino en las
diferencias entre posiciones. La sección *Posiciones* recoge las seis estándar:

1. Coloca el reloj y pulsa la posición — o su número, del **1 al 6**, que es lo
   práctico cuando tienes las manos ocupadas. `Esc` cancela.
2. La medida se reinicia (los datos de la posición anterior son de otro montaje)
   y espera a que la lectura **se estabilice**: una ventana entera de datos
   nuevos, la marcha quieta dentro de 2 s/día y la amplitud dentro de 6°. Si
   detecta que has vuelto a mover el reloj, reinicia la cuenta.
3. Al estabilizarse captura sola marcha, amplitud y error de batida.

Con dos o más posiciones aparecen las cifras que importan:

- **Delta**: marcha máxima menos mínima. Es el criterio con el que se juzga un
  reloj; el COSC admite hasta 10 s/día en un cronómetro. Las celdas de las dos
  posiciones extremas quedan marcadas.
- **Caída de amplitud** de horizontal a vertical. Por encima de unos 50° hay que
  mirar pivotes o poise.
- **Error de batida máximo** de la serie.

*Copiar* deja la tabla en el portapapeles como texto, y *CSV* la descarga con
separador `;` y coma decimal, que es lo que espera un Excel en español.

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
js/i18n.js            diccionario es/en, formato numérico y traducción del marcado
js/ui/tooltip.js      ayuda contextual: los botones «i» de cada concepto
assets/logo.svg       logotipo, con fill=currentColor para seguir al tema
js/positions.js       sesión por posiciones, delta y exportación
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

