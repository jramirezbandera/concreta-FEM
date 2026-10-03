# CLAUDE.md — Concreta FEM 3D (motor propio)

## Qué es
- **Repositorio:** privado y personal de jramirezbandera, para desarrollar el módulo FEM 3D de Concreta con un **motor de cálculo propio**.
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
   - sólo MIT, BSD, Apache-2.0 o MPL-2.0;
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
  - **Pendiente:** ver el CI (`.github/workflows/ci.yml`) en verde tras un push y medir en móvil.
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
- **Siguiente paso:** E3 (láminas: DKMQ24 con multiplicadores, cargas, resultantes y giro a ejes de usuario).
- **Mantenimiento:** actualizar esta sección cuando cambie la fase.
