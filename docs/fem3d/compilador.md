# Compilador: plan por fases (Fase 2 de S1)

> **Qué es.** El compilador convierte el modelo físico (plantas, pilares, vigas, losas, muros, cargas) en el `ModeloAnalitico` del motor, con un mapeo de ida y vuelta y diagnósticos que nombran objetos físicos. Es el «núcleo diferencial» del §7 del diseño. **Fecha:** 2026-10-04.
>
> Sustituye al §7 del diseño técnico con lo que cambian la investigación (COM-01…20, H28, H29) y las fases E0–E6 del motor. Lo de PyNite que el motor propio ya no necesita (barras de penalización, nudos conformes forzados por falta de MPC, troceado por cargas) desaparece.
>
> **Estado:** C1 superada el 2026-10-04 (`fase-c1.md`). C2 terminada el 2026-10-05 (`fase-c2.md`): pasan ocho de los nueve criterios y el 8 (tamaño frente a D9) queda a medias, pendiente de la decisión C2-a. Siguiente: C3 (muros).

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
- la rejilla alineada para zonas regulares (H52) y el refinado local (Ruppert);
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

## Preguntas para el usuario (no bloquean C3)

- **Licencia ISC:** admitida por el usuario el 2026-10-04 (regla 6 de `CLAUDE.md`). El mallador de C2 usará delaunator y constrainautor (H29).
- **Licencia Unlicense:** admitida por el usuario el 2026-10-04 sólo para robust-predicates 3.0.3 (los predicados exactos de Shewchuk), que delaunator y constrainautor importan directamente.
- **C1-a, C1-c, C1-d y D4:** decididas por el usuario el 2026-10-04 con las medidas de `validacion/c1/out_decisiones.txt`: factor de zona rígida 0,5, D4 (b) por material, y C1-c y C1-d como estaban.
- **C2-a, tamaño de malla** (`validacion/c2/out_decisiones.txt`, `out_banco.txt`): con h = 0,75, el edificio objetivo tiene 79 649 nudos y 199 983 ecuaciones (×1,6 los nudos de D9, justo en el perfil móvil); con h = 1, 61 365 y 145 089, pero la cara de una banda pierde un 4,5 %. ¿Mantener 0,75, pasar a 1, o 0,75 con la rejilla alineada de H52 en las zonas regulares?
- **C2-c:** ¿un borde de losa dentro del ancho de una viga es un error (por defecto) o un aviso?
- **C2-g:** ¿se confirma que una viga rectangular de hormigón bajo losa pesa sólo su descuelgue ((b/2)·min(h, t) menos por cada lado cubierto)? Evita contar dos veces el 8,6 % del caso G.
