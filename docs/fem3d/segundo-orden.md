# Fase SO: el segundo orden global (P-Δ)

> Plan del 2026-11-08, a petición del usuario. Estaba apuntado como pendiente para la integración en `viento-sismo.md` §9: sin decidirlo no se puede armar un pilar, porque o el motor amplifica las hipótesis horizontales (como CYPECAD) o el módulo de pilares de Concreta tiene que usar β > 1 en las estructuras traslacionales. Lo medido antes de empezar está en §6 (`validacion/so/medir.ts`, `out_medir.txt`).

## 1. El problema

El motor calcula en primer orden: el equilibrio se plantea en la geometría sin deformar. En un edificio con cargas horizontales (viento, sismo), las cargas gravitatorias P que bajan por los pilares, desplazados Δ por la acción horizontal, añaden un momento P·Δ que no está en los esfuerzos. Es el **efecto P-Δ** o segundo orden **global** (el de la estructura, no el del pilar aislado, que es el de la esbeltez y lo trata la comprobación del pilar con su longitud de pandeo).

Para que los esfuerzos del motor alimenten las comprobaciones de pilares de Concreta hay dos maneras consistentes de tratarlo, y hay que elegir una:

- **(A) En la comprobación del pilar:** los esfuerzos son de primer orden, la estructura se clasifica como traslacional o intraslacional (αcr, θ) y, si es traslacional, el pilar se comprueba con una longitud de pandeo β·L con β > 1 (los nomogramas de pórticos traslacionales). Es el método «clásico» de la EHE y lo que el CE A19 §5.8.3.2 admite para pilares aislados.
- **(B) En los esfuerzos:** la estructura se analiza con el segundo orden global incluido (iterando la geometría, con la matriz geométrica, o amplificando las hipótesis horizontales) y el pilar se comprueba como intraslacional (β ≤ 1), con su segundo orden local por la curvatura nominal o la rigidez nominal. Es lo que hace CYPECAD (β = 1 por defecto) y lo que ya hace `fem2d` en Concreta (§4).

Hoy el motor sólo tiene el **aviso θ del sismo** (NCSE-02 art. 3.8, VS-k) y nada con viento solo.

## 2. Lo que dicen las normas

- **NCSE-02 art. 3.8** (ya en `src/normas/ncse02.ts`): los efectos de segundo orden se pueden despreciar si en cada planta P_k·d_k < 0,10·V_k·h_k (con d_k el desplazamiento relativo de la planta ya por μ), y no hay que considerarlos mientras el desplazamiento máximo no pase del 2 ‰ de la altura. Si no, «deberán considerarse». No dice cómo.
- **Código Estructural, Anejo 19 (EC2):**
  - §5.8.2(6) y §5.8.3.3: los efectos globales de segundo orden se pueden despreciar si F_V,Ed ≤ k₁·n_s/(n_s + 1,6)·ΣE_cd·I_c/L² (con la **rigidez nominal**, E_cd = E_cm/γ_cE, γ_cE = 1,2);
  - **Apéndice H.2:** método de la amplificación: F_H,Ed = F_H,0Ed / (1 − F_V,Ed/F_V,B), con F_V,B la carga crítica global con la rigidez nominal (H.1.2(3): 0,4·E_cd·I_c si está fisurado, 0,8·E_cd·I_c si se demuestra que no). F_V,Ed/F_V,B es el índice de estabilidad: el cociente entre el momento P·Δ y el momento volcador. Es la forma que toma el γz de CYPECAD (§3);
  - H32 de la investigación: con la rigidez bruta, αcr sale unas 3 veces optimista en el hormigón fisurado (0,4/1,2 = 1/3).
- **Código Estructural, Anejo 22 (EC3) §5.2.1(4)B:** la fórmula de planta αcr = (H_Ed/V_Ed)·(h/δ_H,Ed); con αcr ≥ 10 basta el primer orden, con 3 ≤ αcr < 10 se amplifican los efectos del desplome por 1/(1 − 1/αcr) (§5.2.2(5)B), y con αcr < 3 hace falta un cálculo de segundo orden. Es lo que hace `fem2d`.
- **EC8 §4.4.2.2(2)–(3):** θ = P_tot·d_r/(V_tot·h) con d_r el desplazamiento de cálculo (por q); θ ≤ 0,10 se desprecia, 0,1 < θ ≤ 0,2 se amplifica por 1/(1 − θ), θ ≤ 0,3 siempre.

Todas coinciden en el fondo: el índice de estabilidad Q (o θ, o 1/αcr) es el cociente P·Δ / H·z, y mientras no pase de 0,2–0,33 basta amplificar por 1/(1 − Q).

## 3. Lo que hace CYPECAD

De la memoria de cálculo de CYPECAD (CYPE Ingenieros, «Consideración de Efectos de 2º Orden (P∆)», pp. 31–34 del PDF `ccadmc01.pdf`), con sus palabras:

- Es **potestativo**: «De forma potestativa se puede considerar, cuando se define hipótesis de viento o sismo, el cálculo de la amplificación de esfuerzos producidos por la actuación de dichas cargas horizontales. Es aconsejable activar esta opción en el cálculo.» Y más adelante: «No es preciso considerar los efectos de 2º orden si γz < 1,1, aunque recomendamos siempre su activación.»
- **El método:** «basado en el efecto P-delta debido a los desplazamientos producidos por las acciones horizontales, abordando de forma sencilla los efectos de segundo orden a partir de un cálculo de primer orden, y un comportamiento lineal de los materiales, con unas características mecánicas calculadas con las secciones brutas de los materiales y su módulo de elasticidad secante.»
- **Los dos momentos:** bajo la acción horizontal H_i de cada planta i, los pilares j se desplazan Δ_ij; en cada pilar y planta actúa la carga P_ijk que le transmite el forjado en cada hipótesis gravitatoria k. El momento volcador es M_H = Σ_i H_i·z_i «respecto a la cota 0,00 o nivel sin desplazamientos horizontales», y el momento P-delta de cada hipótesis gravitatoria, M_PΔ,k = Σ_i Σ_j P_ijk·Δ_ij.
- **El coeficiente:** C_k = M_PΔ,k / M_H es «el índice de estabilidad para cada hipótesis gravitatoria y para cada dirección de la acción horizontal», y con él «se puede obtener un coeficiente amplificador del coeficiente de mayoración de la hipótesis debidas a las acciones horizontales para todas las combinaciones en las que actúan dichas acciones horizontales»: **γz = 1 / (1 − Σ γ_fg,i·C_g,i − Σ γ_fq,j·C_q,j)**, el **coeficiente de estabilidad global**, con los γ de mayoración de las permanentes y de las variables de cada combinación. (Es el γz de la NBR 6118 brasileña.)
- **El multiplicador de los desplazamientos:** como el cálculo es con secciones brutas y en ELU «parecería lógico» usar las fisuradas, «el programa solicita como dato el aumento o “factor multiplicador de los desplazamientos” para tener en cuenta esa reducción de la rigidez». Repasa los criterios: Brasil 1/(0,9·0,7) = 1,59 (γz > 1,2, rigidizar); NB-1/2000, 1,43 y γz ≤ 1,3; Código Modelo CEB-FIP 1990, rigidez al 50 %, multiplicador 2 y γz ≤ 1,5; ACI 318-95, Q por planta con γz = 1/(1 − Q) y planta intraslacional si Q ≤ 0,05, multiplicador 1/(0,7·0,8) = 1,78 y γz ≤ 1,35. Concluye: «el criterio del código modelo sería recomendable y fácil de recordar, así como aconsejable en todos los casos su aplicación: coeficiente multiplicador de los desplazamientos = 2, límite para el coeficiente de estabilidad global = 1,5». **Pero deja 1,00 por defecto:** «siempre existen en los edificios elementos rigidizantes, fachadas, escaleras, muros portantes, etc., que aseguran un menor desplazamiento frente a las acciones horizontales que las calculadas. Por ello el programa deja en 1,00 el coeficiente multiplicador de los desplazamientos.»
- **Lo que da:** «se pueden consultar los valores calculados para cada una de las combinaciones e imprimir un informe con los resultados en Listados, viendo el máximo valor del coeficiente de estabilidad global en cada dirección». Si la fórmula da 1 − ΣγC ≤ 0, «se emite un mensaje antes de terminar el cálculo, en el que se advierte que existe un fenómeno de inestabilidad global». En la práctica avisa cuando el factor de amplificación pasa de 1,33 (Q > 0,25): el método simplificado no es aplicable.
- **La sobrecarga** entra entera en P (no hay reducción automática de sobrecarga).
- **Y la consecuencia para los pilares:** «sería suficientemente seguro tomar coeficientes de pandeo = 1, con lo cual se calculará siempre la excentricidad ficticia o adicional de segundo orden como barra aislada, más el efecto amplificador P-delta del método considerado». Por eso sus coeficientes de pandeo por defecto son β = 1.

Lo que la memoria no dice y el usuario sí: **con el sismo, los desplazamientos van por la ductilidad μ** (como en el θ del art. 3.8). Se toma así (SO-d).

**Los listados del ejemplo 11 no lo llevan:** los dos están calculados con «No se realiza análisis de los efectos de 2º orden», y su sección 5 (9 en el segundo) sale vacía. Para la sombra (§9, SO6) hace falta un listado con la opción activada y su informe de factores de amplificación.

## 4. Lo que hace ya Concreta

- **`fem2d`** (`src/features/fem2d/checks.ts`, `methodology.ts`): αcr por la fórmula de planta del CE A22 §5.2.1(4)B con una sonda lateral unitaria, **con la rigidez nominal del hormigón** (EI = 0,4·E_cd·I_c, E_cd = E_cm/1,2: «con la bruta, αcr salía unas 2,6 veces optimista») y E_0,05 en la madera; con 3 ≤ αcr < 10, los factores de W y E de cada combinación de ELU se multiplican por k = 1/(1 − 1/αcr); con αcr < 3, fila roja pidiendo un cálculo de segundo orden; con E y αcr < 5 (θ > 0,2), lo mismo por EC8. Las cargas nocionales de imperfección del A22 §5.3.2 (H = φ·V por planta) van con el mismo k. Y la regla de las barras: «pandeo y vuelco usan la longitud de sistema (β = 1) por barra; los modos traslacionales más largos que la barra se cubren por la vía global (αcr + imperfección + amplificación), no bajando β». **Es la alternativa (B), ya tomada en Concreta.**
- **`rc-columns`** (`src/lib/calculations/rcColumns.ts`): el método de la curvatura nominal del CE A19 §5.8.8 con L_k = β·L; β es un dato del usuario, 1 por defecto (entre 0,5 y 4); la esbeltez límite λ_lim y la excentricidad e₂ = (1/r)·L_k²/10 (c = 10). Con β = 1 comprueba el pilar como **intraslacional**: le corresponde recibir esfuerzos con el segundo orden global ya dentro.

Así que la alternativa (A) obligaría a que `rc-columns` clasificara y recibiera β > 1 (lo que la memoria de CYPECAD llama «engorroso y prácticamente inabordable»: las rigideces de las barras en cada extremo del pilar) y a que el pórtico 2D y el 3D trataran el mismo pilar de dos maneras.

## 5. Las alternativas y el veredicto

| | Qué | A favor | En contra |
|---|---|---|---|
| **A** | β > 1 en los pilares de estructuras traslacionales; el motor sólo clasifica (αcr, θ) | nada que cambiar en los esfuerzos | Concreta no lo hace así (§4); β de pórtico traslacional en 3D con losas no tiene nomograma; los esfuerzos de vigas, losas y muros se quedan sin el segundo orden; distinto de CYPECAD |
| **B1** | **amplificar las hipótesis horizontales con el γz de CYPECAD** (un coeficiente por hipótesis horizontal y combinación), en las consultas | lo que hace CYPECAD y, en el fondo, `fem2d`; la superposición se conserva (el coeficiente multiplica el factor del caso en la combinación); el CE lo admite (A19 H.2, A22 §5.2.2(5)B); se compara con el listado de CYPECAD; coste nulo en el cálculo | es el método simplificado: vale mientras Q ≤ 0,25–0,33; amplifica igual todo el edificio (un coeficiente, no uno por planta); no mete el P-Δ en la forma de la deformada |
| **B2** | P-Δ geométrico: K − K_G con K_G de una combinación gravitatoria de referencia (como el «P-Delta con caso inicial» de SAP2000/ETABS), y todos los casos lineales sobre esa rigidez | riguroso en la distribución planta a planta y entre pórticos; cambia también los periodos | rompe la independencia de los casos respecto de la carga gravitatoria (una rigidez por nivel de carga: ELU y ELS no comparten factorización, o se elige una); hace falta la K_G de las láminas (muros) además de la de las barras; la regla de oro 2 tiene que sumar el momento P·Δ; una fase de motor entera con sus oráculos |
| **B3** | iterar la geometría por combinación | el más exacto | una factorización por combinación (de 16 a 80): fuera de alcance en el móvil; sin superposición, nada de lo que hay sirve |

**Veredicto: B1,** la amplificación con el coeficiente de estabilidad global por hipótesis y combinación, en las consultas, con la clasificación y los avisos que marcan dónde deja de valer. B2 queda como mejora posible si la sombra con CYPECAD o un modelo del usuario enseñan que el coeficiente único se queda corto en alguna planta. Para la integración, la regla es la de CYPECAD y la de `fem2d`: **Concreta comprueba los pilares con β = 1** (o el de intraslacional que decida) sobre los esfuerzos ya amplificados; el motor lo dice en una hipótesis del cálculo.

## 6. Lo medido antes de empezar

`validacion/so/medir.ts` calcula con el motor de hoy, por hipótesis horizontal, M_H = Σ H·z, M_Pδ = Σ P·δ con la rigidez bruta y la carga gravitatoria casi permanente (la masa del modal: G + ψ·Q), C = M_Pδ/M_H, la θ máxima de planta y el γz con varios multiplicadores de los desplazamientos m y de la carga γg (≈ 1,4 en ELU). Las cargas por planta son aquí la masa del modal por g, no van por caso: es una medida de orden de magnitud (`out_medir.txt`).

| modelo | hipótesis | C (bruta) | αcr = 1/C | θ máx | γz (m = 1, γg = 1,4) | γz (m = 2, γg = 1,4) | γz (m = 3, γg = 1,4) |
|---|---|---|---|---|---|---|---|
| Ejemplo 11 (3 plantas, reticular, pilares 30 × 30) | viento (8 casos) | 0,0219 | 45,7 | 0,022 | 1,032 | 1,065 | 1,101 |
| | sismo EX, EY (μ = 2) | 0,0419 | 23,8 | 0,046 | 1,062 | 1,133 | 1,214 |
| Edificio objetivo (7 plantas, losas) | viento | 0,012–0,013 | 76–81 | 0,018 | 1,019 | 1,038 | 1,058 |
| | sismo EX, EY (μ = 2) | 0,024–0,025 | 40–42 | 0,036 | 1,036 | 1,075 | 1,117 |

Lo que se ve:

- con la rigidez bruta y el multiplicador 1,00 de CYPECAD, el segundo orden es del **3 al 6 %** en estos dos edificios (y la θ del art. 3.8 queda en 0,02–0,05, lejos del 0,10);
- con la rigidez nominal del CE (m = 3), pasa del **10 al 21 %**, y en el ejemplo 11 el αcr nominal del sismo baja a 7,9 (CE A22: amplificar) con θ = 0,137 (NCSE/EC8: considerar);
- el sismo pesa el doble que el viento en los dos (C del sismo ≈ 2·C del viento), por la ductilidad en los desplazamientos;
- **ninguno de los dos es intraslacional** con el criterio de la NBR (γz ≤ 1,1) si se cuenta la rigidez nominal, y el edificio objetivo sí lo es con la bruta. Es la diferencia que H32 anunciaba.

En los dos edificios la amplificación es un coeficiente de un dígito por ciento con m = 1: lo que de verdad decide el método es el multiplicador (SO-c).

## 7. Propuesta

### 7.1 Las definiciones

Con el modelo analítico y los resultados por caso de hoy, sin tocar el cálculo:

- **Hipótesis horizontales:** los casos cuya acción es de viento (W) o de sismo (E), escritos a mano o del programa (los lógicos EX±e, EY±e también). Las demás (G, Q, S, T, A) son las **gravitatorias** k.
- **Dirección e_h** de una hipótesis horizontal h: la de su acción (`direccion`) o, si no la lleva, la de su cortante en la base.
- **Momento volcador:** M_H,h = Σ_v (F_v,h · e_h)·(z_v − z₀), sumado en los nudos v con las fuerzas nodales equivalentes del caso (las que ensambla el cálculo: las puntuales, el reparto de las cargas de barra y de lámina), y z₀ el **nivel sin desplazamientos horizontales**: la cota más baja de los apoyos con alguna coacción horizontal. Como en CYPECAD, Σ H_i·z_i.
- **Momento P·δ:** M_Pδ,k,h = Σ_v P_v,k·(δ_v,h · e_h), con P_v,k la carga vertical hacia abajo del caso gravitatorio k en el nudo v (su fuerza nodal equivalente) y δ_v,h el desplazamiento horizontal de ese nudo en la hipótesis h, por el multiplicador de los desplazamientos m. Es el Σ P_ij·Δ_ij de CYPECAD nudo a nudo (lo que los nudos de la losa cargan baja por los pilares con el desplazamiento del diafragma, y los nudos de un muro entre forjados con el suyo), y es exacto en un edificio con diafragmas: Σ_plantas P_encima·Δ_planta = Σ_plantas P_planta·δ_planta.
- **Con el sismo,** las dos sumas son variables lineales en cada modo: se combinan modo a modo con la regla del cálculo (CQC) como cualquier otra variable (VS-e), y el desplazamiento lleva μ (3.6.2.2). El torsor de la excentricidad accidental (un caso estático dentro del lógico) entra como lo que es.
- **Índice de estabilidad de una combinación c y una hipótesis h:** Q_h(c) = Σ_k γ_k(c)·M_Pδ,k,h / M_H,h, con γ_k(c) el factor del caso gravitatorio k en esa combinación (en ELU, 1,35·G + 1,5·ψ·Q; en ELS, 1·G + ψ·Q). **Coeficiente de estabilidad global:** γz,h(c) = 1 / (1 − Q_h(c)). **αcr equivalente:** 1/Q (con γ = 1), para hablar el idioma del A22 y de `fem2d`.
- **La amplificación:** en cada combinación del generador, el factor de cada hipótesis horizontal se multiplica por su γz,h(c). Todo lo de esa hipótesis sale amplificado: esfuerzos, reacciones, desplazamientos y desplomes, en ELU y en ELS (como en CYPECAD, «para todas las combinaciones en las que actúan dichas acciones horizontales»). Un caso suelto (`--caso W+X+e`) o una expresión escrita a mano no se amplifican: son lo que dicen.

### 7.2 Dónde vive

- **Motor** (SO1): de cada caso estático, dos cosas pequeñas que hoy no guarda: la resultante de sus cargas (ΣF y Σ z·F_x, Σ z·F_y, para M_H) y el **trabajo P·δ** con cada caso gravitatorio, Σ_v (−F_z,v,k)·[u_x,v, u_y,v] (2 números por caso gravitatorio). De cada modo, lo mismo con sus fuerzas de inercia y su forma. Son 2·n_casos números por caso: van en la cabecera de los resultados guardados (`.fem/`), y unos resultados sin ellos se recalculan una vez, como con la firma. El cálculo no cambia ni un bit; sólo hay un bucle más por caso sobre los nudos.
- **Consultas** (SO2): `Consultas.segundoOrden()` da, por hipótesis horizontal, M_H, M_Pδ por caso gravitatorio, C_k, y por combinación Q y γz; `Consultas.combinaciones()` devuelve las combinaciones del generador **con los factores ya amplificados** y, en cada una, los coeficientes que ha aplicado (`amplificacion`). Como el agente, el visor, el informe y los mapas piden las combinaciones ahí, todos lo heredan sin tocar una línea: envolventes, ternas pésimas, Wood–Armer de las franjas, flechas, desplomes y reacciones. Un vector de factores escrito a mano sigue tal cual.
- **Dato** (SO2): `acciones.segundoOrden` en el modelo físico: `amplificar` (por defecto, sí) y `multiplicadorDesplazamientos` (m, por defecto 2). En la huella, como el resto de las acciones.
- **Agente** (SO3): `fem consultar segundo-orden`, el coeficiente máximo por dirección en `fem calcular`, la sección del informe de `fem revisar` («Segundo orden») y la hipótesis del cálculo, que dice el método, m, qué casos se amplifican y que los pilares se comprueban con β = 1.
- **App** (SO4): en la ficha «Viento y sismo», el bloque «Segundo orden» (activar, multiplicador, con su ayuda); en Resultados · Modal (o donde se vean los cortantes de planta), la tabla de γz por hipótesis y combinación; en el selector de combinaciones, la etiqueta dice «×γz».

### 7.3 Los avisos

- **`segundo-orden/traslacional`** (info): con Q_máx > 0,09 (γz > 1,10, αcr < 11), la estructura es traslacional en esa dirección y los esfuerzos de las hipótesis horizontales van amplificados por γz (la NBR 6118 y la memoria de CYPECAD: por debajo de 1,1 «su efecto será pequeño y prácticamente despreciable»).
- **`segundo-orden/fuera-del-metodo`** (aviso): con Q_máx > 0,25 (γz > 1,33, lo que avisa CYPECAD; el A22 corta en αcr < 3, Q > 0,33; EC8 en θ > 0,2): el método de la amplificación no es aplicable, hace falta un cálculo de segundo orden; los resultados salen igualmente amplificados.
- **`segundo-orden/inestable`** (error): con Q ≥ 1 en alguna combinación, la fórmula no da coeficiente: inestabilidad global. Esa combinación no se da.
- **`sismo/segundo-orden`** (el θ del art. 3.8, ya existe): se queda como está, y su mensaje dice que el cálculo lo tiene en cuenta por el coeficiente de estabilidad global cuando `amplificar` está activo.
- **Desactivado** (`amplificar: false`): la hipótesis del cálculo lo dice y, si Q_máx > 0,09, el aviso `segundo-orden/sin-amplificar` recuerda que los pilares necesitan entonces β > 1.

## 8. Decisiones

Propuestas el 2026-11-08, con la recomendación delante:

- **SO-a, el método:** B1, el coeficiente de estabilidad global por hipótesis horizontal y combinación, en las consultas, como CYPECAD y `fem2d`; para la integración, Concreta comprueba los pilares con β = 1 sobre los esfuerzos amplificados. No β > 1 (A), no la matriz geométrica (B2, posible después).
- **SO-b, por defecto activado** (`amplificar: true`) en cuanto hay hipótesis horizontales con acción W o E. CYPECAD lo deja desactivado y «recomienda siempre su activación»; aquí, como la integración dará por hecho β = 1, dejarlo apagado sería el fallo silencioso. Con `false`, todo como hoy, bit a bit, y un aviso.
- **SO-c, el multiplicador de los desplazamientos:** **2 por defecto** (el Código Modelo CEB-FIP 1990, lo que la memoria de CYPECAD recomienda como «fácil de recordar»), con 1 (lo que CYPECAD trae por defecto: la rigidez bruta) y 3 (lo estricto del CE A19 H.1.2(3) para hormigón fisurado: 0,4·E_cd·I_c; 1,5 sin fisurar) como las otras dos opciones nombradas en la ayuda. Para la sombra con CYPECAD se pone el de su listado. Medido en §6: en los dos edificios, 1 → 2 pasa del 3–6 % al 7–13 %.
- **SO-d, qué entra:** el P·δ nudo a nudo con las fuerzas nodales equivalentes de cada caso gravitatorio (§7.1), z₀ en los apoyos horizontales más bajos, la sobrecarga entera (sin reducción, como CYPECAD), los desplazamientos del sismo por μ y la combinación modo a modo con la regla del cálculo.
- **SO-e, qué se amplifica:** todo lo de la hipótesis horizontal (esfuerzos y desplazamientos), en todas las combinaciones del generador (ELU y ELS); los casos sueltos y las expresiones a mano, no.
- **SO-f, los umbrales de los avisos:** 1,10 (traslacional, info) y 1,33 (fuera del método, aviso), §7.3.
- **SO-g, fuera:** las cargas nocionales de imperfección (A22 §5.3.2, que `fem2d` sí pone) y el segundo orden por planta (θ_i por planta como coeficiente, en vez del global): se apuntan en §10.

## 9. Tramos y criterios

| tramo | qué | criterio |
|---|---|---|
| **SO1** | el motor guarda por caso la resultante de sus cargas y el trabajo P·δ con cada caso gravitatorio; también por modo; en los resultados guardados | 1. en un pórtico con cargas nodales, el trabajo P·δ del motor es Σ P·u a 1e-12; con cargas de barra y de lámina, el de sus equivalentes (la resultante, la real); 2. los casos y los modos, bit a bit los de antes; 3. unos resultados guardados sin él se recalculan y lo llevan |
| **SO2** | `acciones.segundoOrden`, `Consultas.segundoOrden()`, las combinaciones amplificadas, los avisos | 4. en un edificio de cortante de 3 plantas, γz a 1e-10 del de la fórmula a mano con los desplazamientos y las cargas de planta; 5. con `amplificar: false`, o sin hipótesis horizontales, las combinaciones y todas las consultas bit a bit; 6. metamórficas: Q lineal con la carga gravitatoria y con m, invariante con la escala de la carga horizontal; γz de EX igual con la excentricidad +e y −e en un edificio simétrico; 7. **oráculo externo:** un pórtico de 3 plantas en OpenSeesPy con `geomTransf PDelta` (y `Corotational`), gravedad más viento: los momentos y cortantes de los pilares del motor amplificados por γz frente al segundo orden de OpenSees, a ≤ 3 % con Q ≈ 0,05–0,10 (y se mide hasta dónde sigue valiendo con Q de 0,2 y 0,3) |
| **SO3** | CLI, informe, hipótesis, skill | 8. `fem consultar segundo-orden` y la sección del informe dan lo de las consultas bit a bit; la skill lo explica |
| **SO4** | la app | 9. la ficha escribe el campo y la tabla enseña lo de la consulta; banco de Chrome: lo de Node |
| **SO5** | la sombra con CYPECAD (el ejemplo 11 con los efectos de 2º orden activados, m = 1 y m = 2) | 10. los γz por combinación del listado frente a los del motor, con la misma rigidez; y la diferencia en los esfuerzos de los pilares con sismo |

El coste de la fase en ecuaciones es cero (el modelo analítico no cambia). El tiempo, como información: un bucle sobre los nudos por caso en el motor y unas sumas por combinación en las consultas.

## 10. Fuera de esta fase

- Las **cargas nocionales de imperfección** del A22 §5.3.2 (H = φ·V por planta) y la imperfección global del A19 §5.2 (θ_i = 1/200·α_h·α_m): `fem2d` las pone; aquí irían como casos N del generador (ya previstos: `TipoAccion` N, `derivadoDe`). Cuando se integren las comprobaciones de acero.
- El **coeficiente por planta** (θ_i de cada planta en vez del γz global): el A22 §5.2.2(5)B amplifica por planta; CYPECAD, globalmente. Si la sombra enseña plantas blandas (una planta baja diáfana), se mide.
- El **P-Δ geométrico** (B2) y los **periodos con la rigidez fisurada** (EC8 §4.3.1(7), la mitad de la bruta; NCSE-02 no lo pide).
- La **reducción de sobrecarga** en P (CYPECAD tampoco la hace).

## 11. Hecho (2026-11-08): SO1–SO4

Implementado el mismo día con las decisiones de §8 tal como se proponían (**pendientes de confirmar por el usuario**: si cambia SO-b o SO-c, es un valor por defecto en `src/compilador/segundoOrden.ts`).

**Lo que hay en el repo:**
- **Motor** (`src/motor/calcular.ts`, `modelo.ts`): cada caso lleva `cargas` (`CargasCaso`): la resultante de sus fuerzas nodales equivalentes, `F` = [ΣFx, ΣFy, ΣFz] y `zF` = [Σ z·Fx, Σ z·Fy], y `pdelta`, el trabajo P·δ con cada caso del modelo, Σ_v P_v,k·[ux_v, uy_v] (2 números por caso). Los modos también (con sus fuerzas de inercia en los maestros y su forma), y los casos base de los modos lo heredan (`casosModales`). Es un bucle más sobre los nudos por caso; los casos no cambian ni un bit (las referencias congeladas del motor, idénticas). En los resultados guardados va en la cabecera (`CargasCabecera`, con `pdelta` como lista); unos resultados sin ello se recalculan una vez, como con la firma.
- **El dato:** `acciones.segundoOrden` (`SegundoOrdenEdificio`: `amplificar`, `multiplicadorDesplazamientos`), en los dos esquemas; el multiplicador fuera de (0, 10] es un error de `validar` (`segundo-orden/multiplicador`).
- **El cálculo** (`src/compilador/segundoOrden.ts`, puro): `calcularSegundoOrden` con las definiciones de §7.1 (z₀, dirección con el sentido del cortante en la base, M_H, M_Pδ,k y C_k por hipótesis; con el sismo, `Superposicion.valor` combina cada suma modo a modo, los desplazamientos por μ); `coeficientes` (Q y γz de una combinación), `amplificar` (la combinación con los factores por su γz y `amplificacion`), `maximos`, `diagnosticosSegundoOrden` e `hipotesisSegundoOrden`.
- **Consultas:** `combinaciones()` devuelve las del generador ya amplificadas (todas las situaciones, ELU y ELS), `combinacionesGeneradas()` las de primer orden, `coeficientesSegundoOrden(factores)` y `segundoOrden()` (el detalle de `fem consultar segundo-orden`, con los avisos). Todo lo que pide las combinaciones hereda la amplificación: envolventes, ternas pésimas, Wood–Armer de las franjas, flechas, desplomes, reacciones, mapas y el informe. `Combinacion.amplificacion` dice qué se aplicó.
- **Agente:** `fem consultar segundo-orden [--top N | --todos]` (las combinaciones de mayor Q), `fem calcular` con el máximo por hipótesis y los avisos, la sección «Segundo orden global (P-Δ)» del informe de `fem revisar` (dentro de «Viento y sismo del programa», también con hipótesis horizontales escritas a mano), la hipótesis del cálculo y la skill.
- **App:** la pestaña «Segundo orden» de la ficha «Viento y sismo» (activar, multiplicador, con sus ayudas y el resumen del modelo aplicado) y la sección en Resultados · Modal, por el pedido `segundo-orden` (`DatosSegundoOrden`).

**Criterios (§9):**

| criterio | estado |
|---|---|
| 1 | pasa: `segundoOrden.test.ts`, la resultante y Σ P·u de cada caso y de cada modo a 1e-12 (con cargas nodales, exacto) |
| 2 | pasa: las referencias congeladas del motor, idénticas |
| 3 | pasa: `desempaquetarResultados` rechaza los guardados sin `cargas` con su motivo, y la CLI recalcula |
| 4 | pasa: Q y γz a 1e-10 de la fórmula a mano en cada combinación del generador, y los factores amplificados bit a bit con los demás intactos |
| 5 | pasa: con `amplificar: false` o sin hipótesis horizontales, las combinaciones son las del generador bit a bit, y el resto de la batería (2 903 pruebas) sin cambios salvo los tres tests que comparaban las combinaciones con el generador (ahora lo hacen con `combinacionesGeneradas()` y comprueban además el γz) |
| 6 | pasa: Q lineal con la carga gravitatoria y con el multiplicador e invariante con la escala del viento; EX+e, EX−e, EY+e y EY−e con la misma C en el edificio simétrico (1e-6) |
| 7 | **pasa, mejor de lo pedido:** el oráculo de OpenSeesPy (abajo) |
| 8 | pasa: la consulta y el informe salen de `Consultas.segundoOrden()`; la skill lo explica |
| 9 | en vitest (`app/src/test/segundoOrden.test.tsx`: la ficha escribe sólo lo que no es lo de por defecto, lee lo del fichero y rechaza el multiplicador fuera de rango); **el banco de Chrome no se ha pasado** |
| 10 | **pendiente del usuario:** el listado de CYPECAD del ejemplo 11 con los efectos de 2º orden activados (con el multiplicador 1,00 que trae y con 2) |

**El oráculo externo (criterio 7, `validacion/so/oraculo_pdelta.py`, `src/compilador/oraculo-so.test.ts`):** el edificio de 3 plantas de `validacion/so/modelos.ts` (2 × 2 vanos de 6 m, pilares de 40 × 40, vigas de 30 × 50, cargas como puntuales en los pilares), compilado sin empotramiento parcial y sin áreas de cortante, en OpenSeesPy 3.8 con `elasticBeamColumn`, `-jntOffset`, `rigidDiaphragm` y `geomTransf PDelta`: la gravedad (γ_G = 1,35·g, γ_Q = 1,05·g) y después el viento (1,5·W+) con la rigidez geométrica de los axiles; el efecto del viento con P-Δ entre el lineal, frente al γz del motor con esos factores y el multiplicador 1 (el P-Δ es elástico). El primer orden coincide a 1e-6 (los momentos del viento en la base).

| g | Q | γz del motor | OpenSees: ΣM base P-Δ / lineal | OpenSees: u alto P-Δ / lineal |
|---|---|---|---|---|
| 1 | 0,0084 | 1,0085 | 1,0084 | 1,0076 |
| 2 | 0,0168 | 1,0171 | 1,0169 | 1,0153 |
| 4 | 0,0336 | 1,0347 | 1,0343 | 1,0310 |
| 6 | 0,0503 | 1,0530 | 1,0523 | 1,0473 |
| 12 | 0,1007 | 1,1119 | 1,1101 | 1,0995 |
| 20 | 0,1678 | 1,2016 | 1,1975 | 1,1782 |

El coeficiente único da la amplificación de los momentos de la base de los pilares a ≤ 0,1 % hasta Q = 0,10 y a +0,3 % con Q = 0,17 (los nueve pilares, entre 1,1954 y 1,1988 frente a 1,2016), y la del desplazamiento de la planta alta queda un 1–2 % por debajo (el P-Δ amplifica más abajo que arriba; el coeficiente único reparte igual). Del lado seguro en lo que dimensiona, y dentro del 3 % del criterio hasta mucho más allá del 0,10 de Q.

**En el ejemplo 11** (`fem consultar segundo-orden`, multiplicador 2): z₀ = 0; el viento, M_H = 907,5 kN·m, C = 0,0256 (PP), 0,0136 (CM) y 0,0092 (Qa), Q máx. 0,067 y γz = 1,072 en ELU-PT; el sismo, M_H = 2 427 kN·m (el cortante combinado, 354 kN), C = 0,0503 / 0,0268 / 0,0181, Q máx. 0,083 y γz = 1,090 en ELU-SIS (la gravedad va con γ = 1 y ψ₂·Q). Menos que la estimación de §6 con γg = 1,4, porque las combinaciones sísmicas no mayoran la gravedad. Ningún aviso de traslacional (γz < 1,10).

**Las referencias congeladas:** la de C5 `pilares-mezclados` tiene viento y sus bandas van con `q.combinaciones()`, así que lleva `amplificar: false` en `validacion/c5/congelar.ts` y sale idéntica; las de F no cambian (su Wood–Armer va con factores escritos). No se ha añadido una referencia `-so` con la amplificación porque el árbol tenía a medias la regeneración de la de F de otra sesión (PB-11); queda para cuando esté limpio.

**Pendiente:**
- SO5, la sombra con CYPECAD (criterio 10) y el banco de Chrome (criterio 9).
- Una referencia congelada `-so` con la amplificación (C5 o F).
- El coeficiente por planta y las cargas nocionales (§10), y la θ de planta con viento en la consulta (hoy sólo la del sismo, NCSE-02 3.8).
- `fem consultar franja` y las bandas dan ya los valores amplificados sin decirlo: que la CLI y la app digan «×γz» en la etiqueta de las combinaciones del selector.
