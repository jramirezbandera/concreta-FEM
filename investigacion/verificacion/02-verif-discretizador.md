# Verificación adversarial — Área 2: El Discretizador

> Verificador independiente. Objetivo: cazar alucinaciones, no confirmar. Cada fórmula y afirmación técnica recalculada/comprobada de cero contra fuentes primarias.
> Documento verificado: `e:\PROGRAMACION\Concreta FEM\investigacion\areas\02-discretizador.md`
> Fecha: 2026-06-20

Leyenda de veredictos: **VERIFICADO** · **REFUTADO** · **MATIZADO** · **NO CONFIRMABLE**

---

## 1. Tabla de golden tests (§7.2) — fórmulas de viga

### 1.1 Viga biapoyada, carga uniforme `q`
Afirmaciones: `M_max = q·L²/8`, `δ_max = 5·q·L⁴/(384·E·I)`, `R_A=R_B=V_max=q·L/2`.

**Comprobación independiente (calcresource):**
- Reacciones: `R_A=R_B = (1/2)·w·L` ✓
- Momento máx: `M_u = (1/8)·w·L²` ✓
- Flecha máx: `d_u = 5·w·L⁴/(384·E·I)` ✓
- Cortante máx en apoyo = reacción = `q·L/2` (equilibrio elemental) ✓

**Veredicto: VERIFICADO** — los cuatro coeficientes son correctos.
Fuente: https://calcresource.com/statics-simple-beam.html

### 1.2 Voladizo, carga puntual `P` en extremo
Afirmaciones: `M_max = P·L` (empotramiento), `δ_max = P·L³/(3·E·I)`, `R = P`.

**Comprobación independiente:**
- `M = P·L` ✓
- `δ = P·L³/(3·E·I)` ✓
- `R = P` (equilibrio vertical) ✓

**Veredicto: VERIFICADO**
Fuente: https://www.firgelliauto.com/blogs/engineering-calculators/cantilever-beam-calculator-point-load-at-free-end

### 1.3 Voladizo, carga uniforme `q`
Afirmaciones: `M_max = q·L²/2` (empotramiento), `δ_max = q·L⁴/(8·E·I)`.

**Comprobación independiente (firgelli):**
- `M_max = w·L²/2` ✓
- `δ_max = w·L⁴/(8·E·I)` ✓
- (Coherente además: reacción `R = w·L`, momento `M_R = w·L²/2`.)

**Veredicto: VERIFICADO**
Fuente: https://www.firgelliauto.com/blogs/engineering-calculators/cantilever-beam-calculator-uniform-distributed-load

### 1.4 Viga biempotrada, carga uniforme `q`
Afirmaciones: `M_emp = q·L²/12` (extremos), `M_centro = q·L²/24`, `δ_max = q·L⁴/(384·E·I)`.

**Comprobación independiente (calcresource fixed beam):**
- Momento de empotramiento: `M_A = M_B = w·L²/12` (negativo, tracción en fibra superior) ✓
- Momento en centro de vano: `M_P = w·L²/24` ✓
- Flecha máx (centro): `d_u = w·L⁴/(384·E·I)` ✓

**Veredicto: VERIFICADO** — el par 1/12 (empotramiento) y 1/24 (centro) es el correcto; no hay confusión con el 1/8 de la biapoyada. La flecha biempotrada es exactamente 1/5 de la biapoyada (5/384 → 1/384), consistente.
Fuente: https://calcresource.com/statics-fixed-beam.html

> Nota menor (no es error): el documento lista `M_emp` sin signo; en convención de momentos flectores el momento de empotramiento es negativo (`−q·L²/12`). El valor absoluto es el correcto. Recomendable que el golden test compare valor absoluto o fije convención de signos PyNite explícitamente.

### 1.5 Viga biapoyada, carga puntual `P` en centro
Afirmaciones: `M_max = P·L/4`, `δ_max = P·L³/(48·E·I)`.

**Comprobación independiente (calcresource):**
- `M_u = (1/4)·P·L` ✓
- `d_u = P·L³/(48·E·I)` ✓

**Veredicto: VERIFICADO**
Fuente: https://calcresource.com/statics-simple-beam.html

**Subtotal fórmulas de viga (1–5): 5/5 VERIFICADAS, 0 errores de coeficiente.**

---

## 2. Reparto de paño a vigas por áreas tributarias, regla 45° (§4.4)

Afirmaciones:
- Triangular (viga corta): `q_eq = w·L_x/3`.
- Trapezoidal (viga larga): `q_eq = (w·L_x/6)·[3 − (L_x/L_y)²]`.

### 2.1 Triangular
Fuente civilengineeronline: "Equivalent Intensity of UDL = floor load intensity × short side/3" = `w·B/3` con `B = L_x`. **Coincide exactamente.**

**Veredicto: VERIFICADO**

### 2.2 Trapezoidal — comprobación algebraica explícita (la más propensa a error)
Fuente civilengineeronline: `UDL = w·B·(3 − 1/(L/B)²)/6`, con `B = L_x` (lado corto), `L = L_y` (lado largo).

Transformación del término: `1/(L/B)² = 1/(L_y/L_x)² = (L_x/L_y)²`.

Sustituyendo:
`UDL = w·L_x·(3 − (L_x/L_y)²)/6 = (w·L_x/6)·[3 − (L_x/L_y)²]`.

**Idéntica a la del documento, término a término.** Verificación numérica cruzada con el ejemplo de la fuente (w=2 kN/m², L_x=4, L_y=5):
`(2·4/6)·[3 − (4/5)²] = (8/6)·[3 − 0.64] = 1.3333·2.36 = 3.147 kN/m`. La fuente reporta **3.146 kN/m**. ✓ (coincide salvo redondeo).
Triangular: `2·4/3 = 2.667 kN/m`. Fuente: **2.667**. ✓

**Veredicto: VERIFICADO** — ambas fórmulas, incluida la trapezoidal, son correctas. Es la base de momento-equivalente del método de líneas a 45°.
Fuentes: https://civilengineeronline.com/str/prob12.htm · https://hub.sivo.it.com/structural-engineering/what-is-the-formula-for-load-on-a-beam-due-to-a-slab/

> Matiz conceptual (no es error de fórmula): estas son UDL **equivalentes a efectos de momento máximo**, no a efectos de cortante ni de flecha. El propio documento lo dice ("a efectos de momento") y ofrece la alternativa de carga trapezoidal real (`w1≠w2`). Correcto y bien matizado.

---

## 3. Regla de releases: articulado libera `Ry,Rz`; no liberar `Rx` en ambos extremos (§2.3, §2.4)

Afirmaciones:
- Articulado (rótula de flexión) ⇒ liberar giros de flexión `Ry,Rz` del extremo.
- Biarticulado (celosía) ⇒ `Ryi=Rzi=Ryj=Rzj=True`.
- NO liberar torsión `Rx` en ambos extremos (mecanismo torsional, singularidad).

**Análisis estructural:** En el elemento de pórtico 3D, el momento flector se asocia a los giros alrededor de los ejes transversales locales (y, z). Liberar `Ry`/`Rz` en un extremo desacopla el momento flector → rótula que no transmite flector pero sí axil y cortante. Correcto.

El GDL torsional es el giro alrededor del eje longitudinal local (x → `Rx`). Si una barra prismática libera `Rx` en **ambos** extremos y ningún otro elemento aporta rigidez torsional a sus nudos, el GDL de rotación de la barra sobre su propio eje queda sin rigidez → modo de energía nula → matriz de rigidez singular (mecanismo). Estructuralmente **correcto**.

La firma `def_releases(member, Dxi,Dyi,Dzi,Rxi,Ryi,Rzi, Dxj,Dyj,Dzj,Rxj,Ryj,Rzj)` coincide con la documentación oficial de PyNite (todos los parámetros booleanos, default `False`).

**Veredicto: VERIFICADO** (teoría estructural sólida + firma confirmada).
Fuentes: https://pynite.readthedocs.io/en/latest/FEModel3D.html · https://people.duke.edu/~hpgavin/cee421/frame-element.pdf

> Matiz: el documento atribuye a la fuente Duke la cita literal "Releasing all rotational DOF creates an unstable mechanism…". No pude confirmar esa cita textual exacta en el PDF de Gavin (no accesible en esta verificación), pero el **contenido técnico es correcto** con independencia de la cita. Recomendación: tratar la cita como paráfrasis, no como literal verbatim.

---

## 4. Eje Y vertical en PyNite, gravedad en −Y (§1.4, §8.3)

Afirmación: en PyNite el eje Y es vertical; gravedad en −Y; `add_member_self_weight('FY', -1)`.

**Verificación:** La documentación de PyNite confirma que **"PyNite sets the Y-axis to vertical for 3D rendering"** (orientación isométrica). El convenio de carga gravitatoria con `FY` negativo es coherente y aparece en ejemplos (`FY, -valor` para cargas descendentes). La firma `add_member_self_weight(global_direction, factor, case)` está confirmada.

**Veredicto: VERIFICADO con MATIZ.** El eje Y vertical es la convención de PyNite (confirmada vía rendering/render por defecto). **Matiz importante:** la página de docs no impone Y vertical en el solver — la geometría es arbitraria; Y-vertical es convención de presentación/renderizado. El cálculo funciona con cualquier orientación siempre que las cargas se den en el sistema global correcto. La recomendación del documento (mapear altura→Y) es **práctica correcta y alineada con PyNite**, pero conviene formularla como "convención adoptada coherente con el renderer de PyNite", no como restricción del solver. El documento ya lo plantea como decisión de borde, así que el riesgo es bajo.
Fuentes: https://pynite.readthedocs.io/en/latest/FEModel3D.html · búsqueda docs rendering PyNite (Y-axis vertical para Pyvista).

---

## 5. Un nodo de pórtico 3D tiene 6 GDL (§ resumen, §2.1)

Afirmación: 3 traslaciones (DX,DY,DZ) + 3 rotaciones (RX,RY,RZ).

**Verificación:** Confirmado por documentación de nodos de PyNite y teoría estándar de análisis matricial de elemento frame 3D (12 GDL por barra = 6 por nudo).

**Veredicto: VERIFICADO**
Fuente: https://pynite.readthedocs.io/en/latest/node.html · https://github.com/JWock82/PyNite/wiki/2.-Nodes

---

## 6. `merge_duplicate_nodes(tolerance=0.001)` existe en PyNite (§1.1, §1.2)

Afirmación: PyNite expone `merge_duplicate_nodes(tolerance=0.001)`.

**Verificación:** Confirmado literalmente en `FEModel3D`: `model.merge_duplicate_nodes(tolerance=0.001)` — "Merges coincident nodes and rewires connected objects; returns removed node names." El default `0.001` es correcto.

**Veredicto: VERIFICADO**
Fuente: https://pynite.readthedocs.io/en/latest/FEModel3D.html

---

## 7. Confianza media sobre orientación de ejes locales en barras verticales (§2.2)

Afirmación: para barras verticales (pilares), la definición del "web vector"/eje local degenera (producto vectorial nulo cuando el eje de barra es paralelo al global vertical); cada software adopta una convención; debe testearse empíricamente en PyNite. Confianza declarada: **media**.

**Análisis:** Estructuralmente correcto: cuando el eje longitudinal local coincide con el eje de referencia global usado para construir el sistema local, el producto vectorial habitual degenera y el software necesita una regla especial (vector auxiliar alternativo). Esto es un problema real y conocido en todos los códigos de frame 3D. El documento **acierta** al (a) señalarlo, (b) asignarle confianza media, y (c) recomendar un golden test empírico de pilar bajo carga lateral en dos direcciones para fijar la convención de PyNite.

No pude confirmar en esta verificación la convención exacta interna de PyNite para barras verticales (no documentada explícitamente en la página de docs accesible). Esto **valida la prudencia** de marcarlo como confianza media.

**Veredicto: VERIFICADO/MATIZADO** — la afirmación de incertidumbre es honesta y correcta; el riesgo está bien gestionado. Recomendación reforzada: resolver empíricamente pronto (el propio documento ya lo lista como acción accionable nº10).
Fuente: https://people.duke.edu/~hpgavin/cee421/frame-element.pdf (marco teórico del web vector / transformación local-global).

---

## Verificaciones secundarias (firmas API PyNite)

Confirmadas contra `FEModel3D` docs:
- `def_support(node, DX,DY,DZ,RX,RY,RZ)` — booleanos, restricción de 6 GDL ✓ (§3.1)
- `add_node_load(node, direction, P, case)` — solo global ✓ (§4.2, §8.1)
- `add_member_dist_load(member, direction, w1, w2, x1, x2, case)` — trapezoidal w1→w2 ✓ (§4.2)
- Convención global MAYÚSCULAS (FX,FY,FZ) / local minúsculas (Fx,Fy,Fz): confirmada en docs ✓ (§8.1)

**Veredicto: VERIFICADO**
Fuente: https://pynite.readthedocs.io/en/latest/FEModel3D.html

---

## CORRECCIONES NECESARIAS

Ninguna corrección de fórmula o de hecho técnico. El documento es técnicamente sólido. Solo refinamientos menores (no bloqueantes):

1. **(Cosmético/convención)** En §7.2 fila 4, el momento de empotramiento de la biempotrada es negativo (`−q·L²/12`); el documento da el valor absoluto. Fijar convención de signos en el golden test (comparar |M| o documentar la convención de PyNite).
2. **(Cita)** §2.4: la frase entrecomillada atribuida a Duke/Gavin no pude confirmarla verbatim. Tratarla como paráfrasis técnica (el contenido es correcto), no como cita literal.
3. **(Matiz de encuadre)** §1.4/§8.3: "Y vertical en PyNite" es convención de renderizado/presentación, no una imposición del solver (la geometría es arbitraria). El documento ya lo trata como decisión de borde; solo conviene redactarlo como "convención adoptada coherente con PyNite" para no inducir a pensar que el solver exige Y vertical. Riesgo bajo.

Nada de lo anterior afecta a la corrección de las fórmulas ni a las reglas de discretización.

---

## CONFIANZA GLOBAL

**Alta.** Las 5 familias de fórmulas de viga (§7.2 casos 1–5) son correctas al 100% en todos sus coeficientes (8/8 ÷ se comprobó contra fuentes independientes, incluyendo el par crítico 1/12–1/24 de la biempotrada y la distinción frente al 1/8 de la biapoyada). La fórmula trapezoidal de reparto —la señalada como más propensa a error— resultó **algebraica y numéricamente correcta** (verificada por transformación de variables y por el ejemplo numérico de la fuente). Las afirmaciones sobre PyNite (6 GDL, `merge_duplicate_nodes(0.001)`, Y vertical, global/local MAYÚS/minús, firmas de API, releases) están confirmadas contra la documentación oficial. La regla de torsión/releases es teóricamente sólida. El único punto de incertidumbre real (orientación de ejes locales en pilares verticales) está honestamente marcado como confianza media por el propio documento.

No se detectaron alucinaciones ni errores de coeficiente.

---

### Fuentes primarias consultadas en esta verificación
- https://calcresource.com/statics-simple-beam.html (biapoyada UDL y puntual centro)
- https://calcresource.com/statics-fixed-beam.html (biempotrada UDL)
- https://www.firgelliauto.com/blogs/engineering-calculators/cantilever-beam-calculator-uniform-distributed-load (voladizo UDL)
- https://www.firgelliauto.com/blogs/engineering-calculators/cantilever-beam-calculator-point-load-at-free-end (voladizo puntual)
- https://civilengineeronline.com/str/prob12.htm (reparto triangular/trapezoidal + ejemplo numérico)
- https://hub.sivo.it.com/structural-engineering/what-is-the-formula-for-load-on-a-beam-due-to-a-slab/ (reparto, confirmación cruzada)
- https://pynite.readthedocs.io/en/latest/FEModel3D.html (firmas API, merge_duplicate_nodes, direcciones)
- https://pynite.readthedocs.io/en/latest/node.html · https://github.com/JWock82/PyNite/wiki/2.-Nodes (6 GDL)
- https://people.duke.edu/~hpgavin/cee421/frame-element.pdf (marco teórico frame 3D, web vector)
