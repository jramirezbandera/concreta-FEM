# Spike T0.1 — Masa de PLACA en el análisis modal (corte T-f3-masa-placa)

**Estado: GO.** Mecanismo elegido: **masa nodal tributaria** — cada quad reparte su
peso `W = ρ·t·área` como `add_node_load(FY, −W/4, case=__masa_modal__)` en sus 4
nudos (acumulando entre quads vecinos); `analyze_modal(mass_combo_name=__MASA_MODAL__,
mass_direction="Y", gravity=9.81)` lo convierte en masa `W/g` en las traslaciones
nodales. Es el mismo patrón peso→masa/g que el glue ya usa para las BARRAS
(`add_member_self_weight`), extendido a la placa **a mano** porque PyNite no da masa
al `Quad3D`. El eigen es sano, el 1.er modo es la flexión (1,1) de la placa, y el
coste a malla de producción (16×16) es sub-segundo.

- Script reproducible: [`masa_placa_spike.py`](./masa_placa_spike.py)
  (`python src/solver/spikes/masa_placa_spike.py`). **No** forma parte de `npm test`.
- Par del motor: PyNiteFEA **2.0.2** (el del proyecto, `src/solver/config.ts`).
  Ejecutado con PyNite local (numpy 2.4.4 / scipy 1.18.0). El algoritmo (masa nodal +
  `analyze_modal`) es Python puro e idéntico al que correrá en Pyodide/WASM; el build
  de numpy/scipy es irrelevante para las preguntas del spike.

---

## Hallazgo rector (verificado en el código de PyNite 2.0.2)

`Quad3D` **no** tiene `m()`/`kg()` ni guarda `rho` (solo `E`/`nu`), y
`add_member_self_weight` **ignora los quads**. Por tanto una losa maciza modelada con
quads entra en `analyze_modal` con **masa cero**: sus modos de flexión de placa no
aparecen. Ese es el bug del corte.

`FEModel3D.M()` (la matriz de masa que ve el modal) sí ensambla, además de la masa de
members, la masa de las **cargas nodales del combo de masa**: `Node3D.M()` toma
`total_mass = Σ|F_dir|/g` de las cargas del combo en `mass_direction` y la coloca en
las **tres traslaciones** (`m[0,0]=m[1,1]=m[2,2]=total_mass`, GDL FX/FY/FZ). Los GDL
**rotacionales quedan sin masa** (`characteristic_length=None` en el camino del
modelo). Esa es la vía para dar masa a la placa: `add_node_load` en el combo de masa.

**Confirmado (firma real 2.0.2):**
`analyze_modal(num_modes=12, mass_combo_name='Combo 1', mass_direction='Y',
gravity=1.0, log=False, check_stability=True)` —
`add_node_load(node, direction, P, case='Case 1')`.

---

## Mecanismo elegido (lo que la Fase 1 debe implementar en el glue)

Convención FEM Y-up (placa en X–Z, vertical = Y). Por cada quad de la malla:

```
W_quad = rho * t * area_quad            # rho = PESO específico kN/m³ (NO masa)
por cada uno de sus 4 nudos:  add_node_load(nudo, "FY", -W_quad/4, case=_CASO_MASA_MODAL)
```

acumulando entre quads vecinos (los nudos interiores reciben ~4 aportes, los de esquina
~1; la suma total = peso de la losa). Luego, en `_run_modal`, junto al
`add_member_self_weight` de las barras y con el **mismo** combo de masa
`__MASA_MODAL__` y `gravity=9.81`:

```
add_load_combo(_COMBO_MASA_MODAL, {_CASO_MASA_MODAL: 1.0})   # ya existe en el glue
analyze_modal(num_modes, mass_combo_name=_COMBO_MASA_MODAL, mass_direction="Y", gravity=9.81)
```

- **`gravity=9.81` es obligatorio** (igual que en las barras): `rho` es PESO (kN/m³),
  y la masa nodal es `W/g`. Con `gravity=1.0` las frecuencias saldrían `×√g` (el mismo
  "error sutil" que F2b documentó para las barras).
- **`mass_direction="Y"`** cuenta la carga vertical `FY` como masa. Node3D la reparte
  igualmente en las 3 traslaciones, así que la placa tiene masa también para modos
  horizontales; correcto (una losa tiene masa en las 3 direcciones).
- **Convive con la masa de barras**: como ambas alimentan el mismo `_CASO_MASA_MODAL`
  / `_COMBO_MASA_MODAL`, en un forjado sobre pórtico la masa de la losa **y** la de los
  pilares/vigas suman en la misma matriz M. La Fase 1 solo añade el bucle de quads
  ANTES del `add_load_combo` existente; no cambia la receta de barras.

---

## (a) Viabilidad — el eigen es sano, el 1.er modo es la flexión de placa

Placa cuadrada **SSSS** (simplemente apoyada, DY en todo el borde) + estabilización en
plano idéntica al discretizador (`mallado.ts:540`: esquina (0,0) → DX+DZ, esquina
(nx,0) → DZ). HA-25 realista del proyecto (Ecm del Código Estructural = 31 476 MPa →
E = 3.148·10⁷ kN/m²; ν=0.2; ρ=25 kN/m³), a=6 m, t=0.25 m (t/a≈0.042).

Malla 8×8, primeras 6 frecuencias (Hz):
`[22.208, 37.439, 54.817, 54.817, 62.639, 84.812]`.

- **Todas finitas y > 0**; sin modos espurios de frecuencia absurda. `f_max/f_1 = 3.8`
  (un salto enorme delataría un modo espurio por GDL rotacional/*drilling* del quad sin
  masa; no ocurre).
- **1.er modo = flexión (1,1)**: `DY_max = 0.417`, movimiento en plano `≈ 9·10⁻¹⁷`
  (ruido numérico) → **ratio DY/plano ≈ 4.6·10¹⁵**, DY domina por completo. El pico de
  |DY| está **exactamente en el centro** (x,z)=(3.00, 3.00), a 0.000 m del centro:
  media onda en X y en Z, el modo (1,1) de Leissa. **No** hay modo espurio de
  traslación/giro en plano por delante.
- El doblete `54.817 = 54.817` es el par degenerado (1,2)/(2,1) esperado por la
  simetría cuadrada — señal de que el eigen captura bien la física, no la ensucia.

**Sin warnings ni `eigsh` lento** a estas mallas.

---

## (b) Precisión y convergencia — tabla malla → f1 → error%

Analítica de Leissa (placa **delgada** Kirchhoff), SSSS cuadrada:
`f₁ = (π/2)·(1/a²+1/b²)·√(D/μ)`, `D = E·t³/(12(1−ν²))`, `μ = ρ·t/g`.
Con los datos de arriba: **f₁_Leissa = 22.590 Hz** (D=4.269·10⁴ kN·m, μ=0.6371).

| malla | nudos | GDL libres | f1 [Hz] | error % vs Leissa | 1.er modo |
|------:|------:|-----------:|--------:|------------------:|-----------|
| 4×4   |   25  |    131 | 21.475 | **−4.93 %** | flex (1,1) OK |
| 8×8   |   81  |    451 | 22.208 | **−1.69 %** | flex (1,1) OK |
| 16×16 |  289  |   1667 | 22.269 | **−1.42 %** | flex (1,1) OK |
| 24×24 |  625  |   3651 | 22.195 | −1.75 % | — |
| 32×32 | 1089  |   6403 | 22.141 | −1.99 % | — |
| 40×40 | 1681  |   9923 | 22.108 | −2.13 % | — |
| 48×48 | 2401  |  14211 | 22.087 | −2.23 % | — |

**SORPRESA IMPORTANTE (define la TOL del golden): la curva NO converge a 0 respecto a
Leissa; es no monótona con un mínimo de |error| en ~16×16 y luego crece hacia ≈ −2.2 %.**

Interpretación (verificada con estimación Mindlin):
- El elemento de PyNite es un cuadrilátero de placa **gruesa (Mindlin/DKMQ)**, que
  incluye deformación por cortante transversal → la placa es más flexible que la
  **delgada** de Leissa → `f1` converge a un valor **por debajo** de Leissa.
- A malla basta hay además un error de discretización que **rigidiza** y compensa
  casualmente parte de ese déficit (por eso 4×4 y 8×8 dan menos |error| de lo que dará
  el límite fino). Al refinar, el error de malla desaparece y aflora el sesgo físico
  Mindlin: el motor converge a ≈ −2.2 % (48×48) y sigue bajando lentamente.
- Con t/a≈0.042 el efecto de placa gruesa es **pequeño pero NO despreciable** (~2 %),
  como anticipaba el enunciado del corte. Una estimación Mindlin de 1.er orden da
  −0.4 %; el resto (~−1.8 %) es el sesgo propio de convergencia del DKMQ hacia su
  solución Mindlin. **El límite del motor es ≈ −2.2 %+ respecto a Leissa, no 0.**

Consecuencia de diseño: **la referencia de Leissa delgada NO es el límite de
convergencia del motor.** El golden debe tenerlo en cuenta (ver decisión de TOL abajo).

---

## (c) Coste — aceptable para el worker

`analyze_modal` (medido local; el worker Pyodide/WASM será algo más lento pero del
mismo orden):

| malla | GDL libres | num_modes | tiempo |
|------:|-----------:|----------:|-------:|
| 16×16 | 1667 |  6 | **0.51 s** |
| 16×16 | 1667 | 30 | **0.80 s** |
| 24×24 | 3651 |  6 | 1.70 s |
| 32×32 | 6403 |  6 | 4.15 s |
| 40×40 | 9923 |  6 | 9.30 s |
| 48×48 |14211 |  6 | 16.9 s |

**16×16 (≈1700 GDL) es el punto dulce**: sub-segundo tanto con 6 como con 30 modos, muy
por debajo del techo de ~10 s del worker. El número de modos apenas mueve el coste (el
grueso es la factorización, no el nº de autovalores). A partir de 32×32 el coste crece
rápido (>4 s) y **empeora** la precisión (aflora el sesgo Mindlin), así que refinar por
encima de 16×16 no compensa para el modal.

---

## DECISIÓN de TOL_REL para el golden de Fase 3

**Veredicto: GO.** El mecanismo es viable, físicamente correcto y barato. La `TOL_REL`
depende de la referencia y la malla que use el golden:

- **Referencia recomendada: Leissa delgada, malla acotada 8×8 o 16×16** (la de
  producción). El error real medido ahí es **−1.42 % (16×16)** / **−1.69 % (8×8)**.
- **TOL_REL = 0.03 (3 %)** con referencia Leissa a malla 8×8 o 16×16. Cubre el
  error real medido (≤1.7 %) con margen para: (i) el cambio de build numpy/scipy
  local↔Pyodide, (ii) la variación de malla del caso concreto del golden, y (iii) la
  banda entre el −1.4 % del mínimo y el ≈−2.2 % del límite fino. 3 % es holgado para el
  resultado correcto y **mortal** para los fallos que el golden debe cazar: masa cero
  (no aparece el modo de placa → f1 disparada o el modal falla), `gravity` mal (f1
  ×/÷√g ≈ ±68 %/×3.1), o factor de masa equivocado.

  > **NO** poner TOL más estrecha (p.ej. 1 %) contra Leissa: fallaría por el sesgo
  > Mindlin físico, no por un bug. Y **NO** refinar la malla del golden buscando 0 %:
  > al refinar el error CRECE hacia −2.2 % (converge a Mindlin, no a Leissa). Si algún
  > día se quiere TOL <1 %, la referencia correcta es una **solución de placa gruesa
  > (Mindlin) tabulada**, no Leissa — fuera del alcance de este corte.

- **Golden de integración (recomendado además del de magnitud):** discretizar() real
  de un paño losa → motor real → afirmar que **f1 es finita, positiva y del orden
  esperado (~20-25 Hz para esta placa)** y que **con la masa de placa f1 baja** frente
  al mismo modelo sin masa de quad (regresión directa del bug: sin el fix, el modo de
  placa no existe). Esto caza el bug aunque la constante analítica se mueva.

**STOP no aplica**: el error a malla razonable (≤1.7 %) está muy por debajo del umbral
~3 % del corte, y converge de forma predecible (a un límite físico conocido, no a
divergencia).

---

## Sorpresas / notas para la Fase 1

1. **La convergencia es no monótona y NO tiende a Leissa** (converge a Mindlin ≈ −2.2 %).
   Es lo que hay que saber para no fijar una TOL ingenua contra la placa delgada. (Ver
   (b).) No es un bug: es el elemento de placa gruesa de PyNite haciendo su trabajo.
2. **La masa nodal va a las 3 traslaciones**, no solo a Y (`Node3D.M` fija FX/FY/FZ con
   la misma `total_mass`). Correcto para una losa, pero implica que la placa aporta masa
   a los modos horizontales del edificio también — deseable.
3. **GDL rotacionales sin masa**: no generaron modos espurios en el rango inspeccionado
   (ratio f_max/f_1 = 3.8, sano). Si en modelos con muchos más modos apareciera un modo
   rotacional espurio de frecuencia altísima, la vía sería `characteristic_length` en
   Node3D.M — **no** hizo falta aquí; no complicar el glue sin evidencia.
4. **Acotado de `num_modes`**: reusar el `_contar_gdl_libres` del glue (una placa 16×16
   tiene 1667 GDL libres, sobra margen para 6-30 modos). Sin cambios respecto a F2b.
5. **`check_statics`/`sparse` no se pasan a `analyze_modal`** (la firma 2.0.2 no los
   acepta; siempre dispersa internamente) — igual que ya hace `_run_modal`.
