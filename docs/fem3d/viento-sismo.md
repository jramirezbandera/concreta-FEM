# VS: viento y sismo generados desde la situación

> **Fecha:** 2026-11-06. **Estado:** propuesta, sin decidir (VS-a…VS-n en §8).
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

VS1 y VS2 son independientes y pueden ir a la vez.

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

## 8. Decisiones para el usuario

- **VS-a, la norma:** la NCSE-02 (propuesto), con el espectro en un módulo propio para poder añadir la NCSR-23 si se aprueba.
- **VS-b, el ancho del viento:** por planta, calculado del modelo, con la opción de escribirlo (propuesto); o un rectángulo para todo el edificio, como Concreta.
- **VS-c, dónde se aplica el viento:**
  - con diafragma, una puntual en el centro de la banda ±e (propuesto);
  - sin diafragma, una lineal por los bordes;
  - y 8 casos (4 direcciones × ±e, propuesto) o 4 sin excentricidad.
- **VS-d, las fracciones de masa por ψ:**
  - uso-A, 0,5; uso-B, C y D, 0,6, como dice 3.2;
  - **sin valor en la norma:** uso-E (vehículos ligeros, propuesto 0,6), uso-F (cubiertas transitables, propuesto 0,5 o la de su uso) y uso-G (cubiertas sólo de mantenimiento, propuesto 0);
  - nieve: 0 hasta 1 000 m y 0,5 por encima (propuesto: la de 3.2 es «más de 30 días al año»);
  - se pueden cambiar por caso.
- **VS-e, cómo se combinan los modos:**
  - en cada variable, como dice 3.6.2.4 y hacen los programas comerciales (propuesto);
  - o fuerzas de planta combinadas y aplicadas como un caso estático (más barato, como 3.6.2.5 y el 3.7.4; con la torsión ambigua).
- **VS-f, la regla:** SRSS con los modos a menos del 10 % sumados en valor absoluto, como la norma (propuesto por defecto), y la CQC como opción para comparar.
- **VS-g, el signo:** el del modo de más masa en la dirección, uno para todas las variables (propuesto); o el del modo que más aporta a cada variable.
- **VS-h, plantas sin diafragma con masa:** error hasta VS6 (propuesto).
- **VS-i, la excentricidad accidental:** como torsor estático ±F_k·L/20 (propuesto) o moviendo el CM y rehaciendo los modos. VS3 mide cuánto difieren en el edificio objetivo.
- **VS-j, el método simplificado:** sólo como comprobación de sensatez al lado del espectral (propuesto), no como método de cálculo. En un modelo 3D, su reparto por elementos con γₐ no tiene sentido.
- **VS-k, segundo orden:** sólo el aviso con θ (propuesto). Amplificar va en otra fase.
- **VS-l, los datos de peligrosidad:** hay tres opciones.
  - Copiar el JSON de Concreta. Es del IGN con CC BY 4.0: son datos, no código, y es una licencia nueva para la regla 6, que habría que admitir con su cita en `NOTICE`.
  - Sólo la lista del Anejo 1 del BOE: un texto legal, sin derechos de autor (art. 13 LPI), con ab y K de los municipios con ab ≥ 0,04 g.
  - Sólo ab y K a mano.

  Propuesto: el JSON de Concreta, si se admite la CC BY 4.0.
- **VS-m, el orden:** VS1 y VS2 a la vez, y luego VS3 y VS4 (propuesto). VS1 sola ya quita trabajo a mano.
- **VS-n, el viento en la vivienda:** la cubierta baja y la alta a cotas distintas ya se tratan con los anchos por planta (VS-b). Sin decidir: si la planta CUB-S (tipo `escalon`) recibe su banda o va con CUB.

## 9. Fuera de esta fase

- La componente vertical del sismo (NCSE-02 2.6, el 70 % del espectro horizontal, «cuando sea preciso»: voladizos y luces grandes), el estudio dinámico con acelerogramas (3.6.1) y la interacción suelo-estructura.
- Las reglas de diseño sismorresistente del capítulo 4 (armado por ductilidad), que son de los módulos de comprobación.
- γc = 1,3 y γs = 1,0 en la situación sísmica (RES-13), también de los módulos.
- Las presiones locales de viento por zonas y la nieve, que ya da Concreta para los elementos.
- La amplificación por segundo orden, P-Δ (S1: fuera del MVP).
