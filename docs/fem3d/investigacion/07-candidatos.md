> **Informe original del Área 7 — Candidatos a motor y licencias**, generado por un subagente el 2026-10-03.
> El documento consolidado es `../investigacion-id.md`; esto es el detalle con toda la evidencia.
> Los scripts y salidas citados están ahora en `experimentos/07-candidatos/`; las rutas absolutas
> del texto apuntan a la carpeta temporal de la sesión que los ejecutó.

# FEM 3D — Candidatos a motor para el tamaño objetivo (7 plantas × 80 pilares)

> **Qué es.** Estudio comparativo de motores FEM y solvers dispersos que podrían sustituir o complementar a PyNiteFEA 3.2.0 sobre Pyodide cuando el tope pasa a ser un edificio de 7 plantas con unos 80 pilares por planta (≈ 2 000 m² por planta, losas, reticulares con ábacos, viguetas como barras y núcleos de muros), es decir, unos **20 000–90 000 nudos (120 000–550 000 GDL)**.
>
> - **Fecha:** 2026-10-03. Todas las fuentes se consultaron ese día.
> - **Punto de partida:** `docs/fem3d/investigacion-id.md` (rama `feat/fem3d`), sobre todo S0, H04, H05, H06, H07, H16, H22 y H39.
> - **Soporte:**
>   - **A**: verificado en el código, en el fichero LICENSE o en un experimento propio de esta sesión;
>   - **B**: documentado por el proyecto (README, documentación, issue del mantenedor, página oficial);
>   - **C**: indicio, fuente única secundaria o inferencia mía.
> - **Experimento propio E1:** la factorización dispersa en WASM al tamaño objetivo (§2). Scripts y salidas en `07-candidatos/bench/`.

---

## 0. Veredicto

**PyNite deja de ser la mejor opción con el nuevo tope. No es cuestión de ajustes: Pyodide + scipy no llega a ese tamaño.** Sigue sirviendo para el MVP pequeño (hasta ~1 500 nudos en menos de 10 s, según H04) y como oráculo, pero no para 120 000–550 000 GDL:

1. **El solver no deja memoria para nada más al tamaño objetivo (A, E1).** `scipy.sparse.linalg.splu` (SuperLU) en Pyodide:
   - factoriza 89 000 GDL en 8–10 s, pero el heap ya sube a 3,5 GB;
   - con 360 000 GDL tarda 25 s y toca el techo de 4 096 MB de wasm32;
   - con 567 000 GDL aborta (`gstrf was called with invalid arguments`).

   Con el modelo Python de PyNite encima, la ruta actual se queda en torno a ≤ 100 000 GDL (C), por debajo del mínimo del objetivo.
2. **El ensamblado en Python puro escala linealmente desde números ya malos (C, extrapolado de H04 y H16, que son A).** Con 4 810 nudos, `Quad3D.ke()` + FER suman ~18 s y el heap 556–662 MB. A 20 000 nudos serían ~75 s; a 90 000, ~340 s, y la memoria de los objetos Python no cabría en 4 GiB.
3. **Las carencias funcionales siguen ahí (A, en el código de HEAD 4afc9f1):**
   - el drilling es un muelle a tierra de 1/1000;
   - `Tri3D.py` existe, pero `FEModel3D` no lo importa ni lo usa;
   - no hay MPC: el mantenedor dice que exigiría «a significant rewiring» (#292, 2025-12-04);
   - no hay offsets;
   - no ha salido ninguna versión desde la 3.2.0 (2026-09-13).

**Mejor candidato: un motor propio en Rust compilado a WASM, con [faer](https://github.com/sarah-quinones/faer-rs) (MIT) como solver disperso.** Las formulaciones de elemento se portan de fuentes con licencia permisiva y se validan contra los oráculos de H39 (OpenSeesPy y Kratos):
- **PyNite** (MIT): DKMQ;
- **hekatan-struct-lineal** (MIT): membrana ITW con drilling validada contra ETABS, Timoshenko con offsets y diafragma por transformación;
- **awatif** (MIT): triángulo ANDES + DSG3 con drilling;
- **xshell** (MIT): MITC4 y DKT + Allman.

Las razones:
- **Licencia limpia (A).** faer, AMD (BSD-3) y METIS (Apache-2.0) son permisivas.
- **Supernodal en wasm32 (A, en código).** faer tiene Cholesky supernodal LLᵀ/LDLᵀ/LBLᵀ con AMD y kernels SIMD128 en `gemm`, y un usuario lo usa ya en wasm32 (issue #222, resuelta en la 0.22.6).
- **Un supernodal cabe en el objetivo (A, medido en E1 con CHOLMOD supernodal compilado a WASM, que hace de proxy):** 360 000 GDL en 11 s con 1,9 GB de heap y 567 000 GDL en 22 s con 2,8 GB. El simplicial, en cambio, va unas 10 veces más lento: 44 s con 180 000 GDL y 114 s con 360 000.
- **Sin Pyodide:** sin los ~30 MiB ni los 4–5 s de arranque.
- **Coste:** es el camino más caro en horas, pero el único que controla a la vez licencia, rendimiento y las tres carencias de PyNite.

**Segundo: bifurcar [hekatan-struct-lineal](https://github.com/GiorgioBurbanelli89/hekatan-struct-lineal) (MIT, C++/Eigen → WASM, derivado de awatif) y cambiarle el solver.**
- **A favor (A en código, B en README):**
  - ya corre en el navegador;
  - tiene DKQ, MITC4, membrana con drilling «en el campo de desplazamientos» (no un muelle), Timoshenko 3D con *rigid end offsets* y diafragma rígido por transformación T;
  - publica su validación nudo a nudo contra SAP2000 y ETABS.
- **En contra (A):**
  - usa `SimplicialLDLT` y, por encima de 150 000 GDL, gradiente conjugado con Cholesky incompleta, previsiblemente frágil con láminas (C);
  - un solo lado derecho por cálculo;
  - `MAXIMUM_MEMORY` de 2 GB;
  - un único desarrollador y seis meses de vida.

  Como base sólo vale cambiando el solver (faer vía FFI propia) y auditando el código. Como donante de formulaciones es excelente en cualquier caso.

**Descartados por licencia, aunque técnicamente serían los mejores:**
- **OpenSees y xara.** El copyright de UC Regents prohíbe la distribución comercial sin licencia de la Office of Technology Licensing, y xara conserva ese aviso (A).
- **stabileo** (LambdaClass), AGPL-3.0 (A). Es el más cercano al objetivo: Rust/WASM, MITC4/DKT/MITC9, MPC con diafragma y *rigid links*, y Cholesky supernodal propio. Sólo serviría con una licencia comercial negociada.
- **Code_Aster**, GPL-3.0 (A).
- **CHOLMOD Supernodal**, GPL-2.0+ (A).

**Viables con port pesado, sin ventaja clara:**
- **Kratos** (BSD con cláusula de publicidad, compatible): lo tiene todo, pero no hay build WASM y depende de Boost y pybind11.
- **OOFEM** (LGPL-2.1): tiene build Pyodide en CI desde la 3.0 y triángulo DKT + Allman con drilling, pero en WASM sólo lleva solvers *skyline*/iterativos, y la LGPL obliga a cargarlo como módulo sustituible.

---

## 1. Qué cambia el nuevo tope

| Magnitud | PyNite medido (H04, H16) | Objetivo | Factor |
|---|---|---|---|
| Nudos | 4 810 | 20 000–90 000 | 4–19× |
| GDL | 28 860 | 120 000–550 000 | 4–19× |
| Cálculo en Pyodide con driver propio | 23,5 s (ke ≈ 11 s, FER ≈ 7 s) | ~75–340 s sólo en ke+FER, extrapolado linealmente (C) | — |
| Heap WASM | 556–662 MB | No cabe: SuperLU solo sube a 3,5 GB con 89 000 GDL y toca 4 GiB con 360 000 (E1) | — |

El problema deja de ser «PyNite es lento» y pasa a ser **«en wasm32 sólo cabe un Cholesky supernodal con buena ordenación»**. Eso obliga a cambiar a la vez de solver y de ensamblado, y a esas alturas lo único que quedaría de PyNite son sus fórmulas de elemento.

---

## 2. Experimento E1: factorización dispersa en WASM al tamaño objetivo (soporte A)

**Montaje.**
- **Modelo sintético** con el patrón de un edificio:
  - 7 losas de n×n nudos sobre 45 × 45 m;
  - 80 pilares por planta (10 × 8), de un elemento por planta;
  - dos núcleos de muros de 8 × 6 m con filas intermedias de nudos;
  - 6 GDL por nudo, acoplados por completo entre nudos vecinos, como láminas + barras.
- **Matriz:** `K = Laplaciano(grafo) ⊗ B6` con B6 SPD 6×6. Sólo importan el patrón y que sea SPD.
- **Entorno:**
  - Pyodide 314.0.0 en Node 24, el mismo dist que H03/H16;
  - Ryzen 9 5900X, un hilo;
  - 24 lados derechos.
- **Solvers:**
  - **SuperLU:** `splu(permc_spec="MMD_AT_PLUS_A", diag_pivot_thresh=0, SymmetricMode)`, el de la ruta actual de PyNite;
  - **CHOLMOD supernodal** (SuiteSparse 5.11 + OpenBLAS 0.3.28, los paquetes `libsuitesparse` y `libopenblas` de la propia distribución de Pyodide), llamado por `ctypes`;
  - **CHOLMOD simplicial** (LDLᵀ *up-looking*), forzado con `Common->supernodal = 0`. Es el mismo algoritmo que Eigen `SimplicialLDLT`, QDLDL o LDL.
- **Ordenación:** CHOLMOD eligió AMD (`ordering = 2`) en todos los casos.
- **Residuos:** relativos ≤ 5e-15 en todos los casos.
- **Truco de montaje:** el `libcholmod.so` de Pyodide importa símbolos de OpenMP (`__kmpc_*`) que el *runtime* no exporta. Se dieron en JS versiones serie, parcheando una copia de `pyodide.asm.mjs`.

**Resultados.** Los GDL de cada columna corresponden a 6 516, 14 847, 30 040, 60 060 y 94 423 nudos.

| GDL | 39 096 | 89 082 | 180 240 | 360 360 | 566 538 |
|---|---|---|---|---|---|
| **CHOLMOD supernodal**: factorización | 0,82 s | 1,65 s | 4,17 s | 11,18 s | 21,96 s |
| — 24 lados derechos | 0,21 s | 0,42 s | 1,01 s | 2,07 s | 5,08 s |
| — entradas del factor (`xsize`) | 9,9 M | 21,6 M | 46,0 M | 99,9 M | 154,9 M |
| — heap WASM al terminar | 304 MB | 535 MB | 1 035 MB | 1 920 MB | 2 814 MB |
| **CHOLMOD simplicial**: factorización | 7,57 s | 16,32 s | 44,13 s | 114,06 s | (no se lanzó) |
| — heap | 306 MB | 556 MB | 1 095 MB | 2 102 MB | — |
| **SuperLU** (scipy): factorización | 2,29–2,6 s | 7,97–10,43 s | 11,51 s | 24,92 s | **falla** (`gstrf was called with invalid arguments`) |
| — 24 lados derechos | 0,71 s | 1,96–2,14 s | 3,60 s | 8,76 s | — |
| — nnz(L+U) | 15,8 M | 40,3 M | 82,0 M | 169,9 M | — |
| — heap WASM al terminar | 1 686 MB | **3 545 MB** | 3 745 MB | **4 096 MB (techo)** | — |

Las cifras de SuperLU vienen de la segunda pasada (`out_slu2.txt`), que lee `lu.nnz`. En la primera pasada (`out_bench.txt`), materializar `lu.L` y `lu.U` llevó el heap a 4 038 MB con 89 000 GDL y dio `MemoryError` con 180 000 y 360 000. Cuando hay dos tiempos, son de una pasada y de otra.

**Lectura.**
- **Supernodal frente a simplicial:** el supernodal es ~9–11 veces más rápido (5 GFLOP/s frente a 0,5 GFLOP/s en WASM) y guarda un factor comparable.
- **SuperLU, la ruta actual de PyNite, es 2–6 veces más lento que el supernodal y no deja memoria:**
  - guarda L y U, unas 2 veces las entradas del Cholesky simplicial (170 M frente a 86 M con 360 000 GDL);
  - su asignador reserva a saltos, así que con 89 000 GDL el heap ya llega a 3,5 GB;
  - con 360 000 GDL toca el techo de 4 GiB;
  - con 567 000 GDL falla;
  - sumando el modelo Python de PyNite, que con 4 810 nudos ya ocupaba cientos de MB (H16), el techo práctico de la ruta actual queda en torno a **≤ 100 000 GDL** (C).
- **Por qué importa el heap:** el de Pyodide no se devuelve nunca (H16), así que el pico es lo que cuenta.
- **El objetivo cabe en wasm32 con un supernodal:**
  - 567 000 GDL usan 2,8 GB;
  - en iOS, con 0,3–1 GB fiables (H16, soporte C), el tope práctico rondaría 90 000–180 000 GDL.

**Límites.**
- El modelo es sintético. Un modelo real con huellas de pilar (H09), ábacos y más muros tendrá algo más de relleno.
- No se probó METIS (ND), que suele reducir el relleno en mallas 2D grandes.
- CHOLMOD es GPL en su parte supernodal (§5), así que aquí sólo sirve de **proxy de rendimiento** de un supernodal en WASM. faer no se pudo medir porque esta máquina no tiene toolchain de Rust.

**Ficheros.** `07-candidatos/bench/bench_solvers.py`, `run.mjs`, `out_bench.txt`, `out_simp.txt` y `out_slu2.txt`. `dist/` es una copia del dist de Pyodide con `pyodide.asm.mjs` parcheado para exponer `wasmImports`.

---

## 3. Tabla comparativa

Leyenda de «Navegador hoy»: **sí** = hay build WASM usable hoy; **con port** = hay que compilarlo uno mismo; **no** = inviable o sin ruta conocida.

| Candidato | Licencia y app cerrada comercial | Navegador hoy | Láminas y drilling | MPC y diafragma | Barras 3D y offsets | Rendimiento al tamaño objetivo | Madurez y mantenimiento | Esfuerzo de integración |
|---|---|---|---|---|---|---|---|---|
| **PyNiteFEA 3.2.0** (Pyodide) | MIT: compatible (A) | **sí** (H03) | Sólo `Quad3D` DKMQ + Q4. Drilling = muelle 1/1000 (A). `Tri3D.py` sin conectar (A). `kx_mod/ky_mod` sólo de membrana (A) | No. #292 abierta: «significant rewiring» (A) | Euler–Bernoulli con *releases*. Sin offsets. Timoshenko sólo en la rama `shear_deformation` (A) | **No llega:** SuperLU sube a 3,5 GB con 89 000 GDL, toca 4 GiB con 360 000 y falla con 567 000 (A, E1); ke+FER ~75–340 s (C) | 751★. Mantenedor ≈ 90 % de commits (1 432 frente a 50 del segundo). 74 versiones; la última, 3.2.0 (2026-09-13) (A) | Bajo para el MVP; al tamaño objetivo equivale a reescribirlo |
| **OpenSees** (oficial) | UC Regents: sólo uso no comercial o interno. La distribución comercial exige licencia de la OTL (A) | **no**: sin build WASM conocido (A) | `ShellMITC4`, `ShellDKGQ`/`DKGT`, `ASDShellQ4`/`T3` (drilling real) (A) | `rigidDiaphragm`, `rigidLink` (`RigidBeam`/`RigidRod`), `equalDOF` (A) | `ElasticTimoshenkoBeam3d` (A). `-jntOffset` en geomTransf (C) | Nativo, segundos (C). En WASM no existe | Muy maduro. 826★, activo (A) | Bloqueado por licencia. Port C++/Fortran alto. Además trae Triangle, Tetgen y UMFPACK en `OTHER/`, con licencias aún más restrictivas (A) |
| **xara / OpenSeesRT** (STAIRlab, Claudio Pérez) | `LICENSE.txt` BSD-2, pero `about/COPYRIGHT` mantiene el aviso de UC Regents (A). El código heredado sigue bajo UC (C) | **no**: sin build WASM (A). Un tercero compiló un *spike* con sólo una celosía (B, en carapace) | Los de OpenSees (A) | Los de OpenSees (A) | Los de OpenSees (A) | Nativo, bueno (C) | Activo: xara 0.0.44 publicada hoy. 66★ (A) | Mismo bloqueo que OpenSees |
| **Kratos 10.4.4** | BSD con cláusula de publicidad («This product includes Kratos … technology»): compatible (A) | **con port**: no hay WASM. Exige Boost y pybind11/Python ≥ 3.8 (A) | DKQ/ANDES, MITC4, triángulos delgados/gruesos y CS-DSG3 (A) | `LinearMasterSlaveConstraint` (A) | Timoshenko 3D, CR-beam (A). Offsets: C | Nativo bueno. En WASM, desconocido (C) | Muy maduro: CIMNE, 1 369★, publicaciones regulares (A) | Muy alto: port de núcleo + aplicación + Boost a Emscripten |
| **OOFEM 3.0** | LGPL-2.1 (A): compatible si va como módulo sustituible y se publica su fuente (C, §5) | **con port**: build Pyodide wasm32 en CI y «Added support for Pyodide WebAssembly» en el ChangeLog (A). No se publica en PyPI; la última ejecución acabó cancelada (A) | `tr_shell02` = DKT + Allman (drilling real), `mitc4` sin drilling (A; H39) | `RigidArmNode`, nudos esclavos (A) | Barras 3D (B). Brazos rígidos con `RigidArmNode` (A) | Pobre en WASM: el build Pyodide no activa DSS (supernodal), así que quedan skyline o IML (A en `CMakeLists`; C en tiempos) | 203★, activo (A). Equipo CTU | Medio-alto: Pyodide otra vez, más el solver, más el cumplimiento LGPL |
| **Code_Aster** | GPL-3.0 (A): incompatible al distribuirlo | **no** | Muy completo (B) | Sí (B) | Sí (B) | — | Muy maduro (B) | Inviable: Fortran, MUMPS, PETSc, MED, HDF5 |
| **awatif 3.3.0** | MIT (A), pero su mallador es **Triangle**: «Distribution … as part of a commercial system is permissible ONLY BY DIRECT ARRANGEMENT WITH THE AUTHOR» (A) | **sí**: lSolver.wasm de 282 KB (A) | Sólo triángulo de 3 nudos (Rama et al. 2018): membrana tipo ANDES con drilling + placa DSG3 (A). Sin cuadriláteros | No (A) | Barra de 2 nudos con *releases*. Sin offsets (A) | Eigen `SparseLU`, un lado derecho, sólo cargas nodales (A). La memoria de LU limita a ~100 000 GDL (C, por analogía con E1 y la medida de hekatan). El no lineal va a servidor (`awatif.co/api/solve`) (A) | 182★, 30 forks, un autor (678 commits) (A) | Medio como donante; bajo valor como base |
| **hekatan-struct-lineal** | MIT (A). Incluye Eigen (MPL-2.0) (A) | **sí**: deform.wasm de 1,4 MB (A) | DKQ (placa delgada), MITC4 + modos incompatibles (gruesa) y membrana ITW con drilling en el campo de desplazamientos. Validado contra ETABS y SAP2000 (B) | Diafragma rígido por transformación T, maestro virtual en el c.d.m. (A). MPC general: no visto (C) | Timoshenko 3D con áreas de cortante, *releases* y *rigid end offsets* (B) | `SimplicialLDLT` hasta 150 000 GDL; por encima, PCG con IC (A). Ellos miden 317 MB con LDLT frente a 1 230 MB con LU a 90 234 GDL (B). Simplicial ≈ 10× más lento que supernodal (A, E1). `MAXIMUM_MEMORY` 2 GB (A). Un lado derecho por cálculo (A) | 11★. Creado el 2026-04-01; ~1 300 commits de un autor (A). Ficheros `.wasm.bak` en el repo (A) | Medio: fork + cambio de solver + multi-RHS + auditoría |
| **stabileo** (LambdaClass) | **AGPL-3.0** (A): incompatible con app cerrada salvo licencia comercial | **sí**: motor Rust → WASM (A) | MITC4 (ANS + EAS-7), MITC9 con drilling de Hughes–Brezzi, DKT, sólido-lámina SHB8 (A/B) | MPC por transformación: `RigidLink`, `Diaphragm`, `EqualDOF`, `EccentricConnection` (A) | Barras 3D, P-Δ, fibras, etc. (B) | Cholesky supernodal propio + AMD (A). Medido en sus documentos sólo hasta 5 700 GDL (B) | 83★. Creado en 2026-03, 2 782 commits, tres autores (A) | Bloqueado por licencia; sólo como referencia de ideas, sin copiar código |
| **xshell** (jtgtools) | MIT (A) | **sí** (TS puro) | MITC4 y DKT + Allman (B) | — | **No tiene barras** (B) | LDLᵀ disperso con AMD y PCG/ILU(0) de reserva (B) | 0★. Creado en 2026-07, un autor (A) | Donante pequeño |
| **Motor propio Rust + faer** | faer MIT, AMD BSD-3, METIS Apache-2.0 (A). Formulaciones portadas de fuentes MIT (A) | **con port** (propio) | Lo que se implemente: DKMQ/DKT + membrana con drilling real (ITW/ANDES) | MPC por transformación (diafragma, *rigid links*) | Timoshenko con offsets y *releases* | Esperable ≈ CHOLMOD supernodal en WASM: 4 s / 11 s / 22 s para 180k / 360k / 567k GDL (C, proxy A). Ensamblado compilado < 1 s (C) | faer: 2 575★, mantenedora principal ≈ 90 % (bus factor 1, A). El resto es código propio | **Alto:** 4–8 meses-persona hasta paridad con el MVP (C) |

---

## 4. Fichas por candidato

### 4.1 PyNite (`JWock82/Pynite`)
- **Versiones (A).** La 3.2.0 (2026-09-13) sigue siendo la última de PyPI y GitHub; 74 versiones en total. Desde entonces, HEAD (4afc9f1, 2026-09-29) sólo trae:
  - README;
  - un ajuste de *pushover*;
  - la opción `member_csys` de dibujo;
  - el rechazo de cargas repartidas de longitud cero (#340).
- **Hoja de ruta (A/B).** No hay documento de hoja de ruta.
  - #267 (2025-05-31), el mantenedor: «triangular elements … half-baked … My next focus is to improve the analysis engines: for speed and for step-wise non-linear analysis».
  - #269, rendimiento: KD-tree y rejilla en `merge_duplicate_nodes`/`discretize` y CSR en la partición. Sigue abierta la caché de `Quad3D`/`Member3D`.
  - #251: «major performance improvements in the way the stiffness matrix is assembled» (2026-01-23).
  - No hay ensamblado vectorizado de `Quad3D.ke()`, que es lo que mide H04.
- **MPC (A).** #292 sigue abierta. La respuesta del mantenedor es usar barras muy rígidas, lo mismo que hace H07.
- **Triángulos (A).** `Pynite/Tri3D.py` (688 líneas, con `kx_mod/ky_mod`) está en el árbol, pero `FEModel3D.py` no lo importa: sin API.
- **Modificadores (A).** Corrige en parte la premisa: `add_quad`/`add_plate` aceptan `kx_mod` y `ky_mod`, pero sólo escalan la membrana (`Cm`, ortotropía en ejes locales). `Hb`, la flexión, sigue isótropa. No sirve para el reticular ni para reducir la torsión.
- **Drilling (A).** `ke_rz = min(diagonal rotacional)/1000`, el muelle a tierra de H05, sin cambios.
- **Bus factor (A).** JWock82 hace 1 432 contribuciones; el segundo, 50. Hay dos colaboradores recientes (Ayberkrk y ulgens) con PR pequeños.

### 4.2 OpenSees y xara
- **OpenSees (A).** `COPYRIGHT`: «(a) use, reproduction, modification, and distribution … by educational, research, and non-profit entities for noncommercial purposes only; and (b) use, reproduction and modification … by other entities for internal purposes only … Permission to incorporate this software into products for commercial distribution may be obtained by contacting the University of California Office of Technology Licensing».
  - Concreta se vende y se distribuye al cliente (el WASM viaja al navegador): **no entra en (a) ni en (b)**.
- **xara (A).**
  - `peer-open-source/xara` lleva `LICENSE.txt` BSD-2 «Copyright (c) 2024, Claudio M. Perez», pero conserva `about/COPYRIGHT` con el mismo texto de UC Regents.
  - El paquete PyPI `xara` 0.0.44 no declara licencia.
  - Inferencia (C): la BSD-2 cubre las aportaciones de Pérez; el código heredado de OpenSees sigue bajo los términos de UC. Usarlo comercialmente exige el mismo permiso de la OTL.
- **WASM.**
  - No hay build oficial (A: búsqueda de código «EMSCRIPTEN/wasm/pyodide» sin resultados útiles; sin wheels `wasm32` en PyPI para `xara`, `opensees` ni `openseespy`).
  - carapace (jchatkinson, 2026-09) documenta un *spike*: compiló a WASM, con f2c + emcc, un análisis de celosía con clases reales de xara. Encontró el `XaraClassBroker` con ~230 includes, acoplamiento con Tcl, un fallo de firma `f2c`/`wasm-ld` y una doble liberación. Optó por reescribir en Rust (B, un solo tercero).
- **Elementos (A, en el árbol `SRC/`):**
  - `ShellMITC4`, `ShellDKGQ`, `ShellDKGT`, `ShellNLDKGQ/T`, `ASDShellQ4`, `ASDShellT3`, `ShellMITC9`;
  - `RigidDiaphragm`, `RigidBeam`, `RigidRod`;
  - `ElasticTimoshenkoBeam3d`;
  - solvers `sparseSYM`, `profileSPD`, `umfGEN`, `mumps`, `pardiso` y `petsc`.

### 4.3 Kratos
- **Licencia (A).** El núcleo (`kratos/license.txt`) y StructuralMechanicsApplication tienen licencia BSD con cuatro cláusulas, una de ellas de publicidad. Permite el uso comercial cerrado si se cumple el aviso. PyPI declara `BSD-4-Clause`.
- **WASM (A).** No hay nada: la búsqueda de código sólo devuelve un `asio` incluido.
- **Dependencias del build (A).** El `CMakeLists.txt` raíz exige Boost, pybind11 y Python ≥ 3.8.
- **Funcionalidad (A).**
  - Láminas: 3N/4N delgadas y gruesas, CS-DSG3 y MITC4;
  - restricciones: `LinearMasterSlaveConstraint`;
  - barras: Timoshenko 3D.
- **Veredicto.** Es el mejor *open source* compatible en funcionalidad, pero el port a navegador es un proyecto en sí mismo. Sigue como oráculo offline (H39).

### 4.4 OOFEM y Code_Aster
- **OOFEM 3.0: build WASM (A).**
  - Es LGPL-2.1.
  - `.github/workflows/wheels.yml` tiene el trabajo `build_pyodide` (`pyodide build` con emsdk). `.justfile` tiene la receta `pyodide`, y el ChangeLog: «Added support for Pyodide WebAssembly (WASM) builds».
  - La subida a PyPI está desactivada (`if: false`); la última ejecución de *Wheels*, del 2025-11-28, acabó cancelada.
- **OOFEM 3.0: solvers en ese build (A).** `pyproject.toml` no activa `USE_DSS`, y `CMakeLists.txt` lo marca `OFF # No reason to use this`.
- **OOFEM 3.0: elementos y esfuerzo.** `tr_shell02` es DKT3D + `trplanestressrotallman3d`, con 6 GDL por nudo (A). Aun así, sería repetir la arquitectura Pyodide de PyNite con otro motor.
- **Code_Aster (A).** GPL-3.0 según la API de GitLab. No hay ruta a WASM: Fortran, MUMPS, PETSc y Python.

### 4.5 awatif (`madil4/awatif`, MIT)
- **Arquitectura (A).**
  - Solver lineal C++/Eigen → WASM (`lSolver.cpp`).
  - Elementos de 2 nudos (barra 12×12 con *releases* por condensación) y de 3 nudos (lámina 18×18, `shellElement.h`, «Rama, Marinkovic, and Zehn (2018)»):
    - membrana con rotación de taladro (`alpha = 1/8`, término de orden superior β₀ = α²/4);
    - placa DSG3 con subtriángulos.
  - Cualquier otro tamaño de elemento da `status 4`.
- **Solver (A).** `Eigen::SparseLU`, un solo vector de cargas nodales, sin lados derechos múltiples, sin MPC ni offsets.
- **No lineal en servidor (A).** El no lineal se envía a `https://awatif.co/api/solve`.
- **Licencia del mallador (A).** El mallador `triangle-wasm` lleva el aviso de Triangle, incompatible con distribución comercial sin acuerdo con Shewchuk.
- **Actividad (A).** 182★, versión 3.3.0 (2026-07-21), ≥ 100 commits desde 2025-10-01 (la consulta se corta en 100), prácticamente un solo autor.
- **Para Concreta.** Sirve de referencia del triángulo con drilling y del patrón «C++ → WASM pequeño» (282 KB). No sirve como motor.

### 4.6 hekatan-struct-lineal (`GiorgioBurbanelli89/hekatan-struct-lineal`, MIT)
- **Origen (A).** Deriva de awatif: madil4 aparece con 664 commits entre los contribuidores.
- **Solver (A, `deform.cpp`).**
  - `SimplicialLDLT`, con `SparseLU` de reserva;
  - si `K_reduced.rows() > 150000`, `ConjugateGradient` + `IncompleteCholesky` con tolerancia 1e-12;
  - el propio código lo justifica: «Measured on the same 90,234-DOF matrix: LDLT 317 MB vs LU 1,230 MB … before WASM32 hits its 2 GB limit».
- **Diafragma (A).** `utils/rigidDiaphragm.h` lo implementa como transformación `u = T·u_red` con maestro virtual en el centro de masas o geométrico. Es exactamente lo que le falta a PyNite (H07).
- **Formulaciones y validación (B, README).**
  - DKQ (Batoz–Tahar), MITC4 con modos incompatibles, membrana ITW 1990/1991 con proyección de drilling tipo FEAP;
  - Timoshenko 3D con *rigid end offsets* y convenio CSI;
  - Winkler, modal y combinaciones;
  - tablas de validación contra ETABS 22, SAP2000 24 y SAFE 20 de 0,0000–1,9 %.
- **Riesgos (A).**
  - un desarrollador;
  - repositorio con copias `.wasm.bak` de varias variantes;
  - `MAXIMUM_MEMORY=2147483648`;
  - un caso por llamada.
- **Para Concreta.** Es la mejor fuente MIT de formulaciones «tipo CSI», y además en español.

### 4.7 stabileo (`lambdaclass/stabileo`, AGPL-3.0)
- **Motor (A).** Rust → WASM (`engine/`, ~2,9 MB de fuente). Incluye:
  - `linalg/sparse_chol.rs`: «supernodal: left-looking between supernodes, dense right-looking within each supernode panel» con AMD y RCM;
  - `solver/constraints.rs`: «Multi-point constraint (MPC) technology using the transformation method», con `RigidLink`, `Diaphragm`, `EqualDOF` y `EccentricConnection`;
  - láminas MITC4, MITC9 y DKT, y sólido-lámina.
- **Rendimiento (B).** `docs/BENCHMARKS.md` sólo cuantifica el Cholesky disperso hasta 5 700 GDL («22-89× factorization speedup over dense LU»).
- **Licencia (A).** AGPL-3.0, y no hay oferta comercial publicada. Usarlo exigiría negociar con LambdaClass. No se debe copiar código.

### 4.8 Otros motores en navegador revisados
- **jtgtools/xshell** (MIT, TS): MITC4, DKT + Allman y LDLᵀ con AMD, pero sin barras (B).
- **ChooseDews/RustFEA** (Apache-2.0): sólidos C3D4/C3D8/C3D20 con faer en WASM (B). Sin láminas, pero confirma faer en WASM dentro de una app FEA.
- **jchatkinson/carapace** (sin licencia, Rust): sólo pórticos.
- **larsmei/axia-fem** (CalculiX INP en WASM): CalculiX expande las láminas a sólidos (H39).
- **tpt-app-fea-lite** (sin licencia): 2D plano.
- **cholesky-solve** (npm, MIT, 2017): JS puro. Dice portar el «Algorithm 849» (LDL de Davis, que es LGPL-2.1), así que su licencia MIT es dudosa (C).
- **Ninguno de los anteriores sirve como motor** de Concreta.

---

## 5. Solvers dispersos para un motor propio

| Solver | Licencia (soporte) | Algoritmo | Ordenación | wasm32 y SIMD | Rendimiento publicado o medido | Encaje |
|---|---|---|---|---|---|---|
| **faer 0.24.4** (Rust) | MIT (A) | Cholesky disperso LLᵀ, LDLᵀ y LBLᵀ (Bunch–Kaufman intranodo); simplicial o **supernodal** según el umbral de flops (A, `sparse/linalg/cholesky.rs`) | AMD propia (por defecto), Identity o Custom. **Sin METIS** (A). COLAMD para LU | Sin `std` pesado. `gemm` tiene microkernels f64 `simd128` para `wasm32` y `pulp` un módulo `wasm` (A). Issue #222 (wasm32, cerrada en la 0.22.6) (A) | **No hay benchmark disperso publicado frente a CHOLMOD o MKL**: la web sólo publica densos, sin rivales (B). El *paper* dice «Sparse algorithm implementations will be showcased in a future paper» (A) | **Primera opción.** Medirlo en el *spike* (§8) |
| **QDLDL** | Apache-2.0 (A) | LDLᵀ simplicial (Algorithm 849) (B) | No incluye ordenación (B) | C99 sin dependencias: trivial a WASM (C) | Simplicial: ~10× más lento que supernodal (A, E1 como proxy) | Sólo para modelos pequeños |
| **Eigen** `SimplicialLDLT` | MPL-2.0; el código derivado de LDL está relicenciado a MPL por acuerdo Davis–Google (A, cabecera de `SimplicialCholesky_impl.h`) | Simplicial (A) | AMD propia (B) | Probado en WASM: awatif y hekatan (A) | 317 MB a 90 234 GDL (B, hekatan). Unas 10× más lento que supernodal (A, E1) | Aceptable hasta ~100 000 GDL. Eigen no tiene Cholesky supernodal propio; sí `SparseLU` supernodal, que gasta mucha más memoria |
| **SuiteSparse CHOLMOD** | **Por módulo (A):** Check, Cholesky, Utility, Partition e Include → **LGPL-2.1+**; **Supernodal**, Modify, MatrixOps, Demo y MATLAB → **GPL-2+**. AMD, CAMD, COLAMD y CCOLAMD → BSD-3 | Supernodal (GPL) o simplicial (LGPL) | AMD, METIS y NESDIS | Ya existe en Pyodide (`libsuitesparse` 5.11.0, con símbolos OpenMP sin resolver) (A). sparse-wasm (jchatkinson) lo compila «only from its simplicial LGPL components» (B) | E1: supernodal 22 s con 567 000 GDL; simplicial ~10× más lento (A) | **El supernodal no se puede distribuir en una app cerrada** (GPL). El simplicial LGPL no compensa frente a faer |
| **AMD / COLAMD** | BSD-3 (A) | Ordenación | — | C puro | — | Libre de usar |
| **METIS 5** (KarypisLab) | Apache-2.0 (A) | Disección anidada | — | Compila a WASM: va dentro del `libsuitesparse` de Pyodide (A) | — | Libre de usar. Útil si AMD rellena mucho (C) |
| **SuperLU** (scipy) | BSD-3 de LBNL (A) | LU supernodal | COLAMD o MMD | Ya va en scipy de Pyodide (A) | E1: 25 s con 360 000 GDL; heap de 3,5 GB con 89 000 GDL y de 4 GiB (techo) con 360 000; falla con 567 000 (A) | **Es el cuello actual de PyNite** |
| **MUMPS 5.9.1** | CeCILL-C (B): copyleft débil por componente, del estilo LGPL | Multifrontal | AMD, PORD y METIS | Compilado a wasm32 en ipopt-wasm (flang → FIR → LLVM, MUMPS 5.8.1 + BLAS de referencia) (B, un tercero) | Desconocido en WASM | Viable legalmente, pero cadena Fortran frágil |
| **npm** | — | — | — | No se encontró ningún paquete npm con un Cholesky supernodal en WASM (A, búsqueda en el registro y en GitHub). Lo más cercano es `jchatkinson/sparse-wasm` (KLU, CHOLMOD simplicial y SuperLU; repo, no npm, 2026-09) (B) | — | — |

**Distinción verificado/inferido.**
- **Verificado (A):** las licencias, la existencia del supernodal en faer y de los kernels SIMD128, y los tiempos de CHOLMOD y SuperLU en WASM.
- **Inferido (C):** que faer rinda como CHOLMOD-WASM (±2×). Ninguna fuente lo publica; hay que medirlo.

---

## 6. Licencias copyleft en un WASM servido a clientes

- **GPL** (Code_Aster, CHOLMOD Supernodal, UMFPACK, SPQR):
  - servir el `.wasm` al navegador del cliente es **distribuir** (C);
  - la FSF considera que enlazar, estática o dinámicamente, forma una obra combinada ([GPL FAQ](https://www.gnu.org/licenses/gpl-faq.html#GPLStaticVsDynamic), B);
  - meterlo en el mismo módulo o worker que el código de Concreta obligaría a publicar Concreta bajo GPL. **Incompatible.**
- **AGPL** (stabileo): igual que la GPL, y además cubre el uso por red. **Incompatible.**
- **LGPL-2.1** (OOFEM, CHOLMOD Core/Cholesky, KLU, LDL, CSparse):
  - **es compatible** si:
    1. la biblioteca va como **módulo separado y sustituible**, por ejemplo un `.wasm`/`.so` cargado dinámicamente, como hace Pyodide con sus wheels;
    2. se ofrece su fuente, con las modificaciones;
    3. la licencia de Concreta no prohíbe modificarla ni la ingeniería inversa necesaria para depurar ([LGPL-2.1 §6](https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html), B);
  - en una PWA, la «sustituibilidad» es discutible (C). Mejor evitarlo si hay alternativa MIT.
- **CeCILL-C** (MUMPS): copyleft a nivel de componente. Se parece a la LGPL en la práctica (C).
- **MPL-2.0** (Eigen): copyleft por fichero. Sólo obliga a publicar los ficheros de Eigen modificados (B).
- **UC Regents** (OpenSees, xara heredado): no es copyleft sino **no comercial**. Ni siquiera publicando la fuente se puede distribuir sin licencia de la OTL (A).
- **Triangle** (awatif): la distribución comercial necesita acuerdo con el autor (A). Concreta ya tiene su CDT propio (H29).

---

## 7. Cómo lo hacen las apps web comerciales

Las grandes calculan en **servidor**:
- **SkyCiv:** se presenta como «100% cloud-based»; en su API, `S3D.model.solve` cuesta 1 crédito porque «API calls only cost if a calculation or computation is being performed (i.e. FEM analysis …)» (B).
- **Dlubal:** con *Cloud Calculations*, RFEM envía el modelo a servidores de cálculo en la nube con distintos niveles de potencia, y sus *WebServices* son un servidor RFEM/RSTAB al que se hacen peticiones (B; que sea Azure con hasta 32 núcleos y 64 GB viene de un fragmento de búsqueda, C).
- **ClearCalcs:** resuelve su FEA 2D «in the cloud» (B).

El cálculo **en cliente con WASM** sólo aparece en proyectos abiertos recientes:
- stabileo: «the model is not sent to a server»;
- hekatan;
- awatif, en lineal: el no lineal lo manda a `awatif.co/api/solve`.

Concreta se diferenciaría por ser offline y por no enviar el modelo a nadie. A cambio, carga con el techo de memoria del navegador (§2) y no puede apoyarse en ningún producto comercial que demuestre la escala objetivo en cliente (C).

---

## 8. Recomendación operativa

1. **No construir el MVP alrededor de internos de PyNite** que luego haya que tirar.
   - El compilador, el `AnalyticalModel`, las combinaciones, los resultados en `Float64Array` y la batería de validación (H13, H27, H30, H36, H40) son independientes del motor: siguen adelante sin cambios.
   - El `SolverAdapter` debe quedar estrecho: modelo analítico in, `Float64Array` por caso out.
2. **Spike de 2–3 semanas: «motor Rust + faer en WASM»**, antes de comprometer la Fase 1:
   - **Contenido mínimo:**
     - un crate con barra Timoshenko 3D con offsets y *releases*;
     - una lámina de 4 nudos: DKMQ de PyNite + membrana ITW o Allman con drilling, tomando como referencia hekatan (MIT) y xshell (MIT);
     - MPC por transformación para el diafragma;
     - faer supernodal con AMD;
     - `wasm32-unknown-unknown` con `+simd128`.
   - **Criterios de paso:**
     - factorizar 360 000 GDL en ≤ 15 s y 567 000 GDL en ≤ 30 s, con heap ≤ 2,5 GB, sobre el mismo modelo sintético de E1;
     - reproducir los casos de H05 (viga en el plano del muro), H10 y H17 frente a OpenSeesPy (`ASDShellQ4`) con las tolerancias de H37.
   - **Plan B del solver**, si faer resulta más lento de 2× respecto al proxy: METIS (Apache-2.0) como ordenación personalizada, o MUMPS (CeCILL-C) como módulo aparte.
3. **PyNite se queda como:**
   - motor del prototipo mientras dura el spike;
   - oráculo adicional en la batería.

   Las conclusiones de H01–H48 que no dependen de PyNite siguen valiendo.
4. **Licencias.** Pedir presupuesto a LambdaClass por stabileo sólo si el spike fracasa: sería la vía más rápida a un motor completo, pero con dependencia de proveedor. No usar código de OpenSees, xara, stabileo ni Triangle.

---

## 9. Lo que no se pudo cerrar

| Pregunta | Por qué no | Cómo cerrarlo |
|---|---|---|
| Rendimiento real de faer supernodal en wasm32 + SIMD128 | No hay toolchain Rust en la máquina; no hay benchmark publicado | El spike del §8.2, con el modelo de E1 |
| Relleno con METIS frente a AMD en modelos reales con ábacos y huellas | CHOLMOD eligió AMD siempre; el modelo es sintético | E1 con `Common->nmethods`/METIS forzado y un modelo compilado real |
| Si el build Pyodide de OOFEM pasa hoy | El CI está cancelado y no hay wheel publicado | `just pyodide` en Linux o WSL |
| Si UC/OTL concede licencias de OpenSees y a qué precio | No se ha preguntado | Contactar con la OTL, sólo si interesa |
| Memoria fiable en Safari iOS y Memory64 en Safari | Fuentes secundarias contradictorias (C) | Medirlo en dispositivo en la Fase 0 (H16) |

---

## 10. Fuentes (consultadas el 2026-10-03)

**PyNite**
- https://github.com/JWock82/Pynite: releases, `gh release list`; issues #292, #267, #269 y #251; contribuidores; commits desde 2026-09-13.
- https://github.com/JWock82/Pynite/blob/main/Pynite/Quad3D.py, `Tri3D.py` y `FEModel3D.py` (HEAD 4afc9f1).
- https://pypi.org/pypi/PyNiteFEA/json

**OpenSees y xara**
- https://github.com/OpenSees/OpenSees/blob/master/COPYRIGHT
- `SRC/element/shell`, `SRC/domain/constraints`, `SRC/element/elasticBeamColumn` y `OTHER/` del mismo repositorio.
- https://github.com/peer-open-source/xara: `LICENSE.txt`, `about/COPYRIGHT`, `pyproject.toml` y `README.md`. Fork: https://github.com/STAIRlab/xara
- https://pypi.org/pypi/xara/json, https://pypi.org/pypi/opensees/json y https://pypi.org/pypi/openseespy/json
- https://github.com/jchatkinson/carapace/blob/main/docs/xara-feasibility.md

**Kratos, OOFEM y Code_Aster**
- https://github.com/KratosMultiphysics/Kratos: `license.txt`, `kratos/license.txt`, `applications/StructuralMechanicsApplication/license.txt`, `CMakeLists.txt`, `custom_elements/shell_elements` y `kratos/constraints/linear_master_slave_constraint.h`. También https://pypi.org/pypi/KratosMultiphysics/json
- https://github.com/oofem/oofem: `ChangeLog`, `.github/workflows/wheels.yml`, `.justfile`, `CMakeLists.txt`, `pyproject.toml`, `src/sm/Elements/Shells/tr_shell02.h` y `src/core/rigidarmnode.h`.
- https://gitlab.com/codeaster/src, licencia vía la API de GitLab: `gpl-3.0`.

**Motores en navegador**
- https://github.com/madil4/awatif: `components/analysis/l-solver/cpp/lSolver.cpp`, `shellElement.h`, `components/analysis/nl-solver/getNlPositionsAndForcesRemote.ts`, `components/mesh/triangle-mesh/TRIANGLE_LICENSE.txt` y `package.json`.
- https://github.com/GiorgioBurbanelli89/hekatan-struct-lineal: `README.md`, `hekatan-fem/src/cpp/deform.cpp`, `utils/rigidDiaphragm.h` y `build_wasm.sh`.
- https://github.com/lambdaclass/stabileo: `README.md`, `LICENSE`, `engine/Cargo.toml`, `engine/src/linalg/sparse_chol.rs`, `engine/src/solver/constraints.rs`, `docs/BENCHMARKS.md` y `docs/research/open_source_solver_comparison.md`.
- https://github.com/jtgtools/xshell, https://github.com/ChooseDews/RustFEA, https://github.com/jchatkinson/sparse-wasm y https://github.com/louisabraham/ipopt-wasm

**Solvers dispersos**
- faer: https://github.com/sarah-quinones/faer-rs (`LICENSE`, `faer/src/sparse/linalg/cholesky.rs`, `faer/Cargo.toml`, `faer-ffi/faer.h`, issue #222); https://faer.veganb.tw/benchmarks/ y `/benchmarks/minipc/`; https://github.com/sarah-quinones/gemm (`gemm-f64/src/microkernel.rs`); https://github.com/sarah-quinones/pulp (`pulp/src/wasm.rs`).
- QDLDL: https://github.com/osqp/qdldl
- Eigen: https://gitlab.com/libeigen/eigen/-/raw/master/COPYING.README y `Eigen/src/SparseCholesky/SimplicialCholesky_impl.h`.
- SuiteSparse: https://github.com/DrTimothyAldenDavis/SuiteSparse (`LICENSE.txt`, `CHOLMOD/Doc/License.txt`, v7.14.1).
- METIS: https://github.com/KarypisLab/METIS (`LICENSE`).
- SuperLU: https://github.com/xiaoyeli/superlu (`License.txt`).
- MUMPS: https://mumps-solver.org/index.php?page=dwnld
- npm: https://registry.npmjs.org/-/v1/search (consultas «sparse cholesky», «sparse solver wasm», «faer» y `keywords:sparse keywords:wasm`) y https://www.npmjs.com/package/cholesky-solve
- Pyodide 314.0.0: `pyodide-lock.json` (`libsuitesparse` 5.11.0, `libopenblas` 0.3.28, sha256 verificados) y https://cdn.jsdelivr.net/pyodide/v314.0.0/full/

**Licencias**
- https://www.gnu.org/licenses/gpl-faq.html#GPLStaticVsDynamic
- https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html
- https://cecill.info/licences/Licence_CeCILL-C_V1-en.html

**Apps comerciales**
- SkyCiv: https://skyciv.com/api/v3/docs/api-calls y https://skyciv.com/3d-structural-analysis-software-features/
- Dlubal: https://www.dlubal.com/en/solutions/online-services/cloud-calculations y https://www.dlubal.com/en/solutions/online-services/webservice-and-api
- ClearCalcs: https://clearcalcs.com/calculations/analysis

**Memory64 (C)**
- https://devnewsletter.com/p/state-of-webassembly-2026/ y https://platform.uno/blog/state-of-webassembly-2024-2025/
