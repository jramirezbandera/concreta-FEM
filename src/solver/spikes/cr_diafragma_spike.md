# Spike F0.1 — Diafragma rígido para el Centro de Rigidez (CR) FEM-exacto

**Estado: GO.** Mecanismo elegido: **desplazamiento de cuerpo rígido impuesto**
(`def_node_disp` + `def_support` en el plano). Pasa los 5 criterios de aceptación
sobre la planta simétrica, detecta la degeneración y es físicamente fiel también
en plantas asimétricas. Esta nota es la fuente para **F1.2** (`calcular_cr` en
`pynite_glue.py`); el mecanismo y sus parámetros NO viven solo en el texto del PR.

- Script reproducible: [`cr_diafragma_spike.py`](./cr_diafragma_spike.py)
  (`python src/solver/spikes/cr_diafragma_spike.py` imprime el informe; `--check`
  re-asierta la fixture). **No** forma parte de `npm test`.
- Fixture de regresión: [`cr_diafragma_fixture.json`](./cr_diafragma_fixture.json).
- Par del motor: PyNiteFEA **2.0.2** (el del proyecto, `src/solver/config.ts`).
  El spike se ejecutó con PyNite local (numpy 2.4.4 / scipy 1.18.0). El algoritmo
  del diafragma es Python puro e idéntico al que correrá en Pyodide/WASM; el build
  de numpy/scipy es irrelevante para la pregunta del spike. El golden F3.1 lo
  re-asertará con el **motor Pyodide real** (par 0.28.3 / 2.0.2 / numpy 2.2.5).

---

## Hallazgo rector (verificado en el código de PyNite 2.0.2)

PyNite **no** tiene diafragma rígido nativo (ni MPC, ni master-slave, ni links
rígidos). Pero **sí** tiene desplazamientos nodales prescritos no nulos:
`FEModel3D.def_node_disp(node, direction, magnitude)` fija `node.Enforced{DX..RZ}`.
En `Analysis._aux_list` ese GDL pasa al conjunto **conocido D2** con su valor
prescrito (leído directamente en el código fuente, `Pynite/Analysis.py`). Esto es
la base del mecanismo elegido.

**Gotcha crítico para F1.2:** `Analysis._calc_reactions` solo calcula `Rxn*` en un
nudo si ese nudo tiene **al menos un `support_*` = True**, y solo en los GDL
flagueados como support. Un GDL con desplazamiento prescrito pero **sin** support
NO reporta reacción (sale 0). Por tanto, para leer la fuerza que cuesta imponer el
campo, **hay que marcar DX y DZ como `def_support(...)=True` además de imponer
`def_node_disp`**. Con support+enforced a la vez, el GDL entra en D2 con el valor
prescrito y su reacción se calcula. (Sin el support el spike daba K = 0 y matriz
singular; con él, K es la rigidez del diafragma.)

---

## Mecanismo elegido (lo que F1.2 debe implementar)

Convención FEM Y-up (confirmada en `src/discretizador/geometria.ts`: obra `(x,y)` +
`cota` → FEM `[x, cota, y]` = `[X, Y, Z]`): **plano del forjado = X–Z**, vertical =
Y, **giro de diafragma = RY**, cargas laterales `FX`/`FZ`, torsor `MY`. El `x`/`y`
del CR son coords de **OBRA** (`x = X_FEM`, `y = Z_FEM`), no la Y vertical.

Por planta, con un punto **maestro** `(xm, zm)` (el centroide a la cota del forjado;
NO se añade ningún nudo físico, es solo el origen del campo):

1. Para cada uno de los 3 campos de cuerpo rígido unitarios `(ux, uz, θ)` =
   `(1,0,0)`, `(0,1,0)`, `(0,0,1)`:
   - sobre **cada nudo del forjado** de esa planta (todos los nudos FEM de la
     planta vía `nodoFEMAPlanta`, F0.2): `def_support(n, DX=True, DZ=True, …=False)`
     e imponer el campo
     ```
     DX_n = ux − θ·(z_n − zm)
     DZ_n = uz + θ·(x_n − xm)
     ```
     con `def_node_disp(n,"DX",DX_n)` y `def_node_disp(n,"DZ",DZ_n)`.
   - `analyze_linear(check_statics=False, sparse=True)`.
   - resultante de reacciones del forjado, trasladada al maestro:
     ```
     Fx = Σ RxnFX_n ;  Fz = Σ RxnFZ_n
     My = Σ [ (x_n − xm)·RxnFZ_n − (z_n − zm)·RxnFX_n ]
     ```
   - esa terna es la **columna** correspondiente de la matriz de **rigidez 3×3** `K`
     (filas = `FX, FZ, MY`; columnas = `ux, uz, θ`).
2. Centro de rigidez (coords de obra), **fórmula sobre la RIGIDEZ** (no la
   flexibilidad):
   ```
   x_cr = xm + K[1,2] / K[1,1]      # acople uz↔MY / rigidez en uz
   z_cr = zm − K[0,2] / K[0,0]      # acople ux↔MY / rigidez en ux
   ```
3. Degeneración → `null`: si `cond(K)` no es finito o `> 1e12` (1 pilar, sin rigidez
   torsional determinable). Ver criterio de degeneración abajo.

### GDL del maestro / fuera de plano (criterios 1 y 2)
**No hay nudo maestro físico**, así que no hay GDL de maestro que restringir. En los
nudos del forjado **solo se tocan DX y DZ**; `DY` (vertical), `RX`, `RY`, `RZ` quedan
**libres**. Consecuencias:
- **No** se sobre-restringe el eje vertical (DY libre).
- **No** se esclaviza ningún giro (RY de cada nudo lo resuelve el FEM por mínima
  energía; ver criterio 3).
- La matriz **no es singular**: el campo prescrito fija la cinemática en el plano y
  el resto del modelo (pilares empotrados en base) aporta la rigidez; `cond(K)` ≈
  4–60 en casos sanos.

### Una sola factorización (6A del plan)
F1.2 montará **un** modelo con TODAS las plantas y resolverá los `3·nPlantas` campos.
En el spike se reconstruye el modelo por caso de carga porque `def_node_disp` es por
modelo, pero en el glue se puede usar el patrón de **casos/combos dedicados**
(`add_load_combo`) si el campo prescrito por planta se mantiene fijo entre combos.
**Atención (a resolver en F1.2):** los desplazamientos prescritos son una propiedad
del **modelo**, no del combo (`def_node_disp` no toma `case`), así que tres campos
distintos por planta **no** pueden coexistir en un único `analyze()` con combos
distintos. Dos opciones para F1.2:
  - (a) **un `analyze()` por campo** reusando un modelo cuya matriz K (geometría +
    rigidez) es la misma — la factorización del K11 se puede cachear si se invoca el
    solver de bajo nivel; con `analyze_linear` por campo se re-factoriza (coste
    aceptable: 3·nPlantas resoluciones pequeñas), **o**
  - (b) construir el campo de carga **equivalente** (cargas nodales) en vez de
    desplazamientos prescritos y entonces sí usar combos + una factorización.
  El spike valida la **física** del mecanismo (opción a). La optimización 6A
  (una factorización) es una decisión de implementación de F1.2; si se elige (b),
  re-validar contra esta fixture.

---

## Los 5 criterios de aceptación (planta simétrica 5×5, 4 pilares 30×30, H=3 m)

| # | Criterio | Resultado | Evidencia |
|---|----------|-----------|-----------|
| 1 | Cuerpo rígido en plano sin sobre-restringir el eje vertical ni esclavizar giros | **PASA** | Fuerza aplicada en el CR → giro θ ≈ −3.7e-22 / −1.5e-21 ≈ 0 (definición física del CR). DY/RX/RY/RZ de los nudos quedan libres. |
| 2 | GDL fuera de plano → matriz NO singular | **PASA** | `cond(K) = 12.86`, finito y muy lejos del umbral 1e12. |
| 3 | `RY` es el giro real del diafragma, no un artefacto de un nudo-viga | **PASA** | No se lee ningún RY de maestro (se ensambla desde reacciones). Bajo θ=1, los `RY` nodales valen −0.98 (simétrica) y {−0.80, −1.03, −1.03, −0.96} (asimétrica): **≠ θ(=1)** → giros **libres**, no esclavizados. |
| 4 | Número de condición aceptable | **PASA** | `cond(K)` ≈ 12.6–60 en todo el barrido (no hay rigidez de penalización que ajustar; ver nota de condición). |
| 5 | CR ≡ centroide, invariante a posición del maestro y a escala de rigidez | **PASA** | CR = (0,0) con maestro en (0,0), (1.7,−0.9), (−3.1,2.2); CR = (0,0) con `E × {0.1, 1, 10, 1000}`. |

Degenerado (1 pilar): `cond(K) = inf` → CR `null` "no determinable" (sin NaN).

### Nota sobre el criterio 4 (número de condición)
El mecanismo elegido **no usa rigidez de penalización** (no hay enlaces rígidos ni
muelles), así que **no hay magnitud de rigidez que barrer**: `cond(K)` es el de la
3×3 estructural natural del diafragma, intrínsecamente bueno (≈ 13). El criterio 4
del plan (barrer 1e3…1e9 × la rigidez estructural) aplicaba al **Mecanismo 1**
(araña); con el Mecanismo 1 el barrido confirmó `cond(C)` ≈ 13 estable de 1e2 a 1e7
y degradación de redondeo recién en 1e8 (CR pierde el 5º decimal). Como elegimos el
Mecanismo 2, **no existe ese parámetro frágil** — es una de las razones del
descarte del Mecanismo 1.

### Criterio de degeneración para F1.2 (refinamiento del plan)
El plan propone `Cθθ ≈ 0` como señal de "no determinable". El spike muestra que esa
señal es **engañosa con pilares 3D reales**: 2 o 3 pilares **colineales** dan
`K[2,2] = Ktt = 16200 ≠ 0` (cada pilar resiste el giro de diafragma con su propia
torsión `GJ`), aunque el problema de CR sea geométricamente pobre. La señal
**robusta** es el **número de condición de K**: `cond(K) > 1e12` (o no finito) →
`null`. Casos sanos: `cond` ≈ 4–60. Un pilar: `cond = inf`. **Recomendación para
F1.2: usar `cond(K)` para la degeneración, no `Cθθ`.**

---

## Por qué se DESCARTA el Mecanismo 1 (araña), aunque "funcione"

El Mecanismo 1 (nudo maestro físico + enlaces rígidos viga maestro→nudo + cargas
`FX/FZ/MY` unitarias en el maestro, leyendo `DX/DZ/RY` del maestro; CR por
flexibilidad `x_cr = xm + C[2,1]/C[2,2]`, `z_cr = zm − C[2,0]/C[2,2]`) **también
pasa los 5 criterios en la planta simétrica** (CR = 0, invariante a maestro y a
escala 1e2…1e7, cond ≈ 13). Pero se descarta por **fidelidad física**:

- **Esclaviza los giros nodales.** Los enlaces rígidos (vigas) transmiten momento, así
  que fuerzan el `RY` de cada cabeza de pilar a igualar el `RY` del maestro
  (verificado: `RY_maestro − RY_esclavo` ≈ 1e-13). Eso es exactamente el antipatrón
  que advierte el plan ("esclavizar giros que deberían ser libres"): añade la
  rigidez de flexión de los pilares a la torsión del diafragma y **falsea el CR** en
  plantas asimétricas. Con el pilar de la esquina `(+2.5,+2.5)` rigidizado a 60×60:
  - Mecanismo 2 (giros libres): **CR = (+1.558, +1.558)** — satisface θ(F en CR) ≈ 0.
  - Mecanismo 1 (araña): CR = (+1.974, +1.974) — sobre-rigidizado.
  Ambos coinciden en (0,0) en la simétrica (por eso los 5 criterios, que son sobre
  la simétrica, no lo distinguen), pero divergen en cuanto hay asimetría — que es
  precisamente cuando el CR importa.
- **Requiere enlaces que transmitan momento.** Con enlaces solo-traslación (todos los
  giros liberados en ambos extremos) la matriz es **singular**: el maestro gira
  libre (nada resiste su `RY`). Es decir, el Mecanismo 1 *necesita* el slaving de
  giros para no ser singular — no es opcional.
- **Introduce una escala de rigidez frágil** (la del enlace), que hay que barrer y
  vigilar (criterio 4). El Mecanismo 2 no tiene ese parámetro.

El **Mecanismo 3** (condensación de `m.K()` a mano) **no se evaluó**: el plan lo deja
como último recurso solo con aprobación explícita, y como un mecanismo físico pasa,
no hace falta tocar la rigidez de PyNite a mano (respeta la regla de oro #1).

---

## Cosas que F1.2 debe saber de la API de PyNite 2.0.2

1. **`def_node_disp` + `def_support` juntos** para leer reacciones en GDL prescritos
   (gotcha de arriba). Sin el support, `Rxn*` = 0.
2. **`Rxn*` solo en nudos con support.** Por eso ensamblamos K desde las reacciones
   de los nudos del forjado (que marcamos como support DX/DZ), no desde los
   desplazamientos.
3. **`def_node_disp` no toma `case`/`combo`.** Es una propiedad del modelo. Tres
   campos distintos por planta no caben en un solo `analyze()` con combos distintos
   (ver "Una sola factorización" arriba).
4. **`analyze_linear(check_statics=False, sparse=True)`** es el camino del CR (es un
   análisis auxiliar de geometría+rigidez, sin combos de usuario). En el spike se usó
   `sparse=False` por comodidad local; en el glue usar `sparse=True` (CLAUDE.md §8).
5. **Reacciones por combo con corchetes**: `node.RxnFX["Combo 1"]` (dict por combo).
   Si no hay combos definidos, PyNite usa `"Combo 1"` por defecto.
6. **`cond(K)`** (numpy, álgebra trivial sobre la salida de PyNite, regla de oro #1
   intacta) es el criterio de degeneración robusto, no `Cθθ`.
7. **Signos confirmados** (cierra el "se fijan con el golden" del plan, *para la
   formulación de rigidez del Mecanismo 2*): `x_cr = xm + K[1,2]/K[1,1]`,
   `z_cr = zm − K[0,2]/K[0,0]`. (Ojo: la fórmula de **flexibilidad** del plan
   `x_cr = xm + Cθz/Cθθ`, `z_cr = zm − Cθx/Cθθ` es la del Mecanismo 1/araña y es
   master-dependiente si se aplica al Mecanismo 2 — NO usarla con el mecanismo
   elegido.)

## Fixture de regresión (caso simétrico)

`cr_diafragma_fixture.json` — planta simétrica, maestro en el centroide:
`K_diafragma` ≈ `diag(19584.4, 19584.4, 251873.4)` (sin acoplamiento por simetría),
`cond_K ≈ 12.86`, `cr_obra = (0, 0)`. `python cr_diafragma_spike.py --check`
re-asierta el CR (tol 1e-6) y K (tol relativa 1e-3, holgada para el cambio de build
numpy/scipy local↔Pyodide; el CR es lo invariante).
