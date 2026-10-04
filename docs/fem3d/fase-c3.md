# Fase C3 — compilador de muros: resultado

> **Fecha:** 2026-10-05. **Plan:** `compilador.md` (alcance, decisiones C3-a…C3-i y criterios de C3), que concreta la fase C3: «rejilla por paño con ≥ 8 elementos (H17), encuentros muro–muro y muro–losa, viga embebida en el plano del muro (H05, E0-6), dinteles y qué nudos del muro entran en el diafragma (E6-3), empujes por nudos».
>
> **Veredicto: pasan los nueve criterios.**
> - Los muros de ETABS 15 descritos como modelo físico dan, con la misma malla, lo mismo que los modelos a mano de E6 (≤ 1,4e-11), y los valores de SAP2000 con la tolerancia de E6.
> - Los cuatro oráculos analíticos quedan dentro de su tolerancia con la malla por defecto:
>   - el muro en voladizo, a −0,44 % de Timoshenko;
>   - el muro de sótano con empuje, a +0,6 % en flecha y 0,5 % en momento;
>   - la losa sobre dos muros, a −1,6 % en el encuentro y −0,9 % en el vano;
>   - la viga en el plano de un muro, a −0,6 % del modelo embebido de E0.
> - La malla es la misma al reordenar (bit a bit), al trasladar, al girar 90° o 37°, con un ruido de 1e-8 m y en V8 y JavaScriptCore. Invertir un muro o partirlo en dos da los mismos resultados.
> - «Sin pérdidas» queda en ≤ 1,4e-14 en 24 modelos al azar, y 40 entradas no válidas dan su error con el id físico, sin lanzar.
> - El edificio objetivo con un núcleo y un muro de sótano perimetral compila en 2,5 s (el 34 % del cálculo).
>
> **Hallazgos principales:**
> - **C3-3:** una viga perpendicular unida a un muro en un nudo es singular. Su momento en el muro diverge al refinar: −18 % con la malla por defecto y −35 % con la fina. Con la huella de la viga en el muro converge (±2 %), así que C3-i pasa a ser la huella.
> - **C3-1:** un pilar girado deja esquinas de su huella a milímetros del eje del muro, y cada planta resolvía ese «casi encuentro» de otra manera. Por eso las estaciones se unifican en dos pasadas.
> - **C3-5:** las metamórficas encontraron que la numeración canónica dependía de un ulp en dos nudos del mismo sitio. Está corregido.
>
> **Cómo leerlo:** la tabla resume los criterios, que se fijaron al empezar la fase. Cada sección da el detalle y la evidencia. Lo que queda para el usuario está en «Decisiones por defecto» y en «Pendiente».

| # | Criterio | Resultado | Evidencia |
|---|---|---|---|
| 1 | Oráculo publicado: ETABS 15 (a–f) como modelo físico. Con la malla de E6, ≤ 1e-9; con la del compilador, SAP2000 con la tolerancia de E6 (15a, e, f) y ≤ 1 % del modelo a mano más fino (15b, c, d) | **Pasa.** Misma malla (15a, b, c, e, f): ≤ 1,4e-11 en las 27 magnitudes. Frente al modelo a mano más fino: ≤ 0,90 %. 15a, 15e y 15f frente a SAP2000: dentro de la tolerancia de E6 (el peor, 15a-1-720, −3,5 % con un 5 % admitido). 15d tiene otra malla (8 elementos por ala, H17): a ≤ 0,14 % del modelo a mano más fino | `oraculos-c3.test.ts`; `validacion/c3/out_etabs15.txt` |
| 2 | Oráculos analíticos con la malla por defecto: voladizo ≤ 2 % y orden ≈ 2; sótano ≤ 1 %; losa sobre muros ≤ 2 %; viga en el plano ≤ 3 % de E0 y ≤ 2× la rígida | **Pasa** en las tolerancias. Voladizo −0,44 %, aunque el orden no se puede medir frente a Timoshenko, que no es el límite de la elasticidad plana (H17 lo extrapola a −0,28 %). Sótano: +0,59 % en w y 0,51 % en M, con orden 2. Losa sobre muros: encuentro −1,6 % (corte por fuerzas nodales) y vano −0,9 %. Viga en el plano: −0,59 % de E0 y 1,33× la rígida | `oraculos-c3.test.ts`; `validacion/c3/out_oraculos.txt` |
| 3 | Validador de la malla de los muros en edificios al azar | **Pasa.** 24 modelos (12 semillas, con y sin losas): el validador de cada compilación (área de cada muro = su alzado sin huecos a 1e-9) pasa en todos. En 6, las pruebas comprueban además rectángulos verticales, conformidad muro–losa y que no queden nudos sueltos. Aspecto ≤ 7,8 fuera de las huellas, en «casi encuentros» que se avisan | `muros.test.ts`; `validacion/c3/out_resumen.txt` |
| 4 | Metamórficas: reordenar, trasladar y girar, ruido < ε_geom y < ε_snap, invertir un muro y partirlo | **Pasa** en 5 semillas. Reordenar: idéntico en modelo, mapeo y diagnósticos. Traslación y giros de 90° y 37°: la misma malla y u a ≤ 9,4e-13. Ruido de 1e-8 m: la misma malla. Ruido de ±1,5 cm: la misma topología de C1, con avisos. Invertir y partir: ≤ 1e-9 | `metamorficas-c3.test.ts`; `out_resumen.txt` |
| 5 | Sin pérdidas (≤ 1e-9) con la resultante física sin la malla, y equilibrio | **Pasa.** 24 modelos al azar: ≤ 1,4e-14; equilibrio del motor ≤ 1,9e-14. Edificio objetivo: 1,9e-13 | `muros.test.ts`; `out_resumen.txt`; `out_banco.txt` |
| 6 | Entradas no válidas con su id físico, sin lanzar | **Pasa.** 40 entradas de muros, huecos, empujes y cargas y apoyos sobre muros; ninguna lanza ni llega a `compilador/error-interno` | `invalidos-c3.test.ts` |
| 7 | La misma malla en V8 y JSC; la huella no depende del orden | **Pasa.** 10 modelos (ETABS 15c, d y f, y 7 al azar con y sin losas): topología idéntica y coordenadas a ≤ 1e-12 entre Node y Bun. La huella no depende del orden y cambia con 1e-9 m en un muro, con un hueco o con h | `huella-c3.test.ts`; `validacion/c3/huellas.ts` |
| 8 | Rendimiento: el edificio objetivo con un núcleo y muros de sótano compila en una fracción del cálculo | **Pasa.** 2,5 s, el 34 % del cálculo (7,3 s), con la misma huella en cada repetición. 88 683 nudos y 249 417 ecuaciones: los muros añaden 9 088 láminas y un 25 % de ecuaciones a las de C2 (ver «Pendiente») | `validacion/c3/out_banco.txt` |
| 9 | Referencia congelada | **Pasa.** ETABS 15c y 15f, el muro de sótano con empuje, la viga en el plano de un muro y un modelo al azar con losas y muros: modelo a 1e-12 y resultados a 1e-9 con los dos solvers. Generada con Bun y comprobada en Node | `congelado-c3.test.ts` |

---

## 1. Qué hay nuevo

| Fichero | Qué hace |
|---|---|
| `src/compilador/fisico.ts` | Muros (eje en polilínea, plantas de base y cabeza, espesor, material, base y huecos en alzado) y la carga `empuje` |
| `src/compilador/validar.ts` | Validación de muros, huecos y empujes; muros solapados |
| `src/compilador/muros.ts` | Ajuste de los vértices, estaciones comunes (dos pasadas) y unificadas entre plantas, división graduada, filas por grupo de paños, huecos y empujes unidos, rejilla, validador, barras auxiliares (C3-e) y huellas de las vigas (C3-i) |
| `src/compilador/losas.ts` | Por fases: arreglo de cada planta con los ejes de los muros, estaciones, malla de las losas con los lados de los muros ya sembrados, nudos de la cota y uniones (huellas, vigas embebidas, cargas y apoyos sobre muros) y rejilla de los muros |
| `src/compilador/arreglo.ts`, `mallado.ts` | Trazo «muro», puntos fijos de muro y partición forzada de un lado; siembra graduada como función, y lados ya sembrados |
| `src/compilador/cargas.ts`, `piezas.ts`, `compilar.ts`, `mapeo.ts` | Peso de los muros con el solape (C3-g), empujes con un valor por nudo (C3-h) y su resultante física; apoyos de la base; barras auxiliares; láminas, huellas de vigas, mapeo y versión C3.0 |
| `src/pruebas/murosAleatorios.ts` | Muros al azar: sótano con ventana y empuje, núcleo con puertas, vigas que acaban en su esquina y muro apeado sobre una viga |
| `validacion/c3/` | ETABS 15 como modelo físico, oráculos analíticos, banco, decisiones, huellas, resumen y referencia congelada |

**Uso:** el de C1 y C2. El mapeo trae además el muro de cada lámina (`mapeo.laminas[i].muro`), las láminas de cada muro (`mapeo.muros`), las barras auxiliares (`mapeo.barras[i].auxiliar`, fuera de `piezas`) y la viga de cada huella en un muro (`mapeo.restricciones[i].viga`).

## 2. Cómo malla C3

- **Vértices de los muros:** se ajustan una sola vez, igual en todas sus plantas: a otro vértice de muro que comparta planta, a un nudo de C1 sin huella o, en T, al interior de otro muro. Así cada paño es plano.
- **Estaciones en dos pasadas (C3-1).** La primera pasada da, en el arreglo de cada planta, los puntos sobre el eje de cada muro. Los de todas las plantas, junto con los bordes de los huecos, se agrupan a ≤ ε_snap, y cada grupo se queda con un punto: un nudo de C1, si no un vértice de muro, si no el más cercano al eje. La segunda pasada pone esos puntos fijos en todas las plantas de sus muros.
- **Lo que aún falte** en la cabeza o la base de un paño se inserta con las mismas coordenadas: ninguna estación se mueve, y cada franja entre dos estaciones es un rectángulo vertical.
- **División de cada intervalo:** la siembra graduada de C2 de paso ≤ min(2h, L/4), con L el tramo recto de muro (≥ 8 elementos, H17), y el mismo número de partes en todas las plantas. Los lados del eje quedan sembrados para la malla de la losa, cuyos puntos medios son también columnas del muro.
- **Filas:** cotas de planta, bordes de huecos y cambios de ley de los empujes, unidas a ≤ ε_snap por grupos de paños que se tocan, y cada intervalo a ≤ min(h, máx(H/12, h/4)) (C3-2).
- **Rejilla** sin los elementos de los huecos. Los nudos de la cota de una planta se crean sólo donde hay muro debajo o encima: un hueco de doble altura no deja nudos sueltos.
- **Uniones:**
  - con los otros muros, por sus aristas;
  - con las losas, nudo a nudo;
  - con los pilares, por su huella en la cota;
  - con las vigas que corren por su eje, partiéndolas;
  - con las vigas que acaban en su extremo en su plano, con barras auxiliares a lo largo de su canto (C3-e);
  - con las que acaban fuera de su plano, con su huella (C3-i).
- **Validador:** área de cada muro frente a su alzado sin huecos calculado por franjas (1e-9) y elementos no degenerados. Aviso de aspecto > 4 fuera de las huellas.

## 3. Hallazgos de C3

| ID | Hallazgo | Consecuencia |
|---|---|---|
| C3-1 | **Las estaciones de un muro no salían iguales en todas sus plantas.** Un pilar girado deja una esquina de su huella a milímetros del eje del muro: en una planta el eje se doblaba hasta la esquina y en otra se cortaba con su lado. Al copiar las estaciones de una a otra quedaban dos puntos a 0,2 mm; con ellos, la siembra graduada llenaba un intervalo con 225 puntos, o el emparejamiento no convergía | Dos pasadas: las estaciones de todas las plantas se agrupan a ≤ ε_snap y la segunda pasada lleva fijo un punto por grupo. El tamaño de un rasgo en la división nunca baja de ε_snap. Los bordes de los huecos entran en el agrupamiento |
| C3-2 | **8 filas por planta no bastan para la flexión de placa del muro:** el muro de sótano en flexión cilíndrica sale un 1,3 % flexible con la malla por defecto (filas de 0,375); con 12, un 0,6 %, y con 16, un 0,3 %. Pero H/12 en un sótano de 1,5 m da filas de 12,5 cm y elementos 6 veces más anchos que altos (3 056 avisos en el edificio objetivo) | Filas a ≤ min(h, máx(H/12, h/4)): 12 por planta normal y nunca más finas que h/4. Con h/4, los avisos del edificio objetivo bajan a 54 y las láminas de muro, de 11 212 a 9 088 |
| C3-3 | **Una viga perpendicular unida a un muro en un nudo es singular** (H09): su momento en el muro baja un 18, 25 y 35 % frente a la huella con h = 0,75, 0,375 y 0,1875, y el del vano sube un 9, 12 y 18 %. Es del lado inseguro en el apoyo | C3-i cambia: la viga se une por su huella (enlace rígido con los nudos del muro en su ancho y su canto, bajo la cota). Con ella, ±2 % entre las tres mallas |
| C3-4 | **El diafragma rígido sobre un muro acoplado con losas lo rigidiza un 6,1 %** frente a la losa semirrígida (la referencia física). Sacando los dinteles del diafragma, un 4,3 %. Sin losas, dejar fuera los dinteles (como SAP2000 en 15c) lo flexibiliza un 15,5 % | Se mantiene C3-d (los dinteles en el diafragma, como el resto de la cota): con losa encima, el dintel está coaccionado por ella, y la diferencia con sacarlos (1,8 puntos) es menor que la del propio diafragma rígido. Para un muro acoplado crítico, `diafragma: "ninguno"` |
| C3-5 | **La numeración canónica dependía de un ulp:** dos nudos distintos en el mismo sitio (la base de un pilar y la de un muro, cada una con su apoyo) se ordenaban por su coordenada exacta, que al trasladar la planta cambia en un ulp. Las metamórficas lo vieron como un 66 % de error en las reacciones, porque emparejaban mal esos nudos | Tras las coordenadas cuantizadas a 1e-9, el desempate es el orden de creación (determinista). Las referencias de C1 y C2 no cambian. El emparejamiento de las pruebas va uno a uno y por la firma de cada nudo |
| C3-6 | **El control C3-b sumaba todo el muro:** en un muro perimetral cerrado, los bordes perpendiculares de la losa entran t/2 en su espesor junto a cada esquina, y la suma de las ocho esquinas pasaba del umbral | Se mira tramo a tramo, como C2-c en las vigas |
| C3-7 | **Una viga con sección «general» sin canto sólo se prolonga un elemento dentro del muro (C3-e):** en la viga en el plano de E0 da +10,8 %, el caso «embebida 1 elemento» de E0 | Es la regla de E0 (a lo largo del canto y al menos un elemento): para las barras auxiliares hace falta el canto de la sección. Las rectangulares, T e I lo tienen; las generales, si se da `h` |
| C3-8 | **Los muros añaden un 25 % de ecuaciones** al edificio objetivo (249 417 frente a 199 983 de C2): 9 088 láminas, sobre todo por las 12 filas por planta y por las estaciones de los cruces | Supera el perfil móvil (200 000 ecuaciones). La rejilla alineada de H52 en las losas (C2-a) es la palanca principal; también cabe aflojar las filas donde el muro no tiene flexión de placa relevante |

## 4. Decisiones por defecto (de `compilador.md`), con sus medidas

| Decisión | Por defecto | Medida | Para el usuario |
|---|---|---|---|
| C3-a, malla de los muros | Columnas a ~h, ≥ 8 por tramo recto; filas a ≤ min(h, máx(H/12, h/4)) | Voladizo −0,44 %; sótano +0,59 %; edificio objetivo, 9 088 láminas de muro | Confirmar las 12 filas por planta (con 8, el sótano sale un 1,3 % flexible y el edificio tiene un tercio menos de láminas de muro) |
| C3-d, diafragma y dinteles | Los dinteles en el diafragma | −6,1 % frente a la semirrígida; sin dinteles, −4,3 % | Confirmar |
| C3-g, solape del peso | Se quita (t/2)·(e/2) por lado cubierto y por muro | 6,6 % del peso de los muros del edificio objetivo | Confirmar (es la regla de C2-g) |
| C3-i, viga perpendicular | **Huella de la viga** (cambia frente al plan: era la unión en un nudo) | En un nudo, −18 % de momento en el muro con la malla por defecto y −35 % con la fina; con huella, ±2 % | Confirmar el cambio |
| C3-b, C3-c, C3-e, C3-f y C3-h | Como en el plan | Validadas por los criterios 1 a 6 | — |

## 5. Pendiente

- **Del usuario:** confirmar C3-a (12 filas por planta), C3-d, C3-g y el cambio de C3-i.
- **Para más adelante:**
  - la rejilla alineada de H52 en las losas (C2-a), más urgente con los muros (C3-8);
  - pilares unidos al muro en toda su altura (elementos de borde): hoy sólo en la cota de cada planta;
  - muros que no van de forjado a forjado (antepechos), de espesor variable o con huecos no rectangulares;
  - cargas de superficie generales sobre muros (viento) y cimentación (zapatas corridas, muros sobre terreno elástico);
  - unir los «casi encuentros» entre plantas (rasgos a poco más de ε_snap) para evitar franjas finas.
- **Validación externa:** comparar un edificio con núcleo y muros de sótano con un modelo del usuario en SAP2000 o CYPE (periodo «en sombra»).

## Cómo reproducir

```sh
bun run test:run                                       # todos los tests (E0–E6, Fase 1, C1, C2 y C3)
bun validacion/c3/etabs15.ts                           # criterio 1 → out_etabs15.txt
bun validacion/c3/oraculos.ts                          # criterio 2 → out_oraculos.txt
bun validacion/c3/resumen.ts                           # criterios 3, 4 y 5 → out_resumen.txt
node validacion/c3/banco.ts > validacion/c3/out_banco.txt            # criterio 8 (opcional: h)
node validacion/c3/decisiones.ts > validacion/c3/out_decisiones.txt  # decisiones C3-d, C3-i y C3-g
bun validacion/c3/congelar.ts                          # SÓLO a sabiendas: regenera la referencia congelada de C3
```
