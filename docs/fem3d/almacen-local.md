# Fase AL: los proyectos en el navegador y la app como PWA

> **Qué es.** En la web (GitHub Pages) los proyectos se guardan en el navegador (IndexedDB), sin elegir carpetas ni dar permisos, con exportar e importar el `proyecto.json`. Después, la app se instala como PWA y funciona sin conexión. **Fecha:** 2026-10-23.

> **Por qué.** El usuario, al abrir la app en Pages: «esto de tener que seleccionar un directorio del ordenador para trabajar y dar permisos es un lío; sería mejor usar IndexedDB y tenerlo en local, y luego poder exportarlo, pero no trabajar desde una carpeta del ordenador; además, en el futuro debería ser una PWA».

## 1. Decisiones del usuario (2026-10-23)

- **AL-a. La carpeta, secundaria.** La pantalla de inicio pasa a ser «Mis proyectos» (IndexedDB), con Nuevo, Importar y los ejemplos. Abrir una carpeta del disco queda como una opción discreta, para trabajar con el agente. `bun run visor <proyecto.json>` sigue en el disco, como antes.
- **AL-b. Autoguardado con versiones.** En los proyectos del navegador, cada cambio se guarda solo: no hay «sin guardar» ni Ctrl+S. Se conservan versiones anteriores para volver atrás, aunque se cierre la pestaña. Exportar descarga el `proyecto.json`.
- **AL-c. La PWA, en la misma fase y después** (AL2). Primero IndexedDB y la pantalla de proyectos (AL1).

AL-a cambia V-d (`visor.md` §5) en la web: el `proyecto.json` del disco deja de ser el único sitio donde vive un proyecto. Para la CLI y el agente sigue siéndolo: no ven IndexedDB, y un proyecto del navegador llega a ellos exportándolo.

## 2. Lo que no cambia

- **El formato.** Lo que se guarda en el navegador es el texto canónico del `proyecto.json` (`serializar`), y exportar lo descarga tal cual. Nunca se guarda un texto que no pase `leerProyecto` (regla de V2a, §6.1). Importar y exportar no cambia la huella.
- **La carpeta y el servidor local** (`origen.ts`): vigilancia, resultados de `.fem/`, firmas y conflictos, igual que en V2a. Sus pruebas no cambian.
- **La sesión del worker**: el proyecto abierto sigue hablando con un `Origen`. El del navegador es otro más.

## 3. Diseño de AL1

### 3.1 La base de datos

`concreta-fem`, versión 1, en el origen de la app (en Pages, `jramirezbandera.github.io`):

| Almacén | Clave | Contenido |
|---|---|---|
| `proyectos` | `id` | Ficha: nombre, sello, creado, modificado, tamaño. Pequeña: es lo que se lee cada segundo y lo que lista el inicio. |
| `textos` | `id` | El texto canónico del proyecto. |
| `versiones` | autonumérica, índice `proyecto` | Texto, fecha y tamaño de una versión anterior. |
| `resultados` | `huella` | Cabecera (con `motor` y `sha256`, como `.fem/<huella>/resultados.json`), bytes, proyecto, fecha y tamaño. |

- **Sello:** un contador de revisión por proyecto. `escribir` lo compara y lo sube en la misma transacción. Si otra pestaña escribió antes, hay conflicto, como con el disco: nunca se pisa nada en silencio.
- **Persistencia:** IndexedDB es desalojable (H44). Al crear o importar un proyecto se pide `navigator.storage.persist()`, y el inicio dice si se concedió. Vive en ese navegador y ese equipo: para llevar un proyecto a otro, exportar.

### 3.2 Autoguardado (AL-b)

- 400 ms después del último cambio, y al ocultar la página (`visibilitychange`). Mientras haya algo por guardar, cerrar la pestaña avisa, como hoy.
- Lo que no pasa `leerProyecto` no se guarda: se dice en la banda roja de hoy, y los cambios siguen en la pestaña.
- La barra superior cambia «Guardar» por el estado («Guardado» / «Guardando…»), Exportar y Versiones.

### 3.3 Versiones

- **Cuándo:** se guarda una versión al abrir el proyecto (lo que había) y, mientras se edita, como mucho una cada 10 minutos (la que se va a sobrescribir). Restaurar guarda antes la actual.
- **Cuántas:** las 30 más recientes y, de las anteriores, la última de cada día durante 90 días.
- **Restaurar:** la versión elegida pasa a ser el proyecto, con su deshacer vacío. Se pide desde la app (Versiones) y desde el inicio.

### 3.4 Caché de resultados (H44, recomendación 2)

- Al calcular, el worker devuelve la cabecera y los bytes, con el `motor` y el sha256, como los guarda la CLI. Se guardan por huella.
- Al abrir, se usan con el mismo control que los de `.fem/` (`usarGuardados`: huella, núcleo y sha256). Si cambia el núcleo, se recalcula.
- Es caché regenerable: de cada proyecto sólo se queda la última huella calculada, con un tope de 512 MiB en total; si se pasa, se purga la más antigua.

### 3.5 La pantalla de inicio (AL-a)

- **Mis proyectos:** nombre, fecha de modificación y tamaño, del más reciente al más antiguo. Abrir, Exportar, Duplicar y Borrar (con confirmación en la propia fila).
- **Proyecto nuevo** (nombre) e **Importar un proyecto.json** (o arrastrarlo): los dos crean un proyecto del navegador y lo abren.
- **Ejemplos del repositorio:** se abren sin guardar, como hoy. «Guardar en mis proyectos» los copia al navegador y sigue en la misma pestaña, sin perder el deshacer.
- **En el disco, para trabajar con el agente:** «Abrir una carpeta…» (Chrome y Edge), discreto.

## 4. AL2: PWA

- **Como Concreta** (`concreta-v2/vite.config.ts` y `src/components/pwa/`): `vite-plugin-pwa` (MIT, con Workbox, MIT) con `registerType: "prompt"` e `injectRegister: false`, y el registro desde React. Así la integración no cambia de mecanismo. Sustituye al service worker propio que se proponía al principio.
- Manifest (nombre, iconos de Concreta, `display: standalone`, `start_url` y `scope` relativos para Pages).
- Precache de todo `dist/`, incluido el núcleo WASM y las fuentes: la primera visita lo deja en la caché y después la app abre y calcula sin conexión.
- **Actualizar:** el aviso de versión nueva que ya existe (`AvisoVersion.tsx`) pasa a usar el service worker en espera. Se avisa y se aplica sólo al pulsar; con un guardado pendiente, lo para el `beforeunload` de siempre.

## 5. Criterios

1. **Sin pulsar nada:** crear, editar, cerrar la pestaña y volver deja el proyecto tal cual (test de DOM con `fake-indexeddb` y banco de Chrome).
2. **Exportar** da el texto canónico byte a byte, e importar lo exportado da la misma huella.
3. **Dos pestañas:** un cambio en una se ve en la otra si ésta no tiene nada por guardar; si lo tiene, conflicto, sin pisar nada.
4. **Reabrir un proyecto calculado no recalcula:** los resultados salen de la caché con el mismo sha256, y se rechazan si cambia el núcleo.
5. **Versiones:** restaurar da el texto de esa versión byte a byte, y la retención cumple §3.3.
6. **La carpeta y el servidor local**, sin cambios: sus pruebas y bancos pasan.
7. **AL2:** el manifest es válido y la app se instala; tras la primera visita carga y calcula sin conexión (banco de Chrome sin red), y una versión nueva se avisa y no se aplica sola.

Licencias: `fake-indexeddb` (Apache-2.0), sólo para las pruebas.

## 6. Estado

**AL1 hecha el 2026-10-23.** Pasan los criterios 1 a 6.

- **Ya en `app/src/`:**
  - `sesion/almacen.ts`: la base de datos de §3.1, las versiones con su retención (`aPurgar`), la caché de resultados y `origenNavegador`, un `Origen` más (`navegador`, `guardarResultados`);
  - `sesion/useProyecto.ts`: autoguardado a los 400 ms y al ocultar la página, una versión al abrir, lo calculado a la caché (pedido `paquete` del worker: la cabecera y los bytes como los deja la CLI en `.fem/`), exportar, «Guardar en mis proyectos» y `?local=<id>` en la URL;
  - `Inicio.tsx` (Mis proyectos, nuevo, importar, ejemplos y la carpeta aparte) y `armazon/Versiones.tsx`; en la barra, el estado del guardado, Versiones y Exportar.
- **Validación:** `app/src/test/almacen.test.ts` (el almacén, con `fake-indexeddb`), `almacenLocal.test.tsx` (criterios 1 a 4 en el DOM, con la sesión de verdad) y el banco `validacion/al/chrome.ts` (`out_chrome.txt`): en Chrome, lo calculado pasa del worker a IndexedDB y, al recargar, sale de la caché en 0,2 s con el mismo sha256. Las 50 pruebas de la app y las 253 de `src/visor` pasan, y el banco de V2c también.

**AL2 hecha el 2026-10-23.** Pasa el criterio 7.

- **Ya en `app/`:** `VitePWA` en `vite.config.ts` (precache de todo `dist/` salvo `version.json`, 28 ficheros y 2,8 MB; manifest con los iconos de Concreta), y `AvisoVersion.tsx` registra el service worker y avisa con el que queda en espera. Sin service worker, el aviso sigue saliendo de `version.json`; una página controlada no lo mira, porque recargarla sin activar el worker nuevo daría otra vez la versión de la caché. En las pruebas, `virtual:pwa-register/react` es `test/pwaRegistro.ts`.
- **Validación:** `avisoVersion.test.tsx` (el worker en espera) y el banco `validacion/al/pwa.ts` (`out_pwa.txt`), con dos builds como dos despliegues. Chrome lee el manifest sin errores; tras la primera visita el service worker controla la página; sin red (el servidor corta cada conexión), la app abre un ejemplo y lo calcula; con la segunda versión publicada, avisa, sigue 3 s en la primera sin recargar y carga la segunda al pulsar «Actualizar». Los bancos de AL y V2c pasan igual con el service worker.

**Hallazgos:**

- **AL-1. Deshacer recupera los resultados.** Tras cada cambio, la sesión busca en la caché los resultados de la huella nueva. Volver con Ctrl+Z a una versión ya calculada la enseña calculada, sin recalcular (con la carpeta y el servidor ya pasaba con `.fem/`).
- **AL-2. La vigilancia y el autoguardado.** El sello que deja una escritura propia no puede tomarse por un cambio de otra pestaña: la vigilancia no mira mientras se escribe, y el sello nuevo se apunta antes de soltar la marca. Con el autoguardado, sin esto saldrían conflictos falsos.
- **AL-3. Las pruebas de DOM se aislaban mal.** La URL `?local=` y la base de datos pasaban de una prueba a la siguiente, y la app reabría el proyecto de la anterior. `test/setup.ts` empieza cada prueba sin proyectos y con la URL limpia.
- **AL-4. El criterio 5 de V2a ya no pasa, y no es por AL.** Los diagnósticos tras escribir una celda del edificio objetivo salen en 3,3 s (≤ 1,5 s). Medido igual en HEAD sin AL, con un worktree; la salida guardada es del 12 de octubre, de antes de LV2, HR y PF. **Pendiente del usuario:** aceptar el tiempo o mirarlo.
