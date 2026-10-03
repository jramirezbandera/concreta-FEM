> **Informe original del Área 8 — Alcance de un motor propio**, generado por un subagente el 2026-10-03.
> El documento consolidado es `../investigacion-id.md`; esto es el detalle con toda la evidencia.
> Los scripts y salidas citados están ahora en `experimentos/08-motor-propio/`; las rutas absolutas
> del texto apuntan a la carpeta temporal de la sesión que los ejecutó.

# Motor FEM 3D propio para Concreta: viabilidad, alcance y plan

> Informe del subagente «Plan» del 2026-10-03. Es un estudio de alcance de solo lectura, sin experimentos. Las cifras marcadas «(est.)» son estimaciones sin medir (soporte C) y las tiene que confirmar el spike E0. Las rutas son relativas al worktree `wt/feat-fem3d`.

## Resumen y recomendación

1. **PyNite deja de servir con los requisitos nuevos.**
   - No hace ortotropía a flexión, así que no cubre el req. 3 (H46).
   - No llega al tamaño del req. 4: en < 10 s sólo resuelve hasta ~1 500 nudos, y con 4 810 nudos el heap llega a 662 MB (H04, H16).
   - No tiene un diafragma exacto para las viguetas-barra del req. 2 (H07).
2. **La recomendación es un motor propio híbrido, la vía (iii):**
   - elementos, restricciones, ensamblado y recuperación en TypeScript;
   - la factorización LDLᵀ dispersa supernodal en Rust con `faer`, compilado a WASM;
   - un solver de perfil en TypeScript como referencia y como reserva.
3. **Elementos:**
   - lámina **DKMQ24**: la flexión DKMQ de Katili, que es la misma de PyNite, más la membrana Ibrahimbegovic–Taylor–Wilson con drilling Hughes–Brezzi;
   - barra de Timoshenko con offsets, punto de inserción y liberaciones;
   - muelles.

   Sin triángulos en el MVP.
4. **Restricciones** (diafragma por planta y enlaces rígidos): por transformación maestro-esclavo. Con diafragma rígido, cada nudo de losa conserva sólo 3 GDL, y eso abarata mucho el solver.
5. **En el repo no hay nada 3D ni disperso.** Se reutiliza todo lo que rodea al núcleo (secciones, combinaciones, comprobaciones, cargas por planta y worker), pero no el núcleo numérico.
6. **Casi toda la investigación sigue valiendo.** Unos 12 hallazgos eran *workarounds* de PyNite y desaparecen o se simplifican.
7. **Coste del motor: 14–24 semanas-persona.** Frente al plan S1 son +6–12 semanas netas, porque se ahorran entre 5 y 13 semanas de adaptación a PyNite.
8. **Riesgo principal: errores silenciosos de formulación.** Se cubren con tres oráculos:
   - PyNite como oráculo diferencial de la flexión, que es la misma DKMQ;
   - OpenSeesPy para la membrana con drilling y para las restricciones;
   - MacNeal–Harder y los ejemplos de CSI de H48.
9. **Antes de comprometerse, un spike E0 de 2–3 semanas.** Criterios de paso:
   - la DKMQ coincide con PyNite a 1e-10;
   - el muro 1×3 da un error ≤ 5 %;
   - 200 000 GDL se resuelven en ≤ 5 s en Chrome;
   - el WASM pesa ≤ 1,5 MB.
10. **PyNite sólo conviene si se renuncia a los requisitos 2–4** para tener antes un MVP de edificios pequeños. En ese caso, se sigue el S1 tal cual.

## 1. Inventario de lo reutilizable

| Pieza | Qué hay (fichero:línea) | Qué se aprovecha |
|---|---|---|
| Solver 3D | Ninguno. La 1D `solveAnalysisModel` (`src/features/fem-analysis/femSolver.ts:62`) usa 2 GDL por nudo; la 2D `solveAnalysis2D` (`src/features/fem2d/solver2d.ts:111`), 3 GDL por nudo | Nada directo. Sí el patrón de recuperación cerrada con el convenio de signos escrito en la cabecera (`solver2d.ts:30-40, 536-591`) y las FEQ (`solver2d.ts:454`) |
| Solver lineal | `gaussSolve`: denso, con pivoteo, sobre `number[][]` (`src/lib/frame-core/linalg.ts:12`). Refactoriza en cada caso de carga (`femSolver.ts:111-121`, `solver2d.ts:199-207`) | Sólo como oráculo denso en tests de ≤ 200 GDL |
| Solver disperso | Ninguno: un grep de sparse, CSR, Cholesky y LDL en `src/` no da resultados | — |
| Transformación de barra 3D | Ninguna. Sólo la 2D: `transform6` y `congruence` (`solver2d.ts:391, 403`). Las liberaciones se hacen duplicando el GDL de giro (`solver2d.ts:22-28, 341-342`) | La idea de las liberaciones. En 3D con offsets, mejor por condensación |
| Secciones | `rcStiffness` sólo da EA y EI de eje fuerte (`src/lib/frame-core/sections.ts:77`); `steelStiffness` y `STEEL_CATALOG`, sólo A, I e Iz (`:88`, `:49`). E del hormigón de una única fuente (`:72`); γ en `:22-23`; madera en `:112`. It e Iw en `src/lib/sections/types.ts:54-55` y `src/data/steelProfiles.ts:19`; área de cortante en Z en `types.ts:162` | Hace falta una `seccion3D()` nueva con Iy, Iz, J, Avy y Avz para el HA y Avy para el acero. Lo demás se reutiliza tal cual |
| Combinaciones | `buildCombinations` (`src/lib/frame-core/combinations.ts:92`) y `buildLcCombinations` (`lcCombinations.ts:63`). CTE multiprincipal sin G favorable (`lcCombinations.ts:24-25`, S4 #1), sin familias y sin sismo (H30) | El prototipo 3D `docs/fem3d/investigacion/experimentos/03-resultados/combos3d.mts` |
| Comprobaciones por combinación | `checkFem2D` (`src/features/fem2d/checks.ts:383`), que reparte a HA, acero y madera (`:1943`, `:2285`, `:1067`, `:1682`), y la sensibilidad traslacional (`:2516`) | Base de los extractores de H35 |
| Compilador | `decompose2D` (`src/features/fem2d/decompose.ts:101`), que gira las cargas de ejes globales a locales (`:12-16`) | El patrón del compilador (H33) |
| Datos físicos | `PubZonaCargas` con `pp` y el tipo de forjado (`src/features/cargas-planta/state.ts:761`). `TIPOLOGIAS` con h, capa, nervio e intereje (`src/data/forjadoTipologias.ts:18-24`). `calcForjados` por nervio (`src/lib/calculations/rcSlabs.ts:452`). Plantas y cotas (`src/lib/edificio/index.ts:30, 145`) | Entrada directa de los multiplicadores del reticular (req. 3) y del peso propio (H24) |
| Worker | Comlink y `cancelAndRewarm` (`src/lib/calculations/geotech/client.ts:108`); workers en módulo ES (`vite.config.ts:18`) | Se reutiliza tal cual |
| Mallado y topología | Prototipos en `docs/fem3d/investigacion/experimentos/02-compilador/js/` (`run-triquad-2h.mjs`, `run-topologia.mjs`) | H28 y H29 |

## 2. Especificación mínima del motor

### 2.1 Convenios
- **Unidades:** kN, m, kN·m, kN/m² y E en kN/m², como en `sections.ts:11-16` (D1-b).
- **Ejes:**
  - Z hacia arriba;
  - el eje local de cada barra se fija con un vector de referencia explícito (§5.2 del diseño), con lo que H08 desaparece;
  - el eje 1 de la lámina es la dirección de los nervios o, si no hay, la X global proyectada (resuelve H01).
- **Signos:** convenio tipo CSI nativo (H02), escrito en la cabecera del motor como en `solver2d.ts:30-40`.

### 2.2 Elementos

**Lámina cuadrilátera: DKMQ24.** Comparación de las opciones:

- **MITC4** (Dvorkin–Bathe, *Eng. Comput.* 1, 1984).
  - A favor: admite cualquier matriz D sin cambios.
  - En contra: da peores momentos con malla gruesa, y su membrana Q4 bloquea. En la viga de MacNeal–Harder, `ShellMITC4` de OpenSees da 0,076 frente a 0,1081 (H39).
- **DKMQ** (Katili, *IJNME* 36, 1993, parte II).
  - Ya validada en H10: converge con orden 2, pasa los patch tests y no bloquea.
  - Es exactamente la flexión de `Quad3D` (H06), así que PyNite sirve de oráculo bit a bit.
- **DKMQ24** (Katili, Maknun, Batoz e Ibrahimbegovic, *Compos. Struct.* 202, 2018). Es DKMQ más la membrana ITW (Ibrahimbegovic, Taylor y Wilson, *IJNME* 30, 1990) con el drilling variacional de Hughes–Brezzi (*CMAME* 72, 1989).
  - Resuelve H05: la rigidez de giro es real, no un muelle a tierra, y ΣM cierra.
  - Resuelve H17: la membrana con drilling bloquea mucho menos. Referencia: en el muro 1×3, `ASDShellQ4` de OpenSees da −3,8 % y la Q4 de PyNite, −32 %.
- **DKMQ24+.** Añade correcciones de alabeo; la referencia exacta está por verificar. No hace falta si el mallador garantiza la planitud (H06, H23).

**Detalles de implementación de la lámina:**
- γ del drilling = G por defecto, con un barrido entre 1e-3·G y G en la batería.
- Comprobar que el elemento libre tiene 6 modos de energía nula. La integración reducida del término de drilling puede dejar un modo espurio; en ese caso, estabilizar como en la referencia.
- φₖ de la DKMQ en su forma anisótropa (Katili 2018), para que m11 ≠ m22 y v13 ≠ v23 entren de verdad (H46).
- El `ke` de flexión y las FER se pueden portar desde PyNite (MIT, con aviso en `NOTICE`).

**Triángulo: fuera del MVP.** La triangulación dividida en quads da lo mismo que una rejilla, con un 0,2 % de diferencia (H29). Si hace falta más adelante:
- DKMT (Katili 1993, parte I), con membrana de Allman (1984) o ANDES-OPT (Felippa, *CMAME* 192, 2003);
- mejor que DKT, que no tiene cortante, y que MITC3, que es demasiado rígido.

**Barra 3D:**
- Timoshenko exacta (Przemieniecki 1968; Φ = 12EI/(κGAL²)) y torsión de Saint-Venant.
- Offsets y zonas rígidas por transformación cinemática (Wilson, *3D Static and Dynamic Analysis of Structures*, CSI 2002).
- Punto de inserción para vigas descolgadas, con aviso de doble cómputo (H24).
- Liberaciones por condensación en ejes locales del tramo flexible; se rechazan las incompatibles (H11).
- FER cerradas de Timoshenko, y diagramas en TypeScript a partir de los esfuerzos de extremo (H15).
- Modificadores de axil, torsión y flexión (H47).

**Muelles:**
- muelle 6×6 a tierra, en ejes globales o locales;
- muelle lineal entre dos nudos con triedro;
- apoyos con desplazamiento impuesto.

### 2.3 Restricciones: todas por transformación

Formulación u = T·û (Felippa, *IFEM*, caps. 8–9): kₑ' = Tₑᵀ·kₑ·Tₑ antes de dispersar, F' = Tᵀ·F, y u = T·û al recuperar. Sin penalización: desaparecen los barridos de α (S5 #4) y el cond(K) de 2,3e6 (H07).

**Diafragma por planta:**
- maestro con 3 GDL (ux, uy, rz) en el centro de masas;
- cada esclavo cumple ux = uxm − (y − ym)·θ, uy = uym + (x − xm)·θ y rz = θ;
- tres modos por planta: rígido, semirrígido (membrana con f11/f22/f12) o ninguno;
- aviso de que el axil de las vigas no es representativo (H07).

**Enlace rígido** (u_s = u_m + θ_m × r; θ_s = θ_m). Se usa para:
- la huella del pilar (H09);
- el brazo de una viga en el plano de un muro, a lo largo de su canto. Sustituye a la barra embebida de H05: el drilling da equilibrio y rigidez, pero la unión en un solo nudo sigue siendo singular.

**Reglas de consistencia:**
- Las cadenas (huella → cabeza de pilar → diafragma) se resuelven en orden topológico.
- Un ciclo o un GDL esclavo de dos restricciones es un error con diagnóstico.
- No se admiten apoyos sobre GDL esclavos.
- Los GDL sin rigidez se restringen automáticamente, con un aviso.

### 2.4 Forjados (requisitos 2 y 3)

**Unidireccional.** El paño es un objeto físico con dirección e intereje. El compilador:
- genera una vigueta-barra por intereje, entre apoyos, con la T bruta de la tipología y la torsión liberada;
- crea nudos en los cruces con vigas y muros;
- convierte la carga superficial en lineal, q·intereje;
- reparte cargas lineales y puntuales a la palanca entre las dos viguetas vecinas;
- asigna la franja de borde a la viga de borde.

El diafragma rígido es obligatorio, porque no hay membrana. El modelo queda pequeño: con intereje de 0,70 m salen unos 2 900 m de vigueta por planta, ≈ 600 barras (est.).

El motor ya da M+, M− y V por vigueta. Falta el consumidor: `calcForjados` sólo cubre reticular y maciza.

**Reticular.** Lámina con el canto total h y multiplicadores sobre la maciza. Los ejes 1-2 siguen los nervios, y los datos salen de `forjadoTipologias.ts` (h, hf, bw, s):

| Multiplicador | Cálculo |
|---|---|
| m11 = m22 | I_T/(s·h³/12) con la T bruta (≈ 0,3 en 30+5, H46), o 0,5 «tipo CYPE» (D3) |
| m12 | Torsión de la capa + ½·C_nervio/s, frente al D_xy de la maciza (T&WK, cap. 11, placas nervadas) |
| f11 = f22 | (s·hf + bw·(h − hf))/(s·h) |
| f12 | ≈ hf/h |
| v13 = v23 | ≈ bw/s |
| Peso y masa | w = pp_zona/(γ·h), desde `PubZonaCargas.pp` (H24) |

- **Cómo se aplican:** D' = S·D·S con S = diag(√f11, √f22, √f12), y lo mismo para m y v. Conserva la simetría y la definición positiva. Falta confirmar con un modelo del usuario que coincide con la semántica de SAP2000; la documentación de CSI no lo precisa.
- **Ábacos y zonas macizas:** regiones con multiplicador 1, con su contorno sembrado en el mallador (H29) y la huella del pilar con enlace rígido.
- **Resultados:**
  - ya incluyen los multiplicadores, porque son esfuerzos en equilibrio;
  - Mx·intereje por nervio alimenta `calcForjados`.
- **Hipótesis visible:** se ignora la excentricidad entre el centro de gravedad de la T y el plano medio, como hace SAP.

### 2.5 Cargas
- **Superficie:**
  - presión consistente por elemento, con Gauss 2×2; da lo mismo que p·A/4 (H24);
  - las zonas que no siguen la malla se recortan con clipper2-js o se siembran en el mallador.
- **Línea y puntual:**
  - en láminas, en cualquier punto mediante Nᵢ(ξ, η)·P;
  - en barras, exactas en el vano y sin trocear (H11).
- **Peso propio:**
  - barras: γ·A, descontando el solape con la losa (H24);
  - láminas: con el multiplicador de peso.
- **Temperatura (opcional):** ΔT y gradiente.
- **Trazabilidad:** `loadId` por fuerza, y ΣF analítica = ΣF física a 1e-9 (H24).

### 2.6 Recuperación de esfuerzos
- **Desplazamientos y reacciones** por caso, en `Float64Array` (H27, H36), con las fuerzas en los enlaces rígidos (cabeza de pilar).
- **Barras:** esfuerzos en la cara del tramo flexible y en el nudo; diagramas cerrados.
- **Láminas:** N y M en los puntos de Gauss y en el centroide (H10), girados a los ejes de usuario.
- **Qx/Qy de lámina (H18):**
  - para comprobar, corte por fuerzas nodales de elemento fₑ = kₑ·uₑ − f_eq a lo largo de una línea: cierra el equilibrio exactamente y es lo que hace SAFE en franjas (H25);
  - para los mapas, SPR de Zienkiewicz–Zhu (*IJNME* 33, 1992) y Q = ∂M/∂x;
  - objetivo: error ≤ 5 % con h/t ≈ 2 (S5 #3).
- **Equilibrio:** ΣF y ΣM a 1e-9 son error duro. Con drilling real, ΣM deja de ser sólo un aviso (H37).

### 2.7 Solver
- **Ensamblado:** K en CSC, triángulo superior, con el patrón simbólico calculado una sola vez.
- **Ordenación:** se calculan dos y se queda la que dé menos nnz(L):
  - AMD, que ya trae `faer`;
  - disección anidada geométrica por plantas, hecha en TypeScript.
- **Factorización:** LDLᵀ supernodal. Un pivote nulo o negativo se traduce a GDL, nudo y objeto físico, como diagnóstico de mecanismo (H12).
- **Resolución:** las 24 combinaciones como un bloque de lados derechos. Residuo ≤ 1e-10, con refinamiento iterativo si no se alcanza.
- **Modal (opcional):** iteración en subespacios sobre la misma factorización (Bathe, *Finite Element Procedures*, cap. 11). Sirve para la NCSE-02 y para el αcr de H32.
- **Referencia en TypeScript:** perfil COLSOL con RCM, unas 300 líneas.
  - Para tests y modelos de ≤ 30 000 GDL.
  - Diferencial frente a `faer` a 1e-12.

### 2.8 Tamaño del req. 4 (est.)

Estimación con disección anidada por planta en malla 2D (George 1973): nnz(L) ≈ 3,9·N·log₂N·b² y flops ≈ 10·N^1,5·b³.

| Escenario | Nudos | GDL | Memoria de L | Flops | Factorización en WASM |
|---|---|---|---|---|---|
| Típico: malla de 0,6 m y diafragma rígido | ~40 000 | 130 000–150 000 | 0,15–0,3 GB | ~1e9 | 0,5–2 s |
| Tope con diafragma rígido | 90 000 | ~290 000 | 0,35–0,5 GB | ~3e9 | 2–5 s |
| Tope semirrígido | 90 000 | ~540 000 | 1,2–1,5 GB | ~2e10 | 8–20 s, sólo sobremesa |

Palancas para bajar el coste:
- el diafragma rígido;
- malla por vano (H10) en lugar de un tamaño fijo;
- factorizar en f32 y refinar en f64;
- límite en GDL según el dispositivo (D9, H16).

## 3. Arquitectura: las tres vías

Todo es estimación (est.), salvo la columna de Pyodide, que está medida en H04, H20 y H26.

| | (i) TS puro | (ii) Rust/WASM entero | (iii) Híbrido TS + núcleo `faer` | Pyodide + PyNite |
|---|---|---|---|---|
| Descarga | +80–150 KB gz | 0,5–2 MB | 0,3–1,5 MB + 80–150 KB | 23–29 MiB |
| Arranque | ~0 | 30–150 ms | 30–150 ms | 4–6 s |
| Ensamblado de 40 000 quads | 1–3 s | 0,2–0,6 s | 1–3 s | ~18 s con 4 810 nudos |
| Factorización de 150 000 GDL | 3–15 s supernodal; 20–60 s de perfil | 0,5–3 s | 0,5–3 s | No cabe (H16) |
| Cancelación | Mensaje entre fases | `terminate` + ~0,1 s | `terminate` + ~0,1 s | `terminate` + 5 s |
| Tooling | bun y vitest | Rust en 2 máquinas y en CI | Rust sólo para el núcleo; artefacto versionado | Vendor + scipy |
| Depuración | devtools y vitest | `cargo test`; DWARF en el navegador | Elementos fáciles; núcleo como caja negra | Python a través de Pyodide |
| Mantenimiento por 1–2 personas | Alto (supernodal propio) | Alto (dos lenguajes para todo) | Bajo–medio | Dependencia externa (H22) |

**Se elige la (iii).** Los errores de un motor FEM están en los elementos, los signos y las restricciones: esa parte va en TypeScript, con vitest. El solver es la única pieza donde manda el rendimiento.

**`faer`:**
- licencia MIT;
- Cholesky LLᵀ/LDLᵀ supernodal y simplicial;
- AMD propia.

**Por qué se descartan las otras bibliotecas:**
- CHOLMOD: su parte supernodal es GPL;
- MUMPS: Fortran, y pesado;
- Eigen: sin CHOLMOD sólo tiene versión simplicial;
- `sprs-ldl`: sólo simplicial.

**Núcleo y entorno:**
- **API:** unas 5 funciones (patrón, factorizar, resolver un bloque, inercia y pivotes, liberar), con la versión fijada.
- **Hilos:** un solo hilo, porque GitHub Pages no tiene SharedArrayBuffer (H20). Falta verificar que SIMD128 vectoriza en wasm32.
- **Toolchain:** en esta máquina no hay `cargo` ni `rustc`. Hacen falta `rustup`, el target `wasm32-unknown-unknown`, `wasm-bindgen-cli` fijado y `wasm-opt`. En Windows, además, MSVC Build Tools o el toolchain gnu para las proc-macros.

**Para que la otra persona no necesite Rust:**
- el `.wasm` y su código de enlace se versionan con sha256 en `src/lib/fem3d/kernel/pkg/`, siguiendo el patrón de `scripts/vendor-pyslope.mjs`;
- husky y `test:run` no tocan Rust;
- un job de CI con `rust-toolchain.toml` recompila y compara el hash sólo si cambia `kernel/`.

**Plan B:** si `faer` falla en E0, un supernodal propio en TypeScript (+3–5 semanas) o bajar el tope de tamaño.

## 4. Qué vale igual y qué cambia

| Pieza | Con motor propio |
|---|---|
| Compilador (H19, H23, H28, H33) | Igual. Cambia lo que emite: offsets, enlaces y diafragma reales en lugar de barras auxiliares de penalización (H05, H07, H09). Añade las viguetas (req. 2) y los multiplicadores (req. 3). El rol `auxiliar` queda para muelles y enlaces |
| Mallador (H29, H17, H10) | Igual: triangulación dividida en quads y rejilla en los muros. Se añaden semillas en ábacos, huellas y líneas de vigueta. Los 8 elementos por paño de muro (H17) se pueden relajar tras medir la membrana ITW |
| Combinaciones (H21, H30–H32) | Igual |
| Resultados (H25, H27, H34–H36) | Igual. H15 desaparece, H01 y H02 pasan a ser el convenio nativo, y H18 se resuelve dentro del motor |
| Visor (H41–H45) | Igual |
| Plataforma | H14 y H26 desaparecen: ni scipy ni 29 MiB. H20 se simplifica y H16 se mitiga. Un solo worker en TypeScript compila y resuelve |
| Validación (H37–H40, H48) | Misma pirámide y mismo catálogo. `frozen/` pasa al motor propio y los golden no cargan Pyodide. Oráculos: PyNite en CPython (DKMQ y barras de Euler-Bernoulli), OpenSeesPy (`ASDShellQ4`, `rigidDiaphragm`, `rigidLink`, `ElasticTimoshenkoBeam`), Kratos y los modelos SAP2000 del usuario |
| Diseño técnico | ADR-010 pasa a un ADR de «motor propio». §5.1 a kN–m. §8 añade offsets, `insertionPoint`, multiplicadores de lámina, restricciones reales y muelles. El contrato del §9 se mantiene (adaptador propio + Mock + Replay). Se sustituyen §9.1, §10.1, §14 (un solo worker) y §20 |

## 5. Esfuerzo, riesgos y validación

**Esfuerzo por fases** (semanas-persona):

| Fase | Contenido | Semanas |
|---|---|---|
| E0 Spike | Portar la DKMQ a TypeScript, membrana ITW en un muro, microbench de `faer`-WASM frente al solver de perfil con mallas sintéticas de edificio, y Rust en Windows y en CI | 2–3 |
| E1 Núcleo | GDL, restricciones con cadenas, apoyos, muelles, CSC, solver de perfil, ΣF/ΣM y diagnósticos de pivote | 2–4 |
| E2 Barras | Timoshenko, offsets, punto de inserción, liberaciones, FER, diagramas y `seccion3D()` | 2–3 |
| E3 Láminas | DKMQ24 con multiplicadores, cargas, resultantes y giro a ejes de usuario | 3–5 |
| E4 Núcleo WASM | Crate, API, artefacto, CI reproducible, worker y memoria | 2–3, en paralelo con E2–E3 |
| E5 Q y bandas | SPR y corte por fuerzas nodales; hacen falta con cualquier motor | 1–2 |
| E6 Endurecimiento | ETABS 15, SAP 1-024, SAP2000 del usuario, pruebas metamórficas y rendimiento | 2–4 |
| E7 Opcional | Modal, temperatura y triángulos | 2–6 |

- El núcleo (E0–E6) suma **14–24 semanas**.
- El S1 dura 18–32 semanas e incluye 5–10 semanas específicas de PyNite.
- Total con motor propio: **≈ 26–42 semanas-persona**.

**Riesgos:**
1. Errores silenciosos de formulación (signos, φ anisótropa, drilling).
2. Toolchain de Rust y WASM en Windows y en CI. Mitigación: artefacto versionado y solver TypeScript de reserva.
3. Memoria al tamaño tope y en iOS (300 MB–1 GB, H16). Mitigación: límites por dispositivo, diafragma rígido y f32.
4. Restricciones encadenadas y casos degenerados.
5. Semántica de los multiplicadores frente a SAP2000.
6. Mantenimiento: el motor pasa a ser responsabilidad de Concreta. El riesgo de proveedor de H22 se convierte en riesgo propio; la red de seguridad es documentar las formulaciones y mantener la batería.
7. Crecimiento del alcance (modal, P-Delta, triángulos).

**Validación, por niveles:**
1. **Elemento:**
   - 6 modos rígidos y simetría a 1e-15;
   - patch tests de MacNeal–Harder (membrana 1 333/400; flexión 1,111e-7 y 3,333e-8, H48);
   - viga recta de MacNeal–Harder (0,1081 y 0,4321);
   - rotación rígida en el plano sin energía.
2. **Diferencial:**
   - DKMQ propia frente a `Quad3D` en flexión pura, ≤ 1e-10;
   - barras con Φ = 0 frente a PyNite, ≤ 1e-11 (H11);
   - solver de perfil frente a `faer`, ≤ 1e-12.
3. **Analítico:**
   - placas de T&WK y Taylor–Govindjee con las tolerancias de H37;
   - placa de Morley;
   - placa ortótropa de Navier (T&WK, cap. 11), que prueba m11 ≠ m22;
   - Scordelis-Lo (0,3024);
   - cilindro pellizcado y hemisferio.
4. **Casos de CSI:**
   - SAP 1-004, 1-018 (2,77076 in con cortante), 1-022 y 1-024;
   - ETABS 15a/c/d, que cierra S5 #1;
   - SAFE 1-7.
5. **OpenSeesPy:** los modelos de H05, H07 (exacto: 1,7166/0,3881 mm) y H09. Kratos para láminas.
6. **SAP2000 del estudio:** un reticular con ábacos y los mismos multiplicadores, y un unidireccional con viguetas. Se comparan reacciones, momentos de vigueta e integrales de banda (H46).
7. **Metamórficas de H38**, en cada edificio, a 1e-9.
8. **Rendimiento:** edificios sintéticos de 20 000, 40 000 y 90 000 nudos en los dispositivos de S5 #2.

## 6. Comparación con seguir con PyNite

**Lo que cuestan los *workarounds* ya documentados** (semanas-persona):

| Trabajo | Hallazgos | Semanas |
|---|---|---|
| Driver, operador de resultados y tests contractuales sobre internos | H04, H15, H22 | 1,5–2,5 |
| Ejes, ángulo de barra y signos | H01, H02, H08 | 1–1,5 |
| Barras embebidas, zona rígida y diafragma por penalización, con sus barridos de α | H05, H07, H09 | 1,5–3 |
| scipy sin conexión, ciclo de vida del worker y cancelación | H16, H20, H26 | 1–2 |
| Parche del drilling, si ETABS 15d da > 2 % | D10 | 0–3 |
| Vendor fijado y batería mensual contra HEAD | H22 | 0,5–1 |
| **Total** | | **≈ 5,5–13** |

**Aun así, PyNite no cubre los requisitos nuevos:**
- el reticular con multiplicadores exige un fork de `Quad3D`;
- las viguetas-barra dependerían de un diafragma por penalización;
- 20 000–90 000 nudos no se alcanzan con ningún *workaround*: el tiempo está en `ke` y FER en Python puro, y la memoria en SuperLU dentro de un heap de 4 GiB (H04, H16).

**Cuándo conviene cada opción:**
- **PyNite:**
  - un MVP con edificios de ≤ 1 500–5 000 nudos;
  - maciza y reticular como lámina isótropa equivalente;
  - unidireccional como paño de reparto;
  - con la fecha como prioridad.

  En cualquier caso, PyNite sigue siendo útil como oráculo offline.
- **Motor propio:**
  - si los requisitos 2–4 son firmes;
  - para uso diario con edificios reales;
  - con instalación sin conexión ligera.

  Hay que asumir 6–12 semanas netas más y el mantenimiento de unas 10–15 mil líneas de TypeScript y unas 500 de Rust.
- **No conviene** hacer primero el adaptador de PyNite para cambiarlo luego: se perderían las 5–13 semanas de *workarounds*. Lo que sí se comparte es el núcleo agnóstico de la Fase 1 de S1, que puede empezar ya, en paralelo al spike E0.

## Ficheros críticos
- `docs/fem3d/diseno-tecnico.md`: §5.1, §8, §9, §10, §14, §20 y ADR-010.
- `src/lib/frame-core/sections.ts`: base de `seccion3D()` y de E.
- `src/features/fem2d/solver2d.ts`: patrón de convenio de signos, recuperación y FEQ.
- `src/data/forjadoTipologias.ts`: entrada de los multiplicadores del reticular.
- `src/features/cargas-planta/state.ts`: `PubZonaCargas`, con el peso propio y el tipo de forjado.
