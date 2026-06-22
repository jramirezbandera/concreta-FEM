# Área 1 · Motor FEM en el navegador — PyNite (PyNiteFEA) sobre Pyodide/WASM en Web Worker

> Investigación de mejores prácticas. Fecha: 2026-06-20. Todos los datos de versiones provienen de fuentes primarias (lockfiles oficiales de Pyodide en CDN, `setup.py` y API JSON de PyPI, código fuente de PyNite y micropip en GitHub). Las afirmaciones con menor verificabilidad se marcan explícitamente.

---

## Resumen ejecutivo

- **El par de versiones es el problema central y no es trivial.** PyNiteFEA introdujo el pin `numpy>=2.4.0` en la versión **2.1.0**, y `numpy 2.4` solo lo trae **Pyodide 314.0.0** (Python 3.14), que es la última y se anuncia como "stable" en el CDN pero arrastra un matiz de ABI prerelease (2026 ABI). [confianza alta]
- **Dos caminos válidos:** (A) *bleeding-edge*: **Pyodide 314.0.0 + PyNiteFEA 3.0.0** (numpy 2.4.3, scipy 1.17.1, Python 3.14); (B) *conservador y plenamente estable*: **Pyodide 0.27.7 o 0.28.x + PyNiteFEA 2.0.2** (última versión de PyNite con `numpy` sin pin, instalable sobre numpy 2.0.2/2.2.5). [confianza alta]
- **Todas las ruedas de PyNiteFEA son `py3-none-any.whl` (Python puro).** Se instalan vía `micropip` sin compilación; el cálculo pesado lo hacen numpy/scipy, que son paquetes nativos integrados en Pyodide. [confianza alta]
- **Trampa crítica nueva (PyNite 1.x–3.x): `matplotlib` está en `install_requires`, no en un extra.** `micropip.install("PyNiteFEA")` arrastrará matplotlib. Solución: instalar con resolución de dependencias controlada (`deps=False` + dependencias mínimas manuales) o aceptar matplotlib (existe como paquete Pyodide, pero suma ~varios MB). El `[all]` (vtk, pyvista, pdfkit, jinja2) sigue siendo prohibido. [confianza alta]
- **scipy SÍ está en Pyodide** como paquete nativo precompilado; PyNite lo usa por defecto (`sparse=True`) para el solver disperso. No requiere micropip ni acción especial salvo dejar que se cargue como dependencia de import. [confianza alta]
- **Patrón recomendado:** Pyodide cargado dentro de un **Web Worker**, expuesto a la UI con **Comlink** (`expose`/`wrap`); todas las llamadas son asíncronas; resultados devueltos como JSON/estructuras clonables o `ArrayBuffer` transferibles. [confianza alta]
- **Arranque:** primera carga del orden de decenas de MB (runtime + numpy + scipy + matplotlib), cacheada por el navegador tras la primera vez; conviene **precargar el worker en segundo plano** mientras el arquitecto modela y habilitar "Calcular" al estar listo. Límite de memoria WASM ~2 GB (ampliable a 4 GB con memory growth). [confianza media]
- **API PyNite:** `FEModel3D` → `add_node/add_material/add_section/add_member/def_support/def_releases/add_load_combo/add_*_load` → `analyze()`/`analyze_PDelta()` → resultados vía `Member.*_array()` y `Node.RxnFX[combo]`/`Node.DX[combo]`. Convención de direcciones: **MAYÚSCULAS = global, minúsculas = local**. [confianza alta]

---

## 1. Compatibilidad de versiones Pyodide ↔ PyNiteFEA ↔ numpy/scipy

### 1.1 — Versiones exactas de numpy/scipy/Python por versión de Pyodide (dato de lockfile)
- **claim:** Las versiones nativas integradas son: **Pyodide 0.26.4** → Python ~3.12, numpy **1.26.4**, scipy **1.12.0**. **Pyodide 0.27.7** → numpy **2.0.2**, scipy **1.14.1**. **Pyodide 0.28.0** → numpy **2.2.5**, scipy **1.14.1**. **Pyodide 0.29.4** → Python **3.13.2**, numpy **2.2.5**, scipy **1.14.1**, matplotlib **3.8.4**. **Pyodide 314.0.0** → Python **3.14.0**, numpy **2.4.3**, scipy **1.17.1**, matplotlib **3.10.8**, micropip **0.11.1**.
- **rationale:** Son los valores leídos directamente del `pyodide-lock.json` oficial servido en `cdn.jsdelivr.net/pyodide/v<ver>/full/`. Es la fuente canónica de qué wheel nativo trae cada release; no es interpretación de blog.
- **sources:**
  - https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide-lock.json
  - https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide-lock.json
  - https://cdn.jsdelivr.net/pyodide/v0.28.0/full/pyodide-lock.json
  - https://cdn.jsdelivr.net/pyodide/v0.29.4/full/pyodide-lock.json
  - https://cdn.jsdelivr.net/pyodide/v314.0.0/full/pyodide-lock.json
- **confidence:** alta

### 1.2 — Esquema de versionado de Pyodide cambió a calver; 314.0.0 es la última
- **claim:** Pyodide adoptó **calendar versioning**. El dist-tag `latest` en npm apunta a **314.0.0** (Python 3.14); también existen 0.28.x y 0.29.x. El blog oficial confirma que 314.0 usa calver y que, con PEP 783 aceptado, las platform tags pasan a prefijo `pyemscripten_*` (`pyemscripten_2026_0` para Python 3.14 / Pyodide 314.x; `pyemscripten_2025_0` para Python 3.13 / Pyodide 0.29.x).
- **rationale:** El registro npm de `pyodide` da `dist-tags.latest = 314.0.0`; el blog de release lo describe.
- **sources:**
  - https://registry.npmjs.org/pyodide (dist-tags)
  - https://blog.pyodide.org/posts/314-release/
- **confidence:** alta

### 1.3 — Matiz de estabilidad de 314.0.0 (ABI 2026 prerelease)
- **claim:** El blog de Pyodide 314.0 indica que "el ABI 2026 es por ahora solo para el build *prerelease* y debe habilitarse vía la opción `pyodide-prerelease`", y que Pyodide hará 314.0 estable disponible en un release v4.1.0 próximamente. Es decir, 314.0.0 funciona pero conviene verificar empíricamente la carga de wheels de terceros (PyNite) y fijar la versión exacta del CDN, no usar "latest".
- **rationale:** Texto del propio post de release. Implica riesgo de inestabilidad de ABI para paquetes compilados; PyNite es Python puro (menos riesgo) pero sus deps numpy/scipy son nativas y sí dependen del ABI.
- **sources:** https://blog.pyodide.org/posts/314-release/
- **confidence:** media (el texto es claro; el impacto práctico real sobre PyNite hay que confirmarlo montando el worker)

### 1.4 — PyNiteFEA: histórico de requisitos de numpy/Python (dato de PyPI)
- **claim:** Evolución de dependencias verificada vía API JSON de PyPI por versión:
  - **1.6.2:** `requires_python >=3.7`; `numpy` (sin pin), `scipy`, `PrettyTable`, `matplotlib`.
  - **2.0.0 / 2.0.2:** `requires_python >=3.10`; `numpy` (sin pin), `scipy`, `PrettyTable`, `matplotlib`.
  - **2.1.0 y posteriores (2.2.x, 2.3.0, 2.4.x):** `requires_python >=3.11`; **`numpy>=2.4.0`**, `scipy`, `PrettyTable`, `matplotlib`.
  - **3.0.0 (última, "latest"):** `requires_python >=3.11` (clasificadores 3.11/3.12/3.13 en `setup.py`); **`numpy>=2.4.0`**, `scipy`, `PrettyTable`, `matplotlib`.
- **rationale:** `requires_dist` y `requires_python` leídos del endpoint `pypi.org/pypi/PyNiteFEA/<ver>/json`, contrastados con el `setup.py` del repositorio (`install_requires=['numpy>=2.4.0','PrettyTable','scipy','matplotlib']`).
- **sources:**
  - https://pypi.org/pypi/PyNiteFEA/json (latest 3.0.0)
  - https://pypi.org/pypi/PyNiteFEA/2.0.2/json
  - https://pypi.org/pypi/PyNiteFEA/2.1.0/json
  - https://raw.githubusercontent.com/JWock82/PyNite/main/setup.py
- **confidence:** alta

### 1.5 — El pin `numpy>=2.4.0` es el muro de compatibilidad
- **claim:** PyNiteFEA **2.1.0+ (incluida 3.0.0)** exige `numpy>=2.4.0`. De las versiones de Pyodide actuales, **solo 314.0.0 trae numpy 2.4.3**; Pyodide 0.28/0.29 traen numpy 2.2.5 (< 2.4) y Pyodide 0.27 trae 2.0.2. Por tanto, en un Pyodide < 314, `micropip.install("PyNiteFEA")` (que resuelve a la última) fallará la resolución de `numpy>=2.4.0` salvo que se fije una versión antigua de PyNite.
- **rationale:** Cruce directo entre el pin de PyNite (1.4) y los lockfiles de Pyodide (1.1). Coincide con la nota del propio README/CLAUDE.md del proyecto ("versiones recientes exigen numpy ≥ 2.4 y abandonan 3.10").
- **sources:** ver 1.1 y 1.4
- **confidence:** alta

### 1.6 — Recomendación de pares concretos
- **claim:** Dos pares funcionales recomendados:
  - **(A) Bleeding-edge:** **Pyodide 314.0.0 (Python 3.14, numpy 2.4.3, scipy 1.17.1) + PyNiteFEA 3.0.0.** Satisface `numpy>=2.4.0`. Riesgo: matiz ABI 2026 prerelease (1.3); validar carga.
  - **(B) Conservador (recomendado para empezar el MVP):** **Pyodide 0.28.x (numpy 2.2.5, scipy 1.14.1, Python 3.13) + PyNiteFEA 2.0.2.** PyNite 2.0.2 no fija numpy, instala sobre numpy 2.2.5 sin conflicto, sobre un Pyodide plenamente estable. Alternativa equivalente: Pyodide 0.27.7 + PyNiteFEA 2.0.2.
- **rationale:** (A) usa la última de todo pero asume el riesgo de la 314 prerelease; (B) maximiza estabilidad fijando PyNite a la última versión cuyo requisito de numpy es compatible con un Pyodide estable. El proyecto debe **documentar el par elegido y pinear ambas versiones exactas** (regla del CLAUDE.md §8).
- **sources:** ver 1.1, 1.4, 1.5; https://blog.pyodide.org/posts/314-release/
- **confidence:** media-alta (la recomendación es sólida según los datos; el funcionamiento extremo a extremo debe confirmarse montando el worker, como exige el propio CLAUDE.md)

---

## 2. Instalación con micropip (sin extras de visualización)

### 2.1 — micropip instala wheels puras desde PyPI con resolución de dependencias
- **claim:** `micropip.install(requirements, deps=True, keep_going=False, pre=False, index_urls=None, *, constraints=None, reinstall=False, verbose=None)`. Solo carga **wheels Python puras** o wheels wasm32/emscripten construidas por Pyodide. Si un paquete no está en el lockfile de Pyodide, se baja de PyPI (`pypi.org/simple` por defecto). Las descargas se **cachean en el navegador** (no en Node).
- **rationale:** Firma y docstring leídos del código fuente de micropip (`package_manager.py`, método `install`).
- **sources:** https://raw.githubusercontent.com/pyodide/micropip/main/micropip/package_manager.py
- **confidence:** alta

### 2.2 — Trampa: `matplotlib` es dependencia obligatoria de PyNite, no un extra
- **claim:** En PyNiteFEA 1.x–3.x, `install_requires` incluye `matplotlib` (además de `numpy`, `scipy`, `PrettyTable`). Por tanto `micropip.install("PyNiteFEA")` con `deps=True` instalará matplotlib aunque no se pida `[all]`. Esto contradice la expectativa de "instalar sin nada de visualización".
- **rationale:** `setup.py` del repo: `install_requires=['numpy>=2.4.0','PrettyTable','scipy','matplotlib']`. Confirmado en `requires_dist` de PyPI (matplotlib aparece sin marcador `extra ==`).
- **sources:**
  - https://raw.githubusercontent.com/JWock82/PyNite/main/setup.py
  - https://pypi.org/pypi/PyNiteFEA/json
- **confidence:** alta

### 2.3 — Cómo evitar arrastrar matplotlib (estrategias)
- **claim:** Opciones, en orden de preferencia:
  1. **Instalar dependencias a mano y PyNite sin deps:** primero `await pyodide.loadPackage(["numpy","scipy"])` (paquetes nativos del lockfile), luego `await micropip.install("PrettyTable")`, y finalmente `await micropip.install("PyNiteFEA==<ver>", deps=False)`. Con `deps=False` micropip **no** instala dependencias del METADATA, evitando matplotlib. Riesgo: si algún módulo de PyNite hace `import matplotlib` en tiempo de import, fallará; hay que verificar que los módulos de visualización de PyNite (Visualization/Rendering) solo se importen *perezosamente*.
  2. **Aceptar matplotlib:** existe como paquete Pyodide nativo (3.8.4 en 0.29, 3.10.8 en 314); cargarlo funciona pero añade peso de descarga. Evita el riesgo de import roto.
  3. **`constraints`/`index_urls`:** no sirven para *excluir* una dependencia declarada; `constraints` solo fija versión si se necesita. No hay opción nativa de "blocklist" de dependencias en micropip salvo `deps=False`.
- **rationale:** Semántica de `deps` documentada en el docstring de micropip ("If True, install dependencies specified in METADATA... Otherwise do not install dependencies"). La opción 1 es la única que cumple literalmente "sin matplotlib".
- **sources:** https://raw.githubusercontent.com/pyodide/micropip/main/micropip/package_manager.py
- **confidence:** media-alta (la mecánica de `deps=False` es segura; el riesgo de import perezoso de matplotlib en PyNite debe verificarse import a import en el build elegido)

### 2.4 — scipy/numpy se cargan como paquetes nativos de Pyodide, no desde PyPI
- **claim:** numpy y scipy están **precompilados e integrados** en cada release de Pyodide (entradas en `pyodide-lock.json` con `imports: ["numpy"]` / `["scipy"]`). Se cargan con `pyodide.loadPackage(...)` o automáticamente cuando micropip los detecta como dependencia, o vía `pyodide.loadPackagesFromImports(code)`. No se bajan de PyPI (PyPI no tiene wheels wasm32 de scipy). PyNite usa scipy para el solver disperso por defecto (`sparse=True`).
- **rationale:** Entradas `numpy`/`scipy` presentes en los lockfiles con su wheel `*wasm32.whl`. El flujo nativo de carga es el esperado y más rápido.
- **sources:**
  - https://cdn.jsdelivr.net/pyodide/v314.0.0/full/pyodide-lock.json
  - https://raw.githubusercontent.com/pyodide/micropip/main/micropip/package_manager.py
- **confidence:** alta

### 2.5 — Nunca usar `PyNiteFEA[all]` ni los extras pesados
- **claim:** Los extras `all`, `vtk`, `pyvista`, `reporting`, `derivations` declaran `vtk>=9.3.0`, `pyvista[all,trame]>=0.43.4`, `trame_jupyter_extension`, `ipywidgets`, `pdfkit`, `Jinja2`, `jupyterlab`, `sympy`. vtk/pyvista no tienen wheel wasm y romperían/inflan la instalación; el render lo hace la app con three.js/Plotly a partir de los arrays numéricos de PyNite.
- **rationale:** `extras_require` del `setup.py`; coincide con la regla de oro del proyecto (CLAUDE.md §8, §17).
- **sources:** https://raw.githubusercontent.com/JWock82/PyNite/main/setup.py
- **confidence:** alta

---

## 3. Web Worker + Pyodide + Comlink

### 3.1 — Patrón: cargar Pyodide dentro del Worker, exponer con Comlink
- **claim:** El patrón recomendado es: el **Web Worker** importa el runtime (`importScripts("https://cdn.jsdelivr.net/pyodide/v<ver>/full/pyodide.js")` o ESM `import { loadPyodide }`), llama `self.pyodide = await loadPyodide()`, carga paquetes (`loadPackage`/micropip), y expone un objeto API (`{ ready, calcular, estadoMotor }`) con `Comlink.expose(api)`. El hilo principal hace `const solver = Comlink.wrap(new Worker(...))` y llama `await solver.calcular(modeloFEM)`. Pyodide oficialmente documenta su uso en Web Worker.
- **rationale:** Es el patrón estándar Pyodide-en-worker; Comlink elimina el `postMessage` manual y hace que cada método del worker sea un `Promise`. Encaja con la elección del proyecto (Comlink + Web Worker, CLAUDE.md §4 y §8).
- **sources:**
  - https://pyodide.org/en/stable/usage/webworker.html (referenciada; doc oficial del patrón worker)
  - https://github.com/GoogleChromeLabs/comlink (README)
- **confidence:** alta (Comlink confirmado por README; la página worker de Pyodide existe y es la guía oficial, aunque su contenido exacto no se pudo volcar por bloqueo de fetch)

### 3.2 — Comlink: semántica de proxy asíncrono y transferencia de datos
- **claim:** `Comlink.expose(value)` publica desde un hilo; `Comlink.wrap(worker)` crea un proxy en el otro. **Toda llamada/acceso a través del proxy es asíncrona** (devuelve Promise; "pon `await` delante"). Por defecto los valores se pasan por **structured clone** (copia profunda). Para `ArrayBuffer` u objetos transferibles se usa `Comlink.transfer()` (cede propiedad sin copiar). Las funciones/callbacks se pasan con `Comlink.proxy()` (se quedan en su hilo original). Limpieza opcional con `[releaseProxy]()`.
- **rationale:** README oficial de Comlink.
- **sources:** https://github.com/GoogleChromeLabs/comlink
- **confidence:** alta

### 3.3 — No bloquear el hilo principal; estados de carga visibles
- **claim:** Al correr Pyodide en el worker, la compilación/solución (ligada al GIL y a CPU) ocurre fuera del hilo de UI, manteniendo scroll/entrada fluidos. La app debe exponer estados explícitos: "cargando motor" (durante `loadPyodide`+paquetes) y "calculando" (durante `analyze`), y habilitar "Calcular" solo cuando el worker señale `ready`.
- **rationale:** Es el motivo de usar worker (aislar cómputo del hilo de UI) y coincide con las reglas del proyecto (CLAUDE.md §2.7). Patrón ampliamente documentado para Pyodide en worker.
- **sources:**
  - https://pyodide.org/en/stable/usage/webworker.html
  - https://medium.com/@Nexumo_/python-in-the-browser-10-pyodide-wasm-patterns-131278920304
- **confidence:** media-alta

### 3.4 — Contrato de datos worker↔UI: JSON serializable
- **claim:** Conviene pasar a `calcular()` el JSON de Capa 2 (estructura clonable) y devolver resultados como objeto JSON plano (esfuerzos por barra como arrays de números, deformada, reacciones). Para grandes volúmenes de puntos de diagrama, considerar devolver `Float64Array`/`ArrayBuffer` con `Comlink.transfer()` para evitar copias caras. Convertir los `numpy.ndarray` a listas/typed arrays en Python (`.tolist()` o `pyodide.ffi.to_js`) antes de cruzar la frontera.
- **rationale:** structured clone no soporta objetos arbitrarios de Python; hay que materializar a tipos JS. Transferibles minimizan coste. (Recomendación de diseño basada en la semántica de 3.2 y en la API de arrays de PyNite del §5.)
- **sources:** https://github.com/GoogleChromeLabs/comlink ; https://pyodide.org/en/stable/usage/type-conversions.html (referenciada)
- **confidence:** media

---

## 4. Rendimiento y arranque

### 4.1 — Tamaño de descarga inicial
- **claim:** El runtime base de Pyodide pesa varios MB comprimidos; numpy y scipy añaden wheels notables cada uno (scipy es el más grande). Con numpy+scipy(+matplotlib) la primera carga está en el orden de **decenas de MB** (coherente con la estimación ~15–30 MB del CLAUDE.md). El runtime ofrece un paquete `pyodide-core` mínimo y el `full` con todo.
- **rationale:** Tamaño documentado como "varios MB comprimidos antes de paquetes; numpy/scipy suman cada uno". scipy en WASM es pesado. El número exacto depende del par de versiones; medir tras montar.
- **sources:**
  - https://pyodide.org/en/stable/usage/downloading-and-deploying.html
  - https://www.technolynx.com/post/how-pyodide-works-running-python-inference-in-wasm-and-when-it-fits/
- **confidence:** media (orden de magnitud fiable; cifra exacta por confirmar empíricamente)

### 4.2 — Caché del navegador y precarga
- **claim:** micropip y `loadPackage` cachean las descargas en el navegador, de modo que **la segunda visita evita la descarga** (no la instanciación WASM). Mejor práctica: **precargar Pyodide y paquetes en segundo plano** al abrir la app mientras el usuario modela, para que "Calcular" esté listo sin espera percibida. Considerar servir Pyodide desde el propio origen (self-host) en lugar del CDN para control de versión y caché.
- **rationale:** El docstring de micropip dice explícitamente que en navegador las descargas de PyPI se cachean. La instanciación WASM persiste aun con caché caliente.
- **sources:**
  - https://raw.githubusercontent.com/pyodide/micropip/main/micropip/package_manager.py
  - https://www.technolynx.com/post/how-pyodide-works-running-python-inference-in-wasm-and-when-it-fits/
- **confidence:** alta

### 4.3 — Tiempos típicos de arranque
- **claim:** La instanciación del intérprete CPython + stdlib en WASM ronda **4–5 s** en discusiones de la comunidad (sin contar import de numpy/scipy, que añade tiempo). Es latencia que el usuario percibe en la primera interacción aun con caché caliente.
- **rationale:** Dato de discusión de la comunidad Python/Pyodide; orden de magnitud, no garantía. Varía mucho por hardware/navegador.
- **sources:** https://discuss.python.org/t/minifying-the-stdlib-in-pyodide/8414
- **confidence:** baja (cifra de foro, no benchmark oficial; confirmar con medición propia del par elegido)

### 4.4 — Límite de memoria WASM
- **claim:** Pyodide/WASM tiene un límite práctico de memoria de **~2 GB**, ampliable hasta **4 GB** habilitando *memory growth* / el modo 4GB de WASM (discusión oficial del repo). Para modelos FEM grandes (muchos nudos/barras, matrices dispersas) este es el techo a vigilar; el solver disperso de scipy mitiga el consumo.
- **rationale:** Discusión #5140 del repo Pyodide sobre build con memory growth hasta 4 GB; el límite de 2 GB es el comportamiento por defecto de WASM de 32 bits.
- **sources:**
  - https://github.com/pyodide/pyodide/discussions/5140
  - https://server.xlwings.org/en/latest/wasm_limitations/
- **confidence:** media

---

## 5. Contrato de datos / API de PyNite (Capa 2 → cálculo → resultados)

### 5.1 — Construcción de `FEModel3D`
- **claim:** Orden y firmas (PyNite 3.0.0, `Pynite/FEModel3D.py`):
  - `add_material(name, E, G, nu, rho, fy=None)`
  - `add_section(name, A, Iy, Iz, J)`
  - `add_node(name, X, Y, Z)`
  - `add_member(name, i_node, j_node, material_name, section_name, rotation=0.0, tension_only=False, comp_only=False)`
  - `def_support(node_name, support_DX, support_DY, support_DZ, support_RX, support_RY, support_RZ)` (booleanos)
  - `def_support_spring(node_name, dof, stiffness, direction=None)` (apoyos elásticos)
  - `def_releases(member_name, Dxi, Dyi, Dzi, Rxi, Ryi, Rzi, Rxj, Ryj, Rzj)` (todos bool, por defecto False)
- **rationale:** Firmas leídas del código fuente actual del repo.
- **sources:** https://raw.githubusercontent.com/JWock82/PyNite/main/Pynite/FEModel3D.py
- **confidence:** alta

### 5.2 — Cargas y convención de direcciones global/local
- **claim:**
  - `add_node_load(node_name, direction, P, case='Case 1')` con `direction ∈ {'FX','FY','FZ','MX','MY','MZ'}` (siempre **global**).
  - `add_member_pt_load(member_name, direction, P, x, case='Case 1')`.
  - `add_member_dist_load(member_name, direction, w1, w2, x1=None, x2=None, case='Case 1', self_weight=False)` con `direction ∈ {'Fx','Fy','Fz','FX','FY','FZ'}`.
  - `add_member_self_weight(global_direction, factor, case='Case 1')`.
  - **Convención clave:** en cargas de barra, **minúsculas (`Fx/Fy/Fz`) = sistema local de la barra; MAYÚSCULAS (`FX/FY/FZ`) = sistema global del modelo.** Pasar la dirección equivocada es un error frecuente (vigilar en el discretizador, como avisa el CLAUDE.md §7).
- **rationale:** Docstrings y validaciones del código (`if direction not in ('Fx','Fy','Fz','FX','FY','FZ')`).
- **sources:** https://raw.githubusercontent.com/JWock82/PyNite/main/Pynite/FEModel3D.py
- **confidence:** alta

### 5.3 — Combinaciones de carga
- **claim:** `add_load_combo(name, factors, combo_tags=None)` donde `factors` es un dict `{nombre_caso: factor}`. Ej.: ELU CTE `1.35·G + 1.5·Q` → `add_load_combo('ELU', {'G':1.35,'Q':1.5}, combo_tags=['ELU'])`. Los métodos de resultados toman `combo_name` (por defecto `'Combo 1'`) y `analyze(..., combo_tags=[...])` permite filtrar qué combinaciones se resuelven.
- **rationale:** Firma `add_load_combo(self, name, factors, combo_tags=None)` y parámetro `combo_tags` en `analyze`.
- **sources:** https://raw.githubusercontent.com/JWock82/PyNite/main/Pynite/FEModel3D.py
- **confidence:** alta

### 5.4 — Análisis: `analyze()`, `analyze_linear()`, `analyze_PDelta()`
- **claim:**
  - `analyze(log=False, check_stability=True, check_statics=False, max_iter=30, sparse=True, combo_tags=None, spring_tolerance=0, member_tolerance=0, num_steps=1)` — análisis elástico de primer orden, con soporte de tension/comp-only por iteración y load stepping.
  - `analyze_linear(log=False, check_stability=True, check_statics=False, sparse=True, combo_tags=None)` — lineal puro (más rápido, sin iteración T/C-only), recomendable para el MVP de pórticos lineales.
  - `analyze_PDelta(log=False, check_stability=True, max_iter=30, sparse=True, combo_tags=None)` — segundo orden P-Δ (Fase 2).
  - `analyze_modal(...)` y `analyze_pushover(...)` existen (fases futuras).
  - **`sparse=True` por defecto** → usa el solver disperso de scipy (alineado con la regla del proyecto).
- **rationale:** Firmas y docstrings del código fuente.
- **sources:** https://raw.githubusercontent.com/JWock82/PyNite/main/Pynite/FEModel3D.py
- **confidence:** alta

### 5.5 — `check_statics`
- **claim:** Pasar `check_statics=True` a `analyze()`/`analyze_linear()` ejecuta `Analysis._check_statics(self, combo_tags)`, una comprobación de equilibrio estático global por combinación. Útil en golden tests para validar que reacciones equilibran cargas. No está activo por defecto (coste).
- **rationale:** Bloques `if check_statics == True: Analysis._check_statics(...)` en ambos métodos de análisis.
- **sources:** https://raw.githubusercontent.com/JWock82/PyNite/main/Pynite/FEModel3D.py
- **confidence:** alta

### 5.6 — Extracción de esfuerzos por barra: métodos `*_array()`
- **claim:** En `Member3D` (objeto barra) los resultados para diagramas se obtienen como arrays numpy:
  - `shear_array(Direction, n_points, combo_name='Combo 1', x_array=None)` con `Direction ∈ {'Fy','Fz'}`.
  - `moment_array(Direction, n_points, combo_name='Combo 1', x_array=None)` con `Direction ∈ {'My','Mz'}`.
  - `axial_array(n_points, combo_name='Combo 1', x_array=None)`.
  - `torque_array(n_points, combo_name='Combo 1', x_array=None)`.
  - `deflection_array(Direction, n_points, combo_name='Combo 1', x_array=None)` con `Direction ∈ {'dx','dy','dz'}`.
  - Valores puntuales/extremos: `shear(...)`, `moment(...)`, `axial(x, combo)`, `max_moment(Direction, ...)`, `min_moment(...)`, `max_shear(...)`.
  - Devuelven `NDArray[float64]`; convertir a typed array/lista antes de cruzar a JS (ver 3.4).
- **rationale:** Firmas leídas de `Pynite/Member3D.py`.
- **sources:** https://raw.githubusercontent.com/JWock82/PyNite/main/Pynite/Member3D.py
- **confidence:** alta

### 5.7 — Reacciones y desplazamientos nodales
- **claim:** En `Node3D`, reacciones y desplazamientos son **dicts indexados por nombre de combinación**: `node.RxnFX[combo]`, `RxnFY`, `RxnFZ`, `RxnMX`, `RxnMY`, `RxnMZ` (reacciones en apoyos), y `node.DX[combo]`, `DY`, `DZ`, `RX`, `RY`, `RZ` (desplazamientos/giros). También flags `support_DX...` y soportes elásticos `spring_DX...`, y desplazamientos impuestos `EnforcedDX...`.
- **rationale:** Atributos `self.RxnFX: Dict[str,float] = {}` etc. en `Node3D.__init__`.
- **sources:** https://raw.githubusercontent.com/JWock82/PyNite/main/Pynite/Node3D.py
- **confidence:** alta

---

## 6. Errores y trampas comunes

### 6.1 — Instalar "la última" PyNite a ciegas rompe por numpy
- **claim:** `micropip.install("PyNiteFEA")` resuelve a 3.0.0 → `numpy>=2.4.0`; en cualquier Pyodide < 314 (numpy ≤ 2.2.5) la resolución falla. Hay que **pinear la versión de PyNite al par de Pyodide** (§1.6) y nunca dejar la versión abierta.
- **sources:** §1.1, §1.4, §1.5
- **confidence:** alta

### 6.2 — matplotlib colado como dependencia obligatoria
- **claim:** Ya en §2.2/§2.3: `matplotlib` está en `install_requires`. Si no se controla (`deps=False`), se descarga aunque no se use, contradiciendo "sin visualización".
- **sources:** https://raw.githubusercontent.com/JWock82/PyNite/main/setup.py
- **confidence:** alta

### 6.3 — Confundir dirección global/local en cargas
- **claim:** Usar `'FY'` (global) donde se quería `'Fy'` (local de barra) —o viceversa— produce esfuerzos erróneos sin error de ejecución (ambas son válidas en `add_member_dist_load`). El discretizador debe ser explícito y testeado (golden tests) en este punto.
- **sources:** https://raw.githubusercontent.com/JWock82/PyNite/main/Pynite/FEModel3D.py
- **confidence:** alta

### 6.4 — Nombre de paquete equivocado: `PyNiteFEA` vs `Pynite`
- **claim:** Hay un paquete distinto llamado `Pynite` en PyPI sin relación con FEA. Hay que instalar **`PyNiteFEA`**. El módulo a importar es `Pynite` (`from Pynite import FEModel3D`), distinto del nombre de distribución.
- **rationale:** Aviso explícito en la doc de instalación oficial; el repo es `JWock82/Pynite` pero el paquete es `PyNiteFEA` y `packages=find_packages(include=['Pynite',...])`.
- **sources:** https://pynite.readthedocs.io/en/latest/installation.html ; https://raw.githubusercontent.com/JWock82/PyNite/main/setup.py
- **confidence:** alta

### 6.5 — vtk/pyvista/pdfkit no existen en WASM
- **claim:** `PyNiteFEA[all]` arrastra vtk, pyvista, pdfkit, jinja2, etc., sin wheel wasm; la instalación fallará o requerirá `keep_going=True` ignorando errores. Renderizar con three.js/Plotly desde los arrays (§5.6), no con el render de PyNite.
- **sources:** https://raw.githubusercontent.com/JWock82/PyNite/main/setup.py
- **confidence:** alta

### 6.6 — Inestabilidad/mecanismo: `check_stability`
- **claim:** Si la estructura no está suficientemente sujeta, `analyze` lanza excepción por matriz de rigidez singular (con `check_stability=True`). Conviene capturar esa excepción y traducirla a lenguaje de obra ("la estructura no está sujeta"), y además validar la sujeción en el discretizador *antes* de llamar al solver (CLAUDE.md §7).
- **sources:** https://raw.githubusercontent.com/JWock82/PyNite/main/Pynite/FEModel3D.py (docstring `:raises Exception: If the stiffness matrix is singular...`)
- **confidence:** alta

### 6.7 — Olvidar materializar ndarrays antes de cruzar a JS
- **claim:** Devolver objetos `numpy.ndarray` u objetos Python directamente por Comlink falla o produce proxies costosos. Convertir a listas/`Float64Array` en Python (`.tolist()` / `pyodide.ffi.to_js`) antes de retornar.
- **sources:** https://github.com/GoogleChromeLabs/comlink ; https://pyodide.org/en/stable/usage/type-conversions.html
- **confidence:** media

---

## Recomendaciones accionables

1. **Fijar el par de versiones y documentarlo.** Empezar por el par conservador **Pyodide 0.28.x + PyNiteFEA 2.0.2** (numpy 2.2.5 / scipy 1.14.1, Python 3.13), plenamente estable y sin el pin `numpy>=2.4`. Evaluar migrar a **Pyodide 314.0.0 + PyNiteFEA 3.0.0** cuando la 314 deje de arrastrar el matiz de ABI prerelease (release v4.1.0 anunciado). Pinear ambas versiones exactas en el código del worker y en la URL del CDN (nunca "latest").
2. **Self-host del runtime Pyodide** (o CDN con versión fija) para control de caché/versión y para no depender de la disponibilidad del CDN en producción.
3. **Instalación controlada sin matplotlib:** `loadPackage(["numpy","scipy"])` → `micropip.install("PrettyTable")` → `micropip.install("PyNiteFEA==<ver>", deps=False)`. **Verificar import a import** que PyNite no haga `import matplotlib` en tiempo de carga del módulo `FEModel3D`/análisis; si lo hace, cargar también matplotlib o usar un fork sin esa importación a nivel de módulo.
4. **Aislar todo Python en `/src/solver`** con un Worker que `Comlink.expose` una API mínima (`ready()`, `estadoMotor()`, `calcular(modeloFEM_json)`), y `Comlink.wrap` en `solverClient.ts`. Nada de Pyodide fuera de esa carpeta.
5. **Precargar el motor en segundo plano** al abrir la app; mostrar estados "cargando motor" y "calculando"; habilitar "Calcular" solo con el worker `ready`.
6. **Contrato de resultados materializado:** en `pynite_glue.py`, tras `analyze(sparse=True)`, recoger por combinación: esfuerzos por barra con `*_array(n_points, combo)`, deformada con `deflection_array`, reacciones con `node.RxnF*[combo]`. Convertir todo a listas/typed arrays y devolver JSON; usar `Comlink.transfer()` para los buffers grandes de diagramas.
7. **Golden tests con `check_statics=True`** en el pipeline (viga biapoyada, voladizo, pórtico) para validar equilibrio y atrapar errores de dirección global/local antes de fiarse de los resultados.
8. **Vigilar el techo de memoria WASM (~2 GB)** en modelos grandes; mantener `sparse=True` (scipy). Si se acerca el límite, considerar build con memory growth a 4 GB.
9. **Validación previa en el discretizador** (sujeción suficiente, referencias, nombres únicos) para no depender de la excepción de matriz singular de PyNite; traducir cualquier fallo del solver a lenguaje de obra.
10. **Medir empíricamente** tamaño de descarga y tiempo de arranque del par elegido (las cifras de comunidad son orientativas) y documentar el resultado en el repo.

---

### Notas de método y limitaciones

- Versiones de numpy/scipy/Python: **alta confianza** (leídas de lockfiles oficiales y de PyPI/`setup.py`, no de blogs).
- Una primera consulta vía resumen de página dio cifras de numpy/scipy **erróneas** para Pyodide 0.27/0.28 (las invirtió); se descartaron en favor de los lockfiles. Cuidado al confiar en resúmenes de terceros para datos de versión.
- Las páginas `pyodide.org` y `pypi.org/project/...` devolvieron HTTP 403 al fetch directo; los datos se obtuvieron de fuentes primarias equivalentes (CDN jsdelivr para lockfiles, API JSON de PyPI, raw.githubusercontent para código y `setup.py`).
- El funcionamiento extremo a extremo del par de versiones (especialmente la 314.0.0 y el import perezoso de matplotlib en PyNite) **debe confirmarse montando el worker**, tal como exige el propio CLAUDE.md §8.
