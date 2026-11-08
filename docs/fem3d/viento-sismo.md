# VS: viento y sismo generados desde la situación

> **Fecha:** 2026-11-06. **Estado:** decidido el 2026-11-06 (§8); VS1 (§10), VS2 (§11), VS3 (§12) y VS4 (§13), hechos; VS5 (en sombra con el CYPECAD del usuario), primera sombra con el ejemplo 11 (§14).
>
> **Origen:** el usuario, el 2026-11-05: viento y sismo «como en CYPECAD». Hoy son casos con las cargas metidas a mano, y el sismo, como fuerzas estáticas equivalentes con signo (`investigacion/03-resultados.md`, RES-13).

## 1. Lo que hay hoy

**En este repositorio:**
- **Casos con su acción** (`CasoFisico.accion`: tipo `W` o `E`, dirección, signo, familia) y **el generador CTE/NCSE** (`src/combinaciones/`, `combinaciones.md`).
  - La situación sísmica (DB SE 4.5) ya está, con el 100/30 en dos direcciones y el ± de cada una.
  - La excentricidad accidental ya va como una familia por dirección (`EX+e`, `EX-e`), y el viento en cuatro direcciones, como una familia excluyente.
  - Para casos estáticos no hay que tocarlo.
- **Una puntual sólo horizontal en una losa con diafragma rígido** va al nudo del diafragma con su Mz de transporte (SP-5), exacta.
- **Diafragma rígido por planta** (C1-d, C2-f), salvo en la más baja. `"ninguno"` es el forjado semirrígido de la membrana.
- **Periodos por condensación exacta** a los GDL de los diafragmas (`src/pruebas/modal.ts`, E6):
  - la flexibilidad sale de una solución estática por GDL con masa;
  - modos con masa diagonal, participación, y combinaciones SRSS, CQC, ABS y NRC 10 %.

  Con ellos pasan SAP2000 1-022 y 1-024 (periodos y espectro). **No es código del motor:** es lo que E6 llamó «el modal de E7, todavía no».
- **El núcleo** factoriza una vez y resuelve con varios lados a la vez (`nrhs`), y `memoriaRequerida(nrhs)` dice antes si cabe.
- **Las plantas** tienen la cota ±0,00 (`moverCota`).

**En Concreta** (`../Concreta EST/concreta-v2`). Se copia citando el fichero de origen, nunca se importa (regla de independencia):
- **Viento del DB SE-AE por plantas:** `src/lib/acciones/viento.ts`, con `tablasAE.ts`, `dosAguas.ts`, `paramentos.ts` y `provincias.ts`.
  - qb por zona, o tecleado;
  - ce(z) por la fórmula D.2 a la altura de cada forjado;
  - cp y cs de la tabla 3.5 por la esbeltez;
  - banda tributaria de media planta por debajo y por encima;
  - rozamiento (3.3.2-3), hastial y faldones de una cubierta a dos aguas, y excentricidad del 5 % (3.3.2-2).

  Sus pruebas están en `src/test/acciones/viento.test.ts` (488 líneas) y `tablasAE.test.ts`. La zona eólica por provincia (la de la capital, con aviso de frontera) está en `provincias.ts`.
- **NCSE-02:** `src/lib/codes/seismic/` (`ncse02.ts`, `applicability.ts`, `types.ts`).
  - El emplazamiento: C ponderado en 30 m, S y ac.
  - La obligatoriedad (1.2.3) y si se puede usar el método simplificado (3.5.1).
  - β = ν/μ y las ductilidades típicas.
  - El método simplificado entero (3.7) y las ocho combinaciones direccionales.

  Pruebas en `src/test/calc/ncse02Chain.test.ts` y `ncse02Applicability.test.ts`, con sus fixtures.
- **Peligrosidad sísmica por municipio:** `src/features/seismic-ncse02/ncse02.hazard.json` (116 KB), con ab y K de cada municipio. Viene del IGN (CC BY 4.0), completado con el Anejo 1 del BOE, y su manifiesto lleva el sha256.
- **Las publicaciones de los módulos** (`src/lib/pub`), visto el 2026-11-06 a indicación del usuario. Es lo que leerá el FEM al integrarse, en lugar de pedir los datos otra vez:
  - `PubSismo` (`features/seismic-ncse02/state.ts`, v1): municipio e INE, ab, K, importancia, ρ, terreno, C, S, ac, TA, TB, sistema, μ, Ω, plantas y H, y `metodo`. **Su valor por defecto es `"programa"`:** Concreta da el emplazamiento y el espectro, y el cálculo lo hace un programa. Ese programa es este motor;
  - `PubVientoNieve` (`features/viento-nieve/state.ts`, v1): provincia, municipio, altitud, zona, qb y su origen, aspereza, H, las dos direcciones y las fuerzas por planta.

  Por eso `acciones.viento` y `acciones.sismo` (§3) llevan los mismos campos con los mismos nombres de concepto que esas publicaciones: integrarse será leer el sobre, no traducirlo. `sismoPub.ts` (cargas por planta) enseña cómo se lee un sobre y por qué se compara el emplazamiento (el «dato fantasma» del ejemplo de Granada).

## 2. Lo que dice la norma y manda en el diseño

**Viento (CTE DB SE-AE 3.3 y Anejo D).** En un edificio de pisos con forjados que atan las fachadas, el análisis global va con los coeficientes eólicos globales (cp a barlovento, cs a sotavento) sobre la proyección del edificio. Es lo que hace `viento.ts`: una fuerza por planta y dirección. Las presiones locales por zonas (D.3–D.6) son para dimensionar los elementos de fachada y cubierta, no para el pórtico.

**Sismo (NCSE-02**, en `../Concreta EST/sismo ejemplos/NCSE02 bonita.pdf`**):**
- **3.2, masas:** la estructura, las permanentes y una fracción de las variables:
  - 0,5 en viviendas, hoteles y residencias;
  - 0,6 en edificios públicos, oficinas, comercios y locales de aglomeración;
  - 0,5 la nieve que permanece más de 30 días al año;
  - 1,0 en almacenes, tabiquería y depósitos.

  Además, en cada planta, una **excentricidad adicional de al menos 1/20 de la mayor dimensión de la planta**, perpendicular al sismo.
- **3.4:**
  - situación accidental con γ = 1;
  - el 100/30 en dos direcciones;
  - «las solicitaciones verticales y en planta se podrán considerar como casos de carga independientes», que es lo que permite superponer.
- **3.5:** el análisis por espectros de respuesta (3.6.2) es **el método de referencia**. El simplificado (3.7) sólo vale con las condiciones de 3.5.1.
- **3.6.2.1:** con forjados rígidos en su plano, **tres GDL por planta**. Es lo que ya tenemos.
- **3.6.2.2:**
  - la aceleración del modo i es a = αᵢ·ηᵢⱼ·ac, con αᵢ = α(Tᵢ)·β si Tᵢ ≥ TA y 1 + (2,5·β − 1)·Tᵢ/TA si Tᵢ < TA (corregido con VS3: el plan decía α(Tᵢ) y 1 + 1,5·Tᵢ/TA, por β; VS3-1);
  - **esa rama ascendente no está en el simplificado** (3.7.3), y Concreta lo avisa: son dos funciones distintas y no se cambian una por otra;
  - los desplazamientos se multiplican por μ.
- **3.6.2.3.1:** como mínimo, 4 modos en un modelo espacial (2 traslacionales y 2 rotacionales) y todos los de periodo mayor que TA.
- **3.6.2.4:** SRSS **«para toda variable asociada a cada grado de libertad (desplazamientos, solicitaciones, tensiones…)»**. Los modos con periodos que difieren menos del 10 % se suman antes en valor absoluto («puede aplicarse»). El articulado no nombra la CQC, pero su comentario sí (C.3.6.2.4, p. 38 de la edición de Fomento; corregido el 2026-11-08, antes aquí se decía que no la nombraba): «Las reglas establecidas en el articulado son una simplificación de la expresión general» S = √(Σᵢ Σⱼ Sᵢ·Sⱼ·πᵢⱼ), con πᵢⱼ = 8·(Ω/100)²·(1 + f)·f^(3/2) / [(1 − f²)² + 4·(Ω/100)²·f·(1 + f)²] y f = Tᵢ/Tⱼ (el texto imprime Tᵢ/Tᵢ, una errata). Es la CQC de `correlacionCqc` (`src/motor/espectral.ts`) con ζ = Ω/100, la de `"regla": "cqc"`. Y añade que la raíz de la suma de los cuadrados «presenta una aproximación razonable cuando los distintos modos no pueden acoplarse por tener períodos muy diferentes».
- **3.6.2.5:** con 3 GDL por planta, las solicitaciones globales de planta se asignan a los elementos. Además, hay que considerar el segundo orden «de acuerdo con la importancia de los desplazamientos».
- **Vigencia:** la NCSE-02 (RD 997/2002) sigue en vigor.
  - Hay un proyecto de NCSR-23 (2023): basado en el Eurocódigo 8, con otro mapa, y derogaría la NCSE-02.
  - No he podido confirmar que se haya aprobado (VS-a).

## 3. Propuesta

Cuatro piezas, todas en código puro:

1. **La situación, en el modelo:** `modelo.acciones = { viento?, sismo? }`. Va en la huella, porque genera cargas.
   - **Viento:**
     - la zona (o qb a mano) y la aspereza;
     - la rasante (por defecto, la ±0,00);
     - las direcciones (X e Y globales, o un ángulo);
     - la superficie, para el rozamiento;
     - la cubierta a dos aguas, opcional;
     - los anchos por planta, calculados y con la opción de escribirlos (VS-b).
   - **Sismo:**
     - el municipio (que da ab y K), o ab y K a mano;
     - la importancia (ρ) y el terreno (estratos, que dan C);
     - el sistema estructural y μ por dirección, y el amortiguamiento Ω;
     - las fracciones de masa por caso (por defecto, las de su ψ nombrado, VS-d);
     - la regla de combinación (VS-f).
2. **Casos del programa,** como el peso propio desde el 2026-11-05.
   - Los genera `fisicoResuelto` antes de validar, igual que las cargas `borde` de MA4 y los ábacos de MA2. No se escriben en el fichero ni se editan, y una carga del usuario en ellos es un aviso.
   - **Viento:** W+X, W−X, W+Y y W−Y, cada uno con +e y −e: 8 casos de la familia `viento`.
   - **Sismo:** EX+e, EX−e, EY+e y EY−e (familias EX y EY). El generador ya les da el ± y el 100/30.
3. **Masas y modos** en el motor: lo de E7 que hace falta.
4. **El caso espectral** en los resultados y las consultas.

### 3.1 Viento (VS1)

- **La fuerza por planta y dirección** es la de `calcularViento` de Concreta, copiada, con las alturas de las plantas sobre la rasante.
- **El ancho expuesto, por planta:** la proyección, perpendicular al viento, de lo que hay en esa planta (losas, muros y pilares).
  - La profundidad y la esbeltez son las del edificio.
  - Concreta usa un rectángulo para todo el edificio. Aquí, con plantas distintas (la vivienda tiene dos cubiertas a dos cotas), cada banda lleva su ancho (VS-b).
- **Dónde se aplica (VS-c):**
  - con diafragma rígido, una puntual horizontal en el centro de la banda de la planta, desplazada ±e (5 % del ancho). SP-5 la lleva al diafragma con su Mz, exacta;
  - sin diafragma, una carga lineal horizontal por los bordes de la losa a barlovento (cp) y a sotavento (cs).
- **Bajo la rasante, nada:** la banda entre la rasante y media planta baja va a la cimentación, como en Concreta.
- **Fuera:** las presiones locales y lo que hay encima del último forjado (petos y casetones), que se meten a mano, como en Concreta.

### 3.2 Masas (VS2)

- **De las cargas, no de un dato aparte:**
  - de cada caso G, todo;
  - de cada caso Q y S, su fracción de 3.2 según su ψ nombrado (VS-d);
  - de W, E y T, nada.

  La masa es la componente vertical hacia abajo del vector de cargas equivalentes del caso (el que ya ensambla el motor), dividida por g = 9,80665. Así es exactamente el peso que se calcula, con su reparto, y casa con el peso esperado de A3.
- **A cada diafragma:** la masa m, el centro de masas (CM) y la inercia de giro J respecto al CM, sumando sus nudos.
  - El nudo maestro no tiene por qué estar en el CM, así que la M de cada planta es el bloque 3×3 entero, con los términos de acoplamiento.
- **Lo que cae fuera de los diafragmas** (filas intermedias de muros, nudos de barras, la planta más baja) se reparte entre el diafragma de arriba y el de abajo por la cota. Lo que cae en un nudo con apoyo no cuenta: va al terreno.
- **Una planta con masa y sin diafragma** (`"ninguno"`) que no sea la de los apoyos es error (`sismo/planta-sin-diafragma`) hasta VS6 (VS-h). Que no se pierda en silencio.
- **El CM de cada planta** sale en las consultas: hoy no está en ninguna parte, y es la referencia de la excentricidad.

### 3.3 Modos (VS2)

- **Condensación exacta a los 3n GDL de los diafragmas,** como en E6.
  - La flexibilidad sale de 3n soluciones estáticas con la factorización del cálculo: un solo `resolver` con nrhs = 3n (21 en el edificio objetivo de 7 plantas).
  - Es exacta porque, por §3.2, toda la masa está en esos GDL.
- **El problema propio** es de 3n × 3n: K_c·φ = ω²·M·φ. Se resuelve con el Cholesky de M (por bloques) y Jacobi simétrico, en TypeScript: es pequeño y denso.
- **Se toman todos los modos.** El modelo condensado no tiene más que 3n, así que la masa movilizada es el 100 % y el mínimo de 3.6.2.3.1 se cumple siempre.
  - Salen los periodos, la masa efectiva por dirección y su suma, y las formas.
- **La forma completa de cada modo** (todos los GDL) no pide ninguna solución más: es la combinación de las 3n soluciones unitarias con K_c·φᵢ.
- **`src/pruebas/modal.ts` pasa al motor** (`src/motor/modal.ts`), con la masa no diagonal y sin la inversa de Gauss–Jordan sin guardas.
- **Coste:** 3n lados más sobre la factorización que ya hay; las ecuaciones no cambian. En memoria, 3n vectores de GDL: en el edificio objetivo, unos 21 × 312 000 × 8 B ≈ 52 MB. `memoriaRequerida` lo comprueba antes (perfil móvil, 512 MiB).

### 3.4 El caso espectral (VS3)

- **El espectro** es el de la NCSE-02 2.3:
  - ac = S·ρ·ab, TA = K·C/10, TB = K·C/2,5 y β = ν/μ;
  - αᵢ de 3.6.2.2, con la rama ascendente (que no es la del espectro elástico por β: VS3-1, §12).

  Se copia de Concreta, sin su `staticForceAlpha`, que es del 3.7.
- **La respuesta de cada modo en cada dirección** es uᵢ = Γᵢ·αᵢ·β·ac·g/ωᵢ²·φᵢ. Cada modo entra en los resultados como un «caso modal» con su vector u, y cualquier consulta (esfuerzos y diagramas de barras, láminas, franjas, cortes, reacciones, desplomes) lo trata como un caso más.
- **La combinación se hace en cada variable** (3.6.2.4, VS-e): cada consulta calcula el valor de cada modo y los combina.
  - Por defecto, como dice la norma: SRSS, con los modos a menos del 10 % de periodo sumados antes en valor absoluto.
  - Como opción, la CQC con Ω (VS-f).
  - **Cambiado el 2026-11-08** (VS-f, decisión del usuario): por defecto, la CQC; la del articulado, como opción.
- **El signo** es el del modo con más masa efectiva en esa dirección (VS-g), el mismo para todas las variables. Sirve para leer cada variable sola (mapas, diagramas, desplomes), pero no hace concomitantes los valores de dos variables: lo que junta varias (Wood–Armer, las ternas de un pilar) prueba los signos del sismo de cada una por separado (VS-o, §13.4).
- **Así, EX es un caso más:** un `Float64Array` con el valor combinado de cada variable, que entra en las combinaciones con el ± y el 100/30 del generador, sin tocarlo.
- **Lo que cambia en `Consultas`:** un «caso compuesto» (los casos modales con su regla), que se resuelve antes de aplicar los factores. Todo lo que hoy combina por factores pasa por ahí. Es el trabajo grande de la fase.
- **La excentricidad accidental (VS-i).**
  - Por defecto, un caso estático de torsor por planta, ±F_k·e_k: F_k sale de los cortantes de planta combinados (como en 3.7.4) y e_k = L_k/20. Se superpone al espectral: EX±e = EX + T_X±.
  - La alternativa es mover el CM ±e y rehacer los modos: el condensado es el mismo y el modal cuesta poco, pero son cuatro juegos de casos modales en las consultas.
- **Desplazamientos:** los del sismo se multiplican por μ (3.6.2.2) en los desplomes y las derivas.
- **Equilibrio (regla de oro 2):**
  - se comprueba en cada caso modal, las fuerzas de inercia M·φ·ω² contra sus reacciones, a 1e-9;
  - el combinado no es lineal y no se comprueba así, pero su cortante basal tiene que ser el combinado de los cortantes basales de los modos.
- **Lo que se informa:** el cortante basal y los de planta por dirección. Al lado, como sensatez, el método simplificado de Concreta, cuando el edificio cumple 3.5.1 (VS-j).
- **Segundo orden (VS-k):** el índice θ = P·Δ/(V·h) por planta, como aviso de sensatez, sin amplificar nada.

### 3.5 La app y el agente (VS4)

- **En Cargas,** las fichas «Viento» y «Sismo»:
  - el emplazamiento: municipio, zona eólica, aspereza y terreno;
  - los datos del edificio y lo que sale de ellos (las fuerzas por planta, el espectro);
  - los casos generados, dibujados en el alzado y el 3D con lo que ya hay (`cargas3d`, `vistaAlzadoCargas`), y en el caso EX, las fuerzas de planta combinadas.

  Los textos no nombran programas comerciales.
- **En Resultados,** un modo «Modal»:
  - tabla de periodos, masas efectivas por dirección y su suma;
  - la forma de cada modo animada (la deformada animada de I4) y el CM de cada planta;
  - cortantes de planta.
- **En la CLI:** `fem consultar modos` y `fem consultar sismo` (espectro, masas, CM, cortantes, θ), y el informe de `fem revisar` con su sección.
- **En la skill:** la lista de MA1 pregunta la zona eólica, el municipio, el terreno, el sistema estructural y la importancia, y no los saca de memoria.

## 4. Tramos

| Tramo | Qué | Depende de |
|---|---|---|
| **VS1** | Viento: `acciones.viento`, anchos por planta, 8 casos del programa, ficha mínima | — |
| **VS2** | Masas por planta (CM, J), condensación y modos en el motor, `fem consultar modos` | — |
| **VS3** | Espectro NCSE-02, casos modales, caso compuesto en `Consultas`, excentricidad, ×μ, θ | VS2 |
| **VS4** | La app (fichas, modo Modal, dibujo de los casos), la skill y el informe | VS1, VS3 |
| **VS5** | En sombra con el CYPECAD del usuario | VS4 |
| **VS6** (opcional) | Plantas sin diafragma con masa: Lanczos con desplazamiento sobre la factorización | VS3 |

VS1 y VS2 son independientes. Por VS-m, VS1 va primero y sola; VS2 sólo a la vez si la lleva otra sesión.

## 5. Criterios de paso y oráculos

**VS1, viento:**
1. Las fuerzas por planta, las de Concreta en los mismos datos (con sus pruebas copiadas) y las de un caso a mano con la tabla 3.4 (ce redondeado, ≤ 1 %).
2. La reacción horizontal de cada caso es ΣF a 1e-9, y su momento respecto al centro de la banda, ±e·ΣF.
3. Un modelo sin `acciones` da los mismos bits que hoy.
4. Las metamórficas: girar el modelo con las direcciones da las mismas fuerzas; trasladarlo no cambia nada.

**VS2, masas y modos:**
1. Σ m·g es el peso de los casos con sus fracciones a 1e-12, y casa con el peso esperado de A3.
2. Los periodos de SAP2000 1-022 y 1-024 (los de E6, ahora con el código del motor).
3. Un edificio de cortante de 3 plantas, con su solución cerrada a 1e-10.
4. **Oráculo externo:** OpenSeesPy `eigen`, con `rigidDiaphragm` y las masas en el maestro, sobre el modelo analítico exportado (como en E1), en el edificio objetivo y la retícula con núcleo.
5. φᵀMφ = I y φᵀKφ = Ω² a 1e-10. Metamórficas: masas ×4 dan periodos ×2; girar la planta, los mismos periodos; renumerar, lo mismo.
6. Las ecuaciones de los edificios objetivo no cambian, y el modal cabe en el perfil móvil.

**VS3, el espectral:**
1. El espectro de SRSS y CQC de 1-022 y 1-024 con el código del motor.
2. Una ménsula de 2 masas con la combinación a mano. Un caso con dos modos a menos del 10 % comprueba la suma en valor absoluto.
3. **Oráculo externo:** OpenSeesPy `responseSpectrumAnalysis` si lo tiene la 3.8; si no, la combinación en Python con sus modos.
4. El equilibrio de cada caso modal a 1e-9.
5. El cortante basal combinado frente al del método simplificado de Concreta, en edificios que cumplen 3.5.1. No tienen que coincidir; la diferencia se explica por T_F de la fórmula frente al modal.
6. Ninguna consulta mezcla un caso modal con los factores de una combinación sin pasar por el caso compuesto. Se comprueba con una prueba que lo busca, como la de textos.

**VS5, en sombra con CYPECAD:**
- la vivienda de Alhaurín el Grande (Málaga, en el Anejo 1) y, si el usuario lo tiene, un edificio de pórticos de 4 a 7 plantas;
- se comparan periodos, masa y CM por planta, cortantes de planta y los esfuerzos de los pilares con sismo;
- **el usuario** tiene que sacar de su CYPECAD el listado de sismo de esos modelos.

## 6. Coste

- **Ecuaciones:** ninguna más. El viento y el sismo son casos; el modal, 3n lados sobre la factorización que ya hay.
- **Consultas:** cada caso modal cuesta lo que un caso. El edificio objetivo tiene 7 plantas, así que son 21 modos, y las franjas y los cortes, que van caso a caso, pueden multiplicar su tiempo.
  - VS3 mide cuántos modos hacen falta de verdad (con ≥ 90 % de masa en cada dirección y todos los de T > TA).
  - Si cuesta, se puede truncar con aviso. La norma pide los que «suponen una contribución significativa».
- **Tiempo:** sólo como información (en caliente, alternando y con el mínimo de tres pasadas).

## 7. Riesgos

- **El caso compuesto toca todas las consultas.** Si una se queda sin pasarlo, sale el SRSS mal o un caso modal sumado como estático, en silencio. Por eso el criterio 6 de VS3 y el test que lo busca.
- **La concomitancia de los pilares** (H31) con un signo por dirección era aproximada y podía quedar del lado inseguro. No es lo que hace CYPECAD (lleva los modos hasta el dimensionado, con los efectos pésimos de cada comprobación); se corrigió con VS-o (§13.4).
- **Plantas semirrígidas** (`"ninguno"`) con masa: hasta VS6, error.
- **La norma puede cambiar** (NCSR-23). Por eso el espectro y las fracciones de masa quedan en un módulo de norma aparte (`src/normas/ncse02.ts`), como en Concreta.

## 8. Decisiones del usuario (2026-11-06)

Las recomendaciones de Claude, aceptadas por el usuario. Lo que cambia frente a la propuesta está en VS-d, VS-l, VS-m y VS-n.

- **VS-a, la norma:** la NCSE-02, con el espectro y las fracciones de masa en un módulo de norma aparte (`src/normas/ncse02.ts`) para poder añadir la NCSR-23 si se aprueba.
- **VS-b, el ancho del viento:** por planta, calculado del modelo, con la opción de escribirlo.
- **VS-c, dónde se aplica el viento:**
  - con diafragma, una puntual en el centro de la banda ±e; sin diafragma, una lineal por los bordes;
  - 8 casos (4 direcciones × ±e). Sólo son lados más sobre la misma factorización, y el viento ya es una familia excluyente en las combinaciones.
- **VS-d, las fracciones de masa:**
  - uso-A, 0,5; uso-B, C y D, 0,6 (3.2);
  - sin valor en la norma: uso-E 0,6, uso-F la de su uso y uso-G 0 (los ψ₂ del Eurocódigo 8);
  - **nieve, cambiado:** la norma dice «más de 30 días al año», no una altitud. Va una casilla `nievePermanente` en `acciones.sismo`; si no se da, se toma por defecto que permanece por encima de 1 000 m (0,5) y que no por debajo (0), y la hipótesis lo dice;
  - todas se pueden cambiar por caso.
- **VS-e, la combinación de los modos:** en cada variable (3.6.2.4). Las fuerzas de planta como un caso estático dejan la torsión ambigua, y aquí manda la precisión.
- **VS-f, la regla:** SRSS con los modos a menos del 10 % sumados en valor absoluto, por defecto; la CQC con Ω como opción. Cuál se queda por defecto lo decide VS5: si el CYPECAD del usuario usa la CQC, hay que poder comparar con lo mismo. La norma la admite: es la «expresión general» de su comentario C.3.6.2.4 (§2). **Decidido por el usuario el 2026-11-08: la CQC por defecto** (`regla ?? "cqc"` en `src/compilador/sismo.ts`; también en la ficha de la app y en la skill). Por qué: es lo que usa CYPECAD; en un edificio simétrico no depende de cómo gire la malla los dos modos de igual periodo (con la del articulado, en el ejemplo 11 con h = 0,75, los cortantes de los pilares se separaban un 9,7 %, §14); y la norma la da como la expresión general. Lo que cuesta: con dos modos a un 5–10 % de periodo, la del articulado los suma en valor absoluto y da más (la vivienda, un 6,5 % más de cortante en la base según X, VS3-7). Los proyectos con la regla escrita siguen con la suya; el motor mantiene `"srss"` como valor por defecto de `reglaModal`, porque el compilador se la da siempre.
- **VS-g, el signo:** el del modo de más masa en la dirección, uno para todas las variables. El ± lo da el generador. **Matizada por VS-o (2026-11-08, §13.4):** el signo vale para leer una variable; no mantiene la concomitancia entre variables.
- **VS-h, plantas sin diafragma con masa:** error hasta VS6.
- **VS-i, la excentricidad accidental:** torsor estático ±F_k·L/20; VS3 mide cuánto se separa de mover el CM.
- **VS-j, el método simplificado:** sólo como comprobación de sensatez.
- **VS-k, segundo orden:** sólo el aviso con θ.
- **VS-l, los datos de peligrosidad, cambiado:**
  - se admite la **CC BY 4.0 sólo para los datos de peligrosidad del IGN** (como la OFL sólo para las fuentes), con su cita en `NOTICE`, y se copia el JSON de Concreta con su manifiesto y su sha256: los mismos datos que Concreta, así que no hay dos fuentes al integrar;
  - **la lista del Anejo 1 del BOE es el oráculo:** una prueba comprueba que cada municipio del Anejo 1 tiene en el JSON el mismo ab y el mismo K;
  - ab y K a mano siempre se pueden escribir, por encima del municipio.
- **VS-m, el orden, cambiado:** VS1 primero y sola (es pequeña y ya quita trabajo); VS2 es la parte arriesgada y va en su propio tramo, salvo que la lleve otra sesión.
- **VS-n, la planta `escalon` (CUB-S de la vivienda):** su propia banda, con su ancho y su altura de fachada. Tiene su diafragma y su cota; con CUB, la fuerza entraría a la altura y en el diafragma equivocados. VS1 lo comprueba con un cálculo a mano de la vivienda.

## 9. Fuera de esta fase

- La componente vertical del sismo (NCSE-02 2.6, el 70 % del espectro horizontal, «cuando sea preciso»: voladizos y luces grandes), el estudio dinámico con acelerogramas (3.6.1) y la interacción suelo-estructura.
- Las reglas de diseño sismorresistente del capítulo 4 (armado por ductilidad), que son de los módulos de comprobación.
- γc = 1,3 y γs = 1,0 en la situación sísmica (RES-13), también de los módulos.
- Las presiones locales de viento por zonas y la nieve, que ya da Concreta para los elementos.
- La amplificación por segundo orden, P-Δ (S1: fuera del MVP). **Pendiente para la integración (2026-11-08, a petición del usuario):** CYPECAD calcula el P-Δ con los desplazamientos de las hipótesis horizontales (los del sismo, por μ) y amplifica sus esfuerzos; por eso avisa si no hay viento ni sismo, y por eso sus coeficientes de pandeo por defecto son β = 1. Aquí sólo está el aviso θ del sismo (VS-k) y nada con viento solo. Antes de que los resultados alimenten las comprobaciones de pilares de Concreta hay que elegir: el P-Δ en el motor (coeficiente de amplificación por hipótesis, como CYPE, o iteración geométrica) o β > 1 en los pilares de estructuras traslacionales. En la sombra, comparar con el segundo orden de CYPE desactivado, o descontar su coeficiente de amplificación (lo da el listado), y medirlo con una pasada con él y otra sin él.
- **Las comprobaciones de Concreta con el sismo del programa** (VS-o, §13.4; pendiente para la integración, 2026-11-08). La regla: Concreta comprueba con lo que ya da el motor con los signos pésimos (las ternas de `fem consultar pieza`, `pesimos: true`, y el Wood–Armer de las franjas) y **nunca recombina por su cuenta** los casos con el sismo, ni suma la combinación con su signo a otra variable. Las de una viga que juntan dos esfuerzos (cortante con torsión, flexión con cortante) toman los `esfuerzos` de cada extremo de vano de `fem consultar pieza` (con el sismo, `pesimos: true`; hechos el 2026-11-08, §13.4).
- **El viento en una planta sólo de vigas** (una pérgola sin losa como planta propia; 2026-11-08): `huellaPlanta` la toma por sus vigas, así que recibe viento como fachada cerrada y va a un diafragma rígido (C1-d), sin aviso. Una pérgola abierta no es fachada (el CTE trata las estructuras abiertas aparte) ni rígida en su plano. Por ver qué hace CYPECAD (la variante con pérgola del modelo de 3 × 3 de la sombra) y decidir entre igualarlo o, como mínimo, avisar. Las vigas que salen de una losa ya no cuentan (VS1-2).

## 10. VS1 hecho (2026-11-06): el viento

Pasan los cuatro criterios de §5. Los casos del programa no se ven todavía en la app: eso es VS4.

**Ya en el repo:**
- `src/normas/cteViento.ts`: las tablas del DB SE-AE y las piezas de cálculo (ce por la fórmula D.2, la tabla 3.5 interpolada, las alturas tributarias), copiadas de Concreta (`tablasAE.ts`, `interp.ts`, `viento.ts`) con su cita.
- `acciones.viento` en el modelo físico (`fisico.ts`, en la huella y en los dos esquemas): `zona`, `qb`, `aspereza`, `altitud`, `rasante` y `fachadas` (el área de la banda de una planta escrita, VS-b).
- `src/compilador/viento.ts`:
  - `calcularViento(m)`: las fuerzas por planta y dirección, o por qué no se pueden calcular;
  - `resolverViento(m)`: los 8 casos (`W+X+e` … `W-Y-e`, familia `viento`, ψ de viento) y una puntual por planta y caso (`<caso>@<planta>`), al final de `casos` y `cargas`, y quita `acciones.viento` (idempotente);
  - `hipotesisViento`: la hipótesis del cálculo, con qb, cp, cs, e y las fuerzas de cada planta.
- **Dónde se resuelve:** en `fisicoResuelto` (lo usa `validar`), en `compilar` (con los avisos y la hipótesis) y en `Consultas`. Por eso `q.fisico.casos` casa uno a uno con los resultados, también en las combinaciones por defecto, la sensatez de los resultados y el render.

**La banda de cada planta, la regla de la pila:**
- en cada punto del ancho, las plantas que lo cubren (con sus losas y paños, o con sus vigas si no tienen ni lo uno ni lo otro) se reparten la altura como en Concreta: media planta por debajo y media por encima, desde la rasante;
- A es la integral de esa altura en el ancho. Con todas las plantas del mismo ancho es la `h_trib · b` de Concreta;
- con dos cubiertas a cotas distintas, cada una lleva su banda (VS-n);
- el centro de la banda es su centroide en el ancho, y la recta de acción está a ±e de él.

**Dónde se aplica:**
- una puntual horizontal en el punto medio del trozo más largo de la recta de acción dentro de una losa de la planta. SP-5 la lleva al diafragma, exacta y sin sembrar el punto: **la malla no cambia**;
- si la recta no pisa ninguna losa, en el punto de una losa más cercano, con su momento de transporte;
- en una planta sin losas, en un pilar (en el borde de un paño, si los hay), con su momento.

**Criterios:**
1. **Concreta:** sus fuerzas en cinco edificios rectangulares, congeladas por `validacion/vs/oraculo-concreta.ts` en `src/compilador/__fixtures__/viento-concreta.json` (de una planta de 4 m a doce de 3,2; qb de la zona, simplificada y escrita), a ≤ 1e-12, con cp, cs, esbeltez, e, ce y la banda. Además, un caso a mano con la fórmula D.2.
   - **El «≤ 1 %» con la tabla 3.4 no se puede cumplir:** la tabla es la fórmula redondeada a una décima (hasta 0,084, un 6 % con ce = 1,3). Se comprueba lo que dice la norma: sus 40 casillas, a ≤ 0,1 de la fórmula.
2. **Equilibrio:** la reacción horizontal de cada caso es −ΣF a 1e-9 y su momento, el de las fuerzas en su recta ±e, en un bloque de 3 plantas y trasladado (`viento.test.ts`). En la vivienda, a ≤ 3,3e-13 en los 8 casos.
3. **Sin `acciones`**, el mismo modelo analítico bit a bit (y con `acciones: {}`). Las referencias congeladas no cambian.
4. **Metamórficas:** intercambiar X e Y intercambia las fuerzas bit a bit; trasladar el edificio no las cambia y mueve los centros.

**En la vivienda** (`validacion/vs/vivienda.ts`, `out_vivienda.txt`; zona A y aspereza IV de prueba):
- según X, CUB 17,45 kN y CUB-S 2,50; según Y, 12,58 y 12,18;
- Σ A es la integral de z_alta − z_baja/2 en el ancho, calculada sin la pila, a 2e-16 (la identidad de la regla, que prueba también `viento.test.ts`).

**Hallazgos:**
- **VS1-1:** un pilar que atraviesa la cota de una planta sin losa alrededor (los de la cubierta alta, a la cota de la baja) no es de esa planta. Contarlo le daba fachada donde no la tiene, y su nudo no está en su diafragma (C2-f), así que tampoco vale para aplicar la carga. La huella de una planta es la de sus losas y paños.
- **VS1-2:** las vigas que salen de una losa (la pérgola de la vivienda) no son fachada. Contándolas, la vivienda tenía un 12 % más de área según X.
- **VS1-3:** el criterio de la tabla 3.4 estaba mal puesto (arriba).

**Fuera de VS1:**
- el rozamiento (3.3.2-3), la cubierta a dos aguas (D.6) y las direcciones que no son X e Y;
- el viento en las plantas sin diafragma (`viento/planta-sin-diafragma`, error, VS-c);
- la zona eólica por provincia y municipio;
- en la app (VS4): la ficha «Viento», ver los casos del programa en los selectores de caso y dibujarlos. Hoy la app los usa en las combinaciones por defecto, pero el selector de casos lista sólo los del fichero.

## 11. VS2 hecho (2026-11-06): las masas y los modos

Pasan los seis criterios de §5; el 4, con las losas y los muros por otro camino que `eigen` (VS2-2). No se ven todavía en la app (VS4) y no hay casos del sismo: eso es VS3.

**Ya en el repo:**
- `src/motor/modal.ts` y `modelo.modal` (`DefinicionModal`: los casos que hacen de masa con su fracción, o masas puestas en nudos). Con él, `calcular` da además `ResultadoCalculo.modal`: las masas de cada diafragma y todos los modos. `src/pruebas/modal.ts` se queda sólo con la combinación espectral (pasa al motor con VS3).
- `src/normas/ncse02.ts`: las fracciones del art. 3.2, con el texto de la norma.
- `acciones.sismo` en el modelo físico (`fisico.ts`, en la huella y en los dos esquemas): `masas` (la fracción de un caso, escrita) y `nievePermanente`. Basta `"sismo": {}`.
- `src/compilador/sismo.ts`: `calcularSismo(m)` (la fracción de cada caso, o por qué no se puede saber) e `hipotesisSismo`. El compilador deja las fracciones en `modelo.modal` y da el error `sismo/planta-sin-diafragma` (VS-h).
- Los resultados guardados llevan el modal (`src/agente/resultados.ts`: los números en la cabecera y los vectores de cada modo en el bloque, tras los casos); unos resultados sin él no valen para un modelo que lo pide.
- `Consultas.modos()` (la masa, el centro de masas y la inercia de giro de cada planta con su id, y los modos) y `fem consultar modos [--top N | --todos]`, también en el servidor MCP y en la skill.

**La masa (§3.2), como quedó:**
- En cada nudo, m = −Σ fracción·Fz/g, con Fz la componente vertical de las fuerzas nodales equivalentes del caso (el vector que ensambla el cálculo, antes de las restricciones) y g = 9,80665 m/s². Sólo tiene inercia horizontal.
- **La fracción de cada caso,** por su acción: G (y el caso del peso propio), 1; Q, por el nombre de su ψ (uso-A, 0,5; uso-B, C y D, 0,6; uso-E, 0,6 y uso-G, 0, que no están en la norma); S, 0,5 si permanece más de 30 días (`nievePermanente`, o por su ψ: a más de 1 000 m, sí); W, T, E, A y N, 0. **Lo que no se puede saber es un error** (`sismo/caso-sin-fraccion`): un caso Q o S con ψ por sus valores, o un caso sin acción que no es el del peso propio. Se arregla con su fracción en `masas`.
- **Adónde va la de cada nudo:**
  - si es de un diafragma (su maestro, un esclavo, o un esclavo de un enlace rígido a la cota de su maestro: las huellas de los pilares y las caras de las vigas), a él, en su sitio;
  - si no lo es y tiene ux y uy coartados, al terreno;
  - si no lo es, se reparte por su cota entre el nivel de arriba y el de abajo. Los niveles son las cotas de los diafragmas y las de los apoyos horizontales que no son de un diafragma (el terreno). En su misma cota, todo al diafragma; con varios diafragmas en una cota, al de la caja en planta más cercana.
- De cada diafragma salen m, el centro de masas y J respecto a él. El maestro no está en el centro de masas (el compilador lo pone en el centroide de los nudos), así que la masa en sus GDL es el bloque 3 × 3 entero, M = L·Lᵀ con L = [[√m, 0, 0], [0, √m, 0], [−dy·√m, dx·√m, √J]].
- `masas` en el resultado dice cuánta hay en total, cuánta vibra (la de los diafragmas), cuánta va al terreno y cuánta es «repartida» (la de los nudos de fuera): lo aproximado queda a la vista.

**Los modos (§3.3), como quedaron:**
- Los GDL dinámicos son los libres de los maestros con masa. Cada uno lleva una carga unidad como un lado más del mismo `resolver` que los casos: una factorización, nc + 3n lados, y `memoriaRequerida` lo cuenta antes.
- **No se invierte la flexibilidad.** Con y = Lᵀ·φ, el problema es (Lᵀ·F·L)·y = λ·y con λ = 1/ω², simétrico y definido positivo, por Jacobi cíclico. De cada (λ, y) salen las fuerzas de inercia del modo, f = ω²·M·φ = L·y/λ, y su forma, φ = F·f.
- **Cada modo es la respuesta estática a sus fuerzas de inercia:** su forma completa (los 6 GDL de todos los nudos) es la combinación de las soluciones unitarias con f, y se comprueba con la regla de oro 2: f contra las reacciones que da, a 1e-9. Si un modo no la cumple, el cálculo no es válido (`modal/equilibrio`).
- Salen todos los modos (tres por planta con masa), normalizados a la masa, con su periodo, su factor de participación y su masa efectiva en X, en Y y en el giro alrededor del centro de masas del edificio, y el signo con Γ ≥ 0 en la dirección de traslación con más masa.
- Un GDL sin masa no es dinámico: una planta sin cargas, o el giro de un maestro con toda la masa en él (los ejemplos de CSI). Sigue estáticamente a los demás, y la condensación sigue siendo exacta. Un GDL de un maestro coartado no se mueve y su masa no cuenta.

**Criterios:**
1. **Σ m·g es el peso** de los casos con sus fracciones a 1e-12 (`sismo.test.ts`: el edificio de losas y la retícula con núcleo), y con sólo el peso propio, el peso esperado de A3, sin la malla, a 1e-9 (1e-3 con muros, como en A3-1; `modos.test.ts`).
2. **SAP2000 1-022 y 1-024** con el código del motor (`validacion/e6/csi.ts`, `csi.test.ts`): los 7 y los 4 periodos y el espectro (SRSS, CQC, ABS y NRC 10 %), dentro del redondeo de lo publicado, como en E6.
3. **Edificio de cortante de 3 plantas** (`modal.test.ts`): los 9 modos (en X, en Y y en giro) a 1e-10 de la solución cerrada de la cadena, con los dos solvers, y sus masas efectivas a 1e-10. Con el maestro fuera del centro de masas, lo mismo; con una planta sin masa, los de la cadena condensada.
4. **OpenSeesPy 3.8** (`validacion/vs2/`, `oraculo-vs2.test.ts`, `out_opensees.txt`), sobre modelos compilados y con la masa de cada diafragma en su centro de masas:

   | Modelo | Nudos | Cómo | Modos | Diferencia máxima | Media |
   |---|---|---|---|---|---|
   | Pórtico de 3 plantas, 3 × 2 vanos | 78 | `eigen` | 9 de 9 | 2,1e-14 | 3,2e-15 |
   | Pórtico objetivo, 7 plantas, 9 × 7 vanos | 1 151 | `eigen` | 21 de 21 | 5,6e-13 | 5,9e-14 |
   | Losas, 3 plantas, 3 × 2 vanos | 4 206 | flexibilidad + LAPACK | 9 de 9 | 0,51 % | 0,27 % |
   | Retícula con núcleo de muros | 2 568 | flexibilidad + LAPACK | 3 de 3 | 0,40 % | 0,29 % |
   | Losas, 7 plantas, 3 × 2 vanos (sólo en el informe) | 9 798 | flexibilidad + LAPACK | 21 de 21 | 0,53 % | 0,24 % |

   Los pórticos son el edificio objetivo de C1 (sólo barras, sin áreas de cortante: E2-1), con `eigen` de OpenSees y todos sus modos. Con losas y muros, la flexibilidad estática de OpenSees en los centros de masas y los valores propios de LAPACK (VS2-2); sus láminas son ASDShellQ4, no la DKMQ24 del motor, y la diferencia es la de los elementos (E6: ≤ 0,5 %). El mismo pórtico por ese segundo camino da lo mismo que el motor a 6,5e-15.
5. **Propiedades** (`modal.test.ts`): φᵀ·M·φ = I y φᵀ·K·φ = Ω² a 1e-10; cada modo es la respuesta estática, en un cálculo aparte sin modal, a las fuerzas de inercia ω²·m·u puestas en sus propios nudos con masa (no pasa por la masa de los diafragmas: comprueba de una vez el centro de masas, J, el acoplamiento con el maestro y los valores propios); masas ×4, periodos ×2; girar la planta, trasladarla y renumerar, los mismos periodos a 1e-10.
6. **Coste** (`validacion/vs2/banco.ts`, `out_banco.txt`), en los edificios objetivo de 7 plantas:

   | Edificio | Ecuaciones (sin y con) | Núcleo pedido, MiB (sin / con) | Pico en un núcleo nuevo, MiB | ¿Cabe en el móvil? | Cálculo, s (sin / con) | T₁, s |
   |---|---|---|---|---|---|---|
   | Losas | 149 814 | 155 / 203 | 182 / 237 | sí | 4,7 / 5,6 | 0,840 |
   | Losas y muros | 221 349 | 263 / 334 | 306 / 388 | no, por ecuaciones (tampoco sin el modal) | 5,8 / 7,4 | 0,679 |
   | Reticular | 199 962 | 213 / 277 | 249 / 323 | sí | 5,4 / 6,7 | 0,763 |
   | Unidireccional | 19 845 | 16 / 23 | 23 / 30 | sí | 0,50 / 0,68 | 0,818 |

   Son 21 GDL dinámicos en los cuatro (21 lados más sobre 4 casos). El tiempo, sólo como información (mínimo de tres pasadas, alternando): de 0,2 a 1,6 s más, de los que el modal propio (flexibilidad, Jacobi y la forma de los modos) son 0,04–0,7 s; el resto, las 21 soluciones. En los cuatro, la masa efectiva de todos los modos suma 1,000000 en X y en Y, y el peor equilibrio de un modo es 1,1e-12.

   Las ecuaciones no cambian y los casos salen con los mismos bits (también en `sismo.test.ts`). Sin `acciones.sismo`, el modelo analítico es el de antes: las referencias congeladas no cambian.

**En la vivienda** (`"sismo": {}` sobre el ejemplo): 214 t en sus dos diafragmas (CUB, 117 t a 3,40; CUB-S, 97 t a 4,30), 8,5 t al terreno y 8,5 t repartidas (los nudos de la pérgola y de los pilares que cruzan la cota de la cubierta baja); T₁ = 0,34 s, con el 54 % de la masa en X y el 24 % en Y.

**Hallazgos:**
- **VS2-1, un GDL sin masa no es dinámico.** El giro de un maestro con toda la masa en él (1-022, 1-024) gastaba una solución unitaria y dejaba un valor propio nulo. Ahora sólo son dinámicos los GDL con alguna fila de L no nula.
- **VS2-2, `eigen` de OpenSees no sirve con cadenas de restricciones y masa en 3n GDL.** Con `Transformation` resuelve mal las cadenas (E1-1); con multiplicadores, K no es definida; con penalización, ARPACK no arma más vectores de Lanczos que GDL con masa («Could not build an Arnoldi factorization», tamaño 3 en la retícula con núcleo), y el solver denso no cabe (27 000 GDL). El criterio 4 con losas se hace con lo que sí es exacto: la flexibilidad de OpenSees en los GDL con masa y LAPACK.
- **VS2-3, el último modo de cada dirección puede llevar mucha masa.** En el edificio de losas de 7 plantas, el 7.º modo en X (T = 0,049 s) tiene el 8,9 % de la masa, más que el 2.º (8,4 %): la primera planta, sobre pilares empotrados en la base, es mucho más rígida que las demás (losa plana) y vibra casi sola. **Para VS3:** truncar por número de modos dejaría masa fuera; si se trunca, por masa acumulada y con todos los de T > TA. Con todos los modos no hay nada que decidir.
- **VS2-4, corregido:** el peso propio calculado de `fem revisar` recompila con sólo el caso del peso propio, y con `acciones.sismo.masas` (que nombra los otros casos) no compilaba: la comprobación se quedaba sin lo calculado. Ahora recompila sin las acciones del programa (con el viento, además, compilaba sus 8 casos sin falta).
- **VS2-5, corregido (de VS1):** el visor rechazaba los resultados guardados de un proyecto con viento («sus casos no son los del proyecto»): comparaba con los casos del fichero, no con los del modelo compilado, que lleva los del programa.
- **VS2-7, el refinamiento arrastraba a los casos.** El refinamiento iterativo del solver era global: si un lado pasaba de 1e-12, se refinaban todos. En el unidireccional de 7 plantas, una solución unitaria del modal lo pasaba, y los casos salían con un paso de refinamiento que sin el modal no tienen (a 1e-14 de los de antes: inocuo, pero no los mismos bits). Ahora el solver refina por grupos de lados (`grupos`): los casos, como siempre, y los del modal, aparte. Lo destapó el banco, no las pruebas.
- **VS2-8, de paso:** el edificio objetivo con losas y muros tiene hoy 221 349 ecuaciones, por encima de las 200 000 del perfil móvil, con modal o sin él: la malla creció después de medirlo (`rejilla.md` daba 151 905, antes de LV y LV2).
- **VS2-6, el tamaño de los modos.** La forma completa de cada modo son 6 números por nudo: en el edificio de losas de 7 plantas, 21 × 4,2 MB = 87 MB más en la memoria de JavaScript y en `.fem/`. VS3 los necesita (cada modo es un caso). Falta medirlo en un móvil (con E4-9).

**Lo que decidí al hacerlo, para el usuario:**
- **VS2-a:** `acciones.sismo` existe ya, sólo con las masas: `"sismo": {}` da las masas y los modos. VS3 añade en el mismo objeto el emplazamiento y el espectro; sin ellos seguirá dando sólo los modos.
- **VS2-b:** un caso de uso o de nieve sin ψ por su nombre, o un caso sin acción, es un error que pide su fracción (no se toma 0 ni 1 en silencio). Los modelos de validación, sin acciones en sus casos, escriben sus fracciones.
- **VS2-c:** en su misma cota, la masa de un nudo de fuera va entera al diafragma (los pilares que cruzan una cubierta, una pérgola); el terreno son los apoyos con ux o uy coartados que no son de un diafragma.
- **VS2-d:** la forma completa de cada modo se guarda con los resultados (VS2-6).

**Fuera de VS2:**
- el espectro, los casos del sismo y su combinación (VS3); la app (VS4: el modo «Modal», la ficha «Sismo»);
- las plantas con forjado y sin diafragma rígido (error, VS-h, hasta VS6);
- la inercia vertical y la de giro de los nudos alrededor de ejes horizontales (§9: la componente vertical del sismo queda fuera de la fase).

## 12. VS3 hecho (2026-11-06): el espectro y los casos del sismo

Pasan los seis criterios de §5. No se ve todavía en la app (VS4). Las consultas con la situación sísmica cuestan más (son cinco veces más combinaciones: abajo) y la excentricidad como torsor estático se queda corta en la torsión frente a mover la masa (VS3-6): lo que decide el usuario está al final (VS3-a…VS3-g).

**Ya en el repo:**
- `src/normas/ncse02.ts`: el emplazamiento (cap. 2: C ponderado, S, ac, TA, TB), ν, el espectro elástico y el coeficiente αᵢ del análisis por espectros (art. 3.6.2.2); y del método simplificado (art. 3.7), lo justo para su cortante en la base. Copiado de Concreta con su cita (`NOTICE`), salvo αᵢ, que allí no está.
- `acciones.sismo` en el modelo físico (`fisico.ts`, en la huella y en los dos esquemas): `ab` (en g), `K`, `importancia`, `terreno` (su tipo, su C o sus estratos), `mu` (uno o `{ x, y }`), `omega`, `regla` (`"srss"` o `"cqc"`), `excentricidad` y `sistema`. Con `ab` hacen falta `K`, `terreno` y `mu`; sin `ab`, sólo las masas y los modos, como en VS2.
- `src/motor/espectral.ts`: la regla de combinación, la respuesta espectral de una dirección (`respuestaEspectral`) y `Superposicion`, que lleva los factores de los casos lógicos a los valores de los casos base. `src/motor/diagramaCompuesto.ts`: el diagrama de una barra en una combinación con casos del sismo.
- Cada modo, en el motor, es un caso completo: `ModoVibracion` lleva también sus reacciones y los esfuerzos de sus barras y sus láminas. Se guardan con los resultados (`.fem/`: unos resultados con los modos de VS2 no valen y se recalculan).
- `src/compilador/sismo.ts`: `calcularSismo` da además el espectro (y sus errores y avisos); `sismoDelCalculo`, con los modos, la respuesta en X y en Y y los cuatro casos; `hipotesisEspectro`, la hipótesis del cálculo.
- `Consultas`: los casos base (`casos`), los lógicos (`fisico.casos`), `sup`, `combinar`, `diagramaBarra` y la consulta `sismo()`. `fem consultar sismo`, también en el servidor MCP y en la skill; `fem calcular` dice el cortante en la base.

**Casos base y casos lógicos (§3.4, como quedó):**
- Los casos del sismo, `EX+e`, `EX-e`, `EY+e` y `EY-e` (familias `EX` y `EY`), **no son casos del cálculo**: el compilador y el motor no los ven, no ocupan en los resultados y el modelo analítico es el de VS2. `Consultas` los añade al final de los casos del modelo físico, que son los que llevan factor (los **lógicos**), y pone detrás de los casos del cálculo un caso por modo (los **base**, con las fuerzas de inercia del modo como cargas): todo lo que trabaja por caso (diagramas, campos, cortes, franjas) los trata como a los demás.
- El valor de una variable en una combinación es Σ fₖ·vₖ de los casos estáticos más, por cada caso del sismo, su factor por s·√(Σ xᵢ² + 2·Σ_pares |xᵢ·xⱼ|) + Σ tᵢ·vᵢ, con xᵢ = cᵢ·vᵢ y cᵢ = Γᵢ·Sa(Tᵢ)/ωᵢ² (el modo, normalizado a la masa).
  - **La regla,** la del art. 3.6.2.4, par a par: cada par de modos con periodos a menos del 10 % (del mayor) añade 2·|xᵢ·xⱼ|. Es la suma de valores absolutos de la norma cuando los próximos lo son todos entre sí, y no depende de cómo se agrupen cuando no (VS3-2). Con `"regla": "cqc"`, la cuadrática completa del comentario C.3.6.2.4, con Ω (por defecto desde el 2026-11-08, VS-f).
  - **El signo** s, el de la respuesta del modo de más masa efectiva en la dirección, en esa variable (VS-g).
  - **La excentricidad accidental** (VS-i): un par en cada planta, el de su fuerza equivalente (la diferencia de los cortantes combinados, como en 3.7.4; desde el 2026-11-08, la combinación de las fuerzas de la planta en cada modo, §14) por e = 0,05·L, con L la dimensión de la planta perpendicular al sismo (la caja de sus losas y paños, la del viento). Es un caso estático, y con todos los modos se escribe exacto en ellos: tᵢ = φᵢᵀ·m/ωᵢ². `+e` desplaza la recta hacia +Y (sismo según X) o +X (según Y), como en el viento.
  - **μ:** en los desplazamientos (flechas, desplomes, maestros, deformada, uz de los mapas), todo el caso del sismo va por μ.
- **Nadie aplica factores a mano.** Lo lineal se hace por caso base y la combinación, al final, en la variable que se da: los esfuerzos de un pilar, cada estación de un diagrama, una reacción, el desplome (la diferencia de desplazamientos de cada modo, combinada: no la diferencia de los combinados), la flecha relativa de un recuadro, cada nudo de un mapa, los momentos medios de una franja antes de Wood–Armer. Sin casos del sismo, `Superposicion` suma en el orden de siempre: los mismos bits.
- **El diagrama de una barra** con casos del sismo no es un polinomio: `DiagramaCompuesto` lo evalúa en cada punto. Los modos no llevan cargas en las barras, así que sus esfuerzos salen de los de sus dos extremos, que ya están en sus resultados. El sismo desplaza el máximo del vano: a las estaciones de la parte estática se añaden los décimos, los puntos donde el modo dominante cambia de signo y el vértice de la parábola alrededor del mayor y del menor My y Mz (VS3-3).

**Criterios:**
1. **SAP2000 1-022 y 1-024** (`validacion/e6/csi.ts`, `csi.test.ts`), ya con el código del motor: los modos como casos base y `Superposicion`, con la SRSS, la CQC, la suma de valores absolutos y la NRC del 10 % como opciones de la regla. Dentro del redondeo de lo publicado, como en E6. `src/pruebas/modal.ts` desaparece.
2. **A mano** (`src/motor/espectral.test.ts`): la ménsula de dos masas (cortantes, fuerzas equivalentes, desplazamientos por μ y derivas, y el cortante y el momento de cada pilar) a 1e-9 de su solución cerrada; un edificio con la traslación y el giro acoplados en dos modos a menos del 10 %, cuyos cortantes se suman en valor absoluto; y la cuadrática completa con la fórmula del comentario.
3. **OpenSeesPy 3.8** (`validacion/vs3/`, `oraculo-vs3.test.ts`): `responseSpectrumAnalysis` modo a modo en el pórtico compilado de 3 plantas, con el espectro de la NCSE-02 programado aparte en Python. La respuesta de cada modo (desplazamientos, esfuerzos de extremo de las barras con sus zonas rígidas y reacciones, con su signo) y las dos combinaciones de cada variable, a ≤ 1e-8. El cortante en la base, a 3,5e-14; en el pórtico objetivo de 7 plantas (21 modos, 14 por debajo de TA y 21 pares próximos), a 3,3e-12.
4. **El equilibrio de cada caso modal,** a 1e-9 (lo exige el motor desde VS2). Además: las reacciones de cada modo equilibran sus fuerzas de inercia; el modelo con los modos como casos, calculado otra vez, da sus resultados; el cortante en la base combinado es el combinado de los de los modos; y el torsor escrito en los modos es el caso estático con los pares (un cálculo aparte), a 1e-9.
5. **Frente al método simplificado** (`out_banco.txt`, `out_vivienda.txt`): con el periodo del modo dominante, el cortante modal queda entre 0,936 y 0,941 del simplificado en los edificios objetivo y a 0,92 y 0,84 en la vivienda. El simplificado da a su primer modo toda la masa en la meseta; el modal la reparte entre los modos.
6. **Nadie mezcla un caso de un modo con un factor:**
   - `src/pruebas/factores.test.ts` busca en `src`, `cli` y `app/src` quien aplique un factor por su índice de caso, importe la combinación lineal o combine diagramas a mano, fuera de los ficheros que lo tienen que hacer;
   - `Superposicion` y `combinar` lanzan si el vector no tiene un caso por factor;
   - `src/agente/sismoEspectral.test.ts` pasa un edificio con sismo (8 casos lógicos y 13 base) por cada consulta y la compara con la regla aplicada a mano sobre los valores de cada caso base.

**Validación de la norma** (`src/normas/ncse02.test.ts`): lo copiado, contra Concreta en cinco casos congelados por `validacion/vs3/oraculo-concreta.ts` (uno, dos y tres modos, un periodo menor que TA, estratos), a 1e-12; αᵢ, contra el texto.

**En la vivienda** (`validacion/vs3/vivienda.ts`; emplazamiento de prueba: ab = 0,10 g, K = 1, terreno II, μ = 2): 6 modos, peso sísmico de 2 102 kN y cortante en la base de 252 kN según X y 231 según Y (el 12 y el 11 % del peso). Sus dos primeros modos están a un 6 % (0,342 y 0,320 s): con la regla del articulado dan 252 kN según X; con la cuadrática completa, 237; con la raíz de la suma de los cuadrados sin más, 181. Medido con el `proyecto.json` versionado (el script admite una ruta: el del árbol de trabajo estaba a medias en otra sesión).

**El coste** (`validacion/vs3/banco.ts`, `memoria.ts`, `retenido.ts`):

- **Las ecuaciones no cambian** (los casos del sismo no son casos del cálculo; los lados son los de VS2). Lo que crece son los resultados, porque cada modo es un caso:

  | Edificio (7 plantas) | Nudos | Ecuaciones | Modos | Resultados sin modos, MiB | Con los modos de VS2 | Con los modos como casos (VS3) | Cada modo, MiB |
  |---|---|---|---|---|---|---|---|
  | Losas | 86796 | 149814 | 21 | 51 | 135 | 321 | 12,8 |
  | Reticular | 107306 | 199962 | 21 | 64 | 167 | 398 | 15,9 |
  | Unidireccional | 6695 | 19845 | 21 | 7 | 14 | 46 | 1,8 |

- **Los modos que hacen falta:** con «el 90 % de la masa de la dirección y todos los de periodo mayor que TA» (art. 3.6.2.3.1 y su comentario) bastarían entre la mitad y dos tercios; el cortante en la base con sólo ésos se queda a menos de un 1 %. Se toman todos (VS2-3).

  | Edificio | Dirección | T dominante, s (su masa) | Cortante en la base, kN (entre el peso) | Modos: todos / hasta el 90 % / con T > TA | Pares a menos del 10 % | Con la cuadrática completa | Método simplificado, con el T modal / con el del art. 3.7.2.2 |
  |---|---|---|---|---|---|---|---|
  | Losas | X | 0,840 (75,5 %) | 21326 (0,1447) | 21 / 13 / 8 | 23 | ×1,000 | ×0,941 / ×0,718 |
  | Losas | Y | 0,818 (73,2 %) | 21911 (0,1486) | 21 / 14 / 8 | 23 | ×0,990 | ×0,941 / ×0,737 |
  | Reticular | X | 0,763 (75,3 %) | 19982 (0,1587) | 21 / 13 / 7 | 23 | ×0,999 | ×0,937 / ×0,787 |
  | Reticular | Y | 0,746 (72,7 %) | 20452 (0,1625) | 21 / 14 / 7 | 23 | ×0,987 | ×0,939 / ×0,806 |
  | Unidireccional | X | 0,818 (75,6 %) | 17234 (0,1479) | 21 / 10 / 8 | 18 | ×1,003 | ×0,936 / ×0,733 |
  | Unidireccional | Y | 0,790 (72,7 %) | 17944 (0,1540) | 21 / 14 / 8 | 18 | ×0,985 | ×0,941 / ×0,763 |

  El modal queda a un 6 % por debajo del simplificado con su mismo periodo (el simplificado pone toda la masa en sus dos modos; el modal, el 73–76 % en el primero) y entre un 19 y un 28 % con el periodo aproximado de la norma (0,09·n = 0,63 s, más corto que el del modelo: más cortante). Es el criterio 5: la diferencia es el periodo.

- **Las consultas,** en segundos (sólo como información: mínimo de tres pasadas, o una si pasa de 15 s; cada una con unas `Consultas` nuevas). La situación sísmica son 64 combinaciones más sobre las 16 de la persistente, y cada una cuesta lo que una estática; donde se trabaja caso a caso (las franjas, los mapas), lo que pesa son los 21 casos de los modos:

  | Edificio | Consulta | Sin el sismo | Con los modos, las mismas combinaciones | Con la situación sísmica |
  |---|---|---|---|---|
  | Losas | Envolventes de todas las piezas | 10,33 (16) | 8,23 | 36,57 (80) |
  | Losas | Envolventes de los pilares de N7 | 0,06 (16) | 0,09 | 0,25 (80) |
  | Losas | Franjas de armado de N7 | 3,67 (16) | 7,92 | 6,09 (80) |
  | Losas | Mapa de M11 de N7 (envolvente máxima) | 0,44 (16) | 1,08 | 1,57 (80) |
  | Reticular | Envolventes de todas las piezas | 8,53 (16) | 8,94 | 42,24 (80) |
  | Reticular | Envolventes de los pilares de N7 | 0,22 (16) | 0,22 | 0,36 (80) |
  | Reticular | Franjas de armado de N7 | 3,86 (16) | 6,35 | 7,40 (80) |
  | Reticular | Mapa de M11 de N7 (envolvente máxima) | 0,83 (16) | 1,61 | 2,56 (80) |
  | Unidireccional | Envolventes de todas las piezas | 3,95 (16) | 3,98 | 23,69 (80) |
  | Unidireccional | Envolventes de los pilares de N7 | 0,09 (16) | 0,11 | 0,29 (80) |

  Las reacciones y la deriva de todo el edificio, por debajo de 0,3 s en los tres. Las franjas de losas con los modos y sin sus combinaciones (7,92) salen por encima de las de la situación sísmica (6,09): es ruido de la máquina, con otras sesiones trabajando; lo que dicen las dos es que los modos cuestan de 2,5 a 4 s más por planta.

- **La memoria de JavaScript** (`memoria.ts`: en Bun, tras recoger la basura y sobre el arranque; edificio de losas), en MiB:

  | Paso | Sin el sismo | Con el sismo |
  |---|---|---|
  | Compilado y calculado | 886 | 1709 |
  | Tras las envolventes de todas las piezas | 1414 | 3738 |
  | Tras las franjas y el mapa de una planta | 1801 | 2574 |

  De los 823 MiB de más tras calcular, 270 son los vectores de los modos (`retenido.ts`: cada modo retiene lo que un caso, 12,8 MiB); el resto no está en el resultado y queda sin explicar (se mide en Chrome con VS4, que es donde cuenta). Las envolventes con el sismo guardan lo de cada barra mientras se recorren y lo sueltan después. Antes de hacer ligeros los casos de los modos, el banco se iba a 16 GB (VS3-4).
- **Pendiente:** el mapa de una planta guarda los campos de todos los casos base (con 21 modos, seis veces más que sin el sismo), y la envolvente de las 64 combinaciones sísmicas se puede factorizar (el máximo es el de la parte estática más el de cada caso del sismo con su signo), sin recorrerlas: para VS4, donde importa la espera en la app. Y falta medirlo en un móvil (con E4-9).

**La excentricidad, frente a mover la masa (VS-i;** `validacion/vs3/excentricidad.ts`**):** la masa de cada planta movida ±e y los modos rehechos, frente al torsor, en los cortantes de la base de cada tramo de pilar:
- **en la dirección del sismo,** lo mismo: el cociente torsor / masa movida tiene una mediana de 0,95 a 1,15 (de 0,73 a 1,28 en los extremos);
- **en la perpendicular** (los pórticos que con ese sismo sólo trabajan por la torsión), el torsor da menos: una mediana de 0,10 a 0,76 con la regla del articulado y de 0,27 a 0,75 con la cuadrática completa. Con la masa movida, la traslación y el giro se acoplan en modos próximos, y la respuesta de giro se amplifica; con la regla del articulado, además, esos modos se suman en valor absoluto. En el pórtico objetivo, con el sismo según X, los pórticos según Y reciben hasta 160 kN (cuadrática) frente a los 43 del torsor, con un cortante mayor de 328 kN.
- Esos pórticos se dimensionan con el sismo en su dirección más el 30 % del otro: la diferencia en su envolvente es del orden del 10 %. La norma admite las dos cosas («de las masas o de las fuerzas sísmicas equivalentes», art. 3.2).

**Hallazgos:**
- **VS3-1, la rama ascendente del art. 3.6.2.2 no es la que decía el plan.** La norma da αᵢ = α(Tᵢ)·β con Tᵢ ≥ TA y 1 + (2,5·β − 1)·Tᵢ/TA por debajo: de 1 (un modo muy rígido se mueve con el suelo, sin reducir) a 2,5·β. No es β·(1 + 1,5·T/TA), que con μ = 2 da 0,875 a media rama donde la norma da 1,125. En el pórtico objetivo hay 14 de 21 modos por debajo de TA.
- **VS3-2, la regla del 10 %, par a par.** «Agrupando […] las variables que difieren entre sí menos del 10 %» no dice qué hacer con tres modos encadenados (el primero y el tercero, a más del 10 %). Par a par no hay que decidirlo, y es lo que valida el ejemplo 1-024 de SAP2000 (su «NRC 10 %»). «Menos del 10 %», del periodo mayor (más pares que del menor: del lado seguro).
- **VS3-3, el sismo desplaza el máximo del vano.** Con G + E, el momento positivo mayor no está donde se anula el cortante de G: con sólo las estaciones de la parte estática se quedaba corto.
- **VS3-4, un diagrama por barra y por modo no cabe.** El primer banco se fue a 16 GB en el edificio objetivo: `EsfuerzosPiezas` guardaba un `DiagramaBarra` por barra y por caso, y con 21 modos son seis veces más. Los casos de los modos son ahora «ligeros»: sus esfuerzos de extremo salen de sus resultados y no se guarda ningún diagrama suyo.
- **VS3-5, el coste está en el número de combinaciones.** La situación sísmica son 64 combinaciones (2 direcciones × 2 excentricidades × 2 signos × 4 de la otra × la sobrecarga presente o no), y cada una cuesta lo que una estática.
- **VS3-6, la excentricidad estática se queda corta en la torsión** (arriba).
- **VS3-7, en la vivienda la regla pesa un 39 %:** sus dos modos de traslación están a un 6 % de periodo, y la raíz de la suma de los cuadrados sin más daría un cortante un 28 % menor que la regla del articulado (un 22 % según Y), que queda un 6,5 % por encima de la cuadrática completa (un 1,9 % según Y).
- **VS3-8, g se cancela.** La norma toma g = 9,8 m/s² (C.2.1) y las masas van con 9,80665: la masa es el peso entre g y la aceleración, ab por g, así que las fuerzas y los desplazamientos no dependen de cuál se tome mientras sea la misma.
- **VS3-9, C > 1,8.** Con el periodo fundamental de una dirección mayor que TB, el art. 2.4 manda α = 2,5 también por encima de TB: se hace y se avisa (`sismo/meseta-larga`).
- **VS3-10, de paso:** las consultas por defecto de la CLI miraban los casos del fichero, no los del programa: con el viento de VS1, las combinaciones salían bien (las da `Consultas`), pero la selección por defecto no veía sus casos.

**Lo que decidí al hacerlo, confirmado por el usuario el 2026-11-06** (las recomendaciones de Claude, aceptadas):
- **VS3-a:** los casos del sismo son lógicos (no van al modelo analítico ni a los resultados) y sus nombres, `EX+e`, `EX-e`, `EY+e` y `EY-e`.
- **VS3-b:** con `ab`, son obligatorios `K`, `terreno` y `mu` (no hay valor por defecto que no sea una hipótesis de proyecto); por defecto, importancia normal, Ω = 5 % y e = 1/20.
- **VS3-c:** la regla del 10 %, par a par y respecto al periodo mayor (VS3-2).
- **VS3-d:** la fuerza equivalente de cada planta, para el par de la excentricidad, es la diferencia de los cortantes combinados (puede salir negativa en plantas altas, como en Concreta). El signo no importa (se calculan `+e` y `−e`); en las plantas altas puede quedar algo por debajo de la fuerza de cada modo combinada planta a planta: se contrasta en VS5 y, si sale corta, se cambia. **Cambiada el 2026-11-08** (§14): salía un 23–34 % corta en las plantas de abajo frente a la de CYPECAD, y ahora es la suya.
- **VS3-e:** si el par no se puede escribir con los modos (un diafragma con masa y sin inercia de giro), es un error y no hay casos del sismo; con `"excentricidad": 0` se calcula sin ella.
- **VS3-f:** todos los modos, sin truncar (VS2-3). Con los de «el 90 % y T > TA» serían de 10 a 14 de los 21 de los edificios objetivo. Se reabre sólo si no cabe en el perfil móvil.
- **VS3-g:** la excentricidad, como torsor estático (VS-i), con lo medido arriba. Mover la masa son cuatro juegos de modos (cuatro veces los casos base); el torsor se queda por ahora, y se decide en VS5, cuando se vea qué hace el CYPECAD del usuario: si mueve la masa, se cambia entonces.

**Fuera de VS3:**
- la app (VS4): las fichas, el modo «Modal», los casos del sismo en los selectores (hoy la app los usa en las combinaciones por defecto, pero no los lista) y la sección del informe;
- el municipio: los datos de peligrosidad del IGN y su prueba contra el Anejo 1 (VS-l) van con la ficha de VS4; hasta entonces, `ab` y `K` se escriben;
- la componente vertical, el segundo orden (sólo el aviso con θ) y las plantas sin diafragma (VS6).

## 13. VS4 hecho (2026-11-07): la app, el agente, el municipio, la envolvente y la memoria

Lo que faltaba de §3.5 más tres pendientes de VS3: el municipio (VS-l), la envolvente de las 64 combinaciones de la situación sísmica y la memoria en Chrome. Falta la puerta de uso del usuario (las fichas y el modo Modal con un proyecto suyo) y VS5.

**El municipio (VS-l):**
- `src/normas/datos/ncse02.hazard.json` y su manifiesto, copiados byte a byte de Concreta (los mismos datos: el manifiesto lleva el sha256 y la prueba lo comprueba), con la cita del IGN en `NOTICE` (CC BY 4.0, sólo para estos datos). `src/normas/peligrosidad.ts` (portado de `hazard.ts`: `municipioPorIne`, `buscarMunicipios` con los cuatro niveles, `textoProcedencia`, `MENSAJE_NO_ENCONTRADO`, que **no afirma la exención**) y `src/normas/provincias.ts` (las 52 provincias con la zona eólica de su capital y el aviso de frontera, de `lib/acciones/provincias.ts`).
- **`acciones.sismo.ine`** (el código INE de 5 cifras, como `PubSismo` de Concreta) da `ab` y `K` de la tabla; `municipio` es el nombre, opcional, y tiene que ser uno del código (`sismo/municipio-no-casa`). `ab` y `K` escritos mandan cada uno por su lado; un código que no está en la tabla es error (`sismo/municipio-desconocido`), nunca una exención en silencio. La hipótesis dice de dónde sale cada uno. `tieneEspectro(m)` es «hay `ab` o `ine`».
- **El oráculo, el Anejo 1:** `validacion/vs4/anejo1.py` lee el texto de la norma (la edición del Ministerio de Fomento, que no se versiona) con `pdftotext -layout`: dos columnas por página, con los valores compactados arriba de cada columna (el k-ésimo valor es del k-ésimo municipio; se exige que cuadren en las 46 columnas) → `src/normas/__fixtures__/ncse02-anejo1.json`, 2 615 entradas. `src/normas/peligrosidad.test.ts`: **2 614 casan con la tabla con el mismo ab y el mismo K** (2 587 por su nombre y 27 por `NOMBRES_DEL_ANEJO`: grafías y nombres oficiales cambiados desde 2002, erratas de la edición y cuatro municipios que el anejo nombra por su capital). Lo que no casa va con su motivo: **Sant Joan de Mediona** (0,05) es la capital de Mediona, que el anejo lista también como «Mediona» (0,04): el BOE da dos valores al mismo término y la tabla tiene el menor (**pendiente del usuario**: en Mediona, `ab: 0.05` a mano, del lado seguro); y Altzaga y Lekunberri (segregados en 1992 y 1995) están en la tabla sin estar en el anejo. Los 19 `segregado` heredan exactamente de su `padre`; las 6 `anejo1-texto` y la 1 `correccion` están en el anejo con sus valores. 2 635 = 2 614 + 19 + 2.
- **`fem emplazamiento <municipio | INE>`** (`src/agente/emplazamiento.ts`, también en el servidor MCP): los municipios que casan, con ab, K, procedencia y la zona eólica de su provincia con su frontera; sin coincidencias, `MENSAJE_NO_ENCONTRADO`. La skill pide el emplazamiento por esa orden, nunca de memoria, y la lista del encargo (MA1) lleva el grupo «Viento y sismo del programa» (municipio, aspereza, rasante, terreno, sistema y μ, importancia).

**La envolvente de la situación sísmica, sin rehacer lo que comparten las combinaciones.** Las 64 combinaciones son 2 partes estáticas (con las variables o sin ellas) y 4 casos del sismo con su ± y su 30 %. Cada consulta volvía a combinar los modos de cada caso en cada punto, combinación a combinación. Ahora:
- **los diagramas de las barras** (`DiagramaCompuesto`): la rejilla de estaciones (las de la parte estática, los décimos y los cambios de signo) y lo evaluado en ella, por índice y compartido por todas las combinaciones con la misma parte estática y los mismos casos (`Rejilla`); los esfuerzos de un caso del sismo que son constantes en la barra (el axil, los cortantes y el torsor: los modos no cargan las barras) se combinan una sola vez, y los dos lados de un punto se comparten cuando el modo dominante no cambia de signo (`mismoSigno`); sólo los vértices de cada combinación se evalúan aparte. `recorrer` lee una combinación entera sin hacer un vector por lectura (`recorrerDiagrama`, en `envolventes`). Y `DiagramaBarra.combinar` hace los desplazamientos cuando se piden: quien busca extremos de esfuerzos no los lee, y eran la mitad de combinar (también sin sismo);
- **los mapas** (`CampoPlanta` en `render/resultados.ts`): la parte estática por su clave y el valor de cada caso del sismo en cada nudo (`Superposicion.espectralVector`), una vez; cada combinación son sumas por nudo;
- **las franjas** (`CombinarEnDosPasos`): los momentos medios de cada caso con factor, una vez por estación (`porLogico`), y cada combinación, lineal (`combinarLogico`).

  **Los mismos números:** `sismoEspectral.test.ts` (VS4) compara `recorrerDiagrama` con leer `estaciones()` y `esfuerzosEn()` combinación a combinación en todas las barras de un pilar y de una viga (80 combinaciones), el mapa de la envolvente con `valoresCampo` en cada combinación y la envolvente de una franja con `combinar` en cada una; y los sha256 de las diez consultas de `validacion/vs4/envolventes.ts` son los de un árbol de trabajo en el commit anterior (HR-8), en el edificio objetivo de 7 plantas. **El tiempo**, como información (Node, una pasada en caliente), en el edificio objetivo de losas con la situación sísmica (80 combinaciones): envolventes de todas las piezas de 27,0 a 15,5 s (sin el sismo, de 10,3 a ~6 por los desplazamientos perezosos); el mapa de uz con la envolvente, de 1,43 a 0,06 s. Lo que queda en los mapas de M y en las franjas (2–2,4 s y 6–7,5 s) es la recuperación SPR de los campos de los 25 casos base, no la combinación.

**La app y el agente (§3.5):**
- **Cargas:** el selector de caso lista detrás los casos del programa (`EstadoSesion.casos[].programa`: «Del programa (viento y sismo)») y la planta, el alzado y el 3D los dibujan (`src/visor/programa.ts`): los del viento, las puntuales que resuelve el compilador; los del sismo, con resultados, **sus fuerzas equivalentes de planta** (la diferencia de los cortantes combinados; desde el 2026-11-08, la combinación de las de cada modo, §14) en el centro de masas desplazado ±e, que dan el par de cada caso (`sismo.test.ts` del visor lo comprueba). La ficha **«Viento y sismo»** (`FichaAcciones.tsx`, botones Viento y Sismo de la barra) edita `acciones` entera en un paso de deshacer (operación `acciones` del editor): zona o qb, aspereza, altitud y rasante, con las fuerzas por planta de lo aplicado (pedido `viento`, sin calcular); el municipio con un buscador sobre la tabla (y ab y K a mano por encima), el terreno, μ, la importancia, Ω, la regla, la excentricidad, el sistema y la nieve, con el emplazamiento y la curva del espectro (pedido `sismo`; con resultados, los periodos de los modos sobre ella).
- **Resultados · Modal** (`Modal.tsx`; pedidos `modal` y `modo`): la tabla de los modos (T, f, masa efectiva en X, Y y giro, acumuladas; con espectro, el cortante en la base de cada modo y el dominante), las masas por planta con su centro de masas y radio de giro, la forma del modo elegido animada en el 3D (la deformada de I4, con la mayor traslación de los centros de masas igual a la amplitud) y, con espectro, los cortantes de planta por dirección (V, F equivalente, e, par, u·μ, deriva, θ) y el cortante en la base. `app/src/test/modal.test.tsx` comprueba la tabla contra las consultas.
- **El informe de `fem revisar`:** la sección «Viento y sismo del programa», con el viento por plantas, las masas y los modos y el sismo por espectros (emplazamiento, cortante en la base por dirección, las plantas con θ y el contraste con el simplificado).
- **`textoApp`** no pone coma decimal en los números de artículo («art. 1.2.3»).

**La memoria en Chrome** (`validacion/vs4/chrome.ts`, `out_memoria.txt`): el edificio objetivo de losas con y sin acciones, abierto en la app compilada; el montón de JavaScript del worker de sesión (V8 más los búferes de los arrays tipados, `Runtime.getHeapUsage`) y la memoria privada del proceso, tras recoger la basura, en cuatro pasos. **Lo primero que salió:** el worker guardaba los resultados empaquetados para `paquete` (la caché del navegador) hasta que alguien los pidiera, y abierto por URL o desde el disco nadie los pide: con el sismo, 321 MiB de más. Ahora se empaquetan al pedirlos (`Sesion.paquete`, los mismos bytes y el mismo sha256; 0,2–0,5 s). Lo que se mide después, en MiB del worker (V8 más búferes), tras calcular → Modal → Losas con la envolvente de M11 de N7 → Armado (las franjas de N7) → Pilares:

  | Edificio de losas, 7 plantas | Tras calcular | Modal | Losas, M11 (3D: las 7 plantas, VS4-5) | Armado | Pilares | Proceso del renderer al final |
  |---|---|---|---|---|---|---|
  | Sin acciones (4 casos) | 234 | 236 | 574 | 1 027 | 1 044 | 1 772 |
  | Con viento y sismo (25 casos base) | 607 | 608 | 2 507 | 3 807 | 3 846 | 5 898 |

  Tras calcular, los 607 son los resultados (321, con los 21 modos), el núcleo WASM (~200) y el montón. **Lo que no cabe en ningún móvil es lo de después:** los mapas y las franjas retienen lo de cada caso base (los campos SPR y lo que prepara el corte), y con el sismo son 25 casos en vez de 4: +1,9 GB en Losas (los campos de las siete plantas: la vista era el 3D, VS4-5 en §13.1) y +1,3 GB más en Armado (las franjas de una). En Node, tras recoger la basura, el mapa de N7 retiene 324 MiB (13 MiB por caso base y planta) y la primera dirección de franjas, 589 más; Chrome suelta la basura más tarde y su cifra es mayor. Es el pendiente de VS3 («el mapa de una planta guarda los campos de todos los casos base»), ahora medido: **la salida natural es la de esta fase, llevar a los campos y a los cortes lo de `CampoPlanta`** (guardar por planta los 4 vectores de los casos del sismo ya combinados y soltar los de los modos), o truncar los modos (VS3-f: con los del 90 % y T > TA, de 10 a 14 de 21). Queda para el usuario decidir el orden (abajo).

**Hallazgos:**
- **VS4-1:** `Runtime.getHeapUsage` sin `backingStorageSize` no ve los resultados: son `Float64Array`, fuera del montón de V8. Se suman los dos.
- **VS4-2:** lo que costaba en las envolventes no era combinar los modos sino la contabilidad: buscar cada punto en una lista (cuadrática con las combinaciones), un vector por lectura y la parábola del vértice por combinación. Con todo por índice, los vértices (hasta 4 por combinación y barra) son lo que queda.
- **VS4-3:** el Anejo 1 da dos valores a un término municipal (Mediona y su capital Sant Joan de Mediona) y la tabla del IGN tiene el menor.
- **VS4-4:** `textoApp` convertía «art. 1.2.3» en «1,2.3» (la coma decimal).
- **VS4-5** (2026-11-07): el banco de memoria medía en el 3D que deja Resultados · Modal, y el 3D de Losas pinta todas las plantas: «el mapa de una planta» eran siete. Y un paso que pulsa un botón que no actúa da la misma cifra que el anterior: cada paso comprueba ahora que el estado cambió (§13.1).

**Pendiente del usuario:** la puerta de uso (la ficha y el modo Modal con un proyecto suyo, mejor con la vivienda y su municipio); Mediona (VS4-3); y VS5. **Decidido el 2026-11-07:** la memoria de los mapas y las franjas con los 25 casos base, soltando los campos de los modos tras combinarlos por planta (§13.1), no truncando los modos. **Pendiente técnico:** la flecha de las losas con combinaciones del sismo recorre cada combinación nudo a nudo (10,9 s en el edificio objetivo con ELS-C y la situación sísmica; no es un conjunto por defecto); el viento sólo según X e Y; los estratos del terreno se escriben en el fichero (la ficha los conserva pero no los edita).

### 13.1. La memoria de los modos (2026-11-07): combinados por planta y sueltos

Decisión del usuario: la opción (a) de §13, no truncar los modos. El motor y las consultas guardan por caso base lo que cuesta rehacer, y con los modos como casos base (VS3) eran 25 en vez de 4: el evaluador SPR de cada caso (`CamposLaminas.evaluadorCompartido`: las muestras de cada lámina, los coeficientes de cada parche y el valor de cada plaza; unos 30 MiB por caso y planta en el edificio objetivo), las fuerzas nodales de cada lámina que piden los cortes (`Cortes`), los campos de cada planta de los mapas (`ResultadosRender.valores`: 32 por lámina y caso) y un vector de cargas nodales de 6·n por caso en `FuerzasNodales` (los modos no tienen cargas: 4 MiB a cero cada uno). De los modos sólo hace falta su combinación (los casos del sismo, `CasoEspectral`), y ésa es por planta.

**Lo que hay ahora:**
- **`CasosEfimeros`** (`src/motor/casosEfimeros.ts`): los casos base cuyo guardado se suelta. `Consultas.efimeros` los crea con los modos (`Superposicion.basesEspectrales`); `trabajarEn(planta)` suelta lo guardado de ellos al cambiar de planta (`CamposLaminas.soltarEvaluador`, `Cortes.soltarCasos`), y lo que una planta comparte (los mapas de M y de V, las franjas en las dos direcciones, las bandas) se calcula una vez. Franjas, bandas y muros lo llaman al empezar cada grupo; los mapas, al evaluar una planta.
- **Los mapas** (`ResultadosRender.valores`): por planta guardan los campos de los casos estáticos y, por caso del sismo, los de sus modos combinados en cada nudo, componente a componente (`Superposicion.espectralVector`, las mismas cuentas que `CampoPlanta` hacía al pedir cada componente). Los modos se evalúan por **bloques de 2 048 láminas con un evaluador nuevo por bloque que se suelta con él** (`BLOQUE_MAPA`): lo retenido es el de un bloque y sus coronas, y se rehacen las coronas (≈ +20 % de las plazas de los modos). `CampoPlanta` lee la componente; un modo pedido como caso base suelto se evalúa para ese mapa y no se guarda (`valoresCaso`).
- **Las franjas** (`EsfuerzosFranjas.calcularGrupo`): el barrido por campos va en orden a lo largo de la losa y lo que un modo recupera para una recta sólo lo reutilizan las vecinas, así que lo de los modos se suelta al empezar el barrido y **cada 24 rectas** (`RECTAS_POR_SUELTA`, 6 m: se rehacen las dos coronas del borde, ≈ +25 % de sus plazas). Lo de los casos estáticos sigue compartido entre todo.
- **Los cortes** (`Cortes.soltarCasos`): lo guardado por lámina y barra admite huecos por caso, que se rellenan al pedirlos con la rigidez del elemento calculada una vez (`FuerzasNodales.laminaCasos(l, casos, en)`). Lo de las restricciones (unos nudos por pilar) se queda. Y los casos sin cargas nodales comparten un vector nulo.
- **El clic en un mapa de envolvente** (`valorEnPunto`, `valorLamina`) va ahora por caso lógico (`casosSueltos`, `Superposicion.combinarLogico`): el de un caso del sismo es el campo de sus modos combinados en los nudos, interpolado en el punto, que es lo que pinta el mapa. Antes interpolaba cada modo y combinaba después: en los nudos es lo mismo; entre ellos, el valor cambia en la cuarta o quinta cifra y ahora casa con el dibujo. Es el único número que se mueve.

**Los mismos bits:** `sismoEspectral.test.ts` (VS4) comprueba qué se suelta y cuándo (los modos no dejan evaluador compartido tras un mapa; los estáticos sí; al cambiar de planta se sueltan los de los cortes) y que lo que se vuelve a calcular tras soltar (el mapa de una planta, sus franjas en las dos direcciones con los huecos de los cortes rellenados, un modo suelto) es byte a byte lo de unas consultas que sólo trabajan en esa planta; y los sha256 de cada paso de `validacion/vs4/memoria.ts` son los de un árbol de trabajo en el commit anterior (HR-8). Pasan las 23 pruebas del fichero y las 462 de render, visor, franjas, bandas, muros, campos y cortes.

**Medido en Node** (`validacion/vs4/memoria.ts`, `out_memoria_node.txt`: lo retenido tras `gc()`, con una espera para el barrido de los búferes, que es concurrente; el edificio objetivo de losas con viento y sismo, 25 casos base y 80 combinaciones; MiB):

  | Paso | Antes | Ahora |
  |---|---|---|
  | Calculado, sin consultas | 775 | 775 |
  | Mapa de M11 de N7 (y el de V13, guardado) | +405 | +165 |
  | Franjas de N7 en X | +529 | +484 |
  | Franjas de N7 en Y | +30 | +31 |
  | Mapa de M11 de N6 | +280 | +3 |
  | Franjas de N6 en X | +167 | +121 |
  | Total al final | 2 188 | 1 582 |

  El mapa de una planta retiene 165 en vez de 405 (los 4 estáticos, los 4 casos del sismo combinados y nada de los modos); la planta siguiente, +124 en vez de +447; y las primeras franjas, +484, de los que 62 son los modos del último tramo del barrido y el resto no depende de ellos: `Cortes` y `FuerzasNodales` al crearse (+160, los elementos del modelo preparados otra vez, también sin sismo), los evaluadores estáticos de la partición de membrana, lo guardado de los cortes y las estaciones de las franjas con sus medios por caso (3 × 25 por estación y muestra, decenas de miles de estaciones). Lo que sigue creciendo por caso base son esos medios y lo de los casos estáticos.

**Medido en Chrome** (`validacion/vs4/chrome.ts`, `out_memoria.txt`; MiB del worker de sesión tras recoger la basura, con dos pasos nuevos, el mapa y las franjas de la planta de debajo):

| Edificio de losas, 7 plantas, con viento y sismo | Tras calcular | Modal | Losas, M11 de N7 | Armado de N7 | Losas, M11 de N6 | Armado de N6 | Pilares | Renderer al final |
  |---|---|---|---|---|---|---|---|---|
  | Antes (commit anterior, con el banco de ahora) | 607 | 608 | 909 | 1 365 | 1 637 | 1 779 | 1 819 | 2 804 |
  | Ahora | 607 | 608 | 739 | 1 157 | 1 240 | 1 345 | 1 384 | 2 347 |
  | Sin acciones (igual antes y ahora) | 234 | 236 | 291 | 519 | 571 | 608 | 624 | 1 180 |

  La primera planta, de +758 a +550; la segunda, de +414 a +188: lo que crece por planta con el sismo es ya 1,9 veces lo de sin acciones (+100), no 4. **El banco de §13 medía otra cosa (VS4-5):** tras Resultados · Modal la vista queda en 3D, y el 3D de Losas pinta las siete plantas con una escala común; los 2 507 y 3 807 MiB de la tabla de §13 eran los campos de las siete plantas y las franjas de una, no «el mapa de una planta». El banco fuerza ahora la vista de planta y comprueba que la planta cambia (el botón que pulsaba antes no actuaba y el paso daba la misma cifra sin avisar).

**El tiempo, como información** (Node, en caliente, una pasada): el mapa de M11 de una planta, de 1,36 a 1,59 s (las coronas de los bloques); las franjas de una planta en X, de 2,8 a 4,4 s, y en Y, de 1,3 a 3,2 s: lo que cuesta es rehacer el SPR de los modos en cada grupo (~1,7 s), que antes se compartía con el mapa y entre las dos direcciones; la suelta periódica no se nota (lo mismo con 24 y con 48 rectas). En Chrome, Armado de N7 con sismo de 3,0 a 4,2 s. Sin acciones no cambia nada: los mismos evaluadores compartidos.

**Lo que queda:** las estaciones de las franjas guardan sus medios por caso base (con 25 casos, ×6 lo de sin sismo); `Cortes` prepara otra vez los elementos del modelo (+160 MiB en el edificio objetivo, con o sin sismo); y en el perfil móvil (512 MiB) el edificio objetivo con sismo no cabe ya tras calcular (607), con independencia de esto.

### 13.2. El emplazamiento común y la ficha rehecha (2026-11-07)

De la prueba de uso de la ficha: la gráfica del espectro se veía mal, ningún campo decía qué era, y el municipio estaba sólo en el sismo cuando de la misma ubicación sale también el viento («por la ubicación sabes también qb»). Como en Concreta, donde los datos de la obra (`lib/obra`: provincia, municipio y altitud) los heredan viento, nieve y sismo.

**El modelo:** `acciones.emplazamiento` = `{ provincia?, ine?, municipio?, altitud? }` (`src/compilador/emplazamiento.ts`).
- **Viento:** `zona` pasa a ser opcional; sin ella, la de la provincia (la de su capital en la figura D.1, por el código de 2 cifras o por las dos primeras del `ine`), con el aviso `viento/zona-frontera` si la figura parte la provincia; sin `altitud`, la del emplazamiento. `VientoCalculado` dice de dónde sale la zona (`zonaOrigen`, `provincia`) y la hipótesis lo nombra.
- **Sismo:** sin `ine`, el del emplazamiento (y su nombre); de ahí, ab y K. Un municipio que no figura en el Anejo 1 se escribe sólo con su nombre y la provincia; sin ab escrita, el sismo da masas y modos con el aviso `sismo/municipio-fuera-del-anejo` (no figurar no es estar exento).
- **Lo escrito manda:** la zona o la altitud del viento y el `ine` del sismo están por encima del emplazamiento, así que los ficheros de antes dan lo mismo (las pruebas de viento y sismo, sin tocar, pasan).
- **Errores** (`validar`): `emplazamiento/provincia` (código mal o que no casa con el del municipio), `emplazamiento/ine`, `emplazamiento/municipio-desconocido`, `emplazamiento/municipio`, `emplazamiento/altitud` y `emplazamiento/no-valido`; `viento/zona` dice que falta la provincia.
- `fem emplazamiento`, el MCP y la skill dicen que el `ine` va en `acciones.emplazamiento`.

**La ficha** (`app/src/editor/FichaAcciones.tsx`):
- arriba, el emplazamiento, común a las dos pestañas: provincia, municipio (el buscador del Anejo 1 con los de la provincia primero y los de otras detrás; uno que no figura, «Guardarlo sólo con su nombre») y altitud, y lo que sale al momento: zona eólica y qb, ab y K con su procedencia, y el aviso de frontera;
- viento: la zona «la de la provincia» o forzada (dice cuál es la de la provincia), qb como la de la zona, la simplificada (0,5) o escrita, la aspereza y la rasante; sismo: ab y K escritos, terreno con su C, μ como desplegable (1 sin ductilidad … 4 muy alta, uno por dirección), importancia, sistema, Ω, regla y excentricidad;
- cada campo, su «?» (`Ayuda`) con lo que es, el artículo y de dónde sale el valor por defecto;
- los resúmenes, en cifras con su significado al pasar el ratón (qb, zona, aspereza, altura; ab, K, C, S, ρ, ac, TA · TB, ν, μ, β), cp y cs en una tabla por dirección y la suma de las fuerzas en la tabla de plantas;
- «Aplicar» pasa al emplazamiento el `ine` del sismo y la altitud del viento de un fichero de antes, y deja de escribir la zona si es la de la provincia.

**La gráfica** (`app/src/editor/Espectro.tsx`, también en Resultados · Modal): se dibuja al ancho de su caja en píxeles (antes, un `viewBox` fijo estirado al 100 %: el texto crecía con el diálogo y la leyenda tapaba la curva); la leyenda, fuera, en HTML; ejes con marcas redondas y rejilla, T en s abajo, α a la izquierda y, con sitio, ac·αᵢ en g a la derecha (lo que llega a las fuerzas); TA y TB hasta la curva elástica (sólo sus nombres si no caben); X e Y en una sola curva si son iguales; los modos interpolados en la curva, con su periodo al pasar el ratón.

**Validación:** `src/compilador/emplazamiento.test.ts` (sin zona, las fuerzas de la zona escrita con `toEqual`; el espectro del `ine` del emplazamiento, el del escrito; los errores; el aviso fuera del Anejo 1) y `app/src/test/fichaAcciones.test.tsx` (un fichero de antes pasa al emplazamiento; la provincia da la zona y forzarla la escribe; el buscador; un municipio sólo por su nombre; un «?» por campo). Capturas en Chrome de las dos pestañas, el buscador y Modal.

### 13.3. La nieve del emplazamiento (2026-11-07)

**Decisión del usuario:** la carga de nieve la pone el usuario (qué es cubierta, dónde se acumula junto a petos, limahoyas y cambios de nivel, qué pasa con una pérgola es criterio suyo, y repartirla sola fallaría sin avisar); de la ubicación salen el valor y el tipo de caso.

**Lo que hay:**
- **Normas** (`src/normas/cteNieve.ts`, de Concreta, commit f6afb7d, en `NOTICE`): las tablas E.2 y 3.8, el factor de exposición, μ del faldón y sk por zona y altitud. `provincias.ts` lleva ya la zona de clima invernal de cada provincia (con su aviso de frontera, `fronteraInvernal`), su capital de la tabla 3.8 y `esCapitalDeProvincia`.
- **Modelo:** `acciones.nieve` = `{ zonaInvernal?, capital?, exposicion?, sk? }`, sólo lo que se fuerza; no genera casos ni cargas, y el modelo analítico no cambia. Basta el emplazamiento para que salga sk.
- **Compilador** (`src/compilador/nieve.ts`): `nieveObra` da sk (la escrita; la 3.8 si el municipio del emplazamiento es la capital o se fuerza; si no, la E.2 por la zona de la provincia o la forzada y la altitud), el factor de exposición, qn = μ·sk con μ = 1, el ψ por la altitud y notas (la 3.8 a otra altitud que la de la capital, fuera de tabla, el hielo por encima de 1 000 m, la simplificación de 1,0 kN/m² del art. 3.5.1-1). Con algún caso S: el aviso `nieve/psi-altitud` (su ψ es el de la otra altitud), `nieve/fuera-de-tabla` y una hipótesis con sk, su origen y que las cargas son del usuario. Errores `nieve/*` en `validar`.
- **Editor** (`propuestaCasoNieve`, `src/editor/casos.ts`): el caso típico que pide la altitud si falta, o el cambio de ψ (con la duración del típico) si los de nieve llevan el de la otra.
- **App:** la pestaña «Nieve» de la ficha (ahora «Viento, nieve y sismo», con el botón «Nieve» en la barra de Cargas): zona de clima invernal (la de la provincia o forzada), de dónde sale sk (la 3.8 si es la capital, la E.2 o escrita), exposición; lo que sale en cifras al momento (sin pedir nada al worker); el estado del caso de nieve con «Crear …» o «Cambiarle el ψ»; y lo que queda a mano (μ de faldones de más de 30°, distribución asimétrica, acumulaciones, hielo). En la plantilla de la carga de superficie, con un caso de nieve activo, «Nieve de la obra: μ·sk = … · Usar» rellena q (no se pone sola: las cargas no tienen valor por defecto, V2c-2). El gestor de casos marca en «Casos típicos» la nieve de la obra y la propone.
- **Agente:** `fem emplazamiento` da la zona invernal y la capital de cada provincia y si el municipio es la capital; la skill pide en qué forjados va la nieve y explica `acciones.nieve`.

**Validación:** `src/compilador/nieve.test.ts` (las pruebas de Concreta de la E.2, el cruce de cada capital con la 3.8 a ±0,1, μ y la capital por su nombre; sk desde el emplazamiento en Alhaurín, Granada capital y forzada la E.2; lo forzado; los motivos; el aviso, la hipótesis y el modelo analítico idéntico; las operaciones del caso) y `app/src/test/fichaAcciones.test.tsx` (Ávila: la 3.8, el ψ de más de 1 000 m, el hielo, «Cambiarle el ψ», la exposición y la E.2). Capturas en Chrome de la pestaña y de la plantilla con «Usar».

### 13.4. VS-o, los efectos pésimos con el sismo (2026-11-08)

**De dónde sale.** CYPECAD no deja ver los isovalores de una combinación con sismo dinámico. Su aviso dice que lleva la expansión modal hasta el dimensionado: en una misma sección, el cortante y la flexión pueden salir de esfuerzos distintos, porque la cuadrática completa con los efectos pésimos de cada comprobación es diferente; y que no tiene sentido hablar de combinaciones cuando entra la acción dinámica (sí, de un modo suelto o de un sismo estático equivalente).

**Lo que hacíamos (VS-g).** Cada variable con el signo del modo dominante, el mismo para todas, y el sismo como un caso más del generador. En cada variable sola es correcto, pero el generador sólo da el ± del caso entero: nunca prueba un signo del sismo distinto en cada esfuerzo. Donde una comprobación junta varios esfuerzos, eso puede quedar del lado inseguro:

- **Wood–Armer:** mx* = mx + |mxy|. Con un mxy estático que no sea despreciable frente al del sismo, +mx con −mxy no se prueba nunca (en la prueba de `woodArmer.test.ts`, la armadura superior en x pide 9 kN·m/m con los signos pésimos y 0 con un solo signo);
- **las ternas de un pilar** (N, My, Mz), igual con la flexión esviada.

**Decidido por el usuario** (las dos, como las proponía Claude):

- **(a) Las comprobaciones, con los signos pésimos.** `Superposicion.partirLogico` y `partir` (`src/motor/espectral.ts`) parten una combinación en su parte estática (los mismos bits que `combinar` sin el sismo) y, por variable, la amplitud del sismo: Σ |factor·valor| de sus casos del sismo, sin signo (con el 100 % de uno y el 30 % del otro, se suman: el generador ya da todos los signos de cada uno).
  - **Wood–Armer** (`woodArmerPesimo`, `src/dimensionado/woodArmer.ts`): los 8 signos de mx ± A, my ± A y mxy ± A, y cada momento de dimensionado con el peor. Es lo que dan las franjas (`EsfuerzosFranjas.envolvente`), así que también el mapa de armado, las zonas de refuerzo, el clic y `fem consultar franjas|franja|refuerzos`. El mx máximo y mínimo de la estación es la variable sola y no cambia.
  - **Las ternas de los pilares** (`ternasPesimas`, `src/agente/consultas.ts`, en `fem consultar pieza` y el cuadro de Pilares): My, Mz, Vy, Vz y T con el signo que aumenta su valor absoluto, y N con los dos (primero la menor compresión, que gana los empates del mayor |My| o |Mz|). Las demás combinaciones de signos dan menos momento a igual N. Cada terna así lleva `pesimos: true` y en la app una «±» con su explicación.
  - Nunca da menos que antes (lo comprueban las pruebas) y, sin el sismo del programa, los mismos bits.
- **(b) Los mapas, dichos.** Con alguna combinación con el sismo, Losas lo avisa (`Combinaciones.sismo`: «± sismo» en la cabecera y una nota: es la envolvente de cada variable, no un estado de la losa ni simultánea entre puntos o magnitudes). La deformada de una combinación con el sismo ya no se dibuja (`visor/deformada-sismo`): sus desplazamientos no son una forma de la estructura; la de cada modo, en Modal, y los desplomes, en su tabla.

**Los pares pésimos de las vigas** (hecho después, el 2026-11-08, del contrato de §9): cada extremo de vano de `fem consultar pieza` (My+, My−, Vz y, nuevo, T: el mayor |T|) lleva los seis `esfuerzos` de su punto.
  - Sin el sismo, los concomitantes de su combinación (lo que no se tenía: el T y el My que acompañan al Vz). Los valores de los extremos no cambian.
  - Con él (`pesimos: true`), los de sus signos pésimos (`esfuerzosPesimosViga`, `src/agente/consultas.ts`): Vy, Vz, T y Mz con el signo que aumenta su valor absoluto (el cortante y la torsión suman sus tensiones en una cara, así que la interacción y las armaduras crecen con |Vz| y |T|); My, con el del extremo (el decalaje y la interacción M–V del acero crecen con |V| a igual M); N, con la menor compresión (baja la resistencia a cortante). Con todos los signos del sismo en el conjunto, el esfuerzo del extremo es su valor.
  - La partición sale del diagrama de la combinación en ese punto (`DiagramaCompuesto.partidoEn`, la de `Superposicion.partirLogico`), y `Consultas.vano` la da con cada extremo (`ExtremoDiagrama.partes`, también `maxT` y `minT`).
  - Prueba (`sismoEspectral.test.ts`): la partición en cada estación de una viga frente a la regla a mano y a `Superposicion.partir` con los esfuerzos de cada caso base, a 1e-9; la regla de los pésimos escrita aparte, bit a bit; el pésimo nunca da menos que la combinación con el signo dominante, y en algunas estaciones junta |Vz| + |T| mayores; sin el sismo, los concomitantes.
  - **Las barras, el mismo día:** sus extremos a lo largo de la barra (N+, N−, Vy, Vz, My, Mz) llevan también sus `esfuerzos` (`esfuerzosPesimosBarra`). Una barra es casi siempre de acero, que se comprueba con la interacción de N con M, creciente en |N|: N+ y N− con su signo y, en los demás extremos, |N| aumentado como el resto. Se buscan recorriendo los diagramas de sus tramos (`recorrerDiagrama`), con los mismos valores, estaciones y combinaciones que antes (la prueba lo compara con el recorrido de antes). La regla común de pilares, vigas y barras es `esfuerzosPesimos(partes, fijos)`.
  - **En la app, el mismo día** (`app/src/pantallas/Extremos.tsx`): Resultados · Diagramas da, por vano de una viga o vigueta, una fila por extremo (My máx., My mín., Vz máx. y T máx.) con su estación, su combinación, la «±» si lleva el sismo y sus Vz, T y My (el suyo, en negrita); en una barra, «Extremos a lo largo de la barra» con N, Vz, My y Mz (`DatosViga.extremos`, los de `pieza`). Antes, una fila por vano con My+, My− y Vz sueltos. Pruebas: `app/src/test/extremos.test.tsx` y `src/visor/barras.test.ts`.

**Fuera:** los diagramas son de una variable y no cambian; el ν de los pilares es del N solo. **Hecho después, el mismo día** (decisión del usuario): `woodArmerEstacion`, el Wood–Armer de las bandas del Anejo I con un solo signo, sale del motor a `validacion/c5/woodArmerBandas.ts`, donde la usan la referencia congelada de C5 y sus medidas (idénticas). Allí sólo combina linealmente: con los casos del sismo, lanza. La integración con Concreta queda como contrato en §9.

**Para VS5:** con CYPECAD no se comparan combinaciones con el sismo dinámico (no las da), sino cada modo (periodos, masas, forma y esfuerzos de un modo), el cortante en la base y las armaduras.

**Validación:** `woodArmer.test.ts` (los 8 signos; sin amplitud, bit a bit; un estado con el sismo de signo y fracción cualesquiera nunca pide más), `espectral.test.ts` (`partir`), `sismoEspectral.test.ts` (las ternas y Wood–Armer de las franjas frente a la regla a mano; la envolvente en dos pasos, bit a bit con la de cada combinación) y `visor/sismo.test.ts` (sin deformada con el sismo, `Combinaciones.sismo`).

## 14. VS5, primera sombra (2026-11-08): el ejemplo 11 de CYPECAD

**El modelo del usuario** (CYPECAD 2027, «prueba.c3e»; listado de 999 páginas, DWG y capturas en `ejemplos/ejemplo 1 6x6/ejemplo 11/`): tres plantas de 3 m, 2 × 2 vanos de 6 m con pilares de 30 × 30 de HA-25, reticular 25+5 de casetón perdido a 72/12 (4,487 kN/m²) con vigas planas de 30 × 30 en el perímetro y los ábacos automáticos de CYPECAD; CM 2 kN/m² y 3 kN/m en el perímetro, uso A 2 kN/m²; viento zona A, aspereza I; sismo ab 0,11 g, K 1, suelo II, ductilidad baja, Ω 5 %, CQC, «según norma» (5 modos).

**La réplica** (`validacion/sombra/ejemplo11/`):
- `leer_listado.py` lee el PDF con pymupdf: las tablas de los pilares por la posición de cada palabra (el texto sale desordenado y las tildes de algunas páginas, rotas), los modos, los centros de masas, los cortantes por planta, el viento y las envolventes de 2 724 nudos por planta;
- `dwg.ts` saca del DWG, con el lector propio, la retícula de casetones (el punto de paso de los nervios, (0,84; 1,11)) y los bordes de ábaco que cortan un casetón;
- `modelo.ts` escribe el proyecto (también en `ejemplos/ejemplo 1 6x6/proyecto.json`, para abrirlo en la app), con los ábacos de CYPECAD por las coordenadas de los nudos del listado y variantes (`cype-e`, `luces`, `srss`, `-h025`…);
- `comparar.ts` compara con las mismas combinaciones (`out_<variante>-nudos.txt`).

Lo que no sale de los datos y hay que forzar: el ancho de banda del viento de CYPECAD es de 18 m en las dos direcciones (y d = 18 m en la esbeltez), y el edificio tiene 12,3 m; se reproduce con `fachadas`. Con el ancho que sale del modelo, el motor da un 26 % menos (27,0 / 49,9 / 43,2 kN). **Los 18 m los escribió el usuario por error** (2026-11-08): no es una diferencia del motor; la réplica los mantiene para comparar con lo que calculó CYPECAD.

**Resultado** (con h = 0,25; entre paréntesis, con la malla por defecto de 0,75):

| | CYPECAD | motor |
|---|---|---|
| Viento por planta | 36,473 / 67,380 / 58,328 kN | igual |
| Peso sísmico | ≈ 4 290 kN (de las aceleraciones y masas de sus modos) | 4 326 kN (+0,9 %) |
| Centro de masas | (6,00; 6,02) | (6,00; 6,02) |
| T1 = T2 / T torsión / T4 = T5 | 0,802 / 0,635 / 0,275 s | 0,791 / 0,627 / 0,274 s (−1,4 %; −2,3 % con 0,75) |
| Masa de los 5 primeros modos | 96,37 % | 96,44 % |
| Cortante por planta (X) | 182,6 / 281,6 / 341,4 kN | 185,9 / 289,7 / 350,4 kN (+1,8 / +2,9 / +2,6 %) |

- **Pilares** (`comparar.ts` §2: 106 filas de «esfuerzos pésimos» del listado, las de cabeza y pie). Ejes: Mxx = −M3, Myy = M2, Qx = V3, Qy = −V2 del motor. N, a +1,8 % de mediana (+1,4 % sin sismo). En las combinaciones con sismo, los cortantes de la dirección principal, a +0,1 % / +1,2 % de mediana (máximo 9,5 %; con 0,75, +5 %), y los momentos, a −3,5 %.
  - **Los momentos del listado no son todos del análisis.** En las filas de N,M llevan la excentricidad mínima y el segundo orden (en P5, con cortante nulo, 57–67 kN·m). Y en las de cortante, con axil reducido ν ≥ 0,25, CYPECAD lleva siempre N·(1,2 a 2,5 cm) de más: con ν ≤ 0,2 (los pilares de esquina y los de la planta 3) casan a ±5 %, y la diferencia crece con el axil, sin cambiar el cortante. Se comparan los cortantes.
  - **Los signos pésimos (VS-o).** En una combinación con sismo, CYPECAD no da los esfuerzos concomitantes con el signo del modo dominante: en las filas de cortante, N lleva el 30 % de la otra dirección con el signo que reduce la compresión (así, N casa a +0,1 % de mediana, frente a +1,8 % con el signo de la combinación), y las componentes del 30 % no son comparables.
- **Excentricidad accidental:** CYPECAD no la aplica. Con la del 5 % (la de por defecto del motor, VS-i), los cortantes de los pilares se separan más (máximo 17,8 % frente a 9,5 %; Mxx, |dif.| 12,5 % frente a 4,5 %), y su listado sólo tiene «Sismo X» y «Sismo Y», con el centro de masas real. Tampoco mueve la masa, así que **VS3-g queda cerrada** con la regla que se fijó: el torsor estático se queda.
- **Fuerza equivalente por planta (VS3-d):** la de CYPECAD es la combinación de las fuerzas de planta de los modos (182,6 / 135,0 / 92,1 kN, que suman más que el cortante en la base); la del motor era la diferencia de los cortantes combinados (185,9 / 103,8 / 60,7), un 23–34 % corta en las plantas de abajo. Sólo la usa el torsor de la excentricidad, que CYPECAD no tiene. **Cambiada el 2026-11-08** (decisión del usuario): ahora es la de CYPECAD (`respuestaEspectral`, `src/motor/espectral.ts`; con varios diafragmas en una cota, la de cada uno combinada modo a modo), en el torsor, en la tabla de Modal, en el informe y en las cargas del sismo dibujadas (que dan el par de cada caso y ya no suman el cortante en la base). Los cortantes, los desplazamientos y lo demás, con los mismos bits. Con h = 0,25 sale 185,9 / 143,2 / 107,4 kN: CYPECAD usó aquí 5 modos y el motor usa los 9, y los terceros modos (3,4 % de la masa) pesan en la fuerza de las plantas de abajo, aunque casi nada en el cortante. En el segundo ejemplo (§14.1), con todos los modos en los dos, +2,3 / +3,6 / +6,5 % de abajo arriba. Pruebas: `espectral.test.ts` (la ménsula de dos masas, a mano), `sismoEspectral.test.ts` y `visor/sismo.test.ts`.
- **Regla de combinación:** CYPECAD usa la CQC (desde el 2026-11-08, también la del motor por defecto, VS-f). Aquí la CQC y la regla del art. 3.6.2.4 dan lo mismo con h = 0,25. Con 0,75, la malla gira 10° la pareja de modos de igual periodo (2,5 % de masa cruzada) y la regla de la norma suma los dos en valor absoluto: los cortantes de los pilares se separan un 9,7 % de mediana.
- **Forjados** (envolventes E.L.U. en los nudos, sin los picos de un solo nudo pegado a la cara de los pilares, que en CYPECAD son singulares: −172 junto a otro de −100): momentos positivos a 0,92–0,96 de CYPECAD (0,91–0,93), negativos a 0,95–0,97, cortantes a 0,96–1,04 (en los ábacos, 1,03–1,09 con 0,75) y flechas características a 0,91–0,95 en el aligerado. Como en la vivienda (`fase-lv.md` §2.4).
- **Vigas del pórtico 1** (capturas): en la planta 1, persistentes, My en las caras −60,2 / −52,1 · −52,4 / −60,3 kN·m frente a −60,0 / −57,3 · −52,7 / −60,2 (0–9 %); con 0,75, −57,7 / −48,3 · −49,5 / −60,4. En la planta 3, sísmicas, −5 a −14 % en las caras y los positivos de vano iguales (9,9 / 10,0 frente a 10,1 / 11,4). Vz, ±20 %: junto al pilar de esquina el motor lleva una concentración del sismo (de 29,6 a 7,2 kN en 0,36 m) que CYPECAD no tiene. CYPECAD dibuja con «Decalar las leyes de momentos» marcado.
- **Ábacos:** los de AC-e casi no cambian el resultado (cortantes de los pilares a ±0,5 %); su geometría, en `abacos.md` §7.1.

**Visto de paso (malla):** con la configuración más común —pilares de 30 × 30 en el eje de vigas de borde de 30 y la losa hasta el borde—, los refinamientos de LV2 no entran en ningún pilar de borde: `malla/esquina-sin-refinar` en las cuatro esquinas y `malla/pilar-tapado-sin-refinar` en los cuatro de borde, en las tres plantas. Pasa igual con una maciza y sin cargas, y no sin las vigas. Con 0,75 el momento de la viga en la cara de P2 sale un 16 % por debajo del de 0,25, como dice el aviso. **Hecho en la fase PB** (`pilares-borde.md`, 2026-11-08): la plantilla de esquina entra ya en los pilares de esquina, y la de cara sólo va donde la huella cruza la cara de la viga (en el enrasado alejaba la malla de la fina). El 16 % era el máximo positivo en la cara de P2 (7,4 frente a 8,8 kN·m) frente a h = 0,25, que en esas caras sale un 5–10 % alto. Frente a la malla convergida (0,125), con 0,75 la cara de P2 sale a −2 % en el negativo y a −8 % en el máximo.

**Decidido por el usuario (2026-11-08):** los 18 m del viento eran un error suyo; VS3-d, como CYPECAD (hecho); los ficheros de CYPECAD no se suben (`.gitignore`). Los esfuerzos de los pilares por hipótesis, que hacían falta para comparar sus momentos del análisis, los trae el segundo listado (§14.1).

### 14.1. El segundo ejemplo: los pilares con punto fijo (2026-11-08)

**El modelo** (2.pdf, 72 páginas): el mismo, con los pilares de 40 × 40 en el primer tramo, 30 × 30 en el segundo y 25 × 25 en el tercero, y su punto fijo en la esquina de fuera (P1, P3, P7, P9), en la mitad del lado de fuera (P2, P4, P6, P8) y centrado (P5). Las vigas, la losa, las cargas y el ancho de banda del viento (18 m), los del primero: el peso total y el centro de masas, (6,00; 6,02), lo confirman. Su listado no trae los nudos de los forjados, así que los ábacos son los del primero (en el cálculo, ≤ 1 %, §7.1 de `abacos.md`). Sí trae lo que faltaba en el primero: **los esfuerzos de cada tramo de pilar por hipótesis**, en su base y su cabeza, también los de cada uno de los 8 modos (usó todos), y su suma por planta. Variante `pf` de `modelo.ts` (también en `ejemplos/ejemplo 1 6x6/proyecto-pf.json`); `pf-centro`, las mismas secciones centradas.

Ejes del listado por hipótesis: N de compresión positivo, Mx = M2, My = −M3, Qx = V3, Qy = −V2. El sismo de CYPECAD se rehace con la CQC de sus 8 modos con sus periodos: da su cortante por planta (318,5 frente a 318,7 kN), así que la lectura y la combinación están bien.

| | CYPECAD | motor con punto fijo (`pf`, h = 0,25) | motor con los pilares centrados (`pf-centro`) |
|---|---|---|---|
| T1 = T2 / torsión | 0,771 / 0,605 s | 0,716 (−7,1 %) | 0,754 (−2,3 %) |
| Cortante por planta (X) | 189,8 / 270,0 / 318,7 kN | +6,5 / +6,6 / +6,1 % | +1,9 / +2,4 / +2,5 % |
| Derivas por sismo (con μ) | 2,08 / 1,23 / 0,53 cm | 2,01 / 1,07 / 0,47 | — |
| Cargas totales en la cimentación | PP 2 546, CM 1 334, uso 902 kN | +1,6 / +0,4 / +0,7 % | — |
| Viento por planta (cortante de los pilares) | 36,5 / 103,9 / 162,2 kN | igual | igual |
| Por hipótesis, N gravitatorio | | +3,0 % (\|dif.\| 6,7 %, máximo 13,6 %) | +0,9 % (1,0 %, máximo 4,9 %) |
| Por hipótesis, N con viento | | +10,7 % | +0,6 % |
| Por hipótesis, Qx con viento | | 0,0 % (\|dif.\| 4,0 %) | −1,1 % (2,2 %) |
| Por hipótesis, sismo: Qx / Mx / N | | +7,4 / +6,8 / +9,0 % | +2,6 / +2,7 / +2,8 % |

(Los «desplomes» de CYPECAD son los de cada planta respecto a la de debajo: 2,08 cm = 0,0069·300 cm.)

- **Con el punto fijo, el motor sale más rígido que CYPECAD y lleva más carga a las esquinas.** Con los pilares centrados queda como en el primer ejemplo (−2,3 % en el periodo); con el punto fijo, −7,1 %, también con h = 0,25, así que no es la malla. Con cargas gravitatorias, P1 lleva un 8–10 % más que en CYPECAD en todas las plantas (139,6 frente a 154,2 kN de peso propio en la base) y P5, un 5–7 % menos (748,3 frente a 699,0); P2 casa. Con los pilares centrados, P1 a +2,4 % y P5 a +1,0 %.
- **Lo que cambia en el motor al llevar el pilar hacia dentro:** su huella rígida (C2-d, HR) queda entera dentro de la losa, en vez de media fuera bajo la viga de borde: en la planta 1, un 40 × 40 que asoma 0,25 m de la cara de la viga. La losa apoya en ese cuadrado rígido, que rigidiza el nudo y le atrae carga. Las vigas no lo explican: la de borde, que ahora acaba en la arista del pilar, pierde incluso su zona rígida dentro de él (una viga cuyo eje va por el borde de la huella), y eso la ablandaría.
- **CYPECAD da, con el punto fijo, casi lo que el motor da con los pilares centrados:** como si la parte del pilar que asoma de la viga no rigidizara la losa. El motor sigue la regla de HR (validada frente a OpenSeesPy con `rigidLink` en la huella), que es lo físico para un pilar monolítico con la losa. En dimensionado, el pilar interior P5 sale en el motor un 7 % menos cargado que en CYPECAD. **Investigado en §14.2:** CYPECAD sólo une la losa al pilar donde una barra de su emparrillado (a un tercio del intereje) cruza una cara, y aquí casi no cruza ninguna de lo que asoma.
- **Las comprobaciones E.L.U.** (los pésimos, `comparar.ts` §2) dicen lo mismo: con `pf`, N +3,1 % y cortantes con sismo +6,2 / +7,3 %; con `pf-centro`, +2,0 % y +3,8 / +9,2 %.
- **Avisos de malla:** con el punto fijo los pilares de borde dejan de estar tapados por la viga (desaparece `malla/pilar-tapado-sin-refinar`), y en los de esquina de las plantas 2 y 3 sale `malla/pilar-asoma-sin-plantilla`.

### 14.2. Cómo une CYPECAD la losa a lo que asoma del pilar (2026-11-08)

Investigado a petición del usuario. **Lo que dice CYPECAD** (*Memoria de cálculo*, ccadmc01, https://downloads2.cype.com/documentos_es/manuales/ccadmc01.pdf):

- **p. 15, «1.3.1. Consideración del tamaño de los nudos»:** «Se crea un conjunto de nudos generales de dimensión finita en los ejes de los pilares y en la intersección de los elementos de los forjados con los ejes de las vigas. […] Los nudos asociados se forman en las intersecciones de los elementos de los forjados con las caras de las vigas y con las caras de los pilares y en la intersección de los ejes de las vigas con las caras de los pilares.» Y: «Las barras definidas entre el eje del pilar y sus bordes se consideran infinitamente rígidas».
- **p. 13:** el reticular se discretiza en «mallas de elementos tipo barra cuyo tamaño es de un tercio del intereje», igual en el ábaco y en lo aligerado.
- **Ninguna opción** cambia esto en la memoria (la p. 197 lo repite: «nudos de dimensión finita y rígidos en el ancho del apoyo»).

La regla es, por tanto, la de HR: el pilar es rígido en toda su sección. Pero **la losa sólo llega al pilar donde una barra del emparrillado cruza una de sus caras.**

**El emparrillado de este ejemplo**, de los nudos del primer listado: barras cada 0,24 m (intereje de 0,72 / 3) por los nervios, en las rectas x = 0,12 + 0,24·k e y = 0,15 + 0,24·k. Alrededor de P5, los nudos de las caras salen justo donde las cruzan: (5,85; 5,91), (5,88; 5,85)… Con la misma retícula en el segundo ejemplo (el mismo paño):

- **P1, P3, P7 y P9:** en F2 y F3 ninguna barra cruza lo que asoma (caras de 0,15 y 0,10 m entre la cara de la viga y la arista), así que la losa sólo llega al pilar por las vigas. En F1, una barra por cara, a 1–4 cm de la esquina interior.
- **P2, P4, P6 y P8:** dos barras en la cara interior en las tres plantas, y una por lado en F1.

CYPECAD casi no ve lo que asoma, y lo que ve depende de dónde caen los nervios.

**Medido en el motor** (`comparar.ts --union=<modo>`, sobre el modelo ya compilado; los nudos que dejan de ser rígidos pasan al diafragma; h = 0,75 salvo donde se dice):

- `caras`: rígidas sólo las caras de la huella dentro de la losa;
- `barras`: de esas caras, lo que queda a ≤ 0,12 m de una barra de CYPECAD que las cruza;
- `asoma`: rígido sólo lo de la huella en el ancho de la viga;
- `nada`: la losa no toca los pilares de borde.

| Unión de los pilares de borde | T1 | Cortante por planta | N gravitatorio (mediana, \|dif.\|) | M gravitatorios | N con viento | Sismo Qx / N | P1, PP en la base (kN) | P5, PP en la base (kN) |
|---|---|---|---|---|---|---|---|---|
| **CYPECAD** | 0,771 s | 189,8 / 270,0 / 318,7 kN | | | | | 139,6 | 748,3 |
| Motor actual (HR) | −7,5 % | +6,4…+6,9 % | +3,1 (6,9) % | +10,9 % | +11,1 % | +6,8 / +9,2 % | 154,4 | 697,3 |
| Motor actual, h = 0,25 | −7,1 % | +6,1…+6,6 % | +3,0 (6,7) % | +10,0 % | +10,7 % | +7,4 / +9,0 % | 154,2 | 699,0 |
| `caras` | −7,5 % | +6,4…+6,8 % | +3,1 (6,9) % | +10,9 % | +11,1 % | +6,8 / +9,2 % | 154,4 | 697,3 |
| `barras` | −5,4 % | +4,2…+4,5 % | +3,8 (5,3) % | −2,9 % (\|dif.\| 23,6) | +7,0 % | +3,5 / +10,0 % | 151,4 | 700,2 |
| `asoma` | −2,1 % | +2,1…+2,6 % | +2,2 (4,9) % | −12,1 % | +8,6 % | +4,1 / +6,7 % | 152,3 | 725,7 |
| `asoma`, h = 0,25 | **−0,2 %** | **+0,4…+1,2 %** | +2,1 (3,5) % | −23,5 % | +5,9 % | +2,5 / +6,0 % | 150,0 | **739,2** |
| `nada` | +7,0 % | −4,0…−5,4 % | +1,7 (5,9) % | −29,4 % | +22,6 % | +3,1 / +12,5 % | 150,5 | 794,8 |
| `pf-centro` (otra geometría) | −2,3 % | +1,9…+2,5 % | +0,9 (1,0) % | +15,6 % | +0,6 % | +2,6 / +2,8 % | 143,0 | 755,8 |

- **Lo que sobra de rigidez son las caras del pilar que tocan la losa.** Sin rigidez en lo que asoma (`asoma`, h = 0,25), el periodo, los cortantes por planta y la carga de P5 salen como en CYPECAD (−0,2 %, ≤ 1,2 %, −1,2 %). Con sólo las caras rígidas (`caras`), lo mismo que con toda la huella. El −7 % de P5 viene, pues, de la unión (las esquinas rígidas le quitan carga), y no del área tributaria. CYPECAD le da la misma carga con los pilares de 30 centrados y con el punto fijo: 1 134,0 y 1 137,2 kN en PP+CM+0,3·Qa−0,3·SX−SY (sismo nulo por simetría), con 2,9 kN más de peso del propio pilar.
- **La regla literal de CYPECAD en láminas** (`barras`) se queda en medio (−5,4 %) y se dispersa pilar a pilar (\|dif.\| de los momentos gravitatorios, 24 %). Una ventana rígida en una lámina no es una barra del emparrillado.
- **Los momentos gravitatorios de los pilares** de CYPECAD quedan entre la regla del motor (+10 %) y la unión sin lo que asoma (−23 %): en F1 y en las caras interiores de P2…P8, CYPECAD sí une.
- **Lo que no explica ninguna unión:** el axil gravitatorio de los pilares de esquina, un 7–10 % alto en todas (150–154 kN frente a 139,6; también con `nada`). Planta a planta crece con el pilar: en P1, +9 % en F3 (25 × 25) y +15 % en F1 (40 × 40). Es el eje del pilar 0,20 m hacia dentro (área tributaria de la esquina +6,5 %). CYPECAD reparte como con los pilares centrados (`pf-centro`, +2,4 %); con lo que hay, no se sabe por qué.
- **Las vigas tampoco:** la de borde P1–P2 de CYPECAD es flexible en 5,55 / 5,70 / 5,775 m en F1 / F2 / F3 (sus comprobaciones a d = 0,258 m de cada cara). Son 0,15 m más que de cara a cara del pilar de debajo (5,40 / 5,55 / 5,625). La del motor es flexible en todo su largo, también dentro del pilar, y se une al nudo en la proyección de su eje (una viga cuyo eje va por la arista de la huella). La de CYPECAD es más rígida, y el que sale más rígido es el motor.

**Valoración de Claude:** lo de CYPECAD es efecto de su emparrillado, no un criterio. Con los nervios corridos 12 cm, las barras cruzarían otras caras y el resultado cambiaría. Lo físico para un pilar hormigonado con la losa es HR (validada frente a OpenSeesPy, fase HR), y la recomendación es dejarla. Frente a CYPECAD, en esta disposición (pilares de fachada con punto fijo que asoman de la viga de borde), el motor da:

- cortantes de sismo un 6 % mayores (del lado seguro);
- derivas un 3–13 % menores;
- un 8–10 % más de axil en las esquinas;
- un 7 % menos en P5: aquí es CYPECAD el que va del lado seguro.

**Decidido por el usuario (2026-11-08):** HR se queda como está, sin opción que imite a CYPECAD. Para confirmarlo en CYPECAD bastaría correr 12 cm (media barra) el punto de paso de los nervios del segundo ejemplo y recalcular: si cambian el periodo y los axiles de P1 y P5, es el emparrillado. La comparación del pilar girado (PF-b) necesita un modelo suyo.
