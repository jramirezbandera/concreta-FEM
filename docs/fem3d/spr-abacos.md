# Ábacos de borde: el SPR y su malla (SP-1, SP-2)

> **Fecha:** 2026-10-14. **Origen:** la puerta de uso de F y AB con el muestrario (`ejemplos/muestrario`, reticular L2 de PL1). El usuario vio en Resultados · Losas momentos «altísimos» junto a los pilares medianeros (hasta 1767 kN·m/m), positivos al lado del pilar y negativos delante, y valores razonables en los centrales y en las esquinas.
>
> **Veredicto: era un fallo de la recuperación SPR (SP-1), no de la solución, agravado por una malla pobre en esos ábacos (SP-2). Están corregidos los dos, con tests y referencia congelada.**
> - **SP-1 (motor):** ningún nudo usa ya un ajuste que amplifique sus muestras más de 10 veces (constante de Lebesgue). En el ábaco de P5, el M11 del mapa pasa de +127…+164 kN·m/m a −19…−37, junto a los −21…−44 de las láminas. **Las franjas de armado también estaban contaminadas**: L2:X7 daba 583 kN·m/m de inferior (ahora 21,8) y L2:X1, 1030.
> - **SP-2 (compilador F3.1):** la plantilla de todo pilar que cae en un ábaco se refina por sus cuatro caras (los tercios de F2), tenga o no caras de franja. El ábaco de P5 pasa de 12 láminas (8 deformables, algunas en cuña) a 32.
> - **Lo que queda para el usuario** (§4): en el edificio reticular objetivo, con h = 0,75, las envolventes de las franjas siguen un 6,6 % por debajo de la malla fina de media (antes, 12,7 %), con un máximo de −21 % en las caras de pilares con viga embebida en la franja. Y el coste: +27 % de ecuaciones en ese edificio (185 115, dentro del perfil móvil).

## 1. Qué pasaba (SP-1)

El ábaco es una región SPR aparte del aligerado, porque el momento tangente salta en su borde (E5). En un pilar medianero, el ábaco de 2,4 × 2,4 m queda en 1,2 × 2,4 m dentro de la losa, y menos la huella. La plantilla de un pilar sin caras de franja (de borde o atravesado por una viga, `franjas.ts`) lo dejaba en 8 láminas deformables, así que **ningún nudo de esa región era interior**.

Sin parches interiores, el respaldo del SPR ajustaba cada nudo con su propio parche y la mayor base que admitiera: un bilineal de 4 términos con 4 o 5 muestras. Eso es interpolar los centroides y extrapolar al nudo. En el muestrario, con 1,35 G + 1,35 CM + 1,5 Q (`validacion/abacos/diagnostico.ts`):

| Nudo (x, y) | M11 del SPR | M22 del SPR | Láminas que lo rodean |
|---|---|---|---|
| (1,20; 5,35) | −783 | −1552 | −41 |
| (0,20; 5,35) | +699 | +1457 | −41 |

Por eso el mapa daba lóbulos positivos junto al pilar y negativos delante, y un salto en el borde del ábaco. Las franjas integran por campos en los vanos, así que los heredaban.

**La medida que lo separa:** el valor de un nudo es Σ wₛ·vₛ sobre sus muestras, y la constante de Lebesgue Λ = Σ|wₛ| acota cuánto puede salirse de su rango (|valor| ≤ Λ·máx|vₛ|). En los modelos de validación y los congelados (`out_lebesgue.txt`, `out_lebesgue_congelados.txt`, `out_exceso.txt`):

- **Modelos sin ábacos:** el techo es Λ ≈ 7,6 (pilares mezclados). Hasta ahí es la extrapolación normal de un parche cuadrático al borde, y el exceso real no pasa de 1,9 veces: el momento crece hacia el borde.
- **Ábacos pequeños:** Λ de 137 a 188, con excesos reales de hasta 31 veces. Con Λ > 10 había 32 nudos en el muestrario y 1 140 en el edificio reticular de 2 plantas.

## 2. El arreglo del SPR (SP-1, `src/motor/campos.ts`)

`LEBESGUE_MAXIMO = 10`. Para cada nudo, por orden:

1. su parche interior, si Λ ≤ 10;
2. en el borde, la media de los parches interiores vecinos; si pasa de 10, sólo los vecinos que no pasan;
3. si no queda ninguno, el parche propio con la mayor base que dé Λ ≤ 10 (cuadrática, bilineal, lineal, a lo largo de la fila);
4. al final, la media de sus muestras (Λ = 1, degradado, con el Q de la DKMQ).

Lo decide la geometría, no u: los campos siguen siendo lineales en u. `lebesgueEn(p)` da la Λ de cada nudo.

**Ninguna referencia congelada cambia.** Las que tienen ábacos se quedaban en Λ ≤ 9,2, y la de C4 no guarda campos. En el ábaco de P5, el SPR queda junto a la lámina (por ejemplo, −22 frente a −24 y −37 frente a −44).

## 3. La malla de los ábacos (SP-2, `src/compilador/losas.ts`, compilador F3.1)

En un reticular, cada pilar cuyo centro cae en un ábaco pide el refinamiento de F2 (los tercios del primer tramo de la plantilla junto a la cara) en sus cuatro caras, con o sin caras de franja. Va con el mismo respaldo por pilar si la plantilla pierde calidad. Sólo con `franjas` y `refinoCaras` (los dos por defecto): con `franjas: false` la malla de C1–C5 sale bit a bit, como antes.

**Muestrario (L2):** el ábaco de P5 pasa de 12 a 32 láminas, y las 8 plantillas de PL1 van refinadas, sin avisos de malla. Las envolventes de las franjas con h = 0,75, frente a h = 0,25 (`out_convergencia.txt`):

| Franja | Antes de SP-1 | Sólo SP-1 | SP-1 y SP-2 | h = 0,25 |
|---|---|---|---|---|
| X7 inferior (por P5) | 583 | 21,5 | 21,8 | 22,5 |
| X1 superior (borde inferior, cara de P11) | 271 (y 1030 de inferior) | 64,0 (−30 %) | 78,2 (−14 %) | 91,0 |
| X14 superior (borde superior) | — | 67,0 (−7 %) | 75,0 (+4 %) | 72,0 |
| Y1 superior (borde izquierdo, cara de P5) | — | 67,6 (−10 %) | 78,3 (+5 %) | 74,8 |

De las 25 envolventes que dimensionan (≥ 20 kN·m/m), la media queda en +0,7 % y la |media| en 4,6 %.

**Edificio reticular de C4 con 2 plantas** (vigas por todos los ejes, ábacos de 2,5 m en los 80 pilares), frente a h = 0,375:

| Malla con h = 0,75 | Media | Peor | Por debajo de −10 % |
|---|---|---|---|
| Antes (con SP-1) | −12,7 % | −36 % | 54 de 98 |
| Refinando sólo los pilares de borde y de esquina | −12,4 % | −36 % | 54 de 98 |
| **SP-2: todos los pilares en ábaco** | **−6,6 %** | **−21 %** | **35 de 98** |

Refinar sólo los de borde no sirve: en este edificio ningún pilar tiene caras de franja (las vigas los atraviesan), y lo que pesa son los interiores.

**Coste** en el edificio reticular objetivo de 7 plantas: de 53 287 a 66 475 nudos y de 145 551 a 185 115 ecuaciones (+27 %; perfil móvil, 200 000). El cálculo pasa de 4,2 a 5,7 s en sobremesa.

## 4. Hallazgos

- **SP-1:** el respaldo del SPR para regiones sin nudos interiores interpolaba con 4 o 5 muestras y extrapolaba hasta 30 veces. Afectaba al mapa y a las franjas en todos los ábacos pequeños (de borde, de esquina y, en el edificio reticular, también interiores). Corregido (§2).
- **SP-2:** las plantillas de los pilares sin caras de franja no se refinaban, y en un ábaco dejaban unas pocas láminas en cuña. Corregido (§3).
- **SP-3, para el usuario:** con h = 0,75, en un reticular con vigas embebidas por los ejes, las envolventes de las franjas siguen un 6,6 % bajas de media. Las peores (−17…−21 %) son superiores en la cara del pilar, en franjas con la viga a lo largo (L-N1:Y37, Y52, X19). Es un punto de gradiente fuerte entre viga, pilar y losa que converge despacio; no es del ábaco. **Opciones:** (a) aceptarlo y compararlo en el periodo en sombra con el reticular de SAP2000 (ya decidido para F), (b) un h menor sólo en los ábacos, o (c) refinar también el primer tramo a lo largo de las vigas embebidas junto al pilar. Antes de elegir convendría una referencia más fina que 0,375 en un trozo del edificio.
- **SP-4:** L2:X1 (la franja del borde inferior del muestrario, en la cara de P11, en el escalón de F3 con la viga de fachada dentro) oscila con la malla: 79,8 / 91,0 / 86,6 / 86,9 con h = 0,375 / 0,25 / 0,15 / 0,1. Con h = 0,75 queda en 78,2, un 10–14 % bajo. Es de la familia de F2-9 / F3-8 (aparcada).
- **SP-5, la malla «caótica» del muestrario** (pregunta del usuario): no era un error. La triangulación entra donde la rejilla no puede:
  - alrededor de las puntuales de viento y sismo en (9; 5,5), que sembraban un nudo fuera de la rejilla (+120 láminas);
  - junto al núcleo, cuyos muros (x = 13,4 / 16,4; y = 7 / 10) quedan a menos de 0,4·h = 0,30 m de los bordes de los ábacos (13,2 / 16,8; 6,7 / 9,8). Esto se queda así: la malla es correcta y la geometría es la del usuario.

  **Hecho el mismo día** (decisión del usuario, compilador F3.2; §6).

## 6. Las puntuales horizontales, al diafragma (SP-5)

Una puntual sólo horizontal (Fz, Mx y My nulos) que cae en una losa de una planta con diafragma rígido ya no siembra su punto (`alDiafragma` en `losas.ts`). Va al nudo del diafragma más cercano con su momento de transporte Mz (`cargas.ts`).

**Es exacto:** ux, uy y rz de todos los nudos de la losa dependen del maestro (ux = uxm − (y − ym)·rzm…), así que en cualquiera de ellos, con su Mz, da al maestro la misma carga que en su punto. La resultante física se suma en su punto, como siempre, y el control «sin pérdidas» la compara con la analítica. Con Fz, Mx o My, en una planta sin diafragma (la más baja, C1-d) o en un paño, todo sigue como antes. La lista de cargas que van así sale en las hipótesis.

| Qué | Resultado |
|---|---|
| Malla | La de la planta no cambia con la carga. En el muestrario, L2 pasa de 1431 a 1311 láminas, y la mancha de triángulos alrededor de (9; 5,5) desaparece |
| Exactitud | Mover la carga por la losa con el torsor que compensa su resultante da los mismos desplazamientos y reacciones a 1e-10 (`diafragmaCargas.test.ts`, que falla con el código de antes) |
| Muestrario, viento y sismo | Reacciones y esfuerzos de extremo de los pilares, a ≤ 0,006 % de antes: lo que cambia la malla (`validacion/abacos/diafragma.ts`, `out_diafragma.txt`) |
| Pilar apeado de `apeo.test.ts` (con una horizontal junto a él) | La malla pasa de 360 a 250 nudos (la misma que sin la carga) y el axil, de −77,767 a −77,523 kN, más cerca de la triangulación con h = 0,1 (−77,291: un 0,30 % frente a un 0,62 %). Se actualiza su valor congelado |

## 5. Validación

| Qué | Dónde |
|---|---|
| Plantillas en ábaco refinadas, Λ ≤ 10 en todos los nudos y el SPR de cada ábaco dentro de 2,5 veces el mayor \|M\| de sus láminas (con el código de antes: 19 y 33 veces), en el reticular de 2 × 2 y en el muestrario. Los 6 tests fallan con el código de antes | `src/compilador/abacos.test.ts` |
| Referencia congelada de F con `reticular-2x2-abacos`; las otras siete entradas, idénticas | `validacion/f/congelar.ts`, `congelado-f.test.ts` |
| Λ por modelo y por vía, y exceso real por tramos de Λ | `validacion/abacos/lebesgue.ts`, `exceso.ts` |
| El caso del usuario: lámina frente a SPR junto a P5 | `validacion/abacos/diagnostico.ts`, `desvio.ts` |
| Convergencia de las franjas | `validacion/abacos/convergencia.ts` |
| SP-5: malla sin la carga, exactitud al moverla y caso apeado | `src/compilador/diafragmaCargas.test.ts`, `apeo.test.ts`, `validacion/abacos/diafragma.ts` |

Baterías, con SP-5: en la raíz pasan 1 731 de 1 732 tests y en la app, los 36. El que falla es `aleatorio-6-reticular (perfil)` de C4, por el tiempo de espera de 60 s con la batería en paralelo (ya pasaba en F3). Solo, pasa.

## 7. SP-3 y SP-4: la referencia fina

Un trozo del edificio reticular (3 × 3 vanos de 6 × 5 m, vigas por todos los ejes, ábacos de 2,5 m, 2 plantas), con h de 0,75 a 0,1 y, en las finas, también ε_snap = 0,01 para quitar F3-8 (`validacion/abacos/sp3.ts`, `out_sp3.txt`). Referencia: h = 0,1 con ε_snap = 0,01 (60 012 nudos). Las 42 envolventes de ≥ 20 kN·m/m:

| Malla | Media | \|Media\| | Peor | Más alta |
|---|---|---|---|---|
| 0,75 (la de uso) | −8,7 % | 10,2 % | −28,5 % | +7,3 % |
| 0,5 | −7,4 % | 7,7 % | −24,7 % | +1,2 % |
| 0,375 (la referencia de §3) | −4,9 % | 5,2 % | −17,4 % | +1,9 % |
| 0,25, ε_snap 0,01 | −3,1 % | 4,3 % | −17,3 % | +10,0 % |
| 0,15, ε_snap 0,01 | −1,0 % | 2,2 % | −7,5 % | +6,1 % |

- **El error es real y mayor de lo que daba h = 0,375 como referencia:** −8,7 % de media y −28,5 % como máximo con h = 0,75.
- **Está concentrado.** Las franjas sin viga ni pilar convergen a ±2 % ya con h = 0,75 (X6, X8, X12, Y9, Y14, Y21). Las malas son superiores en la cara de un pilar, en franjas con una viga embebida a lo largo (Y8, Y15, Y16, X7, X13, X19, Y22, Y1), justo como SP-4 en el muestrario.
- **Y convergen despacio, como una singularidad.** L-N1:Y8 da 41,3 / 46,0 / 50,8 / 53,4 / 56,2 / 57,8 con h = 0,75 / 0,5 / 0,375 / 0,25 / 0,15 / 0,1, un orden de ~0,75 en h. Extrapolado, el límite está en ~62: con h = 0,75 falta un tercio, y con 0,1, un 7 %. Es la esquina entrante de la losa entre el pilar y la viga. Algunas caras (X13) dependen además de ε_snap: 67 frente a 80 con h = 0,25.
- **Consecuencia:** refinar sólo el primer tramo junto a la viga (la opción c) las mejoraría, pero no las cerraría. Con orden 0,75, para quedarse a un 5 % harían falta elementos de ~6 cm junto a la esquina, con una gradación. Antes conviene decidir qué debe medir la franja ahí (§8).

## 8. Lo que decide el usuario sobre SP-3 y SP-4

1. **Aviso ya**, sea cual sea el arreglo (regla de oro 2: nada silencioso): la estación de la cara de un pilar en una franja con una viga embebida a lo largo lleva `franja/cara-con-viga`, que dice que con h = 0,75 puede salir hasta un ~30 % baja.
2. **Qué mide la franja ahí.** La losa y la viga se solapan en el ancho de la viga, y la barra lleva el momento de la viga. Hay tres caminos:
   - **(a) Malla graduada** hacia la esquina pilar–viga hasta unos 6 cm. Mide lo mismo que ahora, bien convergido, pero es caro y persigue un pico que en la realidad reparten la fisuración y la plasticidad.
   - **(b) La franja sin el ancho de la viga.** En la cara se mide la losa fuera de b_w, y lo que la losa lleva dentro de b_w va a la viga (sección en T, como CSI). Hay que medir si converge rápido, y cambia también el armado de la viga.
   - **(c) La cara a una distancia** (por ejemplo, d o h_losa de la cara del pilar), donde el campo ya es regular. Lo admiten algunas normas para los apoyos monolíticos, pero hay que justificarlo con el CTE / EC2.

## 9. SP-3 y SP-4 resueltos: el metro de los pilares sin cara (decisión del usuario, 2026-10-14)

El usuario eligió la opción (b). **Medida, no resolvía:** quitando de la franja el ancho de la viga, el trozo reticular pasaba de −8,7 / −28,5 % a −7,2 / −22,9 %, y las caras seguían convergiendo igual de despacio. Al mirar estación a estación salió la causa real, que no era el solape de la losa con la viga:

- **Esos pilares no tienen cara de franja.** `carasFranjas` no la da a un pilar que atraviesa una viga o un muro según la transversal (su apoyo es esa línea), ni a uno de borde.
- **La estación de apoyo en el eje de la viga no cuenta lo que pasa por la huella.** En la franja que toca el pilar de (6; 5), da sólo 26–30 kN·m/m.
- **El máximo salía de una estación de paso por campos a 5 cm de la cara** (s = 4,75 con la cara en 4,8), pegada a la esquina del pilar, donde el SPR no converge: 41 / 53 / 58 con h = 0,75 / 0,25 / 0,1.

**Arreglo** (`esfuerzosFranjas.ts`; sin cambiar la malla): un pilar sin cara de franja tiene su metro en cada cara, en las franjas que lo tocan:

1. por la recta de la cara, con lo que transmite su enlace (F3-d), si sigue la malla en su ventana;
2. si no, por el escalón de F3 desde una recta de la malla que atraviese su huella, trasladado a la cara: la línea de apoyo de la viga o el muro, o la cara común de otros pilares de su alineación (la de un pilar de borde, P10 y P11 del muestrario). Se toma la más cercana a la cara: en la tira entre las dos rectas, lo que se lleva una viga a lo largo (la de fachada) no lo cuenta el corte. Desde la más lejana, la cara de P10 salía el doble;
3. sin ninguna de las dos, el aviso `franja/pilar-sin-cara` de siempre.

Entre sus caras no hay estaciones, como en los demás pilares. En los modelos medidos, todas salen por el escalón, y en el muestrario ya no queda ningún aviso de pilar sin cara.

**Resultado** con h = 0,75 (`out_sp3.txt`, `out_convergencia.txt`):

| Modelo | Antes: media / peor | Ahora: media / peor |
|---|---|---|
| Trozo reticular 3 × 3, frente a h = 0,1 con ε_snap 0,01 | −8,7 % / −28,5 % | −1,0 % / −22,9 % |
| Edificio reticular de 2 plantas, frente a h = 0,375 | −6,6 % / −21 % (35 bajo −10 %) | −1,8 % / −14,5 % (10 bajo −10 %) |
| Muestrario, frente a h = 0,25 | +0,7 % (X1, −14 %) | +0,6 %, ninguna bajo −10 % |

Las caras nuevas convergen:

- en el trozo reticular, el pilar de (6; 5) da 70,9 / 66,0 / 68,1 con h = 0,75 / 0,25 / 0,1 (antes, el máximo de la franja era 41) y el de (12; 5), 85,3 / 84,2 / 84,6 (antes, 52);
- en el muestrario, las de los pilares de borde y de esquina atravesados por una viga de fachada quedan a ±3 % entre h = 0,75 y h = 0,15 (por ejemplo, X1, en la cara de P12: 138,7 / 137,1 / 137,9 / 139,9). Las de P10 y P11 en X1 (desde la cara común), un 7 % por debajo de h = 0,15 con ε_snap 0,01: 132,8 / 113,7 y 120,3 / 140,1, frente a 142,9 / 122,9 y 129,4 / 149,4.

**Lo que esto dice de la pregunta del usuario:** los 1767 kN·m/m del mapa eran un artefacto (SP-1), pero en la cara de los medianeros y de las esquinas la losa sí transmite unos 115–140 kN·m/m, que las franjas antes no medían (daban 64–91).

**Referencia congelada de F:** el modelo analítico y los resultados, idénticos. En `aleatorio-3`, `reticular-2x2-abacos` y `pilares-mezclados` (un pilar de borde de losa maciza) aparecen 33 estaciones de cara y desaparecen las de paso y de apoyo que quedaban entre las caras de esos pilares; las otras 3 316, bit a bit. Test: `src/compilador/caraSinFranja.test.ts` (falla con el código de antes).

**Queda** (medido en §10):
- **SP-6:** el escalón desde el eje de la viga frente al corte directo por la cara. Con h = 0,1, el experimento con las caras sembradas daba 93,1 en el pilar de (12; 5), frente a 84,6. Pero era otra malla (con ella, el paso a 5 cm de la cara ya salía un 5 % más alto), así que la diferencia del método está por medir en la misma malla.
- **Franjas vecinas del pilar** (que no lo tocan): su máximo es de paso por campos a ~30 cm de la esquina, y converge despacio (el peor, −14,5 % en el edificio de 2 plantas).

## 10. SP-6: el escalón frente al corte directo, y las franjas vecinas (2026-10-14)

### 10.1 Un fallo previo: el corte directo no entraba nunca

Para comparar los dos métodos en la misma malla, la cara de los pilares sin cara de franja se sembró con una carga lineal nula (`validacion/abacos/sp6.ts`). Aun así, las 96 caras del trozo reticular salían idénticas en bits: **el camino 1 de §9 (por la recta de la cara) no entraba nunca.** Cortaba la recta con el enlace de la huella, y sin nudos rígidos delante de la cara (F2-9) el enlace no la cruza: el corte no valía y se pasaba al escalón. Con ello, **un pilar sin recta para el escalón se quedaba sin metro aunque su cara siguiera la malla**: los de borde de una losa plana sin vigas, con sólo el aviso `franja/pilar-sin-cara`.

Al arreglarlo salieron otros dos fallos del mismo camino, que no se veían porque no entraba:

- **El corte no ve una lámina que cruza la recta con el centroide fuera de su rectángulo.** Si la recta de la cara sólo sigue la malla delante de la huella, el corte valía con medio ancho: P0-5 de `reticular-2x2-abacos` daba 0,2 m en vez de 0,41 y el medio, el doble. Ahora las láminas tienen que cubrir la ventana en la losa (salvo la huella y sus nudos rígidos), y si no, se usa el escalón.
- **En la ventana justa, las láminas de sus extremos tampoco entran**, así que la cobertura casi nunca llegaba. Se corta con márgenes de más a menos (2,5h + ε_snap, h, h/2 y la ventana justa), el mayor con el que la recta sigue la malla.

`esfuerzosFranjas.ts`, sin cambiar la malla. Tests en `caraSinFranja.test.ts`: el primero falla con el código de antes.

**Efecto** (`out_sp6congelados.txt`, `out_h25borde.txt`):

| Modelo | Estaciones | Qué cambia |
|---|---|---|
| H25, losa plana (y sin refinar) | 24 nuevas | los pilares de borde tienen su metro: las franjas de borde pasan de 56,1 a 77,0 kN·m/m de máximo (+37 %) |
| H25, reticular | 20 nuevas | ídem: de 88,0 a 112,8 (+28 %) |
| `pilares-mezclados` | 6 nuevas | P18-5, de borde, en su cara de y = 5,2 (en la de 4,8 la recta sale de la malla al final de la ventana y no hay escalón): −15,9 frente a −12,0 de la franja; el máximo de la franja no cambia |
| `reticular-2x2-abacos` | 1 cambia | P0-5 en y = 5,2, del escalón al corte directo: +10 % |
| El resto | — | bit a bit |

Las caras nuevas de H25 convergen: la de P6-0 da −77,0 / −84,0 / −86,4 / −87,9 / −86,9 con h = 0,75 / 0,5 / 0,375 / 0,25 / 0,15 (la reticular, −112,8 … −126,7). **Con h = 0,75 quedan un 11 % por debajo de la malla fina**, frente al 36 % de antes. Las caras de los pilares interiores siguen a ≤ 0,3 %.

En los modelos con vigas casi no cambia nada, porque con h = 0,75 la recta de la cara rara vez sigue la malla en la ventana: en el trozo reticular, 6 de 96 caras van por el corte directo (32 con h = 0,375 y las 96 con h = 0,1). El trozo pasa de −1,0 / −22,9 % a −1,2 / −22,9 % (media / peor), y el edificio de 2 plantas, igual (`out_sp3.txt`, `out_convergencia.txt`).

### 10.2 El escalón frente al corte directo, en la misma malla

Trozo reticular con las caras sembradas (`out_sp6.txt`), escalón menos directo en la envolvente superior de cada cara (≥ 20 kN·m/m):

| Malla | Media | \|Media\| | Mín | Máx |
|---|---|---|---|---|
| 0,75 | −0,5 % | 4,8 % | −27,6 % | +23,7 % |
| 0,375 | −0,0 % | 5,8 % | −27,9 % | +26,7 % |
| 0,25, ε_snap 0,01 | −0,4 % | 5,6 % | −41,2 % | +16,1 % |
| 0,15, ε_snap 0,01 | +0,1 % | 5,0 % | −27,2 % | +13,1 % |
| 0,1, ε_snap 0,01 | −0,6 % | 4,5 % | −28,2 % | +12,7 % |

- **No miden lo mismo, y la diferencia no baja al refinar**: es del método (lo que pasa en la tira de losa entre las dos rectas, de 15–25 cm, a lo ancho de la ventana), no de la malla.
- **En los momentos que dimensionan** (≥ 50 kN·m/m con h = 0,1, 69 caras): −0,6 % de media, 3,8 % en valor absoluto, de −8,7 % a +11,7 %. El escalón sale **más alto en los pilares de esquina y de borde** con la viga de fachada como recta del escalón (+7…+12 %: P0-0, P18-0, P18-5, P0-15) y **más bajo en algunas caras interiores** (P6-10 en y = 9,75, −8,7 %; P12-10 en x = 12,25, −6,8 %).
- Los extremos (−28…+27 %) son caras de momento pequeño (17–30 kN·m/m).
- **El 84,6 frente a 93,1 de §9 era sobre todo la malla:** en la cara de P12-5 en x = 11,8 (L-N1:X7), con h = 0,1, el escalón y el directo dan 99,8 y 102,4 en la malla sembrada (un 2,6 %), mientras que el mismo corte directo da 93,7 en la malla de uso (la siembra lo sube un 9 %).

### 10.3 Las franjas vecinas

Las peores de §9 (`out_vecinas.txt`, `out_vecinas_trozo.txt`):

| Franja | h = 0,75 frente a la fina | Dónde está el pico | Qué es |
|---|---|---|---|
| L-N2:Y16 del trozo | 40,2 frente a 52,2 (−23 %) | s = 10,5, con 33 cm de losa junto a la esquina del hueco de la escalera (12,6; 10,4) | **la esquina entrante del hueco**, no el pilar. No converge ni con h = 0,1: 39,5 / 44,3 / 46,1 / 52,2 |
| L-N2:Y31 del edificio | 26,2 frente a 30,7 (−14,5 %) | s = 15,5, con 5 cm de losa junto a la esquina del hueco (24,6; 15,4) | ídem |
| L-N2:Y29 del edificio | 31,6 frente a 35,9 (−12 %) | s = 19,75, a 10 cm de la cara de P24-20 y con la franja a 2 cm de su lado | **la vecina de un pilar**: paso por campos junto a su esquina. Converge desde h = 0,375 (35,9 / 35,7). La estación de apoyo en el eje de la viga converge (31,0 / 30,7 / 31,4), pero no recoge el pico |

## 11. Lo que decide el usuario sobre SP-6

1. **Qué método vale para el metro de un pilar sin cara de franja.** Hoy (tras §10.1): el corte directo si la recta de la cara sigue la malla en la ventana y, si no, el escalón. Así, la estación de una misma cara cambia de método al refinar (±5 %, hasta ±12 % en las que dimensionan).
   - **(a) Como está.** El corte directo es la definición de las demás caras (F, F-h), y el escalón, su sustituto cuando la malla no lo permite. **Recomendado**: con h = 0,75 la diferencia de método es del orden del error de malla que queda (4,4 % de media en valor absoluto en el trozo).
   - (b) Siempre el escalón donde haya una recta para hacerlo, y el directo sólo sin ella (los de borde de una losa plana). Un solo método por cara, pero distinto del de las demás caras, y bajo en algunas interiores (−8,7 %).
   - (c) Sembrar la cara de estos pilares en la malla para que siempre haya corte directo. Medido sembrando la ventana y su margen: con h = 0,75 rompe la rejilla y la malla pasa de 3 620 a 18 906 nudos. Haría falta otra forma de sembrarla.
   - **Decidido el 2026-10-15: (a), como está.**
2. **Las franjas vecinas de un pilar** (L-N2:Y29, −12 % con h = 0,75): (a) aceptarlo, como el resto del error de malla de SP-3/4; (b) que una franja que entra en la ventana de un pilar sin tocarlo tome también su metro en la cara (F-h extendido: del lado seguro, pero puede doblar la armadura de esa franja; habría que medirlo). **Decidido el 2026-10-15: (a), se acepta.**
3. **Las esquinas de los huecos.** La estación de una franja que casi no tiene losa junto a la esquina entrante de un hueco da la media de una singularidad: no converge. Propuesta: un aviso que remita al armado de refuerzo del hueco, en vez de leerla como demanda de la franja. **Decidido el 2026-10-15: hecho (§12), como `franja/esquina-entrante`.**

## 12. El aviso de las esquinas entrantes (decisión del usuario, 2026-10-15)

**Qué se midió** (`validacion/abacos/esquinas.ts`, `out_esquinas.txt`): en el trozo reticular, cada estación de franja a ≤ 1,5 m de una esquina del hueco, con h de 0,75 a 0,1 (ε_snap 0,01). Error de h = 0,75 frente a h = 0,1 en la superior (≥ 20 kN·m/m), por la distancia de la recta de la estación (en su franja o su ventana) a la esquina:

| Distancia | Estaciones | Media | \|Media\| | Peor |
|---|---|---|---|---|
| 0–0,25 m | 15 | −6,3 % | 13,2 % | −39,7 % |
| 0,25–0,5 m | 36 | +0,2 % | 15,2 % | +94,1 % |
| 0,5–0,75 m | 12 | −6,1 % | 6,3 % | −13,7 % |
| 0,75–1 m | 20 | +1,1 % | 7,9 % | −25,2 % |
| 1–1,5 m | 32 | +0,4 % | 5,0 % | +11,0 % |

- **A menos de ~0,75 m de la esquina, con h = 0,75 los valores salen mal en los dos sentidos** (de −40 % a +100 %); más allá, como el resto de la losa (~5 %).
- **Pegadas a la esquina y con la franja cortada por el hueco, no convergen**: L-N2:Y16 en s = 10,5 (a 10 cm, con el 40 % de su ancho en losa) da 39,5 / 44,3 / 46,1 / 50,1 / 52,2 con h = 0,75 / 0,375 / 0,25 / 0,15 / 0,1, y sigue subiendo. Las que tienen la franja entera en losa convergen (L-N2:Y16 en s = 10,25: 32,8 … 30,7).

**El aviso** (`esfuerzosFranjas.ts`; las esquinas, con `esquinasEntrantes` de `franjas.ts`): una franja con estaciones cuya recta pasa a menos de máx(h, b/2) de una esquina entrante de la losa lleva `franja/esquina-entrante`, uno por franja, con el tramo de estaciones de cada esquina. Esquinas entrantes son los vértices de los huecos que entran en la losa y los cóncavos del contorno: la esquina interior de una losa en L es la misma singularidad, así que el aviso no se queda en los huecos. El texto pide no leer esos valores como la demanda de la franja y armar la esquina con su refuerzo (barras de borde y en diagonal). No se quita ninguna estación ni se cambia ningún valor.

- En el trozo reticular, con h = 0,75: 10 de las 41 franjas de cada losa.
- Referencia congelada de F: sólo el aviso nuevo, en 19 franjas de `pilares-mezclados` y `reticular-2x2-abacos` (los que tienen hueco); estaciones y valores, idénticos.
- Tests: `src/compilador/esquinaEntrante.test.ts`.

## 13. La cara de franja cortada en tramos (puerta de uso, 2026-10-15)

Al modelar la vivienda de Alhaurín el Grande (primera puerta de uso con un proyecto real), la consulta de franjas dio 75 avisos `franja/cara-sin-corte`: seis rectas de cara sin estación en ninguna de las franjas que las cruzan.

- **Causa (un fallo previo de F):** la recta de una cara sólo se siembra en sus `tramos`, porque `carasFranjas` la corta junto a los pilares ajenos (a menos de h) y las vigas casi paralelas. Pero su estación se medía cortando la recta entera, de lado a lado de la losa. Fuera de los tramos la recta atraviesa láminas, el corte no valía y la cara se perdía en todas sus franjas, también en las del tramo. En la vivienda pasaba en las filas de pilares cercanas entre sí (las de y = 14,56 y 15,05, a 19 cm entre caras) y en tres caras de la cubierta alta.
- **Arreglo** (`esfuerzosFranjas.ts`, `porNodalesCara`): primero el corte de la recta entera, como antes (los mismos bits); si no vale, un corte por tramo, sumados. Una franja o una ventana que toca un tramo que no sigue la malla conserva el aviso.
- **Efecto:**
  - en la vivienda, ningún aviso de cara sin corte;
  - en la referencia congelada de F, 8 franjas de `pilares-mezclados` recuperan su estación de cara (L-N1:X2, por ejemplo, de una estación sin valor a −15,7 kN·m/m con 1 m de ancho). Las demás, idénticas.
- **Test:** `src/compilador/caraPorTramos.test.ts` (falla con el código de antes).


## 14. Las caras de los pilares de borde y junto a vigas paralelas (compilador F3.3, 2026-10-15)

**Origen:** en la vivienda de Alhaurín el usuario vio los mapas de Losas con casi todo el negativo en P11 y casi nada en los demás pilares. P11 es correcto: es el único pilar de L-CUB que trabaja como interior (losa en tres cuadrantes, sin viga que siga hacia arriba ni hacia la derecha), está en la esquina entrante de la L y tiene el mayor axil (228 kN en G). Pero al comparar las franjas con mallas más finas salió que **con h = 0,75 casi todos los pilares de borde se quedaban sin estación en la dirección de su zuncho**, y el máximo de su franja era de paso por campos, del −30 al −73 % (`validacion/abacos/out_vivienda.txt`; con el código de antes, en la tabla de abajo).

**Causas** (`carasFranjas`, `franjas.ts`):

1. **Pilares centrados en el borde.** Es como se modela un forjado con zuncho (el zuncho por el eje de los pilares de borde). `carasFranjas` los descartaba en las dos direcciones, aunque las astillas sólo las dejan las caras paralelas al borde. En la dirección del zuncho su metro sólo salía por el escalón de SP-3/SP-4, desde una recta de la malla que atravesara su huella: una viga perpendicular o la cara común de un pilar interior de su fila. La vivienda no tiene ninguna (un ala de 4,26 m con pilares sólo en los bordes y sin vigas interiores), así que esos pilares se quedaban sin metro. Con h = 0,375 salía bien por casualidad: sus caras entran como líneas de la rejilla (d_min = 0,15 m).
2. **La holgura de las vigas paralelas.** La cara se cortaba a h de cada extremo de una viga casi paralela que pasara a menos de h. El zuncho Z-CUB-4, que empieza 0,34 m más allá de P3, le quitaba la cara entera en X, y Z-CUB-5, paralelo a 0,64 m, la de Y.
3. **Un aviso callado y otro equivocado.** Un pilar con una viga a menos de h/2 cuenta como apoyado en ella aunque la viga no atraviese su huella (Z-CUB-5 sólo llega al eje de P3). Si se quedaba sin estación, no se avisaba. En los demás, `franja/pilar-sin-cara` decía «circular, girado o de borde» aunque no fuera la causa.

**Arreglo** (compilador F3.3):

- Un pilar de borde tiene caras en una dirección si todos los lados del borde que tiene cerca van en esa dirección: sus caras cortan el borde en perpendicular. Para un pilar de esquina sigue sin haberlas, y tampoco en la dirección en que la cara iría paralela al borde.
- Junto al extremo de una viga paralela, la holgura de h no se aplica si en ella hay un pilar por el que pasa la recta: la recta acaba en la huella o sigue hasta la viga. Sin esto, la cara nueva de P12 (y = 8,94) acababa suelta en x = 0,75, dentro del bloque de P11, y su plantilla se iba a la triangulación: la cara de P11 caía de 209 a 133 kN·m/m.
- Una viga exactamente paralela sólo corta la cara a menos de d_min = 0,4h (como dos líneas de la rejilla), no a menos de h: entre las dos queda una fila de elementos de proporción normal.
- `franja/pilar-sin-cara` avisa de todo pilar que toca la franja y se queda sin estación en sus caras, con la causa: circular o girado, o «su cara no sigue la malla ni hay una recta de la malla por su huella desde la que medirla». `pilaresSinCara` desaparece.

**Efecto en la vivienda** (superior de ELU en la cara, kN·m/m; h = 0,75 frente a h = 0,25):

| Franja y pilar | F3.2, h = 0,75 | F3.3, h = 0,75 | h = 0,25 |
|---|---|---|---|
| L-CUB:Y19, P4 / P12 | 40,1 / 39,4 (paso) | 75,9 / 74,8 | 77,0 / 74,7 |
| L-CUB:Y19, P15 / P19 | 19,7 / 17,9 (paso) | 42,6 / 42,3 | 42,8 / 42,6 |
| L-CUB:Y13–Y14, P14 / P18 | 6,0–11,8 / 18,3–27,2 (paso) | 22,3 / 46,2 | 23,0 / 47,2 |
| L-CUB:X21, P3 / P2 | 63,8 / 52,1 (paso) | 109,0 / 107,4 | 114,1 / 110,1 |
| L-CUB:Y13–Y14, P3 | 38,0–39,1 (paso) | 73,4 | 80,6 |
| L-CUB-S:Y14, P6 / P9 | 19,2 / 54,8 (paso) | 34,9 / 94,8 | 34,6 / 98,9 |
| L-CUB:X13, P11 (0,75 / 0,375 / 0,25) | 209 / 175 / 222 | 207 / 206 / 203 | — |

- La cara de P9 en y = 11,12 tampoco existía con h = 0,25: la franja daba 79,2 en la otra cara, y ésta pide 98,9.
- Quedan sin cara, con su aviso, los de esquina y los de borde en la dirección perpendicular al borde sin zuncho. Las peores que quedan son las de las esquinas entrantes, que ya llevan su aviso (L-CUB-S:X13, P5, −12 %), P1 en la esquina (+16 / +43 %, del lado seguro, como antes) y momentos pequeños (L-CUB-S:X8, P9, 22,7 frente a 26,1).

**Coste:**

- **Vivienda:** con h = 0,75, de 2 689 a 3 833 nudos.
- **Edificio objetivo de 7 plantas con losa plana:** de 185 262 a 192 066 ecuaciones (+3,7 %), así que sigue en el perfil móvil (≤ 200 000).
- **Con vigas y en el reticular objetivo:** la misma malla.

**Referencia congelada de F** (`validacion/f/out_cambiosF33.txt`, antes de regenerarla):

- **H25 plana (con y sin refinar) y H25 reticular:** la misma malla y los mismos valores. Las franjas de borde pierden una estación de cara duplicada: la del pilar de borde, que ahora es la de su cara de franja.
- **`aleatorio-3`:** los mismos valores. Seis franjas llevan ahora el aviso por sus pilares circulares o girados atravesados por vigas: antes se callaba.
- **`pilares-mezclados`:**
  - la malla pasa de 1 461 a 1 346 nudos, porque las caras comunes de C5-g pasan a las de los pilares de borde de 30 cm;
  - P6-0 y P6-10, de borde, **no tenían metro ni con h = 0,25** (45,7 y 46,1 frente a 79,3 y 79,7 con su cara). Ahora, con h = 0,75, dan 63,0 y 71,4;
  - P0-5 pasa de 47,3 a 53,1 (59,5 con malla fina) y P12-0, de 88,7 a 95,0 (89,0).
- **El resto:** bit a bit.

**Test:** `src/compilador/carasBorde.test.ts`, con la vivienda; falla con el código de antes. Los de las 44 plantas no ortogonales de G-4 siguen sin el aviso de calidad de malla.
