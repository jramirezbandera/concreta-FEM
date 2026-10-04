# Fase E4 — núcleo WASM, worker y memoria: resultado

> **Fecha:** 2026-10-04. **Plan:** S7 de `investigacion-id.md` (fase E4: «crate, API, artefacto versionado, CI, worker y memoria»), con H16 (memoria), H20 (cancelar) y H27 (frontera worker → UI). El crate, la API y el artefacto versionado salieron ya del spike E0; aquí se añaden el worker, la memoria y la medida en Chrome.
> **Veredicto: pasan los seis criterios.**
> - El worker da los mismos bits que `calcular()`: en Node, los modelos congelados de E1–E3; en Chrome 154, la huella del edificio objetivo coincide con la de Node.
> - Los resultados vuelven por Transferable sin bloquear el hilo principal (111 MB en 24 casos).
> - Cancelar rechaza en 0,2 ms y el worker siguiente está listo en ~10 ms: S7 estimaba ~0,1 s.
> - Un modelo que no cabe se rechaza antes de factorizar, con un diagnóstico; ni el agotamiento de memoria del núcleo ni una trampa del WASM dejan un cuelgue o un resultado.
> - **Hallazgo principal (E4-1):** la memoria de un cálculo es sobre todo JS, no del núcleo, y un worker caliente no la devuelve. En portátil y móvil el worker se recicla tras cada cálculo.
>
> **Cómo leerlo:** la tabla resume los criterios, que salen de S7 y de las recomendaciones de H16, H20 y H27. Cada sección da el detalle y la evidencia. Los hallazgos que cambian algo del plan están en «Hallazgos de E4».

| # | Criterio | Resultado | Evidencia |
|---|---|---|---|
| 1 | El worker da los mismos bits que `calcular()`: en Node, con los modelos congelados de E1–E3; en Chrome, con el edificio objetivo frente a Node | **Pasa.** Node (`worker_threads`): los 7 modelos congelados y uno con diagnóstico, bit a bit y en cola en un mismo worker. Chrome 154: la huella del edificio objetivo (diafragma y semirrígido, 24 casos) es la de Node 24.19 en las seis pasadas | `src/worker/cliente.test.ts`; `validacion/e4/out_chrome.txt` |
| 2 | La frontera worker → UI no usa JSON ni bloquea el hilo principal (H27) | **Pasa.** Los resultados van por Transferable y en el worker quedan vacíos. Recibir 111 MB no da ninguna tarea larga. La única es enviar el modelo analítico: 61–74 ms (E4-3) | `cliente.test.ts`; `out_chrome.txt` |
| 3 | Cancelar (H20): rechazo inmediato, worker listo en ≤ 0,1 s (S7) y el siguiente cálculo igual | **Pasa.** En Chrome, cancelar en plena factorización del semirrígido rechaza en 0,1–0,2 ms y el worker nuevo está listo en 7–13 ms. El cálculo siguiente da la misma huella | `out_chrome.txt`; `cliente.test.ts` |
| 4 | Memoria (H16): la del núcleo en cada fase; límites por dispositivo que rechazan antes de factorizar; agotarla nunca deja un cuelgue ni un resultado; reciclar la devuelve | **Pasa.** El pico estimado queda por encima del real en los 6 modelos de la calibración, también con fragmentación. Pasar del límite de ecuaciones o de memoria da `modelo/demasiado-grande` sin factorizar (el perfil móvil, en 0,44 s). Sin memoria → `solver/sin-memoria`; trampa del WASM → `ErrorWorker`; en los dos casos se recicla el worker. En Chrome, terminar el worker tras el semirrígido devuelve 600–710 MB | `src/motor/memoria.test.ts`, `cliente.test.ts`; `out_calibrar_memoria.txt`, `out_chrome.txt` |
| 5 | Núcleo versionado: API con la memoria antes de factorizar, ≤ 1,5 MB y sha256 reproducible | **Pasa.** API 2: 252 KB (80 KB en gzip); `nucleo:verificar` da el mismo hash desde cero | `src/nucleo/pkg/MANIFIESTO.json`, `src/nucleo/nucleo.test.ts` |
| 6 | CI en verde en GitHub (pendiente desde E0) | **Pasa.** Run 37198215432 del 2026-10-04: pruebas (tsc y los 412 tests, con Node 24 por las pruebas del worker) en 45 s; núcleo (recompilar, sha256 idéntico y `cargo test`) en 4 min. El CI ya había salido verde con el push del spike E0, el 2026-10-03 | `.github/workflows/ci.yml` |

---

## 1. Qué hay nuevo

| Fichero | Qué hace |
|---|---|
| `kernel/src/` | API 2 del núcleo: `memoriaRequerida(nrhs)` (bytes de L y de la memoria de trabajo de faer, del análisis simbólico y sin reservar) y `memoriaEnUso()` (un `GlobalAlloc` que cuenta los bytes vivos) |
| `src/nucleo/index.ts` | `FactorLdlt.memoriaRequerida`, `memoriaEnUsoNucleo()` y `ErrorSinMemoria` |
| `src/motor/calcular.ts`, `solucion.ts` | Opciones `limites` (ecuaciones y memoria del núcleo) y `alProgreso`; el análisis simbólico pasa a ser la subfase `solucion.analisis`; diagnósticos `modelo/demasiado-grande` y `solver/sin-memoria`; `estadisticas.memoriaNucleo` |
| `src/worker/protocolo.ts` | Mensajes entre el hilo principal y el worker, y `transferibles()` |
| `src/worker/atender.ts` | Lo que hace el worker con cada mensaje; es el mismo código en el navegador y en Node |
| `src/worker/worker.ts` | Entrada del worker en el navegador |
| `src/worker/cliente.ts` | `ClienteMotor`, la versión asíncrona de `calcular()`, y `crearWorkerWeb` |
| `src/worker/limites.ts` | Límites por perfil de dispositivo (`LIMITES`) y detección del perfil desde `navigator` |
| `src/pruebas/workerNodo*.ts` | El worker en `worker_threads`, con dos mensajes de prueba para provocar fallos |
| `validacion/e4/` | Calibración de la memoria, memoria JS por fase y el banco en Chrome (automático y para dispositivos) |

**Uso desde Concreta** (con Vite):

```ts
import urlNucleo from "…/nucleo/pkg/nucleo_bg.wasm?url";
const nucleo = WebAssembly.compileStreaming(fetch(urlNucleo));          // una vez por sesión
const perfil = perfilDispositivo(infoNavegador(navigator));
const cliente = new ClienteMotor({
  crearWorker: crearWorkerWeb(() => new Worker(new URL("…/worker/worker.ts", import.meta.url), { type: "module" })),
  nucleo,
  limites: LIMITES[perfil],
  umbralReciclaje: LIMITES[perfil].umbralReciclaje,
});
void cliente.calentar();                                               // al entrar en el módulo
const r = await cliente.calcular(modelo, { alProgreso: (p) => … });    // el mismo ResultadoCalculo que calcular()
cliente.cancelar();                                                    // botón «Cancelar»
cliente.cerrar();                                                      // al salir del módulo
```

`calcular()` rechaza con `ErrorCancelado` o `ErrorWorker`; nunca resuelve con un resultado a medias. Un modelo demasiado grande o un agotamiento de memoria del núcleo no son excepciones: llegan como un `ResultadoCalculo` no válido con su diagnóstico.

## 2. Núcleo v2: la memoria antes de factorizar

**Qué se hizo.**
- `memoriaRequerida(nrhs)` suma los bytes de los valores de L (`len_val`) y los `StackReq` de faer para factorizar y para resolver `nrhs` lados derechos, más el propio bloque de lados. No reserva nada.
- `memoriaEnUso()` cuenta los bytes vivos con un asignador global que envuelve al del sistema (dlmalloc en wasm32). La memoria lineal sólo crece (H16); esto dice cuánta está ocupada de verdad.
- El motor estima el pico tras el análisis simbólico: max(memoria lineal, en uso + 1,15 · requerida). Si pasa de `limites.memoriaNucleo`, el cálculo acaba con `modelo/demasiado-grande` antes de factorizar.
- **Artefacto:** 252 129 B (79 746 B en gzip), frente a 239 295 B de la API 1. El sha256 es reproducible: `bun run nucleo:verificar` recompila desde cero y da el mismo hash.

**Calibración** (`validacion/e4/calibrar-memoria.ts` → `out_calibrar_memoria.txt`). Edificio objetivo con 24 casos, Node 24, en un proceso nuevo por modelo; luego, el mismo cálculo cuatro veces más en el mismo núcleo.

| Modelo (malla) | Ecuaciones | Pedida por faer | Pico estimado | Memoria lineal real, núcleo nuevo | Real al repetir (vueltas 2.ª–5.ª) |
|---|---|---|---|---|---|
| Diafragma (1,5 m) | 11 298 | 14 MB | 19 MB | 18 MB | 18 MB |
| Semirrígido (1,5 m) | 22 554 | 43 | 57 | 48 | 48 |
| Diafragma (1,0 m) | 38 430 | 48 | 64 | 57 | 57 |
| Semirrígido (1,0 m) | 76 818 | 146 | 195 | 162 | **189** |
| Diafragma (0,75 m) | 76 146 | 110 | 145 | 128 | 128 |
| Semirrígido (0,75 m) | 152 250 | 338 | 443 | 369 | **424** |

**Lecturas:**
- **Sin margen** (en uso + pedida), la estimación queda en un núcleo nuevo entre un 6 % por debajo (modelos pequeños, por la memoria inicial y el redondeo a páginas) y un 7 % por encima.
- **Al repetir en el mismo núcleo, la fragmentación cuesta hasta un 9 %:** los huecos que deja libres el cálculo anterior no siempre sirven (369 → 424 MB). Se estabiliza en la segunda vuelta.
- **Con el margen de ×1,15,** la estimación queda siempre por encima de la memoria real: entre un 3 % y un 21 %.
- **No hay fugas:** tras cada cálculo, la memoria en uso vuelve al mismo valor. Sólo quedan 512 B y una reserva fija de 512 KiB que hace `gemm` (su búfer de empaquetado) en la primera factorización densa, y no crece después.

## 3. Límites por dispositivo (D9)

`calcular()` acepta `limites: { ecuaciones, memoriaNucleo }`:
- **Ecuaciones:** se comprueban tras numerar, antes de ensamblar. Es la comprobación barata.
- **Memoria del núcleo:** se comprueba tras el análisis simbólico, con la estimación de la §2. Es la precisa.

Las dos acaban con `modelo/demasiado-grande` y nombran el número de ecuaciones y el límite. Con el solver de perfil sólo se aplica la primera.

Los perfiles (`src/worker/limites.ts`) son **provisionales** hasta medir en portátil y móvil (S5 #2):

| Perfil | Ecuaciones | Memoria del núcleo | Reciclar el worker | Qué cabe del edificio objetivo |
|---|---|---|---|---|
| Sobremesa | 600 000 | 2,5 GiB | Si el núcleo pasa de 1,25 GiB | Todo (S7: ≈ 600 000 GDL en 10 s) |
| Portátil | 300 000 | 1,25 GiB | Tras cada cálculo | Semirrígido (152 250 ecuaciones, 370 MB de núcleo) |
| Móvil | 100 000 | 384 MiB | Tras cada cálculo | Con diafragma (76 146 ecuaciones, 128 MB); el semirrígido, no |

**El perfil** sale de `navigator`:
- es móvil si lo dice `userAgentData.mobile`, el agente de usuario, o si es un iPad que se presenta como Mac táctil;
- es sobremesa si `deviceMemory` ≥ 8;
- en otro caso es portátil, que es el perfil prudente para Safari y Firefox, que no dan `deviceMemory`.

## 4. Worker y cliente

**Protocolo** (`protocolo.ts`). Sin Comlink: son cuatro mensajes de vuelta y la cancelación no pasa por él.
- `iniciar` lleva el núcleo ya compilado (un `WebAssembly.Module`, que se puede clonar entre hilos). Arrancar un worker cuesta instanciarlo, no compilarlo.
- `calcular` lleva el modelo y las opciones (solver y límites).
- De vuelta llegan `listo`, `progreso` (fase, ms y memoria del núcleo), `resultado` y `fallo`.
- **Resultados:** viajan por Transferable. `transferibles()` reúne los `ArrayBuffer` de todos los casos sin repetir, porque transferir dos veces el mismo es un error.
- **Diagnósticos y fallos:** los diagnósticos van dentro del resultado. Una excepción del motor (no un diagnóstico) es `fallo`: puede venir de una trampa del WASM, y el worker deja de ser fiable.

**Cliente** (`cliente.ts`):
- **Cola de uno en uno.** El worker no atiende mensajes mientras calcula. El cliente envía el siguiente cálculo cuando llega el resultado del anterior, y no antes de que el worker esté `listo`.
- **Cancelar** es `terminate()`: rechaza lo pendiente con `ErrorCancelado` y calienta otro worker (H20). Es el patrón de `cancelAndRewarm` de taludes en Concreta.
- **Reciclar:**
  - tras un cálculo cuya memoria lineal pase de `umbralReciclaje` (0 por defecto, es decir, siempre: E4-1);
  - y siempre tras un `fallo` o una caída del worker.

  El worker nuevo se calienta en segundo plano, y los mensajes del worker terminado se descartan por generación.
- **Reposo:** con `reposoMs`, el worker se termina tras ese tiempo sin cálculos y se vuelve a arrancar al calcular.
- **Fallo al arrancar:** si el núcleo no compila o no carga, se rechaza todo lo pendiente con `ErrorWorker` sin reintentar en bucle.

**Pruebas** (`src/worker/cliente.test.ts`, con workers de verdad en `worker_threads` y el núcleo compilado una vez):

| Qué | Resultado |
|---|---|
| Los 7 modelos congelados de E1–E3 y uno con diagnóstico, en cola en un mismo worker | Bit a bit iguales a `calcular()` en el hilo principal: los cuatro `Float64Array` de cada caso, los diagnósticos y las estadísticas (salvo tiempos y el pico de memoria, que dependen del hilo) |
| Transferencia | 4 buffers por caso, sin repetir; tras enviarlos, en el emisor tienen `byteLength` 0 |
| Avance | Una llamada por fase, con la memoria del núcleo |
| Cancelar al acabar el ensamblado de un modelo de ~1 s | El cálculo en curso y el de la cola se rechazan en < 50 ms; el siguiente cálculo da los mismos bits |
| Excepción del motor, caída del worker, núcleo que no compila | `ErrorWorker`; el worker se recicla y la cola sigue; sin bucles |
| Memoria del núcleo llena hasta dejar 8 MB libres | `solver/sin-memoria` (un resultado no válido, no una excepción) y el worker se recicla |
| Memoria del núcleo llena del todo | Trampa del WASM (`RuntimeError: unreachable`) → `ErrorWorker`; el worker se recicla y el siguiente cálculo da los mismos bits |
| Límites del perfil, reciclaje por umbral, reposo, cerrar | Lo esperado en cada caso |

## 5. En Chrome

`validacion/e4/chrome.ts`:
1. empaqueta la página (`pagina.ts`) y el worker con `bun build` (el worker ocupa 127 KB sin minificar);
2. los sirve en local y los abre en Chrome 154 headless con un perfil temporal;
3. el servidor lee con PowerShell la memoria privada de los procesos de esa instancia en cada punto de control;
4. al terminar, calcula en Node la huella de los mismos modelos.

Seis pasadas. Las cifras son de la última (`out_chrome.txt`), con el rango de las seis donde varía.

**Arranque y cancelación:**

| Qué | Chrome 154 |
|---|---|
| Compilar el núcleo (`compileStreaming`, una vez por sesión) | 2,1–2,5 ms |
| Arrancar un worker en frío hasta `listo` | 6,5–8,5 ms |
| Cancelar en plena factorización: rechazo de la promesa | 0,1–0,2 ms |
| Cancelar: hasta que el worker nuevo está listo | 7–13 ms |

**Edificio objetivo por el worker** (24 casos). Como referencia, el banco de E3 con `calcular()` directo en Node: 3,08 y 4,71 s.

| | Diafragma, worker recién arrancado | Diafragma, worker caliente | Semirrígido |
|---|---|---|---|
| Total visto desde el hilo principal | 3,19 s (3,02–3,19) | 2,59 s (2,56–2,64) | 4,70 s (4,70–4,91) |
| Cálculo dentro del worker | 3,01 s | 2,45 s | 4,55 s |
| Tareas largas del hilo principal (= enviar el modelo) | 74 ms | 61 ms | 67 ms |
| Memoria del núcleo: lineal / pico estimado | 128 / 145 MB | 128 / 146 MB | 355 / 443 MB |
| Equilibrio / error hacia atrás | 2,1e-11 / 5,0e-15 | igual | 2,9e-12 / 2,5e-13 |
| Huella (la misma en Node) | `697c0376dc704188` | igual | `210f09f58fe8a595` |

**Memoria privada de los procesos de Chrome.** El worker vive en el proceso del renderer. Lo que queda tras terminar el worker es del hilo principal: los modelos generados y los resultados recibidos.

| Momento | Renderer | Todos los procesos |
|---|---|---|
| Página cargada | 116 MB | 194 MB |
| Worker caliente | 125 | 210 |
| Tras el edificio con diafragma | 930 | 1 021 |
| 10 s después, con el worker vivo y en reposo | 909 | 1 002 |
| Tras repetirlo en el mismo worker | 1 143 | 1 237 |
| Tras el semirrígido | 1 428 | 1 522 |
| 2 s después de terminar el worker | 719 | 813 |

**Reciclar tras cada cálculo.** El edificio con diafragma, tres veces con `umbralReciclaje: 0` (un worker nuevo cada vez):
- **Lo habitual:** 2,77–2,92 s frente a 2,56–2,64 s con el worker caliente, es decir, **un 7–12 % más** en cuatro de las seis pasadas.
- **De dónde sale la diferencia:** casi entera de la fase de cargas, que pasa de 250–270 ms con el JIT caliente a 440–520 ms.
- **Dos pasadas fueron más lentas:** en una, un cálculo dio 3,42 s (cargas: 697 ms); en otra, los tres dieron 4,6–5,7 s (no se registraron las fases).
- **Una posible explicación, sin comprobar:** en el banco, cada cálculo empieza 100 ms después de terminar un worker que suelta ~700 MB, y eso puede coincidir con que el sistema esté liberando esa memoria. En uso real, el siguiente cálculo llega minutos después.

**Límite del perfil móvil:** el semirrígido acaba con `modelo/demasiado-grande` en 0,44 s, sin ensamblar.

## 6. Medida en dispositivos

`node validacion/e4/chrome.ts --dispositivos` sirve la misma página en la red local. En el dispositivo se abre `http://<IP>:8765/?manual` y se pulsa «Medir»:
- la página calcula tamaños crecientes del edificio objetivo, con un worker nuevo para cada uno y sin límites, hasta donde aguante;
- manda cada resultado al servidor en cuanto sale (`out_dispositivos.jsonl`), con el agente de usuario, el perfil detectado y `deviceMemory`.

Con `--local` hace lo mismo en esta máquina, con Chrome headless. Es la primera fila de la tabla (perfil detectado: sobremesa, `deviceMemory` = 32):

| Variante | Nudos | Ecuaciones | Total | Memoria del núcleo |
|---|---|---|---|---|
| Diafragma, malla 1,5 m, 5 casos | 7 601 | 11 298 | 0,56 s | 16 MB |
| Diafragma, 1,0 m, 5 casos | 16 647 | 38 430 | 1,14 s | 50 MB |
| Diafragma, 0,75 m, 5 casos | 29 221 | 76 146 | 1,82 s | 114 MB |
| Diafragma, 0,75 m, 24 casos | 29 221 | 76 146 | 2,86 s | 128 MB |
| Semirrígido, 1,0 m, 24 casos | 16 640 | 76 818 | 2,50 s | 162 MB |
| Semirrígido, 0,75 m, 24 casos | 29 214 | 152 250 | 4,92 s | 369 MB |
| Diafragma, 0,5 m, 24 casos | 64 953 | 183 330 | 6,16 s | 337 MB |

Faltan el móvil y el portátil (S5 #2), que tiene que medir el usuario en sus dispositivos.

## Hallazgos de E4

| ID | Hallazgo | Consecuencia |
|---|---|---|
| E4-1 | **La memoria de un cálculo es sobre todo JS, no del núcleo, y un worker caliente no la devuelve.** En Chrome, el renderer sube ~800 MB con el edificio de diafragma (128 MB de núcleo) y no baja con el worker en reposo (931 → 909 MB a los 10 s); terminar el worker devuelve ~610 MB tras el semirrígido. En Node, en el pico hay 129 MB de heap y 196–274 MB de `Float64Array` vivos antes de que crezca el núcleo, y el RSS llega a 753 / 1 020 MB. Un worker no puede medir su heap JS: `performance.memory` no existe dentro de un worker | El reciclaje no puede depender sólo de la memoria del núcleo. Por defecto, y en portátil y móvil, el worker se recicla tras cada cálculo; en sobremesa, cuando el núcleo pasa de 1,25 GiB. Reducir la memoria JS del motor es la palanca para el móvil (ver «Pendiente») |
| E4-2 | **Arrancar un worker con el núcleo ya compilado cuesta 7–13 ms,** y compilar el `.wasm` 2–2,5 ms (una vez por sesión). S7 estimaba ~0,1 s, y con Pyodide eran 5 s (H20) | Cancelar y reciclar son baratos. El precio de reciclar es el JIT caliente: un 7–12 % más por cálculo, casi todo en la fase de cargas. Dos de seis pasadas fueron más lentas, con los cálculos encadenados 100 ms después de terminar el worker anterior |
| E4-3 | **Enviar el modelo analítico del edificio objetivo bloquea el hilo principal 61–74 ms** (el clonado estructurado de unos 200 000 objetos). Recibir 111 MB de resultados por transferencia no llega a tarea larga | En Concreta el compilador va dentro del worker (informe 08, §4: «un solo worker compila y resuelve») y lo que cruza es el modelo físico, que es pequeño. Si alguna vez hubiera que enviar el analítico, se empaqueta en arrays tipados |
| E4-4 | **Repetir un cálculo en el mismo núcleo fragmenta su memoria:** la lineal llega hasta un 9 % por encima de en uso + pedida, y se estabiliza en la 2.ª vuelta | Margen de ×1,15 en el pico estimado. Con el reciclaje tras cada cálculo apenas cuenta |
| E4-5 | **El núcleo no pierde memoria.** La memoria en uso vuelve a su nivel tras cada cálculo; sólo queda una reserva fija de 512 KiB (el búfer de empaquetado de `gemm`) desde la primera factorización densa | Queda como prueba de propiedades (`src/motor/memoria.test.ts`, `src/nucleo/nucleo.test.ts`) |
| E4-6 | **Chrome 154 y Node 24 dan los mismos bits** en el edificio objetivo, con dos versiones distintas de V8 | Las referencias congeladas y los oráculos, medidos en Node, valen tal cual para el navegador |
| E4-7 | **Agotar la memoria del núcleo puede acabar en una trampa del WASM,** cuando falla una reserva que Rust no deja fallar (por ejemplo, al pasar los arrays del patrón por wasm-bindgen). Con 8 MB libres, en cambio, falla limpio en un `try_reserve` | El cliente trata la trampa como `ErrorWorker` y recicla. El límite de memoria del perfil evita llegar ahí |
| E4-8 | **`navigator.deviceMemory` ya no se queda en 8:** Chrome 154 da 32 en este equipo | El perfil de sobremesa pide ≥ 8. Safari y Firefox no lo dan y caen en el de portátil |

## Pendiente

- **Medir en móvil y portátil** (S5 #2):
  1. `node validacion/e4/chrome.ts --dispositivos`;
  2. abrir en el dispositivo `http://<IP>:8765/?manual`, en la misma red, y pulsar «Medir». Windows pedirá permiso al cortafuegos para Node.

  Cada tamaño se manda al servidor en cuanto sale (`out_dispositivos.jsonl`), así que, si la pestaña se cae, queda el último que cupo. La fila de este equipo ya está. Con esos datos se fijan los valores de `LIMITES`, hoy provisionales.
- **Memoria JS del motor** (E4-1). Con 24 casos, el edificio objetivo tiene ~270 MB en vectores de 6·nudos por caso: cargas, desplazamientos independientes, totales, lados derechos, equivalentes de lámina, u, reacciones y su magnitud. Varios se pueden fundir o liberar antes. Es lo que haría caber el semirrígido en un móvil.
- **Integración en Concreta:**
  - el compilador corre dentro del worker (E4-3);
  - el `.wasm` se carga con `?url` de Vite, y el worker con `new URL("./worker.ts", import.meta.url)`;
  - `reposoMs` o `cerrar()` al salir del módulo (H16, punto 3).
- **E0-1** (faer en WASM ~4,5× más lento que en nativo): relaxed-simd, factorizar en f32 y refinar. No hace falta para el objetivo.
- **Safari y Firefox:** sin `longtask` en Safari ni `deviceMemory` en ninguno de los dos. Se miden con el modo de dispositivos.

## Cómo reproducir

```sh
bun run test:run                                                  # todos los tests (E0–E4 y Fase 1)
bun run nucleo:verificar                                          # recompila el núcleo y compara el sha256 (necesita Rust)
node validacion/e4/calibrar-memoria.ts 0.75 semirrigido 24 5      # estimación frente a memoria real → out_calibrar_memoria.txt
node --expose-gc validacion/e4/memoria-js.ts 0.75 diafragma 24    # memoria JS del motor por fase → out_memoria_js.txt
node validacion/e4/chrome.ts                                      # banco en Chrome headless → out_chrome.txt
node validacion/e4/chrome.ts --dispositivos --local               # tamaños crecientes en esta máquina → out_dispositivos.jsonl
node validacion/e4/chrome.ts --dispositivos                       # lo mismo desde un móvil: http://<IP>:8765/?manual
```
