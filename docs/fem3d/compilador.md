# Compilador: plan por fases (Fase 2 de S1)

> **Qué es.** El compilador convierte el modelo físico (plantas, pilares, vigas, losas, muros, cargas) en el `ModeloAnalitico` del motor, con un mapeo de ida y vuelta y diagnósticos que nombran objetos físicos. Es el «núcleo diferencial» del §7 del diseño. **Fecha:** 2026-10-04.
>
> Sustituye al §7 del diseño técnico con lo que cambian la investigación (COM-01…20, H28, H29) y las fases E0–E6 del motor. Lo de PyNite que el motor propio ya no necesita (barras de penalización, nudos conformes forzados por falta de MPC, troceado por cargas) desaparece.
>
> **Estado:** C1 superada el 2026-10-04 (`fase-c1.md`). C2 superada el 2026-10-05 (`fase-c2.md`): el criterio 8 (tamaño frente a D9) pasa desde la rejilla alineada de H52 en las zonas regulares (decisión C2-a, `rejilla.md`). C3 (muros) superada el 2026-10-05 (`fase-c3.md`). C4 (forjados) superada el 2026-10-05 (`fase-c4.md`): pasan los nueve criterios, el 2 con una salvedad en el ábaco. C5 (bandas y salida) en curso: plan y decisiones por defecto en «C5: alcance y decisiones».

## Entrada, salida y reglas

- **Entrada:** `ModeloFisico`, en kN y m (D1).
  - Las plantas van de arriba abajo con su altura de forjado a forjado, como `lib/edificio` de Concreta. Las cotas se derivan; nunca se guardan (H33, COM-17).
  - Los objetos se sitúan en planta (x, y) más su planta.
  - Los `id` son únicos en todo el modelo, así que un diagnóstico puede nombrar el objeto sólo por su `id`.
- **Salida:** `compilar(fisico, opciones)` devuelve:
  - el `ModeloAnalitico`;
  - el `Mapeo` de cada nudo, barra y restricción a su objeto físico, con las estaciones (distancia a lo largo de la pieza física) de cada tramo flexible;
  - los diagnósticos y la huella.

  Los resultados del motor vuelven al objeto físico por ese mapeo, nunca por proximidad (§8.1).
- **Reglas:**
  1. **Puro,** como el motor: sin DOM ni IO. Corre dentro del worker (E4-3) y nunca lanza por un dato del modelo: lo no válido es un diagnóstico.
  2. **Determinista.** El mismo modelo físico da el mismo modelo analítico bit a bit, aunque cambie el orden de sus listas. Los nudos se numeran por planta y coordenada cuantizada, y los `id` analíticos se derivan del objeto físico (COM-18).
  3. **Sin pérdidas.** En cada compilación, la resultante de las cargas físicas (fuerzas y momentos) tiene que coincidir con la de las analíticas a 1e-9 por caso. Si no, es un error, como el equilibrio del motor (regla de oro 2).
  4. **Sin penalizaciones** (E6-1, regla de oro 4). Lo rígido es un enlace rígido o un diafragma; «ignorar» una deformación es quitar su término, nunca multiplicarlo por un número enorme.
  5. **Dos tolerancias** (H28):
     - ε_geom = 1e-6 m: fusión silenciosa;
     - ε_snap = 0,05 m (configurable): fusión con aviso que guarda el desplazamiento;
     - entre ε_snap y 3·ε_snap: aviso de «casi encuentro», sin unir.

## Fases

| Fase | Contenido | Base |
|---|---|---|
| **C1 Barras** | Modelo físico de plantas, pilares, vigas, apoyos y cargas. Validación con diagnósticos físicos, cotas derivadas, topología con dos tolerancias, troceado sólo topológico, nudos de dimensión finita (zonas rígidas y excentricidades por offsets), liberaciones, diafragma rígido por planta, cargas y peso propio, mapeo, huella y esfuerzos por pieza física | H28, H11, H19, H33, COM-05/06/13/17/18/20, E1-8, E2 |
| **C2 Losas** | Mallador de losas (CDT a 2h dividida en 3 quads, o rejilla en paños alineados), validador de malla, huella del pilar con enlace rígido (H09), vigas embebidas, `eje1` en todas las losas (E3-2), peso propio desde `pp` (H24), cargas de superficie y de línea recortadas a cada lámina, siembra de las caras de los apoyos y los bordes de las bandas (E5-5) | H23, H24, H29, COM-07/08/10/11/14/15/16 |
| **C3 Muros** | Rejilla por paño con ≥ 8 elementos (H17), encuentros muro–muro y muro–losa, viga embebida en el plano del muro (H05, E0-6), dinteles y qué nudos del muro entran en el diafragma (E6-3), empujes por nudos | H05, H17, E6-3 |
| **C4 Forjados** | Unidireccional como viguetas-barra (D2; sin nudos intermedios sin rigidez a torsión, E2-3) y reticular con multiplicadores y ábacos (D3) | D2, D3, H46 |
| **C5 Bandas y salida** | Bandas del Ap. I del CE A19 automáticas y editables (D5), machones y dinteles como cortes, consultas por objeto físico para los módulos de comprobación | D5, E5, H35 |

## C1: alcance y decisiones

**Modelo físico de C1** (`src/compilador/fisico.ts`):
- `plantas`: de arriba abajo, con `altura` (m, `null` si falta) y `diafragma` (`"rigido"` o `"ninguno"`).
- `materiales`: hormigón (fck), acero o general (E, G y peso específico γ).
- `secciones`: rectangular, circular, perfil en I, T o general. De ellas salen A, Iy, Iz, J y las áreas de cortante (`seccion3D()`), y también la huella en planta del pilar.
- `pilares`: posición en planta, planta de arranque y de cabeza, sección (una por tramo si cambia), giro de la sección y vínculo en la base.
- `vigas`: polilínea en planta, planta, sección, liberaciones en sus extremos físicos y punto de inserción.
- `apoyos`, `casos` (uno puede llevar el peso propio) y `cargas`: puntuales en un punto de una planta, repartidas sobre una viga y repartidas sobre un pilar.

**Decisiones por defecto de C1.** Cada una es una opción que se puede cambiar y que queda registrada en la huella:

| # | Decisión | Por defecto | Por qué | Alternativa |
|---|---|---|---|---|
| C1-a | Nudos de dimensión finita | Zonas rígidas con **factor 0,5** (decidido por el usuario el 2026-10-04): es rígida la mitad de la viga dentro del pilar y la mitad del pilar dentro del canto de la viga más alta que le llega | Con 1 (CYPECAD, ccadmc01, p. 15) el nudo es infinitamente rígido: en el edificio objetivo, la deriva baja un 34 % y el momento de vano un 11 % frente a 0; 0,5 queda en medio (`out_decisiones.txt`) | `factorZonaRigida` en [0, 1]: 1 para comparar con CYPE, 0 como SAP2000 por defecto |
| C1-b | Viga excéntrica respecto al pilar | Se une al nudo del pilar con un offset que lleva la excentricidad, siempre que su eje pase por la huella del pilar | Sin penalización y sin mover la viga | — |
| C1-c | Eje analítico de la viga | En el plano del forjado (sin offset vertical) | Con diafragma rígido, una viga con offset vertical trabaja como una T de ala infinitamente rígida. En un pórtico de 6 m con viga de 30×60, la flecha baja un 21 %, el momento en la cara sube un 16 % y aparece un axil de 87 kN que no existe (C1-5) | `insercion: "superior"` por viga, con aviso si la planta tiene diafragma rígido |
| C1-d | Diafragma | Rígido en todas las plantas menos la más baja | Como CYPECAD. En la más baja suelen estar los arranques empotrados, y un GDL esclavo no puede llevar apoyo | `diafragma: "ninguno"` por planta. El semirrígido llega con las losas (C2) |
| C1-e | Qué nudos entran en el diafragma | Todos los de la cota de la planta | Sin la geometría de la losa (C2) no se sabe dónde hay forjado | En C2, por la geometría de la losa |
| C1-f | Un apoyo en ux, uy o rz de un nudo con diafragma rígido | Error con la planta y el apoyo | El motor no admite apoyos en GDL esclavos. Moverlo al maestro no es equivalente | Quitar el diafragma de esa planta |
| C1-g | Modificadores de rigidez | **D4 (b)** (decidida el 2026-10-04): axil de todos los pilares ×2 y torsión de las vigas de hormigón ×0,1 | Sin la torsión reducida, el vano de una secundaria que acomete a una viga de borde sale un 27 % corto; sin el axil ×2, la cara de una viga interior pierde un 6 % (`out_decisiones.txt`) | `modificadores` por tipo de pieza y material, en (0, 100]; `{}` los quita |
| C1-h | Peso propio | γ·A en vigas y pilares, de nudo a nudo, en el caso marcado | El de las losas sale de `pp` en C2 (H24). El solape viga–losa se resuelve allí | — |

**Lo que C1 deja fuera:**
- vigas inclinadas, rampas y cargas proyectadas: todas las barras de C1 son horizontales o verticales;
- el «punto fijo» de los pilares que cambian de sección (excentricidad entre tramos);
- pilares que atraviesan una planta sin forjado (doble altura): en C1 entran en el diafragma, porque C1-e no puede saberlo;
- el giro de la sección de las vigas.

## C1: criterios de paso

1. **Oráculo publicado.** SAP2000 1-022 (ETABS ej. 7) descrito como modelo físico da los valores publicados del caso LAT dentro del redondeo, como en E6.
2. **Oráculo a mano.** Una batería de modelos pequeños, cada uno con su modelo analítico escrito a mano a partir de la descripción física, sin llamar al compilador. Cubre: pórtico 3D, viga excéntrica, zonas rígidas, liberaciones, viga en polilínea, vigas que se cruzan, pilar apeado, cargas sobre zonas rígidas y cargas puntuales excéntricas. Los desplazamientos y los esfuerzos de extremo tienen que coincidir a ≤ 1e-10.
3. **Metamórficas del compilador.** Sobre modelos aleatorios:
   - reordenar las listas da el mismo modelo analítico bit a bit;
   - una traslación o un giro en planta da resultados transformados;
   - un ruido menor que ε_geom no cambia la topología;
   - un ruido menor que ε_snap da la misma topología con avisos;
   - partir una viga en dos colineales, o invertir su sentido, da los mismos resultados.
4. **Sin pérdidas y equilibrio** en cada compilación (regla 3), además del equilibrio del motor.
5. **Entradas no válidas.** Un catálogo de modelos físicos no válidos: cada uno da su diagnóstico con el `id` físico, y ninguno lanza.
6. **Determinismo y huella.** La huella SHA-256 es la misma en Node (V8) y en Bun (JSC) y no depende del orden de las listas. Los vectores de prueba de SHA-256 pasan.
7. **Rendimiento.** Las barras del edificio objetivo (7 plantas con 80 pilares y sus vigas) compilan en sobremesa en una fracción del tiempo de cálculo.
8. **Referencia congelada** del modelo analítico y de sus resultados (regla de oro 1).

## C2: alcance y decisiones

**Modelo físico de C2** (se añade a C1 en `fisico.ts`):
- `losas`: planta, contorno (polígono simple), huecos, espesor, material (hormigón o general), `pp` (kN/m²; por defecto γ·t, el de una maciza, H24) y `eje1` (grados desde +X; por defecto 0).
- `apoyosLineales`: polilínea de una planta con sus GDL coartados. Tiene que ir sobre losa: las vigas sobre muros llegan con C3.
- `bandas`: rectángulos de dimensionado (eje `desde`→`hasta` y `ancho`) cuyos lados se siembran en la malla (D5, E5-5). En C2 sólo se siembran; las automáticas y su integración son de C5.
- Cargas nuevas:
  - `superficie` (kN/m², global) sobre una losa entera o sobre una zona poligonal de una planta;
  - `lineal` (kN/m, global) sobre una polilínea de una losa.

  La `puntual` puede caer ya en una losa.
- Opción `tamanoMalla` (h, m).

**Cómo malla C2** (H29, H23):
1. **Un arreglo plano por planta** con todo lo que la malla tiene que respetar:
   - contornos y huecos de las losas, ejes de las vigas y huellas de los pilares;
   - apoyos lineales, zonas y líneas de carga, lados de las bandas;
   - puntos: cargas y apoyos puntuales, y los nudos de C1, que no se mueven.

   Con ε_snap, un vértice se une al punto o al segmento cercano, un punto cercano a un segmento lo parte y los cruces crean puntos. Al acabar no quedan dos puntos a menos de ε_snap, ni un punto a menos de ε_snap de un segmento ajeno, ni cruces: lo que constrainautor exige.
2. **Siembra:** cada segmento, a paso ≤ 2h. Retícula triangular de Steiner a 2h por losa, orientada con su `eje1`, anclada en uno de sus vértices y a ≥ 0,45·2h de los segmentos (COM-11: sin puntos cocirculares).
3. **CDT** (delaunator 5.1.0 + constrainautor 4.1.0, versiones en la huella) sobre los puntos ordenados canónicamente. Se quedan los triángulos cuyo centroide cae en una losa y fuera de sus huecos, y cada uno se divide en 3 cuadriláteros (vértice, puntos medios y centroide), con la normal hacia +Z.
4. **Validador obligatorio** (H23):
   - Σ áreas = área de la losa menos sus huecos, a 1e-9;
   - normal +Z;
   - cada segmento del arreglo y cada punto obligatorio, en la malla;
   - sin nudos huérfanos;
   - jacobiano escalado en los 4 puntos de Gauss: error si es ≤ 0, aviso si es bajo.

   Si falla, el error nombra la losa.

**Decisiones por defecto de C2.** Como en C1, cada una es una opción o una regla registrada en las hipótesis:

| # | Decisión | Por defecto | Por qué | Alternativa |
|---|---|---|---|---|
| C2-a | Tamaño de malla | h = **0,75 m** (triángulos de 1,5 m, cuadriláteros de ~0,57 m: ~10 por vano de 5,5 m) | H10 pide 8 por vano. Con h = 0,75, el edificio objetivo se queda en ~37 000 nudos, dentro de D9; con 0,5 pasaría de 80 000 (H52 × 1,6 del CDT). Las caras se comprueban por fuerzas nodales, que no dependen de la malla (E5-5) | `tamanoMalla` |
| C2-b | Geometría de las losas | Sus vértices se unen a lo cercano a ≤ ε_snap, con aviso del desplazamiento y del área que cambia; las cargas se calculan sobre la geometría unida | En una lámina no hay offsets: es la única excepción a «la geometría no se mueve» | — |
| C2-c | Borde de losa dentro del ancho de una viga y a más de ε_snap de su eje | **Error** | La losa quedaría suelta de la viga sin aviso. Los bordes van a ejes, como en SAP2000 y ETABS | Dibujar el borde sobre el eje |
| C2-d | Unión pilar–losa | **Huella rígida:** los nudos de la losa en la huella del pilar (o a ≤ ε_snap de ella) son esclavos de un enlace rígido con maestro en su nudo, que a su vez es esclavo del diafragma (cadena, E1). Un pilar sin dimensiones se une en un punto, con aviso (H09) | H09, COM-15 y E5: con la huella, el momento en la cara converge; en un punto, diverge | — |
| C2-e | Vigas embebidas | Se parten en los nudos de la malla sobre su eje, salvo en los de las huellas. Su zona rígida sigue siendo la de C1-a. La zona rígida de la cabeza del pilar cuenta también el espesor de la losa | La viga trabaja con la losa nudo a nudo (H29). Fuera de las huellas, para que C1-a conserve su sentido | — |
| C2-f | Diafragma con losas | En una planta con losas entran los nudos sobre ellas, también los de las vigas y pilares que caen dentro; las huellas, por la cadena. Los que quedan fuera (pilares en dobles alturas, vigas sin losa) no entran. «ninguno» con losas es un forjado semirrígido | Cierra C1-e y los pilares de doble altura de C1 | `diafragma: "ninguno"` por planta |
| C2-g | Peso propio | Losa: `pp` (por defecto γ·t), como carga de superficie del caso de peso propio. Viga de hormigón rectangular bajo losa: sólo su descuelgue; se le quita (b/2)·min(h, t) por cada lado cubierto por losa | H24: en una viga plana el peso se contaba dos veces. Con el lado como unidad, una viga de borde con la losa a ejes pierde sólo la mitad que solapa | — |
| C2-h | Cargas sobre losa | Zonas y líneas sembradas en la malla: superficie, por lámina entera; lineal, a los nudos de sus aristas (exacto con las funciones lineales del borde); puntual, en un vértice sembrado, con el momento de transporte si se une a otro a ≤ ε_snap. La parte de una zona fuera de las losas no es carga, con aviso | H29 y COM-14. La resultante física se calcula sin la malla (recortes de polígonos) para que «sin pérdidas» compruebe el mallado | — |

**Lo que C2 deja fuera:**
- losas inclinadas, rampas y losas a otra cota que la de su planta;
- el refinado local (Ruppert); la rejilla alineada para zonas regulares (H52) llegó después, con la decisión C2-a (`rejilla.md`);
- cargas lineales variables y zonas con carga variable;
- las bandas automáticas y su integración (C5), los muros (C3) y los forjados reticular y unidireccional (C4);
- el solape del peso del pilar con la losa, y el de las vigas que no son rectangulares de hormigón.

## C2: criterios de paso

1. **Oráculo analítico.** Placas de Navier (isótropa delgada y gruesa de E3) descritas como modelo físico con apoyos lineales: la malla de C2 converge con orden ≈ 2 a la serie de Mindlin, y con h = 0,25 queda a ≤ 0,5 % en w y en M, como la rejilla de E3 (H29: 0,2 % entre ellas).
2. **Oráculo de E5.** La losa plana de H25 descrita como modelo físico, con pilares y bandas: My y Vz de la banda de pilar y del pórtico virtual en la cara (fuerzas nodales) y My en el vano, a ≤ 1 % de los de la rejilla de E5.
3. **Validador de malla** en una batería de plantas aleatorias (losas con huecos, vigas oblicuas, pilares girados, zonas, líneas y bandas): todas sus comprobaciones pasan y la calidad queda medida.
4. **Metamórficas:**
   - reordenar las listas da el mismo modelo analítico bit a bit;
   - una traslación y un giro de 90° (con el `eje1`) dan la misma malla y los resultados transformados;
   - un giro cualquiera, los resultados girados a la precisión de la malla;
   - un ruido menor que ε_geom no cambia la malla, y uno menor que ε_snap no cambia la topología de C1 (con avisos).
5. **Sin pérdidas** en cada compilación (≤ 1e-9), con la resultante física calculada sin la malla, y equilibrio del motor.
6. **Entradas no válidas:** un catálogo de losas, cargas, apoyos lineales y bandas no válidos da su error con el id físico, sin lanzar.
7. **Determinismo y huella:** la misma malla en V8 y en JavaScriptCore; la huella no depende del orden de las listas.
8. **Rendimiento:** el edificio objetivo con losa maciza (7 plantas, 80 pilares) compila en una fracción del cálculo y, con el h por defecto, cabe en D9.
9. **Referencia congelada** del modelo analítico y de sus resultados.

## Decisiones del usuario

- **Licencia ISC:** admitida por el usuario el 2026-10-04 (regla 6 de `CLAUDE.md`). El mallador de C2 usa delaunator y constrainautor (H29).
- **Licencia Unlicense:** admitida por el usuario el 2026-10-04 sólo para robust-predicates 3.0.3 (los predicados exactos de Shewchuk), que delaunator y constrainautor importan directamente.
- **C1-a, C1-c, C1-d y D4:** decididas por el usuario el 2026-10-04 con las medidas de `validacion/c1/out_decisiones.txt`: factor de zona rígida 0,5, D4 (b) por material, y C1-c y C1-d como estaban.
- **C2-a, tamaño de malla** (decidida el 2026-10-05, con `validacion/c2/out_decisiones.txt` y `out_banco.txt`): se mantiene h = 0,75 y se añade la rejilla alineada de H52 en las zonas regulares, que es lo que baja los nudos sin perder precisión. Con 0,75 y sólo la CDT, el edificio objetivo tenía 79 649 nudos y 199 983 ecuaciones (×1,6 los nudos de D9). **Hecha el 2026-10-05** (`rejilla.md`): 34 737 nudos y 90 657 ecuaciones, con la cara del pilar mejor que con la CDT del mismo h; el criterio 8 de C2 pasa.
- **C2-c** (decidida el 2026-10-05): un borde de losa dentro del ancho de una viga y fuera de su eje es un **error**. Obliga a dibujar las losas a ejes.
- **C2-g** (decidida el 2026-10-05): una viga rectangular de hormigón bajo losa pesa sólo su descuelgue: se le quita (b/2)·min(h, t) por cada lado cubierto. Evita contar dos veces el 8,6 % del caso G.
- **Rejilla con h = 0,75, su deriva (−0,75 %), C3-a, C3-d, C3-g, C3-i y R-9** (confirmadas el 2026-10-08, con las medidas de `rejilla.md` §4 y `fase-c3.md` §4):
  - **C3-a:** 12 filas por planta en los muros; **C3-g:** se quita el solape del peso de muro y losa; **C3-i:** la viga perpendicular se une al muro por su huella.
  - **C3-d:** los dinteles en el diafragma, y un aviso (`muro/dintel-en-diafragma`) cuando un dintel de ≥ 1,5 m entra en el diafragma rígido de una planta sin losa, donde el efecto llega al 15–35 % (C3-4, E6-3): para el sismo, contrastar con `diafragma: "ninguno"`.
  - **R-9:** un hueco dibujado a ejes entre vigas es válido. C2-c mide ahora lo que un borde avanza a lo largo de la viga dentro de su ancho, así que los bordes que sólo la cruzan de través (los del hueco y del contorno que acaban en su eje) no cuentan.
- **C4-a, C4-c, C4-e, C4-h y C4-i** (confirmadas el 2026-10-05, con `validacion/c4/out_decisiones.txt`), con tres cambios que hacen el compilador C4.1 (`fase-c4.md`, §6):
  - **C4-i:** el casetón por defecto es el perdido, el caso más común en obra, y entonces el `pp` es obligatorio (`reticular/sin-pp`). Sin `pp`, sólo con `caseton: "recuperable"`.
  - **C4-e:** los muros paralelos a las viguetas en un lado del paño también son receptores de borde. Las losas paralelas, más adelante.
  - **C4-k, nueva:** cuando las viguetas en voladizo no tienen vano detrás, porque no lo hay o porque un hueco lo corta, la viga que las sujeta trabaja a torsión de equilibrio, y su torsión no se reduce. Con el vano detrás en la misma recta, el voladizo se compensa sin torsión, y se ha medido.

## C3: alcance y decisiones

**Modelo físico de C3** (se añade a C2 en `fisico.ts`):
- `muros`: eje en planta (polilínea; cada tramo es un paño plano y vertical), planta de base y de cabeza (como los pilares), `espesor`, `material` (hormigón o general) y `base` (`"empotrado"` por defecto, `"articulado"` o `"ninguno"`).
  - `huecos`: rectángulos en el alzado, dados por la estación a lo largo del eje (desde su primer punto) y la altura sobre la base del muro. Cada uno cae en un tramo; pueden llegar a la base de una planta (puertas) y cruzar plantas (dobles alturas).
  - Los muros van de forjado a forjado, con el eje en el plano medio y los bordes de las losas sobre él (a ejes, como C2-c).
- Carga nueva `empuje`: presión normal a una cara del muro, con ley lineal en z entre dos cotas y nula fuera de ellas (el terreno, el agua o una sobrecarga). Va sobre el muro entero.
- Las cargas puntuales y lineales de una planta pueden caer ya sobre el eje de un muro.

**Cómo malla C3** (H17, H29):
1. **Estaciones del eje.** El arreglo plano de cada planta (el de C2) lleva también los ejes de los muros que la tocan, con prioridad tras las huellas. Los puntos del arreglo sobre el eje de un muro (cruces con vigas, losas, bandas y otros muros, pilares y cargas) son sus estaciones en esa planta.
   - Los vértices de los muros se ajustan antes, igual en todas sus plantas (a otro vértice de muro, a un nudo de C1 sin huella o en T a otro muro), para que cada paño sea plano.
   - Una primera pasada da las estaciones de cada planta; las de todas las plantas (y los bordes de los huecos) se agrupan a ≤ ε_snap y cada grupo se queda con un punto, que la segunda pasada pone fijo en todas las plantas de sus muros (C3-1).
   - Un paño necesita las mismas estaciones en su cabeza y en su base, así que lo que aún falte en una planta se inserta con las mismas coordenadas, hasta que nada cambia.
   - Entre dos estaciones seguidas se reparte una división graduada (como la siembra de C2) de paso ≤ min(2h, L/4), con L el tramo recto de muro que la contiene: ≥ 8 elementos por tramo recto (H17).
   - En las losas, esos lados ya van sembrados: la malla de C2 no los vuelve a partir, y sus puntos medios (la división en 3 cuadriláteros) son también nudos del muro.
2. **Rejilla por paño.** Columnas en las estaciones y sus puntos medios; filas en las cotas de las plantas, de los bordes de los huecos y de los cambios de ley de los empujes, cada intervalo dividido en partes iguales de ≤ min(h, máx(H/12, h/4)), con H la altura de la planta (C3-2). Las filas de una planta se unifican entre los muros que se tocan (esquinas, T y cruces), para que su arista común sea conforme.
3. Se quitan los elementos que caen en un hueco. Las láminas tienen el eje 1 horizontal a lo largo del tramo y el 2 hacia +Z (la regla de CSI), y el 3 a la derecha del sentido del eje.
4. **Validador** (H23, como el de C2), en cada compilación: Σ áreas de cada muro = su alzado sin los huecos calculado por franjas, a 1e-9, y elementos no degenerados. La conformidad con las losas y la ausencia de nudos sueltos salen de la construcción (los nudos de la cota se crean sólo donde hay muro o losa) y las comprueban las pruebas. Aviso si un elemento es más de 4 veces más alto que ancho, o al revés, fuera de las huellas de los pilares.

**Decisiones por defecto de C3.** Como en C1 y C2, cada una es una opción o una regla registrada en las hipótesis:

| # | Decisión | Por defecto | Por qué | Alternativa |
|---|---|---|---|---|
| C3-a | Tamaño de la malla de los muros | El de las losas (`tamanoMalla`): columnas a ~h, ≥ 8 elementos por tramo recto, y filas a ≤ min(h, máx(H/12, h/4)) | H17: con 8 elementos, −1,2 % en un muro en voladizo; con 1, −32 %. La cabeza tiene que coincidir con la malla de la losa. Con 8 filas por planta, un muro de sótano en flexión cilíndrica sale un 1,3 % flexible; con 12, un 0,6 %; h/4 evita filas muy finas en plantas bajas (C3-2) | `tamanoMalla` |
| C3-b | Geometría de los muros | Sus vértices se unen a lo cercano a ≤ ε_snap con aviso, como las losas (C2-b). Un borde de losa dentro del espesor de un muro y fuera de su eje es un error, como C2-c | En una lámina no hay offsets. Los bordes van a ejes | Dibujar el borde sobre el eje |
| C3-c | Encuentros | Muro–muro: la arista común (esquina, T o cruce) tiene los mismos nudos. Muro–losa: nudos comunes a lo largo del eje. Muro–pilar: el nudo del pilar en la planta es una estación, y los nudos del muro en esa cota dentro de su huella van con su enlace rígido (C2-d); entre plantas, el pilar y el muro no se unen | Conformidad sin penalizaciones. Unir el pilar al muro en toda su altura (como un elemento de borde) queda para más adelante | — |
| C3-d | Diafragma y dinteles (E6-3) | Los nudos del muro en la cota de una planta entran con la misma regla que el resto (C2-f, o C1-e en una planta sin losas), también los de lo alto de los dinteles | Con losa encima, el dintel está coaccionado por ella. Medido en un muro acoplado de 6 plantas: −6,1 % de desplazamiento frente a la losa semirrígida; sin los dinteles, −4,3 %; sin losas y sin dinteles (SAP2000 15c), +15,5 % (C3-4) | `diafragma: "ninguno"` por planta |
| C3-e | Viga en el plano de un muro (H05, E0-6) | Si corre por el eje del muro, se parte en sus nudos (embebida, como C2-e). Si acaba en el muro en su plano sin solaparse con él, se prolonga dentro con barras auxiliares de su sección por la fila de nudos de la planta, a lo largo de su canto y al menos un elemento | E0: la viga embebida a lo largo de su canto queda a −0,3 / −3,2 % de `ASDShellQ4`; unida en un nudo, el giro de drilling es singular | — |
| C3-f | Base de los muros | Empotrada (todos los nudos de la base). `"ninguno"`: el muro nace sobre una viga, una losa u otro muro, que tienen que llegarle | Como los pilares (C1) | `base` por muro |
| C3-g | Peso propio de los muros | γ·t por m² de alzado sin huecos, de forjado a forjado, menos el solape con las losas: (t/2)·(e/2) por cada lado cubierto por una losa de espesor e y por cada muro que llega a esa planta (el de debajo y el de encima) | Como C2-g (H24): la losa ya pesa hasta el eje del muro | — |
| C3-h | Empujes | Por lámina, con su valor en cada nudo (bilineal, exacto con una ley lineal); las cotas donde cambia la ley son filas de la malla | La resultante física, sin la malla (alzado menos huecos), comprueba el mallado | — |
| C3-i | Viga perpendicular (u oblicua) que acaba en un muro | **Huella de la viga:** los nudos del muro bajo la cota, a lo largo de su canto y a ≤ b/2 + ε_snap de su eje, son esclavos de un enlace rígido con maestro en su extremo | H09: unida en un nudo, su momento en el muro diverge al refinar (−18 %, −25 % y −35 % frente a la huella con h = 0,75, 0,375 y 0,1875); con la huella, ±2 % (C3-3) | — |

**Lo que C3 deja fuera:**
- muros inclinados, de espesor variable dentro de un tramo y huecos que no son rectangulares;
- pilares unidos al muro en toda su altura (elementos de borde);
- muros que no van de forjado a forjado (antepechos, muros que acaban a media planta);
- cimentación: zapatas corridas, muros sobre terreno elástico (de momento, base empotrada o articulada);
- cargas de superficie generales sobre muros (viento en fachada): sólo empujes.

## C3: criterios de paso

1. **Oráculo publicado.** Los muros de ETABS 15 (a–f) descritos como modelo físico. Con la misma malla que el modelo hecho a mano de E6 (15a, 15c y 15e, donde las dos coinciden), los mismos desplazamientos a ≤ 1e-9. Con la malla del compilador, los valores de SAP2000 con la tolerancia de E6 (15a, 15e y 15f con la geometría del PDF) y, en 15b, 15c y 15d, el modelo a mano de E6 a ≤ 1 % con su malla más fina.
2. **Oráculos analíticos:**
   - muro en voladizo de varias plantas frente a la viga de Timoshenko: ≤ 2 % con la malla por defecto y orden ≈ 2 al refinar (H17);
   - muro de sótano bajo empuje hidrostático, en flexión cilíndrica: momento en la base y flecha en cabeza a ≤ 1 %;
   - losa apoyada en dos muros paralelos frente al pórtico equivalente de barras: momento en el vano y en el encuentro a ≤ 2 %;
   - viga en el plano de un muro (el voladizo de E0): a ≤ 3 % del modelo embebido de E0 y ≤ 2× la solución rígida (H05).
3. **Validador de malla** en una batería de edificios al azar con muros (sótano perimetral, núcleo con huecos, muros sobre vigas, pilares que arrancan de muros): todas sus comprobaciones pasan y la calidad queda medida.
4. **Metamórficas:** reordenar las listas (bit a bit); trasladar y girar 90° (la misma malla) y un giro cualquiera (resultados girados); ruido < ε_geom (la misma malla) y < ε_snap (la misma topología, con avisos); invertir el sentido de un muro y partirlo en dos colineales (los mismos resultados).
5. **Sin pérdidas** en cada compilación (≤ 1e-9), con la resultante física calculada sin la malla (peso con huecos y solapes, empujes con huecos), y equilibrio del motor.
6. **Entradas no válidas:** un catálogo de muros, huecos y empujes no válidos da su error con el id físico, sin lanzar.
7. **Determinismo y huella:** la misma malla en V8 y en JavaScriptCore; la huella no depende del orden de las listas.
8. **Rendimiento:** el edificio objetivo con un núcleo de muros y muros de sótano compila en una fracción del cálculo.
9. **Referencia congelada** del modelo analítico y de sus resultados.

## C4: alcance y decisiones

**Modelo físico de C4** (se añade a C3 en `fisico.ts`):
- `losas[].reticular`: forjado reticular (D3). La losa es la zona aligerada, con nervios en la dirección de su `eje1` y en la perpendicular; su `espesor` es el canto total h.
  - `intereje` (s, m, entre ejes de nervios, el mismo en las dos direcciones), `nervio` (ancho bw, m) y `capa` (capa de compresión hf, m);
  - `abacos`: polígonos macizos (multiplicador 1). Pueden salirse de la losa: cuenta su parte dentro;
  - `multiplicadores` (opcional): sustituyen a los calculados y se aplican sobre la maciza con el ν del material, como en SAP2000.
  - `pp`: si se da, el peso medio de toda la losa con los ábacos (como el de la tabla C.5 del CTE y el de Cargas por planta). Sin él, γ por el volumen de hormigón de un casetón recuperable en la zona aligerada y γ·h en los ábacos.
- `panos`: paños de forjado unidireccional (D2), que valen también para placas alveolares y chapa colaborante (barras unidireccionales con su intereje, H46).
  - Contorno y huecos en planta, como una losa y a ejes (C2-c);
  - `direccion` de las viguetas (grados desde +X), `intereje` (m) y `seccion` de la vigueta (la T bruta, con bf = intereje, u otra);
  - `pp` (kN/m²), obligatorio: incluye las bovedillas, que la sección no conoce (H24).
- Cargas: una carga de superficie puede ir sobre un paño (`pano`) o sobre una zona que lo cubra; las lineales y las puntuales de una planta pueden caer ya en un paño.
- Opción `modificadores.viguetas`, por material como los de las vigas.

**Cómo se hace el reticular** (D3, H46):
1. **Multiplicadores de la zona aligerada.** Salen de la sección en T de un nervio (bf = s, hf, bw, h) y reproducen la rigidez de un emparrillado de nervios: E·I_T/s a flexión, sin acoplamiento de Poisson (un emparrillado no lo tiene: la zona aligerada lleva ν = 0 y G compensado). Con G_c = E/(2(1 + ν)) el del hormigón y G₀ = E/2 el de ν = 0:
   - m11 = m22 = I_T / (s·h³/12);
   - f11 = f22 = A_T / (s·h);
   - m12 = (G_c/G₀)·(hf³ + 6·J_w/s) / h³: la torsión de la capa como placa más la de las almas de los nervios de las dos direcciones, igualando la energía (J_w, la de Saint-Venant del rectángulo bw × (h − hf));
   - v13 = v23 = (G_c/G₀)·bw/s;
   - f12 = (G_c/G₀)·hf/h (el cortante en su plano lo lleva la capa).
2. **Ábacos.** Sus lados se siembran en la malla (como las bandas) y cada lámina lleva los multiplicadores si su centroide cae fuera de ellos.
3. **Peso propio** por lámina (zona aligerada y ábacos). La resultante física se calcula por regiones, sin la malla.

**Cómo se hace el unidireccional** (D2, H46, E2-3):
1. **Contorno unido.** Un vértice del paño a ≤ ε_snap de un nudo de C1, del eje de una viga o del de un muro se lleva a él (a su cruce, si son dos), con aviso (C2-b). Las viguetas y las cargas van sobre el contorno unido.
2. **Rectas de las viguetas.** Los paños de una planta con la misma dirección y el mismo intereje que comparten un lado forman un grupo. Sus viguetas siguen las mismas rectas, separadas `intereje`, y son continuas sobre sus apoyos comunes. Las rectas se centran en el ancho W del grupo: n = round(W/s), con la primera a (W − (n − 1)·s)/2 de su borde.
3. **Tramos y apoyos.** Cada recta se recorta al paño sin sus huecos, y cada trozo es una vigueta.
   - Sus apoyos son los ejes de vigas y muros que cruza o en los que acaba, las huellas de pilar por las que pasa o en las que acaba, y los bordes de losa en los que acaba.
   - Un extremo sin apoyo es un voladizo. Una vigueta sin ningún apoyo es un error (mecanismo), y con uno solo (sin seguir en otra vigueta de la misma recta), un aviso.
   - Acabar en el borde de otro paño sin viga entre ellos es un error.
   - Una viga o un muro dentro del paño y paralelos a sus viguetas no reciben su carga: aviso, para partir el paño por ellos (C4-11).
4. **Nudos.**
   - Un apoyo a ≤ ε_snap de un nudo que ya existe (de C1, de otra vigueta o un vértice de muro) lo reutiliza.
   - Si no, el nudo es nuevo: sobre el eje de la viga (que se parte), sobre el del muro (una estación) o en el borde de la losa (un nudo de su malla).
   - El hueco entre la vigueta y su nudo va en un offset, y en una huella de pilar, con la zona rígida de C1-a.
5. **Barras:** una por tramo entre apoyos consecutivos, sin nudos intermedios (E2-3).
6. **Reparto de las cargas** (C4-e) y **diafragma** (C4-g). El momento de transporte va a los nudos del receptor por interpolación lineal (C4-1): no depende del sentido de la vigueta ni de qué extremo lleva la torsión liberada.

**Decisiones por defecto de C4.** Como en C1–C3, cada una es una opción o una regla registrada en las hipótesis:

| # | Decisión | Por defecto | Por qué | Alternativa |
|---|---|---|---|---|
| C4-a | Posición de las viguetas | Rectas comunes por grupo de paños contiguos con la misma dirección e intereje, centradas en su ancho (n = round(W/s)) | Las viguetas de dos vanos seguidos tienen que caer en la misma recta para ser continuas: si no, el momento del apoyo pasa por la torsión de la viga (×0,1) y la vigueta queda casi articulada. Centrar deja los bordes a ~s/2 | — |
| C4-b | Apoyos de las viguetas | Vigas, muros, huellas de pilar y bordes de losa; voladizo con aviso si sólo hay un apoyo; error sin ninguno o en el borde de otro paño sin viga | Un mecanismo no puede llegar al motor sin decirlo, y dos paños se separan siempre por una viga o un zuncho | — |
| C4-c | Torsión de las viguetas | **Liberada en un extremo** de cada tramo entre apoyos (E2-3); los voladizos la conservan. Sin zona rígida en las vigas (como C1) | La torsión de una vigueta fisurada no cuenta, y con ella haría de muelle al giro de flexión de la viga. Liberarla en los dos extremos dejaría el giro de un nudo sin rigidez | `modificadores.viguetas` |
| C4-d | Unión de los extremos | Reutiliza el nudo a ≤ ε_snap; si no, un nudo nuevo sobre la viga o el muro, o en el borde de la losa. En una huella de pilar, el nudo del pilar con offset y zona rígida (C1-a, C1-b) | Sin penalizaciones y sin mover la vigueta | — |
| C4-e | Reparto de las cargas del paño | **Regla de la palanca** en la dirección transversal entre los receptores consecutivos de cada estación (las viguetas y los lados del paño paralelos a ellas que van sobre una viga o, desde C4.1, sobre un muro, a sus nudos de la cota). Más allá del receptor extremo (un borde libre o sin viga ni muro), a esa vigueta con el momento de transporte en sus nudos; más allá del extremo de una vigueta, a su nudo | Exacta en fuerzas y momentos (sin pérdidas) y física: la franja entre la última vigueta y una viga paralela se apoya en las dos. Por tramos entre cortes, cada receptor recibe una carga trapecial estáticamente equivalente | — |
| C4-f | Peso propio del unidireccional | El `pp` del paño, repartido como C4-e; la vigueta no pesa γ·A. La viga bajo el paño pesa sólo su descuelgue (C2-g con el canto de la vigueta) | El pp incluye las bovedillas (H24) | — |
| C4-g | Diafragma | En una planta con paños, el rígido abarca los nudos sobre ellos y sobre las losas (C2-f). «ninguno» en una planta con paños es un aviso | Sin la membrana de la capa de compresión, el paño sólo tiene la rigidez en su plano de vigas y viguetas | `diafragma` por planta |
| C4-h | Multiplicadores del reticular | Del emparrillado de nervios, **con ν = 0 en la zona aligerada** y G compensado. Los dados por el usuario, sobre la maciza con el ν del material | Con ν = 0,2 y m11 = I_T/I_maciza, el modelo es un 4 % más rígido que los nervios (1/(1 − ν²)) y acopla las dos direcciones como una losa, lo que en un recuadro cuadrado sube el momento de vano | `multiplicadores` |
| C4-i | Peso propio del reticular | `pp` dado: medio, en toda la losa. **Casetón perdido por defecto (C4.1): sin `pp` es un error.** Con `caseton: "recuperable"` y sin `pp`: γ·volumen de hormigón en la zona aligerada y γ·h en los ábacos | El pp de la tabla C.5 y de Cargas por planta ya promedia los ábacos. El peso de un casetón perdido depende de su material, y es el caso más común en obra | `pp`, `caseton` |
| C4-j | Resultados | Cada vigueta es una pieza (`<paño>:v<n>`, en orden transversal) con sus esfuerzos por estación (`EsfuerzosPiezas`); las láminas de los ábacos van marcadas en el mapeo | D2: «se ven los esfuerzos por vigueta». El momento por nervio del reticular es M11·s, para C5 | — |
| C4-k | Torsión de equilibrio (C4.1, pedida por el usuario) | Una línea de viguetas continuas con un solo apoyo (un voladizo sin vano detrás, también por un hueco, o un balancín) sujeta por una viga: los tramos de la viga desde ese nudo hasta el primer pilar, muro u otra viga que coarta su giro **van sin el J de D4** y se marcan (`torsionEquilibrio` en el mapeo), con aviso e hipótesis. Un pilar, un muro o una losa la sujetan por su flexión | La torsión de compatibilidad puede reducirse; la de equilibrio no, porque sin ella el voladizo no se sostiene, y hay que dimensionarla. Con ×0,1 la fuerza sale igual pero el giro es diez veces mayor (la punta del voladizo, 8,55 mm en vez de 1,45) | `torsionEquilibrio: false` |

**Lo que C4 deja fuera:**
- ábacos automáticos alrededor de los pilares (los dibuja el usuario o Concreta);
- reticular con distinto intereje en cada dirección, casetones no rectangulares y nervios de canto variable;
- en el unidireccional, la opción de articular las viguetas en sus apoyos, el momento negativo mínimo y las viguetas dobles junto a los huecos;
- receptores de borde sobre losas: un lado paralelo sobre una losa no recibe carga de la franja de borde, que va a la última vigueta (los muros sí, desde C4.1);
- la torsión de equilibrio de una losa en voladizo sujeta sólo por una viga de borde (C4-k es sólo para viguetas);
- forjados inclinados y a otra cota que la de su planta.

## C4: criterios de paso

1. **Oráculo a mano del unidireccional.** Una batería de paños pequeños con su modelo analítico escrito a mano, sin el compilador: paño entre dos vigas, vigas paralelas que reciben la franja de borde, dos vanos continuos con voladizo, vigueta que acaba en una huella de pilar, paño oblicuo y paño con un hueco. Desplazamientos y esfuerzos de extremo a ≤ 1e-10. Además, dos vanos iguales sobre muros dan la reacción central de la viga continua (1,25·q·L, H46) a ≤ 1 %.
2. **Oráculos del reticular:**
   - los multiplicadores de 25+5, 30+5 y 35+10 frente al cálculo a mano de la T;
   - la placa de Navier ortótropa con esos multiplicadores, descrita como modelo físico: ≤ 0,5 % en w y M con h = 0,25 y orden ≈ 2;
   - un recuadro reticular apoyado en su contorno y otro sobre pilares con ábacos frente al emparrillado de nervios como barras (el modelo de CYPECAD, H46): ≤ 3 % en la flecha y ≤ 5 % en el momento por nervio del centro.
3. **Batería de plantas al azar** con paños (oblicuos, con huecos, voladizos y contiguos) y reticulares con ábacos: el validador de la malla, «sin pérdidas» y el equilibrio pasan en todas, y ninguna vigueta queda en mecanismo.
4. **Metamórficas:**
   - reordenar las listas da el mismo modelo bit a bit;
   - trasladar y girar 90° da la misma malla y las mismas viguetas, y un giro cualquiera, los resultados girados;
   - un ruido < ε_geom no cambia nada;
   - invertir el sentido del contorno o girar la dirección 180° da lo mismo;
   - partir un paño por una viga interior perpendicular a las viguetas da los mismos resultados.
5. **Sin pérdidas** (≤ 1e-9) en cada compilación, con la resultante física calculada sin viguetas ni malla (polígonos del paño unido, de los ábacos y de la zona aligerada), y equilibrio del motor.
6. **Entradas no válidas:** un catálogo de paños, reticulares y cargas sobre paños no válidos da su error con el id físico, sin lanzar.
7. **Determinismo y huella:** el mismo modelo en V8 y en JavaScriptCore; la huella no depende del orden de las listas (tampoco del de los ábacos).
8. **Rendimiento:** el edificio objetivo con reticular y ábacos (H52 V2) y con unidireccional (V3) compila en una fracción del cálculo y cabe en D9.
9. **Referencia congelada** del modelo analítico y de sus resultados.

## C5: alcance y decisiones

C5 cierra el compilador. Las bandas de dimensionado de las losas pasan de sembrarse (C2) a proponerse e integrarse. Los machones y dinteles de los muros salen como cortes. Y los resultados se consultan por objeto físico, que es lo que piden los módulos de comprobación de Concreta (H35) y la capa de agente (A1, `agente.md`).

Se hace por partes, cada una con sus tests y su commit:
- **C5.1:** bandas propuestas;
- **C5.2:** esfuerzos de banda y Wood–Armer;
- **C5.3:** machones y dinteles;
- **C5.4:** consultas por objeto físico y combinaciones.

**Modelo físico de C5** (se añade a C4 en `fisico.ts`):
- `bandas[]` gana:
  - `tipo`: `"pilares"` o `"central"`;
  - `origen`: `"propuesta"`, si la dio el compilador y no se ha tocado, o `"usuario"`, si la ha creado o editado. La memoria las distingue (D5).
- `casos[]` gana `accion`, opcional: el tipo de acción y sus datos (`tipo`, `psi`, `familia`, `permanente`, `direccion`, `signo`, `duracion`), los mismos que `CasoCarga` de `src/combinaciones/`. Sin ella, las consultas son por caso o por combinaciones dadas con sus factores.

**Cómo se proponen las bandas** (C5.1, D5, H25; Anejo I del EC2, que transpone el Anejo 19 del CE):
1. **Plantas y direcciones.** En cada planta con losa maciza o reticular (los paños unidireccionales ya dan sus viguetas), las dos direcciones de los ejes de la losa: su `eje1` y la perpendicular.
2. **Alineaciones de pilares.** En cada dirección, los pilares que llegan a la planta (su cabeza o un tramo que la atraviesa) se agrupan por su coordenada transversal. Dos pilares están en la misma alineación si sus ejes distan ≤ τ en esa coordenada (C5-b). Una alineación necesita ≥ 2 pilares. Su eje pasa por la media de sus pilares.
3. **Banda de pilares** de cada alineación (I.1.2(1), figura I.1):
   - va del primer pilar al último, prolongada hasta el borde de la losa si el voladizo es ≤ el vano contiguo;
   - mide a cada lado lx/4, con lx la menor dimensión de los recuadros de ese lado: la distancia a la alineación paralela y el vano a lo largo de ella. En una alineación de borde, el lado exterior llega como mucho hasta el borde de la losa;
   - en un reticular, si los ábacos de la alineación miden más de lx/3 en la dirección transversal, la banda toma su ancho (I.1.2(3)).
4. **Bandas centrales:** lo que queda entre dos bandas de pilares paralelas consecutivas, con la misma longitud.
5. **Recorte:** cada banda se recorta a la losa (sin sus huecos). Las que salen de la losa se acortan, y una que queda con menos de la mitad de su área se descarta, con aviso.
6. **Estaciones** de cada banda, a lo largo de su eje:
   - las caras de los apoyos que cruza (la huella del pilar o del ábaco, o un muro);
   - el centro de cada vano.

   Las líneas de las caras se siembran en la malla a lo ancho de la banda, como sus bordes (C2), para que su corte por fuerzas nodales sea exacto (E5-5).

**Cómo se integran** (C5.2, E5):
1. **Por caso:** en cada estación, un corte de la banda (`Cortes`) da [N, Vy, Vz, T, My, Mz] en los ejes de la banda.
   - En las caras va «fuerzas-nodales», exacto.
   - En los vanos va «campos», mixto, con muestras para Wood–Armer.
   - Una combinación es la combinación lineal de sus casos.
2. **Momentos por metro y por nervio:** M/ancho y, en un reticular, M·s/ancho por nervio (C4-j).
3. **Wood–Armer** (H34): por combinación, nunca sobre la envolvente, con los momentos medios de la banda (C5-c).
   - mx y mxy, exactos del corte (My/b y T/b);
   - my, la media de las muestras.

   La envolvente guarda el máximo por cara y dirección y la combinación que lo da.

**Machones y dinteles** (C5.3, C3, E5):
- **Machón:** cada trozo de muro entre huecos, o entre un hueco y el extremo, en cada planta. Cortes horizontales en su base y su cabeza (las filas de la malla en la cota y en los bordes de los huecos), por fuerzas nodales. Da N, V y M como un pilar, en los ejes del muro.
- **Dintel:** el trozo de muro sobre un hueco y bajo la cota. Cortes verticales en sus extremos (las caras del hueco, ya en la malla) y en su centro. Da V y M como una viga.

**Consultas por objeto físico** (C5.4, H35, A1):
- **Pilares:** por planta, en la cabeza y en la base, N (+ compresión), Vy, Vz, T, My y Mz en los ejes de la sección física (b, h y su giro), con la longitud del tramo.
- **Vigas y viguetas:** por pieza y vano, con estaciones y en las caras de los apoyos: N, V, T y M; momento de vano y de apoyos.
- **Bandas, machones y dinteles:** sus estaciones (C5.2, C5.3).
- **Apoyos:** sus reacciones.
- **Plantas:** desplazamiento del maestro del diafragma y deriva entre plantas.
- **Losas:** la flecha máxima por recuadro.

Las consultas trabajan por caso, por combinación o en envolvente (máximo y mínimo con la combinación que los da). Las unidades son kN y m, con los signos documentados en la cabecera. Dan exactamente lo que `EsfuerzosPiezas`, `Cortes` y `CamposLaminas` dan llamados a mano (`agente.md`).

**Decisiones por defecto de C5:**

| # | Decisión | Por defecto | Por qué | Alternativa |
|---|---|---|---|---|
| C5-a | Bandas automáticas | **Una propuesta** (`proponerBandas(fisico)`) que se guarda en el modelo físico; compilar no las añade por su cuenta | D5: se proponen y se editan, y cambiar una banda cambia la malla. Si el compilador las añadiera solo, cambiarían todos los modelos ya validados | Añadirlas al compilar cuando no haya ninguna |
| C5-b | Tolerancia de alineación τ | **τ = 0,1 × la menor separación entre alineaciones de la planta, y como mínimo ε_snap** | Un replanteo real tiene pilares desplazados unos centímetros; τ sólo une los que son la misma alineación | Fija (p. ej. 0,30 m) |
| C5-c | Wood–Armer en la banda | **(a)** sobre los momentos medios de la banda, con mx y mxy exactos del corte | Es lo que pide el Anejo I (el momento de la banda, repartido en su ancho) y es exacto en la cara del apoyo. (b), repartir el My exacto según las muestras punto a punto, se mide como contraste. E5-5 descarta integrar las muestras crudas en la cara | (b) |
| C5-d | Reparto pilares/central | **El que da el cálculo** (el corte de cada banda), con un aviso si sale del 60–80 % (negativos) o del 50–70 % (positivos) de la tabla I.1 | Por elementos finitos el reparto ya sale del cálculo; la tabla es la referencia del método simplificado | Imponer la tabla |
| C5-e | Machones de borde con pilar | El pilar unido al muro en la cota va **aparte** (su barra), y se dice en el resultado del machón | Sólo se unen en la cota (C3); sumarlo sería otra pieza | Sumarlo al machón |
| C5-f | Combinaciones | **De `src/combinaciones/`** cuando los casos llevan `accion`; si no, por caso o con factores dados | El generador CTE/NCSE ya está validado (fase 1 de S1) | Sólo por caso |

**Lo que C5 deja fuera:**
- el punzonamiento a 2d (necesita cortes por polilínea cerrada, E5);
- el límite de momento transmitido a los pilares de borde y esquina (I.1.2(5)), que es del módulo de punzonamiento;
- los extractores de cada módulo de Concreta (`DesignActionExtractor`, H35), que van con la integración en Concreta: C5 da las consultas en kN y m con su convenio, y el extractor de cada módulo sólo convierte;
- las bandas de losas sobre muros o vigas sin pilares (losas apoyadas en su contorno), que hoy se dibujan a mano.

## C5: criterios de paso

1. **Bandas propuestas frente a un cálculo a mano:**
   - una retícula regular (3 × 3 vanos de 6 × 5 m) da los anchos lx/4 por lado y las centrales que faltan;
   - alineaciones con pilares desplazados (≤ τ y > τ);
   - un voladizo;
   - un reticular con ábacos > lx/3;
   - una losa con un hueco que corta una banda;
   - las bandas editadas se respetan tal cual.
2. **Integración exacta:**
   - en una línea de caras sembrada, la suma de las bandas de pilares y centrales que la cruzan es el corte de toda la losa (≤ 1e-9);
   - en un pórtico virtual entero, M⁺ + (M⁻ᵢ + M⁻ⱼ)/2 = q·b·L²/8 por estática (≤ 1e-9);
   - la losa plana de H25 da su reparto (77 % en la banda de pilares) y su convergencia (±1 %).
3. **Wood–Armer:**
   - por combinación frente a `woodArmer` a mano;
   - la envolvente no pierde el máximo y guarda la combinación;
   - medida (a) frente a (b) en la losa plana de H25 y en un reticular.
4. **Machones y dinteles:**
   - en cada planta, la suma de los machones es el corte de la planta por el muro (≤ 1e-9);
   - un muro en voladizo con un hueco frente a la estática;
   - el muro acoplado de ETABS 15c frente a sus esfuerzos de dintel y de machón (con la referencia corregida de E6-2).
5. **Consultas:**
   - cada una da lo mismo que llamar a mano a `EsfuerzosPiezas`, `Cortes` o `CamposLaminas` (≤ 1e-12);
   - una combinación es la combinación de sus casos;
   - las envolventes no pierden el máximo;
   - las unidades y los signos de la cabecera se prueban con una ménsula y un pilar a mano.
6. **Entradas no válidas:** bandas editadas fuera de la losa, de ancho nulo o en una planta sin losa, y consultas a objetos que no existen, dan su diagnóstico con el id físico, sin lanzar.
7. **Determinismo y huella:**
   - la propuesta de bandas no depende del orden de las listas;
   - trasladar y girar 90° da las mismas bandas trasladadas y giradas;
   - la huella incluye las bandas.
8. **Rendimiento:** proponer las bandas, integrarlas en todas las combinaciones del edificio objetivo y responder a las consultas cuesta una fracción del cálculo.
9. **Referencia congelada** de las bandas propuestas, sus esfuerzos y las consultas.
