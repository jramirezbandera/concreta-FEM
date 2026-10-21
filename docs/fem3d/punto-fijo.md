# Fase PF: el punto fijo de los pilares

**Estado (2026-10-21):** hecha. El compilador no cambia de versión: sin `fijo` su salida es la misma, y un modelo con `fijo` antes no compilaba (A-1). Pasan los seis criterios; las decisiones PF-a…PF-e van con su valor por defecto y quedan para que el usuario las confirme (§4). Falta la comparación en sombra con un modelo de CYPECAD con cambio de sección (§6).

Propuesta el 2026-10-14 (`fase-f3.md` §4) y pendiente desde C1 (`compilador.md`, «Lo que C1 deja fuera»).

## 1. Qué es

En CYPECAD, la posición de un pilar es la de su **punto fijo**: un punto de la sección (el centro, el centro de un lado o una esquina) que no se mueve entre plantas. Cuando la sección cambia en altura, crece o mengua desde ese punto. Lo normal es fijar la cara exterior de los pilares de fachada y la esquina de los de esquina, para que la fachada quede plana; el eje de cada tramo, el centro de su sección, se desplaza entonces de una planta a otra.

- **Lo que dice CYPE:** «Son barras verticales entre cada planta […] siendo su eje el de la sección transversal. Se consideran las excentricidades debidas a la variación de dimensiones en altura en cada planta» (*Memoria de cálculo*, ccadmc01, p. 12).
- **Su listado** da la coordenada del punto fijo y su nombre («Centro», «Mitad inferior»…): por ejemplo, P1 y P2 del modelo mínimo A (`ejemplos/EJEMPLO 6X6.pdf`).
- **Antes de PF:** el modelo físico sólo tenía un eje por pilar. Un cambio de sección con la cara fija había que modelarlo en el eje de un tramo (y el otro quedaba fuera de su sitio) o con dos pilares, que sólo se unen si sus ejes están a ≤ ε_snap (5 cm).

## 2. El modelo

**Modelo físico.** `Pilar.fijo` (`fisico.ts`), opcional, con los nueve puntos de CYPECAD:

- `"centro"` (por defecto);
- `"mitad-derecha"`, `"mitad-izquierda"`, `"mitad-superior"`, `"mitad-inferior"`;
- `"esquina-superior-derecha"`, `"esquina-superior-izquierda"`, `"esquina-inferior-derecha"`, `"esquina-inferior-izquierda"`.

(x, y) es ese punto. Los lados van en los ejes de la sección, girados con ella: «derecha», según el canto h; «superior», a 90°. Con giro 0, +X y +Y, como la planta de CYPECAD. El rectángulo es la huella del compilador: b × h; bf × h en una T; b × h del perfil en una I; en una circular, el cuadrado de lado D. Una sección `general` necesita b y h (`validar`).

**Modelo analítico** (`puntoFijo.ts`, `topologia.ts`, `piezas.ts`):

- **El eje de cada tramo** es el centro de su sección (`ejeTramo`).
- **El nudo de cada planta** va en el eje del tramo que llega a ella desde abajo: el que atraviesa el forjado, con su huella en la losa. En la planta de la base, en el del tramo de encima (`ejeEnPlanta`). Es la regla de la huella de antes (la del pilar de debajo).
- **La excentricidad** va en un offset rígido horizontal en la base del tramo de encima, desde ese nudo (`ip` en su eje). Con RV-b la base arranca en el nudo, así que el brazo está en la cota del forjado; con el plano medio, se suma a la zona rígida de la base.
- **Las rectas de la pieza:** una por cada serie de tramos con el mismo eje. Las cargas de pilar y el peso propio van por la recta de su tramo, así que una carga que pasa por el cambio de sección se reparte sin pérdidas.
- **Sin `fijo`, o con `"centro"`,** el eje es (x, y) tal cual: el modelo de antes bit a bit.
- **La hipótesis del informe** nombra los pilares con cambio de eje.

**Fuera del compilador**, todos van por `ejeSeccion` (`puntoFijo.ts`):

- **dibujo de A4:** las huellas en planta, la marca y el rótulo, los resultados (`pilares-n`), el alzado y las cargas de pilar, partidas por tramos;
- **3D:** el sólido, el alámbrico, los pilares por colores y las cargas;
- **agente:** la bajada tributaria y el aviso de pilar interrumpido;
- **editor:** «Vigas de borde» y «Ábacos», y la tabla de pilares, con la columna «punto fijo» y su desplegable;
- la skill.

Los ejes propuestos y «Renumerar» siguen con (x, y), el punto fijo: es lo que se alinea.

## 3. Criterios

| # | Criterio | Resultado |
|---|---|---|
| 1 | Sin `fijo`, el modelo de antes bit a bit | **Pasa.** Las referencias congeladas de C1–C5, F y el resto, idénticas: 136 ficheros y 1 938 pruebas, más 38 de la app. «centro» da el mismo JSON que nada. Con una sola sección, un punto fijo es otro modo de dar el eje: el mismo modelo, a 1e-12 |
| 2 | Oráculo a mano | **Pasa.** Una ménsula de 40 × 40 y 30 × 30 con la esquina fija, frente a su modelo analítico escrito a mano: desplazamientos, reacciones y esfuerzos a ≤ 1e-10. La estática es exacta: la reacción de la base es r × F con la carga en el eje del tramo de encima (5, 60 y 0,5 kN·m), y la cabeza del tramo de abajo lleva el momento de la excentricidad |
| 3 | Lo mismo por otro camino | **Pasa.** Un pórtico con vigas, diafragmas, peso propio, viento y una carga de pilar variable que cruza el cambio de sección, frente a dos pilares: el de encima apeado en el de abajo y unido a su nudo con la misma excentricidad por la fusión de C1 (ε_snap = 0,1). A ≤ 1e-10 |
| 4 | Metamórficas | **Pasa.** Trasladar la planta o girarla 90° y 37° (el punto fijo va en los ejes de la sección) da lo mismo transformado, a ≤ 1e-9. En el pórtico y en una losa plana, con la misma malla |
| 5 | Con losa | **Pasa.** En una losa plana de 3 plantas con la fachada de punto fijo (`src/pruebas/puntoFijo.ts`): el nudo de cada planta, en el eje del tramo de debajo; ningún nudo rígido fuera de su huella (HR); equilibrio a 1e-9 en todos los casos |
| 6 | Dibujo y 3D | **Pasa.** El volumen de cada tramo en el sólido es el de sus datos menos lo que tapa la losa, a 1e-9, recto y girado 30°: con la huella mal puesta, media huella saldría fuera de la losa. La resultante de las cargas dibujadas es la del modelo analítico a 1e-9, también las de pilar que cruzan los cambios de eje |

Las pruebas están en `src/compilador/puntoFijo.test.ts`, con modelos añadidos en `src/visor/solido.test.ts` y `src/agente/render/cargas.test.ts`.

## 4. Decisiones por defecto (para el usuario)

| # | Decisión | Por defecto | Por qué |
|---|---|---|---|
| PF-a | Cómo se da | `fijo` con los nueve nombres de CYPECAD; (x, y) es el punto fijo | Se copia del listado de CYPE tal cual. Sin el campo, todo como antes |
| PF-b | Los lados con giro | En los ejes de la sección: «derecha» según el canto h y «superior» a 90° (con giro 0, +X y +Y) | Así el punto fijo gira con el pilar. Falta comprobar que CYPE hace lo mismo con un pilar girado (§6) |
| PF-c | Dónde va el nudo de la planta | En el eje del tramo que llega desde abajo; la excentricidad, en la base del de encima | El tramo de abajo es el que atraviesa el forjado: su huella es la de la losa, y las vigas llegan a su cabeza. El nudo coincide con el centro de la huella, como siempre |
| PF-d | Circulares | El cuadrado de lado D | Es lo único que da sentido a «esquina» en un círculo |
| PF-e | Ejes propuestos y «Renumerar» | Por (x, y), el punto fijo | Es lo que se alinea en fachada. El eje de cada tramo sale solo |

## 5. Medida

Losa plana de 25 cm, 2 × 2 vanos de 5 m y tres plantas. Los pilares son de 40 × 40 hasta N1 y de 30 × 30 encima, con la cara exterior o la esquina fija en el borde. Con G + Q (`validacion/pf/out_medir.txt`):

| Pilar de fachada (P2, mitad inferior) | Cabeza de N1, M | Base de N2, M |
|---|---|---|
| PF (con la excentricidad de 5 cm) | 20,98 | 15,09 |
| En el eje del 40, sin excentricidad (lo de antes) | 25,71 | 16,47 |
| En el eje del 30 | 26,65 | 16,83 |

- **El momento de la excentricidad** (N·e del tramo de encima, ≈ 12 kN·m en los de fachada y ≈ 7,5 en los de esquina) contrarresta el de la losa. En la cabeza del tramo de abajo baja un 18 %, y en la base del de encima, un 8 %.
- **El signo:** aquí, sin el punto fijo se iba del lado seguro. Con la cara fija hacia dentro, o con la sección creciendo hacia arriba, se iría del lado inseguro.
- **El axil** casi no cambia: ≤ 1,5 % en todos los pilares.

## 6. Hallazgos y pendientes

- **PF-1, la astilla.** El 30 × 30 en el eje del 40 deja 5 cm de losa entre su cara y el borde. La malla se refina en esa astilla y pasa de 1 327 nudos a 2 993. Es una razón más para dar el punto fijo, y no el eje, cuando la fachada es plana.
- **PF-2, COM-12.** Con un punto fijo y un giro que no es múltiplo de 90°, el eje sale del seno y el coseno: puede diferir en un ulp entre motores de JavaScript. La numeración canónica (`CUANTO_ORDEN`) lo absorbe, como la huella girada.
- **PF-3, de paso en el sólido.** En la planta de su base, el macizo de un pilar en un reticular tomaba la sección por defecto del pilar, no la del tramo de encima. Se ha corregido; ninguna prueba cambia.
- **Pendiente del usuario:**
  - confirmar PF-a…PF-e;
  - **la comparación en sombra:** un modelo de CYPECAD con un pilar de fachada que cambia de sección con la cara fija (mejor, uno de esquina y uno girado), con su listado de esfuerzos por tramo. Así se cierran PF-b y la manera en que CYPE lleva la excentricidad (sólo la memoria dice que la considera).
- **Fuera de esta fase:**
  - el giro por tramo: el `giro` es del pilar entero, como en CYPECAD;
  - un pilar apeado sobre otro con la excentricidad mayor que ε_snap. Sigue como antes; el mismo brazo podría unirlo, si se quiere (propuesta PF-f, sin hacer).
- **Para la integración con Concreta:** los esfuerzos de cada tramo ya llevan N·e; el módulo de pilares no tiene que añadirlo.
