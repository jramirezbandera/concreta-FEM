# CO — Comprobaciones y armado

Plan del 2026-11-15. El orden lo decidió el usuario el 2026-11-08: DN, luego LC y luego CO. Estado: **plan, con lo medido en los pilares del edificio objetivo (§3); CO-a…CO-l decididas por el usuario el 2026-11-15 como se recomendaban (§6).** **CO0 hecho el mismo día como la fase IG** (`imperfeccion.md`, en otra sesión; §4.5). No se ha copiado nada de Concreta: CO-a espera a que wh0am1 diga si se puede publicar aquí su código.

## 1. Qué se pide

- **Comprobar y armar** pilares, vigas, losas (flexión, cortante y punzonamiento) y zapatas con los esfuerzos de este motor.
- **Con los módulos de Concreta,** copiados a un commit fijo, citando el origen y sin importarlos (regla de independencia).
- **El extractor lee las combinaciones por `Consultas` y no da por hecha la superposición,** para no cerrar el paso al cálculo no lineal por combinación (despegue, barras sólo a tracción).
- **Lo ya fijado para la integración,** que el extractor tiene que cumplir:
  1. con el sismo del programa, las ternas pésimas de los pilares y el Wood–Armer pésimo de las franjas, sin recombinar nunca (VS-o, `viento-sismo.md` §9 y §13.4);
  2. los pares de signos pésimos de las vigas (cortante con torsión, flexión con cortante);
  3. β = 1 sobre los esfuerzos ya amplificados por γz (SO, `segundo-orden.md`), con la imperfección global hecha antes (SO-g);
  4. los esfuerzos de los dos extremos de cada tramo de pilar, en las caras (LV-d, RV-b);
  5. el Ecm del Código Estructural en vez del E de la EHE (CY1).

## 2. Cómo está hoy

### 2.1 En este repositorio

| Pieza | Lo que ya dan las consultas | Lo que falta |
|---|---|---|
| Pilares | `Consultas.pilar`: por tramo, los seis esfuerzos de la base y la cabeza del tramo flexible (en las caras), su longitud, su sección y su giro. `fem consultar pieza`: sólo cuatro extremos con concomitantes (N+, N−, My, Mz), pésimos con el sismo | Todas las combinaciones (§3); la tracción; el cortante |
| Vigas | `Consultas.vano`: por vano, My+, My−, Vz y T con sus seis esfuerzos (pésimos con el sismo), con los pares de la losa repartidos; `torsionEquilibrio` (C4-k) y `axilSinValor` | Las secciones de comprobación (caras de los apoyos, vano), los momentos de la ELS cuasipermanente en ellas y la flecha activa |
| Losas | Franjas: mx, my y mxy medios por estación y Wood–Armer por combinación (pésimo con el sismo); armadura base en kN·m/m y zonas de refuerzo (AB) | La armadura en barras (Ø y separación); el cortante de la franja (el corte lo calcula, pero no se guarda) |
| Punzonamiento | El enlace de la huella de cada pilar con la losa y lo que transmite (`FuerzasNodales`, cortes con `restricciones`) | Todo lo demás: VEd y los momentos que la losa pasa al pilar, la posición y el perímetro |
| Zapatas | `Consultas.reacciones` por objeto (cada nudo, una vez: A2-47) | La zapata como dato; las combinaciones GEO y ELU de cada pilar |
| Combinaciones | El generador, con ELU-PT, ELU-ACC, ELU-SIS, ELS-C, ELS-F, ELS-CP, GEO y GEO-SIS, ya amplificadas por γz (`Consultas.combinaciones`) | Los casos N de la imperfección global (el generador ya los admite: `tipo: "N"`, `derivadoDe`) |

El proyecto no tiene dónde guardar un armado en barras, ni los datos que sólo son de la comprobación: acero, recubrimientos, clase de exposición (`datos-obra.md` §3.7 los dejó para esta fase).

### 2.2 En Concreta (commit `6fdc7e7`, 2026-11-13)

| Módulo | Ficheros (líneas) | Entrada | Qué comprueba |
|---|---|---|---|
| Pilares | `rcColumns.ts` (1 542) | Un juego Nd ≥ 1 (compresión), \|MEdy\| (con h), \|MEdz\| (con b); L y β; el armado | Flexocompresión esviada (5.8.9) por compatibilidad de deformaciones, con excentricidad mínima, imperfección del pilar (Lk/400) y segundo orden local por curvatura nominal si λ > λlím; cuantías, separaciones y cercos. Rectangular y circular |
| Vigas | `rcBeams.ts` (770), `rcBeamsSection.ts` (446), `rcBeamsDetalle.ts` (282), `rcBeamMN.ts` (85) | Dos secciones, «vano» y «apoyo», cada una con \|Md\|, VEd, los momentos de ELS y su armado; rectangular | Flexión, cortante, fisuración, cuantías, separaciones, solapes; flecha por esbeltez o directa con fórmula de viga; M + N por fibras |
| Forjados | `rcSlabs.ts` (909), `rcTSection.ts` (96) | Un nervio en T o 1 m de maciza: Md de vano, de apoyo y VEd, con armado base y refuerzos | Flexión, cortante, fisuración, cuantías, anclajes |
| Punzonamiento | `punching.ts` (415), `punchingGeometria.ts` (88), `cruceta.ts` | VEd; posición interior, de borde o de esquina; β por posición (1,15 / 1,4 / 1,5) o dado a mano | vRd,c, vRd,max, vRd,cs con cercos, cuantía mínima |
| Zapatas | `isolatedFooting.ts` (1 364) | Un juego (N, Mx, My, H) y un γ global que saca el ELU del servicio o al revés; centrada, medianera o de esquina, con viga centradora analítica | Tensiones (trapecial, bitriangular), vuelco, deslizamiento, biela y tirante o flexión, cortante y punzonamiento |
| Comunes | `cuantiaMinima.ts`, `crackedDeflection.ts`, `types.ts`, `data/materials.ts`, `rebar.ts`, `factors.ts`, los tipos de `defaults.ts`, `units/format.ts`, `frame-core/sections.ts` | | |

Son unas 6 400 líneas de cálculo, con sus pruebas (`src/test/calc/*.test.ts`). Lo que importa para el plan:

- **Comprueban un armado dado; ninguno lo propone.** «Armar» es código nuevo (§4.4).
- **Un juego de esfuerzos por llamada,** en valor absoluto, sin M01/M02, sin torsión y sin el Mz de las vigas (H35).
- **El E.** `materials.ts` ya lleva el Ecm del Código Estructural (lo usa la fisuración). El de la EHE (8500·∛(fck + 8)) queda en `rcElasticModulusMPa` de `frame-core/sections.ts`, que usan la flecha directa de las vigas y `crackedDeflection`. El punto 5 de §1 se reduce a esa función.
- **γc = 1,5 y γs = 1,15 fijos** (`getConcrete`, `getFyd`, `factors.ts`), también en la situación sísmica.
- **Auditados en junio** (`AUDITORIA-MOTORES-FABLE.md`) y corregidos desde entonces: Kφ y λlím de los pilares, el cortante con cot θ = 2, β = 1,15 del pilar interior, el cortante de la zapata.
- **El precedente es `fem2d/checks.ts`:** recorre las combinaciones una a una, se queda con el peor aprovechamiento de cada fila y comprueba los pilares con β = 1 sobre esfuerzos amplificados. `fem2d` no se integra, pero su manera de llamar a los módulos es la que se propone aquí.
- **Concreta es un repositorio privado con licencia PolyForm Noncommercial, y éste es público.** Lo copiado hasta ahora (tema, tablas de norma, catálogo de perfiles) era poco; esto son sus motores de cálculo. Es la decisión CO-a.

## 3. Lo medido antes de empezar (`validacion/co/medir.ts`, `out_medir.txt`)

El edificio objetivo de losas de 7 plantas (80 pilares, 1 120 extremos de tramo), con viento y con el sismo del programa (ab = 0,16 g, μ = 2). Cada extremo se comprueba con `calcRCColumn` de Concreta, tal como está en su clon (importado por su ruta, sin copiarlo), y se arma con la primera disposición que cumple de una tabla de 16, de 4Ø12 a 16Ø25. Los esfuerzos se leen sólo por `Consultas`.

**Todas las combinaciones frente a los cuatro extremos de `fem consultar pieza`** (el ensayo de H31, ahora con esfuerzos reales):

| Combinaciones | Ternas por extremo | Los cuatro extremos no contienen la pésima | La subestiman más de un 5 % | Eligen un armado menor |
|---|---|---|---|---|
| ELU-PT (16) | 16 | 1 % | 0 % | 0 % |
| ELU-PT + ELU-SIS (80) | 144 | 64 % | 6 % (peor cociente, 0,745) | 8,1 % (η real hasta 1,53) |

- **Sin sismo, los cuatro extremos bastan** en este edificio. **Con sismo, no,** aunque las ternas ya lleven los signos pésimos: en uno de cada doce extremos sale un armado menor del necesario.
- **La tracción aparece:** con el sismo, 66 extremos tienen alguna terna con el pilar traccionado, y `calcRCColumn` no la admite (Nd ≥ 1).
- **413 de los 1 120 extremos no caben en la tabla con ese sismo:** los pilares del edificio objetivo no están dimensionados (A3-3). Los porcentajes de arriba son de los 707 que sí.

**El coste, como información:** 142 µs por llamada. Comprobar un armado dado con todas las combinaciones del edificio son 100 000 llamadas y 14 s (0,2 s por pilar); elegirlo de la tabla, del orden de un minuto. No cambia el modelo analítico, así que **en ecuaciones el coste de la fase es cero.**

## 4. Propuesta

### 4.1 Dónde vive y cómo se copia

- **`src/comprobaciones/`,** puro como el motor (sin React, DOM ni IO):
  - `concreta/`: las copias, con su manifiesto (commit, ruta de origen y sha256 de cada fichero) y sus pruebas;
  - `demandas/`: el extractor (§4.2);
  - `comprobar/`: un adaptador por módulo, que convierte demandas y armado en la entrada del módulo y se queda con el peor aprovechamiento de cada fila;
  - `armar/`: las tablas de armado y la propuesta (§4.4).
- **Las copias no se tocan a mano.** Las hace `scripts/copiar-concreta.ts` desde el clon, al commit fijado, y una prueba comprueba los sha256. Así, al integrarse, se borran y se apunta a los originales.
- **Lo que a un módulo le falta** va fuera, en el adaptador. Si no se puede, es un parche mínimo que aplica el script, listado en el manifiesto y pensado para subirlo a Concreta. Previstos:
  - `frame-core/sections.ts` no se copia: se sustituye por un fichero propio con `rcElasticModulusMPa` = el Ecm de `hormigon(fck)`;
  - γc y γs como entrada, sólo si se decide CO-e.

### 4.2 El contrato del extractor

1. **Sólo lee por `Consultas`.** Su unidad es la **demanda**: una sección de una pieza y una combinación, con sus juegos de seis esfuerzos (uno, o los pésimos si lleva el sismo). No ve nunca vectores por caso ni factores. `Consultas` gana los métodos que hagan falta (`demandasPilar`, `demandasVano`, `demandasPunzonamiento`, `demandasBase`); hoy los resuelven por superposición, y un cálculo no lineal por combinación cambiaría sólo eso. La prueba `src/pruebas/factores.test.ts`, que busca quien aplique un factor por su índice de caso, se extiende a `src/comprobaciones/`.
2. **Donde hay interacción, todas las combinaciones** (§3, H31): pilares, punzonamiento y zapatas. En las vigas y las franjas bastan los extremos de cada mecanismo, con sus concomitantes o sus pésimos.
3. **Con el sismo del programa, lo que ya dan las consultas** (`ternasPesimas`, `esfuerzosPesimosViga`, `woodArmerPesimo`). El extractor no recombina.
4. **Pilares con β = 1 y la longitud del tramo** (CO-g), sobre las combinaciones amplificadas. Si el segundo orden está desactivado y alguna hipótesis es traslacional (γz > 1,10), la comprobación del pilar no es válida y se dice; nunca sale como «cumple».
5. **Los dos extremos de cada tramo, en las caras,** cada uno con su N, su \|My\| y su \|Mz\|. El módulo suma a los dos la excentricidad de segundo orden local, que es del lado seguro frente al momento equivalente 0,6·M02 + 0,4·M01. Afinarlo queda fuera (§9).
6. **Unidades, signos y ejes, en un solo sitio y con pruebas:** m a mm; N > 0 es tracción aquí y Nd > 0 compresión allí; My va con el canto h y Mz con b (`fisico.ts`: h según z local); un pilar girado y uno con punto fijo, en las pruebas.
7. **La ELS, sin descomponer por casos:** el momento cuasipermanente de la sección se pasa entero (`loadType: "custom"` con ψ₂ = 0, como hace `fem2d`).
8. **La flecha, del modelo:** la de la ELS cuasipermanente del motor por el factor de `crackedDeflection`, sobre el mismo E del cálculo (por eso el Ecm de §4.1).
9. **Lo que no se puede comprobar se dice** con una fila «pendiente» y su motivo, y cuenta como no cumplido en el resumen: sección no rectangular, torsión de equilibrio sin módulo, viga con axil relevante, posición de punzonamiento fuera de las tres del módulo.

### 4.3 Por elemento

**Pilares (CO1).**
- Por tramo y extremo, todas las combinaciones de ELU-PT y ELU-SIS; `calcRCColumn` con β = 1; el peor aprovechamiento de cada fila con su combinación.
- La tracción con flexión, con los primitivos de fibras del propio módulo (`calcNM`), como hace `fem2d` en las vigas.
- El cortante, con `calcRcShear` y la compresión concomitante.
- Un armado por tramo. Agrupar pilares y pasar esperas entre tramos queda fuera.

**Vigas (CO2).**
- Por vano, tres secciones: la cara de cada apoyo y el vano. En cada una, My+ y My− (el sismo puede invertir el momento en el apoyo), Vz con sus concomitantes y el momento cuasipermanente.
- Rectangulares de hormigón. El axil no entra (con diafragma rígido no tiene valor, `axilSinValor`).
- Torsión (CO-h): la de compatibilidad no se comprueba y se da su valor; la de equilibrio (`torsionEquilibrio`) no tiene módulo en Concreta.
- Flecha: activa y total, de la deformada del modelo (§4.2, punto 8).

**Losas, flexión y cortante (CO3).**
- La armadura base pasa a barras (Ø y separación por cara y dirección; por nervio en un reticular) y su momento resistente lo da `rcSlabs`. Con él, las zonas de refuerzo de AB siguen igual, y cada zona recibe su refuerzo en barras.
- Cuantías, separaciones y fisuración, con el Wood–Armer de la ELS cuasipermanente.
- Cortante: el Vz de los cortes de las franjas en las caras (hay que guardarlo y validarlo), contra VRd,c por metro o por nervio; en un reticular, también en el borde del ábaco.
- Vale igual para la losa de cimentación.

**Punzonamiento (CO4).**
- VEd y los momentos que la losa pasa al pilar salen del enlace de su huella, por combinación (CO-i), y β, de la fórmula general (CE A19 §6.4.3), con `betaMode: "custom"`. Manda el mayor β·VEd, no β máximo por VEd máximo.
- La posición (interior, borde, esquina) sale de la geometría. El módulo sólo conoce esas tres con el pilar enrasado: un hueco cerca o un pilar retranqueado quedan «pendiente» hasta medir cuántos son.
- En un reticular, el perímetro dentro del ábaco y el cortante de los nervios a su salida.
- En la losa de cimentación, con la reacción del terreno.

**Zapatas (CO5).**
- La zapata es un dato del proyecto fuera del modelo (CO-j): el cálculo sigue con la base empotrada.
- Por pilar, las reacciones de cada combinación GEO (tensiones, vuelco, deslizamiento) y ELU (armado), llevadas a la base de la zapata. Dos llamadas al módulo por combinación, cada una con sus filas; cuáles dependen de qué juego se fija con un caso a mano al empezar el tramo.
- Centrada, medianera y de esquina, con la viga centradora analítica del módulo.

### 4.4 El armado: dónde se guarda y cómo se propone

- **En `armado` del `proyecto.json`,** fuera de la huella, como la armadura base de AB: cambiarlo no recalcula. Por pilar y tramo, por viga y vano, por losa (base y refuerzos) y por zapata. Los datos comunes (acero, recubrimientos, clase de exposición, φef), en `obra`.
- **Proponer es elegir de una tabla:** disposiciones ordenadas por cuantía, y la primera con la que el módulo da todo por cumplido con todas las demandas. El juez es el módulo, no una fórmula aparte. Determinista, y el ingeniero lo cambia y vuelve a comprobar al momento.
- **Las tablas,** propias y editables más adelante; al principio, una por tipo de pieza.

### 4.5 CO0, la imperfección global (SO-g): hecha como la fase IG

Hecha el 2026-11-15 en otra sesión (`imperfeccion.md`, compilador IG1), con otro diseño que el que se proponía aquí: en vez de una puntual por planta, un **caso derivado en el motor** que pone en cada nudo θ·P de las fuerzas nodales equivalentes de su caso de origen (H_i = θ·(N_b − N_a) nudo a nudo, un lado derecho más). θ = θ₀·α_h·α_m; de cada caso G, Q o S salen `IMP-X(<caso>)` e `IMP-Y(<caso>)`; activada por defecto (CO-f), con `acciones.imperfeccion`; las nocionales llevan su γz. Para CO1 no hace falta nada más: llegan al extractor como un caso más de las combinaciones. Sus decisiones IG-a…IG-h están por confirmar.

### 4.6 CLI, app e informe

- `fem comprobar <proyecto> [pieza]` y `fem armar <proyecto> [--escribir]` (sólo propone, como `fem alinear`), también en el MCP.
- En la app, Resultados · Comprobación: por tipo de pieza, una tabla con el aprovechamiento, la fila que manda y su combinación, y la ficha de la pieza con las filas del módulo. Proponer, editar y comprobar, sin recalcular.
- El informe de `fem revisar`, con una sección de comprobaciones.
- Sin planos de armado ni PDF por pieza (A6, §9).

## 5. Coste

- **Ecuaciones:** CO0 no cambia el modelo (son lados de más); lo demás no toca el cálculo.
- **Memoria:** los casos N de CO0 (§4.5).
- **Tiempo, como información:** §3. Las comprobaciones van en el worker, por pieza y con avance. Un núcleo rápido de `rcColumns` sin filas ni textos (H36) sólo si el minuto de armar el edificio objetivo molesta.

## 6. Decisiones del usuario

**Decididas el 2026-11-15, todas como se recomendaban** («vale, me parece bien»). CO-a queda así: no se copia nada hasta que wh0am1 diga si su código se puede publicar en este repositorio; mientras, se hace lo que no depende de las copias (las demandas en `Consultas`, el armado en el proyecto y los adaptadores contra el clon por su ruta, como `validacion/co/medir.ts`).

Lo que se proponía:

- **CO-a, publicar el código de Concreta.** Concreta es privado (PolyForm Noncommercial) y este repositorio es público, y además despliega la app en GitHub Pages. Copiar aquí sus motores los publica. Recomendado: **confirmarlo con wh0am1 antes de copiar nada.** Si es que sí, se copian con su licencia en `NOTICE` y la regla de oro 6 lo admite expresamente. Si es que no, las copias no se versionan (las trae el script del clon, con el manifiesto de sha256 sí versionado, como las muestras de DWG) y ni el CI ni Pages llevan las comprobaciones; o este repositorio pasa a privado. CO0 y el extractor no dependen de esto.
- **CO-b, el alcance.** Recomendado: **hormigón** (pilares, vigas rectangulares, losas macizas y reticulares, losa de cimentación, punzonamiento y zapatas aisladas). Fuera, para después: acero (pilares, vigas y barras; Concreta tiene `steelBeams` y `steelColumns`), muros y pantallas (Concreta no tiene módulo), viguetas del unidireccional, encepados y zapatas combinadas o corridas.
- **CO-c, comprobar y proponer.** Recomendado: **las dos cosas en cada tramo,** primero comprobar un armado dado y luego proponerlo de una tabla. La alternativa es una primera pasada sólo de comprobación.
- **CO-d, las copias, sin tocar.** Recomendado: **por script, con manifiesto y parches mínimos listados** (§4.1), al commit `6fdc7e7`. La alternativa, adaptarlas libremente aquí, complica la integración.
- **CO-e, γc y γs en la situación sísmica.** Recomendado: **1,5 y 1,15 en todas las situaciones al principio** (del lado seguro y sin parche). Los de la situación accidental (RES-13: 1,3 y 1,0), más adelante, como parche para subir a Concreta.
- **CO-f, la imperfección global.** Recomendado: **como casos N del programa, activada por defecto** (§4.5), antes de CO1, como pidió SO-g.
- **CO-g, la longitud del pilar.** Recomendado: **la libre entre caras con β = 1** (la altura libre entre coacciones, que es donde están los esfuerzos). La alternativa, de cota a cota, es del lado seguro: un 10 % más de longitud y un 20 % más de excentricidad de segundo orden local.
- **CO-h, la torsión de las vigas.** Recomendado: la de compatibilidad (con la rigidez ×0,1 de D4), **sin comprobar, con su valor y la condición de armadura mínima** (CE A19 §6.3.1(2)); la de equilibrio, **con una comprobación propia** (CE A19 §6.3, código nuevo con su oráculo a mano) al final de CO2. Hasta entonces, «pendiente».
- **CO-i, el punzonamiento.** Recomendado: **VEd y los momentos, de lo que la losa transmite al pilar por su huella,** y β general por combinación. La alternativa (la diferencia de axiles del pilar con β por posición) cuenta como punzonamiento lo que llega por las vigas. Se miden las dos en los ejemplos.
- **CO-j, las zapatas.** Recomendado: **como datos fuera del modelo** (`zapatas`, con el terreno en `obra`), el cálculo con la base empotrada, y las tres posiciones del módulo con su viga centradora analítica. Proponer dimensiones (B, L, h) por la tensión admisible.
- **CO-k, la flecha.** Recomendado: **la de las vigas, del modelo por el factor de sección fisurada;** la de las losas fisuradas, fuera de esta fase (hoy se da la elástica).
- **CO-l, la sombra.** Armado contra armado con CYPECAD en el ejemplo 11 y la vivienda. **Hace falta del usuario:** los listados de armado de pilares, vigas, losas, punzonamiento y zapatas de esos modelos (el ejemplo 11, con zapatas).

## 7. Criterios y oráculos

| Tramo | Criterios |
|---|---|
| **CO0** | 1. en un edificio de cortante, las fuerzas y los esfuerzos de la imperfección a 1e-10 de la fórmula a mano; 2. equilibrio a 1e-9; 3. sin `imperfeccion`, los mismos bits; 4. el coste en memoria, medido |
| **Copias** | 5. los sha256 del manifiesto; 6. las pruebas de Concreta de cada módulo pasan aquí sin cambios |
| **Extractor** | 7. el aprovechamiento de cada fila es el máximo de llamar al módulo con entradas escritas a mano, combinación a combinación (identidad); 8. metamórficas: girar el edificio 90° da lo mismo, y un pilar girado cambia My por Mz; 9. con el sismo nunca sale menos que sin él; 10. nadie aplica factores fuera de `Consultas` |
| **Módulos** | 11. un oráculo que no es de Concreta por módulo: un integrador independiente de la sección (Python) para la flexocompresión y la flexión; ejemplos publicados del EC2 para cortante y punzonamiento; un caso a mano de zapata por tipo de distribución |
| **Armar** | 12. el armado propuesto cumple todo y el anterior de la tabla no; 13. determinista y sin cambiar la huella |
| **Todo** | 14. referencia congelada de las comprobaciones de tres modelos; 15. en la app, lo de Node (banco de Chrome) |
| **Sombra** | 16. cuantías frente a CYPECAD, con el criterio que se fije al ver sus listados |

## 8. Tramos

| Tramo | Qué | Depende de |
|---|---|---|
| **CO0** | La imperfección global (**hecha como IG**, §4.5) | CO-f |
| **CO1** | Las demandas en `Consultas`, el armado en el proyecto, las copias, y los pilares: comprobar y proponer; `fem comprobar` | CO0; CO-a, CO-d, CO-g |
| **CO2** | Vigas: flexión, cortante, fisuración, flecha y torsión | CO1; CO-h, CO-k |
| **CO3** | Losas: armadura en barras, flexión y cortante por franjas | CO1 |
| **CO4** | Punzonamiento | CO3; CO-i |
| **CO5** | Zapatas | CO1; CO-j |
| **CO6** | La app, el informe y la skill | CO1–CO5 |
| **CO7** | La sombra con CYPECAD | CO-l |

Lo propio de CO0 y de CO1 (demandas, datos del armado) no necesita las copias y puede empezar sin CO-a.

### 8.1 CO1, lo hecho sin las copias (2026-11-15)

- **`src/comprobaciones/demandas/pilares.ts`** (`demandasPilar`): por tramo y extremo del tramo flexible, una demanda por combinación de ELU-PT, ELU-ACC y ELU-SIS (las del generador, amplificadas por γz, con la imperfección de IG como un caso más) o, con el sismo, las ternas de sus signos pésimos; la sección, el material, el giro, la longitud de cota a cota y la libre entre caras (CO-g); y `betaUno`, falso con el aviso `comprobacion/beta-no-vale` si el segundo orden está desactivado y la estructura es traslacional. Sólo usa la API de `Consultas`, sin tocar `consultas.ts`.
- **`src/comprobaciones/comprobar/entradaPilar.ts`** (`entradaPilar`): de una demanda a los campos de `RCColumnInputs` (mm, Nd > 0 comprime, MEdy = \|My\| con el canto h, MEdz = \|Mz\|, β = 1 con la longitud libre); la tracción (N > −1 kN) y lo que no es hormigón rectangular o circular, aparte.
- **Pruebas** (`pilares.test.ts`, en el edificio de SO): cada demanda es la superposición escrita aparte; con el sismo, las de `ternasPesimas`, nunca con menos momento que el signo dominante; con los pilares girados 90°, My pasa a Mz y MEdy a MEdz; la longitud libre, 3 − 0,5 m (RV-b); `betaUno` con el segundo orden desactivado, traslacional o no. La prueba de los factores (`src/pruebas/factores.test.ts`) ya vigila `src/comprobaciones/`.
- **Falta de CO1:** el armado en el proyecto, el adaptador que llama al módulo (con las copias o, mientras CO-a no se decida, contra el clon por su ruta en `validacion/`), la flexotracción, el cortante, la propuesta de una tabla y `fem comprobar`.

## 9. Fuera de esta fase

- Lo de CO-b: acero, muros, viguetas, encepados y zapatas combinadas.
- Las reglas de armado sismorresistente del capítulo 4 de la NCSE-02 (ductilidad).
- M01/M02 en los pilares (el momento equivalente y C = 1,7 − rm), agrupar pilares, las esperas y los anclajes entre piezas.
- El escalón de un desnivel como comprobación de armado (DN-g).
- La comprobación geotécnica completa de la losa de cimentación (LC-f).
- Los planos de armado y su DXF (A6), y los PDF de cada pieza que hace Concreta.
- La resistencia al fuego.

## 10. Riesgos

- **CO-a** puede cambiar dónde vive todo lo que usa las copias.
- **Los módulos son de pieza aislada.** Cada adaptador tiene que decir qué deja fuera, y lo que no encaja sale «pendiente», no «cumple».
- **El punzonamiento es lo menos preparado:** el módulo sólo conoce tres posiciones y un β. Si la medida de CO4 da muchos pilares fuera, hará falta geometría propia del perímetro.
- **Las tablas de armado deciden lo que sale.** Sin las del usuario o las de CYPECAD, la sombra comparará tablas y no cálculo.
- **El tiempo con el sismo:** nueve veces más ternas por extremo (§3).
