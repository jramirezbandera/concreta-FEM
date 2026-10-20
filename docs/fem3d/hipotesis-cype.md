# Fase CY — las hipótesis de CYPECAD

> **Fecha:** 2026-10-15. **Origen:** la primera comparación con CYPECAD de un proyecto real (la vivienda de Alhaurín, `ejemplos/vivienda`), a petición del usuario.
>
> **El problema:** con los mismos datos que el modelo CYPECAD del usuario, el motor cuadra (equilibrio a 1e-14, cargas a ≤ 1 %, forma de la flecha con correlación 0,99). Pero con nuestras hipótesis por defecto los momentos de vano del reticular salen al 0,6–0,7 de los de CYPE: menos armadura inferior, del lado inseguro. Los negativos junto a los pilares salen ×1,3 y los momentos en cabeza de pilar, ×2 a ×3.
>
> **Objetivo:** adoptar por defecto las tres hipótesis de CYPECAD que explican la diferencia, conservando las nuestras como opción.
>
> **Este documento** fija, antes de empezar, lo medido, lo que dice CYPE, cómo se hace y qué tiene que pasar. El resultado irá en `fase-cy.md`.

## 1. Lo medido antes de empezar

Réplica del modelo de CYPE en nuestro motor: sus pilares (punto fijo del listado), sus 18 ábacos (de las capturas de replanteo), sus cargas por hipótesis (PP, CM 2,0 kN/m², Q 1,0 kN/m², petos de 3,0 kN/m) y su E. Comparada con su listado (arranques y esfuerzos de pilares por hipótesis) y, en 4382 nudos de losa, con sus capturas de 1,35PP+1,35CM+1,5Qa y de PP+CM (leídas por el color; las envolventes del listado llevan sismo sin ductilidad y no sirven para las losas). Scripts provisionales: pasan a `validacion/sombra/` en CY4.

| Hipótesis | Momentos de vano (mediana, nuestro/CYPE) | Flechas | Axiles |
|---|---|---|---|
| Las nuestras por defecto (C4-h, cabeza rígida) | 0,61–0,69 | 0,83–0,92 | casi todos a ±10 %; P5 +21 %, P14 −13 % |
| + cabeza al 0,30 (emulada con E×0,3 en el último tramo) | 0,75–0,94 en los puntos de control | 1,05–1,10 | — |
| + reticular uniforme 0,5 con ábacos y torsión (emulado con multiplicadores y ν = 0,2) | **0,87–0,97** (correlación 0,92–0,99) | **0,92–0,97** | ±5 %, salvo P5 +28 %, P7 −13 %, P16 +10 % |

Cada una de las dos hipótesis explica más o menos la mitad de la diferencia. P5 queda sin explicar.

## 2. Lo que dice CYPE

De *CYPECAD – Memoria de cálculo* (ccadmc01; páginas del PDF):

- **Reticular (p. 13):** «La discretización de los paños de forjado reticular se realiza en mallas de elementos tipo barra cuyo tamaño es de un tercio del intereje definido entre nervios de la zona aligerada, y cuya inercia a flexión es (tanto en la zona maciza como en la aligerada) la mitad de la zona maciza, y la inercia a torsión el doble de la de flexión.»
- **Empotramiento en última planta (p. 18):** «se pueden redistribuir los momentos negativos en la unión de la cabeza del último tramo de pilar con el extremo de la viga; este valor estará comprendido entre 0 (articulado) y 1 (empotramiento), aunque se aconseja 0,3 como valor intermedio (valor por defecto). El programa realiza una interpolación lineal entre las matrices de rigidez de barras biempotradas y empotradas-articuladas, que afecta a los términos EI/L de las matrices del último tramo de pilar: K = α·K_biempotrada + (1 − α)·K_empotrada-articulada.» En el listado de la vivienda se aplica a la cabeza del último tramo de cada pilar, llegue a la losa o a una viga.
- **Rigideces (p. 20):** sección bruta en todos los elementos de hormigón, con un coeficiente reductor de la torsión y el axil de pilares ×2 (lo que ya hace D4).
- **E:** el listado da Ec = 32 837 MPa para HA-30 con el Código Estructural: Ecm = 22000·(fcm/10)^0,3 (Anejo 19, tabla 3.1).

### 2.1 Por qué se adoptan (resumen de la conversación con el usuario)

Las dos primeras son una redistribución incorporada, y razonable. Fisurados, el ábaco y el aligerado tienen una rigidez parecida, porque la marca el acero y no el hormigón (del orden del 5 % de la maciza bruta en los dos). Así que la razón 3:1 de las rigideces brutas (C4-h) no es la que reparte los momentos en rotura. En la vivienda, CYPE da en los apoyos ~77 % de lo nuestro: un 23 % de redistribución, dentro del 30 % que admite el Anejo 19 (5.5) con acero de ductilidad alta. Por el teorema del límite inferior los dos repartos son seguros si hay ductilidad, y el de CYPE da armados ejecutables. La cabeza del último tramo, con poco axil, fisura enseguida y no desarrolla el empotramiento elástico.

El precio es una armadura superior menor sobre los apoyos: hay que vigilar la fisuración en servicio (más adelante, un aviso de sensatez).

## 3. Cómo se hace

### CY1 · E del Código Estructural

- `hormigon(fck)` (`src/secciones/seccion3D.ts`): Ecm = 22000·((fck + 8)/10)^0,3 MPa, **redondeado al MPa** (es lo que lista CYPE, y así E sale igual en V8 y JavaScriptCore). ν = 0,2 como ahora.
- Textos: `fisico.ts` y la ayuda de la tabla de materiales (`src/editor/tablas.ts`).
- **Concreta** usa 8500·∛(fck + 8) (`rcElasticModulusMPa`): queda apuntado para la integración.
- Compilador CY1. Se regeneran a sabiendas las referencias congeladas que lo noten.

### CY2 · Coeficiente de empotramiento en extremos de pilar

- **Motor:** un coeficiente α ∈ [0, 1] por extremo de barra, en los dos giros de flexión. La rigidez local del tramo flexible es α·K + (1 − α)·K_lib, con K_lib la de ese extremo con los dos giros liberados (la condensación que ya existe). Las cargas de barra equivalentes, igual. Es exactamente la definición de CYPE, y el equilibrio de la barra se conserva (combinación de dos estados equilibrados).
- **Modelo físico:** `empotramiento?: { base?: number; cabeza?: number }` por pilar (base del primer tramo, cabeza del último), y la opción `empotramientoCabeza` (por defecto 0,3) para la cabeza del último tramo de los que no lo dan. Como en CYPE, el del pilar y el de la opción se multiplican. Va a `hipotesis` del informe.
- Compilador CY2.

### CY3 · Rigidez del reticular

- Opción `rigidezReticular: "uniforme" | "bruta"`, por defecto `"uniforme"`.
- **"uniforme" (CYPE):** aligerado y ábacos con ν = 0 y los mismos multiplicadores de flexión y torsión: m11 = m22 = 0,5 y m12 = 0,5·G/G₀, que es la torsión de las barras de CYPE (J = 2·I) llevada a la lámina como en C4-h. La membrana y el cortante transversal siguen por zonas, como ahora (con diafragma rígido, la membrana no trabaja).
- **"bruta":** C4-h tal cual.
- Los `multiplicadores` dados por el usuario siguen mandando sobre los dos.
- El peso no cambia (por zonas, C4-i).
- Compilador CY3.

### CY4 · La vivienda como prueba en sombra

- `validacion/sombra/vivienda/`: los scripts de §1 (réplica, extracción del listado y de las capturas, comparación). Leen los datos de CYPE de `ejemplos/Proyectos/pruebas/prueba vivienda/`, que está fuera de git (el listado lleva el nombre del cliente). Sin esa carpeta, la prueba se salta.
- `ejemplos/vivienda`: la viga de la pérgola en x = 4,26; CM, petos y P13 según decida el usuario.

## 4. Criterios

| # | Criterio | Cómo se mide |
|---|---|---|
| 1 | **E:** HA-30 da 32 837 MPa, como el listado de CYPE; los mismos bits en V8 y JavaScriptCore | Pruebas |
| 2 | **E, efecto acotado:** en las referencias congeladas de modelos sólo de hormigón, los esfuerzos no cambian (≤ 1e-9 relativo) y los desplazamientos escalan con E_viejo/E_nuevo | Referencias congeladas |
| 3 | **Empotramiento, límites:** con α = 1 el resultado es el de ahora bit a bit; con α = 0, el de la liberación a ≤ 1e-12 | Pruebas de la barra y del motor |
| 4 | **Empotramiento, definición:** la rigidez de la barra es α·K_biempotrada + (1 − α)·K_empotrada-articulada a ≤ 1e-12, frente a las dos matrices calculadas aparte (PyNite) | Oráculo |
| 5 | **Empotramiento, propiedades:** equilibrio a 1e-9 y la batería metamórfica con α al azar | Metamórficas |
| 6 | **Reticular uniforme:** frente al emparrillado de CYPE como barras (intereje/3, I = 0,5·b·h³/12, J = 2·I), un recuadro apoyado y uno sobre pilares con ábacos, flecha y momento por metro a ≤ 3 % | Oráculo de barras, como el de C4 |
| 7 | **La vivienda (sombra):** con las tres hipótesis por defecto, momentos de vano a ≥ 0,90 de CYPE (mediana), flechas a ±10 %, axiles a ±10 % salvo los pilares explicados | `validacion/sombra/vivienda/` |
| 8 | **Opciones:** `rigidezReticular: "bruta"` y `empotramientoCabeza: 1` dan bit a bit los resultados de antes de CY2 y CY3 | Referencias congeladas |

## 5. Decisiones

| # | Decisión | Por defecto | Estado |
|---|---|---|---|
| CY-a | E del hormigón | Ecm del Código Estructural, al MPa | Aceptada el 2026-10-15 |
| CY-b | Empotramiento en cabeza del último tramo | 0,3 (CYPE), interpolando matrices | Aceptada el 2026-10-15 |
| CY-c | Rigidez del reticular | Uniforme 0,5 en aligerado y ábacos, torsión de CYPE; C4-h como opción | Aceptada el 2026-10-15 (sustituye a C4-h por defecto) |
| CY-d | Datos del ejemplo: CM 2,0 o 2,5; petos de x = 4,26; P13 | — | **Pendiente del usuario** |
| CY-e | Aviso de fisuración en servicio sobre los apoyos | Más adelante | Propuesta |
| RV-b | Plano de los nudos del forjado | Su cara superior (la cota de CYPE), con el pilar rígido en todo el canto por debajo; el plano medio, como opción (`planoForjado: "medio"`) | Aceptada el 2026-10-20 y hecha (compilador RV1, `fase-lv.md` §2.3) |
| RV-a | Flexión de las vigas planas en un reticular | ×0,6 del `Iy` en los tramos de viga de hormigón rectangular con el canto del forjado junto a un reticular «uniforme» (`rigidezVigasPlanas`); ajuste empírico a CYPECAD, que no lo dice en su memoria (modelo A con vigas de 30 y de 50) | Aceptada el 2026-10-20 y hecha (compilador RV2, `fase-lv.md` §2.4) |
