# VS: viento y sismo generados desde la situación

> **Fecha:** 2026-11-06. **Estado:** decidido el 2026-11-06 (§8); VS1 (§10), VS2 (§11) y VS3 (§12), hechos; sigue VS4.
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
- **3.6.2.4:** SRSS **«para toda variable asociada a cada grado de libertad (desplazamientos, solicitaciones, tensiones…)»**. Los modos con periodos que difieren menos del 10 % se suman antes en valor absoluto. No nombra la CQC.
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
- **El signo** es el del modo con más masa efectiva en esa dirección (VS-g), el mismo para todas las variables. Así los concomitantes salen con signos coherentes: el N, My y Mz de un pilar, o el mx, my y mxy de Wood–Armer.
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
- **La concomitancia de los pilares** (H31) con un signo por dirección sigue siendo aproximada. Es lo que hacen los programas comerciales; se documenta.
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
- **VS-f, la regla:** SRSS con los modos a menos del 10 % sumados en valor absoluto, por defecto; la CQC con Ω como opción. Cuál se queda por defecto lo decide VS5: si el CYPECAD del usuario usa la CQC, hay que poder comparar con lo mismo.
- **VS-g, el signo:** el del modo de más masa en la dirección, uno para todas las variables, que es lo que mantiene la concomitancia. El ± lo da el generador.
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
- La amplificación por segundo orden, P-Δ (S1: fuera del MVP).

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
  - **La regla,** la del art. 3.6.2.4, par a par: cada par de modos con periodos a menos del 10 % (del mayor) añade 2·|xᵢ·xⱼ|. Es la suma de valores absolutos de la norma cuando los próximos lo son todos entre sí, y no depende de cómo se agrupen cuando no (VS3-2). Con `"regla": "cqc"`, la cuadrática completa del comentario C.3.6.2.4, con Ω.
  - **El signo** s, el de la respuesta del modo de más masa efectiva en la dirección, en esa variable (VS-g).
  - **La excentricidad accidental** (VS-i): un par en cada planta, el de su fuerza equivalente (la diferencia de los cortantes combinados, como en 3.7.4) por e = 0,05·L, con L la dimensión de la planta perpendicular al sismo (la caja de sus losas y paños, la del viento). Es un caso estático, y con todos los modos se escribe exacto en ellos: tᵢ = φᵢᵀ·m/ωᵢ². `+e` desplaza la recta hacia +Y (sismo según X) o +X (según Y), como en el viento.
  - **μ:** en los desplazamientos (flechas, desplomes, maestros, deformada, uz de los mapas), todo el caso del sismo va por μ.
- **Nadie aplica factores a mano.** Lo lineal se hace por caso base y la combinación, al final, en la variable que se da: los esfuerzos de un pilar, cada estación de un diagrama, una reacción, el desplome (la diferencia de desplazamientos de cada modo, combinada: no la diferencia de los combinados), la flecha relativa de un recuadro, cada nudo de un mapa, los momentos medios de una franja antes de Wood–Armer. Sin casos del sismo, `Superposicion` suma en el orden de siempre: los mismos bits.
- **El diagrama de una barra** con casos del sismo no es un polinomio: `DiagramaCompuesto` lo evalúa en cada punto. Los modos no llevan cargas en las barras, así que sus esfuerzos salen de los de sus dos extremos, que ya están en sus resultados. El sismo desplaza el máximo del vano: a las estaciones de la parte estática se añaden los décimos, los puntos donde el modo dominante cambia de signo y el vértice de la parábola alrededor del mayor y del menor My y Mz (VS3-3).

**Criterios:**
1. **SAP2000 1-022 y 1-024** (`validacion/e6/csi.ts`, `csi.test.ts`), ya con el código del motor: los modos como casos base y `Superposicion`, con la SRSS, la CQC, la suma de valores absolutos y la NRC del 10 % como opciones de la regla. Dentro del redondeo de lo publicado, como en E6. `src/pruebas/modal.ts` desaparece.
2. **A mano** (`src/motor/espectral.test.ts`): la ménsula de dos masas (cortantes, fuerzas equivalentes, desplazamientos por μ y derivas, y el cortante y el momento de cada pilar) a 1e-9 de su solución cerrada; un edificio con la traslación y el giro acoplados en dos modos a menos del 10 %, cuyos cortantes se suman en valor absoluto; y la cuadrática completa con la fórmula del comentario.
3. **OpenSeesPy 3.8** (`validacion/vs3/`, `oraculo-vs3.test.ts`): `responseSpectrumAnalysis` modo a modo en el pórtico compilado de 3 plantas, con el espectro de la NCSE-02 programado aparte en Python. La respuesta de cada modo (desplazamientos, esfuerzos de extremo de las barras con sus zonas rígidas y reacciones, con su signo) y las dos combinaciones de cada variable, a ≤ 1e-8. El cortante en la base, a 3,5e-14; en el pórtico objetivo de 7 plantas (21 modos, 14 por debajo de TA y 21 pares próximos), a 3,3e-12.
4. **El equilibrio de cada caso modal,** a 1e-9 (lo exige el motor desde VS2). Además: las reacciones de cada modo equilibran sus fuerzas de inercia; el modelo con los modos como casos, calculado otra vez, da sus resultados; el cortante en la base combinado es el combinado de los de los modos; y el torsor escrito en los modos es el caso estático con los pares (un cálculo aparte), a 1e-9.
5. **Frente al método simplificado** (`out_banco.txt`, `out_vivienda.txt`): con el periodo del modo dominante, el cortante modal queda entre 0,936 y 0,941 del simplificado en los edificios objetivo y a 0,94 y 0,85 en la vivienda. El simplificado da a su primer modo toda la masa en la meseta; el modal la reparte entre los modos.
6. **Nadie mezcla un caso de un modo con un factor:**
   - `src/pruebas/factores.test.ts` busca en `src`, `cli` y `app/src` quien aplique un factor por su índice de caso, importe la combinación lineal o combine diagramas a mano, fuera de los ficheros que lo tienen que hacer;
   - `Superposicion` y `combinar` lanzan si el vector no tiene un caso por factor;
   - `src/agente/sismoEspectral.test.ts` pasa un edificio con sismo (8 casos lógicos y 13 base) por cada consulta y la compara con la regla aplicada a mano sobre los valores de cada caso base.

**Validación de la norma** (`src/normas/ncse02.test.ts`): lo copiado, contra Concreta en cinco casos congelados por `validacion/vs3/oraculo-concreta.ts` (uno, dos y tres modos, un periodo menor que TA, estratos), a 1e-12; αᵢ, contra el texto.

**En la vivienda** (`validacion/vs3/vivienda.ts`; emplazamiento de prueba: ab = 0,10 g, K = 1, terreno II, μ = 2): 6 modos, peso sísmico de 2 104 kN y cortante en la base de 256 kN según X y 232 según Y (el 12 y el 11 % del peso). Sus dos primeros modos están a un 5 % (0,333 y 0,317 s): con la regla del articulado dan 256 kN; con la cuadrática completa, 247; con la raíz de la suma de los cuadrados sin más, 182.

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
- **VS3-7, en la vivienda la regla pesa un 40 %:** sus dos modos de traslación están a un 5 % de periodo, y la raíz de la suma de los cuadrados sin más daría un cortante un 29 % menor que la regla del articulado, que queda a un 4 % de la cuadrática completa.
- **VS3-8, g se cancela.** La norma toma g = 9,8 m/s² (C.2.1) y las masas van con 9,80665: la masa es el peso entre g y la aceleración, ab por g, así que las fuerzas y los desplazamientos no dependen de cuál se tome mientras sea la misma.
- **VS3-9, C > 1,8.** Con el periodo fundamental de una dirección mayor que TB, el art. 2.4 manda α = 2,5 también por encima de TB: se hace y se avisa (`sismo/meseta-larga`).
- **VS3-10, de paso:** las consultas por defecto de la CLI miraban los casos del fichero, no los del programa: con el viento de VS1, las combinaciones salían bien (las da `Consultas`), pero la selección por defecto no veía sus casos.

**Lo que decidí al hacerlo, para el usuario:**
- **VS3-a:** los casos del sismo son lógicos (no van al modelo analítico ni a los resultados) y sus nombres, `EX+e`, `EX-e`, `EY+e` y `EY-e`.
- **VS3-b:** con `ab`, son obligatorios `K`, `terreno` y `mu` (no hay valor por defecto que no sea una hipótesis de proyecto); por defecto, importancia normal, Ω = 5 % y e = 1/20.
- **VS3-c:** la regla del 10 %, par a par y respecto al periodo mayor (VS3-2).
- **VS3-d:** la fuerza equivalente de cada planta, para el par de la excentricidad, es la diferencia de los cortantes combinados (puede salir negativa en plantas altas, como en Concreta).
- **VS3-e:** si el par no se puede escribir con los modos (un diafragma con masa y sin inercia de giro), es un error y no hay casos del sismo; con `"excentricidad": 0` se calcula sin ella.
- **VS3-f:** todos los modos, sin truncar (VS2-3). Con los de «el 90 % y T > TA» serían de 10 a 14 de los 21 de los edificios objetivo.
- **VS3-g:** la excentricidad, como torsor estático (VS-i), con lo medido arriba. Mover la masa son cuatro juegos de modos (cuatro veces los casos base); queda para decidir con VS5, cuando se vea qué hace el CYPECAD del usuario.

**Fuera de VS3:**
- la app (VS4): las fichas, el modo «Modal», los casos del sismo en los selectores (hoy la app los usa en las combinaciones por defecto, pero no los lista) y la sección del informe;
- el municipio: los datos de peligrosidad del IGN y su prueba contra el Anejo 1 (VS-l) van con la ficha de VS4; hasta entonces, `ab` y `K` se escriben;
- la componente vertical, el segundo orden (sólo el aviso con θ) y las plantas sin diafragma (VS6).
