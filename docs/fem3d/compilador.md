# Compilador: plan por fases (Fase 2 de S1)

> **Qué es.** El compilador convierte el modelo físico (plantas, pilares, vigas, losas, muros, cargas) en el `ModeloAnalitico` del motor, con un mapeo de ida y vuelta y diagnósticos que nombran objetos físicos. Es el «núcleo diferencial» del §7 del diseño. **Fecha:** 2026-10-04.
>
> Sustituye al §7 del diseño técnico con lo que cambian la investigación (COM-01…20, H28, H29) y las fases E0–E6 del motor. Lo de PyNite que el motor propio ya no necesita (barras de penalización, nudos conformes forzados por falta de MPC, troceado por cargas) desaparece.
>
> **Estado:** C1 superada el 2026-10-04 (`fase-c1.md`). Siguiente: C2.

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
| C1-a | Nudos de dimensión finita | Zonas rígidas con factor 1: la viga es rígida dentro del pilar y el pilar dentro del canto de la viga más alta que le llega | CYPECAD trata el cruce como un «nudo de dimensión finita» (ccadmc01, p. 15). E2 ya prevé offsets desde las caras | `factorZonaRigida` en [0, 1]; con 0, como SAP2000 por defecto |
| C1-b | Viga excéntrica respecto al pilar | Se une al nudo del pilar con un offset que lleva la excentricidad, siempre que su eje pase por la huella del pilar | Sin penalización y sin mover la viga | — |
| C1-c | Eje analítico de la viga | En el plano del forjado (sin offset vertical) | Con diafragma rígido, una viga con offset vertical trabaja como una T de ala infinitamente rígida. En un pórtico de 6 m con viga de 30×60, la flecha baja un 21 %, el momento en la cara sube un 16 % y aparece un axil de 87 kN que no existe (C1-5) | `insercion: "superior"` por viga, con aviso si la planta tiene diafragma rígido |
| C1-d | Diafragma | Rígido en todas las plantas menos la más baja | Como CYPECAD. En la más baja suelen estar los arranques empotrados, y un GDL esclavo no puede llevar apoyo | `diafragma: "ninguno"` por planta. El semirrígido llega con las losas (C2) |
| C1-e | Qué nudos entran en el diafragma | Todos los de la cota de la planta | Sin la geometría de la losa (C2) no se sabe dónde hay forjado | En C2, por la geometría de la losa |
| C1-f | Un apoyo en ux, uy o rz de un nudo con diafragma rígido | Error con la planta y el apoyo | El motor no admite apoyos en GDL esclavos. Moverlo al maestro no es equivalente | Quitar el diafragma de esa planta |
| C1-g | Modificadores de rigidez | Ninguno, hasta que se decida D4 | D4 sigue pendiente (S2). La recomendación es la de CYPECAD | `modificadores` por tipo de pieza |
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

## Preguntas para el usuario (no bloquean C1)

- **D4:** modificadores de rigidez por defecto (C1-g).
- **Licencia ISC** (delaunator y constrainautor, para el mallador de C2): equivale a MIT, pero la regla 6 de `CLAUDE.md` no la nombra. Hay que admitirla o escribir la CDT propia.
- **C1-a, C1-c y C1-d** son decisiones de modelado con efecto del 5–35 % en rigidez. Se pueden cambiar por opción, pero el valor por defecto es criterio profesional.
