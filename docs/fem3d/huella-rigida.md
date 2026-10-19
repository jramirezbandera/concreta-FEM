# Fase HR — la huella rígida de todos los pilares (F2-9)

> **Fecha:** 2026-10-19. **Origen:** F2-9 (`fase-f2.md` §3 y §4), F3-5 y F3-8 (`fase-f3.md`), LV2-f y la auditoría de LV2 (`refinamiento-vigas.md` §9 y §10) y los puntos 1, 2 y 3 de los pendientes de LV2 (`fase-lv2.md` §5). Decidido por el usuario el 2026-10-19 como siguiente paso.
>
> **El problema:** C2-d hace rígidos con el pilar los nudos de la losa a ≤ ε_snap (5 cm) del borde de su huella, no sólo los de la huella. El pilar «crece» 5 cm, y ese exceso no se va al refinar: en los pilares que asoman de su viga, la viga salía en la cara hasta un 21 % alta y las franjas hasta un 78 % bajas (LV2-4); en los demás, la cara sale un 6–8,5 % alta (F3-8) y las mallas finas con tamaños mezclados dan un metro un 45–52 % bajo (F3-5, corregido en la estación por F3-d). LV2-f lo arregló sólo en los pilares con viga, y la auditoría dejó dicho que B (sólo la huella) es la física razonable, pero no está contrastada con un oráculo externo.
>
> **Objetivo:** que en todos los pilares sólo sea rígida la huella de verdad, que lo que cuelga de la regla antigua (el escalón de F3-d y las cotas del mallador) quede como corresponda, que haya un oráculo externo de la rigidez de la huella y una regresión de precisión local con umbrales que corra en las pruebas.
>
> **Este documento** fija, antes de empezar, lo medido, cómo se hace, qué tiene que pasar y lo que decide el usuario. **El resultado está en `fase-hr.md`** (2026-10-19), con lo que cambió por el camino: las dos cotas de HR-c se quedan como cotas de tamaño y de coste, el criterio 2 pide ≤ 0,5 % frente a OpenSees (elementos distintos) y F3-d se fue.

## 1. Lo que hay hoy

### 1.1 La regla

En `losas.ts` (C2-d), los candidatos a esclavo de la huella de un pilar son los nudos de la malla y de los muros de la planta, y entran los que caen dentro del polígono de la huella o a `tol` de su borde:
- **`tol = ε_snap`** (0,05 m) en todos los pilares;
- **`tol = 10·ε_geom`** (1e-5 m: el borde de la huella) sólo con `unionLosaViga: "cara"` y `refinoEsquinas`, en los pilares con el ancho de una viga sobre su centro o su borde (LV2-f).

La tolerancia ε_snap venía de la topología (H28): es la que une lo dibujado. Pero cuando se asignan los esclavos ya no hay nada que unir: el arreglo plano ya ha juntado lo que estaba a ≤ ε_snap, y los puntos que quedan a esa distancia de una huella son de la siembra, de la rejilla o del refinamiento de Delaunay, es decir, puntos de la malla que están donde están a propósito. Hacerlos rígidos no cierra ninguna tolerancia: ensancha el pilar.

### 1.2 Lo que cuelga de la regla

| Dónde | Qué | Por qué está |
|---|---|---|
| `rejilla.ts`, `mallado.ts` (`separacionRefino` = 2·ε_snap) | Un lado de la plantilla de F2 sólo se refina si su primer tercio mide ≥ 0,1 m (F2-e, F2-3) | Con h = 0,125 el primer tercio quedaba a < ε_snap de la huella y se hacía rígido: el metro salía un −30 % |
| `rejilla.ts`, `lejosDeHuellas` (1,2·ε_snap) | La plantilla de esquina de LV2 rechaza un nudo nuevo de dentro de la losa a < 0,06 m de cualquier huella | Para que no se haga rígido. Limita los niveles junto a un pilar que asoma (§13 de LV2: P6-5 se queda con un nivel) |
| `esfuerzosFranjas.ts` (F3-d: `conNudosDelante`, `huellaDelante`, aviso `franja/cara-sin-huella`) | En la cara de un pilar con nudos rígidos delante, el metro se mide por el escalón con Δx = 0 para contar lo que entra por esos nudos | F3-5: sin ello, el metro de los pilares menores con h fino salía un 52 % bajo |
| `validacion/f3/convergencia.ts` | Las caras cuya referencia fina tiene nudos rígidos delante se dan aparte («ref. con F2-9») | F3-8: la referencia sale un 6–8,5 % alta y no sirve para medir la malla gruesa |
| `fase-f2.md` §4 | Las referencias de validación con tamaños mezclados van con h ≥ 0,15 | Con h ≤ 0,125 la línea de la cara del mayor entra en la rejilla a 5 cm de la del menor |
| `caraPropia.test.ts` | Comprueba que F3-d mueve las cuatro caras junto al hueco del edificio y nada más | Es la prueba de F3-d |
| `esquinas.test.ts` | Con LV2, ningún nudo rígido fuera de la huella de un pilar con viga; con LV1, más de 100 | Es la prueba de LV2-f |
| `losas.ts`, error `losa/huellas-solapadas` | Se detecta porque un nudo es esclavo de dos huellas | Con `tol = ε_snap` dos huellas a < 5 cm comparten esclavos; con el borde, puede que no |

### 1.3 De dónde salen los nudos a ≤ ε_snap de una huella

- **La triangulación junto a un hueco o un borde** (F2-9): la siembra graduada y el refinamiento de Delaunay ponen puntos a centímetros de las huellas que no van en una plantilla (junto al hueco del edificio, 42 y 41 en P30-15 y P24-20).
- **Las mallas finas con tamaños mezclados** (F3-5): con h ≤ 0,125 la línea de la cara del mayor cruza la rejilla a 5 cm de la cara del menor; con h = 0,15 la fila de nudos a 5 cm queda justo en ε_snap y el redondeo decide.
- **Lo que asoma un pilar de su viga** (LV2-4): nudos de la triangulación y de las tiras a centímetros de la huella. Ya resuelto en los pilares con viga por LV2-f; quedan los pilares sin viga por su centro (por ejemplo, los que tienen una viga sólo por un lado, o ninguna).
- **Vigas más anchas que el pilar** (C1-a): los nudos de las caras de la viga en su zona rígida se unen a la huella a propósito con `unirCaras`, aunque estén a más de ε_snap. No son de esta fase y no cambian.

## 2. Lo medido antes de empezar

Con un script provisional (no se guarda): por modelo, las huellas con algún esclavo fuera de ellas (a más de 10·ε_geom del borde) y cuántos, con la regla de hoy. Los nudos a más de ε_snap son los de las caras de las vigas (C1-a) y se dan aparte.

| Modelo | Huellas | Con rígidos fuera | Nudos fuera (≤ ε_snap) | Peores |
|---|---|---|---|---|
| Referencia de F: `h25-plana`, `h25-reticular`, `losa-3x3-refinada`, `h25-plana-sin-refinar`, `losa-3x3-mezclada`, `reticular-2x2-abacos`, `aleatorio-3-lv`, `aleatorio-3-lv2`, `reticular-2x2-abacos-lv2`, `edificio-2x2-lv2` | — | 0 | 0 | No cambian ni un bit |
| Referencia de F: `pilares-mezclados` | 12 | 1 | 17 | P12-10: 17 |
| Referencia de F: `aleatorio-3` | 8 | 3 | 8 | P1-0: 4; P0-1: 2; P1-1: 2 |
| Referencia de F: `reticular-2x2-abacos-lv` | 3 | 1 | 1 | P0-5: 1 |
| Edificio objetivo, 1 planta, losa plana | 80 | 2 | 83 | P30-15: 42; P24-20: 41 (junto al hueco) |
| Ídem con `franjas: false` | 80 | 0 | 0 | F2-9 contaba 99 en el edificio; hoy, 0 |
| Edificio objetivo, 1 planta, con vigas (LV2 y LV1) | 40 | 0 | 0 | — |
| Retícula de 4 × 4 de LV (LV2) | 8 | 0 | 0 | Con LV1, 3 |
| Retículas al azar 1, 12 y 16 (LV2) | 30, 12, 24 | 4, 2, 4 | 12, 12, 12 | Pilares sin viga por su centro: P1-4, P1-1, P2-4 (4–6 por planta) |
| Losa 3 × 3 mezclada, h = 0,75 y 0,15 | 16 | 0 | 0 | — |
| Losa 3 × 3 mezclada, h = 0,1 | 16 | 6 | 60 | 10 por pilar menor en la línea del mayor (F3-5) |
| Edificio objetivo, 1 planta, losa plana, h = 0,15 | 80 | 22 | 191 | P42-35: 20; otros, 15 (la fila en ε_snap de F3-5) |
| Vivienda de Alhaurín | 12 | 0 | 0 | — |
| Muestrario | 24 | 2 | 8 (+ 8 de caras de viga) | P6 y P7 de PB: 4 cada uno |

Lo que ya se sabía y la fase tiene que reproducir sin la regla:
- **F3-8:** en la 3 × 3 mezclada, las 12 caras de F3-5 dan −52,0 kN·m/m con h = 0,1 (con nudos delante) frente a −48,6…−49,0 con 0,15, 0,2, 0,5 y 0,75 (sin ellos): el 6–8,5 % es el pilar 5 cm mayor.
- **LV2-4:** en las 24 retículas al azar, con la regla de hoy la viga en la cara de un pilar que asoma sale hasta un 21 % alta y las franjas hasta un 78 % bajas, también con h = 0,25; con sólo la huella, ±3–11 %.
- **F3-d:** junto al hueco del edificio, con h = 0,75, las cuatro caras de F2-9 quedan a −6,3…+3,5 % de la referencia (h = 0,15 con F3-d), y la referencia de P24-20 y+ también tiene nudos delante.
- **Calidad:** la malla no cambia con la regla (los esclavos se eligen después de mallar), y el jacobiano mínimo ya cuenta los cuadriláteros de fuera de las huellas, rígidos o no. Lo que puede cambiar la malla son las cotas de §1.2, si se quitan (HR-c).

## 3. Cómo se hace

### 3.1 La regla nueva

En `losas.ts`, para todos los pilares y en todas las variantes (`unionLosaViga`, `refinoEsquinas`, `rejilla`, `franjas`): son esclavos de la huella los nudos de la malla y de los muros de la planta que caen dentro de su polígono o a ≤ 10·ε_geom de su borde. Es la regla de LV2-f, sin la condición de la viga. Lo de `unirCaras` (C1-a) no cambia: las caras de una viga en su zona rígida siguen yendo a la huella.

El error `losa/huellas-solapadas` pasa a comprobarse por geometría (dos huellas de la planta que se solapan o quedan a ≤ ε_snap), no por compartir esclavos, para que no dependa de que haya un nudo entre las dos. El caso de `invalidos-c2.ts` sigue dando el mismo error.

### 3.2 Lo que se quita o cambia

| Qué | Propuesta | Decisión |
|---|---|---|
| F3-d (`conNudosDelante`, `huellaDelante`, `franja/cara-sin-huella`) | Quitarlo. Con la regla nueva ningún nudo rígido queda delante de una cara: los del borde los siembra el arreglo sobre el polígono de la huella, a 0 de la recta de la cara. Es un camino que no entra nunca, y un camino que «no entra nunca» es lo que menos se quiere en el medidor. (Si se queda, `conNudosDelante` tiene que admitir la holgura del borde, 10·ε_geom, que es mayor que `TOL_CORTE` = 1e-6.) El escalón de F3 (la cara común dentro de la huella), el de SP-3/SP-4 y el del pilar tapado (§14 de LV2) siguen: cortan por rectas que atraviesan la huella, con los nudos de dentro, y no dependen de los de fuera | HR-b |
| `separacionRefino` (2·ε_snap, F2-e) | Quitar la cota: un lado se refina siempre que la plantilla pase la guarda de calidad (convexa y jacobiano ≥ 0,2, F2-d), que es la que debe decidir. Cambia las mallas finas de referencia (con h = 0,125 se refinan) y hay que repetir la serie de convergencia de F2/F3 | HR-c |
| `lejosDeHuellas` (1,2·ε_snap) | Dejar sólo el rechazo de un nudo que cae dentro de una huella (conformidad); quitar la distancia. Mide cuántos cruces ganan niveles (P6-5 de la retícula de LV2) | HR-c |
| «ref. con F2-9» en `validacion/f3/convergencia.ts` | Quitar la excepción: la referencia fina ya no tiene nudos delante. Se deja una comprobación de que son 0 | — |
| «tamaños mezclados con h ≥ 0,15» (`fase-f2.md` §4) | Deja de hacer falta: la serie de F3 se mide también con 0,1 y 0,125 | — |
| `caraPropia.test.ts` | La prueba de F3-d se sustituye por la de la fase: junto al hueco del edificio, con h = 0,75 y sin F3-d, las cuatro caras a ≤ 10 % de la referencia fina nueva | — |
| `esquinas.test.ts` | Pasa a comprobar 0 nudos rígidos fuera de la huella en todos los pilares, con todas las opciones; la comprobación de «con LV1, más de 100» se quita | — |

### 3.3 El oráculo externo de la rigidez de la huella

Hasta ahora las referencias de F2-9 eran nuestras mallas finas con nuestra regla, así que «no converge» quería decir que A y B convergen a soluciones distintas (§10 de LV2). Hace falta una referencia que no pase por el mallador ni por la regla:
- **La malla tensorial:** la losa de 3 × 3 vanos mezclada de F3 (30 × 30 con un 40 × 40 y un 30 × 50: tiene las caras propias, las comunes dentro y pilares de borde), mallada en TypeScript con una retícula tensorial: líneas en todas las caras de todas las huellas, en los bordes de las ventanas del metro de cada pilar, y un relleno uniforme de ≤ 0,1 m entre ellas, graduado hacia las caras (0,1 m como mínimo desde la cara: ningún nudo a ≤ ε_snap fuera de una huella). Se escribe como `ModeloAnalitico` (`validacion/hr/tensorial.ts`), con el enlace rígido sólo en los nudos de la huella y el pilar como apoyo fijo en su maestro, como hace `opensees-modelos.ts` de F.
- **OpenSeesPy ASDShellQ4** calcula esa malla con el resolutor de E6 (`rigidLink` en los nudos de la huella), y el metro de cada cara se calcula en Python con la definición de `oraculo_franjas.py` (la recta de la cara es una línea de la malla y los bordes de la ventana, nudos). El motor calcula la misma malla y tiene que coincidir con OpenSees a ≤ 1e-6 relativo: eso cierra la implementación de la restricción y del corte.
- **La comparación que decide:** nuestras mallas compiladas de la misma losa, con h = 0,75, 0,5, 0,25, 0,15 y 0,1, con la regla nueva, frente a la tensorial, en las caras con demanda. Y las mismas mallas con la regla de hoy (reproducida en el banco con un interruptor que no entra en el compilador: los esclavos se vuelven a elegir sobre el modelo compilado), para que el 6–8,5 % de F3-8 aparezca como lo que es, un error frente a un oráculo externo, y no como una diferencia entre dos convenios nuestros.
- **Una variante de física,** sólo informativa: la huella como parche de láminas 1 000 veces más rígidas en vez de enlace rígido, en la misma malla tensorial. Si el metro en la cara difiere en más del 2–3 %, el propio enlace rígido en la huella (H09) es discutible y se anota; no es criterio de la fase.
- **La retícula con vigas** no entra en el oráculo: la unión por las caras y el enlace al eje de la viga en OpenSees exigen más de lo que esta fase mide. Sus referencias siguen siendo nuestras mallas finas (`asoma.ts`), que ya no tienen nudos rígidos fuera.

### 3.4 La regresión de precisión local

Hoy las medidas de precisión local (`asoma.ts`, `franjas.ts`, las series de convergencia) son bancos que se lanzan a mano y tardan minutos. Lo que entra en las pruebas:
- **`validacion/hr/congelar-fina.ts`** escribe `validacion/hr/referencia-fina.json` (regenerable sólo a sabiendas, como la referencia de F): para tres retículas al azar (la 1, la 12 y la 16, que son las que más pilares con rígidos fuera tienen con LV2) y la 3 × 3 mezclada, los valores de la malla fina (h = 0,25 en las retículas; la tensorial en la 3 × 3) en las estaciones que ya mide `asoma.ts` (vigas en la cara de sus pilares, estaciones de cara y de apoyo de las franjas junto a cada pilar), con sus escalas.
- **`src/compilador/precision.test.ts`** compila esos modelos con h = 0,75, calcula y compara con el JSON: por grupo (vigas en cara, metros de pilar, apoyos), la mediana, el máximo y cuántas pasan del 10 y del 20 %, con umbrales fijados en esta fase a partir de lo medido (y las estaciones que no convergen, listadas por id como excepciones, nunca en silencio). Presupuesto: ≤ 60 s en Bun; si no cabe, dos retículas.
- `asoma.ts` sigue como banco de las 24 retículas, ampliado a los pilares sin viga por su centro (hoy sólo mide los que asoman de una viga).

### 3.5 Versión y referencias congeladas

- **Compilador HR1.** La regla es física, no una opción: no se añade un interruptor para volver a la de antes (HR-a). Lo de antes queda en git.
- **Referencia congelada de F:** se regenera a sabiendas. Según §2, sólo `pilares-mezclados`, `aleatorio-3` y `reticular-2x2-abacos-lv` pueden moverse; los otros diez tienen que salir bit a bit, y `out_cambiosHuella.txt` lista cada estación que cambia con su valor antes y después. Si se quita `separacionRefino` (HR-c), con h = 0,75 no debería cambiar ninguna malla (en F2 y F3 los tercios medían 0,24–0,46 m, por encima de los 0,1 m de la cota), pero se comprueba en el paso 2 contando los lados que la cota rechaza hoy.
- **Referencias de C2–C5:** `congelado-c2…c5.test.ts` se corren antes de tocar nada con un contador de esclavos fuera de la huella; las que dan 0 no cambian y se comprueba; las que no, se regeneran a sabiendas con su lista.

## 4. Criterios

| # | Criterio | Cómo se mide |
|---|---|---|
| 1 | **Ningún nudo rígido fuera de la huella:** en todos los pilares, con todas las opciones, en los modelos de validación, las 44 geometrías de G, las 24 retículas al azar, la vivienda y el muestrario, 0 esclavos a más de 10·ε_geom del borde, salvo los de las caras de las vigas en su zona rígida (C1-a) | `esquinas.test.ts` ampliado; el recuento de §2 |
| 2 | **Oráculo externo:** en la 3 × 3 mezclada, el motor y OpenSees coinciden en la malla tensorial a **≤ 0,5 %** (son elementos distintos, DKMQ y ASDShellQ4: E6 daba ≤ 0,5 % en la misma malla; el plan pedía 1e-6 y era irreal); nuestra malla con h = 0,75 queda a **≤ 3 %** del oráculo en las caras con demanda (media ≈ 1,5 %) y la serie 0,5 → 0,1 converge a él; con la regla de hoy, la serie no converge (F3-8 aparece frente al oráculo) | `validacion/hr/tensorial.ts`, `oraculo_huella.py` |
| 3 | **Las mallas finas se ponen de acuerdo:** en la 3 × 3 mezclada, las 12 caras de F3-5 con h = 0,1, 0,125, 0,15 y 0,2 difieren entre sí ≤ 2 % (hoy, la de 0,1 sale un 6–8,5 % alta) | Serie de `validacion/f3/convergencia.ts`, sin la excepción «ref. con F2-9» |
| 4 | **Junto al hueco del edificio:** las cuatro caras de F2-9 con h = 0,75, sin F3-d, a **≤ 10 %** de la referencia fina nueva (h = 0,15), y ninguna del lado inseguro por debajo del −10 % | `caraPropia.test.ts` reescrito; `validacion/f3/f3d.ts` |
| 5 | **Las retículas al azar no empeoran:** en las 24 retículas, con h = 0,75 frente a 0,25, las vigas en la cara y las franjas junto a todos los pilares (con y sin viga) no tienen más estaciones por encima del 20 % que hoy (36 de 536 en las que asoman), y la mediana no sube | `asoma.ts` ampliado |
| 6 | **Calidad de malla:** ningún aviso `malla/calidad` nuevo y el jacobiano mínimo no baja en las 44 geometrías, las 24 retículas, los modelos de validación y los edificios objetivo. Si se quitan las cotas (HR-c), lo mismo con h = 0,125 y 0,1 | `geometrias.test.ts`, `validacion/lv2/calidad.ts` |
| 7 | **Tamaño:** los tres edificios objetivo (con vigas 153 132, reticular 204 288, losa plana 192 066 ecuaciones) a **≤ +1 %**; la regla no cambia la malla y sólo libera unos pocos grados de libertad | `validar.ts` de F, criterio 5 |
| 8 | **Determinismo:** la misma malla y los mismos esclavos al trasladar, girar, reordenar y con ruido < ε_geom, y en V8 y JavaScriptCore | Metamórficas de C2–C5 y F |
| 9 | **Referencias congeladas:** las de F y de C2–C5 sin nudos fuera (§2), bit a bit; las demás, regeneradas a sabiendas con la lista de lo que cambia | `congelado-*.test.ts`, `out_cambiosHuella.txt` |
| 10 | **La vivienda:** frente a CYPE no empeora (momentos de vano 0,92 / 0,95 / 0,91 / 0,82, flechas 0,91, axiles ±10 % salvo P5) | `validacion/sombra/vivienda/` |
| 11 | **Regresión en las pruebas:** `precision.test.ts` pasa con sus umbrales en ≤ 60 s y falla si se vuelve a la regla de hoy en el modelo compilado | Prueba nueva |

## 5. Decisiones para el usuario

> **Decididas el 2026-10-19 por el usuario:** las seis como se proponían (regla sin interruptor, F3-d fuera, las dos cotas fuera con la guarda de calidad, borde a 10·ε_geom, la 3 × 3 mezclada tensorial en OpenSeesPy y la regresión en vitest).

| # | Decisión | Propuesta | Por qué |
|---|---|---|---|
| HR-a | ¿Opción o regla? | **Regla, sin interruptor:** la huella rígida es la de verdad en todos los pilares y todas las opciones (compilador HR1). La de antes queda en git | Es física, no una variante de malla: con un interruptor «antiguo» queda un modo que da las franjas hasta un 78 % bajas sin aviso (regla de oro 1). Lo que se pierde es reproducir bit a bit las tres referencias de F que se mueven y las de C2–C5 que tengan esclavos fuera, que se regeneran a sabiendas con su lista. La alternativa es colgarla de `refinoEsquinas`, como LV2-f: `false` seguiría dando LV1 bit a bit, pero F3-d tendría que quedarse vivo para ese modo |
| HR-b | El escalón de F3-d | **Quitarlo** (§3.2). Si HR-a se decide como opción, se queda tal cual, inerte con la regla nueva y con una prueba de que no entra | Sin nudos delante no mide nada; dejarlo es dejar un camino sin prueba |
| HR-c | Las cotas 2·ε_snap (F2-e) y 1,2·ε_snap (`lejosDeHuellas`) | **Quitarlas,** dejando la guarda de calidad y el rechazo de los nudos que caen dentro de una huella. Medir antes cuánto cambian las mallas finas y los cruces junto a pilares que asoman | Las dos están por la rigidez, y la calidad ya tiene su guarda (F2-d). Con h = 0,75 no debería cambiar ninguna malla (se comprueba, §3.5). Si una malla fina empeora de calidad, se vuelve a poner una cota, pero como cota de calidad y medida |
| HR-d | La tolerancia del borde | **10·ε_geom,** la de LV2-f | Un nudo del borde de la huella está sobre su polígono (lo sembró el arreglo). Más holgura vuelve a ser la regla de antes a otra escala |
| HR-e | El oráculo externo | **La 3 × 3 mezclada en malla tensorial, en OpenSeesPy** (§3.3), con la variante del parche rígido sólo como información | Es el modelo de F3-5 y F3-8, tiene caras propias, comunes dentro y de borde, y la tensorial no pasa por el mallador. Un recuadro de un solo pilar sería más barato pero no tiene tamaños mezclados |
| HR-f | La regresión en las pruebas | **Tres retículas y la 3 × 3 en vitest** con la referencia fina congelada (§3.4), y `asoma.ts` como banco de las 24 | Es una referencia congelada más (regla de oro 1). Un CI aparte con `asoma.ts` entero tarda minutos y nadie lo mira |

## 6. Fuera de la fase

- **El mallador junto a las huellas** (la segunda salida de `fase-f2.md` §4: no poner nudos a < ε_snap de una huella). Con la regla nueva deja de ser un asunto de rigidez; si la calidad lo pide (criterio 6), se trata como calidad, con su medida.
- **El `my` de la cubierta de la vivienda y P5** (`fase-lv.md` §2): justo después de esta fase.
- **Los pilares que asoman mientras LV-8 no esté** (punto 5 de la auditoría): el aviso, si sigue haciendo falta tras el criterio 5.
- **Las tres retículas con muros del criterio 4 de LV2,** la plantilla de P2-1 en la retícula 5, `distanciaMuestras` en la app y la CLI, y los globales `UMBRAL_REFINO` y `PLANTILLA_ESQUINA`.
- **El pilar unido al muro en toda su altura** (C3-c): no cambia.

## 7. Orden

1. El recuento del criterio 1 como prueba (falla hoy en los modelos de §2) y la regla nueva en `losas.ts`, con `losa/huellas-solapadas` por geometría.
2. Las referencias congeladas: correr todas, listar lo que cambia (`out_cambiosHuella.txt`) y regenerar a sabiendas.
3. La malla tensorial y el oráculo de OpenSees (criterio 2), y la serie de F3 sin la excepción (criterio 3).
4. F3-d y las cotas, según HR-b y HR-c, con sus medidas (criterios 4 y 6).
5. `asoma.ts` ampliado a los pilares sin viga (criterio 5), la vivienda (criterio 10) y el tamaño (criterio 7).
6. La referencia fina congelada y `precision.test.ts` (criterio 11).
7. El informe `fase-hr.md`, `compilador.md` y `CLAUDE.md`.
