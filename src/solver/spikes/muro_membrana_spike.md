# Spike F0 — El Quad3D como PANTALLA (corte "muros/pantallas", T-f3-muros)

**Estado: GO.** El `Quad3D` de PyNite 2.0.2 funciona como muro pantalla: su rigidez de
membrana (en plano) reproduce el voladizo de Timoshenko con error **−1.62 %** (esbelto,
malla h=L/6) y **+0.13 %** (achaparrado, cortante-dominado); el drilling NO da problemas
(reacciones parásitas **exactamente 0.0**); `q.membrane()` devuelve **TENSIÓN en kN/m²**
con **Sy = vertical** para el orden de nudos del plan en ambas orientaciones; el mecanismo
del CR converge con quads presentes (cond ~1e2) y **el CR se va a la pantalla**
(x_cr = 6.000 sin muro → **0.011** con muro en x=0); el peso propio nodal cierra
ΣV al bit (err 1.78e-12 %).

- Script reproducible: [`muro_membrana_spike.py`](./muro_membrana_spike.py)
  (`python src/solver/spikes/muro_membrana_spike.py`, exit 0 = GO). **No** forma parte de `npm test`.
- Par del motor: PyNiteFEA **2.0.2** (el del proyecto, `src/solver/config.ts`).
  Ejecutado con PyNite local (numpy 2.4.4 / scipy 1.18.0). Algoritmo Python puro idéntico
  al de Pyodide/WASM.

---

## P1 — Rigidez de membrana: voladizo vs Timoshenko (δ = PH³/3EI + κPH/GA, κ=1.2)

HA-25 del proyecto (Ecm Código Estructural = 31 476 MPa), t=0.30 m, P=100 kN repartida
uniforme en la fila de coronación, base empotrada 6 GDL, `analyze_linear(sparse=True)`.

| Caso | Malla | Quads | δ_FEM [mm] | δ_ref [mm] | err % |
|---|---|---|---|---|---|
| Esbelto L=1.5 H=6 (flexión domina) | h=0.50 | 36 | 2.6776 | 2.8331 | −5.49 |
| Esbelto L=1.5 H=6 | h=0.25 | 144 | 2.7871 | 2.8331 | **−1.62** |
| Achaparrado L=4 H=3 (cortante domina) | h=0.50 | 48 | 0.0404 | 0.0407 | −0.77 |
| Achaparrado L=4 H=3 | h=0.25 | 192 | 0.0408 | 0.0407 | **+0.13** |

- Converge desde abajo (el elemento membrana es algo rígido a malla gruesa) hacia la
  referencia. El achaparrado —el régimen real de una pantalla— clava la teoría.
- **Simetría de orientación exacta**: muro según obra-X y según obra-Y dan |δ| idéntico
  (dif. relativa 1.86e-13). La emisión del discretizador puede tratar ambos ejes con la
  misma receta sin corrección.
- **TOL para el golden GATE del voladizo** (esbelto, h=L/6): err real 1.62 % →
  `TOL_REL_MURO_VOLADIZO = 0.026` (2.6 %, err + 60 % de margen local↔Pyodide).

## P2 — `q.membrane()`: ejes y unidades pinneados

Orden de nudos del plan: `i=(col,fila) j=(col+1,fila) m=(col+1,fila+1) n=(col,fila+1)`
con col = eje s del muro ascendente y fila = cota ascendente. Por la fuente de Quad3D
(x_local = i→j; z = x×(i→n); y = z×x), y_local = **+Y global (vertical)** en ambas
orientaciones. Verificado empíricamente:

- **Axil uniforme** (N=1000 kN): a media altura `Sy = −791.9` vs ref `−N/(t·L) = −833.3`
  kN/m² (+4.97 %, con Sx≈−39 residual) en AMBOS ejes. → `membrane()` = **[Sx, Sy, Txy]
  TENSIÓN kN/m²** (la `Cm` de la fuente no lleva espesor), **Sy = normal vertical**.
- **Gotcha de la 1ª ejecución (medir donde la teoría vale):** en la fila de BASE el campo
  NO es uniaxial — el empotramiento coarta la contracción de Poisson y aparece
  `Sx ≈ ν·Sy` (medido −157 vs ν·ref = −167, coherente). La medida limpia es a media
  altura (Saint-Venant). El golden de membrana debe muestrear LEJOS de la base coartada,
  o asumir el estado biaxial.
- **Flexión** (voladizo esbelto): `Sy(esquinas de base) = ±5614` vs ref de viga
  `6M/(t·L²) = ±5333` kN/m² — signos opuestos correctos, +5 % de concentración de esquina
  empotrada. Tolerancia del golden de membrana en flexión: comparar contra ±6M/(t·L²)
  con TOL 10 %.

## P3 — Drilling: limpio del todo

PyNite añade un muelle rotacional débil por nudo (1/1000 del menor término diagonal,
recomendación de Bathe; `Quad3D.k_m`, fuente del wheel). Resultado empírico con base
empotrada 6 GDL y carga lateral en plano:

- `|Rxn drilling|max = 0.000e+00` y `|Rxn fuera de plano|max = 0.000e+00` en ambas
  orientaciones (vs |RxnFY|max = 25.9 kN de membrana). **Ni singularidad ni reacción
  parásita**: restringir los 6 GDL de la fila base es INOCUO y uniforme entre ejes.
- OJO nomenclatura PyNite: reacciones de momento = `RxnMX/RxnMY/RxnMZ` (no `RxnR*`).

## P4 — CR con pantalla: el mecanismo del glue funciona sin tocarlo

Réplica fiel de `_rigidez_diafragma_planta` (rebuild por campo, def_support FUSIONADO,
`def_node_disp`, K 3×3 de reacciones). Modelo: 2 plantas (cotas 3 y 6), 2 pilares 30×30
en x=6 (obra (6,0) y (6,4)), pantalla t=0.30 según obra-Y en x=0 de (0,0) a (0,4),
cotas 0→6. Nudos de planta = cabezas de pilar ∪ fila del muro en esa cota.

| Modelo | x_cr cota 3 | cond(K) | coste 2 plantas × 3 campos |
|---|---|---|---|
| Sin muro | 6.000 (eje pilares, exacto) | 4.0 | — |
| Con muro h=0.50 (96 quads) | **0.011** | 1.6e2 | 1.15 s |
| Con muro h=0.25 (384 quads) | **0.011** | 9.9e1 | 5.26 s |

- **El CR se va a la pantalla** (y z_cr = 2.000 = centro del muro, exacto): la rigidez en
  plano del muro es órdenes de magnitud superior a la de 2 pilares. Físicamente correcto.
- Estable entre mallas (Δx_cr < 1 mm), cond sanísimo (≪ 1e12), la planta de cimentación
  y la fila base del muro (todo DX∧DZ) las clasifica bien la guarda existente del glue.
- **Coste**: escala ~lineal-superlineal con quads (rebuild+analyze por campo). En Pyodide
  será 2-4× más lento → un muro de 384 quads ≈ 10-20 s de CR. Implicación de producto:
  **tamMalla por defecto del muro = 0.5 m** (no 0.25) y la deuda `T-cr-una-factorizacion`
  gana peso con muros. No bloquea el corte (el CR es acción explícita del usuario).

## P5 — Peso propio nodal (la presión NO vale en un muro)

La presión de superficie actúa según la NORMAL del quad — horizontal en un muro. El peso
va como cargas nodales: por quad `W = ρ·t·hx·hy`, `FY = −W/4` a sus 4 nudos (acumulando
entre vecinos), en el case de peso propio. Resultado: `ΣV base = 90.000000 =
ρ·t·L·H` (err 1.78e-12 %). Sin doble conteo con la masa modal del glue por construcción:
`_agregar_masa_quads` escribe en `__masa_modal__`, que solo entra en el combo del modal.

## Recomendaciones al corte (decisiones que este spike pinna)

1. **Orden de emisión de quads del muro**: `i=(col,fila) j=(col+1,fila) m=(col+1,fila+1)
   n=(col,fila+1)`, col = s ascendente, fila = cota ascendente. Da y_local vertical en
   ambas orientaciones → `Sy` de membrana es SIEMPRE la tensión vertical.
2. **Apoyo de base**: 6 GDL True por nudo de la fila base (con `vinculacionExterior`).
   Uniforme, estable, sin reacción parásita.
3. **Goldens**: voladizo esbelto h=L/6 con `TOL_REL = 0.026`; membrana axil a media
   altura (TOL 5 %) y flexión en esquinas vs ±6M/(t·L²) (TOL 10 %).
4. **tamMalla por defecto del muro = 0.5 m** (coste del CR).
5. El CR del lado TS solo necesita añadir quads+apoyos del muro al payload y los nudos
   del muro por cota a `plantasInfo` — **el glue no se toca**.

### Sorpresas

1. Ninguna singularidad por drilling — el miedo clásico de los muros de láminas resultó
   infundado en PyNite (muelle de Bathe ya incorporado). Reacciones parásitas = 0.0 exacto.
2. La base empotrada coarta Poisson → el estado tensional de la fila base es biaxial
   (Sx ≈ ν·Sy). No es un bug: es física. Medir la membrana lejos de la base.
3. El CR con una pantalla es casi degenerado de puro DOMINANTE (x_cr a 11 mm del plano
   del muro): con una sola pantalla el edificio gira alrededor de ella. La UI del CR ya
   comunica excentricidades grandes; ningún cambio necesario, pero el golden debe esperar
   x_cr ≈ x_muro, no un punto intermedio.
