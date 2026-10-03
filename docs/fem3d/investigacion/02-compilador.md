> **Informe original del Área 2 — Compilador y mallado**, generado por un subagente el 2026-10-03.
> El documento consolidado es `../investigacion-id.md`; esto es el detalle con toda la evidencia.
> Los scripts y salidas citados están ahora en `experimentos/02-compilador/`; las rutas absolutas
> del texto apuntan a la carpeta temporal de la sesión que los ejecutó.

# Área 2 — Compilador estructural y mallado (del edificio al modelo analítico)

## Resumen (≤ 10 líneas)
PyNite 3.2.0 condiciona el compilador más de lo que el diseño supone: sólo tiene cuadriláteros (`Tri3D` es código muerto), no tiene restricciones (sin MPC, diafragma, offsets ni brazos rígidos), su giro de perforación es un muelle de 1/1000 que deja casi articulada una barra unida a un muro en su plano (2 056 mm frente a 0,57 mm), y sus `kx_mod/ky_mod` no sirven para un forjado unidireccional (y en `Plate3D` falsean los momentos). Por tanto: nudos conformes obligatorios, barra embebida un elemento en la lámina, y el diafragma, o lo da la propia losa *shell* o sale de barras de penalización (α ≈ 1e3–1e4, con la torsión liberada).
El mallado propuesto: triangulación restringida (CDT, ISC/MPL) a tamaño 2h, sembrada con una retícula y dividida en 3 quads por triángulo. Es conforme, determinista con la entrada ordenada y tan precisa como una rejilla en la DKMQ de PyNite (0,2 %). La rejilla de líneas de control sirve sólo como vía rápida para plantas ortogonales: con desalineaciones de obra de ±5 cm genera franjas de 0,5 mm.
La topología necesita dos tolerancias, no una (1e-6 m y un ε de modelado de ~5 cm). En un plano con un ruido de 2 cm, el 83 % de los encuentros viga-viga no se tocan.
El diseño supone que toda losa es un *shell* isótropo. No vale para el unidireccional ni para la alveolar, que CYPECAD, ETABS, RFEM y Tekla tratan con barras o como paño de reparto. El peso propio debe salir de Cargas por planta, no de ρ·t.
La huella debe calcularse sobre datos cuantizados: V8 y JavaScriptCore difieren en 1–2 ulp en `Math.hypot`, `cbrt`, `sin`…

## Hallazgos

### COM-01 · PyNite 3.2.0 sólo resuelve láminas cuadriláteras planas: el mallador debe entregar 100 % quads
- **Soporte:** A — leído en el código de PyNiteFEA 3.2.0 (pip) y comprobado con un experimento.
- **Prioridad:** P0
- **Afecta a:** §7.3 y §8 (`ShellElement` tri|quad), §23-2 y §23-10 — **contradice**
- **Hallazgo:** El paquete trae `Tri3D.py`, pero es una copia a medio hacer de `Plate3D`: 4 nodos, matriz 24×24, lee `self.n_node`, que no existe. `FEModel3D` no tiene `add_tri` ni diccionario `tris`, y nada importa `Tri3D`. Sólo existen `Plate3D` (rectángulo) y `Quad3D` (cuadrilátero general: flexión DKMQ más tensión plana, con un muelle de perforación). Un quad degenerado, con un nodo repetido para imitar un triángulo, da una `ke` no finita. Además, `Quad3D._local_coords` proyecta los 4 nodos sobre el plano de i-j-m sin comprobar el alabeo: un quad no plano se aplana sin aviso.
- **Evidencia:**
  - `Pynite/Tri3D.py:79-83` (`height()` usa `self.n_node`) y `:255-307` (expande a 24 GDL); `grep Tri3D` sólo lo encuentra en su propio fichero.
  - `Pynite/Quad3D.py:24-28` (docstring DKMQ + membrana + muelle de perforación) y `:107-141` (ejes locales a partir de i→j e i→m).
  - Experimento `py/exp_pynite.py` P4 → `ke_error: "AttributeError: 'Tri3D' object has no attribute 'n_node'"`, `FEModel3D_tiene_add_tri: false`. P8 (`add_quad("Q","a","b","c","c")`) → `ke_finita: false`.
- **Recomendación:** El contrato puede seguir admitiendo triángulos para otro *solver*, pero el mallador del MVP debe producir sólo quads, con convexidad y planitud comprobadas: alabeo < 1e-6·L en planta y en muros planos. `supports()` del adaptador rechaza explícitamente los triángulos.

### COM-02 · Una barra unida a una lámina por un solo nudo y en el plano de la lámina queda casi articulada; embebida un elemento, trabaja
- **Soporte:** A — experimento en PyNite 3.2.0; coincide con la guía de CSI.
- **Prioridad:** P0
- **Afecta a:** §7.2 (pilar–forjado, viga–muro), §23-11 — **añade**
- **Hallazgo:** El GDL de giro alrededor de la normal de la lámina (perforación) es un muelle igual a 1/1000 del menor término rotacional de la diagonal. Caso: viga en voladizo de 2 m (HA 30×50), en el plano de un muro de 3×3×0,25 m, unida a su esquina superior, con P = 20 kN.
  - Flecha en la punta: **2 056 mm** (muro), frente a **0,569 mm** con empotramiento rígido. Es 3 600 veces más.
  - Prolongando la viga dentro del muro un elemento (0,5 m) por nudos del borde: **1,020 mm**. Prolongándola todo el muro: 0,950 mm. Las dos cifras incluyen ya la flexibilidad del muro.
  - Control con la viga perpendicular al muro (flexión fuera del plano, sin perforación): 4,09 mm, un valor razonable.

  Afecta a: vigas que acometen en el plano de un muro o pantalla, dinteles entre pantallas, pilares que nacen sobre un muro (apeos) y torsión de un pilar sobre una losa.
- **Evidencia:**
  - `Pynite/Quad3D.py:565-579` (muelle de perforación = 1/1000).
  - `py/exp_pynite.py` P7 → `muro_directo 2056.16 mm`, `muro_viga_embebida_1elem 1.020 mm`, `rigido 0.569 mm` (teórico P·L³/3EI = 0,569 mm).
  - CSI, «Connecting frames to shells»: *«run the frame element into the shell mesh by at least one shell element length… release the moment at the far end»*.
  - CYPECAD une las pantallas a vigas y forjados *«mediante una viga que tiene como ancho el espesor del tramo y canto constante de 25 cm»* (ccadmc01.pdf, p. 14).
- **Recomendación:** Regla del compilador: toda barra cuyo momento actúe alrededor de la normal de una lámina se prolonga como «barra embebida auxiliar» a lo largo de, al menos, un lado de elemento, con sección de canto ≤ espesor y el momento liberado en el extremo lejano. Va al *mapping* con el rol `auxiliar` (sin comprobación ni diagrama) y con un diagnóstico `info`. Test de regresión: el voladizo de este experimento debe dar ≤ 2× la solución rígida.

### COM-03 · Sin restricciones en PyNite, el diafragma rígido sólo se imita por penalización, y no hace falta si la losa es *shell*
- **Soporte:** A — `grep` de PyNite y experimento con transformación maestro-esclavo exacta en numpy.
- **Prioridad:** P0
- **Afecta a:** §7.1 paso 8, §8 (`constraints`), §20 («diafragmas rígidos… evolución»), §13.1 — **corrige**
- **Hallazgo:** `FEModel3D` no tiene restricciones, diafragma, *offsets* ni brazos rígidos (`grep -i "diaphragm|rigid|constraint|offset|master|slave"` → nada). Sólo ofrece `def_node_disp`, muelles y barras.
  - **Ensayo:** planta de 6×6 m, 4 pilares de 3 m y 4 vigas; 100 kN en X en una esquina.

    | Modelo | u_x esquinas (mm) | N vigas | cond(K11) |
    |---|---|---|---|
    | Maestro-esclavo exacto (numpy sobre la K de PyNite) | 1,7166 / 0,3881 | 0 | 55 |
    | 6 barras de penalización biarticuladas, torsión liberada en un extremo, α = 1e2 | 1,7204 / 0,3847 | — | 2,3e4 |
    | Íd., α = 1e4 | 1,72001 | — | 2,3e6 |
    | Íd., α = 1e8 | — | — | 2,3e10 |
    | Íd., α = 1e10 | PyNite aborta: *«stiffness matrix is singular»* | — | — |
    | Íd., **sin liberar la torsión** | 1,485 (−13,7 % de desplazamiento) | — | — |
    | Sin diafragma | 2,02 / 0,11 | 49 kN en una viga | — |
    | Losa *shell* de 25 cm | 1,55 / 0,31 | 18 kN | — |

  - Penalización: con α = 1e4 los desplazamientos ya no cambian al subir α; el error de equilibrio pasa de 5,5e-12 (α = 1e4) a 4,7e-9 (α = 1e8). Sin liberar la torsión, las barras «rígidas» rigidizan los giros de cabeza de pilar: es un error silencioso.
  - Losa *shell* de 25 cm: hace de diafragma semirrígido. La diferencia con el rígido se debe a la flexión de la losa, que empotra los pilares, no a su membrana.
  - Con diafragma rígido, el axil de las vigas es un artefacto (0). CYPECAD lo dice: vigas con 3 GDL dentro del diafragma, salvo las «exentas» desconectadas (ccadmc01, p. 11-12 y 243).
- **Evidencia:** `py/exp_diafragma.py`; salidas en `py/salida-diafragma.json` y `py/salida-diafragma-torsion-liberada.json`.
- **Recomendación:**
  1. No implementar *constraints* en el MVP. Las plantas con losa *shell* no llevan diafragma (sale de la membrana).
  2. Las plantas sin *shell* (unidireccional, ver COM-19) llevan un diafragma de 6 barras por cada 4 nudos maestros o una triangulación de la planta, con α = 1e3–1e4 relativo a EA de las vigas, la torsión liberada en un extremo, el rol `auxiliar` y el aviso «axil de vigas no representativo» en el `ResultModel`.
  3. Registrar la «bajada» (constraint → penalización) en los metadatos del adaptador.

### COM-04 · `kx_mod/ky_mod` no modelan un forjado unidireccional en PyNite, y en `Plate3D` dan momentos erróneos
- **Soporte:** A — código y experimento.
- **Prioridad:** P0
- **Afecta a:** §6 (`Slab`), §7.3, §23-2 — **contradice** (no hay placa ortótropa en flexión)
- **Hallazgo:**
  - En `Quad3D`, los modificadores sólo entran en la matriz de membrana (`Cm`); la flexión (`Hb`) es isótropa. En una losa de 6 m a 10 kPa: kx_mod = 1 y kx_mod = 0,1 dan la misma flecha (4,395 mm) y el mismo Mx (44,03 kN·m/m).
  - En `Plate3D`, `ke_b` usa `Ex = self.E` (ignora el modificador), pero `moment()` usa `Db()`, que sí lo aplica. Con kx_mod = 0,1 la flecha no cambia (4,392 mm) y Mx sale **4,42 kN·m/m** en lugar de 44,2 (teórico qL²/8 = 45). El equilibrio se rompe sin aviso.
  - De paso: `Quad3D.moment(local=False)` lanza `TypeError` con NumPy 2.5 (`float()` sobre un array de 1 elemento) y el signo de Mx difiere entre `Quad` (+44,0) y `Rect` (−44,2). Esto es para el Área 3.
- **Evidencia:**
  - `Pynite/Quad3D.py:467-481` (`Hb` isótropa) y `:498-521` (`Cm` con modificadores).
  - `Pynite/Plate3D.py:237-238` (`Ex = self.E` en `ke_b`) frente a `:124-125` y `:609` (`Db` con kx_mod en `moment`).
  - `Pynite/Quad3D.py:1159`.
  - `py/exp_pynite2.py` → `py/salida-pynite2-p5b.json`.
- **Recomendación:** No usar `kx_mod/ky_mod` (prohibirlo en el adaptador: siempre 1,0). Reportar el fallo de `Plate3D` aguas arriba. Si algún día hace falta una placa ortótropa, será un parche propio de `Hb` en `Quad3D`, versionado, con su benchmark. Para el MVP, la ortotropía se resuelve en el compilador (COM-19).

### COM-05 · Con desalineaciones reales de 2 cm, el 83 % de los encuentros viga-viga no se tocan: hacen falta dos tolerancias
- **Soporte:** A — experimento con predicados exactos.
- **Prioridad:** P0
- **Afecta a:** §5.3 (tolerancia única de 1e-6 m), §7.2 («no se usarán uniones por proximidad opacas») — **corrige**
- **Hallazgo:**
  - Retícula de 10×8 vanos (178 vigas). Con coordenadas exactas, los 478 encuentros se tocan. Con ±2 cm de ruido (lo normal en un plano dibujado o en un DXF), sólo 80 se cruzan, 0 se tocan y **398 quedan a ≤ 5 cm sin tocarse**.
  - Los predicados exactos no expresan la intención. De 999 puntos calculados como `a + t·(b−a)` sobre una viga oblicua, `orient2d` exacto dice que ninguno está sobre la recta; el producto vectorial ingenuo dice que 645 sí. La distancia real es ≤ 1,3e-15 m.
  - Coste de detectar cruces y casi-cruces: fuerza bruta 2,5–3,5 ms con 178 vigas y 44–63 ms con 2 470 vigas (3 M pares); un *hash* de rejilla da 0,6–1,1 ms y 3–12 ms, con el mismo resultado. No hace falta un R-tree.
- **Evidencia:**
  - `js/run-topologia.mjs` → `js/salida-topologia.json`.
  - robust-predicates 3.0.3 (Unlicense).
- **Recomendación:** Dos tolerancias registradas en `AnalysisSettings`:
  - **ε_geom = 1e-6 m:** fusión numérica silenciosa (diagnóstico `info`).
  - **ε_snap ≈ 0,05 m, configurable:** fusión con diagnóstico `warning`, que guarda el desplazamiento y la excentricidad (pilar a 3 cm del eje de la viga, por ejemplo).

  Entre ε_snap y unas 3·ε_snap, diagnóstico de «casi encuentro» sin unir. El orden es: *snapping* primero, luego predicados exactos sobre las coordenadas ya fusionadas. Basta un *hash* de rejilla con la caja ampliada en ε_snap.

### COM-06 · PyNite trocea cada barra en cualquier nudo a ≤ 1e-12·(1+L) de su eje, y su `merge_duplicate_nodes` pierde cargas: la fusión debe hacerla el compilador
- **Soporte:** A — código y experimento.
- **Prioridad:** P0
- **Afecta a:** §7.2, §8.1 (*mapping*), §9.1 — **añade**
- **Hallazgo:**
  - `add_member` crea siempre un `PhysMember`, que al analizar busca **todos** los nudos del modelo a ≤ 1e-12·(1+L) del eje y se subdivide en ellos (las sub-barras se llaman `nombre+chr(97+i)`).
    - Un nudo exactamente sobre el eje: 2 sub-barras y conexión.
    - Desviado 1e-9 m o 1e-6 m: no conecta, y el análisis aborta con *«stiffness matrix is singular»*, sin decir dónde. Esto queda dentro de la tolerancia de 1e-6 m del §5.3.
  - `merge_duplicate_nodes(1e-3)` es O(n²), depende del orden del diccionario y reasigna apoyos, pero **no las cargas nodales**. En el ensayo, una carga de 50 kN en el nudo fundido desaparece: ΣRx = 0.
  - `_check_stability` (activo por defecto) es O(GDL·nudos): con 625 nudos cuesta 26 % del tiempo (2,02 s frente a 1,49 s).
- **Evidencia:**
  - `Pynite/FEModel3D.py:475` (`PhysMember` en `add_member`) y `:953-1058` (*merge*).
  - `Pynite/PhysMember.py:64-66, 112` (tolerancia) y `:122` (nombres).
  - `Pynite/Analysis.py:1560` y `:111-123`.
  - `py/exp_pynite.py` P2 y P3.
  - `py/exp_placa_mallas.py` (tiempos con y sin `check_stability`).
- **Recomendación:**
  1. El compilador une y trocea todo, y emite coordenadas idénticas bit a bit para nudos compartidos. Nunca llamar a `merge_duplicate_nodes`.
  2. Un `FrameElement` corresponde a un miembro de PyNite. El adaptador comprueba tras analizar que `len(sub_members) == 1`; si no, error «unión no prevista» con los IDs físicos.
  3. Desactivar `check_stability` y hacer antes en TS la comprobación de conectividad y de nudos huérfanos (con mensajes físicos, §16).

### COM-07 · CDT a tamaño 2h más división tri→3 quads da una malla de quads conforme tan precisa como una rejilla; la rejilla de líneas de control sólo sirve para plantas alineadas
- **Soporte:** A — experimentos en JS y PyNite.
- **Prioridad:** P0
- **Afecta a:** §7.3, §23-10 — **añade y corrige**
- **Hallazgo:**
  - **Rejilla de líneas de control (estilo `RectangleMesh` de PyNite):** en la losa de prueba de 12×9 m con hueco, a h = 0,5 da 443 quads y 497 nodos, perfectos. Es frágil en plantas reales: pilares desalineados ±5 cm en 20×15 m dan franjas de 0,5 mm (relación de aspecto 941; 493 quads con relación > 10). Fundir líneas a ε = 5 cm baja la relación a 9,5 (moviendo hasta 4,7 cm); a 10 cm, a 1,1 (moviendo 9,8 cm). Con ±30 cm la relación sigue en 4,7. Además, no puede embeber vigas oblicuas.
  - **CDT con retícula triangular a 2h = 1,0 m y división en 3 quads (puntos medios y centroide):** 702 quads y 754 nodos, ángulo mínimo 32,8°, máximo 151°, jacobiano escalado mínimo 0,485; preserva bordes, hueco, viga y pilares.
  - **Precisión en PyNite (placa de 6×6 m simplemente apoyada, Navier):**

    | Malla | Nodos | w | M |
    |---|---|---|---|
    | tri→quad | 979 | +1,74 % | +1,15 % |
    | Rejilla h = 0,25 | 625 | +1,97 % | +1,36 % |

    Entre ellas difieren un 0,2 %. El sesgo de +2 % es la deformación por cortante de la DKMQ (Mindlin) frente a la referencia de Kirchhoff.
- **Evidencia:**
  - `js/run-mallado.mjs` y `js/geom.mjs` → `js/salida-mallado-resumen.txt`.
  - `js/run-triquad-2h.mjs` → `js/salida-triquad-2h.json`.
  - `js/run-rejilla-planta.mjs` → `js/salida-rejilla-planta.json`.
  - `js/gen-placa.mjs` y `py/exp_placa_mallas.py` → `py/salida-placa-mallas.json`.
- **Recomendación:** Mallador del MVP en TS, dentro del Worker, antes de cargar Pyodide.
  1. Sembrar una vez cada arista compartida (borde de losa, línea muro-losa, ejes de viga, aristas verticales muro-muro, contornos de zona de carga) con el mismo paso, para que mallas generadas por separado coincidan nodo a nodo.
  2. CDT sobre ese grafo, con retícula triangular de Steiner a 2h, separada ≥ 0,45·(2h) de las restricciones.
  3. División en 3 quads.
  4. Validar después de mallar (COM-10).

  Vía rápida opcional: rejilla para regiones rectangulares alineadas, con las mismas costuras. Muros: rejilla por paño con los niveles de planta y de hueco unificados en las aristas compartidas.

### COM-08 · Hay CDT permisivas que preservan líneas y puntos en 1–4 ms, pero ninguna refina (sin Ruppert) y poly2tri pierde líneas embebidas
- **Soporte:** A — experimento, Node 24.19.
- **Prioridad:** P1
- **Afecta a:** §7.3 («mallador determinista y con métricas») — **añade**
- **Hallazgo:** Losa de 12×9 m, hueco de 2×2,5 m, viga embebida y 4 pilares; 122 puntos de PSLG, 120 segmentos y 385 de Steiner.

  | Biblioteca | Mediana (ms) | Notas |
  |---|---|---|
  | `@kninnug/constrainautor` 4.1.0 sobre `delaunator` 5.1.0 | 1,1–1,7 | — |
  | `cdt-js` 0.1.7 (WASM de artem-ogre/CDT) | 3–4 | — |
  | `poly2tri` 1.5.0 | 1–4 | — |
  | `cdt2d` 1.0.0 | 40–95 | 20–50 veces más lenta; README «WORK IN PROGRESS» |
  | `earcut` 3.2.4 | — | 8 triángulos de hasta 4,6°: inservible para FEM |

  - Las que admiten aristas restringidas dan la misma malla: 912 triángulos, ángulo mínimo 30,95°, 120/120 segmentos y 4/4 pilares preservados.
  - `poly2tri` sólo admite contorno, huecos y puntos de Steiner; con una viga oblicua perdió 1 de 23 subsegmentos.
  - Sin refinado, la calidad depende de la siembra. Un pilar a 3 cm del eje de la viga deja triángulos de 3,4° (relación de aspecto 9,9; tras dividir en quads, jacobiano 0,06), y con una viga oblicua el mínimo baja a 12,2°.
- **Evidencia:** `js/salida-mallado-resumen.txt` (variantes A, B, C).
- **Recomendación:** Delaunator + Constrainautor (ISC, JS puro, el más rápido) como núcleo. Los pequeños rasgos geométricos se resuelven con ε_snap (COM-05) y con una siembra graduada alrededor; no hace falta implementar Ruppert en el MVP. Si se quiere, Chew/Ruppert puede venir después sobre `cdt-js`. Descartar `cdt2d`, `poly2tri` y `earcut`.

### COM-09 · Triangle no es distribuible en un producto comercial, Gmsh y la malla 2D de CGAL son GPL, y dos paquetes npm se etiquetan «MIT» envolviendo código que no lo es
- **Soporte:** A — licencias leídas en el código fuente de cada versión.
- **Prioridad:** P1
- **Afecta a:** §9.1 («licencia y avisos de dependencias»), §7.3 — **añade**
- **Hallazgo:**
  - **Triangle 1.6, README:** se redistribuye si *«no compensation is received»*, y *«Distribution of this code as part of a commercial system is permissible ONLY BY DIRECT ARRANGEMENT WITH THE AUTHOR»*. `triangle-wasm@1.0.0` lo empaqueta y declara `"license": "MIT"`.
  - **`cdt-js@0.1.7`:** declara MIT, pero su `.gitmodules` apunta a `artem-ogre/CDT`, que es **MPL-2.0**. Es *copyleft* por fichero: compatible con PolyForm y con un uso comercial, conservando el aviso y publicando esos ficheros.
  - **Gmsh:** GPL v2+ con excepciones (gmsh.info/LICENSE.txt).
  - **CGAL:** los algoritmos de alto nivel (incluida la malla 2D) son GPL o licencia comercial de GeometryFactory.
  - **Licencias permisivas:** delaunator e earcut (ISC), constrainautor (ISC), cdt2d (MIT), poly2tri (BSD-3), robust-predicates (Unlicense), clipper2-js 1.2.4 (Boost) y PyNiteFEA 3.2.0 (MIT).
- **Evidencia:**
  - `fuentes/triangle.zip:README` (netlib).
  - `js/node_modules/triangle-wasm/package.json`.
  - `https://raw.githubusercontent.com/matthewjacobson/CDT.js/main/.gitmodules`.
  - `https://raw.githubusercontent.com/artem-ogre/CDT/master/LICENSE`.
  - `https://gmsh.info/LICENSE.txt` y `https://www.cgal.org/license.html`.
- **Recomendación:** Lista blanca de licencias del compilador: MIT, ISC, BSD, Boost, Unlicense y MPL-2.0, esta última con aviso. Excluir Triangle (y `triangle-wasm`, `meshpy`, `triangle` de pip), Gmsh y CGAL-Mesh_2: la GPL obligaría a licenciar Concreta como GPL al distribuirla en el navegador. Añadir los avisos a `public/` como en el precedente de PySlope.

### COM-10 · Puntos duplicados exactos producen mallas basura sin error en las CDT: hay que deduplicar antes y validar después
- **Soporte:** A — experimento (variante D: retícula cuadrada que coincide con 3 pilares).
- **Prioridad:** P1
- **Afecta a:** §7.3 («malla inválida será un error»), §16 — **añade**
- **Hallazgo:** Con duplicados exactos en la entrada:
  - `cdt2d` con `exterior:false` devuelve 16 triángulos y un **área de 5 m² de 103**.
  - `cdt2d` con clasificación propia: área 98,35 y triángulos de 0,27°.
  - `cdt-js` lanza una excepción WASM numérica sin mensaje (`132120`).
  - `poly2tri` produce 6 triángulos degenerados (ángulos NaN).
  - Delaunator ignora el duplicado, pero el índice que el compilador guarda para el pilar puede quedar huérfano (en el ensayo, «pilares como vértice: 3/4»): el pilar no se uniría a la losa.

  En PyNite, un nudo huérfano sale como *«Nodal instability… node N24»*, sin referencia física.
- **Evidencia:** `js/salida-mallado-resumen.txt` (variante D).
- **Recomendación:**
  - **Antes de mallar:** fusión con ε_geom y ε_snap (COM-05), con `Map` de clave cuantizada.
  - **Después de mallar:** validador obligatorio y barato que compruebe:
    1. Σ áreas = área del polígono menos huecos, a 1e-9 relativo.
    2. Ninguna orientación invertida (COM-11).
    3. Cada subsegmento restringido es arista de la malla.
    4. Cada punto obligatorio es un vértice usado.
    5. No hay nodos huérfanos.
    6. Métricas: ángulos, jacobiano escalado y alabeo.

  Si falla, error con el `PhysicalRef` de la losa o el muro.

### COM-11 · La malla depende del orden de entrada cuando hay puntos cocirculares, y Delaunator devuelve triángulos horarios: hay que ordenar la entrada y normalizar la orientación
- **Soporte:** A — experimento.
- **Prioridad:** P1
- **Afecta a:** §5.2 (normal coherente), §7.3 (determinismo), §21 («compilación determinista») — **añade**
- **Hallazgo:**
  - Con Steiner en retícula cuadrada (cuadrículas cocirculares, frecuentes en planta), barajar la entrada **cambia la geometría** de la malla en cdt2d, cdt-js y constrainautor, y cada biblioteca da una malla distinta (4 huellas diferentes). Con la retícula triangular (sin cocircularidad) todas coinciden y son invariantes al orden.
  - Todas son deterministas para la misma entrada en el mismo orden.
  - Delaunator documenta *«All triangles are directed counterclockwise»*, pero el área con signo en ejes y-arriba es **negativa**: el sentido antihorario es el de coordenadas de pantalla.
  - En PyNite, el signo de la presión sigue al orden de nodos: el mismo quad con orden antihorario da DY = −0,083 mm y con orden horario, +0,083 mm.
- **Evidencia:**
  - `js/salida-mallado-resumen.txt` (variante S).
  - `js/node_modules/delaunator/README.md:67`.
  - `py/exp_pynite.py` P6.
- **Recomendación:**
  1. Ordenar canónicamente las entradas del mallador: lexicográfico por coordenada cuantizada, y luego por ID físico.
  2. Usar siembra triangular (no cuadrada).
  3. Fijar la versión exacta de la biblioteca en la huella del compilador.
  4. Normalizar cada elemento a normal +Z en losas y a normal «exterior» documentada en muros.
  5. Test: la losa de prueba barajada 3 veces debe dar la misma huella geométrica.

### COM-12 · V8 y JavaScriptCore difieren en 1–2 ulp en `Math.hypot/cbrt/sin/exp…`: la huella debe hacerse sobre datos cuantizados
- **Soporte:** A — experimento con Node 24.19 (V8) y Bun 1.3.14 (JSC), 200 000 muestras.
- **Prioridad:** P1
- **Afecta a:** §7.1 paso 12, §17 (reutilizar resultados por huella), §5.1 — **añade**
- **Hallazgo:**
  - Bits distintos en: `hypot` 35,7 % (hasta 2 ulp), `cbrt` 27,2 %, `exp` 9,3 %, `atan2` 7,3 %, `log` 4,9 %, `sin` 2,5 % y `cos` 2,35 %. `sqrt` y `pow` coinciden.
  - ECMA-262 declara estas funciones «implementation-approximated». Una huella sobre dobles derivados cambiaría entre Chrome y Safari y desharía la caché o la trazabilidad.
  - `rcElasticModulusMPa` (`src/lib/frame-core/sections.ts:72`) usa `Math.cbrt`.
  - El `inputsFingerprint` del repo (`src/lib/pdf/utils.ts:791`) es FNV-1a de 32 bits: hay un 1 % de colisión hacia unas 9 300 huellas, corto como clave de caché de resultados.
- **Evidencia:** `js/trig-huella.mjs` y `js/trig-dump.mjs` → `js/salida-trig-v8-vs-jsc.json`.
- **Recomendación:**
  - Calcular la huella sobre el modelo físico canónico, las opciones y las versiones, o sobre el analítico con coordenadas cuantizadas, por ejemplo `Math.round(x/1e-9)`.
  - En la topología usar `Math.sqrt(dx*dx+dy*dy)` y no `Math.hypot`; evitar trigonometría para situar nudos (con vectores y productos basta).
  - Usar SHA-256 (`crypto.subtle`, disponible en el Worker), reutilizando `canonicalStringify`.

### COM-13 · PyNite integra exactamente las cargas de barra: trocear por cargas puntuales o parciales no mejora nada
- **Soporte:** A — código y experimento.
- **Prioridad:** P1
- **Afecta a:** §7.2 («cargas puntuales fuerzan subdivisiones»), §13.1 — **corrige**
- **Hallazgo:** `FER_LinLoad` da en forma cerrada las reacciones de empotramiento de una carga trapecial parcial (x1–x2), y el miembro calcula los diagramas por tramos polinómicos. Caso: viga de 6 m con carga uniforme, trapecial parcial 1,0–4,5 m y puntual a 2,2 m.
  - Con 1 elemento y con 10 elementos, la flecha y el momento en 3 m coinciden a **1,3e-14** y **1,5e-14** relativos: 3,60149 mm y 91,2946 kN·m.
  - Referencia por integración numérica: 91,2947.

  El troceado sólo es necesario por topología (cruces, apoyos, cambios de sección, nudos de losa) y por la conformidad con la losa.
- **Evidencia:**
  - `Pynite/FixedEndReactions.py:97-135`.
  - `Pynite/PhysMember.py:146-199` (reparto de cargas entre sub-barras).
  - `py/exp_pynite.py` P1.
- **Recomendación:** Las cargas puntuales y parciales viajan como `FrameLoad` con su posición (x1, x2), no como nudos. Las estaciones de resultado de §13.1 salen de la carga, no de la malla. Quitar la carga puntual de la lista de causas de troceado del §7.2.

### COM-14 · En `Quad3D`, presión de elemento y fuerzas nodales equivalentes dan resultados idénticos: el compilador puede bajar cualquier carga superficial o lineal sobre lámina a nodos
- **Soporte:** A — código y experimento.
- **Prioridad:** P1
- **Afecta a:** §7.1 paso 9, §8 (`ShellLoad`), §6.1 («cargas sin destino») — **añade**
- **Hallazgo:**
  - PyNite sólo admite presión **uniforme por elemento** y normal (`add_quad_surface_pressure`).
  - No tiene peso propio de láminas: `add_member_self_weight`, *«Plate, quad, and spring elements will be ignored»*.
  - No tiene cargas lineales sobre láminas.
  - `Quad3D.moment()` recupera los esfuerzos sólo desde `d`, sin FER. Por eso aplicar p·A/4 en cada nodo da los mismos Mx = 44,035, Qx = −2,416, w = 4,3953 mm y R = 180 kN que la presión.
- **Evidencia:**
  - `Pynite/FEModel3D.py:1434`.
  - `Pynite/Quad3D.py:721-788` (FER) y `:1095-1140` (momentos a partir de `d`).
  - `py/exp_presion_vs_nodal.py` → `py/salida-presion-vs-nodal.json`.
- **Recomendación:** `ShellLoad` en el modelo analítico con dos formas:
  - presión constante por elemento, para zonas uniformes con el contorno embebido en la malla;
  - fuerzas nodales consistentes, para el empuje de tierras trapecial de los muros de sótano (`muros` de Cargas por planta), las cargas lineales de tabiquería sobre losa (línea embebida) y las puntuales (punto embebido).

  Cada fuerza nodal conserva el `loadId` físico para el control «sin pérdidas» del §21: Σ fuerzas analíticas = Σ físicas, por caso, a 1e-9.

### COM-15 · Un pilar como punto de la malla da un momento de losa que diverge al refinar; con su sección converge en la cara
- **Soporte:** A — experimento en PyNite.
- **Prioridad:** P1
- **Afecta a:** §7.2 («un pilar que llega a un forjado debe conectar con la malla»), §13.2 — **añade**
- **Hallazgo:** Losa de 6×6 m y 25 cm, apoyada en el contorno y en un pilar central de 40×40, con q = 10 kPa.

  | h (m) | Mx en el nudo, pilar como punto (kN·m/m) | Mx en la cara, huella del pilar apoyada (kN·m/m) |
  |---|---|---|
  | 1 | −22,7 | −11,9 |
  | 0,5 | −34,1 | −14,1 |
  | 0,25 | −45,5 | −14,8 |
  | 0,125 | −55,4 | −16,2 |

  Como punto, el momento crece unos 11 kN·m/m por cada división del tamaño: es logarítmico. Con la huella apoyada, el valor en la cara se estabiliza.

  CYPECAD lo trata con *«nudos de dimensión finita»*: barras infinitamente rígidas del eje del pilar a sus caras (ccadmc01, p. 15).

  Tiempos de PyNite en CPython, con `check_stability`: 0,6 s con 49 nudos y 10,6 s con 2 401 nudos (14 000 GDL).
- **Evidencia:** `py/exp_pilar_losa.py` → `py/salida-pilar-losa.log`.
- **Recomendación:**
  - Embeber la huella del pilar en la malla de la losa, como contorno restringido.
  - Unir su nudo de cabeza a los nudos de la huella con barras rígidas de penalización (α ≈ 1e3, rol `auxiliar`), o bien, en la primera iteración, sólo al nudo central, con diagnóstico «momento en eje no utilizable».
  - Exponer al dimensionado el valor en la cara y nunca el del nudo, que es singular. Lo mismo en el encuentro muro-losa en esquinas.

### COM-16 · El peso propio de la losa no puede salir de ρ·t: Cargas por planta ya publica `pp`, y en vigas planas el peso se cuenta dos veces entero
- **Soporte:** A — código del repo y cálculo propio.
- **Prioridad:** P1
- **Afecta a:** §6 (`Slab.thickness` + material), §7.1 paso 9, §11 (`selfWeightFactor`) — **corrige**
- **Hallazgo:**
  - `PubZonaCargas` publica por zona `pp`, `resto` y `G` (kN/m², `src/features/cargas-planta/state.ts:761-792`). El `pp` sale de la tabla C.5 del CTE: unidireccional de 3 o 4 kN/m², reticular de 4 o 5 kN/m² (`src/lib/acciones/tablasCargas.ts:101-115`); en losa maciza es ρ·h.
  - Un reticular 30+5 equivalente en rigidez es una placa de **233 mm** (I de la T bruta por intereje = 0,295 de la maciza). Su ρ·t daría 5,8 kN/m²; la T sola da 2,35 kN/m²; la norma pide 4–5 kN/m² (incluye ábacos y bovedillas).
  - Vigas planas (canto = forjado, muy habituales en España): el peso b·h de la barra se solapa al 100 % con el `pp` de la losa. En una descolgada de 30×50 bajo losa de 25 cm, se solapa al 50 % (1,875 de 3,75 kN/m).
- **Evidencia:**
  - `py/espesor_equivalente.py` → `py/salida-espesor-equivalente.txt` (25+5: 201 mm; 30+5: 233; 35+5: 265; 40+5: 296; 35+10: 303).
  - `src/lib/acciones/cargas.ts:278-296` (`pesoPropioForjado`).
- **Recomendación:**
  - Separar en el modelo analítico el **espesor de rigidez** (`stiffnessThickness`) de la **carga de peso propio** (`selfWeightPressure`, kN/m² → N/m²), tomada del `pp` de la zona o de la tipología.
  - El peso de las vigas se calcula sólo con su descuelgue, b·(h − t_losa) si h > t_losa, o la losa se descuenta bajo la viga. Se elige una regla y se documenta como hipótesis visible.
  - El compilador emite el peso propio como carga explícita del caso G, nunca a partir de ρ en el *solver*, para que el control «sin pérdidas» lo cuadre.

### COM-17 · El edificio de Concreta guarda alturas relativas y cotas derivadas, y las cargas por planta no tienen geometría: el `PhysicalModel` del §6 duplica y contradice ambas
- **Soporte:** A — leído en el repo.
- **Prioridad:** P1
- **Afecta a:** §6 (`Storey.elevation/levelOrder`, `Beam.axis: Vec3[]`, `Slab.elevation`), §6.1 — **contradice**
- **Hallazgo:**
  - `lib/edificio` guarda las plantas **de arriba abajo**, con `altura` de forjado a forjado, que puede ser `null`. Las cotas se **derivan** con `cotasEdificio()`, con ±0,00 en la planta sobre rasante más baja y `null` si falta una altura, y `alturasQueFaltan()` dice cuáles faltan. Sólo Cargas por planta escribe ahí.
  - El §6 pide `Storey.elevation` absoluta y, además, z en los `Vec3` de vigas y pilares y `Slab.elevation`. Son tres copias del mismo dato, que se desincronizan al cambiar una altura.
  - Las zonas de Cargas por planta (`ZonaUI`) no tienen polígono y las `lineales` no tienen posición: el compilador no puede asignarlas sin geometría nueva.
  - Los IDs de planta (`p${Date.now().toString(36)}…`) son opacos y estables: se pueden reutilizar.
- **Evidencia:**
  - `src/lib/edificio/index.ts:15-21, 30-41, 145-167`.
  - `src/features/cargas-planta/state.ts:129-147 (ZonaUI), 247-257 (LinealUI), 761-826 (publicación)`.
- **Recomendación:**
  - En el modelo físico, coordenadas **en planta** más `storeyId` (y desfase opcional); las z se obtienen al compilar con `cotasEdificio()`. Si una cota es `null`, error `MISSING_STOREY_HEIGHT` con el nombre de la planta.
  - `Slab` lleva `zonaId` (zona de Cargas por planta) y `tipoForjado`.
  - Las cargas lineales necesitan polilínea en el modelo 3D; las de Cargas por planta sin posición se ofrecen como plantilla, no como carga.

### COM-18 · El patrón `decompose` de fem2d sirve en 3D, pero hay que añadir intersecciones, estaciones explícitas y secciones 3D
- **Soporte:** A — leído en el repo.
- **Prioridad:** P1
- **Afecta a:** §8 (`FrameElement`), §8.1, §22-1 — **confirma y añade**
- **Hallazgo:** `decompose2D` ya hace bien:
  - IDs derivados `${m.id}_e${k}` y `${m.id}_s${k}`;
  - troceado por fracción t con `T_EPS = 1e-6`;
  - liberaciones al primer y último sub-elemento (igual que `PhysMember`);
  - giro global→local de las cargas en el compilador;
  - formulación derivada, sin campo de tipo;
  - `designMemberId` como referencia de vuelta.

  Le falta para 3D:
  - No detecta cruces: los nudos se comparten por ID, con *snap* de 0,1 m y `ALIGN_TOL` de 1 mm.
  - Los resultados se reagrupan por «orden de `decompose`» (`checks.ts:391-397`), sin rango de estación.
  - `LoadCase` es el enumerado G/Q/W/S/E.
  - `frame-core/sections` sólo da `EA` y `EI` en kN y kN·m², mientras `RcSection` está en cm/mm: faltan A, Iy, Iz y J. El catálogo de acero sí tiene `It`; el HA no tiene J ni reducción a torsión.
  - Un nudo compartido por varios objetos físicos no puede tomar el ID de uno solo.
- **Evidencia:**
  - `src/features/fem2d/decompose.ts:46-207`.
  - `src/features/fem2d/analysis.ts:15-27`.
  - `src/features/fem2d/modelOps.ts:124-170`.
  - `src/features/fem2d/alignments.ts:18`.
  - `src/lib/frame-core/sections.ts:62-104`.
  - `src/lib/frame-core/types.ts:14`.
- **Recomendación:**
  - Copiar el patrón: IDs derivados y no contadores, giro de cargas en el compilador, liberaciones en los extremos.
  - Añadir `physicalStationRange`, ya previsto en el §8.
  - IDs de nudo por clave geométrica cuantizada y ordenada.
  - Una función `seccion3D()` que amplíe `frame-core/sections` a SI (A, Iy, Iz, J), sin duplicar catálogos.
  - Conversión kN→N en un único punto del compilador.
  - Reutilizar `solveAnalysisModel` del FEM 1D para las franjas de viguetas (COM-19).

### COM-19 · Los forjados mayoritarios en España no son losas isótropas: CYPECAD, ETABS, RFEM y Tekla los tratan con barras o como paño de reparto, y el MVP debería hacer lo mismo
- **Soporte:** B — documentación oficial de los cuatro programas, todas en el mismo sentido.
- **Prioridad:** P0
- **Afecta a:** §2.1, §6 (`Slab`), §7.3, §13.2 — **contradice** («todas las losas son *shells*»)
- **Hallazgo:**
  - **CYPECAD (memoria de cálculo):**
    - Viguetas: *«barras que se definen en los paños… y que crean nudos en las intersecciones»*, con sección en T bruta.
    - Placas aligeradas y losas mixtas: *«unidireccionales discretizados por barras cada 40 cm»*.
    - Losa maciza: emparrillado de barras ≤ 25 cm.
    - Reticular: emparrillado a intereje/3, con inercia a flexión igual a la mitad de la de la zona maciza (en las dos zonas) y torsión el doble de la de flexión.
    - Todo con diafragma rígido por planta; muros con triángulos de 6 nodos.

    (ccadmc01, p. 11-14 y 124.)
  - **ETABS:** *deck* o losa «membrane» con «Use Special One-Way Load Distribution»: reparto por anchos tributarios, sin flexión.
  - **RFEM 6:** tipo de superficie «Load Transfer», *«no thickness and no structural effect»*, con reparto isótropo por EF o por franjas ortótropas.
  - **Tekla Structural Designer:** descomposición de cargas en 1 o 2 direcciones; las losas 1-way analizadas se vuelven ortótropas con un factor Y = 0,01.
  - **En Concreta:** `TipoForjado` ya distingue `losa | solera | reticular | unidireccional | chapa | madera | otro`. El módulo Forjados sólo comprueba reticular (nervio en T por intereje: 25+5 a 35+10, intereje 820) y maciza, con Md y VEd tecleados.
  - **Rigidez del reticular:** la T bruta da I = 0,29–0,31 de la maciza (COM-16). CYPECAD usa 0,5. No hay un valor único.
- **Evidencia:**
  - `fuentes/ccadmc01.pdf` (CYPE, 2016–2019).
  - support.tekla.com/doc/tekla-structural-designer/2026/mod_overviewofslabmodel.
  - dlubal.com, manual de RFEM 6, 000040.
  - eng-tips y Scribd sobre la «membrane» de ETABS (secundarias, coincidentes).
  - `src/lib/acciones/cargas.ts:42`.
  - `src/data/forjadoTipologias.ts:18-24`.
  - `src/lib/calculations/rcSlabs.ts:452`.
- **Recomendación:** En el MVP, según `tipoForjado`:
  - **Maciza:** *shell* `Quad3D` con t real.
  - **Reticular:** *shell* con t equivalente de rigidez, elegido y documentado (T bruta o ½ maciza, configurable), los ábacos como regiones de t real y el peso propio de la zona. El Mx·intereje de la *shell* alimenta `calcForjados` por nervio.
  - **Unidireccional, alveolar, chapa y madera:** «paño de reparto», sin rigidez, con la dirección de viguetas como dato. Las cargas pasan a las vigas y muros de apoyo mediante franjas continuas resueltas con el `solveAnalysisModel` del FEM 1D: el reparto isostático infravalora la viga central de dos vanos un 25 % (1,25·qL frente a 1,0·qL). El diafragma, según COM-03.
  - Más adelante: viguetas como barras, como hace CYPECAD.

### COM-20 · El modelo analítico necesita modificadores de rigidez trazables: CYPECAD multiplica el axil de los pilares por 2 y reduce la torsión del HA
- **Soporte:** B — memoria de cálculo de CYPECAD (fuente primaria del fabricante).
- **Prioridad:** P1
- **Afecta a:** §8 (`AnalyticalSection`), §18.1 nivel 4 (comparación con CYPE) — **añade**
- **Hallazgo:**
  - CYPECAD considera *«el acortamiento por esfuerzo axil en pilares, muros y pantallas… afectado por un coeficiente de rigidez axil variable entre 1 y 99,99… El valor aconsejable es entre 2 y 3, siendo 2 el valor por defecto»*, para simular el proceso constructivo.
  - Aplica además un *«coeficiente reductor de la rigidez a torsión»* a los elementos de hormigón (salvo cuando hace falta para el equilibrio), y en el plano de planta toma EA = ∞ por el diafragma.
  - Un cálculo lineal 3D sin estos modificadores da momentos de vigas por acortamiento diferencial entre muros y pilares, y torsiones de vigas de borde que CYPE no da. La comparación de nivel 4 del §18 fallaría por la hipótesis, no por el *solver*.
- **Evidencia:** `fuentes/ccadmc01.pdf`, p. 20 (§1.4.2–1.4.4).
- **Recomendación:** `AnalyticalSection` lleva `modifiers: { axial, torsion, bendingY, bendingZ }`, con valores por defecto declarados (axial de pilares y muros = 2, torsión de HA reducida) que se registran en la huella y en la memoria. Los fixtures de comparación con CYPE usan los mismos valores.

## Contradicciones con el diseño técnico
1. **§7.3 y §8 frente a COM-01:** el MVP no puede usar triángulos con PyNite 3.2.0, porque no existe un elemento triangular operativo. Todo serán quads planos, y los triángulos sólo en el contrato.
2. **§7.2, §7.1 paso 8 y §23-11 («constraint explícita») frente a COM-02 y COM-03:** PyNite no tiene restricciones, *offsets* ni brazos rígidos. La conexión entre barra y lámina es siempre por nudos conformes, con barra embebida si el momento actúa sobre la perforación. El diafragma, o lo da la *shell* o se imita por penalización con su rango numérico. Esto genera elementos analíticos auxiliares sin elemento físico propio, lo que choca con la regla del §21 «todo frame/shell analítico tiene trazabilidad a un elemento físico». Hace falta un rol `auxiliar` en el *mapping*.
3. **§6 (`Slab` isótropa con thickness y material) frente a COM-04, COM-16 y COM-19:** el forjado unidireccional (y alveolar, chapa, madera) no es una *shell*, y PyNite no puede modelarlo ortótropo. El reticular necesita separar el espesor de rigidez del peso propio.
4. **§5.3 (una tolerancia de 1e-6 m) frente a COM-05 y COM-06:** hacen falta dos tolerancias (numérica y de modelado). El compilador debe poseer todas las fusiones, porque las de PyNite (1e-12·L para conectar, 1e-3 en el *merge*, que pierde cargas) no son trazables.
5. **§6 (`Storey.elevation`, z en `Vec3`) frente a COM-17:** Concreta ya tiene la fuente única del edificio, con alturas relativas y cotas derivadas que pueden ser `null`. Las z deben derivarse, no guardarse.
6. **§7.2 («cargas puntuales fuerzan subdivisiones») frente a COM-13:** con PyNite no hace falta; las estaciones de resultado salen de la carga.
7. **§13.1 (seis esfuerzos de *frame*) frente a COM-03:** con diafragma rígido o por penalización, el axil de las vigas de esa planta no es representativo y debe marcarse, como hace CYPECAD.
8. **§17 y §7.1 paso 12 (huella reproducible) frente a COM-12:** una huella sobre dobles derivados no es reproducible entre motores JS, y el FNV-1a de 32 bits existente es corto como clave de caché.

## Preguntas abiertas (lo que no pudiste cerrar y cómo se cerraría)
- **Calidad de los quads tri→3 en membrana y en muros con huecos:** sólo se validó la flexión (placa de Navier). Para cerrarlo, un *patch test* de membrana y una ménsula corta o un muro con hueco frente a la rejilla y frente a OOFEM. Lo lleva el Área 5.
- **Rigidez equivalente del reticular (½ maciza de CYPECAD o T bruta ≈ 0,3):** una planta reticular modelada en CYPECAD y en Concreta, comparando flechas y momentos de nervio, con decisión documentada en un ADR.
- **Ventana útil de α del diafragma por penalización dentro de Pyodide:** misma SuperLU, en principio igual; repetir `py/exp_diafragma.py` en el *spike* del Área 1.
- **Coste real de PyNite con 5 000–20 000 quads en Pyodide:** en CPython, 2 401 nudos tardaron 10,6 s. Esto fija el tamaño de malla por defecto; lo miden las Áreas 1 y 4.
- **Barras rígidas desde la cabeza del pilar a la huella frente a apoyar la huella:** sólo se probó la huella apoyada. Hay que comprobar con un pilar como barra unido por brazos rígidos y su efecto sobre el condicionamiento.
- **Embebido de la viga en muro cuando el muro es estrecho o tiene hueco junto al encuentro:** caso de esquina de la regla de COM-02.
- **¿Aceptaría PyNite aguas arriba la corrección de `Plate3D` y la ortotropía de flexión en `Quad3D`?** Hay que abrir un *issue* con el ensayo de COM-04.
- **UX de la asignación zona de carga ↔ polígono de losa, y de la posición de las cargas lineales:** decisión de diseño con el usuario. Sin ella, las cargas por planta no pueden entrar en 3D.

## Experimentos (qué ejecutaste, dónde están los scripts y su salida resumida)
Carpeta base: `C:\Users\javie\AppData\Local\Temp\claude\d--PROGRAMACION-Concreta-EST\b287d96a-8882-4d7d-800f-3c46ec2b77b4\scratchpad\fem3d\02-compilador\`. JS con Node 24.19 (más Bun 1.3.14 en E5). Python 3.14.7 en `venv/` con PyNiteFEA 3.2.0, NumPy 2.5.3 y SciPy 1.18.1.

| ID | Script | Qué mide | Resultado clave |
|---|---|---|---|
| E1-P1 | `py/exp_pynite.py` | Carga de barra con 1 elemento frente a 10 | Diferencia 1,3e-14 (COM-13) |
| E1-P2/P3 | íd. | Troceo automático de `PhysMember`; *merge* | 1e-9 m de desvío → singular; carga de 50 kN perdida (COM-06) |
| E1-P4/P8 | íd. | `Tri3D`; quad degenerado | `AttributeError n_node`; `ke` no finita (COM-01) |
| E1-P5b | `py/exp_pynite2.py` | kx_mod en `Quad` y `Rect` | `Quad` sin cambio; `Rect` con Mx 4,42 en lugar de 44,2 (COM-04) |
| E1-P6 | `py/exp_pynite.py` | Orden de nodos y signo de la presión | ±0,083 mm (COM-11) |
| E1-P7 | íd. | Viga en el plano de un muro | 2 056 mm, frente a 1,02 embebida y 0,569 teórico (COM-02) |
| E1-P9 | `py/exp_diafragma.py [torsion_liberada]` | Penalización frente a maestro-esclavo y *shell* | α útil 1e3–1e4; α = 1e10 singular; −13,7 % sin liberar la torsión (COM-03) |
| E1-P10 | `py/exp_pilar_losa.py` | Pilar como punto frente a su huella | −22,7 → −55,4 frente a −11,9 → −16,2 kN·m/m (COM-15) |
| E1-P11 | `py/exp_presion_vs_nodal.py` | Presión frente a p·A/4 | Idénticos (COM-14) |
| E1-P12 | `js/gen-placa.mjs` + `py/exp_placa_mallas.py` | Navier: tri→quad frente a rejilla | Diferencia 0,2 % entre mallas; +1–2 % frente a Kirchhoff (COM-07) |
| E2 | `js/run-mallado.mjs` (+ `geom.mjs`, `resumen.cjs`) | 5 bibliotecas × variantes A/B/C/S/D | `js/salida-mallado-resumen.txt` (COM-08, COM-10, COM-11) |
| E2-bis | `js/run-triquad-2h.mjs` | CDT a 2h + 3 quads frente a rejilla | 702 quads y 754 nodos, J ≥ 0,485 (COM-07) |
| E3 | `js/run-topologia.mjs` | Predicados; cruces con ruido | 398 de 478 encuentros a ≤ 5 cm sin tocarse; *hash* 3–12 ms (COM-05) |
| E4 | `js/run-rejilla-planta.mjs` | Rejilla estructurada con pilares desalineados | Relación de aspecto 941 sin fusión; 9,5 con ε = 5 cm (COM-07) |
| E5 | `js/trig-huella.mjs` y `js/trig-dump.mjs` (Node y Bun) | ulp de `Math.*` entre V8 y JSC | `hypot` 35,7 %, `cbrt` 27,2 %… (COM-12) |
| — | `py/espesor_equivalente.py` | t equivalente de las tipologías reticulares | 30+5 → 233 mm (COM-16, COM-19) |

## Fuentes
- PyNiteFEA 3.2.0 (PyPI, MIT), ficheros leídos: `FEModel3D.py`, `PhysMember.py`, `Quad3D.py`, `Plate3D.py`, `Tri3D.py`, `Mesh.py`, `ShearWall.py`, `FixedEndReactions.py` y `Analysis.py` (líneas citadas en cada hallazgo). https://github.com/JWock82/Pynite
- CYPE Ingenieros, *CYPECAD – Memoria de cálculo*: https://downloads2.cype.com/documentos_es/manuales/ccadmc01.pdf (copia en `fuentes/ccadmc01.pdf`; pp. 11-16, 20, 124, 243).
- CSI Knowledge Base, «Connecting frames to shells»: https://wiki.csiamerica.com/x/1YCR y «Frame to shell connections»: https://web.wiki.csiamerica.com/wiki/spaces/tp/pages/1803089/Frame+to+shell+connections
- CSI SAP2000, ayuda «Frame End Length Offsets» (*rigid zone factor*): https://docs.csiamerica.com/help-files/sap/Menus/Assign/Frame/Frame_End_Length_Offsets.htm
- Dlubal, manual de RFEM 6, tipos de rigidez de superficie («Load Transfer»): https://www.dlubal.com/en-US/downloads-and-information/documents/online-manuals/rfem-6/000040 y KB 001812: https://www.dlubal.com/en/support-and-learning/support/knowledge-base/001812
- Trimble, Tekla Structural Designer 2026, «Overview of the slab model»: https://support.tekla.com/doc/tekla-structural-designer/2026/mod_overviewofslabmodel
- ETABS «membrane / one-way load distribution» (secundarias): https://eng-tips.com/threads/modeling-one-way-slabs.195593 y https://www.scribd.com/document/644814648/differences-between-shell-membrane-plate
- Eje rígido y axil de vigas (secundarias): https://www.eng-tips.com/viewthread.cfm?qid=517700 y https://seismosoft.com/forum/viewtopic.php?p=639
- J. R. Shewchuk, Triangle 1.6, README (licencia): https://www.netlib.org/voronoi/triangle.zip
- artem-ogre/CDT, LICENSE (MPL-2.0): https://raw.githubusercontent.com/artem-ogre/CDT/master/LICENSE; CDT.js `.gitmodules`: https://raw.githubusercontent.com/matthewjacobson/CDT.js/main/.gitmodules
- Gmsh, LICENSE: https://gmsh.info/LICENSE.txt. CGAL, licencias: https://www.cgal.org/license.html
- npm (versiones probadas): delaunator 5.1.0, @kninnug/constrainautor 4.1.0, cdt2d 1.0.0, poly2tri 1.5.0, earcut 3.2.4, cdt-js 0.1.7, triangle-wasm 1.0.0, robust-predicates 3.0.3, clipper2-js 1.2.4.
- Remacle et al., «Blossom-Quad: a non-uniform quadrilateral mesh generator using a minimum-cost perfect-matching algorithm», IJNME 89 (2012) 1102-1119: https://www.gmsh.info/doc/preprints/gmsh_quad_preprint.pdf (alternativa de recombinación tri→quad, implementada en Gmsh, GPL).
- ECMA-262, §21.3.2 (Math.*: «implementation-approximated»): https://tc39.es/ecma262/#sec-function-properties-of-the-math-object
- Repositorio Concreta (rama `feat/fem3d`), ficheros citados: `docs/fem3d/diseno-tecnico.md`, `src/features/fem2d/{decompose,analysis,types,checks,modelOps,alignments}.ts`, `src/lib/frame-core/{sections,types}.ts`, `src/lib/edificio/index.ts`, `src/features/cargas-planta/state.ts`, `src/lib/acciones/{cargas,tablasCargas}.ts`, `src/data/forjadoTipologias.ts`, `src/data/defaults.ts`, `src/lib/calculations/{rcSlabs,forjadoLey}.ts`, `src/lib/pdf/utils.ts`, `src/features/fem-analysis/femSolver.ts`.
