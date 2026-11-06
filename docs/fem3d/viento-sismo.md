# VS: viento y sismo generados desde la situación

> **Fecha:** 2026-11-06. **Estado:** decidido el 2026-11-06 (§8); VS1 (§10) y VS2 (§11), hechos; sigue VS3.
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
  - la aceleración del modo i es a = αᵢ·β·ηᵢⱼ·ac, con αᵢ = α(Tᵢ) si Tᵢ ≥ TA y 1 + 1,5·Tᵢ/TA si Tᵢ < TA;
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
  - αᵢ de 3.6.2.2, con la rama ascendente.

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
