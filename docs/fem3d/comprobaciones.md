# CO — Comprobaciones y armado

Plan del 2026-11-15. El orden lo decidió el usuario el 2026-11-08: DN, luego LC y luego CO. Estado: **plan, con lo medido en los pilares del edificio objetivo (§3); CO-a…CO-l decididas por el usuario el 2026-11-15 como se recomendaban (§6).** **CO0 hecho el mismo día como la fase IG** (`imperfeccion.md`, en otra sesión; §4.5). **CO-a, resuelta el 2026-11-21:** Carlos Aguilar ha dado permiso para publicar aquí el código de Concreta (lo comunica el usuario), y el módulo de pilares ya está copiado (§8.2). **CO1 hecho el mismo día** (§8.3): comprobar y proponer el armado de los pilares, `fem comprobar` y `fem armar`; falta su parte de la app (CO6) y la sombra (CO7). **CO2 hecho el mismo día** (§8.5): comprobar y proponer el armado de las vigas (flexión, cortante, fisuración, flecha y torsión), en las mismas órdenes; sus decisiones CO2-a…CO2-h, por confirmar.

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

**CO-a, resuelta el 2026-11-21.** Carlos Aguilar ha dado permiso (lo comunica el usuario) para publicar en este repositorio los módulos de Concreta. Las copias van en `src/comprobaciones/concreta/`, con la licencia de Concreta (PolyForm Noncommercial 1.0.0) y su «Required Notice» en el manifiesto, en su `LEEME.md` y en `NOTICE`; la regla de oro 6 del `CLAUDE.md` lo admite sólo para esas copias. El resto del repositorio sigue como estaba.

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

### 8.2 CO1, las copias y comprobar un pilar (2026-11-21)

- **`scripts/copiar-concreta.ts`** (`bun run concreta:copiar`, `concreta:verificar`): lee de los objetos de git del clon, en el commit fijado `6fdc7e7`, las entradas de cada tramo y todo lo que importan con rutas relativas, y lo deja en `src/comprobaciones/concreta/` con la estructura de carpetas de Concreta, byte a byte. Escribe `manifiesto.json` (origen, destino y sha256 de cada fichero; los parches, listados: ninguno todavía) y borra lo que sobre. No depende de en qué rama esté el clon.
- **Copiado, para los pilares:** `rcColumns.ts` y lo que importa (`calculations/types.ts`, `data/defaults.ts`, `materials.ts`, `rebar.ts`, `anchorBars.ts`, `micropileLookups.ts` y `lib/units/`), con sus dos ficheros de pruebas: 13 ficheros.
- **Criterios 5 y 6:** `src/comprobaciones/copias.test.ts` comprueba los sha256 y que no sobre ni falte nada; las 150 pruebas de Concreta del módulo pasan aquí sin cambios.
- **`src/comprobaciones/comprobar/pilares.ts`** (`comprobarTramo`, `comprobarPilar`, `ArmadoPilar`): con un armado dado, llama a `calcRCColumn` demanda a demanda y guarda de cada fila la peor, con su combinación y su extremo. El veredicto de una fila es su `status`: el módulo da NaN a las informativas (las condiciones 5.38) y NaN o infinito a las que fallan sin cociente. Lo que no se comprueba va a `pendientes` y el tramo no cumple: la tracción, lo que no es hormigón rectangular o circular, una entrada que el módulo rechaza, β = 1 sin el segundo orden y un tramo sin demandas.
- **Pruebas** (`comprobar/pilares.test.ts`, criterios 7 a 9): cada fila es el máximo de llamar al módulo con las entradas escritas a mano; con los pilares girados 90° y las caras del armado cambiadas, lo de `nm-y` pasa a `nm-z`; con el sismo, ninguna fila baja.
- **Lo que faltaba de CO1,** en §8.3.

### 8.3 CO1, el resto: cortante, flexotracción, proponer, el proyecto y la CLI (2026-11-21)

**Las copias, con dos cosas que no son «tal cual»** (las dos, en `manifiesto.json`):

- **CO1-1, las importaciones con su extensión.** Concreta importa sin extensión (`'./types'`) y Node, que es el que usan las pruebas de la CLI y la extensión de Claude Desktop, la exige. El script añade `.ts` a las importaciones relativas; es lo único que cambia en una copia. El manifiesto guarda el sha256 del fichero de Concreta (`sha256Origen`), y `verificar` y `copias.test.ts` comprueban que quitando esas extensiones sale ese original.
- **La sustitución prevista en §4.1:** `lib/frame-core/sections.ts` no se copia; en su sitio va un fichero propio con `rcElasticModulusMPa` = el Ecm de `hormigon(fck)` (CY-a). Con él pasan sin cambios las pruebas de Concreta de vigas y de flecha fisurada, que componen sus esperados con esa función.
- **Copiado además el módulo de vigas** (`rcBeams.ts`, `rcBeamMN.ts`, `rcBeamsDetalle.ts` y lo que importan, con sus pruebas): `calcRcShear` vive en él y lo necesita el cortante de los pilares. Son ya las copias de CO2. En total, 26 ficheros y 351 pruebas de Concreta que pasan aquí.

**Comprobar** (`comprobar/pilares.ts`):

- **Cortante, sólo en rectangular:** como lo hace Concreta en sus pórticos (`fem2d/checks.ts`). En cada dirección, `calcRcShear` con la cara traccionada de esa flexión, las dos ramas del cerco y σcp con su signo, del axil de la misma demanda; VRd = máx(VRd,c; mín(VRd,s; VRd,máx)) (§6.2.1(4)). Filas `cortante-z`, `biela-z`, `cortante-y`, `biela-y` y, con cortante en las dos direcciones, `cortante-esviado`: la suma de los dos aprovechamientos (**CO1-a, confirmada por el usuario el 2026-11-21:** del lado seguro; el CE no da interacción para el cortante esviado de un pilar rectangular; medida en §8.4).
- **Cortante de un pilar circular** (CO1-b, desde §8.4): por el cuadrado inscrito, provisional y del lado seguro. Antes, pendiente: ningún pilar circular salía como «cumple».
- **Flexotracción** (y la compresión de menos de 1 kN, que el módulo rechaza): la demanda de primer orden, sin excentricidad mínima ni pandeo, contra la envolvente N–M del armado que da el propio módulo (`buildColumnInteraction`), en su rama de tracción. Entre dos puntos de la envolvente se interpola en línea recta (queda por dentro). En rectangular, los dos planos se suman (**CO1-c:** el exponente 1 de 5.8.9 con poco axil). Filas `traccion` (N ≤ As·fyd) y `flexotraccion`. Un pilar que sólo tracciona lleva además las reglas de armado del módulo, de una llamada con la compresión mínima. En circular, la envolvente es la de la orientación del anillo más desfavorable con 1 kN de compresión, no con el axil de tracción (CO1-2; con 6 barras o más la diferencia entre orientaciones es pequeña).
- **CO1-3, el veredicto es el `status` de la fila.** El módulo da NaN a sus filas informativas (las condiciones 5.38) y NaN o infinito a las que fallan sin cociente (la sección aplastada).

**El armado como dato** (`armado.ts`, `agente/armaduraBase.ts`, `agente/obra.ts`):

- `armado.pilares.<pilar>.<planta de la cabeza del tramo>` = `{ esquinas, caraB, caraH, anillo, cercos }`, en mm; fuera de la huella. Sigue a sus pilares y a sus plantas al renombrarlos, borrarlos o renumerarlos, y se valida (`armado/pilar`, `armado/planta`, `armado/barras`).
- `obra.armado` = `{ fyk, recubrimiento, phiEf }`, por defecto 500 MPa, 30 mm hasta el cerco y 2 (**CO1-d, confirmada por el usuario el 2026-11-21** como valor por defecto, con el aviso de §8.4: el recubrimiento depende de la clase de exposición, que no se pregunta todavía).

**Proponer** (`armar/pilares.ts`):

- **La tabla (CO1-e, confirmada por el usuario el 2026-11-21, con las reglas de obra de §8.4):** esquinas e intermedias del mismo diámetro (12, 16, 20 o 25), de 0 a 3 intermedias por cara en cada dirección (64 armados; en circular, de 6 a 16 barras), de menos a más acero. Cercos Ø6 (Ø8 con barras de 25) a 0,6·mín(15·Ø, lado menor, 300 mm), al centímetro por abajo, en todo el tramo: cumple también la zona densificada junto a los nudos. Si sólo falla el cortante, se prueban cercos más gruesos y más juntos antes de pasar a más barras.
- El primero sin ninguna fila que falle, con todas las demandas del tramo. Para ir rápido, cada armado se prueba primero con la demanda que tumbó al anterior, y la comprobación se corta en la primera fila que falla; el elegido se comprueba entero.
- Tramo a tramo y pilar a pilar; desde §8.4, con las reglas de obra (continuidad en altura y agrupar) detrás.

**CLI y MCP:** `fem comprobar <proyecto> [pilar…]` y `fem armar <proyecto> [pilar…] [--escribir]` (`src/comprobaciones/pilares.ts`), también como herramientas del servidor MCP, y su apartado en la skill.

**Criterios:**

| Criterio | Resultado |
|---|---|
| 5. sha256 del manifiesto | Pasa (`copias.test.ts`) |
| 6. las pruebas de Concreta, sin cambios | Pasa: 351 pruebas de los módulos de pilares y vigas |
| 7. identidad con las llamadas a mano | Pasa (`comprobar/pilares.test.ts`); el cortante, con las fórmulas del CE escritas aparte, a 1e-9 |
| 8. girar 90° | Pasa para el pilar girado con el armado de las caras cambiado; girar el edificio entero, sin probar |
| 9. con el sismo, nunca menos | Pasa |
| 10. nadie aplica factores | Pasa (`src/pruebas/factores.test.ts`) |
| 11. oráculo que no es de Concreta | Pasa: `validacion/co/oraculo_seccion.py` (Python sin dependencias, Simpson, áreas y fcd sin redondear) en 7 secciones. El MRd del módulo, a ≤ 0,61 % en rectangular y ≤ 0,37 % en circular; NRd,máx, a ≤ 0,18 %; la flexotracción con el MRd del oráculo da entre 0,99 y 1,04. Limitar el acero al 1 % (pivote A) no cambia el MRd en más de un 1 % |
| 12. el propuesto cumple y el anterior no | Pasa (`armar/pilares.test.ts`) |
| 13. determinista y sin cambiar la huella | Pasa |
| 14. referencia congelada | Pasa: `congelado-co1.test.ts`, tres modelos (pórticos con viento, pórticos cargados con sismo y la vivienda) |
| 15. en la app, lo de Node | Sin hacer: es de CO6 |

**Medido en la vivienda:** 36 tramos de 23 pilares, 32 combinaciones; `fem armar` tarda 0,3 s (2 255 llamadas al módulo) y propone 4Ø12 con cØ6/100 en 32 tramos y 6Ø12 en 4. No se ha comparado todavía con el armado de CYPECAD (CO7).

**Pendiente de CO1:** medir `fem armar` en el edificio objetivo con sismo; el cortante del pilar circular (CO1-b); la clase de exposición (CO1-d); el giro del edificio entero (criterio 8). Los tres primeros, en §8.4.

### 8.4 CO1-a, b, d y e, decididas (2026-11-21)

El usuario aceptó las recomendaciones de Claude: CO1-a y CO1-d como estaban, con su medida y su aviso; CO1-b por una sección provisional del lado seguro; CO1-e con dos reglas de obra.

- **CO1-b, el cortante del pilar circular** (`filasCortanteCircular`, `comprobar/pilares.ts`): provisional, hasta que el usuario dé la sección equivalente definitiva. La sección es isótropa, así que se comprueba el cortante resultante (filas `cortante` y `biela`, sin suma de direcciones), en el cuadrado inscrito (lado D/√2) y con todo lo que da menos capacidad: d desde la cara del cuadrado, la cuarta parte de las barras del anillo a tracción, las dos ramas del cerco por π/4 y σcp con el área del círculo si comprime y la del cuadrado si tracciona. Prueba: las fórmulas del CE escritas aparte a 1e-9, y siempre por debajo del cuadrado circunscrito con su armado. Los pilares circulares ya pueden cumplir y recibir propuesta.
- **CO1-d, el aviso `comprobacion/recubrimiento-por-defecto`** de `fem comprobar` y `fem armar` cuando `obra.armado.recubrimiento` no está escrito. La skill pide preguntarlo al ingeniero.
- **CO1-e, las reglas de obra** (`reglasObra` en `pilares.ts`, `subirTramo` y `domina` en `armar/pilares.ts`), sólo en lo propuesto y por defecto (`reglasObra: false`, lo de antes): un armado «domina» a otro si es de la misma forma y no tiene menos barras, ni de menor diámetro, ni cercos más finos o más separados.
  - **continuidad en altura:** un tramo domina al de encima (el del mismo pilar que arranca de su cabeza);
  - **agrupar:** en cada planta y sección, lo propuesto con ≥ 80 % del área del mayor (`AGRUPAR_AREA`) y que él cubre en barras y diámetro lleva el suyo.

  Se repiten hasta que nada cambia. Sólo suben, y cada armado subido se comprueba entero (el primero de la tabla que domina a los dos y cumple, con los cercos más fuertes de los dos). Cada tramo subido lleva `ajuste` (`continuidad` o `agrupado`). Prueba: `armar/reglasObra.test.ts`.
- **La referencia congelada,** regenerada a sabiendas (`validacion/co/out_cambiosObra.txt`): los pórticos con viento no cambian; los cargados con sismo, 4 de 27 tramos agrupados (+6,5 % de acero); la vivienda, 2 de 36 por continuidad (+2,6 %).

**Medido en el edificio objetivo de losas de 7 plantas, con viento y sismo** (`validacion/co/esviado.ts`, `out_esviado.txt`):

- **`fem armar`:** 560 tramos en 38 s sin las reglas de obra (79 756 llamadas al módulo) y 48 s con ellas (142 tramos subidos). 302 tramos no tienen propuesta: la sección no basta con ningún armado de la tabla, porque sus pilares no están dimensionados para el sismo (como ya decía el axil reducido de A3-3).
- **CO1-a:** de los 258 tramos con propuesta, todos tienen cortante en las dos direcciones a la vez. La suma sube las barras en 5 y los cercos en 58 (sobre todo de Ø6 a Ø8, o la separación de 180 a 100): un 24 % de los tramos. Frente al peor de los dos, la suma pesa en el armado transversal y casi nada en el longitudinal. **Decidido por el usuario el 2026-11-21, con esta medida:** la suma se queda.

### 8.5 CO2, las vigas (2026-11-21)

Hecho en otra sesión que la de §8.4, a la vez. Pasan los criterios 5 a 14 en lo de las vigas; falta su parte de la app (CO6) y la sombra (CO7). Las decisiones CO2-a…CO2-h, de Claude, **por confirmar por el usuario** (abajo).

**Las demandas** (`demandas/vigas.ts`, `demandasViga`):

- **`Consultas.vanoZonas(id, i, factores, fracciones)`,** lo único que cambia en `consultas.ts`: los extremos de `vano` (My, Vz y T, con sus esfuerzos partidos) en cada zona de un vano partido por unas fracciones de su longitud. `vano` es ahora `vanoZonas` sin partir, con el diagrama de la combinación hecho una vez por tramo (antes, una por tramo y otra por cada extremo): los mismos bits.
- **Tres zonas por vano (CO2-a):** el cuarto de la luz junto a cada apoyo (`inicio` y `fin`, en el sentido de la viga) y el `centro`. De cada una, en ELU, el mayor My (tracciona abajo), el menor (arriba), el mayor |Vz| y el mayor |T|, con su combinación, su estación y sus seis esfuerzos (los concomitantes o, con el sismo, los de `esfuerzosPesimosViga`); y en la ELS cuasipermanente, el mayor y el menor My.
- **La flecha elástica relativa** del vano en 21 muestras, en cada combinación de la ELS cuasipermanente y de la característica y con el caso del peso propio solo (si no lleva cargas del usuario): respecto a la cuerda entre las caras o, en un voladizo, respecto a su apoyo, con el doble del vuelo como luz (DB SE 4.3.3.1(4)). Con ella, el mayor |My| del vano en cada combinación, que es lo que fisura la sección.
- En una viga basta la envolvente de cada mecanismo (§4.2, punto 2): no se guardan todas las combinaciones.

**Comprobar** (`comprobar/vigas.ts`, `comprobarVano`): una llamada a `calcRCBeam` por zona, con su sección «vano» (tracción abajo: la armadura inferior con el mayor My de la zona) y su sección «apoyo» (tracción arriba: la superior de esa zona con el menor My). El momento cuasipermanente va entero (`loadType: "custom"`, ψ₂ = 0) y la flecha del módulo no se pide (L = 0).

- **Filas `<zona>/inf-…` y `<zona>/sup-…`** (flexión, cuantía mínima, separación de barras, fisuración): sólo si esa cara tracciona en alguna combinación (CO2-g); si no, sólo que sus barras quepan.
- **Filas `<zona>/shear`, `shear-max`, `rho-w-min`, `stirrup-…`:** de la sección cuya cara tracciona donde el cortante es mayor (fija el canto útil).
- **`<zona>/as-max`,** una vez por zona.
- **Cada fila lleva `grupo`:** la armadura que hay que aumentar si falla (`inferior`, `superior`, `superiorInicio`, `superiorFin`, `cercos`, `cercosInicio`, `cercosFin`, `piel`) o `seccion` si no hay armado que la arregle (la biela, la cuantía máxima).
- **La flecha (CO-k, CO2-c),** del vano entero: `flecha-total` = k_dif·δ_cp ≤ L/300 y `flecha-activa` = k_dif·δ_cp + k_inst·(δ_c − δ_cp) − k_pp·δ_pp ≤ L/400 (`obra.armado.flechaActiva`: 300, 400 o 500). Los factores son los de `crackedDeflectionFactor` del módulo: k_dif, con la fluencia φef y el mayor momento cuasipermanente; k_inst, sin fluencia y con el mayor característico; k_pp, sin fluencia y con el del peso propio (lo que ya se había deformado al levantar la tabiquería: sólo su flecha instantánea). La armadura, la inferior o, en un voladizo, la superior de su apoyo.
- **La torsión (CO-h),** en `comprobar/torsion.ts`, código propio (Concreta no tiene módulo): sección hueca eficaz del CE A19 §6.3.2 con cot θ = 2. La de equilibrio (`torsionEquilibrio`, C4-k) da cinco filas por zona: `torsion-biela` (TEd/TRd,máx + VEd/VRd,máx ≤ 1), `torsion-cercos` (por rama exterior, lo del cortante más lo del torsor), `torsion-longitudinal` (CO2-f), `torsion-separacion` (u/8) y `torsion-barras` (350 mm en el perímetro: pide barras de `piel` desde unos 45 cm de canto). Se evalúan en el extremo del torsor y en el del cortante, cada uno con lo que le acompaña. La de compatibilidad no se comprueba: una fila informativa `torsion-compatibilidad` con su valor y la condición (6.31), desde el 5 % del torsor de fisuración.
- **La flexión con tracción** (el axil de la viga tiene valor y tracciona): fila `…-flexotraccion`, con el M–N del módulo (`beamMNCapacity`).
- **Un vano sin tramo flexible** (entero en las zonas rígidas de sus apoyos: dos pilares muy juntos) no se comprueba ni se lista, con el aviso `comprobacion/vano-rigido`.
- **Pendientes** (el vano no cumple): lo que no es hormigón rectangular; la compresión de más de 0,1·fcd·Ac y la flexión lateral (CO2-h); sin combinaciones de ELS, la fisuración y la flecha; una viga sin apoyos, su flecha; una entrada que el módulo rechaza.

**El armado como dato** (`armado.ts`, `agente/armaduraBase.ts`, `agente/obra.ts`):

- `armado.vigas.<viga>` = la lista de sus vanos, en su orden (`null`, el que no lo tiene). Cada vano: `inferior` y `superior` corridas, `superiorInicio` y `superiorFin` (el total de la cara superior en ese cuarto, no un refuerzo que se suma), `cercos` (con `ramas`), `cercosInicio`, `cercosFin` y `piel`. Fuera de la huella; sigue a sus vigas al renombrarlas, borrarlas o renumerarlas, y se valida (`armado/viga`, `armado/barras`; `armado/vano` si sobran vanos).
- **Una cara, un diámetro (CO2-b):** el módulo toma n barras de un diámetro por cara. Un montaje de 2Ø12 con un refuerzo de 2Ø16 no se puede escribir.
- `obra.armado` gana `exposicion` (`XC1`…`XC4`; por defecto `XC2`, wmáx = 0,3 mm; CO2-d) y `flechaActiva` (400). Mientras no estén escritos, `fem comprobar` y `fem armar` dan el aviso `comprobacion/vigas-por-defecto`, como el del recubrimiento de los pilares (CO1-d).

**Proponer** (`armar/vigas.ts`, `proponerVano`): cada armadura del vano tiene su tabla. Se empieza por la primera de cada una; la primera fila que falla dice qué armadura sube un puesto, hasta que no falla ninguna; al final se intenta bajar cada una un puesto. Lo propuesto cumple, y con cualquiera de sus armaduras un puesto más abajo, no.

- **Las tablas (CO2-e):** barras de una cara, de 2 a 12 del mismo diámetro (12, 16, 20 o 25) que quepan con 25 mm libres, de menos a más acero; cercos Ø6, Ø8 o Ø10 a 300…60 mm, primero los de 2 ramas y luego los de 3, 4 y 6 (las que caben a 60 mm); piel, de 0 a 5Ø12 por cara. Lo de los apoyos no baja de lo corrido.
- No iguala vanos ni vigas, ni da longitudes ni anclajes de los refuerzos (§9).

**CLI, MCP y skill:** `fem comprobar` y `fem armar` dan las dos listas (`pilares` y `vigas`), con `resumen.pilares` y `resumen.vigas` (antes, `resumen` era el de los pilares) y `sinListar` (antes `omitidos`, que chocaba con el de los diagnósticos); las piezas dadas pueden ser pilares o vigas, y `--tipo pilares|vigas` deja un tipo. `--escribir` guarda también `armado.vigas`. En el MCP, `piezas` (y `pilares`, el nombre de antes) y `tipo`.

**Criterios:**

| Criterio | Resultado |
|---|---|
| 6. las pruebas de Concreta, sin cambios | Pasa (las del módulo de vigas ya estaban copiadas en CO1) |
| 7. identidad con las llamadas a mano | Pasa (`comprobar/vigas.test.ts`): cada fila, la de `calcRCBeam` con la entrada escrita campo a campo; el cortante, además, con las fórmulas del CE escritas aparte, a 1e-9; la flecha, con `crackedDeflectionFactor` llamado a mano |
| 8. girar 90° | Pasa: el pórtico girado da las mismas filas a 1e-7 |
| 9. con el sismo, nunca menos | Pasa, en las demandas y en las filas |
| 10. nadie aplica factores | Pasa (`src/pruebas/factores.test.ts`) |
| 11. oráculo que no es de Concreta | Pasa: `validacion/co/oraculo_viga.py` en 6 secciones (MRd con el integrador de la sección, a ≤ 1 %; VRd,s y VRd,máx con las fórmulas del CE, a ≤ 0,3 %; wk, a ≤ 1,5 %). La torsión, contra un caso hecho a mano (`comprobar/torsion.test.ts`). La flecha elástica, contra la fórmula de la biapoyada con la deformación por cortante, a 1e-9, y la del voladizo con el giro de su apoyo (`demandas/vigas.test.ts`) |
| 12. el propuesto cumple y un puesto menos no | Pasa (`armar/vigas.test.ts`), armadura a armadura |
| 13. determinista y sin cambiar la huella | Pasa |
| 14. referencia congelada | Pasa: `congelado-co2.test.ts` (`validacion/co/congelarVigas.ts`), tres modelos: pórticos con viento, pórticos cargados con sismo y la vivienda |
| 15. en la app, lo de Node | Sin hacer: es de CO6 |

**Hallazgos:**

- **CO2-1, el módulo limita la deformación del acero al 10 ‰** (el pivote A; `getEpsUd`). El CE admite también la rama horizontal sin límite (A19 §3.2.7(2)b). Con el mismo límite, el integrador independiente da su MRd a ≤ 1 %; sin él, la sección resiste hasta un 3,7 % más en las poco armadas (cuando la armadura «comprimida» queda por debajo de la fibra neutra). El módulo queda del lado seguro.
- **CO2-2, una viga plana pide cercos de más de dos ramas.** En una de 30 × 30, la separación transversal entre ramas (224 mm con dos) pasa de 0,75·d = 190 mm (§9.2.2(8)): la tabla propone tres. Es lo que sale en todas las vigas planas de la vivienda.
- **CO2-3, la flecha del modelo es la de la fórmula** con todas sus cifras, también la deformación por cortante: 5·w·L⁴/(384·E·I) + w·L²/(8·G·Av). En un voladizo corto tras un vano largo, la punta sube (el giro del apoyo manda): la flecha relativa se toma en valor absoluto.
- **CO2-4, con la sección fisurada la flecha es de 5 a 6,5 veces la elástica** en una viga de 30 × 50 con 3Ø16 (ζ = 0,86): k_inst ≈ 5,1 y k_dif ≈ 6,5 con φef = 2. La fluencia añade poco sobre la fisuración porque la sección fisurada homogeneizada con n_ef crece.
- **CO2-5, `omitidos` chocaba** en la salida de `fem comprobar` con el de los diagnósticos (`listaDiagnosticos`): ahora, `sinListar`.

**Decisiones de Claude, por confirmar por el usuario:**

- **CO2-a, las zonas:** los cuartos de la luz junto a los apoyos y el centro. La armadura superior de un apoyo se entiende que cubre su cuarto (más decalaje y anclaje, que no se comprueban), y la corrida, el centro. La alternativa, por la envolvente con las longitudes de cada refuerzo, es de los planos de armado (A6).
- **CO2-b, una cara, un diámetro:** es del módulo. Mezclar diámetros pide un parche para subir a Concreta.
- **CO2-c, la flecha activa:** la fórmula de arriba, descontando sólo la flecha instantánea del peso propio, con L/400 por defecto. Sin el proceso constructivo no se puede afinar más; es del lado seguro.
- **CO2-d, la clase de exposición por defecto, XC2** (0,3 mm): la del módulo de Concreta es XC1 (0,4 mm). Se pregunta al ingeniero con el recubrimiento (CO1-d).
- **CO2-e, las tablas** de barras y de cercos.
- **CO2-f, la armadura longitudinal de torsión:** la tracción del torsor, a medias entre el cordón superior y el inferior, sumada a la de la flexión en el traccionado y sin descontar la compresión en el comprimido.
- **CO2-g, la cuantía mínima** se exige en cuanto la cara tracciona, por poco que sea.
- **CO2-h:** una viga con compresión de más de 0,1·fcd·Ac o con flexión lateral queda pendiente.

**Medido:**

- **La vivienda:** 30 vanos de 18 vigas planas de 30 × 30; `fem armar` (pilares y vigas) tarda 0,8 s. Propone 2Ø12 arriba y abajo con cØ6/150 de 3 ramas en 27 vanos; en 3, más acero abajo o en un apoyo. Mandan la flexión en los apoyos y, en dos vanos, la flecha activa.
- **El edificio objetivo de losas de 7 plantas, con viento** (`validacion/co/medirVigas.ts`, `out_medirVigas.txt`): 567 vigas y 1 435 vanos (de 30 × 60 por los ejes y secundarias de 25 × 40), 28 combinaciones de ELU. Las demandas tardan 19 s la primera vez (hacen los diagramas de las barras, que comparten las demás consultas) y proponer el armado de todos los vanos, 16 s (11 armados probados por vano). Todos tienen propuesta y cumplen. Manda la flexión de los apoyos en 1 009 vanos, el cortante en 200 y la flexión del vano en 174; la fisuración, en 52. La torsión de compatibilidad pasa del 5 % del torsor de fisuración en 276 vanos. En ecuaciones, el coste de la fase es cero.
- **El mismo, con el sismo del programa** (ab = 0,16 g, μ = 2; `out_medirVigas-sismo.txt`): 92 combinaciones de ELU; las demandas, 42 s, y proponer, 41 s (41 armados probados por vano). 1 254 vanos con propuesta y 181 sin ella (de 30 × 60: la sección no basta con ningún armado de las tablas, porque el edificio no está dimensionado para ese sismo, como sus pilares, §8.4). En los que cumplen manda la flexión de los apoyos en 609, el cortante en 366 y la del vano en 257.

**Pendiente de CO2:** la sombra con el armado de vigas de CYPECAD (CO7); en la app, nada todavía (CO6); un modelo real con torsión de equilibrio (un voladizo de viguetas sin vano detrás) de punta a punta, que hoy sólo se prueba con demandas hechas a mano.

### 8.6 CO3, las losas (2026-11-21)

Pasan los criterios 5 a 14 en lo de las losas; falta su parte de la app (CO6), la sombra (CO7) y el punzonamiento (CO4), que es de donde sale el cortante junto a los pilares. Las decisiones CO3-a…CO3-j, de Claude, **por confirmar por el usuario** (abajo).

**El cortante de las franjas** (lo único que cambia fuera de `src/comprobaciones/`):

- **`EstacionFranja.cortantes`** (`esfuerzosFranjas.ts`): el cortante medio por caso, kN/m. Sale de los mismos cortes que el momento: en las caras y los apoyos, el Vz de las fuerzas nodales, repartido entre las franjas como el My; en las de paso, la integral de Qx de los campos. En el escalón de un pilar, con lo que transmite su enlace. Los momentos no cambian ni un bit (la referencia congelada de F, idéntica).
- **`Consultas.cortanteFranja(id, combinaciones)`:** el mayor |v| de cada estación con su combinación; con el sismo del programa, |estática| + amplitud del sismo (VS-o).
- **Validado** (`franjas.test.ts`): en una losa en flexión cilíndrica, q·(L/2 − s) en las estaciones de paso a ≤ 2 % de q·L/2 con h = 0,25, y 5·q·L/8 a cada lado del apoyo interior de dos vanos a ≤ 0,5 % (por fuerzas nodales).

**Las copias:** `rcSlabs.ts` (`calcForjados`), `rcTSection.ts`, `forjadoTipologias.ts` y sus pruebas; 30 ficheros, y las 427 pruebas de Concreta pasan aquí.

**Las demandas** (`demandas/losas.ts`, `demandasLosa`): las de las franjas de armado de la losa (fase F). De cada estación válida, para la armadura de la dirección de su franja: en ELU, el momento de Wood–Armer de cada cara (`Consultas.armadoFranja`; con el sismo, el pésimo) y el cortante; en la ELS cuasipermanente, los mismos momentos. Además:

- **su sección:** `maciza`, o en un reticular `nervio` o `abaco` (si al menos la mitad de su ancho es de ábaco: el nervio de la franja está en él, CO3-b);
- **`ancho`:** lo que lleva un nervio (el ancho de su franja o, en el metro de un pilar, el de su ventana);
- **`luz`:** la menor distancia entre apoyos de su franja, para el ancho eficaz de la T;
- **`cortante: null`** en el metro de un pilar y donde la recta de la estación pasa a menos de dos cantos de un pilar que llega a la planta (también del que está en el ancho de una viga): ahí es del punzonamiento (CO3-c).

**Comprobar** (`comprobar/losas.ts`, `comprobarLosa`): las estaciones de cada dirección se agrupan por la sección que trabaja en ellas (clase, refuerzos que las cubren en cada cara y, en los nervios, sus cercos y su luz) y el módulo se llama una vez por grupo con el mayor de cada esfuerzo. Como cada fila depende de un solo esfuerzo, es la peor de las que darían sus estaciones una a una, y lleva la franja, la estación y la combinación que la dan.

- **Maciza:** un metro, con la parrilla base y los refuerzos que cubren la estación (varios, como uno del mayor diámetro con la suma de sus áreas).
- **Nervio:** la T del módulo con las barras por nervio; los esfuerzos, por el ancho que lleva el nervio. Con cercos en su zona, el cortante con ellos.
- **Ábaco:** una maciza del canto total con la parrilla de los ábacos; las barras de los nervios que lo cruzan no se cuentan (CO3-d).
- **La dirección Y va por dentro de la X** (CO3-e): pierde el mayor diámetro de la base X, en el recubrimiento (maciza y ábacos) o en el canto (nervios, porque el recubrimiento del módulo es también el lateral y las barras dejarían de caber).
- **Filas:** `<armadura>/bending`, `as-min`, `cracking` (sólo si la cara tracciona en alguna estación del grupo), `bar-spacing…`, `as-max`, y `<x|y>/shear` (y las de los cercos). Cada una, con su `grupo`: la base, la parrilla de los ábacos, un refuerzo, unos cercos, `cortante` (sin cercos) o `seccion`.
- **No se toman** las longitudes de anclaje ni las filas informativas del módulo (esbeltez, reparto).
- **Pendientes** (la losa no cumple): un material que no es hormigón, un reticular sin la parrilla de los ábacos, refuerzos de distinto diámetro solapados en un nervio, sin combinaciones de ELS, una entrada que el módulo rechaza.
- **Avisos:** `comprobacion/punzonamiento-aparte`, `comprobacion/losas-por-defecto` (la exposición), `comprobacion/estaciones-sin-valor` y `armado/refuerzo-sin-estaciones`; y los de las franjas (`franja/esquina-entrante`, `franja/pilar-sin-cara`).

**El armado como dato** (`armado.ts`, `agente/armaduraBase.ts`): `armado.forjados.<losa>` = `{ base, abacos?, refuerzos?, cercos? }`, fuera de la huella.

- `base`: las cuatro armaduras (`x-inf`, `x-sup`, `y-inf`, `y-sup`). En una maciza, `{ diametro, separacion }`; en un reticular, `{ diametro, n }` por nervio.
- `abacos` (reticular): la parrilla de los ábacos, `{ diametro, separacion }`.
- `refuerzos`: `{ armadura, s, t, barras, en? }`: un rectángulo en los ejes de su armadura (s a lo largo de las barras, t en transversal; los de las franjas) en el que se suman a la base. Cubre las estaciones con s dentro y el centro de su franja dentro. En un reticular, `en: "abacos"` o `"nervios"`.
- `cercos` (reticular): `{ direccion, s, t, cercos }`, por zonas.
- Convive con la armadura base de AB (`armado.base` y `armado.losas`, kN·m/m), sigue a su losa al renombrarla o borrarla y se valida (`armado/losa`, `armado/barras`).

**Proponer** (`armar/losas.ts`, `proponerLosa`), en este orden:

1. **La base** de cada armadura (x-inf, x-sup, y-inf, y-sup): la primera de su tabla con la que no falla ninguna regla suya (cuantía mínima donde la cara tracciona, separación máxima, que quepa en el nervio). Con la armadura base de AB, además la primera cuyo momento resistente no es menor. En un reticular, lo mismo con la parrilla de los ábacos.
2. **Los cercos de los nervios:** las estaciones de nervio sin cortante se agrupan en zonas y cada una recibe los primeros cercos con los que cumple.
3. **Los refuerzos:** las estaciones en las que la flexión o la fisuración no cumplen con la base se agrupan en zonas con la misma regla que las de AB (`zonasRefuerzo`), y cada zona recibe, en el rectángulo que la envuelve, el primer refuerzo de la tabla con el que no falla ninguna fila de esa armadura (en un reticular, uno para sus ábacos y otro para sus nervios).
4. **Otra pasada de cercos:** un refuerzo en segunda capa baja el canto útil del nervio y, con él, su cortante sin cercos.

- **Las tablas (CO3-f):** parrillas de Ø8 a Ø25 a 300…100 mm; nervios, de 1 a 4 barras de Ø8 a Ø25; cercos de dos ramas de Ø6 a Ø10 a 200…75 mm. De menos a más acero.
- Una zona sin refuerzo de la tabla que valga va a `sinRefuerzo` y la losa no cumple.
- En una maciza y en los ábacos no propone armadura transversal.

**CLI, MCP y skill:** `fem comprobar` y `fem armar` dan también `losas` (todas, cada una con la fila que manda; con la losa detrás, todas sus filas), con `resumen.losas` y `--tipo losas`; `--escribir` guarda `armado.forjados`.

**Criterios:**

| Criterio | Resultado |
|---|---|
| 5 y 6. las copias y sus pruebas | Pasa (`copias.test.ts`; 427 pruebas de Concreta) |
| 7. identidad con las llamadas a mano | Pasa (`losas.test.ts`): cada fila, el máximo de las del módulo llamado estación a estación con la entrada escrita campo a campo; el cortante, además, con la fórmula del CE escrita aparte, a 1e-9 |
| 8. girar 90° | Pasa: sin la imperfección global, a 1e-9; con ella, a 1e-3 (CO3-5) |
| 9. con el sismo, nunca menos | Pasa, estación a estación |
| 10. nadie aplica factores | Pasa (`src/pruebas/factores.test.ts`) |
| 11. oráculo que no es de Concreta | Pasa: `validacion/co/oraculo_losa.py` en 4 macizas y 3 nervios (MRd con el integrador de la sección, a ≤ 1,5 %; VRd,c con su fórmula, a ≤ 0,3 %; wk, a ≤ 2 %). Las demandas, contra la viga biapoyada (p·L²/8 a ≤ 1 %, el cortante a ≤ 2 %) |
| 12. el propuesto cumple y un puesto menos no | Pasa: la base de cada armadura y cada refuerzo |
| 13. determinista y sin cambiar la huella | Pasa |
| 14. referencia congelada | Pasa: `congelado-co3.test.ts` (`validacion/co/congelarLosas.ts`), cuatro modelos: losa en dos apoyos, losa plana con sismo, reticular y la vivienda. Los aprovechamientos, a 1e-4 (CO3-6) |
| 15. en la app, lo de Node | Sin hacer: es de CO6 |

**Hallazgos:**

- **CO3-1, el reticular necesita cercos junto a los ábacos.** En la losa de 2 × 2 vanos de 6 m (25+5, nervio de 12), los nervios que salen del ábaco llevan de 2 a 4,7 veces su VRd,c (unos 15 kN). Sin cercos de nervio en el armado, ningún reticular cumplía: por eso entran en este tramo.
- **CO3-2, un refuerzo en segunda capa deja al nervio sin cortante.** En la cubierta superior de la vivienda, un refuerzo de 2Ø12 que no cabe con la base en una capa baja el canto útil y el VRd,c del nervio (1,02 de aprovechamiento sin cercos). Por eso hay una segunda pasada de cercos tras los refuerzos.
- **CO3-3, el ancho eficaz del módulo** es mín(intereje; l0/5), que no pasa del de la fórmula del Código (Anejo 19 §5.3.2.1): del lado seguro en la flexión, y da una cuantía mínima algo menor en la cara superior.
- **CO3-4, la constante de vmín:** los módulos de vigas y de forjados usan 0,051/γc·k^(3/2)·√fck. El oráculo la toma del módulo; **hay que contrastarla con el texto del Anejo 19 §6.2.2** (la EHE-08 daba 0,075/γc).
- **CO3-5, la imperfección global no es simétrica frente a un giro de 90°:** en la losa plana simétrica, las demandas de ELU cambian hasta 3e-4 de la mayor al girar la planta; sin `imperfeccion`, 1e-11, y las de ELS, 1e-12. Es de las combinaciones con los casos `IMP-X` e `IMP-Y` (fase IG), no de las franjas. Por investigar.
- **CO3-6, Bun y Node difieren 1,2e-5 en una demanda de franja del reticular** (el fixture se escribe con Bun y la prueba corre en Node). En las vigas, 1e-9. Por investigar: puede ser una elección discreta de las franjas (el cociente de A2-2) que cae distinto con el último bit.
- **CO3-7, el esquema se quedó atrás** al añadir los cercos (lo cazó la prueba del proyecto): tras tocar los tipos del armado hay que pasar `bun run esquema`.

**Decisiones de Claude, por confirmar por el usuario:**

- **CO3-a, el armado de una losa:** una base por cara y dirección en toda la losa y refuerzos en rectángulos; en un reticular, además la parrilla de los ábacos y cercos por zonas. Los rectángulos van en coordenadas de la planta: si la losa se mueve o se gira en el editor, no la siguen (se avisa si un refuerzo se queda sin estaciones).
- **CO3-b, nervio o ábaco:** una estación es de ábaco si al menos la mitad de su ancho lo es.
- **CO3-c, el cortante junto a los pilares** (su metro y a menos de dos cantos de ellos) no se comprueba aquí: es del punzonamiento (CO4). Hasta que CO4 esté, ese cortante no lo comprueba nadie, y se dice en un aviso. **Desde CO4-4** (§8.8), el de las estaciones en la cara de una viga o un apoyo sí se comprueba, también junto a un pilar.
- **CO3-d, en los ábacos sólo cuenta su parrilla,** no las barras de los nervios que los cruzan (del lado seguro).
- **CO3-e, la dirección Y va por dentro de la X,** en las dos caras. No se puede elegir todavía.
- **CO3-f, las tablas** de parrillas, de barras de nervio y de cercos.
- **CO3-g, la base propuesta** es la mínima que cumple las reglas de armado (o la que cubre la armadura base de AB, si se dio); lo demás va a refuerzos. Sale una base pequeña y muchos refuerzos.
- **CO3-h, un refuerzo por zona, en el rectángulo que la envuelve:** una zona alargada (la línea de pilares de una losa plana) recibe el refuerzo de su peor estación en todo su rectángulo. No se parte ni se iguala.
- **CO3-i, la cuantía mínima** se exige en cuanto la cara tracciona en alguna estación del grupo, por poco que sea (como CO2-g).
- **CO3-j, el cortante se toma en la estación** (en la cara del apoyo, no a un canto útil), contra VRd,c con el menor canto útil y la menor armadura de las dos caras, que es lo que hace el módulo.

**Medido** (`validacion/co/medirLosas.ts`, `out_medirLosas.txt`; el tiempo, como información):

- **Losa plana maciza de 25, 2 × 2 vanos de 5 m:** base Ø12/250 en las cuatro y 8 refuerzos superiores sobre las líneas de pilares; cumple (flexión 0,99, fisuración 0,94, cortante 0,72). Con el sismo del programa, lo mismo: no manda en la losa.
- **Reticular 25+5 de 2 × 2 vanos de 6 m:** base de 2Ø8 abajo y 1Ø16 arriba por nervio, parrilla de ábacos Ø8/100, 16 refuerzos y 24 zonas de cercos Ø6/150; cumple. Con ábacos de 2 m en vez de 2,8, también, con una zona más de cercos.
- **La vivienda** (dos cubiertas reticulares con vigas planas): las dos losas cumplen con lo propuesto (13 y 17 refuerzos, 11 y 15 zonas de cercos); `fem armar --tipo losas`, 1,5 s.
- **El edificio objetivo de losas de 7 plantas, con viento** (losas macizas con vigas en todos los ejes): cada losa tiene unas 16 000 estaciones; sus demandas tardan de 2,5 a 6,6 s (la primera calienta los campos) y proponer, 0,1 s. Basta la base (Ø12/250), sin refuerzos: 3 llamadas al módulo por losa. En ecuaciones, el coste de la fase es cero.

**Pendiente de CO3:** el punzonamiento (hecho en CO4, §8.7); la sombra con el armado de losas de CYPECAD (CO7); la app (CO6); CO3-4, CO3-5 y CO3-6.

### 8.7 CO4, el punzonamiento (2026-11-22)

Pasan los criterios 5 a 14 en lo del punzonamiento; falta su parte de la app (CO6) y la sombra (CO7). Las decisiones CO4-a…CO4-j, de Claude, **confirmadas por el usuario el 2026-11-22**; CO4-f, con el cambio que se recomendaba (§8.8). En ecuaciones, el coste es cero: no cambia el modelo analítico.

**Lo que la losa pasa al pilar** (lo único que cambia fuera de `src/comprobaciones/`):

- **`src/compilador/punzonamiento.ts`** (`transmitidoPilar`): el nudo del pilar en una planta es el maestro del enlace rígido de su huella (C2-d, HR) y, con la unión por las caras, también de los nudos de las caras de las vigas que caen en su zona rígida. Lo que la losa le pasa es, por caso base, la suma de las fuerzas nodales de sus láminas (−g, de `FuerzasNodales`) en esos nudos, reducida al nudo del pilar: [Fz, Mx, My]. Exacta y lineal en los casos. Aparte, lo mismo de las vigas planas que le llegan, sólo como información.
- **`Consultas.transmitidoPilar(pilar, planta)`** (por caso base, con la losa, su canto, sus ábacos y las vigas que llegan) y **`Consultas.punzonamiento(pilar, planta, combinaciones)`**: la parte estática de cada componente y, con el sismo del programa, su amplitud (VS-o). `null` si el pilar no se une a ninguna losa en esa planta.
- **Validado** (`punzonamiento.test.ts`): en la losa de 2 × 2 vanos sin vigas, la suma sobre los nueve pilares de lo que les pasa la losa es la carga de la losa caso a caso, en fuerza y en los dos momentos, a 1e-9; y en cada pilar es su axil de cabeza (la diferencia de axiles) a 1e-9 con la sobrecarga.

**Las copias:** `punching.ts` (`calcPunching`), `punchingGeometria.ts`, `cruceta.ts` (lo importa; no se usa) y sus pruebas; 35 ficheros, y las 99 pruebas de punzonamiento de Concreta pasan aquí.

**Las demandas** (`demandas/punzonamiento.ts`, `demandasPunzonamiento`): una por pilar y planta en la que el pilar se une a una losa. De cada una:

- **las combinaciones,** todas las de ELU (H31), cada una con su Fz, Mx y My y sus amplitudes del sismo;
- **el área cargada:** la sección del tramo de debajo (el que sostiene la losa) y la del de encima (el que carga sobre ella), con su centro (el del punto fijo, PF) y sus ejes;
- **los bordes:** la distancia libre de cada cara al borde del forjado, por tres rayos normales a la cara. El forjado es la unión de los contornos de las losas de la planta y del ancho de sus vigas y sus tiras de borde (`mapeo.anchos`): con la losa dibujada hasta el eje del zuncho, el hormigón llega a su cara de fuera. Un lado común a dos losas no es un borde. En un reticular, además, la distancia al borde de su ábaco;
- **los huecos** de las losas de la planta, aparte.

**Comprobar** (`comprobar/punzonamiento.ts`, `comprobarPunzonamiento`): una llamada a `calcPunching` por cara que tracciona, con la combinación de mayor β·VEd. Lo que el módulo no sabe va en el adaptador:

- **La cara:** si la losa cuelga del pilar (Fz < 0), la superior, con el tramo de debajo como área (modo «pilar»); si el pilar carga sobre la losa (un pilar apeado, una losa de cimentación), la inferior, con el tramo de encima (modo «carga puntual»).
- **La posición, de la geometría:** una cara está libre si el borde queda a menos de c∥/2 + π·d de ella (ahí el perímetro que muere en el borde es más corto que el cerrado, §6.4.2(4)). Ninguna, interior; una, borde; dos contiguas, esquina.
- **El pilar retranqueado** una distancia a se le da al módulo como enrasado con el área prolongada hasta el borde (c⊥ + a), que es el perímetro de la figura A19.6.15; con la cara fuera de la losa (a < 0), sólo cuenta lo de dentro.
- **Los huecos** a menos de 6·d quitan del perímetro lo que queda entre sus tangentes desde el centro del área (§6.4.2(3)); lo que el perímetro tenga fuera del forjado (una esquina entrante) tampoco cuenta. La reducción entra por β (β·u1/u1,ef), porque el módulo calcula su u1: vEd en u1 sale exacta y en la cara del pilar, del lado seguro.
- **β, de la fórmula general** (§6.4.3) con los momentos de la combinación respecto al centro del área: interior, 1 + k·e·u1/W1 en cada dirección, sumadas; circular, 1 + 0,6·π·e/(D + 4d); borde, u1/u1* + k·e∥·u1/W1; esquina, u1/u1*. Con el sismo, cada componente con su peor signo.
- **La armadura de flexión:** la de la cara que tracciona en las dos direcciones (la base, o la parrilla de los ábacos, más los refuerzos que cubren el centro del área), como una malla igual de cuantía √(ρx·ρy); d, la media de los dos cantos útiles.
- **En un reticular,** dos filas propias: el perímetro crítico tiene que caber en el ábaco (`abaco-u1`) y, si hace falta armadura, también uout (`abaco-uout`). Los nervios a la salida del ábaco los comprueba CO3.
- **Filas:** `<cara>/punz-rho-min`, `punz-ved-max` (en la cara del pilar), `punz-ved-vrdc` (sin armadura; con ella, informativa) y, con cercos, `punz-sr-max` y `punz-ved-vrdcs`. Cada una, con su `grupo`: `cercos`, `seccion` o `losa`.
- **Pendientes** (no cumple): la losa sin armado o sin la parrilla de los ábacos, una sección que no es rectangular ni circular, borde libre en dos caras opuestas o en más de dos, un pilar circular que no es interior, el centro del pilar fuera de la losa o en un hueco, más de la mitad del perímetro fuera del forjado.

**El armado como dato** (`armado.ts`, `agente/armaduraBase.ts`): `armado.punzonamiento.<pilar>.<planta de la losa>` = `{ diametro, ramas, separacion }` (mm), fuera de la huella: cercos verticales en perímetros, con `ramas` por cada cara del pilar con losa delante, cada `separacion` en radial. Se valida (`armado/pilar`, `armado/planta`, `armado/barras`) y sigue a su pilar y a su planta al renombrarlos o borrarlos.

**Proponer** (`armar/punzonamiento.ts`, `proponerPunzonamiento`): si sin armadura no falla nada, ninguna. Si falla sólo lo que arreglan unos cercos, los primeros de la tabla con los que no falla ninguna fila (Ø8, Ø10 o Ø12, de 2 a 4 ramas por cara, cada 200 a 75 mm; de menos a más acero), con los perímetros que pide uout. Si falla lo que no arreglan (vRd,max, la cuantía mínima, el ábaco) o no basta ninguno (vRd,cs no pasa de 1,5·vRd,c), no hay propuesta y se dice qué hay que cambiar.

**CLI, MCP y skill:** `fem comprobar` y `fem armar` dan también `punzonamiento` (todas las uniones, cada una con la fila que manda; con el pilar detrás, todas sus filas), con `resumen.punzonamiento` y `--tipo punzonamiento`. `fem armar` usa el armado de losas que propone en la misma pasada; `--escribir` guarda `armado.punzonamiento`.

**Criterios:**

| Criterio | Resultado |
|---|---|
| 5 y 6. las copias y sus pruebas | Pasa (`copias.test.ts`; 99 pruebas de Concreta) |
| 7. identidad con las llamadas a mano | Pasa: la fila de cada unión es el máximo de las de sus combinaciones una a una, y manda la de mayor β·VEd, no la de mayor VEd |
| 8. girar 90° | Pasa: sin la imperfección global, las mismas posiciones y armaduras, y VEd, β y aprovechamiento a 1e-6 |
| 9. con el sismo, nunca menos | Pasa, unión a unión; y con amplitudes dadas, igual que la estática con los valores absolutos aumentados |
| 10. nadie aplica factores | Pasa (`src/pruebas/factores.test.ts`) |
| 11. oráculo que no es de Concreta | Pasa: `validacion/co/oraculo_punzonamiento.py`, 12 casos (interior, circular, borde y esquina, enrasados y retranqueados, con y sin cercos): d, u1, u0, β, vEd, vRd,c y uout a 1e-9; vRd,max a ≤ 0,25 % y vRd,cs a ≤ 0,1 % (CO4-1). La geometría, contra cuentas a mano (el perímetro de cada posición, lo que quita un hueco por integración en polares, el cuarto de círculo de una esquina entrante) |
| 12. el propuesto cumple y los anteriores de la tabla no | Pasa |
| 13. determinista y sin cambiar la huella | Pasa (`cli.test.ts`: la misma huella tras `--escribir`) |
| 14. referencia congelada | Pasa: `congelado-co4.test.ts` (`validacion/co/congelarPunzonamiento.ts`), seis modelos: la losa hasta la cara de los pilares, la de 7 m (cercos en los nueve), con un hueco, la losa plana con sismo, un reticular y la vivienda |
| 15. en la app, lo de Node | Sin hacer: es de CO6 |

**Hallazgos:**

- **CO4-1, el módulo usa valores tabulados redondeados:** fcd = 16,7 MPa con HA-25 (16,667), así que vRd,max sale un 0,2 % alto; y el área del Ø8, 50,3 mm² (50,27), un 0,07 % en vRd,cs. Del lado inseguro, por muy poco.
- **CO4-2, β general frente al simplificado:** en un pilar interior de una planta simétrica sale 1,00 (el simplificado, 1,15): las combinaciones no alternan la sobrecarga entre vanos, así que el momento que la losa le pasa es nulo. En los de borde, 1,17–1,34 (1,4), y en los de esquina, 1,33–1,61 (1,5). En la vivienda llega a 1,91 en un pilar de borde.
- **CO4-3, con vigas, la losa pasa poco al pilar:** en la vivienda, de 23 pilares en dos cubiertas sólo 12 uniones tienen losa en su huella, y en los de borde con zuncho la losa lleva de un cuarto a la mitad de lo que le llega al pilar (31 de 86 kN en P12); lo demás va por las vigas planas. En el edificio objetivo de losas (vigas en todos los ejes), 280 uniones de 560, con vEd/vRd,c ≤ 0,50.
- **CO4-4, queda un hueco entre CO3 y CO4:** el cortante de la losa contra la cara de una viga a menos de dos cantos de un pilar no es de las franjas (CO3-c lo deja al punzonamiento) ni pasa por la huella del pilar (va a la viga). No lo comprueba nadie.
- **CO4-5, el centro de un pilar de borde cae justo en el contorno** cuando la losa se dibuja por los ejes de los pilares: sin el ancho de las vigas en el forjado, 5 de las 12 uniones de la vivienda quedaban pendientes, y los pilares de esquina del edificio objetivo, también.
- **CO4-6, vmín:** el módulo de punzonamiento usa 0,035·k^(3/2)·√fck (el del Eurocódigo), y los de vigas y forjados, 0,051/γc = 0,034 (CO3-4). Hay que contrastar los dos con el texto del Anejo 19.

**Decisiones de Claude, confirmadas por el usuario el 2026-11-22** (CO4-f, cambiada: §8.8):

- **CO4-a, sólo cuenta lo que la losa pasa al pilar** (CO-i al pie de la letra). Lo de las vigas planas se da como información y no entra: su cortante se comprueba con la viga (CO2), con sus cercos. La alternativa (contarlas, porque son hormigón del forjado) daría por no cumplido un pórtico de vigas planas armadas a cortante. Un pilar al que la losa no llega no tiene comprobación de punzonamiento.
- **CO4-b, β general sin suelo:** no se sube a 1,15 / 1,4 / 1,5 cuando sale menor (CO4-2). La alternativa del lado seguro es tomar el mayor de los dos.
- **CO4-c, la cara libre:** el borde a menos de c∥/2 + π·d; con un borde que no es paralelo a la cara, la menor de sus distancias. El pilar retranqueado, como enrasado con el área prolongada (también en u0).
- **CO4-d, los huecos, por sus tangentes** desde el centro del área, con todo su contorno (sin la reducción de la figura A19.6.14 para huecos alargados: del lado seguro); y lo que el perímetro tiene fuera del forjado no cuenta, hasta la mitad.
- **CO4-e, la excentricidad perpendicular al borde hacia fuera** (no la cubre u1/u1*) se suma como en un pilar interior. No es de la norma: es del lado seguro.
- **CO4-f, la armadura de flexión:** √(ρx·ρy), media en el ancho del pilar más 3·d a cada lado, y d la media de las dos direcciones. Al principio contaba entero todo refuerzo que cubría el centro del área, que con uno estrecho daba más ρl del que hay (§8.8).
- **CO4-g, la armadura de punzonamiento:** cercos verticales por perímetros, con su tabla. Sin barras levantadas ni pernos.
- **CO4-h, en un reticular,** el perímetro crítico y uout dentro del ábaco, como filas que fallan; no se propone agrandar el ábaco.
- **CO4-i, en una losa de cimentación** no se descuenta la reacción del terreno dentro del perímetro (del lado seguro), ni se comprueban perímetros más cercanos que 2·d (§6.4.4(2)).
- **CO4-j, cuando los cercos no bastan no se propone otra cosa:** ni más armadura de flexión, ni más canto, ni capitel. Se dice.

**Medido** (`validacion/co/medirPunzonamiento.ts`, `out_medirPunzonamiento.txt`; el tiempo, como información):

- **Losa maciza de 25, 2 × 2 vanos de 5 m:** con la losa hasta la cara de los pilares, esquinas 83 kN (β 1,38, 0,78 de vRd,c), bordes 202 kN (β 1,19, 0,95) y el central 553 kN (β 1,00, 1,07): pide Ø8 de 2 ramas cada 150 en 2 perímetros y queda a 0,86. Con 0,5 m de vuelo, los de borde y esquina siguen siéndolo (el borde a 0,3 m), con el área prolongada.
- **La misma de 7 m y 30 cm:** los nueve pilares piden cercos (1,17 a 1,44 de vRd,c); el central, 1 228 kN, Ø8 de 3 ramas cada 125 en 4 perímetros (0,98).
- **Con un hueco de 1 × 1 m pegado a la esquina del pilar central:** el perímetro baja de 4 214 a 3 360 mm y vEd/vRd,c sube de 1,07 a 1,20.
- **Reticular 25+5 de 6 m con ábacos de 2,8 m:** el central, 698 kN, 1,02 de vRd,c: cercos en 2 perímetros; el perímetro crítico, a 524 mm de los 1 200 del ábaco.
- **La vivienda:** 12 uniones, todas cumplen sin armadura (la peor, P3, 290 kN y 0,95); 1,7 s.
- **El edificio objetivo de losas de 7 plantas con viento:** 280 uniones, todas cumplen sin armadura; el punzonamiento, 0,2 s (armar antes las losas, 19 s).
- **Frente a la diferencia de axiles del pilar** (la alternativa de CO-i): sin vigas coinciden (lo separa el peso del pilar en su zona rígida, 1,4 kN); con vigas, la diferencia de axiles es de 1,1 a 4,3 veces lo que pasa la losa.

**Pendiente de CO4:** la sombra con el punzonamiento de CYPECAD (CO7); la app (CO6); contrastar CO4-6. CO4-4, cerrado en §8.8.

### 8.8 CO4-f y CO4-4, tras las decisiones (2026-11-22)

Decidido por el usuario el 2026-11-22: CO4-a…CO4-j como estaban, salvo CO4-f, que se cambia, y cerrar CO4-4 antes de CO5.

**CO4-f, la cuantía media en una banda** (`comprobar/punzonamiento.ts`, `flexion`): la armadura de cada dirección es la media en el ancho del pilar más 3·d a cada lado, transversal a las barras (CE A19 §6.4.4(1)): la base entera y, de cada refuerzo que pasa por el pilar a lo largo de sus barras, la parte de la banda que cubre. Prueba: un refuerzo de 0,6 m de ancho centrado en un pilar de 40 con d = 208 mm cuenta 0,6/1,648 de su área. En las referencias (`out_cambiosCO4f4.txt`), la cuantía de los pilares de borde baja (ρl,min/ρl de 0,68 a 0,75 en la losa de 5 m) y vEd/vRd,c sube hasta un 4 % (losa de 7 m, de 1,42 a 1,48; en la vivienda, P11, de 0,855 a 0,883). Ninguna unión cambia de armadura ni deja de cumplir.

**CO4-4, el cortante en la cara de las vigas junto a los pilares** (`demandas/losas.ts`): el cortante de una estación de **apoyo** (la cara de una viga, un muro o un apoyo lineal) se comprueba siempre, también a menos de dos cantos de un pilar: lo que pasa por ella va a la viga o al apoyo, y el punzonamiento no lo ve. Sigue sin comprobarse en el metro de un pilar (es del punzonamiento) y en las estaciones de **paso** a menos de dos cantos de un pilar, que por campos no convergen junto a la esquina de un pilar y una viga (en la vivienda, de 138 a 91 kN/m al pasar de h = 0,75 a 0,375) y que ya cubre la estación de la cara, exacta.

- **Se probó primero** contar también las de paso junto a los pilares que no tienen losa en su huella; daba esos valores sin converger y se descartó. De ello queda `Consultas.losaEnHuella(pilar, planta)` (la losa que toca la huella, sin calcular nada).
- **Lo que destapa, la vivienda deja de cumplir** (CO4-7): las dos losas fallan a cortante en la cara de una viga, dentro de un ábaco, donde no se propone armadura transversal:
  - **L-CUB-S, junto a P4** (la esquina de la losa en la que se juntan dos vigas, con P4 dentro del ancho de las dos): 281 kN/m en la franja X13, **2,24 de VRd,c**. Converge: 281, 283 y 282 kN/m con h = 0,75, 0,375 y 0,25. Es la reacción de esquina de una losa apoyada en dos vigas que se cruzan.
  - **L-CUB, junto a P2:** 122 kN/m en la franja Y5, **1,003**; también converge (122, 127 y 122).
  - El armado propuesto no cambia (`armado igual` en el registro): no hay nada de la tabla que arregle el cortante de un ábaco.
- **A un canto útil de la cara** (el §6.2.1(8) del Anejo 19 deja no comprobar más cerca con carga repartida), el de P4 parecía bajar a unos 90–100 kN/m, del orden de 0,75 de VRd,c. La estimación salía de las estaciones de paso por campos, que junto a un apoyo no valen (§8.9).
- **Las demás referencias** de CO3 (la losa en dos apoyos, la plana con sismo, el reticular) no cambian.

**CO4-7,** decidida por el usuario el mismo día: §8.9.

### 8.9 CO4-7, las astillas de losa (2026-11-22)

El usuario eligió primero tomar el cortante a un canto útil de la cara de los apoyos (§6.2.1(8)). Al hacerlo salieron dos cosas, y con ellas decidió otra cosa: **no comprobar a cortante las astillas de losa y dejar el cortante en la cara de los apoyos** (CO3-j).

**El cortante a un canto útil no sale bien de la malla.** La estación de la cara es exacta (fuerzas nodales), pero lo que hay entre la cara y d sólo lo dan las estaciones de paso, por campos, y junto a un apoyo salen bajas, del lado inseguro:
- en una losa continua de dos vanos, a 0,25 m del apoyo interior, 27 kN/m frente a los 40 de la viga con h = 0,25 (−32 %; con h = 0,1, exacto): el SPR mezcla los dos lados del salto del cortante en el apoyo;
- en la vivienda, con h = 0,75, el valor a d interpolado sale un 14 % bajo frente a la malla fina (87 frente a 101 kN/m).

Las dos maneras seguras (restar p·d al de la cara, que baja 3–4 kN/m, o cortar por fuerzas nodales por una línea de la malla paralela a la cara a menos de d, que no siempre hay) no compensaban. El intento por interpolación se descartó sin subirlo.

**El 2,24 de P4 era una astilla.** La franja X13 de L-CUB-S tiene 0,72 m de ancho, pero en la cara de la viga sólo 8 cm de losa (`anchoEnLosa` = 0,08): el resto cae en el ancho de una viga que corre a lo largo de la franja. Los 281 kN/m eran 22,5 kN en esos 8 cm, en la esquina de dos vigas que se cruzan. Ese trozo trabaja con la viga, no como una losa ancha.

**La regla** (`demandas/losas.ts`): una estación con menos de un canto de losa en el ancho de su franja (`anchoEnLosa` < espesor), de apoyo o de paso, no lleva cortante (`sinCortante: "astilla"`), y la losa lleva el aviso `comprobacion/cortante-astilla` con las estaciones. Los momentos no cambian. `sinCortante` dice también las del punzonamiento («pilar»), y el aviso `comprobacion/punzonamiento-aparte` sólo sale por ellas.

- **Prueba** (`losas.test.ts`): una losa en L en la que la franja de arriba, más allá del escalón, tiene 10 cm de losa con 20 de canto; sin el escalón, ni astillas ni aviso.
- **Referencias** (`validacion/co/out_cambiosAstillas.txt`): sólo cambia la vivienda. L-CUB-S cumple (de 2,238 a 1,000 en el peor cortante, 0,9999 con sus cercos, y el mismo armado); L-CUB pierde una zona de cercos que sólo pedía una astilla y sigue sin cumplir por poco: 1,003 de VRd,c en un ábaco junto a P2, con losa en todo el ancho de la franja (0,72 m). El punzonamiento no cambia.
- **La vivienda sigue sin cumplir** por esa estación de L-CUB (un 0,3 % por encima).


### 8.10 CO6, la app: Resultados · Comprobación (2026-11-22)

Hecha la parte de la app para CO1–CO4 (pilares, vigas, losas y punzonamiento). Pasa el criterio 15. **Quedan de CO6:** las zapatas (CO5 está a medias en otra sesión: entran como un tipo más cuando esté), la sección de comprobaciones del informe de `fem revisar` y el color por aprovechamiento en el 3D y en el alzado (en planta, hecho: §8.10.1). El cálculo no cambia: nada de esto toca el motor, el compilador ni las funciones de CO1–CO4.

**En el worker** (`src/visor/comprobaciones.ts`, puro; pedidos `comprobaciones`, `comprobacion` y `armar`):

- **Los números son los de `fem comprobar` y `fem armar`:** sólo se llama a `comprobarPilares`, `comprobarVigas`, `comprobarLosas` y `comprobarPunzonamientos` y se cambia la forma: una fila por tramo, vano, losa o unión de pilar y losa (`ParteComprobada`), y su ficha con todas las filas del módulo (`FichaComprobacion`).
- **El armado va en cada pedido,** como la armadura base de AB: no entra en la huella y el worker no se reabre al cambiarlo. Los datos comunes (`obra.armado`) son de la sesión.
- **Cambiar el armado de una pieza sólo vuelve a comprobar esa pieza:** lo comprobado se guarda por pieza con el armado con el que se comprobó, por `Consultas`. Con el armado del proyecto cada pieza es independiente (las reglas de obra de CO1-e sólo actúan al proponer); el punzonamiento depende además del armado de todas las losas.
- **`armar`** propone como `fem armar` (los pilares con sus reglas de obra, las vigas, las losas y, con el armado de las losas que queda, el punzonamiento), en los tipos que se piden, en unas piezas o sólo en lo que no tiene armado, y devuelve el `armado` entero para la operación `armado`. No escribe nada.

**En la app** (`app/src/pantallas/Comprobacion.tsx`, modo «Comprobación» de Resultados, también en la paleta):

- **La tabla** del tipo elegido (Pilares, Vigas, Losas, Punzonamiento): pieza, parte, sección o planta, armado, aprovechamiento, la comprobación que manda con su lugar y su combinación, y el estado (Cumple, No cumple, Sin armado, Sin comprobar). «Los peores, primero». Un clic elige la pieza en las vistas, lleva la planta a la suya y abre la ficha; elegir una pieza en una vista abre la suya.
- **La ficha:** el armado como formulario por grupos (`src/editor/armadoBarras.ts`, puro: esquinas, caras y cercos de un tramo; inferior, superior, apoyos, cercos y piel de un vano; la base por armadura de una losa y la parrilla de los ábacos; los cercos de punzonamiento), «Aplicar», «Proponer» (esa pieza) y «Quitar»; sus datos (en el punzonamiento, la posición, VEd, β, u1, d) y todas las filas del módulo, las que no cumplen primero. Los refuerzos y los cercos de nervio de una losa no se editan aquí: se proponen y se conservan (CO6-a).
- **Proponer armado:** «Lo que falta» y «Todo» en el tipo de la pestaña, y «Toda la obra» (los cuatro tipos, en lo que falta). Lo propuesto se escribe con la operación `armado`, un paso de deshacer, y se dice cuánto tiene propuesta y qué no (con su motivo).
- Sin recalcular: el armado no cambia la huella.

**Criterio 15** (`validacion/co6/chrome.ts`, `out_chrome.txt`), con la vivienda en Chrome:

- sin armado, los 36 tramos, «Sin armado»;
- «Toda la obra» (2,4 s en el worker): guardado, el proyecto es el de `datosArmar` en Node con la operación `armado`, **byte a byte** (23 pilares, 18 vigas y 2 losas; ninguna unión necesita armadura de punzonamiento);
- las cuatro tablas, las de `datosComprobaciones` en Node: pieza, armado y estado idénticos, y el aprovechamiento a la centésima que se enseña;
- la ficha de un tramo, con las 25 filas de Node; con los cercos cada 400 mm deja de cumplir en la ficha y en la tabla sin recalcular, y deshecho vuelve a ser el proyecto guardado;
- sin tareas largas en el hilo principal.

**Pruebas:** `src/visor/comprobaciones.test.ts` (identidad con las funciones de CO1–CO4 sobre unas consultas montadas aparte; la caché: tras cambiar un pilar se comprueban sólo sus tramos y la tabla es la de comprobarlo todo de nuevo; proponer unas piezas o lo que falta deja lo demás) y `app/src/test/comprobacion.test.tsx` (la tabla, proponer, la ficha, editar, un dato que no vale y quitar).

**Hallazgos:**

- **CO6-1:** una etiqueta `Campo` (un `<label>`) alrededor de un grupo de botones da su texto como nombre accesible del primero; los grupos de botones van en un `role="group"`.
- **CO6-2:** tras deshacer hasta lo guardado, la app no da el proyecto por cambiado (el banco esperaba poder guardar).
- **CO6-3:** en la vivienda con lo propuesto, una de las dos losas no cumple (en el banco, «1 cumplen y 1 no»): es lo de §8.9 (el cortante de L-CUB junto a P2, 1,003 de VRd,c), visto ahora en la app.

**Decisiones de Claude, por confirmar por el usuario:**

- **CO6-a:** los refuerzos y los cercos de nervio de las losas no se editan a mano en la ficha (son rectángulos en los ejes de su armadura): se proponen y se conservan; a mano, en el `proyecto.json`.
- **CO6-b:** «Todo» sustituye el armado que haya en el tipo sin preguntar (es un paso de deshacer).
- **CO6-c:** el aprovechamiento de la tabla es el de la fila que manda de CO1–CO4 (la que falla; si no, la de agotamiento más alta), no el máximo de todas las filas.
- **CO6-d:** las piezas no se colorean todavía por su aprovechamiento en las vistas: la tabla elige la pieza y la vista la resalta.

**Confirmadas por el usuario el 2026-11-22** como las recomendaba Claude: CO6-a y CO6-c, como están; CO6-b, con confirmación al sustituir y sin tocar la armadura de punzonamiento escrita al proponer lo que falta; CO6-d, el color, hecho en planta (§8.10.1).

#### 8.10.1 CO6-b y CO6-d, tras las decisiones (2026-11-22)

**CO6-b:**

- **«Todo» pregunta** si alguna parte del tipo ya tiene armado en el proyecto («N de M tramos ya tienen armado…»), con «Cancelar», «Sólo lo que falta» y «Sustituir». Sin nada escrito, propone sin preguntar.
- **«Sólo lo que falta» (y «Toda la obra») conserva la armadura de punzonamiento escrita** (`datosArmar` con `soloSinArmado`): en las uniones sin ella se propone la que haga falta, o ninguna. Antes se volvía a proponer siempre, porque depende del armado de las losas, y una puesta a mano se sustituía o se quitaba. Con «Todo», como antes: la de las tablas, y fuera la que ya no haga falta.
- **«Lo que falta» también en la pestaña Punzonamiento,** con ese significado.
- El resumen de lo propuesto dice además cuántas partes se quedan con su armado («, 36 con el suyo»; en el punzonamiento, «con la suya»).

**CO6-d, en planta** (la vista de planta `comprobacion` de la sesión, `vistaComprobacion` en `src/visor/comprobaciones.ts`; el armado va en el pedido, como en AB): sobre el modelo atenuado, cada parte del color de su aprovechamiento, con su rótulo (el aprovechamiento de la fila que manda, CO6-c):

- los tramos de pilar con la cabeza en la planta, y las uniones de pilar y losa de la planta, en la huella del pilar;
- cada vano de viga, en su banda entre las caras de sus apoyos (un color por vano);
- cada losa entera, con sus huecos, en el sitio de su polígono del fondo (sin los ábacos grises), con las vigas, los pilares y los muros encima;
- colores (`claseAprovechamiento`): verde, cumple con 0,90 o menos; ámbar, cumple con más de 0,90 o sin comprobar del todo (lo pendiente, sin que nada falle); rojo, no cumple; gris, sin armado. La leyenda sólo lista las clases que hay en la planta;
- un clic en una parte elige su pieza y abre su ficha.

**Queda de CO6-d:** el 3D y el alzado por aprovechamiento.

**Validación:** `src/visor/comprobaciones.test.ts` (la armadura escrita se queda con «sólo lo que falta» y se sustituye sin él; en cada planta, las piezas coloreadas son las de sus partes, con el color de su clase, y un clic elige la pieza) y `app/src/test/comprobacion.test.tsx` (la pregunta de «Todo», «Cancelar», «Sustituir» y «Sólo lo que falta»). El banco de Chrome comprueba además que la planta de cada tipo lleva en la leyenda las clases de sus partes; «Todo bien».

**Hallazgos:**

- **CO6-4:** la leyenda de la app corta cada texto en la primera «, », « (», «; », «. » o «: » (`textoCorto`): los textos de una leyenda tienen que leerse enteros hasta ahí.
- **CO6-5:** la ficha reiniciaba lo escrito si llegaba otra respuesta con el mismo armado (comparaba por identidad del objeto): con la máquina cargada, «Aplicar» quedaba sin efecto. Ahora compara por contenido.

### 8.11 CO6, el armado dibujado (2026-11-22)

De la puerta de uso de CO6 (el usuario, con la vivienda): el armado sólo se leía como texto («x-inf 2Ø8 · … · 17 refuerzos · 15 zonas de cercos») y como un formulario; «hay que mejorar mucho el apartado visual», con más peso del dibujo, como en los programas que conoce. El cálculo y las comprobaciones no cambian: los mismos bits.

**La geometría** (`src/comprobaciones/dibujoArmado.ts`, pura): de un armado y lo que mide su pieza, dónde va cada barra, con el recubrimiento de las comprobaciones (hasta el cerco). `seccionPilarArmada` y `seccionVigaArmada` (las barras por su grupo, el cerco y sus ramas interiores, y el aviso de las barras a menos de su separación mínima), `alzadoVano` (los cuartos de la luz de CO2-a, con la superior y los cercos de cada zona y la posición de cada cerco), y `refuerzosDibujados` y `cercosDibujados` (los rectángulos (s, t) de una losa, en planta, con los ejes de las franjas del compilador). Un armado a medias (el borrador del formulario) dibuja lo que tiene.

**La ficha** (`app/src/editor/CroquisArmado.tsx`, en Propiedades):

- **Pilar:** la sección a escala, con el cerco y las barras de cada grupo en su color (esquinas, caras b, caras h o anillo), las cotas con su nombre y As y ρ.
- **Viga:** el alzado del vano entre sus apoyos (la superior corrida y la de cada zona de apoyo, la inferior, los cercos a su separación) y la sección de cada zona (una sola si las tres son iguales).
- **Losa:** el nervio de cada dirección de un reticular con sus barras y un metro de ábaco o de maciza con su parrilla (las X, de punta; las Y, por dentro, como las toma la comprobación).
- **Punzonamiento:** la planta del pilar con el perímetro crítico y los perímetros de cercos.
- El croquis sigue a lo que se escribe, sin aplicarlo (`armadoParcial`), y el grupo con el foco o bajo el ratón se resalta en él.
- **«Ampliar el dibujo»** (pilares y vigas): el mismo borrador en un diálogo, con el dibujo en grande y el formulario al lado.

**La planta** (`src/visor/armadoPlanta.ts`; vista `comprobacion` con `dibujo: "armado"`, por defecto en la app; «Aprovechamiento» deja la de CO6-d):

- **Losas:** cada refuerzo con su barra (de punta a punta), su línea de reparto (lo que cubre) y su rótulo («Ø12/200 · 2,40 m»), los inferiores en azul y los superiores en rojo; las zonas de cercos de los nervios, rayadas; la armadura base, en la leyenda; todo recortado con la losa. «Refuerzos»: las dos caras, la inferior o la superior.
- **Pilares:** la sección del tramo que llega a la planta en su huella, con el cerco y las barras a escala (y una marca de tamaño fijo, que se ve sin acercarse), y su armado rotulado.
- **Vigas:** el armado de cada vano a lo largo de él (la superior a un lado; la inferior y los cercos, al otro) y lo propio de cada zona de apoyo en su cuarto de la luz.
- **Punzonamiento:** el perímetro crítico (a 2·d) y los perímetros de cercos, cortados en el borde de las losas.
- El color de cada pieza sigue siendo el de su aprovechamiento.

**Los refuerzos y los cercos de una losa, uno a uno** (cambia CO6-a): cada uno tiene su id en las vistas (`<losa>/R<n>`, `<losa>/C<n>`: `idElemento`), así que un clic en la planta lo elige y abre la ficha de su losa con él a la vista, y un clic en su fila de la ficha lo elige en la planta. En la ficha se cambian sus barras y se quita (`sinElemento`); la zona sigue siendo la que se propuso.

**Validación:** `src/comprobaciones/dibujoArmado.test.ts` (las barras del armado, dentro del cerco y a su recubrimiento; las zonas y los cercos del vano; los ejes, los de `ejesArmado` del compilador en cualquier ángulo; los refuerzos en planta), `src/visor/comprobaciones.test.ts` (en cada planta: tantas barras como el armado de cada pilar y dentro de su huella, cada refuerzo con su id y sólo los de la cara pedida, cada vano rotulado, el perímetro crítico de cada unión, y un clic en un refuerzo lo elige) y `app/src/test/comprobacion.test.tsx` (el croquis sigue al borrador sin escribir nada, el editor ampliado, y elegir y quitar un refuerzo). A mano, en la app, con la vivienda. Los bancos de Chrome no se han pasado.

**Hallazgos:**

- **CO6-6:** dibujados, los refuerzos de las losas enseñan lo que el texto escondía: la propuesta deja refuerzos de 0,16 a 0,40 m de largo (una estación suelta que no cumple) y zonas que se pisan. Es de proponer (CO3-h, AB-5: agrupar e igualar las zonas), no del dibujo.
- **CO6-7:** `dibujoArmado.ts` repite la cuenta de `direccionEje1` del compilador en vez de importarla: lo carga el hilo principal de la app, que no lleva el compilador.

**Por decidir por el usuario:** CO6-e, si la planta abre con el armado (como queda) o con el aprovechamiento; CO6-f, qué más quiere a la vista (lo que no está: el armado en el 3D y en el alzado, el cuadro de pilares y los planos, A6; mover o estirar la zona de un refuerzo con el ratón y añadir uno a mano, hechos en §8.12).

### 8.12 CO6, los refuerzos de las losas: despiece, cotas y edición con el ratón (2026-11-22)

Lo primero de la lista de mejoras visuales que eligió el usuario tras §8.11: que la planta de refuerzos de las losas se pueda enseñar. Dibujada, la propuesta dejaba refuerzos de 2 a 40 cm de largo (CO6-6). El cálculo no cambia; **sí cambia lo que propone `fem armar` en las losas**, a sabiendas.

**El despiece al proponer (CO6-g; `armar/losas.ts`, `despiece`).** Son reglas de obra, que sólo añaden acero; el juez sigue siendo la comprobación del armado entero.

- **En los ábacos, uno por ábaco:** si alguna estación de un ábaco pide refuerzo en una armadura, el refuerzo es una parrilla en el ábaco entero (lo que cae en la losa), no en el trozo que falla. Las demandas llevan los ábacos de la losa como los usa el cálculo (`DemandasLosa.abacos`).
- **En los nervios y en una maciza,** el rectángulo que envuelve cada zona se alarga por cada punta el decalaje (el canto de la losa) más la longitud de anclaje de su barra (`computeAnchorage` del módulo de forjados, con su posición de adherencia: con Ø12 y HA-25, 0,49 m abajo y 0,69 m arriba), sin salir de la losa y hasta 1 m (`LARGO_MINIMO`). El anclaje depende del diámetro, que sale de dimensionar: se repite con el diámetro elegido (como mucho cuatro rondas; el diámetro supuesto sólo crece).
- **Se unen** dos rectángulos de la misma armadura que se tocan o se pisan si el que los envuelve a los dos no pasa de 1,2 veces lo que cubren (`HOLGURA_UNION`: los trozos seguidos de un nervio, los nervios vecinos de casi el mismo largo), y siempre si sus zonas se pisan de origen. Los que aun así se pisan (dos vanos seguidos) se cortan a mitad del hueco entre sus zonas: ningún refuerzo pisa a otro de su armadura y de su clase, y el solape entre los dos no se da.
- **Las puntas, a 5 cm** (`MODULO_LARGO`), hacia fuera, salvo las que llegan al borde de la losa o a un corte.
- **Las zonas de cercos,** igual: sin anclaje, de 0,5 m como mínimo y uniéndose hasta el doble de lo que cubren (`HOLGURA_UNION_CERCOS`: cuestan poco acero). La segunda pasada (tras los refuerzos) rehace las de su dirección con todo lo que ha pedido cercos, en lugar de añadir trozos sueltos.

**Lo que cambia** (`validacion/co/out_cambiosDespiece.txt`; las referencias congeladas de CO3 y CO4, regeneradas a sabiendas):

| Losa | Refuerzos | El más corto | Lo que cubren | Zonas de cercos |
|---|---|---|---|---|
| vivienda, L-CUB | 13 → 11 | 0,02 → 1,75 m | 138 → 214 m² | 10 → 9 |
| vivienda, L-CUB-S | 17 → 14 | 0,15 → 1,70 m | 105 → 175 m² | 15 → 12 |
| losa plana con sismo | 8 → 6 | 0,25 → 1,75 m | 11 → 25 m² | — |
| losa reticular | 16 → 14 | 0,15 → 2,05 m | 244 → 399 m² | 24 → 24 |

- Las bases, lo que cumple y los peores aprovechamientos no cambian (L-CUB sigue sin cumplir por el cortante junto a P2, 1,003).
- **El acero de los refuerzos sube:** en la vivienda, de 494 a 708 kg en L-CUB y de 239 a 402 kg en L-CUB-S (estimado con el intereje, sin patillas). Una parte es el anclaje, que antes no estaba y sin el que el refuerzo no se podía poner en obra; otra, el ábaco entero y las uniones; y en L-CUB-S, un Ø25 por nervio donde antes bastaba un Ø20, porque la zona de cercos de al lado, ahora de 0,5 m, cubre la estación que manda y le baja el canto útil.
- En el punzonamiento sólo cambia la cuantía de la losa sobre algunos pilares (ρl,mín/ρl baja y vEd/vRd,c baja hasta un 3 %): ninguna unión cambia de estado.

**Las cotas en la planta** (`cotasRefuerzo` en `dibujoArmado.ts`, `referenciasRefuerzo` en `armadoPlanta.ts`). Cada refuerzo se acota a lo largo de sus barras respecto a los pilares de su ancho (su punto, con 0,30 m de holgura) y a los ejes de las vigas que lo cruzan: si alguno cae dentro, por tramos desde él (un refuerzo superior sobre un pilar: «1,00 | 1,00»); si no, de cada punta al más cercano, hasta 2 m (un refuerzo de vano: lo que le falta hasta el eje del apoyo). Con más de tres dentro no se acota por tramos (se lee su largo).

**Lo que se ve.** El selector de la planta de losas es ahora «Se ve: Todo | Inferior | Superior | Cercos»: con una cara, sin los cercos; con «Cercos», sólo ellos.

**Con el ratón** (`src/editor/refuerzosPlanta.ts`, puro; `app/src/dibujo/refuerzos.ts`, el adaptador de la vista):

- **Estirar y mover:** con un refuerzo o una zona de cercos elegido, su zona se pinta con cinco asas: la del medio de cada lado lo estira y la del centro lo mueve entero. Un clic en un asa la coge y el clic siguiente la deja; arrastrarla, también. Lo que cambia va a 5 cm y ningún lado baja de 10 cm. Mientras, se ve la zona que quedaría con sus medidas.
- **Añadir:** «Añadir…» en la barra (refuerzo X o Y, inferior o superior; en un reticular, de los nervios o de los ábacos; o cercos de nervios X o Y) y dos clics en la planta, o una ventana: las esquinas opuestas de la zona, en la losa que hay debajo. Entra con Ø12 (uno por nervio o cada 200 mm) o cercos Ø6/150, elegido, para cambiarle las barras en la ficha.
- **Quitar:** Supr con uno elegido (o su × en la ficha). Tras quitar uno, lo elegido es la losa: los de detrás cambian de número.
- Esc suelta lo que se tiene a medias y, después, la herramienta de añadir. Cada cambio es un paso de deshacer y vuelve a comprobar la losa.

**Validación:** `armar/despiece.test.ts` (alargar, el mínimo, el borde de la losa, unir, cortar, y 200 casos al azar: deterministas, sin pisarse y con cada zona cubierta), `losas.test.ts` (lo propuesto en una maciza y en un reticular: ninguno corto, ninguno pisa a otro, las puntas al módulo y uno por ábaco; sigue cumpliendo, y con un puesto menos, no), `refuerzosPlanta.test.ts`, `dibujoArmado.test.ts` (las cotas), `src/visor/comprobaciones.test.ts` (lo que se ve), `app/src/test/refuerzos.test.ts` (el adaptador: coger y dejar un asa, arrastrar, añadir con dos clics y con una ventana, soltar) y `comprobacion.test.tsx` (Supr, «Añadir» y Esc). A mano, en la app, con la vivienda: estirar un refuerzo, añadir uno y quitarlo. Los bancos de Chrome no se han pasado.

**Hallazgos:**

- **CO6-8:** quitar un refuerzo con su × dejaba elegido el siguiente (los de detrás cambian de número). Ahora lo elegido pasa a ser la losa.
- **CO6-9:** las filas de la ficha de una losa repetían clave (varias filas con el mismo id, una por grupo de sección) y React lo avisaba miles de veces. Corregido.
- **CO6-10:** el refuerzo de una zona es el mismo en toda ella, el que pide su peor estación. Con zonas mayores (unidas, con anclaje) eso cuesta más acero: en L-CUB, una zona de vano de 8,1 × 11,5 m lleva un Ø25 por nervio entera. Escalonar el refuerzo dentro de una zona es lo siguiente que ahorraría acero.

**Decisiones, de Claude, por confirmar por el usuario (CO6-g):** el decalaje igual al canto de la losa; el mínimo de 1 m (0,5 m en los cercos); unir hasta 1,2 veces lo que cubren (2 en los cercos); en los ábacos, el ábaco entero; cortar sin solape los que se pisan; 5 cm.

**No hecho:** partir un refuerzo en dos con el ratón; enganchar las asas a los nervios, a los ábacos o a las caras de las vigas (van a 5 cm); los solapes y las patillas.

### 8.13 CO6, el despiece de las vigas por pórtico (2026-11-22)

Lo segundo de las mejoras visuales que eligió el usuario. El cálculo, las comprobaciones y lo que propone `fem armar` no cambian: el despiece sólo coloca el armado que ya hay.

**Los pórticos (`src/comprobaciones/porticos.ts`).** Un pórtico es una alineación de vigas de una planta.

- Dos vigas se siguen si acaban en el mismo punto (a 5 cm) o en el mismo pilar (hasta 0,6 m desplazadas, enrasadas a caras distintas) y su dirección cambia menos de 10°. Si hay varias candidatas, la más alineada.
- Cada viga está en un pórtico y sólo en uno; las que cruzan no se encadenan.
- Va de izquierda a derecha en planta (de abajo arriba, si es según Y). Una viga dibujada en el otro sentido va `invertida`: lo de su inicio queda a la derecha.
- Sus apoyos y sus vanos son los de `Consultas.viga` (las caras de los apoyos), en una sola coordenada a lo largo. Una viga en polilínea con un quiebro se dibuja estirada, con una marca en el quiebro.
- La misma alineación dibujada en una viga o en tres, una al revés, da el mismo pórtico (a 1e-9).

**El despiece (`despieceVigas.ts`, `despiecePortico`; reglas CO6-h).** Del armado de cada vano (una armadura por cara y por zona) salen las barras una a una. Las reglas sólo alargan las barras más allá de donde la comprobación cuenta con ellas:

- **Inferior** (y la de piel): de cara a cara de los apoyos del vano, más su anclaje en cada uno.
- **Superior corrida:** pasa de un vano al siguiente si es la misma (n y Ø) y la barra no pasa de 12 m; si no, se ancla más allá de la cara. Donde la zona de un apoyo lleva otro diámetro, es sólo el montaje del centro y empieza un anclaje antes del fin de esa zona.
- **Superior de un apoyo:** lo que la zona (el cuarto de la luz) tiene de más sobre la corrida, o toda si es de otro diámetro. Cubre la zona y sigue el decalaje (z·cot θ/2, con z = 0,9·d y cot θ = 2, el del cortante) más su anclaje. Con vano a los dos lados, lo común pasa de uno a otro y lo que un lado tiene de más se ancla más allá de su cara. Dos iguales de zonas distintas que se pisan (un vano corto) son una.
- **El anclaje:** el básico a fyd (`lb,rqd`, CE A19 §8.4.3, con `computeAnchorage` del módulo de forjados), al alza a 5 cm. La cara superior de un canto de más de 25 cm, en adherencia deficiente (÷ 0,7).
- **En un apoyo extremo:** recta si cabe hasta el recubrimiento de su cara de fuera; si no, hasta ahí y una patilla, la mayor de 0,7·lb menos lo recto y 10 Ø. Si la patilla no cabe en el canto, se avisa.
- **Los cercos,** donde los pone `alzadoVano` (el primero a 5 cm de la cara), contados por tramos del mismo cerco, con su desarrollo estimado (el cerco, otro por cada par de ramas de más, una horquilla por la impar y dos ganchos de 10 Ø).
- **La medición:** una fila por barra y por tramo de cercos (n, Ø, largo, total y kg, a 7 850 kg/m³) y el acero por diámetro. El largo es lo recto más las patillas, sin descontar los doblados.

**En la app** (`app/src/editor/DespiecePortico.tsx`; pedido `portico` del worker, que no depende del armado).

- Con una viga elegida en Resultados · Comprobación, la pestaña «Pórtico» de abajo (o «Ver el pórtico» en la ficha) dibuja su alineación entera: los apoyos y los vanos a escala a lo largo, con el nombre y el aprovechamiento de cada vano.
- Cada barra, en su sitio (fina) y sacada a su fila con su marca, sus patillas y «nØ L=»; las superiores, arriba (en rojo) y las inferiores, abajo (en azul). Las de apoyo llevan debajo lo que sale a cada lado del eje de su apoyo.
- Los cercos, en su sitio y contados por tramos («25cØ6/150 (3R)»); las luces entre caras y el ancho de cada apoyo, acotados.
- Las secciones del vano elegido (junto a cada apoyo y en el centro, en el sentido del pórtico) y la tabla de despiece con el acero.
- Sigue a lo que se escribe en la ficha del vano elegido, sin aplicarlo; el campo con el foco resalta sus barras, y lo de los demás vanos va atenuado. Un clic en otro vano lo elige.

**Medido** (`validacion/co/medirPorticos.ts`, `out_medirPorticos.txt`, con el armado propuesto):

| | Vigas | Pórticos | Barras | De más de 12 m | Acero en vigas |
|---|---|---|---|---|---|
| Vivienda | 18 | 17 | 52 | 0 | 708,7 kg |
| Pórtico de las pruebas de las vigas | 10 | 10 | 50 | 0 | 652,8 kg |

En la vivienda sólo se encadenan VPG-2 y Z-CUB-S-2 (14,10 m, cuatro vanos); encadenar todas las vigas tarda 7 ms.

**Validación.**

- `porticos.test.ts`: cada viga en un pórtico, los apoyos y los vanos de `Consultas.viga`, la alineación partida en tres con una al revés y girada 90°, y los anclajes contra la fórmula.
- `despieceVigas.test.ts`: cada regla con sus números a mano sobre un pórtico de dos vanos y un voladizo, y 300 armados al azar en los que cada zona tiene al menos el acero de su armado, la inferior cubre el vano entero, nada sale del pórtico y ninguna barra pasa de 12 m.
- `src/visor/comprobaciones.test.ts`: el pedido `portico` es `porticoDe` y `datosDespiece`.
- `app/src/test/despiecePortico.test.tsx` y `comprobacion.test.tsx`: lo dibujado es lo de `despiecePortico`, sigue al borrador y un clic cambia de vano.
- A mano en la app con la vivienda. Los bancos de Chrome no se han pasado.

**Hallazgos.**

- **CO6-11:** con las zonas fijas de un cuarto de la luz (CO2-a), las superiores de los apoyos salen largas. Un 4Ø16 sobre un pilar en un vano de 3 m (HA-30, canto 30) llega a 1,95 m del eje: el cuarto de la luz (75 cm), 23 cm de decalaje y 82 cm de anclaje. Cortarlas por la envolvente de momentos las acortaría.
- **CO6-12:** en una viga plana de 30, la patilla de un Ø16 en un apoyo de 30 pide 35 cm y caben 24: se avisa (en la vivienda, una vez).
- **CO6-13:** cuando una viga apoya en otra, su apoyo se llama como esa viga, y la barra se ancla en su ancho como en un pilar.

**Decisiones, de Claude, por confirmar por el usuario (CO6-h):** el anclaje básico entero (sin reducirlo por el acero que sobra) y a 5 cm; el decalaje con cot θ = 2; la inferior anclada entera también en los apoyos interiores (la norma pide allí 10 Ø, pero con el sismo esa cara puede traccionar); la patilla; la corrida pasante hasta 12 m; lo común que pasa sobre el apoyo; y, para encadenar, 10°, 5 cm y 0,6 m.

**No hecho:** cortar las barras por la envolvente de momentos (CO6-11); los solapes de una barra de más de 12 m (se avisa); dos capas; mover una barra con el ratón; el despiece en `fem` (hoy sólo está en la app); y los planos.

### 8.14 CO6 y CO1-f: Comprobación como espacio propio, el armado propuesto solo, las tres zonas de cercos de los pilares y los esfuerzos con el armado (2026-11-23)

De la primera prueba de uso de Resultados · Comprobación por el usuario (con la vivienda). Lo que pidió y lo que se ha hecho:

**Comprobación, espacio propio.** Deja de ser un modo de Resultados: es una pestaña de la barra superior (Modelo, Cargas, Resultados, Comprobación, Revisión), con su barra de herramientas (Pilares, Vigas, Losas y Punzonamiento como herramientas). La dirección antigua (`?espacio=resultados&modo=comprobacion`) lleva a él.

**El armado viene propuesto** (antes había que pulsar «Proponer»). Al llegar la tabla de un tipo con partes sin armado, el programa pide lo que falta en toda la obra (`armar` con `soloSinArmado`, los cuatro tipos) y lo escribe con la operación `armado`: un paso de deshacer. Una vez por cálculo (por huella) y sesión de la página: deshecho, no vuelve solo (están los botones). Si no cambia nada, no escribe. `ModoComprobacion` lleva `automatico` (por defecto, sí) para las pruebas de lo demás.

**El banco de armado.** El formulario del armado sale de Propiedades (estaba apretado en 360 px) al panel de abajo, en la pestaña «Armado»: a un lado el dibujo a escala de la pieza y al otro su formulario, con «Aplicar», «Proponer» y «Quitar». En una losa, la base, los ábacos, los refuerzos y los cercos van en columnas. Lo abre elegir una pieza en la planta, el doble clic en una fila de la tabla o «Editar el armado» de Propiedades, que se queda con el estado, las filas del módulo y los datos. Con una viga, el dibujo del banco es el despiece de su pórtico (§8.13: ya no es una pestaña aparte). Fuera «Ampliar el dibujo».

**Los cercos de los nervios, como puntos.** En la planta de las losas, cada cerco es un punto sobre el eje de cada nervio de su zona (`puntosCercos`, con los ejes de `nerviosLosa`; el primero, a media separación del principio); el contorno de la zona, a trazos. El rótulo lleva siempre las ramas («cØ6/150 (2R)»), y el campo «ramas» del formulario enseña en gris lo que vale vacío (2).

**CO1-f, los pilares en tres secciones y con tres zonas de cercos.**

- **Datos:** `armado.pilares.<pilar>.<planta>` gana `cercosPie` y `cercosCabeza` (opcionales); `cercos` son los del centro del tramo y, donde no se dan los de un extremo, también los de ese extremo. Los armados de antes valen igual.
- **Demandas:** `Consultas.pilar` da además la sección central del tramo flexible (`centro`), con los esfuerzos de cada caso a media altura (en los modos, interpolados entre los extremos de su barra: no tienen cargas a lo largo). `DemandasTramo.centro`.
- **Comprobar** (`comprobarTramo`): base, centro y cabeza, cada una con los cercos de su zona. En el centro, el cortante con todas sus demandas; el módulo, una vez (las reglas de sus cercos) y con las demandas cuyo momento pase del de los dos extremos (cargas a lo largo del pilar): sin ellas el diagrama es lineal y la flexión del centro queda cubierta por la de los extremos. La fila de la zona densificada del módulo (`stirrup-densification`, §9.5.3(4)) es sólo de los extremos.
- **Las zonas** (`zonasCercosPilar`, `dibujoArmado.ts`): junto a cada nudo, la mayor dimensión de la sección (§9.5.3(4)); junto al pie, además el solape de las barras si son de más de 14 mm (1,5·lb,rqd, `solapesPilar`). Al módulo de 5 cm. Con menos de 30 cm de centro, el tramo no tiene zona central (los tramos cortos entre cubiertas).
- **Proponer** (`aflojarCentro`): elegido el armado y aplicadas las reglas de obra (con cercos uniformes, como antes), los cercos de la tabla se quedan junto al pie y junto a la cabeza y el centro lleva la separación más abierta de 300, 250, 200, 180, 150 o 125 mm que no pasa de mín(15·Ø, la menor dimensión, 300) con la que todo sigue cumpliendo. Opción `zonasCercos: false`, lo de antes.
- **Lo que cambia** (`validacion/co/cambiosZonas.ts`, `out_cambiosZonas.txt`; referencia de CO1 regenerada a sabiendas): el armado longitudinal, lo que cumple y las filas que no son de cercos ni de cortante, idénticos (diferencia 0). En la vivienda, 23 de 36 tramos pasan de cØ6/100 a cØ6/180 con /100 en pie y cabeza (los otros 13 son tramos cortos); un tramo de 3,10 m, de 31 cercos a 20. En el edificio con viento, los 27; con sismo y mucha carga, 4 de 13 (en los demás el cortante del centro no deja abrirlos).
- **Dibujo:** junto a la sección, el tramo en alzado entre las caras de sus nudos, con cada cerco en su sitio (`alzadoPilar`) y cada zona acotada y rotulada con sus cercos contados.

**Los esfuerzos, con el armado** (pedidos `esfuerzos-portico` y `esfuerzos-pilar` del worker, con el banco abierto): las envolventes de las situaciones de ELU, que son las de `envolventePieza` (las de Resultados · Diagramas) en la coordenada del dibujo.

- **Pórtico:** bajo el despiece y a su misma escala, la envolvente de M (lo positivo, hacia abajo y en el azul de la inferior; lo negativo, en el rojo de la superior) con el pico de cada tramo, y la de V al marcarla. Una viga dibujada al revés va en el sentido del pórtico, con su cortante cambiado de signo.
- **Pilar:** junto al alzado del tramo y a su misma altura, las de N, My y Mz, con el mínimo y el máximo en el pie y en la cabeza.

**Validación.**

- `comprobar/pilares.test.ts`: la identidad con el módulo llamado a mano (ahora con la llamada del centro) y la prueba nueva de las tres secciones (cada fila es la peor de las tres, cada una con sus cercos).
- `armar/pilares.test.ts`: con zonas y sin ellas, el mismo armado longitudinal y los mismos cercos en los extremos; el centro, el más abierto que cumple; comprobado como armado del proyecto da lo mismo.
- `dibujoArmado.test.ts`: las zonas, el alzado con cada cerco y los puntos de los cercos de los nervios.
- `src/visor/comprobaciones.test.ts`: la geometría del tramo y los dos pedidos de esfuerzos, punto a punto con el pedido `viga`.
- `app/src/test/comprobacion.test.tsx`: la propuesta automática (una vez por cálculo), el banco, el alzado del pilar con sus esfuerzos y la envolvente bajo el pórtico.
- A mano en la app con la vivienda. Los bancos de Chrome no se han pasado; el de CO6 (`validacion/co6/chrome.ts`) está sin adaptar a la pestaña nueva ni a la propuesta automática.

**Lo que no se ha hecho de lo que pidió el usuario.**

- **La losa de cimentación sin refuerzos y con la base «grande».** No es que el programa intente cubrirlo todo con la base: la base es la cuantía mínima del módulo (CE A19 §9.2.1.1, ec. 9.1: As,mín = W/(0,8·h)·fctm,fl/fyd) donde la cara tracciona, que en una losa de 60 cm de HA-30 son 833 mm²/m por cara y dirección: Ø12/125. Con ella todo cumple al 0,56 y no hace falta ningún refuerzo. Lo que suele hacerse (la nota de §9.2.1.1(1): 1,2 veces lo que pide el ELU, con la mínima geométrica por debajo) daría una base menor con refuerzos, pero es cambiar una regla de la norma en el adaptador: **lo decide el usuario** (CO3-k). **Decidido y hecho el mismo día, como opción de la obra: §8.15.**
- **Las vigas ya se comprueban en tres zonas** (los cuartos de la luz junto a los apoyos y el centro, CO2-a), con `superiorInicio`, `superiorFin`, `cercosInicio` y `cercosFin`. Lo que pasa es que la propuesta no abre los cercos del centro como ahora en los pilares: por hacer (CO2-i).
- El cuadro de pilares, el armado en el 3D y los planos.

**Decisiones, de Claude, por confirmar por el usuario.**

- **CO1-f:** las zonas (la mayor dimensión; el solape en el pie con Ø > 14, con α6 = 1,5), el centro mínimo de 30 cm, las separaciones del centro y que la flexión del centro sólo se compruebe con cargas a lo largo del pilar.
- **CO6-i:** la propuesta automática al entrar (una vez por cálculo; escribe en el proyecto, deshacible). En un edificio grande tarda lo que «Toda la obra» (un minuto o más en el edificio objetivo con sismo), con el worker ocupado.
- **CO6-j:** el formulario, en el panel de abajo y no en un diálogo aparte; un clic en la tabla elige y el doble clic abre el armado.

### 8.15 CO3-k: la armadura mínima reducida de las losas de cimentación, como opción de la obra (2026-11-23)

Decidido por el usuario («Sí, como opción») tras ver que su losa de cimentación de 60 cm salía con la base Ø12/125 y sin refuerzos (§8.14). Por defecto, nada cambia.

**El dato:** `obra.armado.minimaReducidaCimentacion` (`true` o `false`; por defecto, no). Fuera de la huella: no cambia el cálculo.

**La regla** (`comprobar/losas.ts`). Sólo en una losa de cimentación y sólo en las secciones que no llegan a la armadura mínima del módulo (CE A19 §9.2.1.1, ec. 9.1). Allí, la fila `as-min` del módulo se sustituye por las dos de la alternativa del mismo apartado (la que el módulo de Concreta deja al proyectista, `cuantiaMinima.ts`):

- **`as-min`, el suelo geométrico:** As ≥ 0,9 ‰ de la sección bruta por cara y dirección con B500 (1,0 ‰ con menos): la mitad de la cuantía geométrica de las losas de la tabla 42.3.5 de la EHE-08, que el CE ya no trae. Es una regla de armado: la cumple la base.
- **`as-min-elu`:** As ≥ 1,2 veces la necesaria en ELU, comprobada como 1,2·MEd ≤ MRd. Del lado seguro: MRd es cóncavo en As, así que la armadura necesaria no pasa de As·MEd/MRd. Depende de la demanda, como la flexión: lleva la franja, la estación y la combinación de su momento.

Donde la sección sí llega a la mínima del módulo, sus filas son las de siempre.

**Proponer** (`armar/losas.ts`). La fila `as-min-elu` cuenta como demanda: la base es la primera de la tabla que cumple el suelo (y las demás reglas), y donde 1,2·MEd pasa de MRd van refuerzos, como donde no llega la flexión (`estacionesQueFallan`).

**Medido** (`validacion/co/medirMinimaReducida.ts`, `out_medirMinimaReducida.txt`): una losa de cimentación de 13 × 13 m bajo la losa plana de 3 × 3 pilares a 6 m, HA-25.

| | Sin la opción | Con la opción |
|---|---|---|
| 60 cm, cargas de vivienda | base Ø12/150, 1 refuerzo, 4 004 kg | base Ø12/200, 4 refuerzos, 3 016 kg (−25 %) |
| 60 cm, muy cargada (CM 12, Q 20) | base Ø12/150, 6 refuerzos, 4 524 kg | base Ø12/200, 14 refuerzos, 4 591 kg (+1,5 %) |
| 80 cm, muy cargada | base Ø16/200, 6 refuerzos, 5 387 kg | base Ø12/150, 6 refuerzos, 4 250 kg (−21 %) |

En la de 60 cm muy cargada no cumple el cortante con ninguna de las dos (la sección no basta); con mucha carga, la base menor se compensa con refuerzos y el acero no baja.

**En la app.** En el banco de armado de una losa de cimentación, la casilla «Armadura mínima reducida en las losas de cimentación de la obra», con lo que es y a quién le toca decidirlo; marcada, «Proponer» da la base menor. La escribe la operación `obra`.

**Los datos de armado de la obra, en cada pedido.** Cambiar un dato de la obra reabría el proyecto en el worker y daba los resultados por desactualizados. Ahora `obra.armado` va con los pedidos de comprobación (`datos`, en `comprobaciones`, `comprobacion`, `portico`, `armar` y la vista `comprobacion`; `Sesion.datosArmado`), como el armado, y no reabre nada (`soloFueraDelWorker`). Lo ya comprobado se guarda por armado y por esos datos.

**Aviso** `comprobacion/minima-reducida` (info), con las losas de cimentación a las que se aplica. La skill lo explica y prohíbe al agente activarla por su cuenta.

**Validación.**

- `losas.test.ts`: fuera de una losa de cimentación, o con un armado que ya llega a la mínima del módulo, las mismas filas; con la opción, la base es la primera que llega al suelo, las filas `as-min-elu` son 1,2 veces la flexión de su mismo grupo y todo cumple; lo propuesto con la opción no cumple sin ella (le falta la mínima del módulo); una base bajo el suelo falla, y las estaciones que piden refuerzo son más que las de la flexión sola.
- `src/visor/comprobaciones.test.ts`: los datos en el pedido rehacen lo comprobado sin reabrir.
- `app/src/test/armado.test.tsx`: los datos de armado de la obra no reabren el proyecto; lo demás de la obra, sí.
- A mano en la app, con una obra con losa de cimentación: la casilla, «Proponer» (de Ø12/150 con 1 refuerzo a Ø12/200 con 4) y el estado, que sigue en «Calculado».

**Por confirmar por el usuario (CO3-k):** el suelo (0,9 ‰; con B400, 1,0 ‰) y que la opción sea de toda la obra y sólo de las losas de cimentación (no de las zapatas ni de las demás losas).

### 8.16 CO6: lo que pasa al proponer, las hipótesis, el punzonamiento de los pilares de borde, los nervios y las losas en 3D (2026-11-23)

De la segunda prueba de uso de Comprobación con la vivienda. El cálculo, las comprobaciones y lo que se propone no cambian.

**El parpadeo de la vista al proponer.** «Proponiendo…» aparecía en la barra de herramientas mientras se proponía: con la barra llena, el grupo cambiaba de ancho, la barra se recolocaba y la zona de vistas cambiaba de tamaño. «Proponer armado» sale de la barra (el armado viene propuesto solo, §8.14) y va encima de la tabla de Comprobaciones, con el «Proponiendo…» reservado en su sitio. Medido en Chrome: al proponer, los lienzos no cambian de tamaño; sólo la leyenda y Propiedades.

**«Proponer» en una pieza dice lo que ha hecho.** Si lo propuesto es lo que ya tenía, no se escribe nada (ni un paso de deshacer) y el banco dice por qué: en el punzonamiento, «No hace falta armadura de punzonamiento: P11 cumple sin ella (vEd/vRd,c = 0,86 ≤ 1)»; si no hay propuesta, el motivo. Si cambia, «Armado propuesto en …».

**Las comprobaciones, en el banco.** Bajo el armado de la pieza, sus filas (las que no cumplen primero), lo que no se comprueba y, en el punzonamiento, las **hipótesis de partida** (`FichaComprobacion.hipotesis`, de `comprobaciones/punzonamiento.ts`, con los números de la cara que manda): la demanda (lo que la losa pasa por su huella, la combinación y VEd; lo de las vigas no cuenta), la cara que tracciona y el área cargada, la posición y por qué (las distancias de cada cara al borde frente a c∥/2 + π·d), d y de dónde sale, u1 a 2·d (y el eficaz), β de la fórmula general, la armadura de flexión que cuenta (en el ancho del pilar más 3·d), el ábaco en un reticular, el terreno en una de cimentación y si hace falta armadura (vEd frente a vRd,c). También en Propiedades.

**Los pilares de borde y de esquina en el punzonamiento.** Con zunchos de borde por su eje (lo corriente, como en la vivienda), la losa no les pasa nada por su huella (CO4-3) y no salían en ninguna parte: un clic en su ábaco no daba nada. Ahora:

- `demandasPunzonamiento` da también `sinUnion`: cada pilar cuyo centro cae en una losa maciza o reticular de la planta (o en el ancho de una de sus vigas) sin unión por su huella, con las vigas en cuyo ancho cae y el motivo. `comprobarPunzonamientos` lo pasa con el canto útil del armado de la losa junto al pilar (o, sin armado, el canto menos el recubrimiento y un Ø12), y `fem comprobar` lo da en `punzonamientoSinComprobar`.
- En la app son partes «No se comprueba» (`origen: "no-aplica"`, gris): no cuentan en el resumen, la ficha y el banco dicen por qué (lo que les llega es el cortante de esas vigas, que se comprueba en Vigas, y el de la losa junto a ellos, con sus franjas en la cara de las vigas, en Losas) y la planta dibuja su perímetro crítico a puntos, a 2·d, sólo como referencia (estilo `armado-critico-sin`).
- **Un clic en un ábaco es un clic en su pilar** (`abacosDePilares`), también si el centro del pilar cae justo en el contorno del ábaco (los de borde y de esquina: a 1 cm).

En la vivienda: 12 uniones comprobadas y 15 que no se comprueban (P1, P7, P10, P14, P18, P22 y P23 en CUB; P4, P17, P20 y P21 en CUB-S; P15 y P19 en las dos), todas por los zunchos o las vigas en cuyo ancho caen.

**Los nervios del reticular, en la planta de Losas.** Los ejes de los nervios en la zona aligerada (`nerviosLosa`, por su punto de paso; estilo `armado-nervio`), bajo los refuerzos y los cercos: se ve qué nervios lleva cada refuerzo por nervio.

**El armado de las losas en el 3D** (`src/visor/armadoLosas3d.ts`, pedido `armado-losas-3d`): con Losas y «Armado», la vista 3D dibuja cada refuerzo barra a barra en la cota de su cara (a un recubrimiento de la cara de arriba o de la de abajo; los superiores en rojo y los inferiores en azul) y el contorno de lo que cubre, recortado con la losa. Una armadura por separación, una barra cada separación; una por nervio, una barra en el eje de cada nervio paralelo a ella. La cara de arriba es la cota de la planta más el desnivel, como el sólido. Va con la estructura de los diagramas del 3D, sobre el modelo en alámbrico; la base no se dibuja.

**Validación:** `src/visor/comprobaciones.test.ts` (los pilares sin unión son los de `transmitidoPilar` nulo, con su motivo, su d y sus hipótesis; las uniones comprobadas traen las suyas; en la planta del punzonamiento ningún ábaco se queda sin su pilar; el 3D, con los superiores por encima de los inferiores y una sola cara si se pide) y los tests de DOM de la app; a mano en la app con la vivienda (Chrome: el clic en un ábaco de borde, «Proponer» en P11, el 3D de las losas, los nervios). Los bancos de Chrome no se han pasado.

### 8.17 CO6: el banco de armado rehecho, los esfuerzos con su combinación y el armado de las losas en tablas (2026-11-23)

De la tercera prueba de uso de Comprobación con la vivienda. El cálculo, las comprobaciones y lo que se propone no cambian.

**El banco, a lo ancho.** Antes, el dibujo a un lado y, en una columna de 390 px, el formulario con las comprobaciones debajo: con la pantalla ancha quedaba medio panel vacío. Ahora:

- arriba, una cabecera fija con la pieza, su estado, su armado en una línea y «Aplicar», «Proponer» y «Quitar» (con «Cambios sin aplicar» si los hay);
- debajo, tres columnas: el dibujo, el armado y las comprobaciones; con sitio (más de 1500 px), cada una se desplaza por su cuenta, así que el dibujo sigue a la vista al bajar por las comprobaciones; con menos, las comprobaciones pasan debajo a todo el ancho;
- en una viga, el despiece del pórtico a la izquierda con las comprobaciones y los esfuerzos del vano debajo, y el formulario a la derecha;
- **las comprobaciones, en una tabla ancha:** la comprobación con su artículo, dónde, la combinación y el aprovechamiento con su barra; la que manda, marcada.

**De qué combinación salen los esfuerzos de un pilar.** `esfuerzos-pilar` da además las `ternas` del tramo (las de `fem consultar pieza`): bajo las envolventes, en la cabeza y en el pie, la combinación del N mínimo, del N máximo y de los mayores |My| y |Mz|, cada una con sus N, Vy, Vz, My y Mz concomitantes (con «±», los signos pésimos del sismo).

**El torsor y el axil de las vigas.** `esfuerzos-portico` da también las envolventes de T y de N (dos casillas más bajo el despiece; en una viga invertida, T cambia de signo como V), los extremos de cada vano con su combinación (`vanos`) y las vigas cuyo axil no tiene valor (`axilSinValor`: van en un diafragma rígido). El banco dice en una línea el mayor |T| con su combinación y el axil, y da la tabla de los extremos del vano (My máx., My mín., Vz y T) con N, Vz, T y My de cada uno.

**El armado de una losa, en tablas** (antes, una rejilla de tarjetas con 8 grupos, 14 refuerzos y 12 zonas de cercos): la armadura base en una tabla (una fila por dirección, de los nervios y de los ábacos; la inferior y la superior, en columnas) y, a su lado, los refuerzos o los cercos de los nervios en dos pestañas, una fila cada uno (número, armadura, zona, barras y «×»). Los refuerzos van por cara y dirección, con un filtro (todos, inferiores, superiores); el elegido en la planta abre su pestaña.

**La vista con el panel grande.** El panel de abajo no pasa de dejar unos 300 px a las vistas (antes, 260 px contando las barras: quedaban ~140 y la planta no se leía), también con un alto guardado con la ventana más grande (`max-height`). Vale para todos los espacios.

**El pilar elegido en la planta.** Las barras y el cerco dibujados en su huella iban con el `objeto` del pilar: elegido, cada barra llevaba su halo y se pisaban. Ahora sólo lo llevan la huella y los rótulos.

**Validación:** `src/visor/comprobaciones.test.ts` (las ternas son de la envolvente del tramo y su N mínimo y máximo, los de ella; T y N en el pórtico y los extremos de cada vano con sus seis esfuerzos; las marcas de las barras, sin objeto) y `app/src/test/comprobacion.test.tsx` (las columnas de la tabla ancha, las ocho ternas, la tabla de la base, los esfuerzos del vano y las cuatro casillas); a mano en la app con la vivienda. Los bancos de Chrome no se han pasado.

### 8.18 CO6: los refuerzos sobre sus nervios, los casetones de fondo y los dibujos del pórtico y del pilar (2026-11-23)

De la cuarta prueba de uso de Comprobación con la vivienda: en la planta de las losas, los refuerzos «no coinciden con los nervios» (una barra por el medio de su zona, que con un número par de nervios cae en un casetón, y un rectángulo con los bordes a mitad de casetón), y los dibujos del pórtico y del pilar «no se ven profesionales». El cálculo, las comprobaciones y lo que se propone no cambian: sólo cómo se dibuja.

**La planta de las losas** (`src/visor/armadoPlanta.ts`):

- **los casetones, de fondo** (`casetonesLosa` en `src/compilador/abacos.ts`: la retícula del sólido, recortada con la losa y sin los que tocan un ábaco, una viga o un pilar), en lugar de los ejes de los nervios: los nervios son lo que queda entre ellos. Se apagan con «Casetones: Sí | No» en la barra (`reticula: false` en la vista);
- **un refuerzo por nervio, con una barra sobre el eje de cada nervio que arma** (`nerviosDeRefuerzo`: los ejes de `reticulaLosa` que caen en su ancho), unidas por la línea de reparto con un punto en cada nervio; sin el rectángulo de su zona, que era lo que no casaba con la retícula. El rótulo dice cuántos nervios: «3 nervios · 2Ø12 por nervio · 5,11 m», y va, con las cotas, sobre el nervio más cercano al medio;
- los refuerzos a una separación (una maciza, la parrilla de un ábaco) y uno por nervio que no cubre ninguno (dibujado a mano en un casetón) siguen como antes: la zona, una barra y la línea de reparto.

**El despiece del pórtico** (`app/src/editor/DespiecePortico.tsx`):

- el eje de cada apoyo, de arriba abajo, une el alzado, las barras, las cotas y las envolventes;
- **las envolventes, continuas:** los tramos se unen en una curva (antes, cada tramo cerraba en la cara de su apoyo y quedaba un hueco del ancho del pilar), con la escala según lo que hay a cada lado del cero (un esfuerzo de un solo signo ya no gasta media banda), cada banda en su recuadro y su título con las combinaciones aparte;
- **los picos, sin pisarse:** de mayor a menor, uno no se rotula si pisa a otro mayor (los dos lados de un apoyo daban «−23 29» encimados); cada uno, con su punto;
- **bajo el cursor,** la sección del pórtico: una línea de arriba abajo, su x y, en cada banda, el mínimo y el máximo de la envolvente en ella (interpolados).

**El croquis del pilar** (`app/src/editor/CroquisArmado.tsx`; la sección, también la de las vigas):

- las cotas de la sección, con su línea y sus topes («h = 30», «b = 30»);
- los esfuerzos del tramo: la escala va de lo menor a lo mayor con el cero dentro (antes, simétrica: el axil, siempre de compresión, ocupaba media banda), con la línea del cero, los niveles de la cabeza y del pie, la banda entre el mínimo y el máximo, lo que hay hasta el cero más suave y un punto en cada extremo.

**Validación:** `src/compilador/nervios.test.ts` (los casetones caen en la losa, fuera de los ábacos y de lo macizo, y ningún eje de nervio los atraviesa), `src/comprobaciones/dibujoArmado.test.ts` (los nervios de un refuerzo) y, a mano en la app con la vivienda, la planta de las losas con y sin casetones, el pórtico de Z-CUB-S-2 con sus cuatro envolventes y el cursor, y el tramo de P8. `validacion/co6/planta.ts` saca la planta con el armado a PNG desde Node. Los bancos de Chrome no se han pasado.

**No hecho:** el 3D de las losas sigue como estaba. El enganche de los lados a la retícula al editar con el ratón, en §8.19.

### 8.19 CO6: lo que va por nervios, enganchado a los nervios al editarlo con el ratón (2026-11-23)

Lo que quedaba de §8.18: al estirar, mover o añadir en la planta un refuerzo por nervio o unos cercos de nervios, sus lados transversales iban a 5 cm, así que una zona podía acabar en cualquier punto de un casetón. El cálculo y lo que se propone no cambian.

- **Los lindes** (`lindesNervios` en `src/editor/refuerzosPlanta.ts`): el punto medio entre cada dos ejes de nervio seguidos (la mitad del casetón, que es donde acaban las franjas de armado de un reticular y las zonas que se proponen) y los bordes de la losa (la coordenada transversal de los vértices de su contorno): lo que llega al borde acaba en él. Entre dos lindes seguidos de la retícula hay un nervio.
- **A quién se aplica** (`porNervios`): a un refuerzo de n barras por nervio que no es de los ábacos y a los cercos de los nervios. Los de una maciza, los de los ábacos y los que van a una separación siguen a 5 cm.
- **Estirar un lado transversal** lo lleva al linde más cercano que deja al menos un nervio dentro; **el centro** mueve la zona de linde en linde con su ancho (una que no cuadraba queda con su lado t0 en un linde); **una nueva** coge los nervios entre sus dos esquinas y, como poco, el nervio en el que caen. A lo largo de las barras, a 5 cm como antes.
- El rótulo del cursor y el de la zona dicen cuántos nervios coge: «3,00 × 3,20 m · 4 nervios».

**Medido en la vivienda:** de los lados transversales de lo propuesto por nervios, 58 de 70 están ya en un linde de la retícula; los otros 12 son bordes de la losa (10 cm o 8,5 cm más allá del último linde) o entrantes de su contorno. Con los bordes como lindes, los 70 están en uno: estirar lo propuesto no lo descuadra.

**Validación:** `src/editor/refuerzosPlanta.test.ts` (los lindes, a quién se aplica, estirar, mover y añadir) y `app/src/test/refuerzos.test.ts` (el adaptador de la vista, con un reticular: un refuerzo por nervio, uno de ábacos, uno nuevo y unos cercos). En la app con la vivienda sólo se ha visto que la pantalla carga y elige un refuerzo sin errores: **estirar con el ratón no se ha probado a mano** (en el panel del navegador, la planta queda demasiado pequeña para coger un asa). Los bancos de Chrome no se han pasado.

**No hecho:** los huecos de la losa no cuentan como bordes; a lo largo de las barras no se engancha a nada.

## 9. Fuera de esta fase

- Lo de CO-b: acero, muros, viguetas, encepados y zapatas combinadas.
- Las reglas de armado sismorresistente del capítulo 4 de la NCSE-02 (ductilidad).
- M01/M02 en los pilares (el momento equivalente y C = 1,7 − rm), las esperas y los anclajes entre piezas (agrupar pilares, hecho en §8.4).
- El escalón de un desnivel como comprobación de armado (DN-g).
- La comprobación geotécnica completa de la losa de cimentación (LC-f).
- Los planos de armado y su DXF (A6), y los PDF de cada pieza que hace Concreta.
- La resistencia al fuego.
- Del punzonamiento (CO4): las barras levantadas y los pernos; la disposición de los cercos (la primera fila, la separación tangencial, el anclaje); descontar la reacción del terreno en una losa de cimentación; los pilares de sección que no es rectangular ni circular, los circulares de borde y los que tienen borde libre en dos caras opuestas; el cortante de la losa contra la cara de una viga junto a un pilar (CO4-4).
- De las losas (CO3): el cortante a un canto útil de la cara de los apoyos (se toma en la cara, §8.9) y el de las astillas de losa junto a una viga (CO4-7); la flecha de la losa fisurada (CO-k); los anclajes, los solapes y las longitudes de los refuerzos; la armadura de reparto, la de borde y la de las esquinas entrantes; la armadura transversal de una maciza; las viguetas de un unidireccional (CO-b); la membrana de la losa (con diafragma rígido no tiene valor); elegir qué dirección va por fuera (CO3-e); que los refuerzos sigan a la losa al moverla o girarla en el editor; partir o igualar las zonas de refuerzo (CO3-h).
- De las vigas (CO2): mezclar diámetros en una cara (CO2-b), las longitudes, los solapes y los anclajes de los refuerzos y el decalaje de la ley de momentos (el refuerzo de un apoyo se entiende que cubre su cuarto de vano), el momento mínimo de empotramiento en los apoyos del §9.2.1.2(1) (el modelo ya da el del pórtico), el cortante a un canto útil de la cara (se toma el de la cara), la armadura de piel que no sea por torsión, igualar el armado entre vanos y vigas, y las vigas en T o con la losa como cabeza.

## 10. Riesgos

- **Las copias publican código con otra licencia** (PolyForm Noncommercial) que el resto del repositorio: va dicho en `NOTICE` y en la carpeta, y no se mezcla con código propio.
- **Los módulos son de pieza aislada.** Cada adaptador tiene que decir qué deja fuera, y lo que no encaja sale «pendiente», no «cumple».
- **El punzonamiento es lo menos preparado:** el módulo sólo conoce tres posiciones y un β. Si la medida de CO4 da muchos pilares fuera, hará falta geometría propia del perímetro.
- **Las tablas de armado deciden lo que sale.** Sin las del usuario o las de CYPECAD, la sombra comparará tablas y no cálculo.
- **El tiempo con el sismo:** nueve veces más ternas por extremo (§3).
