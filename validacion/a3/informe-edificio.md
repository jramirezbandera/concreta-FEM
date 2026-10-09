# Informe de revisión

- Huella del modelo: 3d095f21cbe2faec317022118d67b859cba731cf9a2a789f7373ae2a6a52426e
- Esquema: concreta-fem/proyecto@1. Núcleo de cálculo: sha256 validacion…
- Este informe vale sólo para esta huella: si el proyecto cambia, la huella cambia y hay que volver a revisarlo.
- Las comprobaciones de sensatez son avisos de orden de magnitud sobre el modelo, no comprobaciones de norma. Un aviso puede ser legítimo (una transición, un voladizo): el ingeniero lo revisa y decide.

## Veredicto

- 48 avisos de sensatez en 1 de 20 comprobaciones: axil reducido de los pilares de hormigón.
- Ningún aviso del compilador ni del cálculo.
- Equilibrio de cargas y reacciones: 5,1e-12 relativo como máximo (tiene que ser ≤ 1e-9).

## Comprobaciones de sensatez

Casos gravitatorios: G, Q. Combinaciones: flechas, ELS-C; desplomes, ELS-C; axil reducido, ELU-PT.

| Comprobación | Avisa si | Estado | Lo peor |
| --- | --- | --- | --- |
| Altura de planta | fuera de [2,2; 8] m (en la más baja, más de 8 m) | bien | N6: 3 m |
| Espesor de losas y muros | fuera de [0,08; 2] m | bien | L-N1: 0,25 m |
| Dimensiones de las secciones | fuera de [0,1; 3] m (bw y hf de una T, fuera de [0,03; 3] m) | bien | v2540: b = 0,25 m |
| Materiales | fck fuera de [12; 100] MPa; E de un material general fuera de [1000000; 4,00e+8] kN/m²; peso específico fuera de [1; 100] kN/m³ | bien | HA: fck = 30 MPa |
| Peso propio dado de losas y paños | pp/(γ·e) fuera de [0,3; 1,3] en una losa maciza y fuera de [0,3; 1] en un reticular; pp de un paño fuera de [1,5; 8] kN/m² | no aplica | — |
| Caso de peso propio | no hay ningún caso con `pesoPropio` | bien | — |
| Casos vacíos | un caso sin cargas ni peso propio | bien | — |
| Cargas duplicadas | una carga igual a otra salvo el id, en el mismo caso | bien | — |
| Cargas verticales hacia arriba | en un caso G, Q o S, o sin acción | bien | — |
| Carga por m² de planta | casos G fuera de [3; 20] kN/m²; Q fuera de [0,5; 10]; S fuera de [0,1; 3]; cada caso sin acción, más de 25 kN/m² | bien | N7, G: 10,2 kN/m² |
| Plantas sin la carga de un caso | una planta con losas o paños sin carga de un caso que carga a la mayoría (salvo la más alta y las cubiertas) | bien | — |
| Arranques de pilares | un pilar con vínculo en la base que arranca en una planta que no es la más baja | bien | — |
| Pilares interrumpidos | un pilar que acaba bajo una losa o un paño de la planta de encima que cubre su eje | bien | — |
| Peso propio calculado frente al esperado | difieren más de un 10 % (por planta y en total) | bien | N1: -5,6e-13 % |
| Axil de los pilares frente a la bajada por áreas tributarias | axil/bajada fuera de [0,5; 2], con la suma de los casos gravitatorios (salvo los tramos embebidos en un muro y las bajadas menores que el 10 % de la mediana de su planta) | bien | P0-0 en N7: 0,863 |
| Luz libre / canto de las vigas | más de 18 si es descolgada y de 25 si es plana (b ≥ h); un voladizo, con el doble de su luz | bien | S0-0-N1: 11,7 |
| Mayor lado del recuadro / espesor | más de 35 en una losa maciza y de 30 en un reticular | bien | L-N1: 24 |
| Flecha relativa elástica / luz | más de 1/500 (combinaciones: ELS-C) | bien | L-N7: 1/4200 |
| Desplome por planta / altura | más de 1/250 (combinaciones: ELS-C) | bien | N2: 1/9530 |
| Axil reducido de los pilares de hormigón | ν = Nd/(Ac·fcd) más de 0,65, con fcd = fck/1,5 (combinaciones: ELU-PT) | AVISOS (48) | P12-10 bajo N1: 1,46 |

### Avisos

Axil reducido de los pilares de hormigón (sensatez/axil-reducido):

- El pilar P6-5 bajo la planta N1 tiene ν = 1,27 (Nd = 4060 kN con ELU-PT-5; más de 0,65): ¿la sección es pequeña o le llega más carga de la debida?
- El pilar P6-10 bajo la planta N1 tiene ν = 1,31 (Nd = 3930 kN con ELU-PT-4; más de 0,65): ¿la sección es pequeña o le llega más carga de la debida?
- El pilar P6-15 bajo la planta N1 tiene ν = 1,11 (Nd = 3570 kN con ELU-PT-4; más de 0,65): ¿la sección es pequeña o le llega más carga de la debida?
- El pilar P6-20 bajo la planta N1 tiene ν = 1,13 (Nd = 3400 kN con ELU-PT-5; más de 0,65): ¿la sección es pequeña o le llega más carga de la debida?
- El pilar P6-25 bajo la planta N1 tiene ν = 1,1 (Nd = 3530 kN con ELU-PT-5; más de 0,65): ¿la sección es pequeña o le llega más carga de la debida?
- El pilar P6-30 bajo la planta N1 tiene ν = 1,15 (Nd = 3450 kN con ELU-PT-4; más de 0,65): ¿la sección es pequeña o le llega más carga de la debida?
- El pilar P12-5 bajo la planta N1 tiene ν = 1,43 (Nd = 4560 kN con ELU-PT-3; más de 0,65): ¿la sección es pequeña o le llega más carga de la debida?
- El pilar P12-10 bajo la planta N1 tiene ν = 1,46 (Nd = 4370 kN con ELU-PT-2; más de 0,65): ¿la sección es pequeña o le llega más carga de la debida?
- El pilar P12-15 bajo la planta N1 tiene ν = 1,12 (Nd = 3570 kN con ELU-PT-3; más de 0,65): ¿la sección es pequeña o le llega más carga de la debida?
- El pilar P12-20 bajo la planta N1 tiene ν = 1,11 (Nd = 3330 kN con ELU-PT-2; más de 0,65): ¿la sección es pequeña o le llega más carga de la debida?
- El pilar P12-25 bajo la planta N1 tiene ν = 1,08 (Nd = 3460 kN con ELU-PT-3; más de 0,65): ¿la sección es pequeña o le llega más carga de la debida?
- El pilar P12-30 bajo la planta N1 tiene ν = 1,14 (Nd = 3410 kN con ELU-PT-2; más de 0,65): ¿la sección es pequeña o le llega más carga de la debida?
- El pilar P18-5 bajo la planta N1 tiene ν = 1,25 (Nd = 3990 kN con ELU-PT-5; más de 0,65): ¿la sección es pequeña o le llega más carga de la debida?
- El pilar P18-10 bajo la planta N1 tiene ν = 1,31 (Nd = 3940 kN con ELU-PT-4; más de 0,65): ¿la sección es pequeña o le llega más carga de la debida?
- El pilar P18-15 bajo la planta N1 tiene ν = 1,12 (Nd = 3590 kN con ELU-PT-2; más de 0,65): ¿la sección es pequeña o le llega más carga de la debida?
- El pilar P18-20 bajo la planta N1 tiene ν = 1,13 (Nd = 3400 kN con ELU-PT-2; más de 0,65): ¿la sección es pequeña o le llega más carga de la debida?
- El pilar P18-25 bajo la planta N1 tiene ν = 1,08 (Nd = 3460 kN con ELU-PT-5; más de 0,65): ¿la sección es pequeña o le llega más carga de la debida?
- El pilar P18-30 bajo la planta N1 tiene ν = 1,13 (Nd = 3390 kN con ELU-PT-4; más de 0,65): ¿la sección es pequeña o le llega más carga de la debida?
- El pilar P24-5 bajo la planta N1 tiene ν = 1,13 (Nd = 3610 kN con ELU-PT-3; más de 0,65): ¿la sección es pequeña o le llega más carga de la debida?
- El pilar P24-10 bajo la planta N1 tiene ν = 1,21 (Nd = 3640 kN con ELU-PT-2; más de 0,65): ¿la sección es pequeña o le llega más carga de la debida?
- El pilar P24-15 bajo la planta N1 tiene ν = 0,988 (Nd = 3160 kN con ELU-PT-5; más de 0,65): ¿la sección es pequeña o le llega más carga de la debida?
- El pilar P24-20 bajo la planta N1 tiene ν = 1 (Nd = 3010 kN con ELU-PT-4; más de 0,65): ¿la sección es pequeña o le llega más carga de la debida?
- El pilar P24-25 bajo la planta N1 tiene ν = 1,09 (Nd = 3490 kN con ELU-PT-3; más de 0,65): ¿la sección es pequeña o le llega más carga de la debida?
- El pilar P24-30 bajo la planta N1 tiene ν = 1,14 (Nd = 3410 kN con ELU-PT-2; más de 0,65): ¿la sección es pequeña o le llega más carga de la debida?
- El pilar P30-5 bajo la planta N1 tiene ν = 1,08 (Nd = 3460 kN con ELU-PT-5; más de 0,65): ¿la sección es pequeña o le llega más carga de la debida?
- … y 23 más.

## Modelo

Objetos: 8 plantas, 80 pilares, 567 vigas, 7 losas, 4 casos, 46 cargas. Modelo analítico: 34737 nudos, 10787 barras y 33012 láminas.

| Planta | Cota (m) | Altura (m) | Diafragma | Tramos de pilar | Vigas | Losas y paños (m²) | Muros |
| --- | ---: | ---: | --- | --- | --- | --- | --- |
| N7 | 18 | — | rígido | 40 p3050, 40 p40 | 81 (1100 m) | L-N7 maciza e = 0,25: 1870 | — |
| N6 | 15 | 3 | rígido | 40 p3050, 40 p40 | 81 (1100 m) | L-N6 maciza e = 0,25: 1870 | — |
| N5 | 12 | 3 | rígido | 40 p3050, 40 p40 | 81 (1100 m) | L-N5 maciza e = 0,25: 1870 | — |
| N4 | 9 | 3 | rígido | 40 p3050, 40 p40 | 81 (1100 m) | L-N4 maciza e = 0,25: 1870 | — |
| N3 | 6 | 3 | rígido | 40 p3050, 40 p40 | 81 (1100 m) | L-N3 maciza e = 0,25: 1870 | — |
| N2 | 3 | 3 | rígido | 40 p3050, 40 p40 | 81 (1100 m) | L-N2 maciza e = 0,25: 1870 | — |
| N1 | 0 | 3 | rígido | 40 p3050, 40 p40 | 81 (1100 m) | L-N1 maciza e = 0,25: 1870 | — |
| C | -1,5 | 1,5 | ninguno | — | — | — | — |

Opciones efectivas: ε_geom 1,00e-6 m, ε_snap 0,05 m, zona rígida 0,5, cortante sí, malla 0,75 m, rejilla sí, torsión de equilibrio sí, modificadores {"pilares":{"todos":{"A":2}},"vigas":{"hormigon":{"J":0.1}}}.

## Cargas

| Caso | Acción | Peso propio | ΣFx (kN) | ΣFy (kN) | ΣFz (kN) |
| --- | --- | --- | ---: | ---: | ---: |
| G | G | sí | 0 | 0 | -133400 |
| Q | Q | — | 0 | 0 | -28320 |
| Vx | W | — | 468 | 0 | 0 |
| Vy | W | — | 0 | 585 | 0 |

### Carga vertical por planta

Lo que recibe cada planta (kN, hacia abajo positivo; los tramos de pilar y de muro, en la planta de su cabeza) y, entre paréntesis, por m² de sus losas y paños.

| Planta | G | Q | Vx | Vy |
| --- | ---: | ---: | ---: | ---: |
| N7 | 19120 (10,2) | 4045 (2,16) | — | — |
| N6 | 19120 (10,2) | 4045 (2,16) | — | — |
| N5 | 19120 (10,2) | 4045 (2,16) | — | — |
| N4 | 19120 (10,2) | 4045 (2,16) | — | — |
| N3 | 19120 (10,2) | 4045 (2,16) | — | — |
| N2 | 19120 (10,2) | 4045 (2,16) | — | — |
| N1 | 18660 (9,98) | 4045 (2,16) | — | — |
| C | — | — | — | — |

### Carga horizontal por planta

| Planta | Vx: ΣFx, ΣFy (kN) | Vy: ΣFx, ΣFy (kN) |
| --- | --- | --- |
| N7 | 72; 0 | 0; 90 |
| N6 | 72; 0 | 0; 90 |
| N5 | 72; 0 | 0; 90 |
| N4 | 72; 0 | 0; 90 |
| N3 | 72; 0 | 0; 90 |
| N2 | 72; 0 | 0; 90 |
| N1 | 36; 0 | 0; 45 |
| C | — | — |

## Peso propio

Caso G. Lo esperado es Σ V·γ por tipo de pieza (losas y paños con su pp), calculado sin la malla, menos los solapes que el compilador no cuenta dos veces (C2-g y C3-g, estimados por la huella de las vigas y los muros dentro de las losas). Lo calculado es el caso de peso propio compilado sin las demás cargas. kN.

| Planta | Pilares | Vigas | Losas | Paños | Muros | Solapes | Esperado | Calculado | Diferencia |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| N7 | 930 | 4307 | 11690 | 0 | 0 | -1785 | 15140 | 15140 | -5,3e-13 % |
| N6 | 930 | 4307 | 11690 | 0 | 0 | -1785 | 15140 | 15140 | -5,3e-13 % |
| N5 | 930 | 4307 | 11690 | 0 | 0 | -1785 | 15140 | 15140 | -5,3e-13 % |
| N4 | 930 | 4307 | 11690 | 0 | 0 | -1785 | 15140 | 15140 | -5,3e-13 % |
| N3 | 930 | 4307 | 11690 | 0 | 0 | -1785 | 15140 | 15140 | -5,4e-13 % |
| N2 | 930 | 4307 | 11690 | 0 | 0 | -1785 | 15140 | 15140 | -5,4e-13 % |
| N1 | 465 | 4307 | 11690 | 0 | 0 | -1785 | 14670 | 14670 | -5,6e-13 % |
| Total | 6045 | 30150 | 81810 | 0 | 0 | -12490 | 105500 | 105500 | -5,1e-13 % |

## Bajada por áreas tributarias

Axil de compresión en la cabeza de cada tramo de pilar con la suma de los casos gravitatorios (G + Q), frente a su bajada por áreas tributarias (Voronoi de pilares y muros por planta, cada carga donde cae). Se comparan 560 de 560 tramos. Los que más se separan:

| Pilar | Planta (cabeza) | Axil (kN) | Bajada (kN) | Axil / bajada |
| --- | --- | ---: | ---: | ---: |
| P0-0 | N7 | 85,25 | 98,81 | 0,863 |
| P0-0 | N1 | 676,6 | 759,2 | 0,891 |
| P54-0 | N7 | 86,06 | 96,47 | 0,892 |
| P0-35 | N7 | 88,22 | 98,81 | 0,893 |
| P0-0 | N2 | 581,6 | 649,1 | 0,896 |
| P0-0 | N6 | 188,2 | 208,9 | 0,901 |
| P0-0 | N3 | 486,6 | 539,1 | 0,903 |
| P0-0 | N4 | 388,8 | 429 | 0,906 |
| P0-0 | N5 | 289,1 | 318,9 | 0,907 |
| P54-20 | N7 | 163,1 | 179,4 | 0,909 |
| P0-35 | N1 | 698,9 | 763,7 | 0,915 |
| P54-35 | N7 | 88,45 | 96,47 | 0,917 |

## Hipótesis de modelado

- Nudos de dimensión finita: es rígido el 50 % del nudo (la viga dentro del pilar y el pilar dentro del canto de la viga más alta que le llega).
- Modificadores de rigidez (D4): tramos de pilar de hormigón: A ×2 (560); tramos de viga de hormigón: J ×0,1 (10227).
- Diafragma rígido en N1, N2, N3, N4, N5, N6, N7; sin diafragma en C.
- En las plantas con losas, el diafragma rígido abarca los nudos sobre las losas (los de las huellas, por su pilar); los que quedan fuera, como los pilares de una doble altura, no entran (C2-f).
- Eje de las vigas en el plano del forjado.
- Losas malladas con láminas DKMQ (h = 0,75 m; 33012 láminas; jacobiano escalado mínimo 0,302): rejilla alineada con los ejes de la losa en las zonas regulares, con cuadriláteros de ≤ 0,75 m y 553 plantillas de pilar (31836 láminas, el 96 %), y triangulación restringida de lado 1,5 m dividida en 3 cuadriláteros alrededor de lo que no cae en ella (H52, C2-a).
- Unión pilar–losa por la huella del pilar, rígida (560 huellas, H09). Las vigas embebidas se parten en los nudos de la malla sobre su eje fuera de las huellas, y la zona rígida de la cabeza de los pilares cuenta el espesor de la losa.
- Peso propio de las losas desde su pp (L-N1: 6,25 kN/m²; L-N2: 6,25 kN/m²; L-N3: 6,25 kN/m²; L-N4: 6,25 kN/m²; L-N5: 6,25 kN/m²; L-N6: 6,25 kN/m²; L-N7: 6,25 kN/m²). Las vigas rectangulares de hormigón bajo losa pesan sólo su descuelgue (C2-g, H24).

## Avisos del compilador y del cálculo

Ninguno.

## Firma

El ingeniero firma este informe con «fem firmar <proyecto> --por "<nombre>"», que guarda en proyecto.revision.json, junto al proyecto, la huella 3d095f21cbe2faec…, quién firma, la fecha y el sha256 de este informe. El agente nunca firma.
