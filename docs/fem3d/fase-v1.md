# Fase V1 — visor de sólo lectura: resultado

> **Fecha:** 2026-10-11. **Plan:** `visor.md` (§3, lo que se fijó al empezar con el usuario: arquitectura, pantallas y criterios; §5, sus decisiones V-a, V-b y V-c).
>
> **Veredicto: V1 pasa los criterios 1, 2, 3 y 5. El 4 queda a medias, por un solo cambio: la primera magnitud de momentos de una planta, de 486 a 592 ms según la pasada, con un límite de 500. El 6, la puerta de uso, es del usuario.**
> - **Fidelidad (criterio 1).** Cada número de las pantallas es el de su consulta en los cuatro proyectos de ejemplo:
>   - tablas, extremos, envolventes, desplomes, ν e informe, bit a bit;
>   - la escena de cada planta da el mismo SVG, byte a byte, que `fem render`;
>   - en el DOM, el texto de las tablas es el valor de la consulta con su formato.
> - **Los mismos bits que la CLI (criterio 2).** El sha256 de los resultados calculados en Chrome es el de `fem calcular` en los cuatro proyectos, y abrir con `.fem/` da ese mismo sha256 y los mismos datos.
> - **Nada que no valga (criterio 3).** No se usan resultados de otra huella, de otro núcleo, sin sha256, alterados (un bit) o truncados: se recalcula y se dice por qué. Un modelo que no compila se dibuja con sus diagnósticos y sin resultados, y una respuesta de otra versión del proyecto se descarta.
> - **Fluidez (criterio 4, a medias).** Medido en el edificio objetivo, en Chrome:
>   - en un recorrido por las seis pantallas, ninguna tarea larga del hilo principal;
>   - abrir con `.fem/`, 1,37 s;
>   - abrir y calcular, el cálculo (3,65 s en el worker) más 0,06 s;
>   - los cambios de planta, magnitud y combinación, de 5 a 128 ms, salvo la primera vez que una planta enseña momentos o cortantes: 460 ms en N2 y 592 ms con M11 en N3 en la última pasada (486, 490 y 490 ms en las anteriores) (V1-3).
> - **Recarga (criterio 5).** Al cambiar `proyecto.json` en disco, el visor lo ve en 0,25 s y conserva pantalla, planta y selección.
>
> **Hallazgos principales:**
> - **V1-1:** compilar (0,85 s), las consultas y la revisión (5,5 s) también bloquean. Por eso el worker guarda la sesión entera, no sólo el cálculo de E4.
> - **V1-7:** un `resultados.bin` alterado del mismo tamaño se reutilizaba en silencio, también en la CLI. Ahora la cabecera lleva su sha256 y los dos lo comprueban.
> - **V1-3:** la primera magnitud de momentos de una planta tarda de 486 a 592 ms, alrededor del límite de 500. Unos 300 ms son la recuperación SPR (C5-4, aplazada por el usuario) y unos 130 ms, las bandas.
>
> **Cómo leerlo:** la tabla resume los criterios, que se fijaron al empezar (`visor.md` §3.3). Cada sección da el detalle y la evidencia. Lo que queda para el usuario está en «Pendiente».

## Criterios

| # | Criterio | Resultado | Evidencia |
|---|---|---|---|
| 1 | Fidelidad: cada dato es el de su consulta; la escena, la de `fem render`; el texto del DOM, el valor con su formato | **Pasa.** Cuatro proyectos, todas sus plantas (dos en el edificio), todas las vistas y pantallas | `src/visor/visor.test.ts` (44 tests); `app/src/test/pantallas.test.tsx` |
| 2 | Los mismos bits que la CLI, en Chrome; abrir con `.fem/` da lo mismo que calcular | **Pasa.** Mismo sha256 en los cuatro, calculando y con `.fem/` | `validacion/v1/chrome.ts`, `out_chrome.txt`; `visor.test.ts` |
| 3 | Un resultado que no vale nunca se presenta como válido | **Pasa.** Otra huella, otro núcleo, sin sha256, un bit cambiado, truncado y cabecera rota: rechazados, con su motivo. Desactualizado antes de releer el fichero; respuestas de otra huella descartadas | `visor.test.ts`; `out_chrome.txt` («alterado», criterio 5); `cliente.ts`, `useProyecto.ts` |
| 4 | Edificio objetivo: ninguna tarea larga (> 50 ms) en el recorrido; cambios ≤ 0,5 s; abrir con `.fem/` ≤ 2 s; abrir y calcular, el cálculo + ≤ 1 s | **A medias.** 0 tareas largas; con `.fem/`, 1,37 s; abrir y calcular, 3,65 + 0,06 s; siete de los ocho cambios medidos, ≤ 460 ms. El primer M11 de una planta, 592 ms en la última pasada (486–490 ms en las tres anteriores): V1-3 | `out_chrome.txt` (la última pasada) |
| 5 | Recarga: cambio visto en ≤ 2 s, conservando planta, pantalla y selección | **Pasa.** 0,25 s; recalculado en 3,9 s; Pilares, N3 y el pilar elegido, conservados | `out_chrome.txt` |
| 6 | Puerta de uso: el usuario revisa con el visor los tres proyectos de A2 y dice si le sirve | **Pendiente del usuario** | — |

## 1. Qué hay nuevo

| Dónde | Qué |
|---|---|
| `src/visor/` (puro) | `sesion.ts`: abrir y compilar; calcular o usar `.fem/` (huella, núcleo y sha256); combinaciones; escenas de A4. `escena.ts`: la escena preparada (trazados agrupados sin reordenar) y elegir un objeto. `datos.ts`: los datos de cada pantalla con las consultas existentes. `protocolo.ts` y `atender.ts`: el worker de sesión |
| `app/` | El visor, con Vite 8, React 19 (React Compiler) y Tailwind 4, como Concreta, y Three.js 0.186 para el 3D. Es un paquete aparte (`app/package.json`): el motor sigue sin dependencias de React |
| `app/src/sesion/` | Worker de sesión, cliente (un worker por versión del proyecto, con la huella en cada respuesta), origen por carpeta (File System Access) o por URL del servidor local, y vigilancia del fichero cada segundo |
| `app/src/lienzo/` | `Planta2D`: la escena de A4 en SVG interactivo, con zoom, encuadre, rótulos sin solapes en cada encuadre, clic para elegir y leyenda. `Visor3D`: un único renderer, láminas y barras en dos geometrías, deformada. Tema y cámara del lienzo, copiados de Concreta (V-a) |
| `app/src/pantallas/` | Modelo (planta, 3D, inspector, diagnósticos, hipótesis), Losas, Vigas (alzado con cursor), Pilares (cuadros), Desplomes (deformada y perfil) y Revisión (informe de A3 y firma) |
| `app/visor.ts` | `bun run visor <proyecto.json>`: el servidor local, con la carpeta del proyecto en `/proyecto/`, y la URL que lo abre vigilado |
| `cli/ordenes.ts` | `.fem/<huella>/resultados.json` lleva el sha256 de `resultados.bin`, y `calcular` no reutiliza unos resultados sin él o que no casan (V1-7) |
| `validacion/v1/chrome.ts` | Banco en Chrome headless (perfil temporal) por el protocolo de depuración, sin dependencias: criterios 2 a 5 |
| CI | Trabajo `visor`: tipos, tests de DOM y `vite build` |

## 2. Cómo se hace

**La sesión en el worker.** El hilo principal sólo dibuja. Cada pedido (`protocolo.ts`) es pequeño: «la escena de N3 en uz», «la envolvente de VX0». La respuesta trae la huella de la sesión que la contestó:
- abrir otro proyecto, o el mismo cambiado, crea otro worker y termina el anterior;
- así no puede llegar una respuesta vieja, y la memoria se libera;
- el núcleo WASM (252 KB) se vuelve a cargar en unos 10 ms.

**Lo que dibuja el 2D es la escena de A4.** La sesión agrupa sus trazados por estilo en coordenadas del modelo, sin cambiar el orden. El hilo principal pone unos pocos `<path>` en un grupo transformado y sólo recoloca los rótulos y los glifos al encuadrar. Elegir con el ratón se resuelve en la sesión, sobre las primitivas exactas: un pilar gana a la losa que lo rodea. En el tema claro, los colores son los de `fem render`. En el oscuro cambian los neutros, y lo que es dato (bandas, diagramas, cargas) queda igual.

**Cada número, de una consulta.** `datos.ts` no calcula nada propio. Sólo elige la consulta y las combinaciones:

| Pantalla | Consultas |
|---|---|
| Losas | `vistaCampo` y `flechas` (losa a losa). El valor de un punto, con `valoresCampo` y la interpolación de las bandas |
| Vigas | `pieza` (vanos), `envolventePieza` y `diagramaCombinado` (el cursor) |
| Pilares | `pieza` (tramos) y ν con la fórmula y las combinaciones de A3 |
| Desplomes | `deriva` |
| Revisión | `revisar` |

**Combinaciones.** «Por defecto» son las de las consultas de A1 y el render de A4. El selector ofrece además la envolvente de cada situación, cada combinación suelta y cada caso. Un mapa se dibuja en la combinación de mayor |valor| de las elegidas, y se dice cuál.

**Origen y recarga.** Hay dos orígenes que se vigilan:
- la carpeta (File System Access, Chrome y Edge, elegida por el usuario);
- una URL del servidor local, para la línea de órdenes y para el banco, que no puede elegir carpetas.

Cada segundo se mira un sello (fecha y tamaño, o ETag) del proyecto y de su fichero de firmas. Si cambia, los resultados se marcan como desactualizados en el acto, se lee el fichero y se carga otra vez. La planta, la pantalla y la selección viven fuera de la sesión: se conservan si siguen existiendo.

## 3. Hallazgos

| # | Hallazgo | Consecuencia |
|---|---|---|
| V1-1 | En el edificio objetivo, compilar cuesta 0,85 s, la primera recuperación SPR de una planta ~0,3 s y la revisión 5,5 s. El worker de E4 sólo calcula | Worker de sesión: proyecto, compilación, resultados y consultas viven en él, y el hilo principal sólo dibuja |
| V1-2 | `flechas()` sin losa recorre todas las losas del edificio: 69 ms frente a 1 ms con sólo las de la planta | Losas pide las flechas losa a losa (mismo resultado, comprobado frente a la consulta completa) |
| V1-3 | La primera magnitud de momentos o cortantes de una planta: ~300 ms de SPR y ~130 ms de bandas (en Node). En Chrome, 486, 490, 490 y 592 ms en cuatro pasadas: varía con la carga de la máquina, alrededor del límite de 500. Con más casos crece, porque el SPR es caso a caso (C5-4). Las veces siguientes, la misma planta va en ~120 ms | El worker adelanta el SPR de la planta en cuanto enseña uz. El banco pulsa M11 sin pausa, así que no se beneficia; con una pausa humana, sí. Lo que lo arregla de verdad es C5-4: ver «Pendiente» |
| V1-4 | Losas fallaba entera en un modelo sin losas (1022): `flechas` da error «sin losas» | «Sin losas» es una lista vacía; la pantalla enseña la planta y lo dice |
| V1-5 | El valor de un punto en el nudo de un extremo daba «sin mapa» si la primera lámina que lo contiene era rígida. En el borde de dos regiones SPR (pliegue, ábaco; E5-7) hay dos valores | Se salta las láminas sin mapa y da todos los valores del punto («salto: también …»), sin promediar |
| V1-6 | En Windows, `/@fs/` de Vite 8.3 devuelve el `index.html` para cualquier ruta de otra unidad que la del repo, aunque esté permitida | `bun run visor` sirve la carpeta del proyecto con un middleware propio en `/proyecto/` (sólo GET y HEAD, sólo esa carpeta) |
| V1-7 | `.fem/` guardaba la huella y el núcleo, pero no un resumen de los bytes: un `resultados.bin` del mismo tamaño con un bit cambiado se reutilizaba sin aviso, en la CLI y en el visor | `resultados.json` lleva el sha256 de `resultados.bin`. La CLI no reutiliza unos resultados sin él o que no casan (los de antes se recalculan una vez) y el visor tampoco, diciendo por qué |
| V1-8 | Reconstruir el 3D del edificio (33 000 láminas) en el hilo principal pasaba de 50 ms | Las geometrías se crean una vez; la deformada y su escala reescriben posiciones y normales, y la planta activa y el tema, colores, con bucles planos (H42) |
| V1-9 | En Chrome headless con render por software (SwiftShader), el cursor de una viga y el giro del 3D iban a ~140 ms por paso; con la GPU, a 12–16 | El banco usa la GPU. Las cifras de software no representan el uso |
| V1-10 | El cursor de una viga y la envolvente difieren ≤ 1e-12 relativo en el mismo punto: el cursor evalúa en x = s − s₀, con un redondeo más | Aceptado y explicado en el test, que compara a 1e-12 |
| V1-11 | Vigilar el fichero de firmas, cuando aún no existe, daba un 404 por segundo en la consola | Los dos servidores del visor contestan a un HEAD de lo que no existe con 204 y `x-existe: no` |

## 4. Pendiente

- **Del usuario:**
  - **Criterio 6 (puerta de uso).** Revisar con el visor los tres proyectos de A2 y decir si le sirve; lo que falte, para V1.1 o V2. Hay dos formas de abrirlo:
    - `bun run visor validacion/a2/agente/edificio/proyecto.json`;
    - `bun run visor:dev` y «Abrir la carpeta del proyecto…».
  - **Abrir una carpeta** (File System Access) no se puede automatizar, porque el navegador exige que la elija una persona. Comparte con la URL todo salvo la lectura de ficheros, pero falta probarlo a mano.
  - **Criterio 4, a medias (V1-3).** Decidir entre:
    - aceptarlo así, porque sólo afecta a la primera magnitud de momentos de cada planta y el SPR se adelanta mientras se mira uz;
    - o adelantar C5-4 (la recuperación SPR más rápida, aplazada), que además importa más con proyectos reales de más casos.
  - **2026-10-24, tras LV2** (la malla del edificio con vigas, ×2,5): M11 en 1,07 s, la planta N2 en 0,69 s y abrir con `.fem/` en 3,3 s. Los mapas calculan sólo la partición del campo (M y Q, o N), lámina a lámina con todos los casos seguidos, y el worker prepara los campos SPR en cuanto tiene resultados (mismos bits). Lo de `.fem/` es la compilación: por decisión del usuario, el criterio pasa a ser el dibujo (`visor.md` §3.3) y los resultados se dan como información. Medido después, con la máquina libre (`out_chrome.txt`): M11 en 380 ms, la planta N2 en 317 ms, el dibujo de `.fem/` en 0,20 s (los resultados, en 2,84 s) y ninguna tarea larga. Pasan los criterios 2 a 5.
- **Técnico:**
  - sólo se midió en Chrome de sobremesa; Edge debería ir igual (es Chromium), y Firefox abre ficheros sueltos pero no carpetas;
  - el móvil, IndexedDB y offline van con V3 (V-c);
  - el formato de `.fem/` cambió (V1-7): `fase-a0-a2.md` describe el anterior.

## Cómo reproducir

```
bun run test:run                     # incluye src/visor/visor.test.ts (criterios 1, 2 y 3 en Node)
cd app && bun install && bun run test:run && bun run typecheck   # test de DOM (criterio 1)
node validacion/v1/chrome.ts         # banco en Chrome (criterios 2 a 5); escribe validacion/v1/out_chrome.txt
bun run visor <proyecto.json>        # abrir el visor sobre un proyecto
```
