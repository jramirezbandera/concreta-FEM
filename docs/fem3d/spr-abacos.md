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

**Queda:**
- **SP-6:** el escalón desde el eje de la viga frente al corte directo por la cara. Con h = 0,1, el experimento con las caras sembradas daba 93,1 en el pilar de (12; 5), frente a 84,6. Pero era otra malla (con ella, el paso a 5 cm de la cara ya salía un 5 % más alto), así que la diferencia del método está por medir en la misma malla.
- **Franjas vecinas del pilar** (que no lo tocan): su máximo es de paso por campos a ~30 cm de la esquina, y converge despacio (el peor, −14,5 % en el edificio de 2 plantas).

