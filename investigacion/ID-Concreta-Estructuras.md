# I+D · Concreta · Estructuras — Documento maestro de investigación

> **Qué es esto.** Síntesis de la fase de investigación para construir la app FEM de cálculo estructural para arquitectos (React+TS+Vite · PyNite sobre Pyodide/WASM · interfaz CYPECAD · modelo de dos capas). Producido por 5 agentes de investigación en paralelo + 5 agentes de verificación adversarial independientes (segunda pasada anti-alucinación).
> **Fecha:** 2026-06-20.
>
> **Cómo usar este documento.** El **índice por prioridad** de abajo ordena los hallazgos por _soporte × impacto_: lo más sólido y consecuente, primero. Cada entrada apunta al fichero de detalle. **Las sesiones futuras deben cargar solo la sección que necesiten**, no todo el corpus. Los documentos de área (`/investigacion/areas/0X-*.md`) y sus verificaciones (`/investigacion/verificacion/0X-verif-*.md`) contienen el detalle con `claim / rationale / sources(URL) / confidence` por afirmación.

---

## Estado de verificación (2ª pasada)

| Área                           | Verificadas | Refutadas | Matizadas    | No confirmables | Confianza global             |
| ------------------------------ | ----------- | --------- | ------------ | --------------- | ---------------------------- |
| 1 · Motor FEM (Pyodide/PyNite) | 22          | 2         | 5            | 2               | **Alta**                     |
| 2 · Discretizador              | 11          | 0         | 2            | 0               | **Alta**                     |
| 3 · Frontend CAD/3D            | 8           | 0         | 3            | 0               | **Alta**                     |
| 4 · Dominio y normativa        | 9           | 1         | 0            | 0               | **Alta** (tras corregir Ecm) |
| 5 · Persistencia y testing     | 12          | 0         | 0 (críticas) | 2 (2as)         | **Alta**                     |

**Veredicto:** ninguna conclusión estratégica cae. Una sola corrección de cálculo (Ecm del hormigón) ya aplicada. Las APIs citadas (R3F, drei, Zustand, Dexie, Zod, Vitest, PyNite) se confirmaron contra fuente primaria; **no se encontró ninguna API inventada**.

---

## ÍNDICE ORDENADO POR PRIORIDAD

> Ordenado de mayor a menor _soporte + impacto_. El **#1 es el hallazgo más respaldado y más consecuente**. "Detalle" = fichero donde leer la evidencia con URLs.

### Tier S — Decisiones que condicionan toda la arquitectura (confianza alta, impacto máximo)

| #     | Hallazgo (decisión accionable)                                                                                                                                                                                                                                                                                                | Conf. | Detalle                                             |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------- |
| **1** | **Par de versiones del motor.** Empezar con **Pyodide 0.28.x + PyNiteFEA 2.0.2** (numpy 2.2.5 / scipy 1.14.1 / Py 3.13), plenamente estable y sin el pin `numpy>=2.4`. El bleeding-edge (Pyodide 314.0.0 + PyNite 3.0.0) exige numpy 2.4.3 pero arrastra ABI 2026 _prerelease_. **Pinear versiones exactas, nunca "latest".** | Alta  | `areas/01` §1 · `verificacion/01`                   |
| **2** | **`numpy>=2.4.0` es el muro de compatibilidad.** PyNiteFEA lo exige desde **2.1.0** (incl. 3.0.0); solo Pyodide 314 lo cumple. Instalar "la última" PyNite a ciegas en Pyodide<314 **falla la resolución**.                                                                                                                   | Alta  | `areas/01` §1.5 · `verificacion/01`                 |
| **3** | **Cargas: MAYÚSCULAS=global / minúsculas=local.** Error nº1 documentado y confirmado. Gravedad/peso propio/paños → **global `FY` negativo**. Pasar la dirección equivocada da resultados plausibles pero erróneos sin error de ejecución → cubrir con golden tests.                                                           | Alta  | `areas/01` §5.2 · `areas/02` §8 · `verificacion/02` |
| **4** | **El discretizador es puro y la red de seguridad son los golden tests.** Función `discretizar()` sin React/IO/Pyodide, testeable en Node. 7 casos de libro con fórmula cerrada (ver #9). Tolerancia <0.1 % esfuerzos/reacciones, <1 % flechas.                                                                                | Alta  | `areas/02` §7 · `areas/05` §4.1                     |
| **5** | **Combinaciones CTE exactas.** γ: permanente desf. **1,35** / fav. **0,80**; variable desf. **1,50** / fav. **0**; ELS=1,00. ELU persistente ec. 4.3; ELS car./frec./casi-perm. ec. 4.6/4.7/4.8. ψ dependen de la categoría de uso (va por `Grupo`). Para F1 basta **ELU persistente + ELS característica**.                  | Alta  | `areas/04` §2 · `verificacion/04`                   |
| **6** | **Aislar todo Python en `/src/solver`** con Web Worker + Comlink (`expose`/`wrap`); toda llamada asíncrona; estados "cargando motor" / "calculando"; precargar en background. El resto de la app no sabe que existe Python.                                                                                                   | Alta  | `areas/01` §3 · `areas/05` §7                       |

### Tier A — Reglas de implementación de alto soporte

| #      | Hallazgo                                                                                                                                                                                                                                                                                                                                                                                                           | Conf. | Detalle                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | --------------------------------------- |
| **7**  | **Sobrecargas de uso (CTE DB-SE-AE Tabla 3.1)**, valores característicos verificados uno a uno contra PDF oficial: A1=2, A2=3, B=2, C1=3, C2=4, C3/C4/C5=5, D1/D2=5, E=2 kN/m²; cubiertas G1=1 / ligera=0,4 / G2=0. Coef. simultaneidad ψ (Tabla 4.2): residencial A 0,7/0,5/0,3; pública C 0,7/0,7/0,6; viento 0,6/0,5/0; nieve≤1000m 0,5/0,2/0.                                                                  | Alta  | `areas/04` §1-2 · `verificacion/04`     |
| **8**  | **Releases canónicos.** Articulado de flexión = liberar `Ry,Rz` del extremo; biarticulado (celosía) = `Ryi,Rzi,Ryj,Rzj=True`. **Nunca liberar `Rx` (torsión) en ambos extremos** → mecanismo torsional/singularidad. Firma 12 flags: `def_releases(member, Dxi,Dyi,Dzi,Rxi,Ryi,Rzi, Dxj,Dyj,Dzj,Rxj,Ryj,Rzj)`.                                                                                                     | Alta  | `areas/02` §2.3-2.4 · `verificacion/02` |
| **9**  | **Golden tests con fórmula cerrada (todas verificadas, 0 errores de coeficiente):** biapoyada UDL `M=qL²/8`, `δ=5qL⁴/384EI`; voladizo puntual `M=PL`, `δ=PL³/3EI`; voladizo UDL `M=qL²/2`, `δ=qL⁴/8EI`; biempotrada `M_emp=qL²/12`, `M_centro=qL²/24`, `δ=qL⁴/384EI`; biapoyada puntual centro `M=PL/4`, `δ=PL³/48EI`; + celosía y pórtico.                                                                        | Alta  | `areas/02` §7.2 · `verificacion/02`     |
| **10** | **Instalación sin matplotlib.** `matplotlib` está en `install_requires` de PyNite (no es un extra). Secuencia: `loadPackage(["numpy","scipy"])` → `micropip.install("PrettyTable")` → `micropip.install("PyNiteFEA==<ver>", deps=False)`. **Verificar import a import** que PyNite no haga `import matplotlib` a nivel de módulo. Nunca `[all]` (vtk/pyvista/pdfkit no existen en WASM).                           | Alta  | `areas/01` §2 · `verificacion/01`       |
| **11** | **Regla de oro del viewport R3F.** Nada de alta frecuencia por `setState`. Cámara/hover/drag/deformada → **mutación de refs en `useFrame`** + transient updates de Zustand (`subscribe`, requiere middleware `subscribeWithSelector`). `<Bvh>` (three-mesh-bvh) para picking; `InstancedMesh`/`<Instances>` para barras/nudos; `frameloop="demand"` + `invalidate()`.                                              | Alta  | `areas/03` §1-5 · `verificacion/03`     |
| **12** | **Tres ámbitos de estado separados.** `modeloStore` (Capa 1, persistente, único en la pila de undo) · `seleccionStore` (selección/hover) · `vistaStore` (pestaña/grupo/modo/combo) · `resultadosStore` (derivados, se limpian al editar). Undo/redo por **patrón Command** con `aplicar()/revertir()` guardando el _delta_, no snapshots; Composite/transacción para acciones multiparte; coalescing en arrastres. | Alta  | `areas/03` §1-2                         |
| **13** | **Materiales (corregido).** Hormigón EHE-08: **Ecm = 8500·fcm^(1/3)** MPa, fcm=fck+8 → **HA-25=27 264 · HA-30=28 577 · HA-35=29 779 MPa** (ν=0,2). Acero estructural: E=210 000, G=81 000, ν=0,3. Armadura B500S: Es=200 000 (≠ acero estructural). Pesos: HA 25 kN/m³, acero 78,5 kN/m³.                                                                                                                          | Alta  | `areas/04` §3 · `verificacion/04`       |
| **14** | **Persistencia robusta (Dexie/IndexedDB).** Tabla `proyectos{id,nombre,updatedAt}` indexando solo metadatos, `Modelo` como blob. Autosave **debounce** 500–1000 ms (no throttle), `put()` atómico. `tryPersistWithoutPromtingUser()` + `navigator.storage.persist()` (HTTPS) contra evicción LRU; `estimate()` + manejar `QuotaExceededError`.                                                                     | Alta  | `areas/05` §1 · `verificacion/05`       |
| **15** | **Validación Zod en los bordes.** `safeParse` (no `parse`) en import, salida del discretizador (Capa 2) y salida del worker. Tipos vía `z.infer` (fuente única). Mapear `ZodError.issues[].path` (es `.issues`, no `.errors`) a lenguaje de obra. Importar nunca rompe la app.                                                                                                                                     | Alta  | `areas/05` §2-3 · `verificacion/05`     |
| **16** | **Reparto de paños a vigas (áreas tributarias, regla 45°).** 1-dir → mitad a cada viga larga; 2-dir → triangular a cortas, trapezoidal a largas. UDL equiv.: triangular `q=w·Lx/3`; trapezoidal `q=(w·Lx/6)·[3−(Lx/Ly)²]` (verificada algebraicamente).                                                                                                                                                            | Alta  | `areas/02` §4.4 · `verificacion/02`     |
| **17** | **Testing por capas + Vitest `test.projects`** (no `workspace`, deprecado): proyectos `node` (dominio/discretizador/golden) y `jsdom` (UI). Solver en dos niveles: suite normal mockea `solverClient` con golden precomputados; integración con Pyodide real **reutilizando una sola instancia**. E2E Playwright del flujo F1.                                                                                     | Alta  | `areas/05` §4-6 · `verificacion/05`     |

### Tier B — Confirmado, pero requiere validación empírica al montar

| #      | Hallazgo                                                                                                                                                                                                                                                       | Conf.      | Detalle                             |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------- |
| **18** | **Eje Y vertical en PyNite** (gravedad −Y): mapear planta `(x,y)`→global `(X,Z)`, altura/cota→`Y`. _Matiz de verificación:_ es convención de renderizado/uso, no impuesta por el solver — fijarla y testearla.                                                 | Alta/Media | `areas/02` §1.4 · `verificacion/02` |
| **19** | **Orientación de ejes locales en pilares verticales** (web-vector degenera): resolver con un golden test de carga lateral en X y en Z. Confianza media reconocida honestamente.                                                                                | Media      | `areas/02` §2.2                     |
| **20** | **Arranque/memoria del motor:** primera carga decenas de MB (cacheada), instanciación WASM ~4–5 s aun con caché, techo memoria WASM ~2 GB (ampliable a 4). **Cifras orientativas: medir el par elegido.** Self-host del runtime para control de versión/caché. | Media      | `areas/01` §4 · `verificacion/01`   |
| **21** | **Diagramas:** arrancar con Plotly (mapea directo desde `*_array()`) aislado tras `<DiagramaBarra>`; migrar a **uPlot** si crece el nº de barras/combos (Plotly pesado: ~1 MB gzip).                                                                           | Media      | `areas/03` §7 · `verificacion/03`   |
| **22** | **UI accesible:** Radix (Dialog/Tabs/Popover) + Tailwind con CSS variables semánticas como design tokens; componentes shadcn copiados al repo (control total del estilo CAD oscuro).                                                                           | Alta       | `areas/03` §8                       |

---

## Síntesis por área (resumen ejecutivo consolidado)

### Área 1 · Motor FEM — Pyodide/PyNite en Web Worker

El riesgo central es el **emparejamiento de versiones**. PyNiteFEA es Python puro (`py3-none-any.whl`), pero su pin `numpy>=2.4.0` (desde 2.1.0) solo lo satisface Pyodide 314. **Recomendación: par conservador 0.28.x + PyNite 2.0.2 para el MVP**, migrar a 314+3.0.0 cuando estabilice el ABI 2026. Instalar con `deps=False` evitando matplotlib. scipy/numpy son paquetes nativos del lockfile; `sparse=True` por defecto. API confirmada: `add_material/add_section/add_node/add_member/def_support/def_releases/add_load_combo/add_*_load` → `analyze()/analyze_linear()/analyze_PDelta()` → `Member.*_array()` y `Node.Rxn*[combo]/Node.D*[combo]`. Materializar ndarrays a typed arrays antes de cruzar Comlink. **Detalle:** [areas/01-motor-fem.md](areas/01-motor-fem.md) · [verificacion/01-verif-motor-fem.md](verificacion/01-verif-motor-fem.md)

### Área 2 · El discretizador (Capa 1 → Capa 2)

Generación de nodos = snapping geométrico con tolerancia explícita (`1e-3` m); numeración determinista (golden tests). Mapeo de ejes con Y vertical. Releases canónicos (liberar solo flexión, nunca torsión en ambos extremos). Supports = restricción de GDL, validar los 6 movimientos de sólido rígido **antes** del solver, con errores en lenguaje de obra. Reparto de paños por áreas tributarias 45°. Combos como `{hipotesis: factor}` con `combo_tags`. **Las fórmulas de los 7 golden tests se verificaron sin un solo error de coeficiente.** **Detalle:** [areas/02-discretizador.md](areas/02-discretizador.md) · [verificacion/02-verif-discretizador.md](verificacion/02-verif-discretizador.md)

### Área 3 · Frontend CAD/3D

Tres ámbitos de estado; el modelo no entra en el bucle reactivo de render. Mutación de refs en `useFrame` + transient updates. Undo/redo Command con delta. Cámara ortográfica (planta) / perspectiva (3D) con `makeDefault`, reanclando controles al conmutar. Picking con `<Bvh>`. Instancing + `frameloop="demand"`. Radix/shadcn + Tailwind tokens. _Correcciones de verificación:_ `subscribe(selector,cb)` necesita middleware `subscribeWithSelector`; `<Instances>` tiene overhead CPU (usar `InstancedMesh` directo para conteos masivos). **Detalle:** [areas/03-frontend-cad.md](areas/03-frontend-cad.md) · [verificacion/03-verif-frontend-cad.md](verificacion/03-verif-frontend-cad.md)

### Área 4 · Dominio y normativa española

Cargas (Tabla 3.1), γ (Tabla 4.1), ψ (Tabla 4.2) y fórmulas de combinación (4.3/4.6–4.8) verificados contra PDF oficial del CTE. Materiales EHE-08/EC3 con **Ecm corregido**. Secciones: A, Iy, Iz exactas; **J por coeficiente β, nunca momento polar**; perfiles metálicos tabulados (EN 10365, verificar antes de cablear). Vocabulario CYPECAD (Grupo/Planta) encaja con el dominio. Modelar `CategoriaUso` como enum que deriva qk y ψ. **Única refutación del corpus (Ecm) ya corregida en el documento de área.** **Detalle:** [areas/04-dominio-normativa.md](areas/04-dominio-normativa.md) · [verificacion/04-verif-normativa.md](verificacion/04-verif-normativa.md)

### Área 5 · Persistencia, validación y testing

Dexie con documento por proyecto, autosave debounced, persistencia solicitada contra evicción. Formato `.json` versionado (`schemaVersion`, migración incremental v1→v2→…). Zod en todos los bordes con `safeParse`/`z.infer`/`.issues`. Testing por capas: golden en Node, RTL en jsdom, Playwright E2E; solver en dos niveles (mock + Pyodide real con instancia única). Vitest `test.projects`. Robustez: errores Python→dominio, timeout/cancelación, la Capa 1 sobrevive a fallos del solver. **Documento notablemente preciso, sin alucinaciones.** **Detalle:** [areas/05-persistencia-testing.md](areas/05-persistencia-testing.md) · [verificacion/05-verif-persistencia-testing.md](verificacion/05-verif-persistencia-testing.md)

---

## Correcciones aplicadas en la 2ª pasada

1. **[CRÍTICA · aplicada]** Ecm del hormigón (Área 4 §3.2): 30 100/31 850/33 460 → **27 264/28 577/29 779 MPa**. Eran valores espurios sobrestimados ~10 %; propagaban a `E` en PyNite y de ahí a deformada y esfuerzos hiperestáticos.
2. **[Menor]** `micropip.install` orden de parámetros real: `(requirements, keep_going=False, deps=True, credentials=None, pre=False, index_urls=None, *, constraints=None, reinstall=False, verbose=None)`. La semántica de `deps=False` (la conclusión) es correcta.
3. **[Matiz]** `zustand subscribe(selector, callback)` requiere el middleware `subscribeWithSelector`; usar el README oficial de `pmndrs/zustand`, no el fork citado.
4. **[Matiz]** Y vertical en PyNite es convención de uso/renderizado, no impuesta por el solver: fijarla y blindarla con test.

## Decisiones aún abiertas (heredadas del CLAUDE.md, no resueltas por la investigación)

- Material del MVP (hormigón/acero/ambos) — define qué biblioteca y pantallas priorizar.
- Estética definitiva (paleta de acento Concreta, modo claro prioritario).
- Confirmación empírica del par Pyodide↔PyNite extremo a extremo (Tier B #20).
- Convención exacta de ejes locales de pilar vertical en PyNite (Tier B #19).
