# Verificación adversarial · 01-motor-fem.md

> Verificador independiente. Cada afirmación de alto riesgo comprobada DE CERO contra fuentes primarias (lockfiles de Pyodide en cdn.jsdelivr.net, API JSON de PyPI, código fuente en raw.githubusercontent, README de Comlink, docs Pyodide/PyNite). Fecha de verificación: 2026-06-20.

---

## Bloque 1 — Pin de numpy en PyNiteFEA (2.1.0, 3.0.0) y requires_python

**Afirmación del doc (§1.4):** 2.1.0+ (incl. 3.0.0) exigen `numpy>=2.4.0` y `requires_python >=3.11`; 2.0.2 sin pin de numpy y `>=3.10`; 1.6.2 `>=3.7`.

- **VERIFICADO (3.0.0).** `requires_dist` incluye `"numpy>=2.4.0"`, `"PrettyTable"`, `"scipy"`, `"matplotlib"`; `requires_python = ">=3.11"`.
  - URL: https://pypi.org/pypi/PyNiteFEA/json — dato: `"numpy>=2.4.0"`, `">=3.11"`.
- **VERIFICADO (2.1.0).** `requires_dist` incluye `"numpy>=2.4.0"`; `requires_python = ">=3.11"`. Confirma que el pin se introdujo ya en 2.1.0.
  - URL: https://pypi.org/pypi/PyNiteFEA/2.1.0/json — dato: `"numpy>=2.4.0"`, `">=3.11"`.
- **VERIFICADO (2.0.2).** `requires_dist` lista `"numpy"` sin pin; `requires_python = ">=3.10"`.
  - URL: https://pypi.org/pypi/PyNiteFEA/2.0.2/json — dato: `"numpy"` (sin versión), `">=3.10"`.
- **VERIFICADO (setup.py main).** `install_requires=['numpy>=2.4.0','PrettyTable','scipy','matplotlib']`; `python_requires='>=3.11'`; clasificadores 3.11/3.12/3.13; `find_packages(include=['Pynite','Pynite.*'])`.
  - URL: https://raw.githubusercontent.com/JWock82/PyNite/main/setup.py
- **MATIZADO (1.6.2 `>=3.7`):** NO CONFIRMADO directamente en esta verificación (no se consultó el JSON de 1.6.2). Coherente con la tendencia pero sin fuente primaria comprobada aquí. Riesgo bajo (versión histórica irrelevante para la decisión).

**Veredicto del bloque: VERIFICADO** (el muro `numpy>=2.4.0` desde 2.1.0 hasta 3.0.0 es real y central).

---

## Bloque 2 — Versiones numpy/scipy/Python por release de Pyodide (lockfiles)

**Afirmación del doc (§1.1):**

| Pyodide | doc: Python | doc: numpy | doc: scipy | doc: matplotlib |
|---|---|---|---|---|
| 0.26.4 | ~3.12 | 1.26.4 | 1.12.0 | — |
| 0.27.7 | — | 2.0.2 | 1.14.1 | — |
| 0.28.0 | — | 2.2.5 | 1.14.1 | — |
| 0.29.4 | 3.13.2 | 2.2.5 | 1.14.1 | 3.8.4 |
| 314.0.0 | 3.14.0 | 2.4.3 | 1.17.1 | 3.10.8 (micropip 0.11.1) |

Verificado contra `info.python` y wheels de los lockfiles oficiales:

- **0.26.4 — VERIFICADO/MATIZADO.** Lockfile: `python = 3.12.1`, numpy 1.26.4, scipy 1.12.0. El doc dijo "~3.12" (correcto pero impreciso; el valor exacto es 3.12.1).
  - URL: https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide-lock.json
- **0.27.7 — VERIFICADO.** numpy 2.0.2, scipy 1.14.1. (Python exacto del lockfile: 3.12.7 — el doc no lo afirmaba.)
  - URL: https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide-lock.json
- **0.28.0 — VERIFICADO.** `python = 3.13.2`, numpy 2.2.5, scipy 1.14.1. (El doc en §1.6 dice "Python 3.13" para 0.28.x — correcto.)
  - URL: https://cdn.jsdelivr.net/pyodide/v0.28.0/full/pyodide-lock.json
- **0.29.4 — VERIFICADO.** `python = 3.13.2`, numpy 2.2.5, scipy 1.14.1, matplotlib 3.8.4.
  - URL: https://cdn.jsdelivr.net/pyodide/v0.29.4/full/pyodide-lock.json
- **314.0.0 — VERIFICADO.** `info.python = "3.14.0"` (citado literal), numpy 2.4.3, scipy 1.17.1, matplotlib 3.10.8, micropip 0.11.1.
  - URL: https://cdn.jsdelivr.net/pyodide/v314.0.0/full/pyodide-lock.json

**Nota anti-alucinación:** una búsqueda web resumía Pyodide 314.0 como "Python 3.14.2". El lockfile oficial dice `3.14.0`. **El doc (3.14.0) es CORRECTO**; el resumen de búsqueda era erróneo. Bien descartado.

**Veredicto del bloque: VERIFICADO** (todas las cifras coinciden con los lockfiles; única imprecisión menor: 0.26.4 es 3.12.1, no "~3.12").

---

## Bloque 3 — 314.0.0 es la última (npm latest), calver, Python 3.14 / numpy 2.4.3

**Afirmación del doc (§1.2, §1.3):** `dist-tags.latest = 314.0.0`; calver; ABI 2026 prerelease; v4.1.0 hará estable.

- **VERIFICADO (npm latest).** `registry.npmjs.org/pyodide`: `dist-tags.latest = 314.0.0`.
  - URL: https://registry.npmjs.org/pyodide
- **VERIFICADO (Python 3.14 / numpy 2.4.3).** Por lockfile (Bloque 2).
- **VERIFICADO (calver + ABI 2026 prerelease + v4.1.0).** Confirmado vía búsqueda web del propio contenido del blog/changelog Pyodide: "platform tags ... `pyemscripten_2025_0` para Python 3.13 (0.29.x) y `pyemscripten_2026_0` para Python 3.14 (314.x)"; "El ABI 2026 es por ahora solo para el build prerelease y debe habilitarse vía la opción `pyodide-prerelease`"; "v4.1.0 hará 314.0 estable disponible tras actualizar cibuildwheel".
  - URLs: https://blog.pyodide.org/posts/314-release/ ; https://pyodide.org/en/stable/development/abi.html ; https://github.com/pyodide/pyodide/issues/6233
  - **Matiz:** el blog `blog.pyodide.org/posts/314-release/` devolvió HTTP 403 al fetch directo; el contenido se confirmó vía el resumen de búsqueda de Google sobre esa misma URL y la página ABI oficial. Confianza alta pese al 403.

**Veredicto del bloque: VERIFICADO.**

---

## Bloque 4 — matplotlib en install_requires (NO como extra)

**Afirmación del doc (§2.2, §6.2):** `matplotlib` es dependencia base obligatoria.

- **VERIFICADO.** En `setup.py` `install_requires` lista `'matplotlib'` SIN marcador de extra. En `requires_dist` de PyPI aparece `"matplotlib"` sin `; extra == ...`. Los extras pesados (vtk, pyvista, pdfkit, Jinja2, sympy, jupyterlab) sí llevan marcador `extra ==`.
  - URLs: https://raw.githubusercontent.com/JWock82/PyNite/main/setup.py ; https://pypi.org/pypi/PyNiteFEA/json

**Veredicto: VERIFICADO** (afirmación importante y correcta: `micropip.install("PyNiteFEA")` con `deps=True` arrastra matplotlib).

---

## Bloque 5 — micropip soporta `deps=False` con esa semántica

**Afirmación del doc (§2.1, §2.3):** firma `install(requirements, deps=True, keep_going=False, pre=False, index_urls=None, *, constraints=None, reinstall=False, verbose=None)`; `deps=False` no instala dependencias del METADATA.

- **VERIFICADO (semántica deps=False).** Docstring literal: "If True, install dependencies specified in METADATA file for each package. Otherwise do not install dependencies." `deps=False` salta las dependencias declaradas.
  - URL: https://raw.githubusercontent.com/pyodide/micropip/main/micropip/package_manager.py
- **REFUTADO (firma exacta).** La firma REAL es:
  `install(self, requirements, keep_going=False, deps=True, credentials=None, pre=False, index_urls=None, *, constraints=None, reinstall=False, verbose=None)`.
  - Discrepancias del doc: (1) invierte el orden de `keep_going` y `deps` (real: `keep_going` va antes que `deps`); (2) **omite el parámetro `credentials=None`**. Sin impacto en la recomendación (`deps=False` por keyword funciona igual), pero la firma citada es inexacta.

**Veredicto: MATIZADO** (semántica correcta; firma posicional citada incorrecta — corregir).

---

## Bloque 6 — Firmas de API de PyNite

Verificadas contra `FEModel3D.py`, `Member3D.py`, `Node3D.py`, `Analysis.py` (rama `main`).

- **add_material(name, E, G, nu, rho, fy=None)** — **VERIFICADO.** Real: `add_material(self, name, E, G, nu, rho, fy=None)`.
- **add_section(name, A, Iy, Iz, J)** — **VERIFICADO.**
- **add_node(name, X, Y, Z)** — **VERIFICADO.**
- **add_member(name, i_node, j_node, material_name, section_name, rotation=0.0, tension_only=False, comp_only=False)** — **VERIFICADO.**
- **def_support(...6 booleanos DX..RZ)** — **VERIFICADO.**
- **def_support_spring(node_name, dof, stiffness, direction=None)** — **VERIFICADO.**
- **def_releases — REFUTADO en el cuerpo del doc.** El doc (línea 194) escribe `def_releases(member_name, Dxi, Dyi, Dzi, Rxi, Ryi, Rzi, Rxj, Ryj, Rzj)` → solo **9 flags**, y omite `Dxj, Dyj, Dzj`. La firma REAL tiene **12 flags**: `def_releases(member_name, Dxi, Dyi, Dzi, Rxi, Ryi, Rzi, Dxj, Dyj, Dzj, Rxj, Ryj, Rzj)` (todos bool=False). El resumen ejecutivo del doc dice "(12 flags)" correctamente, pero la firma desarrollada del §5.1 está mal. **CORRECCIÓN NECESARIA.**
  - URL: https://raw.githubusercontent.com/JWock82/PyNite/main/Pynite/FEModel3D.py
- **add_node_load(node_name, direction, P, case='Case 1')** — **VERIFICADO.**
- **add_member_pt_load(member_name, direction, P, x, case='Case 1')** — **VERIFICADO.**
- **add_member_dist_load(member_name, direction, w1, w2, x1=None, x2=None, case='Case 1', self_weight=False)** — **VERIFICADO.** Direcciones validadas: `{'Fx','Fy','Fz','FX','FY','FZ'}`.
- **add_member_self_weight(global_direction, factor, case='Case 1')** — **VERIFICADO.**
- **add_load_combo(name, factors, combo_tags=None)** — **VERIFICADO.** Real: `add_load_combo(self, name, factors, combo_tags=None)`.
- **analyze(log=False, check_stability=True, check_statics=False, max_iter=30, sparse=True, combo_tags=None, spring_tolerance=0, member_tolerance=0, num_steps=1)** — **VERIFICADO** (firma idéntica).
- **analyze_linear(log=False, check_stability=True, check_statics=False, sparse=True, combo_tags=None)** — **VERIFICADO** (doc readthedocs FEModel3D 3.0.0).
- **analyze_PDelta(log=False, check_stability=True, max_iter=30, sparse=True, combo_tags=None)** — **VERIFICADO.**
- **sparse=True por defecto** — **VERIFICADO** (default en analyze/analyze_linear/analyze_PDelta y en Ke/Kg/M).
- **`*_array()` (Member3D)** — **VERIFICADO (parcial).**
  - `shear_array(Direction in {'Fy','Fz'}, n_points, combo_name='Combo 1', x_array=None)` ✓
  - `moment_array(Direction in {'My','Mz'}, n_points, combo_name='Combo 1', x_array=None)` ✓
  - `axial_array(n_points, combo_name='Combo 1', x_array=None)` ✓ (sin Direction)
  - `torque_array(n_points, combo_name='Combo 1', x_array=None)` ✓
  - `deflection_array(Direction, ...)` con `{'dx','dy','dz'}` — **NO CONFIRMABLE** (firma truncada en las dos lecturas del fichero; coherente con la familia, pero no verificado el conjunto exacto de Direction). Riesgo bajo.
  - URL: https://raw.githubusercontent.com/JWock82/PyNite/main/Pynite/Member3D.py
- **Reacciones/desplazamientos nodales (Node3D)** — **VERIFICADO.** `RxnFX/FY/FZ/MX/MY/MZ` y `DX/DY/DZ/RX/RY/RZ` son `Dict[str,float]` indexados por combo.
  - URL: https://raw.githubusercontent.com/JWock82/PyNite/main/Pynite/Node3D.py
- **check_statics / `_check_statics`** — **VERIFICADO.** `def _check_statics(model, combo_tags=None)` existe en `Analysis.py`.
- **Excepción por matriz singular / inestabilidad** — **VERIFICADO.** `Analysis.py`: `_SINGULAR_MSG = "The stiffness matrix is singular, which implies rigid body motion. The structure is unstable. Aborting analysis."` y `_check_stability()` lanza `'Unstable node(s)...'`. (Matiz: el mensaje exacto y el método que lo lanza viven en `Analysis.py`, no en el docstring de `FEModel3D.py` como sugería el §6.6; el comportamiento es el afirmado.)

---

## Bloque 7 — Convención direcciones MAYÚSCULAS=global / minúsculas=local

**Afirmación del doc (§5.2, §6.3):** en cargas de barra, minúsculas (`Fx/Fy/Fz`)=local, MAYÚSCULAS (`FX/FY/FZ`)=global.

- **VERIFICADO (parcial).** `add_member_dist_load` valida exactamente `{'Fx','Fy','Fz','FX','FY','FZ'}`, confirmando que ambas grafías coexisten y que pasar la equivocada no da error de ejecución (riesgo real de esfuerzos erróneos). La semántica local/global de cada grafía es la documentada por PyNite y coherente con el código.
  - URL: https://raw.githubusercontent.com/JWock82/PyNite/main/Pynite/FEModel3D.py
- **Matiz:** la asignación literal "minúscula=local / mayúscula=global" no se citó palabra por palabra de un docstring en esta verificación, pero la coexistencia de ambas grafías (base del error) está verificada y es la convención estándar de PyNite.

**Veredicto: VERIFICADO** (con matiz menor sobre la cita textual de la semántica).

---

## Bloque 8 — Nombre de paquete PyNiteFEA vs módulo Pynite

**Afirmación del doc (§6.4):** instalar `PyNiteFEA`; importar `from Pynite import FEModel3D`; existe otro paquete `Pynite` no relacionado.

- **VERIFICADO.** Doc de instalación oficial: "Be sure to install `PyniteFEA` rather than `Pynite`. The second one is a different package that has nothing to do with finite element analysis." El paquete del repo es `find_packages(include=['Pynite','Pynite.*'])` → módulo a importar `Pynite`.
  - URLs: https://pynite.readthedocs.io/en/latest/installation.html ; https://raw.githubusercontent.com/JWock82/PyNite/main/setup.py
- **MATIZ (capitalización):** la página de instalación renderiza el nombre como `PyniteFEA` (n minúscula), mientras el doc y PyPI usan `PyNiteFEA` (N mayúscula). PyPI normaliza la capitalización, así que ambas grafías instalan el mismo paquete — sin impacto funcional. El módulo de import es `Pynite` (P mayúscula, resto minúscula). El doc lo refleja correctamente.

**Veredicto: VERIFICADO.**

---

## Otros (Comlink, §3)

- **VERIFICADO.** `Comlink.expose()`/`Comlink.wrap()`; todas las llamadas por el proxy son asíncronas (Promises); structured clone por defecto; `Comlink.transfer()` para transferibles; `Comlink.proxy()` para callbacks; `[releaseProxy]()` existe. Todo confirmado en el README oficial.
  - URL: https://raw.githubusercontent.com/GoogleChromeLabs/comlink/main/README.md

---

## CORRECCIONES NECESARIAS

1. **CRÍTICA (API) — `def_releases`, §5.1 (línea 194):** la firma desarrollada lista solo 9 flags y omite `Dxj, Dyj, Dzj`. Corregir a las **12** reales:
   `def_releases(member_name, Dxi, Dyi, Dzi, Rxi, Ryi, Rzi, Dxj, Dyj, Dzj, Rxj, Ryj, Rzj)`. (El discretizador generará releases por extremo; un error aquí desalinea las articulaciones — alto impacto.)
2. **MENOR (API) — firma de `micropip.install`, §2.1:** orden real `(requirements, keep_going=False, deps=True, credentials=None, pre=False, index_urls=None, *, constraints=None, reinstall=False, verbose=None)`. El doc invierte `keep_going`/`deps` y omite `credentials`. La semántica de `deps=False` (la conclusión accionable) es correcta.
3. **MENOR (versión) — Pyodide 0.26.4 Python:** el doc dice "~3.12"; el lockfile da `3.12.1` exacto. Imprecisión sin consecuencia (0.26.4 no se recomienda).
4. **MENOR (ubicación de fuente) — §6.6:** el mensaje de matriz singular y la excepción de inestabilidad viven en `Analysis.py` (`_SINGULAR_MSG`, `_check_stability`), no en el docstring de `FEModel3D.py`. El comportamiento afirmado es correcto.
5. **PENDIENTE (no bloqueante) — `deflection_array`:** las grafías de `Direction` (`dx/dy/dz`) no se pudieron confirmar (lectura truncada). Verificar al montar el worker.
6. **MENOR (capitalización) — nombre de paquete:** la doc oficial escribe `PyniteFEA`; PyPI canónico `PyNiteFEA`. Equivalentes por normalización; mencionar para evitar confusión.

---

## Nivel de confianza global del documento: **ALTO**

Todas las afirmaciones falsables de alto impacto (pin `numpy>=2.4.0` desde 2.1.0 e incl. 3.0.0; cifras numpy/scipy/Python de los cinco lockfiles de Pyodide; 314.0.0 = npm latest con Python 3.14.0 / numpy 2.4.3; matplotlib en `install_requires`; semántica `deps=False`; firmas `analyze`/`analyze_PDelta`/`add_load_combo`/`add_member_dist_load`; reacciones/desplazamientos como dicts por combo; nombre de paquete) están **VERIFICADAS** contra fuente primaria. Los únicos errores son (a) una firma de API mal desarrollada (`def_releases`, corregible y de impacto real en el discretizador) y (b) una firma posicional inexacta de `micropip.install`. Ninguna conclusión estratégica del documento (par de versiones recomendado, trampa de matplotlib, riesgo de la 314) resulta afectada.
