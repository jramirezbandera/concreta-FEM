# Fase HR — la huella rígida de todos los pilares (F2-9): resultado

> **Fecha:** 2026-10-19. **Plan:** `huella-rigida.md` (decisiones HR-a…HR-f del usuario). **Compilador HR1.**
>
> **En una frase:** en todos los pilares sólo son rígidos los nudos de la losa dentro de la huella o en su borde; los de fuera a ≤ ε_snap, que C2-d hacía rígidos y ensanchaban el pilar 5 cm (F2-9, F3-5, F3-8, LV2-4), ya no lo son con ninguna opción. Lo contrasta un oráculo externo (la 3 × 3 mezclada en una malla tensorial que no pasa por el mallador, calculada con OpenSeesPy): con la regla antigua la malla fina se separaba hasta un +7,8 % en las caras de los pilares menores, y con la nueva queda a ≤ 0,45 %; con h = 0,75, a ≤ 1,5 % en las caras propias y ≤ 2,5 % en las comunes por dentro. F3-d se fue (no medía nada sin nudos delante), las dos cotas del mallador se quedan como cotas de tamaño y de coste medidas (HR-c, al revés de lo previsto), y la precisión local junto a los pilares corre ya en las pruebas contra una referencia fina congelada.
>
> **Pasan** los criterios 1, 2, 3, 6, 7, 8, 9, 10 y 11; **a medias,** el 4 (el lado inseguro pasa, el seguro conserva el +18 % de F3-9) y el 5 (15 estaciones de cara por encima del 20 % frente a 13, de 652, con la misma mediana).

## 1. Criterios

| # | Criterio (`huella-rigida.md` §4) | Resultado | Pasa |
|---|---|---|---|
| 1 | Ningún nudo rígido fuera de la huella, en ningún pilar ni opción | 0 en los 9 modelos de `huellaRigida.test.ts` con sus 17 variantes, en los 13 de la referencia de F, en las 44 geometrías de G y las 24 retículas al azar con y sin rejilla y con las dos uniones (`geometrias.test.ts`), en la vivienda y en el muestrario. Antes: 83 junto al hueco del edificio, 12 por retícula al azar, 60 en la 3 × 3 con h = 0,1, 191 en el edificio con h = 0,15 (§2 del plan) | Sí |
| 2 | Oráculo externo: la 3 × 3 mezclada en malla tensorial | Motor y OpenSees en la misma malla: 0,31 % de diferencia máxima (son elementos distintos, DKMQ y ASDShellQ4; el plan pedía 1e-6 y se reescribió a ≤ 0,5 %, lo de E6). Con h = 0,75: propias 0,84 / 1,49 %, comunes por dentro 1,91 / 2,47 %; la serie converge (h = 0,1: 0,21 / 0,45 % y 0,49 / 1,11 %). Con la regla antigua, h = 0,1 da 3,53 / 7,79 % (HR-4) | Sí |
| 3 | Las mallas finas se ponen de acuerdo, sin la excepción «ref. con F2-9» | h = 0,15 y 0,1 quedan a ≤ 0,68 y ≤ 1,11 % de la tensorial en todas las caras (antes, las 12 de F3-5 salían un 6–8,5 % altas con 0,1). En la serie de F3, ninguna cara de referencia tiene nudos delante (la marca contaba NaN como sí, HR-9); frente al mismo código de antes (un árbol de trabajo en HEAD), los grupos del edificio dan lo mismo: propias 5,23 → 4,82 % de media, comunes 4,14 → 4,89 %, con los mismos máximos (HR-8) | Sí |
| 4 | Junto al hueco del edificio, con h = 0,75 | Las cuatro caras de F2-9 (P30-15 y P24-20, en y): −5,4…−0,8 % de h = 0,15 (antes, hasta −43 %; con F3-d, −6,3…+3,5 % frente a una referencia que también los tenía). Ninguna de las 16 caras junto al hueco por debajo del −7 %. Pero P24-20 x+ y P30-20 x− dan +18,2 y +16,2 %, del lado seguro: es F3-9 (la triangulación sin refinar junto al hueco), previo, y con h = 0,5 queda a ≤ 3,8 % | A medias: el lado inseguro sí; el seguro, F3-9 |
| 5 | Las 24 retículas al azar no empeoran (`asoma.ts`) | Franjas de los pilares que asoman de su viga (913 estaciones, lo que medía LV2-f), LV2 con h = 0,75 frente a 0,25: mediana 3,9 → 3,8 %, caras > 10 % 105 → 103, caras > 20 % 13 → 15, apoyos > 20 % 0 → 0. Vigas en la cara: 1,2 → 0,9 % de mediana. Con LV1 (que llevaba la regla antigua), las caras > 20 % bajan de 125 a 57. Los pilares sin viga (116 caras): 1,4 / 3,8 % | A medias: 15 frente a 13, de 652; lo demás igual o mejor |
| 6 | Calidad de malla | `out_calidad.txt` idéntico al de antes (la regla no toca la malla, y las dos cotas se quedan); `geometrias.test.ts` sin ningún `malla/calidad` | Sí |
| 7 | Tamaño de los edificios objetivo | Con vigas 153 132 y reticular 204 288 ecuaciones (0 %); losa plana 192 066 → 193 809 (+0,91 %: los nudos que dejan de ser rígidos junto al hueco) | Sí |
| 8 | Determinismo | Las metamórficas de C2–C5 y F y las de refino, sin cambios; la batería entera de `src` en verde | Sí |
| 9 | Referencias congeladas | `validacion/hr/out_cambiosHuella.txt`: bit a bit 31 modelos (C2 9 de 9, C3 5 de 8, C4 5 de 8, C5 2 de 4, F 10 de 13) y regenerados a sabiendas 11, todos con esclavos fuera de la huella antes (C3: los tres `aleatorio-3-muros`; C4: `aleatorio-6-reticular`, `aleatorio-5-mixto`, `-lv`; C5: `pilares-mezclados`, `aleatorio-3`; F: `pilares-mezclados`, `aleatorio-3`, `reticular-2x2-abacos-lv`). En F, los máximos de Wood–Armer se mueven ≤ 0,3 kN·m/m salvo `L-N1:Y1` del reticular con caras: 29,2 → 16,1 (HR-7) | Sí |
| 10 | La vivienda frente a CYPE | Momentos de vano 0,92 / 0,95 / 0,91 / 0,82 (LV2: 0,91 / 0,95 / 0,91 / 0,82), flechas 0,91 / 0,91, axiles a ±10 % salvo P5 (igual) y P6 en Q (+10 %, en el límite). La vivienda no tenía nudos rígidos fuera | Sí |
| 11 | Regresión de precisión local en las pruebas | `precision.test.ts`: las retículas 1, 12 y 16 y la 3 × 3 mezclada con h = 0,75 frente a `__fixtures__/precision-fina.json` (h = 0,25 y 0,1), por grupos (vigas en la cara, franjas con y sin viga), con umbrales medidos y las dos estaciones que no convergen anotadas; 4 pruebas en ~5 s | Sí |

## 2. Lo que ha quedado en el compilador (HR1)

- **La regla (`losas.ts`, C2-d):** esclavos de la huella, los nudos de la malla y de los muros dentro de su polígono o a ≤ 10·ε_geom de su borde, en todos los pilares y con todas las opciones (antes, a ≤ ε_snap; LV2-f ya lo tenía en los pilares bajo una viga). `losa/huellas-solapadas` se detecta por geometría (dos huellas que se solapan, se tocan, se cruzan o quedan a ≤ ε_snap; `huellasSolapadas`), no porque un nudo sea esclavo de dos.
- **F3-d fuera (`esfuerzosFranjas.ts`, HR-b):** sin nudos rígidos delante de ninguna cara, el escalón «con Δx = 0» no medía nada. Se van `huellaDelante`, `conNudosDelante` y el aviso `franja/cara-sin-huella`; el metro de un pilar sin cara de franja por la recta de su cara es siempre el corte directo. El escalón de F3 (la cara común dentro de la huella), el de SP-3/SP-4 y el del pilar tapado siguen: cortan por rectas que atraviesan la huella.
- **Las dos cotas del mallador se quedan (HR-c, al revés de lo previsto), con otra razón y medidas** (HR-5, HR-6): la de F2-e (un lado se refina si su primer tercio llega a 2·ε_snap) es una cota de tamaño, y la de la plantilla de esquina (ningún nudo nuevo a < 1,2·ε_snap de una huella), de coste. Las mallas no cambian ni un nudo.
- **La versión:** compilador HR1; la hipótesis de la unión pilar–losa lo dice.
- **El oráculo de F (`validacion/f/opensees-modelos.ts`):** el mapeo de las restricciones va alineado con el modelo sin pilares (HR-1) y admite un `preparar` del modelo compilado (la regla antigua, emulada); las estaciones llevan sus `piezas`.
- **Nuevo:** `src/pruebas/huellasRigidas.ts` (los esclavos fuera de cada huella, con la huella del tramo de cada planta), `src/pruebas/precisionLocal.ts` (la medida de `asoma.ts`, compartida), `validacion/hr/` (`cambiosHuella.ts`, `tensorial.ts`, `oraculo_huella.py`, `hueco.ts`, `tamano.ts`, `congelar-fina.ts`), `huellaRigida.test.ts` y `precision.test.ts`. `asoma.ts` mide todos los pilares (con viga, sin viga y los que asoman). `validacion/f3/f3d.ts` se fue con F3-d (su `out_f3d.txt` queda).

## 3. Hallazgos

| ID | Hallazgo | Consecuencia |
|---|---|---|
| HR-1 | **El oráculo de F desalineaba el mapeo.** `sinPilares` quita el diafragma del modelo, y `EsfuerzosFranjas` busca el enlace de cada pilar por el índice de la restricción en el mapeo: en la 3 × 3 mezclada, P6-5 caía al respaldo con `franja/cara-comun-dentro` y P12-10 cortaba con el enlace de otro pilar, que no cruza la recta, y daba −25 en vez de −73 kN·m **sin aviso**. En H25 (sin tamaños mezclados) no se notaba | Corregido en `opensees-modelos.ts` (el mapeo filtrado en paralelo). Es del banco, no del compilador: en un modelo compilado el mapeo y el modelo siempre van en paralelo |
| HR-2 | **El motor y OpenSees difieren un 0,31 % en la misma malla tensorial** (28 691 nudos, paso 0,1–0,2 m): el DKMQ y el ASDShellQ4 no son el mismo elemento, como en E6 (≤ 0,5 %) | El criterio 2 pedía 1e-6 y era irreal; se reescribió a ≤ 0,5 % |
| HR-3 | **La huella como parche de láminas 1 000 veces más rígidas, articulada en su centro, da lo mismo que el enlace rígido:** ≤ 0,03 % en las caras propias y ≤ 0,10 % en las comunes por dentro | El enlace rígido en la huella (H09) es una física, no un convenio nuestro |
| HR-4 | **F3-8 frente a un oráculo externo:** con la regla antigua y h = 0,1, las caras de los pilares menores en la línea de un mayor salen +6,3…+7,8 % respecto a la tensorial (las 12 de F3-5: P6-0, P6-10, P6-15, P12-0… en x); con la nueva, ≤ 0,45 %. Con h ≥ 0,15 la regla antigua no tenía nudos fuera en este modelo y las dos dan lo mismo | Es la medida que faltaba en §10 de LV2: B (sólo la huella) converge al oráculo y A no |
| HR-5 | **Sin la cota de F2-e, el refinamiento mete astillas y la guarda tira la plantilla:** en el edificio objetivo con h = 0,75, el tramo de 5 cm entre la cara propia de un 40 × 40 y la línea común de los 30 se partía en tercios de 1,7 cm, salía `malla/cara-sin-refinar` y las caras propias pasaban de 1,4 a 4,6 % de media (máximo 20 %) | La cota se queda, como cota de tamaño (`rejilla.ts`). Con h = 0,125 las plantillas siguen sin refinarse; la tensorial dice que esa referencia está a ≤ 0,45 % |
| HR-6 | **Sin la cota de la plantilla de esquina (1,2·ε_snap), los cruces junto a los pilares que asoman ganan niveles y no mejoran nada:** +3,4 % de ecuaciones en el edificio objetivo con vigas y +2,6 % en el reticular, y en las 24 retículas, 3,9 → 3,8 % de mediana con 13 → 14 estaciones por encima del 20 % | La cota se queda, como cota de coste. Las referencias `-lv2` no se mueven |
| HR-7 | **`L-N1:Y1` del reticular 2 × 2 con caras (LV1) pasa de 29,2 a 16,1 kN·m/m** en la referencia de F: un solo nudo rígido fuera de la huella de P0-5 (un pilar de borde). Con h = 0,375 y 0,25 (LV1) y con LV2 (0,75 y 0,25) el máximo está en 18,0–20,7: el valor antiguo era un 50 % alto, y el nuevo queda un 17 % bajo por la malla de LV1 (LV2 con 0,75 da 19,0) | Regenerada a sabiendas; es el caso de LV2-4 en un pilar sin viga por su centro |
| HR-8 | **El «antes» de la serie de F3 no es el fichero antiguo:** el conjunto de caras del edificio creció desde F3 (F3.3 y SP-3/SP-4 dieron metro a los pilares de borde y sin cara: 192 → 248) y los −20 % de las propias son de esas caras (SP-4, previos). Medido con el mismo código de antes en un árbol de trabajo en HEAD, HR deja los grupos iguales (edificio con h = 0,75: propias 5,23 → 4,82 %, comunes 4,14 → 4,89 %, hueco 3,61 → 5,48 % con 11 → 16 caras) y compara ya las 24 caras que antes se excluían | Para medir un «antes», un árbol de trabajo en el commit anterior, no las salidas antiguas |
| HR-9 | **La marca «ref. con F2-9» de `validacion/f3/convergencia.ts` contaba NaN como sí:** en las caras cuyo corte recto por la cara propia no sigue la malla (la estación va por el escalón desde la recta común), `con / sin` era NaN y la cara quedaba fuera de la comparación. Marcaba 4 caras del edificio con h = 0,15 que no tienen nada delante | Corregida: NaN es «no se puede comprobar». 0 caras marcadas en los tres modelos |
| HR-10 | **Junto al hueco queda F3-9:** P24-20 x+ y P30-20 x− con h = 0,75, +18,2 y +16,2 % (del lado seguro; con h = 0,5, ≤ 3,8 %). No es F2-9: es la triangulación sin refinar junto al hueco | Pendiente, como en F3 |
| HR-11 | **Las peores estaciones de las retículas son las caras de los pilares de borde y de esquina** (retícula 16, `L-N1:Y1 0,300:+1`, −31,6 %; retícula 12, `L-N2:Y1 4,150:−1`, −26,5 %; retícula 1, cuatro caras de borde a −20…−22 %), del lado inseguro, las mismas con LV1 y LV2 | Es la familia de SP-3/SP-4 (caras de borde con h = 0,75), no de esta fase; están anotadas en `precision.test.ts` |

## 4. Cómo ha quedado frente al plan

| Decisión / criterio | Plan | Hecho |
|---|---|---|
| HR-a | Regla sin interruptor, compilador HR1 | Igual |
| HR-b | Quitar F3-d | Igual |
| HR-c | Quitar las dos cotas, medir y, si hace falta, volver a ponerlas como cotas de calidad | Las dos vuelven, con su medida: la de F2-e por tamaño (HR-5) y la de la esquina por coste (HR-6). Las mallas no cambian |
| HR-d | Borde a 10·ε_geom | Igual |
| HR-e | La 3 × 3 mezclada tensorial en OpenSeesPy, con el parche como información | Igual (HR-3 resultó concluyente) |
| HR-f | Tres retículas y la 3 × 3 en vitest con referencia congelada | Igual; la 3 × 3 contra su malla de 0,1 (a ≤ 0,45 % de la tensorial), no contra la tensorial, para medir lo mismo que en las retículas |
| Criterio 2 | OpenSees a ≤ 1e-6 | A ≤ 0,5 % (HR-2) |
| Criterio 4 | ≤ 10 % y ninguna bajo −10 % | El lado inseguro pasa; el seguro conserva F3-9 |
| Criterio 5 | No más estaciones > 20 % que hoy | 15 frente a 13 de 652; mediana y > 10 % mejoran |
| §3.2 | La excepción de la serie de F3 fuera, con una comprobación de 0 | Hecho, más HR-9 |
| §3.5 | Sólo tres modelos de F se mueven | Los tres, y además 8 de C3–C5 con esclavos fuera (muros y forjados al azar) |

## 5. Pendiente

- **F3-9**, el +16…+18 % junto al hueco con h = 0,75 (del lado seguro; `fase-f3.md`).
- **Las caras de los pilares de borde y de esquina con h = 0,75** (HR-11, SP-3/SP-4): hasta −32 % en las retículas al azar.
- **El aviso en los pilares que asoman mientras LV-8 no esté** (punto 5 de la auditoría de LV2) sigue sin hacerse.
- **Lo de LV2** (`fase-lv2.md` §5, puntos 4 a 8): las tres retículas con muros del criterio 4, la plantilla de P2-1, `distanciaMuestras` en la app y la CLI, los globales de `rejilla.ts`.
- **Siguiente:** el `my` de la cubierta de la vivienda (0,82) y P5 (`fase-lv.md` §2).

## 6. Para reproducir

```
bunx vitest run src/compilador/huellaRigida.test.ts src/compilador/esquinas.test.ts src/compilador/geometrias.test.ts   # criterios 1 y 6
bunx vitest run src/compilador/caraPropia.test.ts src/compilador/precision.test.ts src/compilador/refino.test.ts          # criterios 4 y 11, HR-5
bun validacion/hr/tensorial.ts --sin-antigua > validacion/hr/out_tensorial.txt     # criterio 2 (con la regla antigua emulada: out_tensorial_antigua.txt, de antes del paso 4)
.venv312/Scripts/python.exe validacion/hr/oraculo_huella.py                       # criterio 2, OpenSees
bun validacion/f3/convergencia.ts                                                 # criterio 3
bun validacion/hr/hueco.ts > validacion/hr/out_hueco.txt                          # criterio 4
bun validacion/lv2/asoma.ts > validacion/lv2/out_asoma.txt                        # criterio 5
bun validacion/lv2/calidad.ts > validacion/lv2/out_calidad.txt                    # criterio 6
bun validacion/hr/tamano.ts > validacion/hr/out_tamano.txt                        # criterio 7
bun validacion/hr/cambiosHuella.ts > validacion/hr/out_cambiosHuella.txt          # criterio 9 (antes de regenerar las referencias)
bun validacion/hr/congelar-fina.ts                                                # la referencia de precision.test.ts, sólo a sabiendas
```

La vivienda: `validacion/sombra/vivienda/.datos/hr` (los datos del cliente, fuera de git), con `muestrear.ts` y `comparar.py`.
