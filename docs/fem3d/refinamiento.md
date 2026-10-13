# Fase F2 — refinamiento de la malla junto a los pilares con cara

> **Fecha:** 2026-10-13. **Origen:** F-6 y la decisión del usuario tras la fase F (`fase-f.md` §4.1): «se refina sólo alrededor de los pilares con cara, sin bajar h en toda la losa».
>
> **Objetivo:** con el h por defecto (0,75 m), el metro centrado en un pilar, en su cara, a unos −1 % del valor convergido (hoy, −6 %), sin salir del perfil móvil.
>
> **Este documento** fija, antes de empezar, lo medido, cómo se hace y qué tiene que pasar. El resultado irá en `fase-f2.md`.

## 1. Lo medido antes de empezar

Exploración en `validacion/refino/` con la losa de 3 × 3 vanos de F (pilar P6-5, caras x = 6,15 e y = 5,15). La referencia es h = 0,125: 22 690 nudos, mx = −68,62 y my = −62,64 kN·m/m. Para medir sólo la precisión, se añadieron líneas de rejilla de lado a lado; el coste no cuenta aquí.

| Malla junto al pilar | mx | my |
|---|---|---|
| h = 0,75 (hoy) | −5,7 % | −4,2 % |
| h = 0,5 | −0,4 % | −1,2 % |
| h = 0,375 | +2,2 % | +2,8 % |
| Una línea paralela a cada cara, a 0,35 m (sólo en x / sólo en y) | +0,8 % / −5,5 % | −3,4 % / −0,6 % |
| Celdas junto a las caras en cuartos (w/4) | −0,4 % | +3,1 % |
| Celdas junto a las caras graduadas (w/6, w/6, w/3, w/3) | **−1,5 %** | **−1,2 %** |
| Elementos de 0,18 m hasta 0,9 m de las caras | −0,4 % | −0,4 % |

- **Lo que manda es el ancho de la fila de elementos a través de la cara.** Para mx, las líneas paralelas a la cara x; para my, a la cara y. Refinar sólo a lo largo de la cara no ayuda, e incluso empeora.
- **Con elementos de unos 0,3 m, el error oscila ±3 %** según dónde caigan los nudos respecto a los bordes de la ventana de 1 m. Con 0,18 m queda en ±0,4 %. La graduación pone los elementos finos pegados a la cara y es la más estable con el mismo número de nudos.
- **El reparto de F-6 no es la causa.** Se probaron dos alternativas, una recuperación consistente M·m = g a lo largo de la cara y una lineal por lámina, y oscilan igual o más. F-6 se queda como está.
- **El tamaño es el límite.** El edificio objetivo de 7 plantas con losa plana tiene hoy 183 876 ecuaciones: quedan unas 16 000 hasta el perfil móvil. Refinar como arriba cuesta unos 36 nudos por pilar con cara: ≈ 12 000 nudos y ≈ 31 000 ecuaciones en sus 336 pilares interiores. **No cabe.**
- **Pero el ×2,04 de F no es de las caras, sino de la triangulación:** el 43 % de las láminas de cada planta (4 203 de 9 727) salen de ella. Son 333 celdas irregulares, 9–12 por pilar de borde, más las del hueco. La cara común de una alineación se corta a h de cada pilar ajeno (F-4), también de un pilar de borde cuyo lado cae justo sobre ella, y su extremo suelto deja la plantilla de ese pilar en la triangulación. Sin ese corte donde no hay astilla posible (§2.1), la planta pasa de 10 161 a 7 037 nudos (−31 %), recupera 28 plantillas y el jacobiano mínimo sube de 0,302 a 0,310.

## 2. Cómo se hace

### 2.1 R0: las caras comunes junto a los pilares ajenos

En `carasFranjas` (`franjas.ts`), junto a un pilar ajeno alineado (uno de la losa que no tiene cara en esa recta):
- **si la recta va por un lado de su huella** (a ≤ 10·ε_geom), no se corta: corre por su lado, que ya es un lado del arreglo;
- **si pasa por dentro de su huella,** se corta en la huella, sin la holgura h, como ya se hace con los pilares propios (la cara común de uno mayor que el menor de su línea);
- **en otro caso** (pasa cerca, por fuera), se corta a h como hasta ahora, porque ahí sí dejaría astillas (F-4).

### 2.2 R1: la plantilla refinada

Un pilar con cara en una dirección cuya huella va en una plantilla de la rejilla (R-1) refina su bloque en esa dirección:
- **Celdas de la cruz** (las del bloque al lado de cada cara, con el alto o el ancho de la huella): el tramo entre la cara y el borde del bloque, de ancho w, se parte en 4 a través de la cara, graduado: w/6, w/6, w/3, w/3 desde la cara (F2-a). Es una red estructurada, como la de hoy, con más ejes.
- **Las 4 celdas de esquina del bloque** reciben los tramos finos por dos lados (o por uno, si el pilar sólo tiene caras en una dirección) y salen al borde del bloque con los 2 de siempre. Llevan una plantilla de transición fija: la de esquina (4 y 4 → 2 y 2: 11 cuadriláteros) o la de un lado (4 → 2: 8 cuadriláteros), con los nudos por interpolación transfinita de su contorno.
- **El borde del bloque no cambia.** La interfaz con la rejilla y con la triangulación es la de hoy, así que la costura no se toca: fuera del bloque, la malla es la misma nudo a nudo.
- **Sólo donde hay cara** (decisión del usuario): con `franjas: false`, o en un pilar sin cara, como hoy.

### 2.3 Pilares con cara sin plantilla

Los que van en la triangulación (el hueco de la escalera, retículas irregulares) ya tienen la siembra graduada desde sus lados. Se mide su error. Si pasa del criterio 1, se añade un tamaño local en la CDT junto a sus caras; si no, se dice en el informe.

### 2.4 Respaldo (el plan de salida)

- **Por pilar:** si la plantilla refinada no se puede construir o algún cuadrilátero suyo queda por debajo del jacobiano objetivo (0,3), ese pilar queda con la plantilla de hoy y se avisa con `malla/cara-sin-refinar`. El aviso nombra el pilar y dice que en su cara el momento puede salir hasta un 6 % bajo.
- **Por planta:** si la planta refinada no pasa el validador, se malla sin refinar, con el mismo aviso para sus pilares, y sólo después se recurre a la triangulación sola (`malla/sin-rejilla`, G-1).
- **El cálculo nunca falla por el refinamiento ni hay un error silencioso:** como mucho, un aviso.

### 2.5 Opción y versión

- **Opción `refinoCaras`** (por defecto, sí). Con `false`, la malla de F1.1 más R0.
- **Versión del compilador F2**, porque la malla cambia (F-10).

## 3. Criterios

| # | Criterio | Cómo se mide |
|---|---|---|
| 1 | **Convergencia:** con h = 0,75, el metro centrado en el pilar, en cada cara con demanda (≥ 20 % de la mayor), a **≤ 2 %** del de la malla fina, y la media, ≈ 1 %. En la losa de 3 × 3 vanos y en H25 (losa plana y reticular) | Frente a h = 0,125, comprobada con 0,09 en la 3 × 3 (`validacion/f2/`) |
| 2 | **Tamaño:** el edificio objetivo de 7 plantas con losa plana, **≤ 200 000 ecuaciones**; con vigas y reticular, como hoy | `validar.ts` de F, criterio 5 |
| 3 | **Calidad de malla:** ningún aviso `malla/calidad`, `malla/cara-sin-refinar` ni respaldo en las 5 familias no ortogonales, las 24 retículas al azar de G y los modelos de validación. Jacobiano mínimo de las plantillas refinadas ≥ 0,3 | `geometrias.test.ts` y pruebas nuevas |
| 4 | **Determinismo:** la misma malla al trasladar, girar (90° y 37°), reordenar y con ruido < ε_geom, y en V8 y JavaScriptCore. Las referencias congeladas de C2–C5 (`franjas: false`) no cambian ni un bit | Metamórficas de C2–C5 y F, huellas |
| 5 | **Oráculo externo:** H25 frente a OpenSeesPy ASDShellQ4 en las caras, **≤ 2 %** con h = 0,75 (hoy, 3,2 % del máximo) | `oraculo_franjas.py` de F |
| 6 | **Respaldo:** con un fallo forzado en una plantilla o en la planta, el modelo compila, avisa y da la malla sin refinar | Pruebas |
| 7 | **Coste:** compilar y calcular el edificio objetivo, ≤ +25 % frente a F1.1 | Banco |
| 8 | **Referencia congelada:** la de F, regenerada a sabiendas (cambia la malla junto a los pilares con cara), y un caso nuevo con el refinamiento | `congelado-f.test.ts` |

## 4. Decisiones por defecto (para el usuario)

| # | Decisión | Por defecto | Por qué |
|---|---|---|---|
| F2-a | Partición de las celdas junto a la cara | w/6, w/6, w/3, w/3 | Medida en §1: la más estable con 36 nudos por pilar. Si en el criterio 1 no basta, se prueba con 6 tramos |
| F2-b | R0 | Sin corte por un lado ajeno; corte en la huella por dentro | Es lo que paga el refinamiento; no puede dejar astillas |
| F2-c | Qué pilares | Los que tienen cara (franjas) | Decisión del usuario. Los circulares, girados y de borde sin cara (F-4) siguen como hoy |

## 5. Fuera de esta fase

- Las caras de los pilares circulares, girados y de borde (F-4).
- Bajar h en toda la losa.
- El tiempo de las franjas (C5-4).
