# Fase F3 — la cara propia de los pilares (F2-8): resultado

> **Fecha:** 2026-10-14. **Plan:** `cara-propia.md` (lo que se fijó al empezar, con los criterios).
>
> **Veredicto: pasan los criterios 1, 3, 4, 5, 6 y 7. Quedan a medias el 2 (1,7 % como máximo, frente al 1 % del plan) y el 8 (+17–20 % de tiempo, frente al +15 %).**
> - **El metro de cada pilar se mide en su cara propia.** En una alineación con pilares de dos tamaños, el del mayor salía en la cara común, dentro de su huella, un 46–49 % bajo de media, del lado inseguro y sin aviso. Ahora se mide por un contorno en escalón que siempre está en la malla.
> - **Con el h por defecto (0,75 m), a ≤ 2 % de la malla fina de media.** En la losa de 3 × 3 con dos pilares mayores: 0,75 % de media y 1,23 % de máximo. En el edificio objetivo reducido: 1,94 / 3,63 %. En el completo, con una referencia más gruesa: 2,27 / 5,03 %.
> - **La malla cambia sólo junto a esos pilares:**
>   - los tercios junto a la cara se toman de un largo de h como mucho;
>   - si hace falta, la esquina va fina y la transición, en su tramo exterior.
>
>   Las caras de siempre quedan como en F2, y las referencias congeladas de C2–C5 y de F no cambian ni un bit.
> - **Un hallazgo grave, previo a F3, sobre F2-9** (§3, F3-5). Con h fino y tamaños mezclados, el metro de los pilares menores también sale hasta un 52 % bajo, sin aviso. El mismo recurso de F3 lo arregla en la estación (§4).
> - **F3-d, hecho el mismo día** (decisión del usuario, §7): el metro de todos los pilares cuenta lo que pasa por los nudos rígidos de su huella delante de la cara.
>   - Junto al hueco del edificio, con h = 0,75, las cuatro caras de F2-9 pasan de −25…−43 % a −6,3…+3,5 % de la malla fina.
>   - La referencia congelada de F no cambia ni un bit, y con h = 0,75 y 0,5 no se mueve ninguna otra cara.
>   - Lo que queda de F2-9 es la rigidez: donde hay nudos rígidos delante, la cara sale un 6–8,5 % alta (del lado seguro), como la de un pilar 5 cm mayor.
>
> **Cómo leerlo:** la tabla resume los criterios del plan, y cada sección da el detalle. Lo que decide el usuario está en §4.

## Criterios

| # | Criterio | Resultado | Evidencia |
|---|---|---|---|
| 1 | Seguridad: ninguna estación de cara de un pilar dentro de su huella; la del metro de cada pilar, en su cara propia | **Pasa.** En la 3 × 3 mezclada, las 64 estaciones con ventana van en la cara propia de su pilar, sin avisos | `caraPropia.test.ts` |
| 2 | Equivalencia: el escalón y el corte recto por la cara propia, a ≤ 1 % | **A medias: ≤ 1,7 %.**<br>• El método, con la misma ventana de nudo a nudo en la red de la plantilla: −0,35 a −1,67 % (P12-10, P42-15, P48-10, P18-10).<br>• La estación, frente al corte recto en la triangulación (h = 0,2) con la cara propia sembrada por una banda: −1,53 a +0,26 %.<br>La diferencia es física: los dos contornos no son el mismo cuerpo libre (§3, F3-1) | `validacion/f3/out_convergencia.txt` |
| 3 | Convergencia con h = 0,75: en las caras con la común dentro, media ≤ 2 % y máximo ≤ 5 %; las de siempre, como en F2 | **Pasa.**<br>• 3 × 3 mezclada, frente a h = 0,1: 0,75 / 1,23 % (antes, 46,4 / 53,0 %).<br>• Edificio reducido (4 × 3 vanos), frente a 0,1: 1,94 / 3,63 % (antes, 48,0 / 49,1 %).<br>• Edificio completo, frente a 0,15 (con 0,1 no cabe; oscila ~1 %): 2,27 / 5,03 %, informativo (antes, 49,0 / 52,0 %).<br>Las propias del edificio: 1,41 / 3,88 %. F2, sin cambios: 3 × 3, 0,86 / 1,35 %; H25, ≤ 1,25 % | `validacion/f3/out_convergencia.txt`; `validacion/f2/convergencia.ts` |
| 4 | Edificio objetivo de 7 plantas con losa plana, ≤ 200 000 ecuaciones | **Pasa:** 67 371 nudos y 185 262 ecuaciones (F2: 61 323 y 167 118, +10 %). Lo añade la esquina fina de los 252 pilares con la cara común dentro (unos 24 nudos por pilar); los tercios de largo h no añaden nudos | `validacion/f3/out_banco.txt` |
| 5 | Ningún aviso de malla en las geometrías de G, los modelos de validación y el edificio objetivo con h = 0,75, 0,5 y 0,375 | **Pasa.** Los 44 modelos de G y el edificio, sin avisos. Con h = 0,5, tres plantillas del edificio van como en F2 (F3-3).<br>El edificio reducido con h = 0,5 tiene un aviso `malla/calidad` junto a los bordes de dos cargas. Ya estaba en F2, también sin refinar: no es de F3 | `geometrias.test.ts`; `caraPropia.test.ts` |
| 6 | Determinismo; las referencias de C2–C5 no cambian; la de F, con un caso mezclado | **Pasa.** La 3 × 3 mezclada da la misma malla al trasladar, girar 90° y 37° y reordenar. Las referencias congeladas de C2–C5 y las seis de F, idénticas. El caso nuevo (`losa-3x3-mezclada`) se genera en Bun y se comprueba en Node | `caraPropia.test.ts`; `congelado-f.test.ts` |
| 7 | Respaldo: sin el enlace de la huella, la estación en la cara común con el aviso | **Pasa:** `franja/cara-comun-dentro` en cada una de esas caras | `caraPropia.test.ts` |
| 8 | Coste del edificio objetivo (compilar, calcular y las franjas), ≤ +15 % frente a F2 | **A medias: +17–20 %.** F2, 16,0–16,8 s; F3, 18,8–19,9 s (tres medidas de cada uno, alternadas). Por partes:<br>• calcular, +20–30 % (la malla es un 10 % mayor);<br>• las franjas, +15 % (dos cortes más por cara con la común dentro, limitados a la ventana: sin el límite, +65 %);<br>• compilar, +10–15 %.<br>Lo que cuesta es la esquina fina: sin ella, el error de esas caras con h = 0,75 se queda en el 5 % de media (F3-2) | `validacion/f3/out_banco.txt` |

Baterías completas: en la raíz pasan 1 716 de 1 717 tests; en la app, los 36. El que falla es `aleatorio-6-reticular (perfil)` de C4, por el tiempo de espera de 60 s con la batería en paralelo. Solo pasa, y tarda lo mismo que con F2: 22 frente a 20 s.

## 1. Qué hay

| Fichero | Qué hace |
|---|---|
| `src/motor/cortes.ts` | La opción `restricciones` del corte: con `soloLaminas`, las restricciones nombradas sí entran, con lo que transmiten a través del plano, como sin `soloLaminas` (E5). Probada en una ménsula con un enlace rígido en medio: exacta a 1e-12 (`cortes.test.ts`) |
| `src/compilador/esfuerzosFranjas.ts` | **El escalón.** En la cara de un pilar cuya cara común cae dentro de su huella, la ventana se mide por la recta común, con lo que transmite el enlace de la huella, y el momento se traslada a la cara propia (My − Δx·Vz).<br>La estación va en s = cara propia. El ancho es el de la ventana en la losa, con la huella; my y mxy salen por campos a δ de la cara propia. Las zonas de apoyo van de cara propia a cara propia.<br>Sin enlace, la de antes con el aviso `franja/cara-comun-dentro` |
| `src/compilador/rejilla.ts` | En la plantilla refinada:<br>• los tercios junto a una cara se toman de un largo de h como mucho;<br>• si la transición de la esquina no cabe más allá en una dirección y allí el tramo es largo, la esquina va fina salvo su tramo exterior, que la lleva hasta el borde del bloque (`finoBorde`).<br>Si la plantilla no tiene calidad, se rehace como en F2 y, si tampoco, se queda sin refinar con el aviso |
| `src/compilador/compilar.ts` | Versión del compilador F3 |
| `src/compilador/caraPropia.test.ts` | Seguridad, convergencia frente a h = 0,1, escalón frente a corte recto, respaldo, malla sin avisos y conforme, metamórficas |
| `validacion/f3/` | `modelos.ts` (la 3 × 3 mezclada), `convergencia.ts` (criterios 2 y 3), `banco.ts` (4 y 8) |
| `src/compilador/esfuerzosFranjas.ts` (coste) | Los dos cortes del escalón (por fuerzas nodales y por campos) sólo en el tramo de la recta que puede tocar la ventana o la huella, con un margen de 2,5h + ε_snap: las franjas del edificio, de 14,1 a 10,0 s |
| `validacion/f/congelar.ts` | El caso `losa-3x3-mezclada` en la referencia congelada de F |

## 2. Cómo se mide

En una cara de lado −1 (el vano en s menores) de un pilar cuya cara propia está en s_p y la común en s_c > s_p (dentro de la huella):

```
            vano            │ s_p        s_c │
                            │                │
  ───── losa ───────────────┼── tira ────────┤  ← la recta común, a los lados
                            │ ┌────────────┐ │
                            │ │  huella    │ │  ← la cara propia, delante
                            │ └────────────┘ │
  ───── losa ───────────────┼── tira ────────┤
```

- **El corte:** por la recta s_c, a todo lo ancho de la losa. Las láminas del lado del vano que la tocan dan lo de los lados, repartido en la ventana como en F-6. El enlace de la huella da lo que transmite a través de la recta: lo que le llega de la losa por sus nudos del lado del vano, es decir, por la cara propia y por los lados de la huella entre las dos rectas.
- **El momento:** se lleva a la recta s_p, con My − Δx·Vz.
- **Lo que no cuenta:** la carga de las dos tiras de 5–10 cm entre las rectas y lo que cruza los bordes de la ventana dentro de ellas (F3-1).

Como el enlace incluye los nudos rígidos a ≤ ε_snap de la huella (F2-9), su momento también cuenta. En la estación de la cara común no contaba.

## 3. Hallazgos

| ID | Hallazgo | Consecuencia |
|---|---|---|
| F3-1 | **El escalón y el corte recto por la cara propia difieren hasta un 1,7 %.** Con la misma ventana, de nudo a nudo, el escalón da un 0,35–1,67 % menos. Los dos cuerpos libres difieren en las dos tiras entre las rectas, y en el borde de la ventana cruza por ellas un momento torsor que no cuenta ninguno de los dos | El criterio 2, a medias. En la estación pesa menos que el reparto de los bordes de la ventana (F-6), que ya oscila ±1–2 % con h ≈ 0,2 (F3-6) |
| F3-2 | **Con el escalón sólo, el error con h = 0,75 era de 9 % de media (hasta −10 %).** La cara propia cae dentro de una celda, a 5–10 cm de su línea:<br>• el primer tramo de la red mide casi la celda (hasta 1,37 m), y sus tercios, 0,46 m;<br>• el bloque acaba en esa celda, así que la transición de la esquina no cabe más allá y la parte lateral de la ventana queda gruesa (como F2-4) | Tercios de un largo de h como mucho, y la esquina fina con la transición en su tramo exterior: 2,4 % de media (frente a h = 0,25) |
| F3-3 | **Con h = 0,5, tres plantillas de F3 no tenían calidad** (P12-20, P36-20 y P48-20 del edificio): una transición de 3 a 1 en una fila de 12,5 cm, aplastada (jacobiano 0,16) | Respaldo en cascada: la de F3, la de F2 y, si tampoco, sin refinar con el aviso. Con F2 ya pasaban |
| F3-4 | **Con la esquina bloqueada en las dos direcciones** (P6-5 de 40 × 40 en la 3 × 3), queda la transición de esquina de F2, y la cara propia no sigue la malla fuera de la huella | Aun así, a ≤ 1,2 % frente a h = 0,1. No se puede comparar con el corte recto con la misma ventana (criterio 2): por eso P6-5 no está en esa tabla |
| F3-5 | **Grave, de F2-9 y previo a F3.** Con h fino y tamaños mezclados, el metro de los pilares menores también sale bajo, sin aviso:<br>• con h ≤ 0,125, la línea de la cara del mayor (5 cm por delante) entra en la rejilla de lado a lado de la losa. Delante de los menores, las láminas pegadas a la cara tienen sus cuatro nudos rígidos y no cuentan: la ventana pierde los 0,3 m centrales (3 × 3 mezclada con h = 0,1: −45 %);<br>• con h = 0,15, en el edificio, la fila de nudos a 5 cm delante de la cara queda justo en ε_snap, y el redondeo hace rígidos a unos sí y a otros no. Lo que entra en ellos pasa por la huella y no por la recta: P12-20 da −25,3 kN·m/m, frente a −53 con h = 0,2 (−52 %). F2 da lo mismo | Con la estación del escalón (la recta con la huella), P12-20 da −54,1 con h = 0,15 (§4). En la validación, esas caras de referencia se detectan (el corte por la cara cambia > 0,5 % con la huella) y no se comparan: 12 en la 3 × 3 y 24 en el edificio |
| F3-6 | **La referencia de h = 0,2 oscila ±1–2 %:** los bordes de la ventana caen en sitios distintos respecto a los nudos (F2-2). En P6-5: −78,5 / −79,0 con h = 0,2 / 0,25, frente a −76,6 con 0,1 | Referencias de h = 0,1 (frente a 0,125, ≤ 0,7 %). El edificio completo no cabe con 0,1: se añade uno reducido de 4 × 3 vanos |
| F3-7 | **Las referencias congeladas de F no cambian ni un bit,** tampoco la de pilares mezclados de C5. En sus modelos, ninguna estación con ventana tiene la cara común dentro de la huella: si la tuviera, su s cambiaría | Se añade la 3 × 3 mezclada |

## 4. Para el usuario

- **F3-d: decidida por el usuario y hecha el 2026-10-14 (§7).** Lo que sigue es la propuesta tal como se hizo.
- **F3-d (propuesta): el metro de todos los pilares, con lo que transmite su huella.** Hoy sólo el escalón cuenta lo que pasa por los nudos rígidos de F2-9. En la cara de un pilar normal, la recta de la cara es la misma, pero lo que entra en los nudos rígidos de delante no se cuenta (F3-5).
  - **Hacerlo** es el mismo corte con el enlace, con Δx = 0.
  - **No cambia la regla de los esclavos** ni las referencias de C2–C5.
  - **Arregla la parte de la estación de F2-9:** en P12-20 con h = 0,15, de −24,9 a −54,1 kN·m/m (con h = 0,2, −59,3).
  - **No arregla** la rigidez que esos nudos dan a la losa (el pilar «crece» 5 cm). Eso sigue siendo la decisión de F2-9.
  - Con h = 0,75 casi no hay esclavos delante de una cara. Habría que medir cuánto cambia la referencia congelada de F, y junto al hueco del edificio, que es donde F2-9 pesa.
- **El coste (criterio 8):** +17–20 % de tiempo y +10 % de ecuaciones en el edificio objetivo con losa plana (185 262, aún en el perfil móvil). Es el precio de la esquina fina en los pilares mayores. La alternativa es quitarla: entonces el error con h = 0,75 en esas caras es del 5 % de media y hasta el 10 %, bajo, del lado inseguro, aunque lejos del −50 % de antes. Por defecto la dejo.
  - **Decidido por el usuario el 2026-10-14:** se acepta el coste y se deja la esquina fina.
- **F2-9** sigue pendiente, como en `fase-f2.md` §4.
- **El punto fijo de los pilares** (la recomendación de la conversación del 2026-10-14): la fase siguiente, si te parece.

## 5. Decisiones por defecto, con sus medidas

| # | Decisión | Por defecto | Medida |
|---|---|---|---|
| F3-a | Dónde se mide el metro de un pilar con la cara común dentro | En su cara propia, por el escalón | 46–49 % → 0,75–2,3 % de media |
| F3-b | Ancho de los medios en el escalón | El de la ventana en la losa, con la huella | Con el de las láminas, los nudos rígidos de F2-9 lo inflarían |
| F3-c | Largo máximo de los tercios junto a una cara | h | F3-2 |
| F3-d | Lo que pasa por los nudos de la huella delante de la cara de un pilar cualquiera (F2-9) | Cuenta (decisión del usuario) | §7 |

## 6. Cómo se reproduce

```
bunx vitest run src/compilador/caraPropia.test.ts src/motor/cortes.test.ts
bun validacion/f3/convergencia.ts      # criterios 2 y 3 (≈ 25 min)
bun validacion/f3/banco.ts             # criterios 4 y 8
bun validacion/f3/f3d.ts               # F3-d, §7 (≈ 10 min)
bun validacion/f/congelar.ts           # sólo a sabiendas
```

## 7. F3-d: el metro de todos los pilares con lo que transmite su huella

> **Fecha:** 2026-10-14. **Decisión del usuario:** hacerlo ya, midiendo antes cuánto mueve la referencia congelada de F y qué pasa junto al hueco del edificio.

### 7.1 Qué se hizo

En `esfuerzosFranjas.ts`, la cara de un pilar cuya cara común es la suya:
- **Con nudos de la huella delante de la cara**, del lado del vano: los que la compilación hace rígidos a ≤ ε_snap de la huella (C2-d, F2-9). Se mide con el corte del escalón, pero sin traslado (Δx = 0):
  - la recta con lo que transmite el enlace;
  - el ancho de la ventana en la losa, con la huella (F3-b);
  - my y mxy, los de la recta.

  Si el corte no vale, queda la estación de antes con el aviso `franja/cara-sin-huella`. Nunca en silencio.
- **Sin nudos delante**, el enlace no transmite nada a través de la recta (el corte no lo incluye), así que es la estación de siempre y no se recalcula. Por eso nada cambia fuera de F2-9.
- El escalón de cada pilar se calcula una vez por cara, aunque lo toquen dos franjas.
- La opción `huellaDelante: false` de `EsfuerzosFranjas` es sólo para medir.

La malla, la regla de los nudos rígidos y el compilador (F3) no cambian.

### 7.2 Lo medido (`validacion/f3/out_f3d.txt`)

**La referencia congelada de F no se mueve ni un bit.** En sus 7 modelos (11 232 estaciones), ninguna cambia, y ninguna da avisos nuevos. Ninguno tiene nudos de una huella delante de una cara.

**Junto al hueco del edificio** (una planta, losa plana, h = 0,75), F3-d mueve las cuatro caras de F2-9 (cada una en las dos franjas que tocan el pilar). La referencia es h = 0,15 con F3-d:

| Cara | Sin F3-d | Con F3-d | Referencia | Con h = 0,5 |
|---|---|---|---|---|
| P30-15, y− | −27,04 (−43,1 %) | −48,16 (+1,4 %) | −47,50 | −46,71 |
| P30-15, y+ | −23,82 (−33,4 %) | −37,02 (+3,5 %) | −35,78 | −35,13 |
| P24-20, y− | −32,17 (−24,7 %) | −41,64 (−2,5 %) | −42,70 | −40,60 |
| P24-20, y+ | −35,04 (−32,5 %) | −48,67 (−6,3 %) | −51,94 (sin F3-d, −25,71) | −48,38 |

Valores en kN·m/m, suma de los casos. La referencia de P24-20 y+ también tiene nudos rígidos delante; por F3-8, sale alta.

Por grupos, con h = 0,75:

| Grupo | Caras | Sin F3-d | Con F3-d |
|---|---|---|---|
| Junto a un hueco (referencia sin F2-9) | 15 | 11,93 / 43,07 % (peor, −43,07 %) | 5,68 / 26,68 % (peor, **+26,68 %**, P24-20 x+: F3-9) |
| Propias | 91 | 1,41 / 3,88 % | igual, bit a bit |
| Común por dentro | 66 | 2,27 / 5,03 % | igual, bit a bit |

- **Con h = 0,75 y 0,5** F3-d no mueve ninguna otra cara: ni en la 3 × 3 mezclada, ni en el edificio reducido, ni en el resto del edificio.
- **Donde sí actúa es en las mallas finas de referencia** (F3-5): mueve 12 caras de la 3 × 3 con h = 0,1, 3 del edificio reducido con h = 0,1 y 20 del edificio con h = 0,15, que pasan de la mitad (−50 %) a lo de §7.3.
- **El coste es nulo** con el h por defecto: comprobar si un enlace tiene nudos delante es un recorrido de sus nudos, y el corte sólo se repite en las caras con F2-9.

### 7.3 Hallazgos

| ID | Hallazgo | Consecuencia |
|---|---|---|
| F3-8 | **Con F3-d, una cara con nudos rígidos delante sale un 6–8,5 % alta,** del lado seguro. En la 3 × 3 con h = 0,1, las 12 caras de F3-5 pasan de −25,4 a −52,0 kN·m/m (P6-0), frente a −48,8 con h = 0,15, −49,0 con 0,2, −48,8 con 0,5 y −48,6 con 0,75. Esas cuatro mallas no tienen nudos delante y coinciden entre sí a ~1 %. F3-d mide bien lo que cruza la cara, pero la malla tiene un pilar 5 cm mayor: más rígido, y con la cara 5 cm dentro de su apoyo | Lo que queda de F2-9 es la rigidez, y sigue siendo decisión del usuario (`fase-f2.md` §4). En la validación, las caras cuya referencia fina tiene F2-9 se dan aparte («ref. con F2-9»): con h = 0,75, su 7 % de media es el exceso de la referencia, no un error de la malla gruesa |
| F3-9 | **Con h = 0,75, junto al hueco queda un +26,7 %** en P24-20 x+ (−46,59 frente a −36,78), y +17 % en P30-20 x−. F3-d no lo mueve: no es de F2-9 sino de la triangulación sin refinar junto al hueco (F2, §4). Es del lado seguro; con h = 0,5, ≤ 4,9 % | Sin cambio. El peor error del lado inseguro junto al hueco pasa de −43,1 % a −6,3 % |

### 7.4 Validación

- `src/compilador/caraPropia.test.ts`:
  - en el edificio de una planta con h = 0,75, F3-d mueve sólo las cuatro caras de F2-9 junto al hueco (8 estaciones), a ≤ 7 % de la referencia (sin él, > 20 % bajas);
  - las demás estaciones, bit a bit;
  - ningún aviso `franja/cara-sin-huella`.
- `src/compilador/congelado-f.test.ts`: sin cambios.
- `validacion/f3/f3d.ts`: lo de §7.2 y F3-8.
