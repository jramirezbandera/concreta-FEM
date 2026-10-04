# CLAUDE.md — Concreta FEM 3D (motor propio)

## Qué es
- **Repositorio:** público y personal de jramirezbandera (público por decisión del usuario, 2026-10-04), para desarrollar el módulo FEM 3D de Concreta con un **motor de cálculo propio**.
- **Origen:** se empezó de cero el 2026-10-03. La app que había antes en este repo (interfaz tipo CYPECAD sobre PyNite) se descartó y no se reutiliza.
- **Destino final:** integrarse en Concreta (`wh0am1-dev/concreta`, clon en `../Concreta EST/concreta-v2`) para que sus resultados alimenten los módulos de comprobación.
  - Esa integración será un PR revisado por wh0am1, y sólo cuando el usuario lo decida.
  - Hasta entonces, nada de este repo toca producción.

## Antes de nada: la investigación
- **`docs/fem3d/investigacion-id.md`:** 57 hallazgos (H01–H57) y 8 síntesis (S0–S7).
  - **No lo cargues entero.** Lee el índice (líneas 1–100) y luego sólo la sección que necesites, por su rango de líneas o con `grep -n "^## H49 " docs/fem3d/investigacion-id.md`.
  - Lo esencial está en S0 (veredicto), S2 (decisiones) y S7 (arquitectura del motor, spike y fases E0–E7).
- **`docs/fem3d/diseno-tecnico.md`:** el diseño v0.1 del usuario. S3 lista lo que la investigación cambia de él.
- **`docs/fem3d/investigacion/`:** los 8 informes completos y los scripts de los experimentos.
- **Antes de diseñar o investigar algo,** mira si la investigación ya lo cerró.

## Decisiones tomadas (S2)
- **D1 – Unidades:** kN–m, como Concreta (E en kN/m²).
- **D2 – Forjado unidireccional:** se introduce como paño con reparto de cargas, pero se discretiza en viguetas como barras y se ven los esfuerzos por vigueta.
- **D3 – Reticular:** multiplicadores por dirección sobre la losa maciza (f11…v23 y peso), calculados a partir de nervios y casetones. Los ábacos van macizos, con multiplicador 1. Hay que validarlo contra un modelo de SAP2000 del usuario.
- **D4 – Modificadores de rigidez (2026-10-04):** por defecto, axil de todos los pilares ×2 y torsión de las vigas de hormigón ×0,1, por material (`MODIFICADORES_D4`); la flexión no se toca. Con ellos, el factor de zona rígida por defecto pasa a 0,5 (C1-a). Medidas en `validacion/c1/out_decisiones.txt`.
- **D5 – Bandas de dimensionado de las losas:** automáticas y editables. El compilador propone las del Ap. I del CE A19 a partir de los ejes de los pilares, y el usuario puede moverlas, cambiar su anchura, partirlas o añadir otras. Sus bordes y las caras de los apoyos se siembran en la malla (E5-5), así que editar una banda obliga a recalcular.
- **D9 – Tope de tamaño:** unas 7 plantas con 80 pilares por planta, que en sobremesa son ≈ 50 000 nudos y 300 000 GDL. El límite se fija en GDL según el dispositivo.
- **D11 – Motor propio:**
  - TypeScript para elementos, restricciones, ensamblado y recuperación de esfuerzos;
  - un núcleo en Rust con `faer`, compilado a WASM, sólo para la factorización LDLᵀ supernodal;
  - el spike E0 hace de puerta;
  - el plan B, ya medido, es numpy vectorizado + SuperLU en Pyodide (H51).

## Reglas de oro
1. **Validar antes que avanzar.** El usuario firma los cálculos, y un fallo silencioso es lo peor que puede pasar. Ningún elemento, restricción o tipo de carga entra sin:
   - test contra un oráculo: PyNite para DKMQ y barras; OpenSeesPy o Kratos; soluciones analíticas; casos de CSI (H48);
   - tests de propiedades: modos de sólido rígido, simetría y patch tests;
   - un fixture congelado.
2. **Equilibrio en cada cálculo, no sólo en los tests.** ΣF y ΣM entre cargas y reacciones tienen que cuadrar a 1e-9 relativo. Si no cuadran, el resultado es un error y nunca se presenta como válido.
3. **Motor puro.** Sin React, sin DOM y sin IO: entra el modelo analítico y sale un `Float64Array` por caso. Así se podrá mover a Concreta tal cual.
4. **Restricciones por transformación** maestro-esclavo, nunca por penalización.
5. **Convenio de signos tipo CSI nativo,** escrito en la cabecera del motor (H02).
6. **Licencias:**
   - sólo MIT, BSD, Apache-2.0, MPL-2.0 o ISC (equivalente a MIT; admitida el 2026-10-04 para el mallador de C2: delaunator y constrainautor, H29);
   - no usar ni copiar código de OpenSees, xara, stabileo (AGPL), CHOLMOD Supernodal (GPL) ni Triangle (H54);
   - lo que se porte de PyNite o de hekatan-struct-lineal (MIT) se cita en `NOTICE`.
7. **No se usa para calcular de verdad** hasta que pase la batería de validación y un periodo «en sombra»: los mismos proyectos reales calculados también con SAP2000 o CYPE, para comparar.

## Flujo de trabajo
- **Commits:** es un proyecto personal, así que se trabaja en `main`, con commits pequeños por tema y mensajes en español. No hay PR, revisor ni despliegue.
- **Herramientas,** como en Concreta: bun como único gestor de paquetes, TypeScript estricto y vitest.
- **Rust** sólo en el núcleo (`kernel/`). El `.wasm` se versiona con su sha256 para que el resto del repo no necesite Rust.
- **Independencia:** el motor no depende de Concreta. Lo que haga falta de allí más adelante (secciones, tipologías de forjado, combinaciones) se copia citando el fichero de origen; nunca se importa desde `../Concreta EST/concreta-v2`.

## Estado
- **2026-10-03:** repo reiniciado con la investigación.
- **2026-10-03:** Rust instalado y la cadena probada de extremo a extremo (crate → `.wasm` → `wasm-bindgen` → `wasm-opt` → bun):
  - Rust 1.99.0, toolchain `stable-x86_64-pc-windows-msvc` con el target `wasm32-unknown-unknown`, sobre Visual Studio Build Tools 2026 (carga C++).
  - `wasm-bindgen-cli` 0.2.129: tiene que coincidir con la versión del crate `wasm-bindgen` del `Cargo.lock`.
  - `wasm-opt` 133 (binaryen), en `%USERPROFILE%\.local\binaryen-version_133\bin`. Necesita `--enable-bulk-memory --enable-nontrapping-float-to-int`, porque rustc ya emite esas extensiones.
  - Se descartó el toolchain `x86_64-pc-windows-gnu`: al `dlltool` que trae le falta el ensamblador, y eso rompe `windows-sys` y `getrandom` en el host.
- **2026-10-03: spike E0 superado.** Pasan los cuatro criterios de S7. El informe está en `docs/fem3d/spike-e0.md`, con resultados, hallazgos E0-1…E0-8 y pendientes.
  - **Ya en `src/`:** núcleo WASM (`src/nucleo/`), DKMQ, membrana con drilling y lámina (`src/elementos/`), y solver de perfil (`src/solver/`).
  - **Herramientas de prueba:** `src/pruebas/` y los benches y oráculos en `spike/e0/`.
  - **El núcleo** se compila con `bun run nucleo:compilar` y se verifica con `bun run nucleo:verificar` (sha256 reproducible). No se edita `src/nucleo/pkg/` a mano.
  - **Oráculos:** PyNite 3.2.0 en `.venv` (Python 3.14); OpenSeesPy 3.8 en `.venv312` (Python 3.12: con 3.14 no carga en Windows).
  - **Cerrado en E4:** el CI (`.github/workflows/ci.yml`) está en verde y se midió un iPhone 13 Pro (`docs/fem3d/fase-e4.md`, §6).
- **2026-10-03: fase E1 superada** (núcleo del motor). Pasan los cinco criterios. El informe está en `docs/fem3d/fase-e1.md`, con criterios, hallazgos E1-1…E1-8 y pendientes.
  - **Ya en `src/motor/`:** modelo analítico (convenios en la cabecera de `modelo.ts`), GDL con diafragma rígido y enlace rígido por transformación (cadenas incluidas), patrón CSC fijo, mecanismos por pivote con su modo, refinamiento por error hacia atrás y ΣF/ΣM ≤ 1e-9 en cada cálculo. Se usa con `calcular(modelo)`.
  - **Validación:** `validacion/e1/` (oráculo OpenSeesPy, banco del edificio objetivo, margen de pivotes). Las cadenas se validan sólo contra el `Lagrange` de OpenSees, porque su `Transformation` las resuelve mal (E1-1).
  - **Fase 1 de S1, en paralelo** (otra sesión, ya en `main`): generador de combinaciones CTE/NCSE (`src/combinaciones/`, `docs/fem3d/combinaciones.md`) y Wood–Armer (`src/dimensionado/`).
- **2026-10-03: fase E2 superada** (barras). Pasan los cinco criterios. El informe está en `docs/fem3d/fase-e2.md`, con criterios, hallazgos E2-1…E2-7 y pendientes.
  - **Ya en `src/`:**
    - barra de Timoshenko con offsets rígidos, liberaciones por condensación y modificadores (`src/elementos/barra.ts`);
    - cargas de barra con FER exactas y diagramas cerrados (`cargasBarra.ts`, `tramos.ts`);
    - la barra en el motor (`src/motor/barras.ts`: esfuerzos de extremo por caso y `DiagramasBarras`);
    - `seccion3D()` (`src/secciones/`).
  - **Convenio de signos de barra** en la cabecera de `modelo.ts` (H02, con la correspondencia con SAP2000).
  - **Validación:** `validacion/e2/` (oráculos PyNite y OpenSeesPy, pruebas metamórficas, banco y referencia congelada). La `ElasticTimoshenkoBeam` de OpenSees 3.8 aplica mal `-jntOffset` (E2-1): los offsets de Timoshenko se validan con `rigidLink`.
- **2026-10-04: fase E3 superada** (láminas). Pasan los seis criterios. El informe está en `docs/fem3d/fase-e3.md`, con criterios, hallazgos E3-1…E3-6 y pendientes.
  - **Ya en `src/`:**
    - DKMQ24 con sección general y φₖ anisótropa, y membrana con C general (`src/elementos/`);
    - lámina formulada en ejes de usuario (eje 3 por el orden de los nudos; eje 1 = `eje1` proyectado o la regla de CSI) con multiplicadores f11…v23 como D' = S·D·S (`lamina.ts`);
    - la lámina en el motor (`src/motor/laminas.ts`): cargas de superficie, línea y puntuales con el equilibrio sobre su resultante real, `esfuerzosLaminas` en el centroide y `ResultantesLaminas`.
  - **Convenio de láminas** en la cabecera de `modelo.ts` (H02: F11…V23 de CSI).
  - **Validación:** `validacion/e3/` (oráculo PyNite con resultantes giradas en Python, Navier ortótropa, benchmarks de H48, metamórficas, banco y referencia congelada).
  - **Abierto:** la semántica de los multiplicadores frente a SAP2000 (S5 #21) necesita un modelo del usuario; la propuesta está en «Pendiente» del informe.
- **2026-10-04: fase E4 superada** (núcleo WASM, worker y memoria), con el CI en verde en GitHub. El informe está en `docs/fem3d/fase-e4.md`, con criterios, hallazgos E4-1…E4-8 y pendientes.
  - **Núcleo API 2:** `memoriaRequerida(nrhs)` y `memoriaEnUso()`. El motor rechaza antes de factorizar lo que no cabe (`limites`, diagnóstico `modelo/demasiado-grande`) y avisa del avance con `alProgreso`.
  - **Ya en `src/worker/`:** protocolo propio (sin Comlink), atendedor común a navegador y Node, y `ClienteMotor`:
    - el núcleo se compila una vez;
    - los resultados vuelven por Transferable;
    - cancelar es `terminate` y volver a calentar (~10 ms);
    - el worker se recicla tras cada cálculo (E4-1: la memoria es sobre todo JS y el worker no puede medirla);
    - límites provisionales por perfil de dispositivo.
  - **Validación:** `validacion/e4/`. El banco en Chrome (`chrome.ts`) da los mismos bits que Node. Su modo `--dispositivos` mide en el móvil: un iPhone 13 Pro calcula el edificio objetivo, también el semirrígido, tan rápido como el sobremesa, y difiere de Node a ≤ 3,1e-12 (E4-6, E4-9). El perfil móvil queda en 200 000 ecuaciones y 512 MiB; falta un móvil con menos memoria.
- **2026-10-04: fase E5 superada** (Q y bandas). Pasan los seis criterios. El informe está en `docs/fem3d/fase-e5.md`, con criterios, hallazgos E5-1…E5-7 y pendientes.
  - **Ya en `src/motor/`:**
    - `FuerzasNodales`: g = k·u − f_eq por elemento y fuerzas de cada restricción sobre sus nudos (cadenas resueltas desde las hojas);
    - `Cortes`: esfuerzos [N, Vy, Vz, T, My, Mz] que atraviesan un plano recortado a un rectángulo, con el convenio de las barras. «fuerzas-nodales» es exacto y exige que el corte siga la malla; «campos» es mixto (campos sólo en las láminas que atraviesa) y da muestras para Wood–Armer;
    - `CamposLaminas`: SPR por centroides con parches de dos coronas y Q por equilibrio, por regiones (las huellas quedan fuera).
  - **S5 #3 cerrada:** el Q recuperado converge con orden 2 sin depender del espesor (−1,8 % con 16 elementos por vano).
  - **Para el compilador (E5-5):** sembrar en la malla las caras de los apoyos y los bordes de las bandas. En las caras, la banda se dimensiona con el corte por fuerzas nodales.
  - **Validación:** `validacion/e5/` (oráculo de equilibrio de los cortes, réplica de exp01d, Navier, losa plana de H25, banco y referencia congelada).
- **2026-10-04: fase E6 superada** (endurecimiento). Pasan los cinco criterios; el 2, con la referencia corregida. El informe está en `docs/fem3d/fase-e6.md`, con criterios, hallazgos E6-1…E6-10 y pendientes.
  - **Validación con CSI:** SAP2000 1-004, 1-018, 1-022 y 1-024 dan sus 34 valores publicados (los periodos, por condensación exacta, sin modal).
  - **ETABS 15 con láminas:** el motor coincide con `ASDShellQ4` a ≤ 0,5 %, así que S5 #1 y #18 quedan cerradas. Las diferencias con SAP2000 en 15b, 15c y 15d son de su modelado (E6-2), y E6-3 y E6-4 son decisiones para el compilador.
  - **Ya en `src/pruebas/`:** generador de modelos aleatorios (`aleatorio.ts`), batería metamórfica de 9 relaciones (`metamorficas.ts`), catálogo de 83 entradas no válidas (`invalidos.ts`) y periodos por condensación (`modal.ts`).
  - **Motor:**
    - nunca lanza por un dato del modelo (`motor/error-interno` para lo inesperado; sólo se propagan las trampas del WASM);
    - dos fallos silenciosos corregidos (E6-7);
    - memoria JS un 41–45 % menor con los mismos bits (E6-8);
    - 88 000 nudos en 11–23 s en sobremesa.
  - **Puente con SAP2000** (`validacion/e6/sap2000/`, LEEME.md): importador de modelos $2k, comparador de resultados y la placa de Navier de S5 #21 lista para importar.
- **2026-10-04: D5 tomada** (bandas automáticas y editables).
- **2026-10-04: placa de Navier calculada en SAP2000 v21** (E6-11). SAP2000 aplica los multiplicadores de flexión como el motor (D3 validada en flexión), pero sus cortantes de Shell-Thick se separan de la solución exacta hasta un 21 %; los del motor, ≤ 0,9 %.
- **2026-10-04: fase C1 del compilador superada** (barras). Pasan los ocho criterios. El plan del compilador está en `docs/fem3d/compilador.md` (fases C1–C5) y el informe, en `docs/fem3d/fase-c1.md`, con criterios, hallazgos C1-1…C1-5 y pendientes.
  - **Ya en `src/compilador/`:**
    - modelo físico: plantas de arriba abajo con su altura, como `lib/edificio`; pilares, vigas en polilínea, apoyos y cargas (convenios en la cabecera de `fisico.ts`);
    - topología con dos tolerancias (H28), nudos de dimensión finita por offsets, diafragma por planta, cargas sin pérdidas, mapeo y huella.

    Se usa con `compilar(fisico)`. `traducirDiagnosticos` y `EsfuerzosPiezas` devuelven diagnósticos y esfuerzos a las piezas físicas.
  - **Regla del compilador:** la geometría dibujada no se mueve nunca. Las tolerancias deciden la conectividad, y el hueco hasta el nudo es un offset rígido.
  - **Validación:** `validacion/c1/` (1-022 como modelo físico, modelos hechos a mano, metamórficas, huellas V8/JSC, banco y referencia congelada).
  - **Valores por defecto, decididos por el usuario el 2026-10-04:**
    - C1-a: factor de zona rígida 0,5;
    - C1-c: eje de la viga en el plano del forjado (C1-5 lo mide);
    - C1-d: diafragma rígido salvo en la planta más baja;
    - D4: axil de pilares ×2 y torsión de vigas de hormigón ×0,1.

    El compilador pasa a la versión C1.1 y deja estas hipótesis en `hipotesis`.
- **Siguiente paso:**
  - el usuario calcula en SAP2000 las tres variantes de Navier que separan el cortante y luego sus modelos (pasos en `validacion/e6/sap2000/LEEME.md`);
  - compilador C2 (losas), con delaunator + constrainautor (ISC, admitida);
  - más adelante: medir un móvil con menos memoria que el iPhone 13 Pro (E4-9) y E7 (modal, temperatura, triángulos).
- **Mantenimiento:** actualizar esta sección cuando cambie la fase.
