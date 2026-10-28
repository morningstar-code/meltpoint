<p align="center">
  <img src="docs/banner.png" alt="Meltpoint: todo sistema tiene un punto de fusión" width="100%" />
</p>

<h3 align="center">Todo sistema tiene un punto de fusión. Encuentra el tuyo antes que producción.</h3>

<p align="center">
  <a href="https://morningstar-code.github.io/meltpoint/"><b>Abrir Meltpoint</b></a> ·
  <a href="README.md">Read in English</a> ·
  <a href="#cómo-funciona-la-simulación">Cómo funciona</a> ·
  <a href="CONTRIBUTING.md">Contribuir</a>
</p>

Meltpoint es un simulador de sistemas distribuidos. Conecta clientes, balanceadores, servicios,
cachés, bases de datos, colas, limitadores y cortacircuitos, sube el tráfico y mira cómo el sistema
se calienta y se funde: colas que se llenan, timeouts que saltan, reintentos que multiplican la
carga que los provocó y trabajo acumulado para llamadores que ya se rindieron.

Después pulsa **Buscar punto de fusión** y te dice la carga exacta a la que se rompe tu diseño, qué
componente cede primero y cuánto margen te queda.

<p align="center">
  <img src="docs/screenshot.png" alt="El escenario Tormenta de reintentos fundiéndose" width="100%" />
</p>

## Qué lo hace diferente

- **El buscador del punto de fusión.** En lugar de arrastrar un control hasta que algo se ponga
  rojo, Meltpoint ejecuta tu diseño con cargas crecientes, cada una una simulación nueva, afina el
  límite por bisección y te dice hasta dónde aguanta con comodidad, dónde se funde, qué cede primero
  y tu margen actual. Medido, no estimado.
- **"¿Por qué se funde?"** Un diagnóstico en vivo y en lenguaje claro: *"Los reintentos multiplican
  el tráfico a la base de datos por ×3,9"*, *"El 62% del trabajo de la base de datos es para
  peticiones que nadie espera ya"*. Casi todos los hallazgos traen un arreglo de un clic que puedes
  probar al momento, y deshacer.
- **El trabajo desperdiciado es una métrica de primera.** Cuando un llamador agota su timeout, el
  componente de abajo sigue trabajando en una petición que ya nadie quiere. Meltpoint mide ese
  desperdicio en cada componente, porque ocupado no es lo mismo que útil.
- **Contrastado con la teoría de colas.** Selecciona cualquier componente y el inspector compara la
  espera medida con la predicción de Erlang C para la misma carga. Los tests exigen al motor los
  resultados de M/M/1 y M/M/c.
- **Un lienzo que muestra temperatura.** Los componentes van del azul frío al rojo fundido según se
  llenan; los que se funden brillan y laten. Las peticiones viajan como partículas que se vuelven
  rojas al fallar, y los enlaces muestran su amplificación por reintentos.
- **Los arreglos de los sistemas reales.** Backoff exponencial con jitter, presupuestos de
  reintentos, propagación de deadlines, descarte de carga, llamadas opcionales con respaldo,
  cortacircuitos, limitadores, autoescalado con tiempo de arranque, balanceo al menos ocupado, hilo
  por petición frente a E/S asíncrona.
- **Caos a demanda.** Tumba un componente, hazlo 20× más lento, haz que falle parte de las
  peticiones o corta un enlace, y sigue el fallo mientras se propaga.
- **Tráfico con forma.** Constante, onda diaria, picos, rampa o ráfagas. Algunos fallos, como la
  tormenta de reintentos, solo aparecen tras un pico, y se quedan cuando el pico se va.
- **Línea de tiempo de incidentes.** Dos minutos de carga ofrecida, goodput, fallos y p99, con
  marcas en los momentos en que algo se fundió, se recuperó, saltó o escaló.
- **Bilingüe.** Toda la interfaz y todas las lecciones están en inglés y en español.
- **Tuyo.** Sin cuenta, sin servidor, sin rastreo. Los diseños se guardan en tu navegador, se
  exportan a un archivo o viajan en un enlace cuyos datos van en el fragmento de la URL, que los
  navegadores nunca envían a un servidor.

<p align="center">
  <img src="docs/meltpoint.png" alt="El buscador del punto de fusión en la Tormenta de reintentos" width="100%" />
</p>

Los enlaces admiten opciones: `?lang=es` o `?lang=en`, `?theme=dark` o `?theme=light`, `?t=30`
para adelantar la simulación 30 segundos y `?open=meltpoint` para abrir el buscador.

## Escenarios

| Escenario | Qué enseña |
| --- | --- |
| El precipicio de la utilización | La latencia crece con 1 / (1 − carga): el último 15% de capacidad es el más caro |
| Tormenta de reintentos | Un pico de cinco segundos desata una tormenta que lo sobrevive: un fallo metaestable |
| Una dependencia lenta | Lento es peor que caído: secuestra todos los hilos |
| La caché sostiene el edificio | Pierde aciertos y la base de datos recibe un tráfico para el que nunca se dimensionó |
| N + 1 | Tres servidores al 70% parecen bien hasta que uno muere |
| Las colas absorben ráfagas, no sobrecarga | Una cola mueve el trabajo en el tiempo; no crea capacidad |
| Di que no pronto | Un limitador sirve algo menos, y lo que sirve sigue siendo rápido |
| El autoescalado es lento para los picos | Servidores que tardan 20 s en arrancar no ayudan con un pico de 5 s |
| La cola a escala | Espera a cinco backends y obtienes el más lento de los cinco |
| Checkout en Black Friday | Todos los patrones a la vez, en una tienda realista |
| Lienzo en blanco | Construye el tuyo y encuentra su punto de fusión |

## Cómo funciona la simulación

El motor de [`src/sim`](src/sim) es un simulador de eventos discretos sin dependencias de interfaz.
Cada petición es un objeto que recorre la topología, y cada número en pantalla se mide a partir de
esos objetos: huecos finitos y colas reales, tiempos de servicio con varianza (distribución gamma),
timeouts que abandonan sin cancelar, reintentos que son intentos reales, modo bloqueante o asíncrono,
colas que confirman al instante y percentiles medidos. Con la misma semilla, la simulación se repite
de forma idéntica. Los detalles están en el [README en inglés](README.md#how-the-simulation-works).

## Ejecutarlo en local

Necesitas [Node.js](https://nodejs.org) 20.19 o superior.

```bash
git clone https://github.com/morningstar-code/meltpoint.git
cd meltpoint
npm install
npm run dev
```

Abre http://localhost:5173. `npm test` ejecuta los tests y `npm run build` genera una versión
estática en `dist/` que puedes alojar donde quieras.

## Contribuir

Se agradecen reportes de errores, escenarios nuevos, mejores explicaciones y traducciones. Empieza
por [CONTRIBUTING.md](CONTRIBUTING.md). La única regla: los números tienen que ser verdad.

## Agradecimientos

Meltpoint se inspiró en [Breakscale](https://github.com/workersio/breakscale). Es una implementación
independiente, escrita desde cero.

## Licencia

[MIT](LICENSE).
