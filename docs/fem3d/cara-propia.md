# Fase F3 — la cara propia de los pilares (F2-8)

> **Fecha:** 2026-10-14. **Origen:** F2-8 (`fase-f2.md` §3 y §4), a petición del usuario.
>
> **El problema:** en una alineación con pilares de dos tamaños, la cara común de C5-g es la del menor y cae dentro del mayor. Allí su metro (la ventana de F-h) sólo suma las láminas de los lados: sale un 50 % bajo, del lado inseguro, sin aviso y sin converger.
>
> **Objetivo:** el metro de cada pilar se mide en su cara propia, con el mismo error que el de los demás.
>
> **Este documento** fija, antes de empezar, lo medido, cómo se hace y qué tiene que pasar. El resultado irá en `fase-f3.md`.

## 1. Lo medido antes de empezar

Exploración con scripts provisionales (no se guardan) en el edificio objetivo de una planta con losa plana:
- pilares de 40 × 40 y de 30 × 50 alternados, girados 0° y 90°;
- todas sus alineaciones mezclan tamaños;
- 72 caras con demanda tienen la cara común dentro de la huella (5 o 10 cm).

| Malla | Estación de hoy (cara común) | Escalón (§2.1) |
|---|---|---|
| h = 0,75 con F2 | 48–51 % bajo de media, hasta 66 % | 9,0 % de media, hasta −10 % |
| h = 0,75 con F2 y las dos medidas de §2.2 | — | 2,4 % de media, hasta 4,6 % |
| h = 0,5 | 46 % de media | 1,7 % de media |

Referencia: el escalón con h = 0,25. Sin las 2 caras junto al hueco de la escalera (P24-20), que son de F2-9 (+12 y +29 %).

- **El escalón es el corte por la cara propia.** En P42-15 y P48-10, con una banda que siembra la cara propia en la ventana y la triangulación con h = 0,2, el corte recto por la cara propia y el escalón difieren un 0,4 %. Con los esclavos sólo sobre la huella (el atajo de F2-9), la referencia de los dos es −58,2 y −58,4 kN·m/m, y la estación de hoy da −27,7 y −28,3.
- **Converge sin tocar la malla:** en P42-15, −51,2 / −55,7 / −57,0 / −58,4 / −58,3 con h = 0,75 / 0,5 / 0,375 / 0,25 / 0,15.
- **Lo que queda con h = 0,75 es de la malla.** La cara propia cae dentro de una celda de la rejilla, a 5 cm de su línea, que es la cara común, así que:
  - el primer tramo de la plantilla junto a ella mide 1,37 m, y sus tercios, 0,46 m (los de un pilar normal miden unos 0,24 m);
  - el bloque acaba en esa celda, y la transición de la esquina no cabe más allá: va en la esquina, y la parte de la ventana a los lados del pilar queda gruesa (lo de F2-4).

## 2. Cómo se hace

### 2.1 La estación en la cara propia: el escalón

En la cara de un pilar cuya cara común cae dentro de su huella, la ventana de su franja se mide así:
- **El corte:** por la recta de la cara común, que siempre está en la malla. Junta lo que pasa por las láminas de los lados con lo que transmite el enlace rígido de la huella del pilar a través de esa recta.
- **El momento:** se traslada a la cara propia (My − Δx·Vz).

Es el corte de un contorno en escalón: la cara común a los lados del pilar y la cara propia delante de él, unidas por los lados de la huella. Todo eso son aristas de cualquier malla: no depende de h, de la rejilla ni de la triangulación.

La diferencia con el corte recto por la cara propia es sólo lo que hay en las dos tiras de 5–10 cm a los lados de la huella (su carga y lo que cruza los bordes de la ventana en esos centímetros).

- **En el motor:** la opción `restricciones` del corte. Con `soloLaminas`, las restricciones que se nombran sí entran, con lo que transmiten a través del plano, como sin `soloLaminas` (E5).
- **En `esfuerzosFranjas.ts`:**
  - la estación va en s = cara propia;
  - el ancho es el de la ventana en la losa (la huella cuenta: lo que pasa por ella es de la cara);
  - my y mxy salen por campos, a δ de la cara propia;
  - entre las dos caras propias del pilar no hay estaciones.
- **Las demás franjas** que cruzan la recta de la cara común, lejos del pilar, siguen como hoy.
- **Respaldo:** si el corte no se puede hacer, por ejemplo porque el pilar no tiene enlace en la losa, la estación queda en la cara común con el aviso `franja/cara-comun-dentro`. Ese aviso dice que ahí el momento puede salir hasta un 50 % bajo. Nunca en silencio.

### 2.2 La malla: el pilar con la cara dentro de una celda

Sólo en las plantillas refinadas (F2), así que con `refinoCaras: false` o `franjas: false` la malla no cambia:
- **Tercios de un largo de h como mucho.** Si el primer tramo junto a la cara mide más de h, sus tercios se toman de h desde la cara. Queda un tramo exterior más ancho, que lleva la transición.
- **La esquina, fina.** Si la transición no cabe más allá en una dirección y el tramo exterior es ancho, la esquina va fina, y la transición de 3 a 1 va en su columna (o fila) exterior, hasta el borde del bloque. En la otra dirección va como hoy, en el cuadrilátero siguiente.
- **El borde del bloque no cambia**, así que la costura con la rejilla y la triangulación es la de siempre. La guarda de calidad y el respaldo de F2 siguen igual.

### 2.3 Versión

Compilador F3, porque la malla cambia junto a esos pilares (F-10).

## 3. Criterios

| # | Criterio | Cómo se mide |
|---|---|---|
| 1 | **Seguridad:** ninguna estación de cara de un pilar cae dentro de su huella; la del metro de cada pilar va en su cara propia | Pruebas en el edificio objetivo y en una losa con tamaños mezclados |
| 2 | **Equivalencia:** el escalón y el corte recto por la cara propia, en una malla que la siembra (triangulación con una banda), a **≤ 1 %** | Pruebas y `validacion/f3/` |
| 3 | **Convergencia:** con h = 0,75, el metro en las caras con la cara común dentro, frente a la malla fina: **media ≤ 2 %, máximo ≤ 5 %**. Las caras propias de siempre, como en F2: la 3 × 3 y H25 a ≤ 2 % | Edificio objetivo de una planta (sin las caras junto al hueco, F2-9) |
| 4 | **Tamaño:** el edificio objetivo de 7 plantas con losa plana, **≤ 200 000 ecuaciones** | Banco |
| 5 | **Calidad de malla:** ningún aviso `malla/calidad`, `malla/cara-sin-refinar` ni respaldo en las 5 familias no ortogonales, las 24 retículas al azar de G, los modelos de validación y el edificio objetivo con h = 0,75, 0,5 y 0,375 | `geometrias.test.ts` y pruebas nuevas |
| 6 | **Determinismo:** la misma malla al trasladar, girar y reordenar, y en V8 y JavaScriptCore. Las referencias congeladas de C2–C5 no cambian ni un bit; la de F se regenera a sabiendas, con un caso de tamaños mezclados | Metamórficas y referencias congeladas |
| 7 | **Respaldo:** sin el enlace de la huella, la estación queda en la cara común con el aviso; nunca en silencio | Prueba |
| 8 | **Coste:** compilar, calcular y las franjas del edificio objetivo, ≤ +15 % frente a F2 | Banco |

## 4. Decisiones por defecto (para el usuario)

| # | Decisión | Por defecto | Por qué |
|---|---|---|---|
| F3-a | Dónde se mide el metro de un pilar con la cara común dentro | En su cara propia, por el escalón | Es la cara que arma. La común dentro de la huella no es una sección de la losa |
| F3-b | Ancho de los medios en el escalón | El de la ventana en la losa, con la huella | Lo que transmite la huella es de la cara. Con el ancho de las láminas, los nudos rígidos de F2-9 lo inflarían |
| F3-c | Largo máximo de los tercios junto a una cara | h | Los de un pilar normal ya miden ≤ h/3 |

## 5. Fuera de esta fase

- **F2-9** (los nudos a ≤ ε_snap de la huella se hacen rígidos). El escalón ya suma lo que transmiten, pero la regla sigue como está; sigue pendiente del usuario.
- **El punto fijo de los pilares** (la fase siguiente, propuesta al usuario).
- **Las caras de los pilares circulares, girados y de borde** (F-4).
