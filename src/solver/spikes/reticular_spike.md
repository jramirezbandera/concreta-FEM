# Spike T0.1 — Modelo FEM del FORJADO RETICULAR (casetones): placa equivalente vs emparrillado

**Estado: NO-GO para la placa isótropa de espesor equivalente (modelo A) · GO para el
EMPARRILLADO explícito de nervios (modelo B), medido en el experimento (d).**

Modelar el reticular como **placa isótropa de espesor equivalente** (reutilizando el
pipeline de quads de la losa maciza) **subestima la flecha entre −28% y −47%** frente a
un modelo ortótropo razonable. La causa es física y no se puede tapar con una tolerancia
de golden: la placa isótropa asume rigidez torsional `H = D` (como una losa maciza), pero
el reticular tiene la torsión repartida en **nervios rectangulares abiertos
"torsionalmente blandos"** cuyo `H` físico es `≈ 0.11·D`. El elemento de PyNite es fiel
(error +0.4% vs la analítica isótropa); lo que falla es el **modelo**, no el motor.

El **emparrillado de nervios** (members en dos direcciones a intereje `s`, continuos en
los cruces, sección en T con `J` de St. Venant real) sí reproduce la física: flecha a
**−3.2%** de la referencia ortótropa con el `H` físico, momento por nervio a −1.4%,
losa plana sobre 4 pilares estable con ΣV exacto, y modal a **+0.4%** de la teoría
ortótropa. **Condición del GO: `J` realista** (con `J≈0` el modelo sigue estable pero la
flecha cambia +12%).

- Script reproducible: [`reticular_spike.py`](./reticular_spike.py)
  (`python src/solver/spikes/reticular_spike.py`; exit 0 = GO, exit 1 = NO-GO).
  **No** forma parte de `npm test` (lento y exploratorio).
- Par del motor: PyNiteFEA **2.0.2** (el del proyecto, `src/solver/config.ts`).
  Ejecutado con PyNite local (numpy 2.4.4 / scipy 1.18.0). El algoritmo (`FEModel3D` +
  `analyze_linear`/`analyze_modal` sparse) es Python puro e **idéntico** al que correrá
  en Pyodide/WASM; el build de numpy/scipy es irrelevante para las preguntas del spike.
- Material HA-25 **real** del catálogo (`src/biblioteca/hormigon.ts`, Código
  Estructural): `Ecm = 22000·((25+8)/10)^0.3 = 31476 MPa → E = 3.14758·10⁷ kN/m²`,
  `ν = 0.2`. Geometría canónica: intereje `s = 0.80 m`, nervio `b = 0.12 m`, canto
  `h = 0.30 m` (0.25 casetón + 0.05 capa de compresión), peso propio tabulado
  `5 kN/m²` (CTE DB-SE-AE C.5). Placa cuadrada `6.4 × 6.4 m` (= 8 interejes).

---

## Números del caso canónico (medidos, no estimados)

| Magnitud | Valor |
|---|---|
| Sección en T por nervio: área `A_T` | `0.07000 m²` |
| Eje neutro `y_na` (desde fibra superior) | `0.08929 m` |
| Inercia de la T `I_T` | `5.502976·10⁻⁴ m⁴` |
| **Inercia por metro `I_m = I_T/s`** | **`6.878720·10⁻⁴ m⁴/m`** |
| **Espesor equivalente `t_eq = (12·I_m)^(1/3)`** | **`0.20210 m`** |
| **Densidad sintética `ρ_eq = pesoPropio/t_eq`** | **`24.7404 kN/m³`** |
| Comprobación masa modal `ρ_eq·t_eq` | `5.0000` = pesoPropio ✅ |
| `D_orto = E·I_m` (rigidez a flexión Dx=Dy) | `2.165133·10⁴ kN·m` |
| `D_iso = E·t_eq³/(12(1−ν²))` (placa isótropa) | `2.255347·10⁴ kN·m` |

> **Nota sobre `t_eq`.** `t_eq = 0.202 m` sale casi igual que la losa maciza del mismo
> **peso** (`pp/25 = 0.200 m`) por pura coincidencia de esta geometría; son cosas
> distintas: `t_eq` es de **flexión** (define `D`), y `ρ_eq` es una densidad **sintética**
> que hace que `ρ_eq·t_eq` reproduzca el peso propio tabulado para la masa modal, sin
> tocar el glue. Con otra geometría (canto mayor, más aligerado) `t_eq` y `pp/25` divergen.

---

## Rigidez torsional física del reticular (el corazón del NO-GO)

Estimada como grillage de nervios (Timoshenko/Woinowsky-Krieger, *ribbed plate*):
`2H = C_x + C_y` (nervios) `+ H_capa`, con `C_rib = G·J_rib/s` por dirección
(`J_rib` = constante de St. Venant del nervio rectangular, **sección abierta →
torsionalmente blanda**) y `H_capa = D_capa·(1−ν)` de la capa de compresión.

| Término | Valor | fracción de `D_orto` |
|---|---|---|
| `J_rib` (nervio 0.12×0.30, St. Venant) | `1.293·10⁻⁴ m⁴` | — |
| `H_nervios` | `2.120·10³ kN·m` | **0.0979·D** |
| `H_capa` (compresión 0.05) | `2.732·10² kN·m` | 0.0126·D |
| **`H_total`** | **`2.394·10³ kN·m`** | **≈ 0.11·D** |

Para contraste, una losa maciza isótropa de `t_eq` tendría `H = D·(1−ν) ≈ 0.83·D`. El
reticular tiene una rigidez torsional **~7–8× menor** que la placa isótropa que el
pipeline actual asumiría. Es exactamente el "torsionally soft rib" de la literatura de
placas ortótropas nervadas (Timoshenko; Au & Chang): los nervios abiertos aportan poca
torsión, así que `H ≪ D`.

---

## Mediciones contra el motor real

### (a) Flexión — placa SSSS, `q = 5 kN/m²`, malla 8×8, `L = 6.4 m`

**(a2) El ELEMENTO es fiel.** Placa isótropa PyNite con `t_eq` vs la serie de Navier
isótropa (misma `D_iso`):

| Magnitud | Motor PyNite | Navier isótropa | Error |
|---|---|---|---|
| Flecha central | `1.517113·10⁻³ m` | `1.510964·10⁻³ m` | **+0.41 %** |
| Mx central | `9.19661 kN·m/m` | `9.05249 kN·m/m` | +1.59 % |
| DY < 0 (gravedad) | sí | — | ✅ |
| Mx ≈ My (simetría) | sí | — | ✅ |

Consistente con el golden de losa maciza (+1.5% flecha / +2.5% Mx a 8×8): el
cuadrilátero DKMQ reproduce la placa isótropa. **El problema no es el elemento.**

**(a3) BANDA DE ERROR DE ISOTROPÍA — el número que decide.** Referencia = flecha
ortótropa de Huber (`Dx = Dy = E·I_m`, `H = frac·D_orto`), serie de Navier. "iso vs
ortho" = cuánto **subestima** la placa isótropa (`t_eq`) la flecha real:

| `H` | flecha ortótropa (m) | **iso subestima** | interpretación |
|---|---|---|---|
| `1.00·D` | `1.573921·10⁻³` | **−4.0 %** | isotropía total (losa maciza) |
| `0.70·D` | `1.856334·10⁻³` | **−18.6 %** | ortotropía leve |
| `0.50·D` | `2.107740·10⁻³` | **−28.3 %** | ortotropía media (referencia común) |
| `0.30·D` | `2.436898·10⁻³` | **−38.0 %** | ortotropía fuerte |
| **`0.11·D`** | `2.858501·10⁻³` | **−47.1 %** | **H físico del reticular** |

La banda es enorme y **monótona con `H`**: la flecha real es ~1.9× la de la placa
isótropa en el `H` físico del reticular. La serie de Navier converge con **19 términos**
(idéntica a 39 dígito a dígito); no es un artefacto de truncamiento.

### (b) Losa plana — misma malla apoyada SOLO en 4 nudos interiores (pilares)

| Comprobación | Resultado |
|---|---|
| Estable (sin lanzar, sin NaN) | **sí** |
| `DY_min` en vano (flecta hacia abajo) | `−8.184·10⁻⁴ m` (< 0) ✅ |
| ΣReacciones verticales | `204.8000 kN` |
| ΣCargas (`q·área`) | `204.8000 kN` |
| Residuo de equilibrio | `8.8·10⁻¹³ kN` (0.0000 %) ✅ |

El pipeline de quads sostiene el patrón losa plana sin singularidad y con equilibrio
exacto. La mecánica del apoyo interior funciona (heredado del corte losa plana); esto
**no** es el motivo del NO-GO.

### (c) Modal — placa SSSS con `ρ_eq`, malla 8×8

| Magnitud | Valor |
|---|---|
| `f1` motor (masa lumped por quad) | `15.9051 Hz` |
| `f1` teórica (placa delgada, `D = E·I_m`) | `16.1341 Hz` |
| **Error** | **−1.42 %** |
| 1.er modo | flexión (1,1), DY dominante (ratio DY/plano ≈ 10¹⁶), pico en el centro (0.000 m) |
| Coste | 0.10 s (451 GDL) |
| Primeras frecuencias (Hz) | 15.905, 35.282, 39.348, 39.348, 59.032, 61.039 |

`ρ_eq` reproduce el peso propio tabulado y la `f1` cae al **−1.42 %** de la teoría de
placa delgada — dentro de la banda ±5% y consistente con el sesgo Mindlin del elemento
(−2.2% documentado en `masa_placa_spike.md`). **La receta de masa con `ρ_eq` funciona
tal cual, sin tocar el glue.** El doblete degenerado 39.348 = 39.348 confirma un eigen
sano. (Ojo: esta `f1` usa `D = E·I_m` de flexión; la masa es correcta, pero la **rigidez
torsional** del modelo modal isótropo sigue siendo `H = D` — el mismo sesgo de (a3)
afectaría a los modos que activan torsión de placa, no medido aquí.)

### (d) EMPARRILLADO explícito de nervios (plan B) — medido

Grillage en dos direcciones: líneas de nervio en X y Z a intereje `s = 0.80 m`
(`L/s = 8` exacto → las líneas **pasan por los bordes**), nervios **CONTINUOS a través
de los cruces** (sin releases interiores: la continuidad es la rigidez del emparrillado).
Modelo: **81 nudos / 144 members** para 8×8 interejes. Sección en T por nervio (cabeza
eficaz = intereje): `A = 0.07 m²`, `I_T = 5.503·10⁻⁴ m⁴` (flexión vertical),
`I_inplane = 2.169·10⁻³ m⁴`, `J = 1.293·10⁻⁴ m⁴` (St. Venant). **Hipótesis declarada:**
cada dirección cuenta la cabeza de compresión completa por nervio (doble conteo de la
membrana, práctica estándar de emparrillado y coherente con la referencia
`Dx = Dy = E·I_m`). Apoyo SSSS: todo el perímetro con `DY` y giros libres (apoyo simple
de verdad) + anclaje mínimo de los modos rígidos del plano (esquina (0,0) con 6 GDL,
esquina opuesta del mismo borde fija `DZ`). Cargas **nodales tributarias** `q·s²`
(mitades/cuartos en borde/esquina) → ΣV exacto por construcción.

**(d1) Flexión SSSS (`J` = St. Venant real):**

| Magnitud | Emparrillado | Referencia | Error |
|---|---|---|---|
| Flecha central | `2.768247·10⁻³ m` | ortótropa `H=0.11·D`: `2.858502·10⁻³ m` | **−3.2 %** |
| (contraste) | — | isótropa `H=D`: `1.573921·10⁻³ m` | +75.9 % |
| M máx nervio central | `11.15816 kN·m` | `Mx_orto·s = 11.31329 kN·m` | **−1.4 %** |
| ΣV | `204.8000 kN` | `= q·L²` (residuo `−7.4·10⁻¹³`) | ✅ |

El emparrillado cae donde la física dice (la ortótropa de nervios blandos), no donde
caía la placa isótropa: **captura la torsión correcta por construcción** (cada nervio
aporta su `G·J` real).

**(d2) Sensibilidad a `J` (`J ≈ 0`):** **estable** (sin singularidad — los cruces
continuos rigidizan RX por flexión del nervio cruzado), pero la flecha sube a
`3.101159·10⁻³ m` (**+12.0 %** vs `J` real; +8.5% vs la referencia ortótropa, coherente
con que el `H` del grillage baja hacia 0). Conclusión: **`J` NO es bloqueante para la
estabilidad pero SÍ para la precisión** → el discretizador debe emitir la `J` de
St. Venant del nervio, no `J = 0`. Es la condición del GO.

**(d3) Losa plana (apoyo SOLO en 4 cruces interiores):**

| Comprobación | Resultado |
|---|---|
| Estable (sin lanzar, sin NaN) | **sí** |
| `DY_min` en vano | `−8.052·10⁻⁴ m` (< 0) ✅ |
| ΣV vs ΣCargas | `204.8000 = 204.8000` (residuo `7.1·10⁻¹³`) ✅ |

**(d4) Modal (masas nodales tributarias del peso TABULADO, sin
`add_member_self_weight`):**

| Magnitud | Valor |
|---|---|
| `f1` motor | `11.8284 Hz` |
| `f1` teórica ortótropa (`Dx=Dy=E·I_m`, `H=0.11·D`) | `11.7798 Hz` |
| **Error** | **+0.41 %** |
| 1.er modo | flexión (1,1), DY dominante (ratio ≈ 10¹⁶), pico en el centro |
| Frecuencias (Hz) | 11.828, 29.615, 33.464, 33.464, 47.180, 51.312 |
| Coste | 0.08 s (451 GDL) |

Nota: la `f1` real del reticular (**11.8 Hz**) es muy inferior a la de la placa isótropa
de `t_eq` (15.9 Hz, experimento (c)): la blandura torsional también gobierna el modal, y
el emparrillado la captura. La receta de masa validada aquí es **masa nodal tributaria
del peso tabulado en los cruces** (`q·s²/g`), NO `add_member_self_weight` (que además
doble-contaría la cabeza de compresión compartida por ambas direcciones).

---

## Veredicto

**Modelo A (placa isótropa de `t_eq`): NO-GO.**

- **Criterio declarado:** GO si `|error isotropía con H = 0.5·D| ≤ 10 %` (defendible y
  documentable en un golden, estilo el ≤10% que pedía el enunciado).
- **Medido:** `|error| = 28.3 %` con `H = 0.5·D`, y **`47.1 %` con el `H` físico
  (`≈ 0.11·D`)**. El criterio **no se cumple por un margen amplio** y en la dirección
  **insegura** (subestima la flecha → una comprobación de ELS de deformación daría el
  reticular por bueno cuando no lo es).

(b) y (c) salen bien, pero no rescatan el modelo: el fallo está en la **flexión bajo
carga de servicio**, que es justo el resultado principal de un forjado.

**Modelo B (emparrillado explícito de nervios): GO.**

- **Criterio declarado:** GO si `|flecha vs referencia ortótropa con H físico| ≤ 10 %`
  y estable en (d2)–(d3).
- **Medido:** flecha **−3.2 %**, momento por nervio −1.4 %, losa plana estable con ΣV
  exacto, modal **+0.41 %** de la teoría ortótropa.
- **CONDICIÓN del GO:** el discretizador debe emitir **`J` = St. Venant del nervio**
  (`1.293·10⁻⁴ m⁴` para el canónico). Con `J ≈ 0` el modelo sigue estable (no hay
  singularidad: los cruces continuos rigidizan RX) pero la flecha se va **+12 %** — la
  precisión, no la estabilidad, es lo que exige la `J` real.
- Los números de (d1)/(d4) son los **objetivos de los goldens del corte** (flecha
  `2.7682·10⁻³ m`, M nervio `11.158 kN·m`, `f1 = 11.83 Hz` con las tolerancias de la
  referencia ortótropa, no la isótropa).

### Por qué falla (honesto)

El error **no** es del elemento (fiel al +0.4%) ni de la masa (`ρ_eq` da −1.4% en
modal) ni de la estabilidad (losa plana exacta). Es del **modelo constitutivo**: una
placa isótropa impone `H = D`, y un forjado reticular es fuertemente **ortótropo en
torsión** (`H ≈ 0.11·D`) porque sus nervios abiertos son torsionalmente blandos. No hay
un solo `t_eq` isótropo que acierte a la vez flexión y torsión de este forjado.

---

## Recomendaciones para el contrato de F1 (qué debe recoger)

1. **Descartar la placa isótropa de `t_eq` como modelo del reticular.** Es
   **unconservadora en flecha** por 30–47% según la geometría del casetón. Guardarla
   solo como cota inferior de flecha / sanity, nunca como resultado de obra.

2. **Dos caminos viables, ambos ortótropos:**
   - **(A) Placa ortótropa de Huber** con `Dx = Dy = E·I_m` y `H` reducido calibrado al
     grillage de nervios (`H ≈ 0.1–0.3·D` según canto/aligeramiento). **Riesgo mayor:
     el `Quad3D` de PyNite 2.0.2 es ISÓTROPO** (`add_material` E/G/ν; no admite `Dx≠Dy`
     ni un `H` independiente). No hay parámetro para meter la ortotropía en el quad
     actual → habría que verificar si existe un elemento/entrada ortótropa en PyNite (no
     lo hay en 2.0.2 según lo revisado) o **abandonar la vía placa**. Este spike **no**
     pudo medir esta opción por esa limitación del motor: se declara como incógnita, no
     se estima.
   - **(B) Nervios como barras + losa de compresión** (grillage explícito): cada nervio
     = member con su sección en T real (`A_T = 0.07 m²`, `I_m·s = I_T = 5.503·10⁻⁴ m⁴`),
     malla de vigas cruzadas a intereje `s`, continuas en los cruces. Reutiliza el motor
     de barras (ya sólido) y el patrón de viguetas sintéticas del corte unidireccional
     (`panoAMembers`, `f3-unidireccional.md`), extendido a **dos direcciones**.
     **MEDIDO en (d): GO** — flecha a −3.2% y modal a +0.4% de la referencia ortótropa
     con el `H` físico; da la torsión correcta por construcción (cada nervio aporta su
     `G·J` real) y no depende de un elemento ortótropo inexistente.

3. **La torsión de los nervios (`J`) importa aquí — medido en (d2).** Con `J ≈ 0` el
   grillage NO se vuelve inestable (los cruces continuos rigidizan RX por flexión del
   nervio cruzado: el gotcha torsional del unidireccional no reaparece en su forma de
   singularidad), pero la flecha sube **+12%**. El camino (B) obliga a dar la `J`
   realista al nervio (St. Venant, `J_rib ≈ 1.29·10⁻⁴ m⁴`). Es la misma familia de deuda
   que `T-f3-uni-rigidez-T` (sección realista del nervio), aquí **condición del GO**.

4. **La masa modal del emparrillado — receta validada en (d4):** masas **nodales
   tributarias del peso TABULADO** en los cruces (`q_pp·s²/g`, emitidas como cargas del
   caso de masa, igual que hace `_agregar_masa_quads` para quads), **SIN
   `add_member_self_weight`** — el self-weight de las barras infravalora (no ve
   bovedillas/capa) y además doble-contaría la cabeza de compresión que ambas
   direcciones comparten. `f1` a +0.41% de la teoría ortótropa. Si por lo que sea se
   fuese a un quad, `ρ_eq = pp/t_eq` funciona (experimento (c)).

5. **Encoding.** El código de producción que emita texto con símbolos (ρ, δ, δ,
   superíndices) debe ser **ASCII** o forzar UTF-8: la consola de Windows (cp1252) tumbó
   el spike hasta que se forzó `sys.stdout.reconfigure(encoding="utf-8")`. Relevante para
   cualquier logging del glue.

### Sorpresas del motor

- **Ninguna inestabilidad ni aviso de scipy** en los tres experimentos (ni
  `MatrixRankWarning`, ni no-convergencia). El pipeline de quads es robusto para la
  placa isótropa; la limitación es de **modelado**, no numérica.
- El `Quad3D` de PyNite 2.0.2 **no expone rigidez ortótropa** (`add_material` solo E/G/ν
  isótropos); no hay forma de inyectar `Dx≠Dy`/`H` reducido sin cambiar de elemento. Es
  la razón por la que la opción (A) no se pudo medir y se recomienda (B).
- El elemento sigue siendo Mindlin (placa gruesa): el modal cae −1.42% de la placa
  delgada, coherente con `masa_placa_spike.md` (−2.2% límite). No es un problema.
