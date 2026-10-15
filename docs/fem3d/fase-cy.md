# Fase CY — informe: las hipótesis de CYPECAD

> **Fecha:** 2026-10-15. **Plan:** `hipotesis-cype.md` (lo fijado al empezar, las citas de la memoria de CYPECAD y los criterios).
>
> **Resultado:** CY1–CY3 hechas y validadas: el Ecm del Código Estructural, el empotramiento parcial de la cabeza de los pilares (0,3) y el reticular con la rigidez de CYPECAD, todos por defecto y con opción para volver a lo de antes. Pasan los criterios 1–6 y 8.
>
> El 7, la vivienda frente al modelo CYPECAD del usuario, no pasa con estas tres hipótesis: momentos de vano y flechas al ~0,87 de CYPE. **Pasa con una cuarta hipótesis**, las vigas de borde sin rigidez a flexión, que es el «zuncho de borde» de CYPE (CY-4): entonces, 0,95–1,01. Es una decisión del usuario (CY-f).

## 1. Criterios

| # | Criterio | Resultado | Dónde |
|---|---|---|---|
| 1 | HA-30 da 32 837 MPa, los mismos bits en V8 y JavaScriptCore | **Pasa** (redondeado al MPa) | `seccion3D.test.ts` |
| 2 | Con un solo E, esfuerzos iguales y desplazamientos escalados | **Pasa**: 36 modelos, ≤ 2,5e-12 | `validacion/cy/ecm.ts`, `out_ecm.txt` |
| 3 | α = 1 bit a bit; α = 0, la liberación | **Pasa**: los dos bit a bit | `src/motor/empotramiento.test.ts` |
| 4 | La rigidez es α·K + (1 − α)·K′ frente a PyNite | **Pasa**: ≤ 6e-18 | `validacion/cy/empotramiento.ts` |
| 5 | Equilibrio y metamórficas con α al azar | **Pasa**: 40 modelos, todas las relaciones a ≤ 1e-10 | `src/motor/empotramiento.test.ts` |
| 6 | Reticular «uniforme» frente al emparrillado de CYPECAD, ≤ 3 % | **Pasa**: ≤ 1,24 % (con «bruta», +127 % de flecha) | `validacion/cy/reticular.ts`, `out_reticular.txt` |
| 7 | La vivienda: momentos de vano ≥ 0,90, flechas ±10 %, axiles ±10 % salvo explicados | **No pasa** con CY1–CY3 (0,77–0,92 y 0,87–0,88); **pasa** con los zunchos de CYPE (0,95–1,01 y 1,01) | `validacion/sombra/vivienda/` |
| 8 | Con las opciones de antes, bit a bit | **Pasa**: las 36 referencias de CY1, idénticas | `validacion/cy/opciones.ts`, `out_opciones_cy2.txt`, `out_opciones_cy3.txt` |

## 2. La vivienda frente a CYPECAD

Réplica del modelo del usuario en nuestro motor (`replica.py`: sus pilares, ábacos, cargas por hipótesis y E). Las losas se comparan con sus capturas, que son de una combinación, en los nudos de su listado a más de 0,5 m de la cara de un pilar. Mediana de nuestro/CYPE en los valores grandes (> 40 % del extremo):

| Hipótesis | mx P1 | my P1 | mx cub. | my cub. | Flecha P1 / cub. | Axiles fuera de ±10 % |
|---|---|---|---|---|---|---|
| Antes de CY (C4-h y cabeza rígida, con el E de CYPE) | 0,61 | 0,63 | 0,69 | 0,59 | 0,83 / 0,92 | P5, P14 |
| CY1–CY3 (por defecto ahora) | 0,87 | 0,88 | 0,92 | 0,76 | 0,87 / 0,88 | P5, P13 (−11 %) |
| CY1–CY3 + zunchos de borde sin flexión | **0,98** | **0,95** | **1,01** | **0,95** | **1,01 / 1,01** | P5 (+20 %), P15 (+12 %), P6 (Q, +12 %) |

Con los zunchos, la forma coincide en todo: correlación de 0,96 a 0,996 y pendiente de 0,97 a 1,04, también en Mxy. Los totales, a +1,0 / +0,5 / +0,5 % (PP / CM / Q; el +1 % es el cruce pilar–losa, que no descontamos, A-9).

## 3. Hallazgos

| # | Hallazgo | Qué se hizo |
|---|---|---|
| CY-1 | **La memoria de CYPECAD confirma las dos hipótesis.** El coeficiente de empotramiento es una interpolación de matrices, α·K_biempotrada + (1 − α)·K_empotrada-articulada (p. 18), no un muelle. El reticular va con «la mitad de la zona maciza» en flexión, también en los ábacos, y J = 2·I (p. 13) | Implementadas tal cual: la interpolación, exacta, y J = 2I llevado a la lámina como en C4-h (m12 = ½·G/G₀) |
| CY-2 | **El Ecm del Código Estructural sólo cambia los desplazamientos** en estructuras de un solo hormigón (−13 % en HA-25 y HA-30) | Concreta sigue con 8500·∛(fck + 8): pendiente para la integración |
| CY-3 | **El 0,3 en cabeza y la rigidez uniforme explican cada uno la mitad** de lo que nos separaba de CYPE en los momentos de vano. Juntos, de 0,6 a ~0,87 | — |
| CY-4 | **Lo que queda es el «zuncho de borde» de CYPE.** En su tabla de rigideces (p. 20) un zuncho de borde lleva EIy·10⁻¹⁵: no tiene rigidez a flexión. Con las vigas de borde de la réplica así, la vivienda queda a 0,95–1,01 en todo. Las variantes de torsión de las vigas (×0,01) y del solape de la media viga con la losa sólo mueven un 0–3 % | **Decisión del usuario (CY-f)**: confirmar que en su modelo son zunchos y decidir si los nuestros los imitan |
| CY-5 | **CYPE reduce también la torsión de las barras de los reticulares** con su coeficiente x (p. 20). En la vivienda, con los zunchos, Mxy ya sale a 1,04 / 0,96 sin reducirla | No se toca |
| CY-6 | **P5 sale de un 20 a un 28 % cargado de más** en todas las variantes. Es el pilar de la esquina entrante de la cubierta superior, con el ábaco P5+P8 unido; P13 (−6…−11 %) está en CYPE fuera de su alineación por el punto fijo | Sin explicar. Mirar el modelo de CYPE junto a P5 |
| CY-7 | **Las envolventes del listado no sirven para las losas**: llevan sismo sin ductilidad, y en el vano el mínimo de la envolvente es PP + CM. Hay que comparar con capturas de una combinación | La prueba en sombra lee las capturas por el color de la leyenda |
| CY-8 | **Las pruebas anteriores a CY2 que comparan con nudos rígidos** (SAP2000 1-022, los modelos a mano de C1 y C4, medidas de F2, F3 y F3.3, el axil congelado del apeo) y los oráculos de C4, que validan «bruta» | Se calculan con `empotramientoCabeza: 1` o `rigidezReticular: "bruta"`; las referencias congeladas se regeneran |

## 4. Decisiones

| # | Decisión | Estado |
|---|---|---|
| CY-a | Ecm del Código Estructural, al MPa | Hecha (CY1) |
| CY-b | Empotramiento 0,3 en la cabeza del último tramo de pilar, interpolando matrices | Hecha (CY2) |
| CY-c | Reticular «uniforme», el de CYPECAD; C4-h como «bruta» | Hecha (CY3) |
| CY-d | Datos del ejemplo: CM 2,0 o 2,5; los petos de x = 4,26; P13 | **Pendiente del usuario** |
| CY-e | Aviso de fisuración en servicio sobre los apoyos | Propuesta |
| **CY-f** | **Vigas de borde (zunchos) sin rigidez a flexión, como el «zuncho de borde» de CYPE.** Es lo que cierra la vivienda. Propuesta: un tipo de viga `"zuncho"` (las que crea la orden «Vigas de borde») con EIy·10⁻⁶ y la torsión de D4, y las vigas normales como ahora | **Pendiente del usuario**: ¿son zunchos en su modelo de CYPE? ¿Los imitamos? |

## 5. Para reproducir

```bash
bun validacion/cy/ecm.ts > validacion/cy/out_ecm.txt
.venv/Scripts/python.exe validacion/cy/oraculo_empotramiento.py > validacion/cy/oraculo_empotramiento.json
bun validacion/cy/empotramiento.ts > validacion/cy/out_empotramiento.txt
bun validacion/cy/reticular.ts > validacion/cy/out_reticular.txt
bun validacion/cy/opciones.ts 94a0b94 '{"empotramientoCabeza":1,"rigidezReticular":"bruta"}'
# la vivienda (necesita la carpeta de CYPE, fuera de git)
.venv/Scripts/python.exe validacion/sombra/vivienda/extraer.py
python validacion/sombra/vivienda/replica.py
bun validacion/sombra/vivienda/muestrear.ts
.venv/Scripts/python.exe validacion/sombra/vivienda/comparar.py
```
