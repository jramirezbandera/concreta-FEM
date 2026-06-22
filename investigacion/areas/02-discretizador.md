# Área 2 — El Discretizador (Capa 1 → Capa 2 FEM para PyNite)

> Investigación de mejores prácticas para `discretizar(modelo: Modelo) -> ModeloFEM`: función PURA (sin React/IO/Pyodide), testeable en Node, que traduce el modelo constructivo (Grupos, Plantas, Pilares, Vigas, Paños, Muros, Cargas por hipótesis) al contrato JSON de barras/nodos que consume PyNite (`nodes, materials, sections, members, supports, releases, loads, combos`).
>
> Cada afirmación lleva: **claim** (verificable, con fórmula si aplica), **rationale**, **sources** (URLs reales) y **confidence** (alta/media/baja). Sistema de unidades interno asumido: **kN, m** (ver CLAUDE.md §14).

---

## Resumen ejecutivo

1. **La generación de nodos es un problema de "snapping" geométrico.** Genera nodos candidatos en cabezas/pies de pilares y encuentros de vigas, y fúndelos por proximidad con una **tolerancia explícita** (≈1 mm en unidades de m → `0.001`). PyNite ofrece `merge_duplicate_nodes(tolerance=0.001)` como red de seguridad, pero el discretizador debe producir un grafo ya limpio y con numeración estable (no confíes solo en el merge a posteriori).
2. **Un nodo PyNite tiene 6 GDL** (3 traslaciones DX/DY/DZ + 3 rotaciones RX/RY/RZ). Pilar → `member` vertical; viga → `member` horizontal; los extremos articulados se modelan con `def_releases` liberando los **giros de flexión** del extremo, **nunca todos los giros a la vez** en ambos extremos (crea mecanismo torsional/rotacional).
3. **Eje Y vertical en PyNite** (gravedad en −Y). Esto condiciona toda la geometría: un pilar va de `(x, cota_pie, z)` a `(x, cota_cabeza, z)`. Atención: el dominio de la app usa `(x, y)` en planta; hay que **mapear planta→(X,Z) y altura→Y** en el borde del discretizador.
4. **Direcciones de carga: MAYÚSCULAS = global, minúsculas = local.** Es el error nº1 documentado. Peso propio y cargas gravitatorias de paño van en **global** (`FY` con signo −); cargas locales (perpendiculares a la barra) en minúsculas. El discretizador debe ser explícito y testeado en esto.
5. **Supports = restricción de GDL.** Empotrado = los 6 GDL `True`; articulado = 3 traslaciones `True` + giros `False`; elástico = `def_support_spring`. La **suficiencia de sujeción** (no mecanismo) se valida ANTES de llamar al solver, en lenguaje de obra.
6. **Cargas de paño → vigas por áreas tributarias.** Regla de oro: 1-dirección reparte a las dos vigas largas; 2-direcciones reparte por líneas a 45° desde esquinas → carga **triangular** a las vigas cortas y **trapezoidal** a las largas, convertibles a UDL equivalente con fórmulas cerradas.
7. **Combinaciones ELU/ELS** se construyen como mapas `{hipotesis: factor}` (p. ej. `1.35·G + 1.5·Q`). El discretizador genera los `combos`; la normativa concreta (CTE/EHE) es competencia de otra área.
8. **Golden tests con solución analítica cerrada** (viga biapoyada `M=qL²/8`, voladizo `δ=PL³/3EI`, pórtico, celosía) son la red de seguridad del producto. Tolerancia recomendada: error relativo < 0.1 % para vigas simples (PyNite es exacto en barras prismáticas).

---

## 1. Generación de nodos

### 1.1 — Compartir nodos en intersecciones (cabeza/pie de pilar, encuentros de viga)
- **Claim:** El discretizador debe generar nodos candidatos en (a) pie y cabeza de cada pilar, (b) extremos de cada viga, (c) intersecciones geométricas relevantes, y **fundir** los que coinciden en posición dentro de una tolerancia, de modo que pilar y vigas que concurren en un encuentro **referencien el mismo nombre de nodo**. Una barra que comparte un nudo transmite esfuerzos a las demás solo si comparten el mismo `node`.
- **Rationale:** En análisis matricial de pórticos el ensamblaje de rigideces ocurre por nudo compartido: dos elementos solo están conectados si referencian el mismo grado de libertad nodal. Si por error de redondeo se generan dos nodos casi-coincidentes pero distintos, la estructura queda "desconectada" en ese punto (mecanismo o resultados absurdos). PyNite expone `merge_duplicate_nodes(tolerance=0.001)` precisamente porque tras mallar o generar geometría es habitual tener duplicados.
- **Sources:** https://www.structuresmmm.org/methods/matrix-structural-analysis · https://pynite.readthedocs.io/en/latest/index.html · (PyNite_Guia_Completa.md §5.5, §9.8)
- **Confidence:** alta

### 1.2 — Tolerancia geométrica explícita
- **Claim:** Usa una **tolerancia de fusión** explícita en unidades internas (kN-m). Recomendado: `tol = 1e-3` m (1 mm), coherente con el default de PyNite `merge_duplicate_nodes(tolerance=0.001)`. Dos coordenadas se consideran el mismo nudo si `|Δx|,|Δy|,|Δz| ≤ tol` (o distancia euclídea ≤ tol). La tolerancia debe ser un **parámetro nombrado**, no un literal disperso.
- **Rationale:** El "snapping" por tolerancia es la práctica estándar para deduplicar geometría CAD/FEM. Una tolerancia demasiado grande funde nudos que deberían estar separados (vigas muy cortas); demasiado pequeña deja duplicados por error de coma flotante. 1 mm es razonable para edificación (las coordenadas de obra rara vez se introducen con más precisión).
- **Sources:** https://pynite.readthedocs.io/en/latest/index.html · (PyNite_Guia_Completa.md §5.5)
- **Confidence:** alta

### 1.3 — Numeración / nombres estables y deterministas
- **Claim:** Los nombres de nodos (`N1, N2, …`) y barras (`M1, …`) deben generarse de forma **determinista** a partir del modelo de obra (p. ej. ordenando por (planta, x, z) y asignando índices), de modo que el mismo modelo produzca SIEMPRE la misma Capa 2. No uses los nombres autogenerados aleatoriamente por PyNite (`name=None`).
- **Rationale:** El determinismo es requisito para **golden tests** (comparar Capa 2 byte a byte o resultado a resultado) y para que "Ver modelo de cálculo" muestre nombres reproducibles. PyNite genera nombres únicos si pasas `name=None`, pero no garantiza estabilidad entre ejecuciones ni semántica de obra.
- **Sources:** https://pynite.readthedocs.io/en/latest/index.html · (PyNite_Guia_Completa.md §3.1, §13.1) · CLAUDE.md §3, §13
- **Confidence:** alta

### 1.4 — Mapeo planta(x,y) → global(X,Y,Z) con Y vertical
- **Claim:** En PyNite el **eje Y es vertical** (gravedad en −Y). El dominio de la app trabaja en planta con `(x, y)`; el discretizador debe mapear el plano de planta a **(X, Z)** global y la **altura/cota** a **Y** global. Un pilar entre planta P_i (cota `c_i`) y P_f (cota `c_f`) en posición de planta `(px, py)` genera barra de `(px, c_i, py)` a `(px, c_f, py)`.
- **Rationale:** Confundir el eje vertical es un error silencioso: el peso propio y las cargas gravitatorias se aplican en `FY`, y si la geometría no tiene la vertical en Y, la deformada y los esfuerzos salen mal sin que ningún chequeo lo detecte. El renderer y las convenciones de PyNite asumen Y vertical.
- **Sources:** (PyNite_Guia_Completa.md §3.2) · https://pynite.readthedocs.io/en/latest/index.html
- **Confidence:** alta

---

## 2. Pilares y vigas como `members`

### 2.1 — Ejes locales de barra y orientación
- **Claim:** El eje local **x** va del nodo `i` al `j` (a lo largo de la barra); los ejes locales **y, z** son transversales y definen el plano de la sección. El parámetro `rotation` de `add_member` (grados) gira la sección **alrededor del eje local x**. El `angulo` del pilar (campo del dominio) se traduce a este `rotation`.
- **Rationale:** En el elemento de pórtico 3D cada nodo tiene 6 GDL (3 traslaciones u,v,w y 3 giros θx,θy,θz). La inercia `Iy`/`Iz` de la sección está referida a los ejes locales y/z; si la orientación de la sección no se gira correctamente, una sección rectangular trabaja "tumbada" y la rigidez a flexión sale intercambiada. La transformación local→global usa `[K]_global = [T]ᵀ [K]_local [T]` con `[T]` (12×12) construida a partir de los cosenos directores del eje de la barra.
- **Sources:** https://people.duke.edu/~hpgavin/cee421/frame-element.pdf · https://knowledge-base.matrix-software.com/help/matrix-frame/structure-input/structure-geometry/rotation-of-members · (PyNite_Guia_Completa.md §3.2, §5.1)
- **Confidence:** alta

### 2.2 — Definición del eje local y para barras verticales (pilares)
- **Claim:** Para barras **verticales** (pilares: eje local x paralelo al eje global Y vertical) la convención de "default web vector" es ambigua y los programas FEM aplican una regla especial. Documenta y **testea** cómo PyNite orienta los ejes y/z de un pilar vertical, y usa `rotation` para fijar la orientación de la sección de forma determinista.
- **Rationale:** Cuando el eje de la barra coincide con el eje vertical global, el producto vectorial habitual para definir el eje local y degenera (vector nulo). Cada software adopta una convención (p. ej. eje local y apuntando a +X global). Si no se controla, dos pilares "idénticos" pueden orientar su inercia de forma distinta. Esto es una fuente clásica de bugs; debe cubrirse con un golden test de pilar bajo carga lateral en dos direcciones.
- **Sources:** https://people.duke.edu/~hpgavin/cee421/frame-element.pdf · https://knowledge-base.matrix-software.com/help/matrix-frame/structure-input/structure-geometry/coordinate-system
- **Confidence:** media

### 2.3 — Articulación (rótula) ⇒ liberar SOLO los giros de flexión
- **Claim:** Un extremo **articulado** (rótula que no transmite momento flector) se modela liberando los **giros de flexión** de ese extremo: en PyNite, `def_releases(member, …, Ryi, Rzi, …, Ryj, Rzj)` poniendo a `True` `Ryi`/`Rzi` (extremo i) o `Ryj`/`Rzj` (extremo j). Una barra **biarticulada** (tipo celosía) libera momentos en **ambos** extremos: `Ryi=Rzi=Ryj=Rzj=True`. Firma PyNite: `def_releases(member_name, Dxi,Dyi,Dzi,Rxi,Ryi,Rzi, Dxj,Dyj,Dzj,Rxj,Ryj,Rzj)`.
- **Rationale:** En el elemento de pórtico el giro de flexión es el GDL θ alrededor de los ejes transversales locales (y, z). Liberar θy y θz desacopla el momento flector en ese extremo (rótula). La condensación estática del GDL liberado es lo que hace PyNite internamente. La guía PyNite lo confirma: "Para hacer una barra de celosía (biarticulada) se liberan los momentos en ambos extremos: `Ryi=Rzi=Ryj=Rzj=True`".
- **Sources:** https://people.duke.edu/~hpgavin/cee421/frame-element.pdf · (PyNite_Guia_Completa.md §5.3, §9.6, §10.3)
- **Confidence:** alta

### 2.4 — NO liberar el GDL torsional Rx en ambos extremos a la vez (evitar mecanismo)
- **Claim:** **No** liberes el giro torsional `Rx` (`Rxi` y `Rxj`) en ambos extremos simultáneamente salvo que esté justificado: dejar una barra sin restricción torsional en ningún extremo crea un **mecanismo** (rotación libre de la barra sobre su propio eje, singularidad de la matriz). Para rótulas de flexión, libera **solo** `Ry`/`Rz`, manteniendo la continuidad torsional en al menos un extremo.
- **Rationale:** La fuente académica es explícita: "Releasing all rotational DOF creates an unstable mechanism lacking torsional or bending resistance." Si una barra queda con θx libre en ambos extremos y ningún otro elemento le aporta rigidez torsional, su GDL torsional no tiene rigidez → `check_stability` de PyNite lanzará inestabilidad o el solver dará singularidad. El discretizador debe imponer esta regla al traducir "articulado" (que en obra significa rótula de flexión, no liberación torsional).
- **Sources:** https://people.duke.edu/~hpgavin/cee421/frame-element.pdf · (PyNite_Guia_Completa.md §5.3, §9.8)
- **Confidence:** alta

### 2.5 — Evitar la doble rótula que vuelve hipostática la barra
- **Claim:** Cuidado con liberar el **mismo** GDL de flexión en los **dos** extremos cuando la barra no está arriostrada transversalmente por la estructura: una viga biarticulada solo es estable si los nudos a los que se conecta están sujetos en las traslaciones correspondientes; en caso contrario el GDL de traslación transversal de la barra queda sin rigidez (mecanismo). El validador debe detectar barras con releases que dejen un GDL sin rigidez aportada.
- **Rationale:** Una barra con momentos liberados en ambos extremos se comporta como bielas (solo axil). Si el resto del modelo no aporta rigidez a flexión/cortante en sus nudos, la estructura puede ser un mecanismo aunque cada apoyo aislado parezca correcto. PyNite detecta esto con `check_stability=True`, pero el objetivo del discretizador es **detectarlo antes** y reportarlo en lenguaje de obra.
- **Sources:** https://www.structuresmmm.org/methods/matrix-structural-analysis · (PyNite_Guia_Completa.md §9.6, §9.8, §13.2)
- **Confidence:** media

---

## 3. Apoyos (`supports`)

### 3.1 — Codificación de empotrado / articulado / elástico
- **Claim:** Traducción de arranques (firma `def_support(node, DX, DY, DZ, RX, RY, RZ)`, `True`=restringido):
  - **Empotrado:** `def_support(N, True, True, True, True, True, True)` — 6 GDL.
  - **Articulado (rótula fija):** `def_support(N, True, True, True, False, False, False)` — 3 traslaciones restringidas, giros libres.
  - **Elástico:** `def_support_spring(node, dof, stiffness, direction=None)` por cada GDL con rigidez de muelle (p. ej. `RZ` con rigidez rotacional para arranque semi-rígido).
- **Rationale:** Coincide con el modelo de 6 GDL por nudo. El empotramiento restringe traslaciones y giros; la rótula deja los giros libres pero impide el desplazamiento. El apoyo elástico introduce un muelle de rigidez finita (modela rigidez de cimentación/terreno).
- **Sources:** (PyNite_Guia_Completa.md §5.3) · https://pynite.readthedocs.io/en/latest/index.html
- **Confidence:** alta

### 3.2 — Pilar con `vinculacionExterior` + arranque empotrado ⇒ support en el pie
- **Claim:** Cuando un pilar tiene `vinculacionExterior == true` y `arranque == "empotrado"`, el discretizador añade `def_support` en el **nodo de arranque** (pie del pilar en la planta inicial) con los 6 GDL restringidos. `"articulado"` → 3 traslaciones; `"elastico"` → `def_support_spring`.
- **Rationale:** Es la regla del propio CLAUDE.md (§7) y el patrón estándar: el arranque de un pilar contra el terreno/cimentación es donde la estructura "se sujeta al mundo". Sin al menos un conjunto de apoyos que restrinja los 6 movimientos de sólido rígido, el modelo es un mecanismo global.
- **Sources:** CLAUDE.md §7 · (PyNite_Guia_Completa.md §5.3)
- **Confidence:** alta

### 3.3 — Sujeción suficiente: chequeo de los 6 movimientos de sólido rígido
- **Claim:** Antes de calcular, valida que los apoyos restringen como mínimo los **6 movimientos de sólido rígido** de la estructura completa (3 traslaciones + 3 rotaciones globales). Un único empotramiento ya basta; varios apoyos articulados deben restringir colectivamente las 3 traslaciones y las 3 rotaciones globales (p. ej. evitar que toda la estructura "gire" alrededor de un eje vertical por falta de restricción en planta).
- **Rationale:** Una estructura con menos restricciones que sus 6 GDL de sólido rígido tiene una matriz de rigidez singular (modos de cuerpo rígido con energía nula) → el solver falla. PyNite lo detecta con `check_stability=True`, pero el discretizador debe anticiparlo y dar el error en lenguaje de obra ("La estructura no está sujeta: añade un arranque a algún pilar").
- **Sources:** https://www.structuresmmm.org/methods/matrix-structural-analysis · (PyNite_Guia_Completa.md §9.8, §13.2)
- **Confidence:** alta

---

## 4. Cargas por hipótesis

### 4.1 — Asignación de cargas a casos (`case=`) por hipótesis
- **Claim:** Cada `Carga` del dominio pertenece a una `Hipotesis`; el discretizador traduce cada hipótesis a un **caso de carga** PyNite (`case='G'`, `'Q'`, `'W'`, …) y aplica `add_node_load` / `add_member_pt_load` / `add_member_dist_load` con ese `case`. Los resultados se almacenan por **combinación**, que suma casos ponderados.
- **Rationale:** PyNite separa "caso" (etiqueta de un grupo de cargas) de "combinación" (suma ponderada de casos). Aplicar cada hipótesis como caso permite combinarlas después con factores ELU/ELS sin recalcular las cargas. Si no se define ningún caso, todo va a `'Case 1'`.
- **Sources:** (PyNite_Guia_Completa.md §3.5, §5.4) · https://pynite.readthedocs.io/en/latest/index.html
- **Confidence:** alta

### 4.2 — Cargas puntuales, lineales y superficiales
- **Claim:** Traducción por tipo:
  - **Puntual en nudo:** `add_node_load(node, direction, P, case)` con `direction` global (`FX,FY,FZ,MX,MY,MZ`).
  - **Puntual en barra:** `add_member_pt_load(member, direction, P, x, case)` a distancia local `x`; admite dirección local o global.
  - **Lineal (distribuida):** `add_member_dist_load(member, direction, w1, w2, x1, x2, case)` (trapezoidal de `w1` a `w2`).
  - **Superficial (paño):** NO existe carga superficial de barra; se reparte a las vigas perimetrales como lineal equivalente (ver 4.4), o se aplica como `add_quad_surface_pressure` si el paño se malla con placas (Fase 3).
- **Rationale:** PyNite solo aplica cargas a nudos, barras y placas. Una "carga superficial" sobre un paño de barras debe convertirse en cargas lineales sobre las vigas que lo bordean (áreas tributarias). La carga distribuida trapezoidal cubre el caso `w1 ≠ w2`.
- **Sources:** (PyNite_Guia_Completa.md §5.4) · https://pynite.readthedocs.io/en/latest/index.html
- **Confidence:** alta

### 4.3 — Peso propio
- **Claim:** El peso propio se aplica con `add_member_self_weight(global_direction, factor, case)` que recorre TODAS las barras usando `ρ·A` del material/sección. Para gravedad: `add_member_self_weight('FY', -1, case='G')`. Requiere que materiales tengan `rho` consistente (kN/m³ si trabajas en kN-m, ojo: `rho` es densidad de **peso** o de **masa** según el uso; para peso propio estático usa peso específico).
- **Rationale:** Automatizar el peso propio evita que el usuario lo introduzca a mano por barra. Es una sola llamada que afecta a todas las barras. La dirección es global (`FY`) y el signo `-1` la dirige hacia abajo (gravedad en −Y).
- **Sources:** (PyNite_Guia_Completa.md §5.4) · https://pynite.readthedocs.io/en/latest/index.html
- **Confidence:** alta

### 4.4 — Reparto de cargas de paño a vigas (áreas tributarias)
- **Claim:** Reparto de una carga superficial `w` (kN/m²) de un paño a sus vigas perimetrales:
  - **Forjado 1-dirección:** la carga va solo a las **dos vigas paralelas a la dirección portante larga**; cada una recibe una UDL `q = w · (ancho_tributario)` = `w · L_corto/2` (mitad del ancho a cada lado).
  - **Forjado 2-direcciones (paño `L_x ≤ L_y`):** se trazan líneas a **45° desde cada esquina** → las **vigas cortas** (longitud `L_x`) reciben carga **triangular**, las **vigas largas** (longitud `L_y`) reciben carga **trapezoidal**.
  - **UDL equivalente (a efectos de momento) — viga corta (triangular):** `q_eq = w · L_x / 3`.
  - **UDL equivalente — viga larga (trapezoidal):** `q_eq = (w · L_x / 6) · [3 − (L_x/L_y)²]`.
- **Rationale:** Es el método clásico de reparto por líneas de rotura (yield lines) a 45°, estándar en cálculo de estructuras de edificación. Las fórmulas de UDL equivalente convierten la carga triangular/trapezoidal en una carga uniforme que produce el mismo momento máximo en la viga, simplificando la aplicación (`add_member_dist_load` con `w1=w2=q_eq`). Para mayor fidelidad puede aplicarse la carga trapezoidal real (`w1≠w2`) en vez de la equivalente.
- **Sources:** https://skyciv.com/technical/area-loads-in-one-way-and-two-way-systems/ · https://structville.com/2020/04/load-transfer-from-slab-to-beams-a-comparative-analysis.html · https://civilengineeronline.com/str/prob12.htm · https://knowledge.fppengineering.com/distribution-of-slab-loads-to-beams/
- **Confidence:** alta (regla 45° y fórmulas triangular/trapezoidal); media (elección UDL-equivalente vs. trapezoidal real es decisión de diseño)

---

## 5. Combinaciones (`combos`)

### 5.1 — Construcción de combos como mapa {hipótesis: factor}
- **Claim:** Cada combinación se traduce a `add_load_combo(name, factors, combo_tags)` donde `factors` es un dict `{caso: factor}`. Ejemplo ELU persistente característico (CTE, ilustrativo): `add_load_combo('ELU 1.35G+1.5Q', {'G': 1.35, 'Q': 1.5})`. ELS característica: `{'G': 1.0, 'Q': 1.0}`. Etiqueta las combos con `combo_tags` (p. ej. `['ELU']`, `['ELS']`) para filtrar en el análisis y en resultados.
- **Rationale:** PyNite calcula y almacena resultados **por combinación**. Generar las combos en el discretizador (a partir de las hipótesis y los coeficientes) deja a la UI elegir qué combinación visualizar. `combo_tags` permite analizar solo ELU o solo ELS (`combo_tags=['ELU']`). La normativa concreta (coeficientes ψ, simultaneidad) corresponde a otra área; aquí solo se construye la estructura de datos.
- **Sources:** (PyNite_Guia_Completa.md §3.5, §5.4, §6) · https://pynite.readthedocs.io/en/latest/index.html · CLAUDE.md §7, §15
- **Confidence:** alta

### 5.2 — Default `Combo 1` / `Case 1`
- **Claim:** Si el modelo no define ninguna combinación, PyNite crea por defecto `'Combo 1'` que incluye `'Case 1'` con factor 1.0. El discretizador debería **siempre** generar combos explícitas y casos con nombres de hipótesis reales, evitando depender de los defaults (mejor trazabilidad y golden tests deterministas).
- **Rationale:** Depender de defaults implícitos dificulta el testeo y la presentación. Nombrar explícitamente casos y combos hace el modelo autoexplicativo.
- **Sources:** (PyNite_Guia_Completa.md §3.5, §9.2)
- **Confidence:** alta

---

## 6. Validaciones previas en lenguaje de obra

### 6.1 — Catálogo mínimo de validaciones
- **Claim:** Antes de discretizar/calcular, validar (devolviendo errores que **apuntan al elemento de obra culpable**, sin jerga FEM):
  1. **Nombres únicos** de pilares, vigas, paños, materiales, secciones, hipótesis, combos.
  2. **Referencias válidas:** toda viga referencia nudos/sección/material existentes; toda carga referencia un ámbito existente; toda combo referencia hipótesis con cargas.
  3. **Sujeción suficiente:** existe al menos un arranque/apoyo que impide los 6 movimientos de sólido rígido (no mecanismo global).
  4. **Sin barras flotantes:** todo pilar/viga conecta con el resto (detectar nodos huérfanos → `orphaned_nodes()`).
  5. **Releases coherentes:** no liberar todos los giros que dejen un GDL sin rigidez (mecanismo local).
- **Rationale:** Es el contrato del CLAUDE.md (§7) y de la guía PyNite (§13.2). Validar en lenguaje de obra ("El pilar P3 no tiene arranque ni conexión: la estructura no está sujeta") es un diferenciador de producto frente a errores crípticos del solver. `check_stability` y `merge_duplicate_nodes` son la red de seguridad final, pero la buena UX exige detectar antes.
- **Sources:** (PyNite_Guia_Completa.md §13.2, §13.3) · CLAUDE.md §7 · https://www.structuresmmm.org/methods/matrix-structural-analysis
- **Confidence:** alta

### 6.2 — Detección de mecanismos antes del solver (heurísticas)
- **Claim:** Heurísticas baratas para anticipar mecanismos sin montar la matriz: (a) contar restricciones globales ≥ 6; (b) verificar que cada nudo libre tenga al menos una barra que aporte rigidez en cada traslación; (c) detectar cadenas de barras biarticuladas sin triangulación (mecanismo de celosía). Si las heurísticas no bastan, dejar que `check_stability=True` del solver dé el veredicto final y mapear su error a lenguaje de obra.
- **Rationale:** La detección exacta de mecanismos equivale a comprobar el rango de la matriz de rigidez (caro y ya lo hace el solver). Las heurísticas atrapan los casos frecuentes (estructura sin arranque, viga colgada) de forma instantánea y barata, mejorando la UX. El veredicto definitivo lo da el solver.
- **Sources:** (PyNite_Guia_Completa.md §9.8, §13.3) · https://www.structuresmmm.org/methods/matrix-structural-analysis
- **Confidence:** media

---

## 7. Estrategia de Golden Tests

### 7.1 — Principio
- **Claim:** Cada caso de libro con **solución analítica cerrada** se ejecuta por el pipeline completo (obra → `discretizar` → contrato FEM → PyNite → resultados) y se compara contra la fórmula exacta con tolerancia de error relativo. Para barras prismáticas, PyNite es prácticamente exacto (matriz de rigidez de viga de Euler-Bernoulli); tolerancia recomendada **< 0.1 %** en esfuerzos y reacciones, y **< 1 %** en flechas (sensibles a discretización si se subdivide la barra). El propio PyNite valida contra Timoshenko/Bedford & Fowler.
- **Rationale:** Es la red de seguridad del discretizador (el componente más crítico, CLAUDE.md §3, §13). Comparar contra fórmula cerrada detecta errores de unidades, de direcciones (global/local), de releases mal aplicados y de signo. Correr en **Node puro** (mockeando o aceptando coste de Pyodide en CI) según CLAUDE.md §13.
- **Sources:** (PyNite_Guia_Completa.md §1 filosofía, §13.5) · CLAUDE.md §13 · https://pynite.readthedocs.io/en/latest/index.html
- **Confidence:** alta

### 7.2 — Tabla de golden tests con fórmulas analíticas exactas

Notación: `q` = carga lineal (kN/m), `P` = carga puntual (kN), `L` = luz/vano (m), `E` = módulo (kN/m²), `I` = inercia (m⁴), `M` = momento (kN·m), `V` = cortante (kN), `δ` = flecha (m).

| # | Caso | Magnitud | Fórmula exacta | Fuente |
|---|------|----------|----------------|--------|
| 1 | **Viga biapoyada, carga uniforme `q`** | Momento máx (centro) | `M_max = q·L²/8` | [calcresource](https://calcresource.com/statics-simple-beam.html) · [steelcalculator](https://steelcalculator.app/reference/beam-formulas/) |
| 1 | " | Flecha máx (centro) | `δ_max = 5·q·L⁴ / (384·E·I)` | idem |
| 1 | " | Reacciones | `R_A = R_B = q·L/2` | idem |
| 1 | " | Cortante máx (apoyos) | `V_max = q·L/2` | idem |
| 2 | **Voladizo, carga puntual `P` en extremo** | Momento máx (empotr.) | `M_max = P·L` | [steelcalculator](https://steelcalculator.app/reference/beam-formulas/) · [firgelli](https://www.firgelliauto.com/blogs/engineering-calculators/cantilever-beam-calculator-uniform-distributed-load) |
| 2 | " | Flecha máx (extremo) | `δ_max = P·L³ / (3·E·I)` | idem |
| 2 | " | Reacción / momento empotr. | `R = P`, `M = P·L` | idem |
| 3 | **Voladizo, carga uniforme `q`** | Momento máx (empotr.) | `M_max = q·L²/2` | [firgelli](https://www.firgelliauto.com/blogs/engineering-calculators/cantilever-beam-calculator-uniform-distributed-load) |
| 3 | " | Flecha máx (extremo) | `δ_max = q·L⁴ / (8·E·I)` | idem |
| 4 | **Viga biempotrada, carga uniforme `q`** | Momento empotr. (extremos) | `M_emp = q·L²/12` | [testbook](https://testbook.com/question-answer/in-a-fixed-beam-having-a-uniformly-distributed-loa--5fb653fa5311885f3f48a75d) |
| 4 | " | Momento centro vano | `M_centro = q·L²/24` | idem |
| 4 | " | Flecha máx (centro) | `δ_max = q·L⁴ / (384·E·I)` | idem |
| 5 | **Viga biapoyada, carga puntual `P` en centro** | Momento máx (centro) | `M_max = P·L/4` | [calcresource](https://calcresource.com/statics-simple-beam.html) |
| 5 | " | Flecha máx (centro) | `δ_max = P·L³ / (48·E·I)` | idem |
| 6 | **Celosía (truss) biarticulada** | Axil en barras | equilibrio nodal (método de los nudos): `ΣFx=ΣFy=ΣFz=0` por nudo → axiles exactos; verificar `max_axial()` contra solución manual | [structuresmmm](https://www.structuresmmm.org/methods/matrix-structural-analysis) · (PyNite §10.3) |
| 7 | **Pórtico simple (2 pilares empotrados + dintel)** | Esfuerzos/deriva | comparar contra solución de pórtico (tablas de Kleinlogel / análisis matricial manual); validar equilibrio con `check_statics=True` | (PyNite §10.2, §6) |

**Notas de implementación de los golden tests:**
- Test #6 (celosía): liberar momentos en ambos extremos de cada barra (`def_releases` con `Ryi=Rzi=Ryj=Rzj=True`) y comprobar que solo aparece axil (cortante y momento ≈ 0). Valida 2.3/2.4.
- Test #7 (pórtico): valida orientación de ejes de pilar (2.2), continuidad de nudos compartidos (1.1) y combos (5.1). Usar `check_statics=True` para verificar equilibrio global automáticamente.
- Para todos: comprobar adicionalmente el **balance de reacciones** (Σ reacciones verticales = Σ cargas verticales) — atrapa errores de unidades y de dirección global/local.

- **Sources tabla:** ver columna "Fuente" + https://www.firgelliauto.com/blogs/engineering-calculators/simply-supported-beam-calculator-uniform-load
- **Confidence:** alta (fórmulas 1–5, estándar de resistencia de materiales); media (6–7, requieren solución de referencia construida a mano)

---

## 8. Convención de signos y direcciones (global MAYÚSCULAS / local minúsculas)

### 8.1 — Regla mayúscula/minúscula
- **Claim:** En PyNite las direcciones de carga en **MAYÚSCULAS** (`FX, FY, FZ, MX, MY, MZ`) son **globales**; en **minúsculas** (`Fx, Fy, Fz, Mx, My, Mz`) son **locales** de la barra. Restricciones por API:
  - `add_node_load`: solo global (`FX…MZ`).
  - `add_member_pt_load`: local o global.
  - `add_member_dist_load`: `Fx,Fy,Fz` (local) o `FX,FY,FZ` (global) — **no admite momentos distribuidos**.
- **Rationale:** Documentado como el **error nº1** en cargas. Una carga gravitatoria debe ir en global `FY` (negativa); una carga perpendicular a una viga inclinada que deba seguir el eje local va en minúscula. Confundirlas produce resultados plausibles pero erróneos (especialmente en barras inclinadas o pilares).
- **Sources:** (PyNite_Guia_Completa.md §3.2, §5.4, §9.3) · https://pynite.readthedocs.io/en/latest/index.html
- **Confidence:** alta

### 8.2 — Política recomendada para el discretizador
- **Claim:** Política por defecto del discretizador: aplicar **cargas gravitatorias y de paño en GLOBAL** (`FY` con signo negativo), porque la gravedad es global y no depende de la orientación de la barra. Reservar las direcciones **locales** (minúsculas) para casos explícitos donde el usuario quiera una carga perpendicular al eje de la barra (p. ej. presión sobre una viga inclinada). Documentar y testear cada conversión.
- **Rationale:** La gravedad es intrínsecamente global; usar `FY` evita que una viga inclinada reciba la carga "proyectada" incorrectamente. Para vigas horizontales `Fy` local y `FY` global coinciden en magnitud pero no en una viga inclinada — de ahí la importancia de fijar global por defecto para gravedad.
- **Sources:** (PyNite_Guia_Completa.md §3.2, §5.4) · https://www.structuresmmm.org/methods/matrix-structural-analysis
- **Confidence:** alta

### 8.3 — Signo de la gravedad y eje Y
- **Claim:** Con Y vertical, la gravedad actúa en **−Y**; las cargas gravitatorias (muertas, sobrecarga de uso, peso propio) se introducen con **valor negativo** en `FY` (o factor `-1` en `add_member_self_weight`). El discretizador debe convertir cargas de obra "hacia abajo" (positivas en la UI) a `FY` negativo en el contrato FEM, en un único punto de conversión.
- **Rationale:** Coherencia de signos: si la UI muestra cargas gravitatorias como positivas (intuición del arquitecto) y el FEM las espera en −Y, la conversión debe ocurrir una sola vez en el borde (CLAUDE.md §6, §14). Un signo equivocado invierte la deformada (la estructura "sube").
- **Sources:** (PyNite_Guia_Completa.md §3.2, §5.4) · CLAUDE.md §6, §14
- **Confidence:** alta

---

## Recomendaciones accionables

1. **Tolerancia de fusión como constante nombrada** (`TOL_NODO = 1e-3` m) y fusión determinista de nodos en el propio discretizador; usar `merge_duplicate_nodes(0.001)` solo como red de seguridad, no como mecanismo principal.
2. **Numeración determinista** de nodos/barras (ordenar por planta/x/z) para que la Capa 2 sea reproducible y los golden tests comparables.
3. **Borde de mapeo de ejes** claro: planta `(x,y)` → global `(X,Z)`; altura/cota → `Y` (vertical). Un solo módulo realiza esta transformación; testearlo con un pilar y una viga.
4. **Releases canónicos:** articulado de flexión = liberar `Ry,Rz` del extremo; biarticulado = `Ryi,Rzi,Ryj,Rzj`. **Prohibir** por defecto liberar `Rx` en ambos extremos (mecanismo torsional). Encapsular en una función `releasesDeExtremo("articulado"|"empotrado")`.
5. **Validador previo en lenguaje de obra** con el catálogo del §6.1; mapear los errores de `check_stability` de PyNite a mensajes de obra como fallback.
6. **Reparto de paños** con regla 45° (1-dir / 2-dir) y fórmulas UDL-equivalente triangular `w·Lx/3` y trapezoidal `(w·Lx/6)[3−(Lx/Ly)²]`; dejar abierta la opción de aplicar la carga trapezoidal real (`w1≠w2`) para mayor fidelidad.
7. **Cargas gravitatorias y peso propio en GLOBAL (`FY` negativo)** por defecto; locales (minúsculas) solo bajo petición explícita. Convertir el signo en un único punto.
8. **Combos explícitos y etiquetados** (`combo_tags=['ELU'|'ELS']`), nunca depender del `Combo 1` por defecto; los coeficientes concretos (1.35G+1.5Q, ψ) los provee el área de normativa.
9. **Suite golden** con los 7 casos del §7.2, ejecutada en el pipeline completo, con tolerancia <0.1 % en esfuerzos/reacciones y <1 % en flechas, y **balance de reacciones** verificado siempre (`check_statics=True`).
10. **Test específico de orientación de pilar vertical** (carga lateral en X y en Z) para fijar empíricamente la convención de ejes locales de PyNite en barras verticales — punto de confianza media que conviene resolver pronto.
11. **Discretizador 100 % puro** (sin React/IO/Pyodide) y testeable en Node, con el contrato FEM validado por Zod a la salida (CLAUDE.md §3, §8).

---

### Fuentes principales
- PyNite docs: https://pynite.readthedocs.io/en/latest/index.html · repo: https://github.com/JWock82/PyNite
- Matrix structural analysis (marco teórico): https://www.structuresmmm.org/methods/matrix-structural-analysis
- Frame element / DOF / releases (Duke, H.P. Gavin CEE421): https://people.duke.edu/~hpgavin/cee421/frame-element.pdf
- Orientación/rotación de barras: https://knowledge-base.matrix-software.com/help/matrix-frame/structure-input/structure-geometry/rotation-of-members · https://knowledge-base.matrix-software.com/help/matrix-frame/structure-input/structure-geometry/coordinate-system
- Áreas tributarias / reparto de paños: https://skyciv.com/technical/area-loads-in-one-way-and-two-way-systems/ · https://structville.com/2020/04/load-transfer-from-slab-to-beams-a-comparative-analysis.html · https://civilengineeronline.com/str/prob12.htm · https://knowledge.fppengineering.com/distribution-of-slab-loads-to-beams/
- Fórmulas de viga (golden tests): https://calcresource.com/statics-simple-beam.html · https://steelcalculator.app/reference/beam-formulas/ · https://www.firgelliauto.com/blogs/engineering-calculators/cantilever-beam-calculator-uniform-distributed-load · https://www.firgelliauto.com/blogs/engineering-calculators/simply-supported-beam-calculator-uniform-load · https://testbook.com/question-answer/in-a-fixed-beam-having-a-uniformly-distributed-loa--5fb653fa5311885f3f48a75d
- Contrato de datos PyNite y convenciones: `PyNite_Guia_Completa.md` (proyecto) · `CLAUDE.md` (proyecto)
