> **Informe original del Área 4 — Plataforma web**, generado por un subagente el 2026-10-03.
> El documento consolidado es `../investigacion-id.md`; esto es el detalle con toda la evidencia.
> Los scripts y salidas citados están ahora en `experimentos/04-plataforma/`; las rutas absolutas
> del texto apuntan a la carpeta temporal de la sesión que los ejecutó.

# Área 4 — Plataforma web: Worker, visor 3D, rendimiento, offline y persistencia

## Resumen (≤ 10 líneas)

La cancelación de §14 sólo funciona con `terminate()`. Un mensaje `cancel` no llega a un worker ocupado, y la interrupción por `SharedArrayBuffer` (que además exigiría un `coi-serviceworker` que no puede convivir con el SW de Workbox) no detiene SuperLU. Cada cancelación cuesta unos 5 s de re-arranque (Pyodide + scipy). Un worker caliente ocupa unos 335 MB y la memoria WASM no se devuelve hasta que se termina el worker. El motor con scipy pasa de 15,7 a 29,3 MiB offline. El primer uso por enlace directo no queda en caché, porque falta `clientsClaim`. Un scipy adelgazado de 7,1 MiB basta para PyNite 3.2.0, con stubs de matplotlib y prettytable.

En el visor, Three.js directo pesa 131–170 KiB gz, frente a 318–333 de R3F+drei, y el React Compiler 1.0 lo compila sin saltos. Instanciar o fusionar la geometría es obligatorio: 14 ms por frame contra 0,5 ms. Con 200 k triángulos, la geometría, el BVH, el JSON y la huella deben salir del hilo principal, porque superan los 50 ms. Picking con BVH y `indirect` o con un id por vértice. Mapas de lámina sin interpolar el color, porque el 73 % de los píxeles saldría fuera de la leyenda. El modelo físico va en localStorage con ids cortos y los resultados en IndexedDB por huella.

## Hallazgos

### PLA-01 · Un worker ocupado en `runPython` no atiende el mensaje `cancel` de §14.1 hasta que termina; sólo `terminate()` corta el cálculo
- **Soporte:** A — experimento propio en Chrome 153 (`bench/cancel_msg.js`).
- **Prioridad:** P0
- **Afecta a:** §14.1, §14.2, §9 (`SolverContext.signal`), §21 «puede cancelarse» — corrige
- **Hallazgo:** un Web Worker atiende una tarea cada vez. Mientras ejecuta código síncrono, los mensajes entrantes se quedan en cola, y eso es lo que hace Pyodide: `runPython` y `spsolve` bloquean el hilo del worker. En la prueba, un trabajo síncrono duraba 2 s y el `cancel` se envió a los 100 ms. Se atendió a los 2 000 ms, después de que el worker ya hubiera enviado `success`. En sentido contrario sí funciona: los `progress` que el worker emite en mitad del trabajo llegan al hilo principal con 4 ms de retraso. Por tanto, ni el mensaje `cancel` ni un `AbortSignal` pasado al adaptador dentro del worker pueden parar a PyNite.
- **Evidencia:**
  - `bench/cancel_msg.json` → `success` a msMain 2004; `cancel-recibido` con `msDesdeInicioSolve: 2000`.
  - `bench/progreso.json` → etapas recibidas a 504/1004/1504 ms, enviadas a 500/1000/1500 ms.
- **Recomendación:** quitar `cancel` del protocolo hacia el worker de Pyodide. Cancelar consiste en tres pasos en el cliente del hilo principal:
  - `terminate()`;
  - rechazar las promesas pendientes;
  - recrear el worker.

  Es lo que ya hace `src/lib/calculations/geotech/client.ts` (`terminatePySlope`/`cancelAndRewarm`). Mantener `progress` del worker a la UI, emitiéndolo desde Python con una función JS inyectada en cada etapa. Si la compilación y el mallado en TS van en otro worker y trocean el trabajo con `await`, a ese worker sí le sirve un `cancel` por mensaje.

### PLA-02 · Con `SharedArrayBuffer`, la interrupción de Pyodide corta un bucle Python en 4 ms pero no la factorización de SuperLU
- **Soporte:** A — experimento propio con COOP/COEP en un servidor local (`bench/server.mjs --coi`, `pyo.js → interrupcion`).
- **Prioridad:** P0
- **Afecta a:** §14.2 («si Pyodide/PyNite no puede interrumpir con seguridad…»), §23-9 — confirma `terminate()` y añade el límite del interrupt
- **Hallazgo:**
  - En un bucle Python, `pyodide.setInterruptBuffer(Int32Array(SAB))` con `ia[0]=2` lanzó `KeyboardInterrupt` 4 ms después de la señal.
  - En `scipy.sparse.linalg.splu` sobre un laplaciano 2D de 10⁶ GDL, la señal se envió a los 400 ms y no tuvo efecto. La llamada siguió 21,2 s hasta morir por `MemoryError` («Unable to allocate 580 MiB»).
  - La documentación de Pyodide dice que el código C sólo se interrumpe si llama a `PyErr_CheckSignals()`.

  Incluso con aislamiento de origen, la fase más larga de un modelo grande (factorizar) no se puede cancelar sin `terminate()`.
- **Evidencia:**
  - `bench/pyodide_con_coi.json` → `bucle: KeyboardInterrupt, msDesdeSenal 4`; `splu: _ArrayMemoryError…, msDesdeSenal 21173`.
  - https://pyodide.org/en/stable/usage/keyboard-interrupts.html (documentación 314.0.7).
- **Recomendación:** no justificar COOP/COEP por la cancelación. El interrupt sólo tendría valor si el área 1 demuestra que el ensamblado en Python de PyNite domina el tiempo. Aun así, el camino garantizado sigue siendo `terminate()`.

### PLA-03 · `coi-serviceworker` 0.1.7 no puede convivir con el SW de Workbox: usa el mismo scope, se activa solo y sirve todo desde la red
- **Soporte:** A — código fuente leído (gzuidhof/coi-serviceworker, commit 7b1d2a0, v0.1.7) y `curl -I` de concreta.tools. Lo de una registration por scope es B (especificación de Service Workers).
- **Prioridad:** P0
- **Afecta a:** §14.2, §2.3-1, §9.1 offline — añade (descarta la vía COOP/COEP sobre GitHub Pages)
- **Hallazgo:** GitHub Pages no envía COOP/COEP: `curl -I https://concreta.tools/` no los devuelve, y GitHub no ofrece cabeceras propias (community #13309). El parche habitual es `coi-serviceworker`, pero choca con la PWA en varios puntos:
  - Se registra a sí mismo con el scope de su carpeta (`register(currentScript.src)`, l.124). Tiene que ir junto a `index.html`, así que su scope es `/`, el mismo que el de `/sw.js`. Registrar otro script en un scope existente sustituye el script de esa registration, de modo que cada SW reemplazaría al otro.
  - Hace `skipWaiting()` y `clients.claim()` incondicionales (l.4-5), lo que anula el `registerType: "prompt"` y el toast «Actualizar» (vite.config.ts).
  - Su `fetch` reenvía todo a la red sin caché (l.35-58), así que sin red hay error.
  - Recarga la página en la primera visita (l.135-138) y usa `sessionStorage` sin pasar por `seguro.ts`.

  La alternativa sería añadir COOP/COEP desde el propio SW con `strategies:"injectManifest"` y un plugin `handlerWillRespond` en las rutas de precache y de runtime. Es un SW propio que hoy no existe.
- **Evidencia:**
  - `src-ext/coi-serviceworker/coi-serviceworker.js:4-5, 24-58, 124-139`.
  - `vite.config.ts` (VitePWA `registerType:"prompt"`, `injectRegister:false`).
  - `curl -I` de `/`, `/sw.js` y `/pyodide/*`: sólo `Cache-Control: max-age=600`.
- **Recomendación:** no adoptar coi-serviceworker en el MVP: cancelar con `terminate()` y recrear el worker. Si algún día hace falta SAB (para el interrupt o `measureUserAgentSpecificMemory`), tratarlo como proyecto aparte: un proxy con cabeceras delante del dominio propio, o injectManifest con pruebas offline.

### PLA-04 · Re-arrancar el motor tras cancelar cuesta unos 5 s en un sobremesa rápido, casi lo mismo con los ficheros ya en caché
- **Soporte:** A — `bench/pyo.js` en Chrome 153 headless (Ryzen 9 5900X, 32 GB, RTX 4060 Ti).
- **Prioridad:** P0
- **Afecta a:** §14.2 («se termina el Worker y se crea otro»), §14.3 («inicialización una vez por sesión»), §23-8 — corrige el coste implícito
- **Hallazgo:**
  - Arranque en frío de Pyodide 314.0.0 + numpy 2.4.3 + scipy 1.17.1: 5,7 s. Se reparte en `loadPyodide` 2,0 s, numpy 0,36 s, cargar scipy 1,1 s e `import scipy.sparse.linalg` 2,2 s.
  - Un worker nuevo con la caché HTTP caliente tarda 5,2 s (4,9 s con COI). El coste no es de red sino de CPU: instanciar los 110 `.so` de scipy y ejecutar los imports.
  - En Node, importar PyNite 3.2.0 y resolver un pórtico suma 1,5 s más.
  - La instantánea de memoria de Pyodide (API privada `_makeSnapshot`/`_loadSnapshot`) falla en cuanto hay numpy o scipy cargados («Unexpected hiwire entry at index 6»). Sólo serviría para el núcleo: 30 MB de instantánea y 0,18 s frente a 1,5–2 s de arranque.
- **Evidencia:**
  - `bench/pyodide_sin_coi.json` y `bench/pyodide_con_coi.json`.
  - `bench/memoria_procesos.json` (arranque de 5,8 s).
  - `bench/snapshot*.json` (tres intentos).
  - Comparación: sin scipy, taludes arranca en 2,9 s (`docs/geotecnia-taludes-pyslope.md` §11.4).
- **Recomendación:** contar unos 5 s por cada cancelación en sobremesa, y bastante más en portátil o móvil. Re-arrancar el motor en segundo plano tras cancelar, como hace `cancelAndRewarm`, y mostrar «preparando motor». Como opción P2, un worker de reserva caliente sólo mientras dura un cálculo largo: cancelar sería cambiar de worker, a cambio de unos 335 MB más. El scipy adelgazado (PLA-07) recorta unos 0,6 s.

### PLA-05 · Un worker de Pyodide con scipy en caliente ocupa unos 335 MB y la memoria WASM nunca se devuelve: sólo `terminate()` la libera
- **Soporte:** A — `bench/cdp_mem.mjs` (memoria privada de los procesos de Chrome leída con PowerShell) y `pyodide.asm.mjs` 314.0.0.
- **Prioridad:** P0
- **Afecta a:** §14.2 («se controla explícitamente el límite de memoria»), §21 («repetir, cancelar y relanzar no aumenta la memoria»), §23-8, §23-9 — añade y corrige
- **Hallazgo:** suma de la memoria privada de los procesos de Chrome en cada paso:

  | Momento | Memoria privada |
  |---|---|
  | Página base | 335 MB |
  | Worker arrancado | 670 MB (+335) |
  | Tras un laplaciano de 90 000 GDL (LU con 8,9 M nnz) | 1 166 MB |
  | Tras llenar el heap hasta `MemoryError` y liberar en Python | 4 617 MB (heap WASM aún en 4 095,9 MB) |
  | 3 s después de `terminate()` | 335 MB |

  - El techo del heap es de 4 GiB (`getHeapMax=()=>4294901760` en pyodide.asm.mjs). Se llegaron a reservar 3 968 MiB.
  - Heap tras cada solve: 155 MB (10 k GDL), 338 MB (40 k) y 584 MB (90 k).
  - En móvil el techo real es mucho menor: en iOS 17 el informe de WebKit sitúa la memoria fiable entre ~300 MB y 1 GB (bug 269777). Ese dato es C.
- **Evidencia:**
  - `bench/memoria_procesos.json`.
  - `bench/pyodide_sin_coi.json` (`techo`: 31 bloques de 128 MiB, `heapTrasLiberarMB` 4095.9; `solves`).
- **Recomendación:** fijar una política de vida del worker:
  1. Arrancarlo en idle al entrar en el módulo, como `useSlopeSolver`.
  2. Que el worker informe de `pyodide._module.HEAP8.buffer.byteLength` en cada `progress` y al terminar.
  3. Si tras un cálculo el heap supera un umbral (p. ej. 1 GiB), o el usuario lleva N minutos fuera del módulo, hacer `terminate()` y volver a arrancar cuando haga falta.
  4. Poner un límite previo de GDL por dispositivo (§19), estimado con el heap medido.
  5. Que el test de §21 «no aumenta la memoria» mida el heap WASM, no el heap de JS.

### PLA-06 · El primer uso del módulo por enlace directo no deja Pyodide en la caché offline: el SW todavía no controla la página
- **Soporte:** A — `bench/cdp_pwa.mjs` contra el `dist/` real del worktree, código de vite-plugin-pwa 1.2.0 y prueba propia de `clients.claim()`.
- **Prioridad:** P1
- **Afecta a:** §9.1 («funcionamiento offline»), §2.3-1, §23-7 — corrige el supuesto de «offline tras el primer uso»
- **Hallazgo:**
  - Con `registerType:"prompt"`, vite-plugin-pwa no pone `clientsClaim`: sólo lo hace con autoUpdate (`node_modules/vite-plugin-pwa/dist/index.js:874-877`), y el `dist/sw.js` no lo lleva.
  - En un perfil nuevo que entra directamente en `/geotec/taludes`, el worker bajó los 6 ficheros de `/pyodide/` (15,7 MiB), pero `caches.keys()` sólo tenía el precache. Al recargar los volvió a bajar todos (`bench/server_dist.log`).
  - Si se entra por `/` y luego se navega al módulo, la caché `pyodide-runtime-v314_0_0` se llena con los 6 ficheros. En la recarga no hay ninguna petición a `/pyodide/`: la regla `runtimeCaching` sí captura los `fetch` del worker.
  - En Chrome 153, `clients.claim()` toma el control incluso de un worker dedicado creado antes del claim.
- **Evidencia:**
  - `bench/pwa_pyodide.json` y `bench/pwa_pyodide_directo.json`.
  - `bench/server_dist.log`: GET `/pyodide/*` a las 11:25:47 y otra vez a las 11:26:14.
  - `bench/claim.json` → `workerCreadoAntesDelClaim: "INTERCEPTADO"`.
- **Recomendación:** dos opciones.
  - Añadir `clientsClaim: true` a `workbox`. El SW nuevo sigue esperando al toast porque no se activa `skipWaiting`.
  - Más explícito: un paso «Preparar para usar sin conexión» que haga `caches.open('pyodide-runtime-…').addAll([...ficheros del lock])`, con un indicador «motor disponible sin conexión».

  En ambos casos hay que verificarlo en Safari y Firefox.

### PLA-07 · Con scipy, la caché offline del motor pasa de 15,7 a 29,3 MiB; un scipy adelgazado a sparse+linalg (7,1 MiB) basta para PyNite 3.2.0
- **Soporte:** A — medidas sobre el lock de Pyodide 314.0.0 y los wheels del CDN fijado, y prueba en Node de Pyodide + scipy adelgazado + PyNite vendorizado.
- **Prioridad:** P1
- **Afecta a:** §1, §9.1, §20 Fase 0, §23-7 — añade
- **Hallazgo:**
  - **Hoy:** `public/pyodide/` ocupa 15,70 MiB (núcleo 12,92 + numpy 2,78).
  - **scipy:** la 1.17.1 del lock 314.0.0 sólo depende de numpy y pesa 13,38 MiB (45,9 MiB descomprimido, 110 `.so`).
  - **matplotlib y prettytable:** PyNite 3.2.0 los declara como requisitos, y `import Pynite` los importa en el nivel superior (`ShearWall.py:8-11`). Con matplotlib real serían 9,8 MiB más (39,1 MiB en total). Con stubs, como en PySlope, basta numpy+scipy.
  - **Wheel adelgazado:** quitando 16 subpaquetes de scipy que PyNite no usa (stats, optimize, spatial, io, interpolate, signal…), el wheel queda en 7,10 MiB. El pórtico de prueba da el mismo resultado (Mz,máx = 43 207 N·m, Ry = 67 500 N = 1,35·20·5/2 kN) y un `Quad3D` se ensambla y resuelve sin error. Sólo se cargan `scipy._lib`, `linalg` y `sparse`, y la carga es 0,6 s más rápida.
  - **Descarga del primer uso:** en GitHub Pages el `.wasm` va gzip (3,59 MB); los `.zip` y `.whl` no se comprimen. Son ≈ 23,3 MB con scipy completo, frente a ≈ 9,3 MB de taludes hoy. Con el límite blando de 100 GB/mes de GitHub Pages salen unas 4 300 primeras cargas al mes; esta estimación es C.
- **Evidencia:**
  - `tamanos_pyodide.out.txt`, `scipy_subpaquetes.out.txt`, `prueba_slim.out.txt` (pyodide-full frente a pyodide-slim).
  - `medir_dist.out.txt`.
  - `curl -I` de concreta.tools.
  - https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- **Recomendación:**
  1. Extender `scripts/fetch-pyodide-assets.mjs` con `scipy`, comprobando su sha256 contra el lock.
  2. Vendorizar PyNite como `.py` en el FS (como PySlope), con stubs de matplotlib y prettytable y versión fijada.
  3. Estudiar el wheel adelgazado como artefacto propio versionado, con su sha256 y un golden test que ejercite Plate3D, Quad3D, Mesh y P-Delta en Pyodide.
  4. No meter nada de esto en el precache: CacheFirst en runtime, con el nombre de caché ligado a la versión de Pyodide (hay 314.0.7 publicada; el repo fija 314.0.0) y el arreglo de PLA-06.

### PLA-08 · Three.js directo pesa 131–170 KiB gz; R3F+drei, 318–333 KiB, porque R3F arrastra el namespace entero de three y su propio reconciliador
- **Soporte:** A — medido con esbuild y con rolldown (el empaquetador de Vite 8) y leído en `@react-three/fiber` 9.8.1.
- **Prioridad:** P1
- **Afecta a:** §4.1 `visualization/`, §15, §22-9 — añade
- **Hallazgo:** tamaños minificados y con gzip-9, con React externo:

  | Import | KiB gz |
  |---|---|
  | Núcleo típico (renderer, InstancedMesh, materiales, Raycaster…) | 131–135 |
  | + OrbitControls + LineSegments2 + three-mesh-bvh | 163–170 |
  | + camera-controls + troika + ViewHelper + CSS2D | 216–226 |
  | `three` entero (`import * as THREE`) | 182–188 |
  | Sólo `@react-three/fiber` (incluye three) | 236–245 |
  | R3F + drei típico (incluye three) | 318–333 |

  - `@react-three/fiber` hace `extend(THREE)` sobre `import * as THREE` (react-three-fiber.esm.js:4,40). Eso arrastra three entero y añade reconciliador, zustand e its-fine (+54–57 KiB).
  - Fiber 9.8.1 exige `react >=19 <19.4` como peer. React 19.3.0 ya es la última, así que las subidas de React en Concreta quedarían atadas al ritmo de pmndrs.
  - Coste de cada complemento sobre el núcleo: three-mesh-bvh 24,8; troika 44,2; camera-controls 10,1; LineSegments2 7,4; OrbitControls 5,3; ViewHelper 3,2; CSS2D 1,1 KiB gz.
- **Evidencia:**
  - `bundle.out.txt` y `bundle_incrementos.out.txt`.
  - `bundle/node_modules/@react-three/fiber/dist/react-three-fiber.esm.js:4,40`.
  - `npm view @react-three/fiber peerDependencies`.
- **Recomendación:** Three.js directo, con un motor imperativo (`Visor3D`) fuera de React que el componente monta en un `<div>` y alimenta por efectos. El lienzo SVG ya sigue la misma lógica: `useCanvasView2D` es el dueño único del gesto de cámara.
  - Poner three en un grupo `three-vendor` de `codeSplitting.groups`, para medirlo en cada build como `docx-vendor`.
  - Precachearlo, sin meterlo en `globIgnores`: sacarlo reintroduce el 404 tras un deploy que documenta `vite.config.ts`.
  - Coste para todos: unos +0,65 MiB brutos sobre el precache actual (6,97 MiB, 2,54 gz).

### PLA-09 · El React Compiler 1.0 compila sin saltos los patrones de Three directo y de R3F, pero no detecta que se mute un objeto Three durante el render
- **Soporte:** A — babel-plugin-react-compiler 1.0.0 y eslint-plugin-react-hooks 7.0.1 (las versiones del repo) sobre `bundle/compilador/Patrones.tsx`.
- **Prioridad:** P1
- **Afecta a:** §15, §4.1 — añade
- **Hallazgo:**
  - **Compilan sin aviso y son correctos:**
    - visor directo con refs y efectos;
    - `useFrame` mutando `ref.current`;
    - mutar la cámara de `useThree()` dentro de un efecto;
    - `setMatrixAt` en `useLayoutEffect` con un `Matrix4` de `useMemo`.
  - **El compilador los salta y el ESLint `recommended` del repo da error** (el pre-commit los bloquearía):
    - estado con un `Vector3` mutado y vuelto a fijar («This value cannot be modified», `react-hooks/immutability`);
    - leer `ref.current` durante el render (`react-hooks/refs`).
  - **Compilan sin aviso pero están mal:** `camera.position.set()` y `material.color.set()` durante el render. El compilador guarda el JSX tras un centinela, así que `<mesh material={mat}/>` se crea una sola vez, y deja la mutación fuera de la caché.
- **Evidencia:** `compilador.out.txt` y `compilador_salida_DF.txt`.
- **Recomendación:** fijar una regla de código: los objetos Three viven en el motor o en refs, y sólo se mutan en efectos, en el bucle de render propio o en manejadores, nunca durante el render. Los singletons de módulo (renderer, worker) se crean con funciones `get…()` perezosas, no en inicializadores: es la trampa con el compilador que ya registra la memoria del proyecto.

### PLA-10 · Un `Mesh` por barra (5 115 draw calls) cuesta 14 ms por frame en una RTX 4060 Ti y 54 ms con la CPU a ×4; instanciando o fusionando, 0,5–1 ms
- **Soporte:** A — `bench/scene.js` en Chrome 153 con ANGLE/D3D11 y GPU real; CPU limitada con `Emulation.setCPUThrottlingRate`; SwiftShader como cota pesimista sin GPU.
- **Prioridad:** P1
- **Afecta a:** §14.3 (último punto) — confirma con números
- **Hallazgo:** edificio sintético de 15 plantas: 5 115 barras y 20 280 triángulos de lámina. 60 frames orbitando, sincronizando con `readPixels`.
  - **Medianas por frame:**
    - un Mesh por barra: 14,2 ms (p95 19,2);
    - InstancedMesh, geometría fusionada, LineSegments, LineSegments2 o lámina: 0,5 ms cada uno;
    - mixto (barras fusionadas + lámina + líneas gruesas, 3 draw calls): 0,7 ms.
  - **CPU ×4:** un Mesh por barra, 54,4 ms (menos de 20 fps); el resto, 0,7–1,0 ms.
  - **Modelo grande (19 350 barras + 201 840 triángulos):** un Mesh por barra, 48 ms; mixto, 0,9 ms.
  - **SwiftShader (sin GPU):** barras como cajas 28–62 ms, como líneas 9,7 ms; mixto 98 ms.
- **Evidencia:** `escenas_resumen.out.txt`, que resume `bench/escena_*.json`.
- **Recomendación:**
  - Modelo analítico por defecto como `LineSegments`: una draw call, picking con `LineSegmentsBVH` y la opción más barata sin buena GPU.
  - Sección extruida (InstancedMesh o fusionada) como capa opcional.
  - Nunca un objeto por elemento.
  - Renderizar bajo demanda (en el `change` de los controles), no en bucle continuo.

### PLA-11 · En un modelo grande, construir la geometría y el BVH en el hilo principal rompe los 50 ms de §14.3: hasta 484 ms y 406 ms con CPU ×4
- **Soporte:** A — `bench/escena_20k_gpu*.json`.
- **Prioridad:** P1
- **Afecta a:** §2.3-2, §14.3 (primer punto) — corrige: el presupuesto no se cumple sin sacar ese trabajo del hilo principal
- **Hallazgo:** 19 350 barras + 201 840 triángulos.
  - **Con CPU ×4:**
    - construir las barras fusionadas: 224 ms; la lámina: 133 ms; la escena mixta: 484 ms;
    - primer frame (subida a la GPU y compilación de shaders): 242 ms;
    - `computeBoundsTree`: 314–406 ms;
    - preparar la escena de ids para GPU picking: 212 ms.
  - **Con CPU ×1** también se pasan de 50 ms: mixto 116 ms, BVH 79–84 ms.
  - **Picking:**
    - sin BVH: 11–14 ms por consulta (×1) y 54–58 ms (×4), inservible para resaltar al pasar el ratón;
    - con BVH: 0,02–0,2 ms;
    - GPU picking: 0,8–1,5 ms, sin construir BVH.
  - Una vez se midió un primer frame de 277 ms al compilar en frío el shader de la rampa.
- **Evidencia:**
  - `escenas_resumen.out.txt`.
  - Primera ejecución de `bench/escena_5k_gpu.json` (`laminaTextura` 277 ms).
  - `three/src/renderers/WebGLRenderer.js:1515` (`compileAsync` con `KHR_parallel_shader_compile`).
- **Recomendación:**
  - Que el worker devuelva ya los `Float32Array` de posiciones, colores e ids de cada capa, transferidos.
  - BVH con `GenerateMeshBVHWorker` (`three-mesh-bvh/worker`) o GPU picking por id.
  - `renderer.compileAsync()` al preparar cada capa.
  - Un test de rendimiento con `PerformanceObserver` de tipo `long-animation-frame`/`longtask`; ambos tipos están soportados en Chrome 153 (`bench/plataforma_x1.json`).

### PLA-12 · three-mesh-bvh reordena el índice de la geometría: sin `indirect: true`, el `faceIndex` sólo identifica el elemento correcto en 16 de 128 triángulos
- **Soporte:** A — `bench/prueba_indice.json` y código de three-mesh-bvh 0.9.15.
- **Prioridad:** P1
- **Afecta a:** §2.3-4 (trazabilidad), §15.1 (picking), §21 («conocer… origen físico» de lo seleccionado) — añade
- **Hallazgo:** se lanzó un rayo por el centroide de cada triángulo de una losa de 128:
  - sin BVH, 128 de 128 `faceIndex` coinciden con el índice original;
  - con `computeBoundsTree()`, sólo 16 de 128. El BVH crea y reordena el índice in situ (`MeshBVH.js:78-80`);
  - con `indirect:true`, 128 de 128, y el índice no se toca (`GeometryBVH.js:54`).

  También se recupera el elemento correcto resolviendo a través del índice reordenado, o con un atributo `elementIndex` por vértice. Aparte, `Raycaster` ignora los planos de corte (no hay referencias a clipping en `Mesh.js` ni en `Raycaster.js` de r186): un elemento recortado se sigue pudiendo seleccionar.
- **Evidencia:**
  - `bench/prueba_indice.json` → `bvhNormal.faceIndexIgualAlOriginal: 16`.
  - `bundle/node_modules/three-mesh-bvh/src/core/MeshBVH.js:78`.
- **Recomendación:**
  - Ir de triángulo a elemento analítico y a elemento físico con un atributo por vértice, que sobrevive a cualquier reordenación, o con `indirect:true`.
  - Test de contrato que haga picking en todos los centroides.
  - Filtrar los impactos por planos de corte y por planta visible.

### PLA-13 · Colorear las láminas con color por vértice interpolado deja un 73 % de píxeles con colores que no están en la leyenda
- **Soporte:** A — `bench/scene.src.js → window.bandas()`, con lectura de píxeles. Las propiedades de las paletas son B.
- **Prioridad:** P1
- **Afecta a:** §15.4, §12.1 («el suavizado visual no sustituye al dato») — añade cómo cumplirlo
- **Hallazgo:** losa de 72 triángulos con un campo que cambia de signo y una rampa de 10 bandas:

  | Método | Colores distintos | Píxeles fuera de leyenda |
  |---|---|---|
  | Color plano por elemento (dato bruto) | 10 | 0 % |
  | Valor nodal en `uv.x` + textura 1D con `NearestFilter` (la GPU interpola el valor y la textura cuantiza) | 8 | 0 % |
  | Color de banda por vértice (lo intuitivo) | 1 863 | 73,2 % (degradados falsos) |

  - El coste por frame es el mismo en los tres: 0,5 ms.
  - Trampa de color: los bytes de una textura sRGB tienen que estar en sRGB, porque `THREE.Color` guarda valores lineales desde r152. En la primera pasada me equivoqué y salió un 100 % fuera de leyenda.
- **Evidencia:** `bench/bandas.out.txt` y `bench/bandas_*.png`.
- **Recomendación:** dos modos, ninguno de los dos interpolando el color:
  - «por elemento»: el dato bruto, por defecto;
  - «suavizado»: valor nodal + rampa en textura, rotulado como representación visual.

  Sobre la paleta:
  - Viridis no: empieza en violeta (#440154) y `DESIGN.md:134` prohíbe los violetas.
  - Para magnitudes, cividis: perceptualmente uniforme y de luminancia monótona, así que sobrevive al PDF en grises (`DESIGN.md:125,437`).
  - Para resultados con signo, una divergente sin rojo, verde ni ámbar (son los colores de estado; `paleta.ts:9-10`), p. ej. azul–crema–ocre, tipo `broc`/`vik` de Crameri. En el PDF en grises, el signo tiene que ir con isolíneas rotuladas.
  - Los extremos de cividis dan 1,22:1 de contraste con el lienzo Ónice (#0c0c0e) y 1,23:1 con el claro (#fff): hay que dibujar aristas o el contorno de la losa (`contraste_rampas.out.txt`).

### PLA-14 · La frontera Worker→UI no puede ser JSON: 46 MB de resultados se transfieren en 3,7 ms, mientras que `stringify` tarda 272 ms y `parse` 164–709 ms en el hilo principal
- **Soporte:** A — `bench/platform.js → transferencia` y código de Comlink 4.4.2.
- **Prioridad:** P1
- **Afecta a:** §14.2 («Transferable»), ADR-008, §12; corrige el precedente de taludes (resultado como cadena JSON)
- **Hallazgo:** 6 M de doubles (45,8 MB):

  | Operación | ×1 | CPU ×4 |
  |---|---|---|
  | Copia por structured clone | 49 ms | 155 ms |
  | Transferencia | 3,7 ms | 2,8 ms |
  | `JSON.stringify` (57,5 MB de texto) | 272 ms | 1 095 ms |
  | `JSON.parse` en el hilo principal (una long task) | 164 ms | 709 ms |

  - Tras transferir, el buffer del emisor queda con `byteLength = 0`.
  - Comlink sólo adjunta transferibles si se marca el objeto de primer nivel que se devuelve: `transferCache` es un `WeakMap` por identidad (`comlink.mjs:295-332`).
  - Comlink no tiene timeout. Con `terminate()`, las promesas pendientes quedan colgadas, tal como advierte `client.ts`.
- **Evidencia:** `bench/plataforma_x1.json`, `bench/plataforma_x4.json`; `node_modules/comlink/dist/esm/comlink.mjs`.
- **Recomendación:** el patrón de taludes (`json.dumps` a cadena) sirve para metadatos y diagnósticos, no para el `BaseCaseResultSet`.
  - Devolver `Comlink.transfer(artifact, [todos los .buffer])` con los Float64Array de §12.
  - Enviar los ids una sola vez, como tabla densa: los `Id[]` de cadenas no se pueden transferir.
  - Si el worker necesita conservar los resultados (p. ej. para combinar), copiarlos antes de transferirlos, o hacer las combinaciones en el worker de TS.

### PLA-15 · La huella SHA-256 sobre JSON canónico de un modelo medio cuesta 179 ms (663 ms con CPU ×4); el SHA-256 en sí son 9 ms
- **Soporte:** A — `bench/platform.js → huella`.
- **Prioridad:** P1
- **Afecta a:** §7.1-12, §12.1, §17 — añade el coste y dónde calcularla
- **Hallazgo:** modelo analítico sintético con 20 000 nudos, 25 000 barras y 40 000 láminas, que da 12,5 MB de JSON canónico:

  | Paso | ×1 | CPU ×4 |
  |---|---|---|
  | Canonicalizar (claves ordenadas) | 146 ms | 546 ms |
  | `TextEncoder` | 24 ms | 80 ms |
  | `crypto.subtle.digest` | 9 ms | 37 ms |
  | Total | 179 ms | 663 ms |

  - Es determinista: dos ejecuciones dan la misma huella. `JSON.stringify` a secas no es canónico.
  - Hashear directamente los buffers tipados (posiciones Float64 + conectividad Int32, 1,1 MB) cuesta 12–23 ms.
  - Un modelo pequeño (1,2 MB) cuesta 15 ms.
- **Evidencia:** `bench/plataforma_x1.json` y `bench/plataforma_x4.json` (`huellaMedio`, `huellaPequeno`).
- **Recomendación:**
  - Calcular la huella en el worker de compilación, sobre los buffers densos más una cabecera canónica pequeña: esquema, unidades, versiones de compilador y solver, opciones.
  - Normalizar `-0` y rechazar `NaN` antes de hashear.
  - Aceptar una respuesta del worker si su `modelFingerprint` coincide con el modelo actual, no sólo por `requestId`. Así se reaprovecha el resultado tras deshacer.

### PLA-16 · En Chrome 153, localStorage admite 5 242 880 caracteres; un modelo físico medio ocupa 311 Ki y, contando su copia archivada, el 12,7 % del total; uno grande, el 47 %
- **Soporte:** A — `bench/platform.js` (cuota de localStorage e IndexedDB), `tamano_modelo_fisico.mjs` y lectura de `src/lib/proyecto/index.ts` y `src/lib/anejo/blobs.ts`.
- **Prioridad:** P1
- **Afecta a:** §17, §23-13, §5.3 (UUID) — añade
- **Hallazgo:**
  - **Cuota:** la medida es de 5 242 880 caracteres (claves + valores), igual con «a» que con «ñ». Es más holgada que los «~2,5 M» que da el comentario de `seguro.ts:236-238`; Firefox y Safari no están medidos.
  - **Tamaño del `PhysicalModel` de §6 con UUID:**

    | Modelo | Pilares / vigas | JSON | Clave viva + archivo |
    |---|---|---|---|
    | Pequeño | 48 / 72 | 46 Ki car | 96 Ki car (1,9 %) |
    | Medio (8 forjados, 4 muros) | 320 / 560 | 311 Ki car | 650 Ki car (12,7 %) |
    | Grande | 1 200 / 2 100 | 1 148 Ki car | 2 401 Ki car (46,9 %) |

  - **Por qué se duplica:** el contenedor guarda cada obra como `ProyectoFile` en `concreta-proyecto-<id>`, con las claves como cadenas crudas (`index.ts:297-300`). El modelo vive dos veces, en la clave viva y en el archivo, y el archivo añade un 9 % por el escapado.
  - **Enlaces:** «Copiar enlace» con lz-string (el patrón de fem2d) daría 89 Ki caracteres de URL en el modelo medio. Inviable.
  - **IndexedDB:** ya se usa (`blobs.ts`, BD `concreta-anejo`, guardando `ArrayBuffer` en vez de `Blob`). 45,8 MB se escriben en 107 ms y se leen en 35 ms. `navigator.storage.persisted()` devuelve `false`, así que el almacenamiento es desalojable.
- **Evidencia:** `bench/plataforma_x1.json` (`localStorageAscii`/`NoAscii`, `idb`), `tamano_modelo_fisico.out.txt`.
- **Recomendación:**
  1. Guardar el `PhysicalModel` en una clave de proyecto vía `seguro.ts`: hidrata de forma síncrona y viaja en el `.concreta.json`. Usar ids cortos opacos por proyecto en vez de UUID, y avisar a partir de un tamaño (p. ej. 500 Ki car).
  2. Guardar `AnalyticalModel` y `SolveArtifact` en una BD IndexedDB propia (`concreta-fem3d`, con el patrón de `blobs.ts`), indexada por huella y con purga LRU por tamaño. Es caché regenerable: no viaja en el fichero y puede desaparecer.
  3. Compartir modelos por fichero, no por URL.

### PLA-17 · Chrome mantiene 16 contextos WebGL por página: crear renderers nuevos al remontar el visor o al capturar el PDF sin liberarlos acaba matando el del visor
- **Soporte:** A — `bench/contextos.html`.
- **Prioridad:** P1
- **Afecta a:** §15, §21 (visualización); exportación a PDF de Concreta — añade
- **Hallazgo:** al crear 24 contextos WebGL2 sin liberarlos, Chrome 153 perdió los 8 más antiguos (`webglcontextlost` en los índices 0–7) y dejó 16 vivos. Cada `new WebGLRenderer` es un contexto, y `dispose()` no lo libera: hace falta `forceContextLoss()`.
- **Evidencia:** `bench/contextos.json`.
- **Recomendación:**
  - Un único renderer de larga vida (singleton perezoso, como el worker de taludes) que se vuelve a enganchar al DOM al montar el visor.
  - Las capturas para el PDF, con ese mismo renderer, a un `WebGLRenderTarget` de alta resolución + `readRenderTargetPixels`.
  - Atender `webglcontextlost`/`webglcontextrestored`, que se dan al suspender un portátil.

### PLA-18 · Los colores de los lienzos son `var(--color-*)` y `color-mix()`, que `THREE.Color` no entiende: los pinta blancos sin dar error
- **Soporte:** A — prueba en Node con three r186 y lectura de `src/components/canvas/paleta.ts` y `src/index.css`.
- **Prioridad:** P1
- **Afecta a:** §15; encaje con la paleta Ónice (CLAUDE.md del checkout principal) — añade
- **Hallazgo:**
  - `paleta.ts` define todos los colores como `var(--color-…)`, y `mezcla()` devuelve `color-mix(in srgb, …)`.
  - `new THREE.Color('var(--color-accent)')` y `new THREE.Color('color-mix(...)')` dan `#ffffff` con un `console.warn` («Unknown color model»).
  - El tema cambia con `html[data-theme="dark"]`: el lienzo Ónice es `#0c0c0e` y el claro `#ffffff` (`index.css:375,505`).
  - La tabla de `DESIGN.md` aún da los valores oscuros antiguos (#0b1220).
- **Evidencia:** `three_color_var.out.txt`.
- **Recomendación:**
  - Un `paleta3d.ts` que resuelva los tokens con `getComputedStyle(document.documentElement)` y se vuelva a calcular al cambiar de tema (con `useTheme`), repintando la escena.
  - Los colores de estado, sólo para estado (diagnósticos, η), nunca en mapas.
  - El PDF, con un render aparte en grises.

### PLA-19 · Las etiquetas CSS2D aguantan 500 (4,4 ms por frame) pero no 3 000 (31 ms, p95 85 ms); troika agrupa 500 en una draw call, pero no carga las woff2 de Concreta y, sin `font`, pide fuentes a jsDelivr
- **Soporte:** A — `bench/etiquetas.src.js` y código de troika-three-text 0.52.5.
- **Prioridad:** P2
- **Afecta a:** §15.1 (capa 2, numeración), §15.3 (valores en estaciones) — añade
- **Hallazgo:**
  - **CSS2DRenderer** (un `div` por etiqueta): 500 etiquetas, 4,4 ms por frame (p95 7,8); 3 000, 30,7 ms (p95 84,9).
  - **troika con una TTF local:** un `Text` sincroniza en 66 ms; un `BatchedText` de 500 en 148 ms, con 1–2 draw calls y ninguna petición a terceros.
  - **troika con `GeistMono-Regular.woff2`** (la fuente que sirve Concreta): no sincroniza en 30 s, en dos intentos. El decodificador que incluye es woff→otf con fflate (Deflate). Sospecho que no soporta WOFF2, que va en Brotli, pero no lo he confirmado en el código.
  - **troika sin `font`:** resuelve los glifos contra `https://cdn.jsdelivr.net/gh/lojjic/unicode-font-resolver@v1.0.1/packages/data` (`troika-three-text.esm.js:453`), y vuelve a ese CDN si falla un `unicodeFontsURL` propio.
- **Evidencia:** `bench/etiquetas_css2d.json` y `bench/etiquetas_troika*.json` (intento 1 y 2 con woff2 sin sincronizar; intento 3 con TTF, correcto).
- **Recomendación:**
  - Rótulos de interacción (valor bajo el cursor, elemento seleccionado, leyenda) en DOM/React, con las fuentes de la app.
  - Numeración masiva sólo filtrada por planta o selección, con `BatchedText` y una TTF propia (Geist o Arimo, OFL) en `public/fonts`, siempre con `font` explícita.
  - Decidir si la numeración entra en el MVP.

### PLA-20 · `WebGPURenderer` (r186) cae solo a WebGL2, pero no acepta `ShaderMaterial` ni `onBeforeCompile`: LineMaterial y troika no funcionan, y el bundle crece 82 KiB gz
- **Soporte:** A — código fuente de three r186 y troika, y medida del bundle. El soporte de los navegadores es B.
- **Prioridad:** P2
- **Afecta a:** §15 — añade
- **Hallazgo:**
  - `WebGPURenderer` crea el backend WebGPU con un `getFallback` a `WebGLBackend` (`WebGPURenderer.js:57-67`).
  - Sólo traduce los materiales clásicos registrados en `StandardNodeLibrary.js:64-76` (Mesh*, Line*, Points, Sprite, Shadow).
  - Queda fuera `ShaderMaterial`, que es la base de `LineMaterial` (las líneas gruesas); para WebGPU existe `lines/webgpu`.
  - troika modifica los shaders con `onBeforeCompile` (`troika-three-utils.esm.js:158-162`).
  - Bundle: 216–220 KiB gz, frente a 131–135 del núcleo WebGL.
  - WebGPU ya está en Chrome/Edge 113+ (Android 121+), Safari 26 y Firefox 141 en Windows.
- **Evidencia:**
  - `bundle.out.txt` (`g_webgpu`).
  - `bundle/node_modules/three/src/renderers/...`.
  - https://web.dev/blog/webgpu-supported-major-browsers
- **Recomendación:** MVP con `WebGLRenderer` (WebGL2). Con una GPU dedicada, 550 k triángulos se pintan en 0,9 ms por frame, así que el tamaño del modelo no pide WebGPU. Reevaluar sólo si hacen falta compute shaders, p. ej. isolíneas o deformada calculadas en la GPU.

## Contradicciones con el diseño técnico

1. **§14.1, §14.2 y §9 (cancelación por mensaje y `AbortSignal`).** Mientras Pyodide calcula, el worker no lee mensajes (PLA-01), y con SAB tampoco se interrumpe SuperLU (PLA-02). El tipo `cancel` y el `signal` del `SolverContext` no sirven dentro del worker de Pyodide: cancelar es `terminate()` en el cliente del hilo principal, como en `client.ts`.
2. **§14.3, «la inicialización de WASM se realiza una vez por sesión/Worker».** Va contra el objetivo de memoria, porque el heap WASM no se reduce nunca (PLA-05): un worker de sesión conservaría su pico, hasta 4 GiB. Además, cada cancelación vuelve a inicializar (unos 5 s, PLA-04). Hace falta una política de reciclado explícita.
3. **§14.3, ninguna tarea de más de 50 ms en el hilo principal.** Sólo se cumple si la geometría, el BVH, la huella y los resultados se preparan en el worker y se transfieren. En el hilo principal, los mismos pasos dan 116–484 ms de geometría, 79–406 ms de BVH, 179–663 ms de huella y 164–709 ms de `JSON.parse` (PLA-11, PLA-14, PLA-15). También contradice el precedente de taludes de devolver JSON.
4. **§9.1 y §2.3-1, offline «empaquetando los recursos necesarios».** Con scipy, el motor pesa 29,3 MiB, que no caben en un precache con tope de 4 MiB por fichero (el scipy pesa 13,38 MiB). Además, el primer uso por enlace directo no queda en caché (PLA-06, PLA-07). El diseño no reconoce ese coste.
5. **§4.1, `src/modules/fem3d/...`.** En el repo no existe `src/modules/`. La convención real es:
   - UI en `src/features/<módulo>`;
   - motores en `src/lib/calculations/<área>`, con el worker junto a su cliente (`lib/calculations/geotech/`);
   - registro en `src/data/moduleRegistry.ts` y `routeLoaders.ts`;
   - claves en `src/data/proyectoKeys.ts`.
6. **§17, guardar por separado el `AnalyticalModel` y el `SolveArtifact`.** El contenedor de proyectos sólo transporta claves de localStorage como cadenas (`ProyectoFile.claves`), y no caben resultados de decenas de MB. Esos artefactos tienen que ser caché regenerable en IndexedDB y no viajar en el `.concreta.json` (PLA-16).
7. **§12, `elementIds: Id[]` en bloques que cruzan la frontera del worker.** Las cadenas no se pueden transferir. Conviene usar índices densos más una tabla de ids enviada una sola vez (PLA-14).
8. **§15.4, «paleta perceptualmente uniforme» y «suavizado nodal».** La paleta canónica (viridis) choca con `DESIGN.md:134` (sin violetas). Y el suavizado ingenuo con color por vértice pinta un 73 % de colores que no existen en la leyenda (PLA-13).

## Preguntas abiertas (lo que no pudiste cerrar y cómo se cerraría)

1. **Dispositivos objetivo reales.** Todas las medidas son de un sobremesa con una GPU dedicada; para móvil sólo hay una aproximación con la CPU a ×4 y SwiftShader. Se cierra ejecutando `bench/index.html` (`bench(...)`) y `bench/pyo.html` (`pyo(...)`) en un portátil con gráfica integrada (Iris Xe o Radeon 680M), un Android de gama media y un iPhone, publicándolos en una rama de preview, y recogiendo los JSON.
2. **Techo de memoria WASM en iOS 26.** Sólo tengo el bug 269777 de WebKit (iOS 17, febrero de 2024), soporte C. Se cierra con `pyo.js → techo` en un iPhone actual. Si queda por debajo de unos 500 MB, el módulo tendría que bloquear o reducir los modelos en iOS.
3. **Safari y Firefox.** Faltan cuatro comprobaciones: si `clients.claim()` toma un worker dedicado ya creado, si la regla `runtimeCaching` captura los `fetch` del worker, cómo cuentan la cuota de localStorage y cuántos contextos WebGL mantienen. Se cierra repitiendo `bench/claim/`, `cdp_pwa.mjs` (a mano) y `platform.js` en esos navegadores.
4. **Si PyNite pasa más tiempo ensamblando en Python o en `spsolve`.** Es lo que decide si el interrupt por SAB aportaría algo (PLA-02). Corresponde a las medidas del área 1.
5. **Wheel de scipy adelgazado.** Hay que comprobar tres cosas:
   - que ninguna opción de PyNite (P-Delta, `check_stability`, `sparse=False`, mallas) importa un subpaquete quitado;
   - que el mantenimiento por cada versión de Pyodide es asumible;
   - los avisos de licencia de la redistribución (BSD-3).

   Se cierra pasando la batería de tests de PyNite dentro de Pyodide con el wheel adelgazado.
6. **Las woff2 en troika.** El fallo de PLA-19 se ha observado, pero no he leído en el código si troika soporta WOFF2 o no. Se cierra con el changelog o los issues de troika y probando una WOFF1 de Geist.
7. **Memoria de GPU con modelos grandes.** `renderer.info.memory` sólo cuenta objetos. Se cierra con `chrome://gpu` o `about:tracing` en los dispositivos objetivo.
8. **Pyodide 314.0.0 frente a 314.0.7.** El repo fija la 314.0.0 y npm ya publica la 314.0.7. Hay que decidir qué versión se fija (§9.1), con el nombre de caché versionado. Es asunto del área 1.
9. **Visor de PDF bajo COEP.** El `<iframe src=blob:…>` del `PdfPreviewModal` no se ha probado con COEP. Sólo importaría si algún día se adopta el aislamiento de origen.

## Experimentos (qué ejecutaste, dónde están los scripts y su salida resumida)

Carpeta: `C:\Users\javie\AppData\Local\Temp\claude\d--PROGRAMACION-Concreta-EST\b287d96a-8882-4d7d-800f-3c46ec2b77b4\scratchpad\fem3d\04-plataforma\`.

Máquina: Windows 11, Ryzen 9 5900X (24 hilos), 32 GB, RTX 4060 Ti, Node 24.19, Chrome 153 headless con perfil propio, CDP por `bench/cdp.mjs` y GPU real con ANGLE/D3D11. El repositorio sólo se leyó; no se modificó.

| # | Qué | Script → salida | Resultado |
|---|---|---|---|
| 1 | Tamaño de `dist/`, del precache real y de Pyodide | `medir_dist.py` → `medir_dist.out.txt` | `dist` 29 MB; precache de 217 entradas, 6,97 MiB (2,54 gz); Pyodide 15,70 MiB (no precacheado) |
| 2 | Cierre de dependencias de scipy y matplotlib en el lock y tamaños en el CDN fijado | `tamanos_pyodide.py` → `tamanos_pyodide.out.txt`, `scipy_subpaquetes.out.txt` | scipy 13,38 MiB; con matplotlib +9,8 MiB; offline 29,3 o 39,1 MiB |
| 3 | Peso de los bundles (esbuild y rolldown) | `bundle/medir.mjs`, `bundle/medir2.mjs` → `bundle.out.txt`, `bundle_incrementos.out.txt` | Tabla de PLA-08 |
| 4 | React Compiler y ESLint sobre patrones Three/R3F | `bundle/compilador/probar.mjs` → `compilador.out.txt`, `compilador_salida_DF.txt` | 6 compilan, 2 se saltan (PLA-09) |
| 5 | Escena de 5 k / 20 k barras y 20 k / 200 k triángulos (frame, construcción, picking lineal, BVH y GPU) | `bench/scene.src.js` (`bench(cfg)`) + `bench/cdp.mjs` → `bench/escena_*.json`, `escenas_resumen.out.txt` | PLA-10 y PLA-11 |
| 6 | `faceIndex` con BVH normal e `indirect` | `bench/scene.src.js` (`pruebaIndice`) → `bench/prueba_indice.json` | 16/128 frente a 128/128 |
| 7 | Bandas de color (píxeles fuera de leyenda) | `bench/scene.src.js` (`bandas`) → `bench/bandas.out.txt`, `bench/bandas_*.png` | 0 %, 0 % y 73,2 % |
| 8 | Cuota de localStorage, huella SHA-256, copia/transferencia/JSON, IndexedDB, long tasks | `bench/platform.js` → `bench/plataforma_x1.json`, `bench/plataforma_x4.json` | 5 242 880 caracteres; 179/663 ms; 49/3,7/272+164 ms; 107/35 ms |
| 9 | Pyodide + numpy + scipy: arranque frío y tibio, solves, techo, `terminate`, interrupt con y sin COI | `bench/pyo.js`, `bench/pyo.worker.js`, `bench/server.mjs [--coi]` → `bench/pyodide_sin_coi.json`, `bench/pyodide_con_coi.json` | 5,7 / 5,2 s; techo 3 968 MiB; interrupt 4 ms en Python, no en `splu` |
| 10 | Memoria de los procesos durante la vida del worker | `bench/cdp_mem.mjs` → `bench/memoria_procesos.json` | 335 → 670 → 1 166 → 4 617 → 335 MB |
| 11 | Instantánea de memoria de Pyodide (3 intentos) | `bench/snap.worker.js` → `bench/snapshot{,2,3}.json` | Falla con paquetes; sin ellos, 30 MB y 0,18 s |
| 12 | PWA real: caché del worker y primer uso directo | `bench/server_dist.mjs`, `bench/cdp_pwa.mjs [--directo]` → `bench/pwa_pyodide*.json`, `bench/server_dist.log` | Navegando, 6 entradas y 0 descargas al recargar; por enlace directo, nada en caché |
| 13 | `clients.claim()` con un worker ya creado | `bench/claim/` → `bench/claim.json` | El worker queda interceptado |
| 14 | `cancel` y `progress` con el worker ocupado | `bench/cancel_msg.js` → `bench/cancel_msg.json`, `bench/progreso.json` | `cancel` a los 2 000 ms; `progress` a 4 ms |
| 15 | Contextos WebGL vivos | `bench/contextos.html` → `bench/contextos.json` | 16 vivos, 8 perdidos |
| 16 | Etiquetas CSS2D frente a troika | `bench/etiquetas.src.js` → `bench/etiquetas_*.json` | CSS2D: 4,4 / 30,7 ms; troika con woff2 bloqueado, con TTF 148 ms |
| 17 | Tamaño del modelo físico (§6) en localStorage y en URL | `tamano_modelo_fisico.mjs` → `tamano_modelo_fisico.out.txt` | 46 / 311 / 1 148 Ki car |
| 18 | scipy adelgazado + PyNite 3.2.0 vendorizado con stubs, en Node | `scipy_slim.py`, `prueba_slim.mjs` → `prueba_slim.out.txt` | 7,10 MiB; mismo resultado que con scipy completo |
| 19 | `THREE.Color` con `var()` y `color-mix()`; contraste de los extremos de las rampas | `three_color_var.out.txt`, `contraste_rampas.out.txt` | `#ffffff` con aviso; 1,22–1,23:1 |
| 20 | Cabeceras de GitHub Pages | `curl -sI` de concreta.tools (en el texto de PLA-07 y PLA-03) | wasm en gzip, `.zip`/`.whl` sin comprimir, `max-age=600`, sin COOP/COEP |

Bloqueos documentados:
- troika con woff2: 3 intentos (PLA-19).
- Instantánea de Pyodide con paquetes: 3 intentos (PLA-04).
- En `bundle/` hubo que instalar con `--legacy-peer-deps`: esbuild sin postinstall funciona con el binario opcional.

## Fuentes

- Repositorio (worktree `feat-fem3d`, sólo lectura):
  - `vite.config.ts`, `package.json`, `scripts/fetch-pyodide-assets.mjs`
  - `src/lib/calculations/geotech/{client.ts,pyslope.worker.ts}`, `src/features/slope-stability/useSlopeSolver.ts`
  - `src/lib/storage/seguro.ts`, `src/lib/proyecto/{index.ts,fichero.ts}`, `src/lib/anejo/blobs.ts`, `src/data/{routeLoaders.ts,proyectoKeys.ts,moduleRegistry.ts}`
  - `src/hooks/useCanvasView2D.ts`, `src/components/canvas/paleta.ts`, `src/index.css`
  - `src/features/fem2d/{useFem2DState.ts,serialize.ts}`, `src/features/fem-analysis/useLazyDesignSolver.ts`
  - `DESIGN.md`, `eslint.config.js`, `docs/geotecnia-taludes-pyslope.md`, `docs/fem3d/diseno-tecnico.md`
  - `dist/`, `dist/sw.js`
  - `D:\PROGRAMACION\Concreta EST\concreta-v2\CLAUDE.md` (paleta Ónice)
- Paquetes (versiones exactas leídas en `node_modules`):
  - pyodide 314.0.0 (`pyodide.asm.mjs`: `getHeapMax`; `pyodide.d.ts`: `makeMemorySnapshot`, `_makeSnapshot`, `_loadSnapshot`; `pyodide-lock.json`)
  - vite-plugin-pwa 1.2.0 (`dist/index.js:874-877`), workbox-build 7.4.0, comlink 4.4.2 (`dist/esm/comlink.mjs`)
  - three 0.186.1 (`WebGLRenderer.js:1515`; `WebGPURenderer.js:57-67`; `StandardNodeLibrary.js:64-76`), three-mesh-bvh 0.9.15 (`MeshBVH.js:78`, `GeometryBVH.js:54`, README)
  - @react-three/fiber 9.8.1 (`react-three-fiber.esm.js:4,40`, `package.json`), @react-three/drei 10.7.9, camera-controls 3.1.2
  - troika-three-text 0.52.5 (`troika-three-text.esm.js:453`), troika-three-utils (`esm.js:158-162`)
  - babel-plugin-react-compiler 1.0.0, eslint-plugin-react-hooks 7.0.1
  - PyNiteFEA 3.2.0 (wheel de PyPI: `ShearWall.py:8-11`, `FEModel3D.py:9`, `Analysis.py`)
  - scipy 1.17.1 y numpy 2.4.3 (wheels de https://cdn.jsdelivr.net/pyodide/v314.0.0/full/)
- coi-serviceworker 0.1.7: https://github.com/gzuidhof/coi-serviceworker (commit 7b1d2a092d0d2dd2b7270b6f12f13605de26f214, `coi-serviceworker.js`)
- Pyodide, interrupciones: https://pyodide.org/en/stable/usage/keyboard-interrupts.html (documentación 314.0.7)
- Límites de GitHub Pages: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- GitHub Pages sin COOP/COEP: https://github.com/orgs/community/discussions/13309 y `curl -I https://concreta.tools/…` (2026-10-03)
- WebKit, memoria WASM en iOS: https://bugs.webkit.org/show_bug.cgi?id=269777 (duplicado de 269937)
- WebGPU en los navegadores principales: https://web.dev/blog/webgpu-supported-major-browsers
- Especificación de Service Workers, algoritmo «Register» (una registration por scope): https://w3c.github.io/ServiceWorker/#register-algorithm
- cividis: Nuñez, Anderton y Renslow (2018), PLOS ONE 13(7): e0199239; viridis (#440154 a #fde725); Crameri, *Scientific colour maps* (Zenodo).
