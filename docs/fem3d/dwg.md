# DW: la plantilla desde un DWG (plan)

> **Fecha:** 2026-11-05. **Estado:** DW-a, DW-b y DW-c decididas por el usuario el 2026-11-05 (§6); DW-d y DW-e, propuestas (DW-d, puesta en DW1 como se proponía). **DW1 hecho el 2026-11-05** (§9); **DW2 y DW3, el mismo día** (§10 y §11).
>
> **Origen:** el usuario: «lo de tener que trabajar en DXF en lugar de DWG es un latazo». El 2026-10-28 se dejó el DWG sin decidir porque LibreDWG es GPL y el SDK de la ODA es de pago. Al mirarlo otra vez, apareció ACadSharp (MIT), que lee DWG, y se puede portar con la regla 6.

## 1. Lo que hay hoy

- **`src/dxf/lector.ts`** (V2c-4) lee un DXF ASCII y da un `Dxf`: versión, codificación, `$INSUNITS`, capas, bloques y entidades del espacio modelo. Cada entidad es su tipo, su capa y sus pares (código de grupo, valor) en el orden del fichero, sin interpretar.
- **`src/dxf/aplanar.ts`** saca la geometría de ese `Dxf`, y **no sabe de dónde viene**. Lee `LINE`, `POINT`, `CIRCLE`, `ARC`, `ELLIPSE`, `LWPOLYLINE`, `POLYLINE` (2D y 3D), `SPLINE`, `SOLID`, `TRACE`, `3DFACE`, `LEADER`, `TEXT`, `MTEXT`, `INSERT` (con `MINSERT` y atributos) y `DIMENSION`.
- **El DWG se rechaza** al leer (`lector.ts:113`: «Es un DWG: expórtalo a DXF…»), y los selectores de fichero de la app sólo aceptan `.dxf` (`Modelo.tsx`, `NavPlantillas.tsx`).

## 2. Qué se propone

Un lector de DWG que dé **el mismo `Dxf`**: las entidades, traducidas a sus códigos de grupo de DXF. Lo que viene detrás (aplanar, la plantilla, los enganches, la app y el almacén por sha256) no cambia. Para la app, un DWG es un DXF más.

- **Sólo leer,** y sólo lo que pide `aplanar.ts`: la cabecera (`$ACADVER`, `$INSUNITS`, `$DWGCODEPAGE`), la tabla de capas, los bloques y las entidades de §1. Lo demás (objetos de diccionario, estilos, tipos de línea, sombreados, imágenes, entidades proxy) se salta y se cuenta, como hoy lo que no se lee.
- **Portado de ACadSharp** (DW-a): el lector de DWG de [DomCR/ACadSharp](https://github.com/DomCR/ACadSharp), MIT, fijado en el commit `d9f3de8c9910b602d392aa1acc72b62c095ec40e` (2026-11-03). Se traduce a TypeScript sólo lo que hace falta (su `IO/DWG/DwgStreamReaders` son ~16 000 líneas de C#, y la mayor parte son objetos que no necesitamos). Se cita en `NOTICE`.
- **La especificación** de la ODA ([Open Design Specification for .dwg files](https://opendesign.com/files/guestdownloads/OpenDesign_Specification_for_.dwg_files.pdf), v5.4.1, gratuita, hasta la 2013) sirve para entender lo portado y para los comentarios. No se copia texto de ella.
- **Nada de LibreDWG por dentro:** su código fuente (GPL) no se lee durante esta fase. Sólo se usa su ejecutable, como oráculo, igual que OpenSees.

## 3. Arquitectura

- **`src/dwg/`** (puro, sin dependencias, sin IO):
  - `bits.ts`: el flujo de bits del DWG (B, BB, 3B, BS, BL, BLL, BD, RC, RS, RL, RD, MC, MS, H, TV/TU, CMC, DD, BT, BE, 2RD, 2DD, 3BD) y los CRC;
  - `secciones.ts`: la cabecera del fichero y las secciones. En R13–R2000 (AC1014, AC1015), los localizadores de secciones. Desde 2004 (AC1018 y AC1024–AC1032), el mapa de páginas con su cabecera cifrada y la descompresión LZ77. La 2007 (AC1021), con su Reed-Solomon y su LZ77 propio, va en DW5;
  - `objetos.ts`: el mapa de objetos (handle → posición), las clases, y la lectura de cada objeto con el flujo de datos, el de cadenas (desde AC1021) y el de handles;
  - `traducir.ts`: de cada entidad leída, sus pares de DXF (`LINE` → 10/20/30, 11/21/31, 39, 210/220/230…). Recorre el espacio modelo y los bloques por sus handles (`BLOCK_HEADER`, `ENDBLK`, `SEQEND`), y asigna las capas por handle;
  - `lector.ts`: `leerDwg(bytes): Dxf`, con `ErrorDxf` para todo lo que no se lee o está roto. Nunca otra excepción y nunca un bucle sin fin (topes por tamaño de sección).
- **`src/dxf/`:** `dibujoDxf(bytes)` mira la firma. `AC10…` va a `leerDwg` y lo demás, a `leerDxf`. Desaparece el mensaje de «expórtalo a DXF», salvo para lo que no se lee (AC1021 hasta DW5 y las versiones de antes de R13): «Guárdalo como DWG 2010 o 2018, o como DXF».
- **App:** los selectores aceptan `.dxf,.dwg`. El texto pasa a «Plantilla DXF o DWG» (DW-e). `PlantillaDxf` no cambia de forma (`fichero` es el nombre, con su extensión) y el proyecto no cambia de esquema.

## 4. Oráculos

1. **Las muestras de AutoCAD de ACadSharp** (el principal). `samples/sample_AC1014.dwg` … `sample_AC1032.dwg` son un mismo dibujo guardado por AutoCAD en cada versión (`samples/sample_base/save_samples.lsp`), con su DXF ASCII al lado, también de AutoCAD. Nuestro lector de DXF ya está contrastado con ezdxf (V2c-4, 2,7e-11), así que `dibujoDxf(dwg)` tiene que dar lo mismo que `dibujoDxf(dxf)`: es AutoCAD contra AutoCAD.
2. **Las versiones entre sí:** el DWG guarda los doubles tal cual (BD, RD), así que las siete versiones del mismo dibujo deberían dar la misma geometría bit a bit. Si no la dan, se explica por qué.
3. **Los DWG reales del usuario** (la vivienda y los que vengan), con el DXF que exporte su programa de CAD del mismo fichero. Se hace en local, fuera de git, como `validacion/sombra/`.
4. **ODA File Converter** (gratuito, no libre, opcional y sólo en local): para un DWG sin su DXF. Pasa el DWG a DXF, y ese DXF va a nuestro lector. ezdxf lo maneja con su módulo `odafc`.
5. **LibreDWG** (`dwgread -O JSON`, sólo el ejecutable, opcional): para ver un objeto concreto cuando las dos geometrías no casen.

## 5. Criterios de paso

1. **Las muestras:** en AC1014, AC1015, AC1018, AC1024, AC1027 y AC1032, `dibujoDxf(dwg)` y `dibujoDxf(dxf)` dan las mismas capas, el mismo número de segmentos, puntos y textos por capa, y las coordenadas a ≤ 1e-9 del tamaño del dibujo (el DXF redondea los doubles a las cifras que escribe AutoCAD; DW1 mide cuántas son y, si dan para menos, se ajusta la tolerancia con la medida). Lo que no se lee, contado igual.
2. **Entre versiones:** las seis versiones dan la misma geometría bit a bit, o cada diferencia está explicada.
3. **La vivienda:** su DWG frente al DXF exportado por el usuario, como el criterio 1 (en local, `validacion/dwg/out_vivienda.txt`).
4. **Robustez:** un catálogo de ficheros rotos (cortado en cada sección, bytes al azar en el mapa de páginas, CRC mal, handles que apuntan fuera, ciclos de bloques) da siempre `ErrorDxf` con un mensaje, nunca otra excepción ni un cuelgue (≤ 2 s por caso).
5. **Rendimiento:** la muestra de 1 MB se lee en el worker sin tareas largas en el hilo principal. El tiempo, sólo como información (`validacion/dwg/tiempos.ts`, en caliente y con el mínimo de tres pasadas).
6. **Chrome:** importar el DWG de la muestra en la app da la plantilla con el sha256 de Node (banco `validacion/dwg/chrome.ts`, como el de V2c-4).
7. **Licencias:** `NOTICE` cita ACadSharp con su commit. En `src/dwg/` no hay nada de LibreDWG.

## 6. Decisiones

- **DW-a (decidida, 2026-11-05):** portar de ACadSharp (MIT) y usar la especificación de la ODA para entenderlo, no escribir el lector desde cero con la especificación.
- **DW-b (decidida, 2026-11-05):** AC1014 y AC1015 (R14 y 2000: sin compresión y con el mismo lector de objetos), AC1018 (2004), y AC1024, AC1027 y AC1032 (2010, 2013 y 2018, el mismo camino en ACadSharp). AC1021 (2007) va al final (DW5). Antes de R13, nada.
- **DW-c (decidida, 2026-11-05):** los oráculos de §4. ODA File Converter, sólo si hace falta para un DWG del usuario sin su DXF.
- **DW-d (propuesta):** las muestras de ACadSharp no se versionan (son ~1 MB por DWG y ~2,6 MB por DXF, unos 25 MB en total). `validacion/dwg/muestras.ts` las descarga del commit fijado, comprueba su sha256 y las deja en `validacion/dwg/.muestras/` (ignorada por git). El CI las descarga igual. Sin ellas, la prueba falla con el mensaje de cómo traerlas, no se salta.
- **DW-e (propuesta):** el botón y la sección pasan a «Plantilla DXF o DWG». El tipo `PlantillaDxf` y el almacén `dxf` de IndexedDB se quedan con su nombre.

## 7. Tramos

- **DW1:** `bits.ts`, `secciones.ts` de R13–R2000 y `objetos.ts` con `LINE`, `CIRCLE`, `ARC`, capas y espacio modelo. Pasa el criterio 1 en AC1015 con lo que lea.
- **DW2:** el resto de entidades de §1 y los bloques (`INSERT`, `MINSERT`, atributos y bloques anónimos de las cotas). Pasan los criterios 1 y 2 en AC1014 y AC1015.
- **DW3:** el mapa de páginas de 2004+, LZ77 y el flujo de cadenas. Pasan los criterios 1, 2 y 4 en AC1018, AC1024, AC1027 y AC1032.
- **DW4:** la app (`dibujoDxf` por la firma, los selectores, los textos) y los criterios 3, 5, 6 y 7.
- **DW5 (después):** AC1021.

## 8. Riesgos

- **ACadSharp está en alfa.** Si una entidad de las nuestras sale mal, se corrige contra la especificación y el oráculo, y el arreglo se apunta en `NOTICE` y en los hallazgos. No se da por bueno lo que lee ACadSharp: manda el DXF de AutoCAD.
- **Los DWG de otros programas** (BricsCAD, ZWCAD, progeCAD, exportados desde Revit) pueden escribir cosas que AutoCAD no escribe. Por eso está el criterio 3 y, cuando lleguen, un DWG de cada uno con su DXF.
- **Lo que no está en el espacio modelo** (presentaciones y referencias externas) no se lee, como en el DXF. Una referencia externa sin enlazar se cuenta y se avisa.

## 9. DW1 hecho (2026-11-05)

R13–R2000 (AC1012, AC1014, AC1015), con las capas, `LINE`, `ARC` y `CIRCLE`. Pasa el criterio 1 en AC1015 con lo que lee, y el 2 entre AC1014 y AC1015.

### 9.1 Qué hay

- **`src/dwg/`** (puro, sin dependencias):
  - `bits.ts`: el flujo de bits (B, BB, RC, RS, RL, RD, BS, BL, BLL, BD, DD, BT, BE, MC, MS, H, TV) con un tope por sección: leer más allá es un `ErrorDxf`, nunca un valor inventado. Y el CRC-16 del DWG (semilla 0xC0C1);
  - `version.ts`: las versiones y sus banderas. Las de 2004 en adelante dicen todavía «Todavía no se leen los DWG 2004 (AC1018): guárdalo como DWG 2000 o como DXF»; las de antes de R13, que se guarde como 2010 o 2018;
  - `cabecera.ts`: la sección de variables hasta `$INSUNITS`, variable a variable con las condiciones de cada versión (también las de 2004+, para DW3). Guarda `$EXTMIN` y `$EXTMAX` para comprobar que la lectura no se descoloca;
  - `objetos.ts`: el mapa de objetos, la cabecera común de objetos y entidades (modo, capa, anterior y siguiente), el control de capas, las capas y `LINE`, `ARC` y `CIRCLE` traducidas a sus pares de DXF (los ángulos de radianes a grados; el espesor y la extrusión, sólo si no son los de por defecto, como AutoCAD);
  - `lector.ts`: `leerDwg(bytes)` da un `Dxf` con, además, `cabeceraDwg`, `handles`, `fallos` (los objetos que no se pudieron leer), `sinTraducir` (por tipo) y `posiciones`. Las entidades del espacio modelo van en el orden de su lista; las capas, en el de su tabla;
  - `comparar.ts`: el DWG frente al DXF del mismo dibujo, entidad a entidad por su handle (código 5): tipo, capa y los códigos geométricos de `CODIGOS_TIPO`, lo que falta en cada lado y el orden.
- **`validacion/dwg/muestras.ts`** (DW-d): descarga las muestras del commit fijado de ACadSharp, comprueba su sha256 y las deja en `validacion/dwg/.muestras/` (ignorada). El CI lo ejecuta antes de las pruebas.
- **`src/dwg/dwg.test.ts`**: los criterios 1, 2 y 4 de lo que hay.
- **`NOTICE`**: ACadSharp, con su commit, los ficheros portados y su licencia.
- La app no cambia todavía (DW4).

### 9.2 Criterios

| Criterio | Resultado |
|---|---|
| 1. AC1015 frente al DXF de AutoCAD | **Pasa:** las 35 entidades de los tipos traducidos (26 `LINE`, 8 `CIRCLE`, 1 `ARC`), por handle, en el mismo orden, con las mismas capas. Error máximo 4,2e-16 (la última cifra de las 16 que escribe el DXF). Las 21 capas, con la apagada y la congelada. `$INSUNITS` = 1; `$EXTMIN` y `$EXTMAX` a ≤ 1e-15. Ningún objeto en `fallos`. |
| 2. Entre versiones | **Pasa en AC1014 y AC1015:** la misma geometría bit a bit. |
| 4. Robustez | **Pasa en lo que hay:** cortado en diez sitios, siempre un `ErrorDxf`; 300 ficheros con 1 a 4 bytes cambiados al azar, o lo dice (`ErrorDxf` o un objeto en `fallos`) o sale exactamente lo mismo; un byte cambiado dentro de una `LINE` deja esa `LINE` en `fallos` y las demás iguales. |
| 3, 5, 6, 7 | En DW4 (5, 6 y 3) y al final (7, ya en `NOTICE`). |

Tiempo, como información: la muestra de 1,3 MB, en ~6 ms en Bun.

### 9.3 Hallazgos

- **DW1-1: ACadSharp no comprueba los CRC al leer, y aquí se comprueban todos los de R2000:** el de la cabecera del fichero (desde el byte 0 hasta el final de los localizadores, con la marca del final), el de la sección de variables, el de cada trozo del mapa y el de cada objeto. Sin ellos, un byte dañado en una coordenada daría una línea en otro sitio sin aviso, que es lo que la regla 1 no admite. Con ellos, el objeto dañado se salta y se dice. Que pasen todos los objetos de las dos muestras confirma también la lectura de los tamaños.
- **DW1-2: R14 no guarda `$INSUNITS` y escribe las capas en mayúsculas**, con «0 @ 1» como «0___1». Es lo que hace AutoCAD al guardar en R14, no un fallo del lector: la prueba compara el R14 con el DXF de 2000 adaptado así, y la geometría es la de 2000 bit a bit. En la app, un DWG R14 tendrá `$INSUNITS` vacío y las unidades se propondrán por el tamaño del edificio, como con un DXF sin él.
- **DW1-3: los DXF de las muestras están en GitHub con LF.** Un clon con `core.autocrlf` (el de Windows por defecto) los pasa a CRLF y cambia su sha256: el script descarga los bytes de GitHub, no los de un clon.
- **DW1-4: los `BLOCK` y `ENDBLK` de `*Model_Space` tienen el modo 2** (espacio modelo, sin propietario). No se dibujan ni cuentan como «sin traducir».

### 9.4 Lo siguiente

DW2: el resto de entidades de §1 (`LWPOLYLINE`, `POLYLINE` y sus vértices, `ELLIPSE`, `SPLINE`, `POINT`, `SOLID`, `TRACE`, `3DFACE`, `LEADER`, `TEXT`, `MTEXT`, `INSERT` y `MINSERT` con atributos, y las cotas), los bloques con su base y sus entidades, las clases (para las entidades de tipo ≥ 500) y la comparación de `aplanar` entero frente al DXF.

## 10. DW2 hecho (2026-11-05)

R13–R2000 entero para lo que dibuja `aplanar.ts`: todas las entidades de §1, los bloques, las clases y los propietarios (vértices de polilíneas y atributos de inserciones). Pasa el criterio 1 en AC1015 con todo el dibujo y el 2 entre AC1014 y AC1015, con las diferencias explicadas.

### 10.1 Qué hay

- **`src/dwg/entidades.ts`:** `POINT`, `ELLIPSE`, `LWPOLYLINE`, `POLYLINE` 2D y 3D con sus `VERTEX`, las mallas y las caras (sólo su bandera de malla, que `aplanar` no dibuja), `SPLINE`, `SOLID`, `TRACE`, `3DFACE`, `LEADER`, `TEXT`, `ATTRIB`, `MTEXT`, `INSERT` y `MINSERT` con su bloque, y las siete cotas (lo común y su bloque anónimo, que ya lleva el dibujo). Lo que `aplanar` no dibuja sale sólo con su tipo de DXF, y así cuenta igual entre las no leídas.
- **`objetos.ts`:** la cabecera de bloque (`BLOCK_HEADER`: nombre, base y su `BLOCK`), el nombre de cada `BLOCK` y la sección de clases (AcDb:Classes, con su CRC) para los tipos ≥ 500.
- **`lector.ts`:** las entidades se agrupan por propietario (bloque, polilínea o inserción) y cada lista va en su orden (anterior y siguiente). Los bloques salen con su nombre y su base; `INSERT` y `DIMENSION` llevan en el código 2 el nombre de su bloque; las entidades de clase, su nombre de DXF. Lo de los espacios papel, vacío, como el DXF (código 67).
- **`bits.ts`:** `cuenta(n, bits)`: un recuento leído (vértices, nudos, reactores, entradas) que no cabe en lo que queda del objeto es un `ErrorDxf`, no una reserva de memoria imposible.
- **`comparar.ts`, rehecho:** compara lo aplanado. El dibujo entero y cada entidad sola por su handle, en el espacio modelo y en cada bloque (tipo, capa, hijos, orden y lo que dibuja), con las capas, `$INSUNITS` y la base de cada bloque. `excluir` quita de los dos lados las diferencias conocidas, cada una con su motivo. Un bloque sin ningún handle en común, con los mismos tipos en el mismo orden, se empareja por posición y se dice en `regenerados`.

### 10.2 Criterios

| Criterio | Resultado |
|---|---|
| 1. AC1015 frente al DXF de AutoCAD | **Pasa:** 163 entidades en el espacio modelo y 27 bloques, como en el DXF; 334 entidades emparejadas por handle, cada una dibuja lo mismo; el dibujo entero igual (205 segmentos, 1 558 cuerdas, 432 puntos y 49 textos), con las mismas no leídas (`MESH`, `HATCH`, `MULTILEADER`, `ACAD_TABLE`…). Error máximo 2,3e-12 en coordenadas de hasta ~1 850 (el redondeo del DXF). Fuera, sólo el `LEADER` 512 (DW2-4). |
| 2. Entre versiones | **Pasa con las diferencias explicadas:** de las 351 entidades del 2000, las 318 que también están en el R14 son idénticas código a código, bit a bit. Las otras 33 son de cuatro bloques anónimos (`*D4`, `*D5`, `*D8` y `*U25`) que AutoCAD regenera con handles nuevos al guardar en R14 (DW2-5). |
| 4. Robustez | **Pasa:** a lo de DW1 se añade una tanda de 2 000 ficheros por versión con 1 a 4 bytes cambiados (`validacion/dwg/danados.ts`, `out_danados.txt`): en todos, o lo dice (`ErrorDxf` o un objeto en `fallos`) o sale el mismo dibujo; ninguna otra excepción. La prueba de vitest tiene la tanda de 300. |
| 3 | **En DW3:** el DWG del cliente (`ejemplos/Proyectos/modelo.dwg`, fuera de git) es de 2018 (AC1032). |

Tiempo, como información: la muestra de 1,3 MB, ~17 ms en Bun.

### 10.3 Hallazgos

- **DW2-1 (fallo del lector de DXF, de V2c-4): el código 3 de un `MTEXT` se recortaba.** Es el texto en trozos de 250 caracteres, que empiezan y acaban en espacio, así que un `MTEXT` largo de una plantilla DXF perdía los espacios de los cortes («bla bla» → «blabla»). Ahora no se recorta; prueba nueva en `dxf.test.ts`. La vivienda sigue igual frente a ezdxf (no tiene `MTEXT` tan largos).
- **DW2-2: los bloques anónimos se llaman por su posición en la tabla de bloques.** En la tabla, un anónimo sólo guarda «*D», «*U», «*T»… y un espacio papel, «*Paper_Space». AutoCAD les añade al escribir el DXF su posición en `BLOCK_CONTROL`, contando las entradas vacías. Casi siempre coincide con el nombre de su `BLOCK`, pero no en el anónimo de un bloque dinámico: su `BLOCK` se llama como el bloque dinámico («my-dynamic-block») y el DXF lo llama `*U17`. ACadSharp toma el del `BLOCK`, así que aquí no sirve de oráculo.
- **DW2-3: en R14, `LWPOLYLINE` y `HATCH` son clases** (551 y 552 en la muestra), no los tipos fijos 77 y 78 de 2000. Se leen igual, por el nombre de la clase (también «LWPLINE», como en ACadSharp).
- **DW2-4 (diferencia conocida): el gancho de un `LEADER` no está en el DWG.** El DWG guarda los vértices hasta el final del gancho; AutoCAD, al escribir el DXF, añade el principio del gancho, a `DIMASZ` × `DIMSCALE` del final (2,5 con ISO-25). Para rehacerlo habría que leer los estilos de cota, sus sobrescrituras en los datos extendidos y la regla de AutoCAD para el gancho. Es un vértice de una directriz de anotación, no geometría de la estructura: se deja así, la prueba lo excluye con su motivo y la plantilla dibuja la directriz sin ese quiebro.
- **DW2-5: AutoCAD regenera algunos bloques anónimos al guardar, con handles nuevos.** Al escribir el DXF, el de la tabla (`*U25`, el mismo contenido); al guardar en R14, además, los de tres cotas, con diferencias en la última cifra y la fracción apilada escrita como «1#4». El comparador los empareja por posición y los dice.

### 10.4 Lo siguiente

DW3: 2004 y posteriores (AC1018, AC1024, AC1027, AC1032). Hay que añadir el mapa de páginas con su cabecera cifrada, la descompresión LZ77, el flujo de cadenas aparte (desde 2007) y los colores CMC y ENC de 2004. Con eso se puede hacer el criterio 3 con el DWG del cliente.

## 11. DW3 hecho (2026-11-05)

2004, 2010, 2013 y 2018 (AC1018, AC1024, AC1027 y AC1032), con todo lo de DW2. Pasan los criterios 1 y 2 en las cuatro, el 3 con el DWG del cliente y el 4.

### 11.1 Qué hay

- **`src/dwg/secciones2004.ts`:** la cabecera del fichero (los 0x6C bytes en 0x80, descifrados con la secuencia de `rand()` y comprobados con su CRC32), el mapa de páginas, el mapa de secciones y cada sección como la concatenación de sus páginas, descomprimidas con el LZ77 de 2004 (`lz77`). Comprueba todo lo que el fichero trae para comprobarse: la suma de las dos páginas del sistema, y la de los datos y la de la cabecera de cada página de datos. ACadSharp no comprueba nada de esto. Un DWG con contraseña (sección cifrada) se rechaza con un mensaje.
- **`bits.ts`:** `TU` (texto en UTF-16, desde 2007) y `flujoCadenas` (el flujo de cadenas aparte, con su bandera y su tamaño detrás).
- **`cabecera.ts`:** `Flujos.tv()` lee cada texto de donde toca (TV en la página de códigos hasta 2007, TU en las cadenas desde entonces), y el CMC de 2004 (índice, RGB y los nombres de color y libro).
- **`objetos.ts`:** los objetos de 2010+ (el MC con el tamaño de los handles, el tipo en BB + RC o RS, las cadenas delante de los handles), el ENC de 2004 (color de libro con su handle, RGB, transparencia), las listas de objetos propios de los bloques, y las clases de 2004 y de 2007+ (con el RL extra de 2010 y 2013 con mantenimiento > 3, y de 2018).
- **`entidades.ts`:** las listas propias de polilíneas e inserciones; el atributo de varias líneas de 2018 se lee hasta su texto principal (DW3-6).
- **`lector.ts`:** las secciones de 2000 o de 2004+ según la versión. Los objetos se buscan en AcDb:AcDbObjects y, desde 2004, cada lista va en el orden de su propietario (el bloque, la polilínea o la inserción; el espacio modelo, el de `*Model_Space`).
- **`comparar.ts`:** `huerfanos`, los anónimos del DWG que nada usa (DW3-8).
- **`validacion/dwg/vivienda.ts`** (criterio 3, con los ficheros del cliente fuera de git; `out_vivienda.txt`) y `danados.ts` con 2004 y 2018.
- **La 2007 (AC1021)** sigue diciendo «Todavía no se leen los DWG 2007: guárdalo como DWG 2010 o 2018, o como DXF» (DW5).

### 11.2 Criterios

| Criterio | Resultado |
|---|---|
| 1. Frente al DXF de AutoCAD | **Pasa en las cuatro:** 163 entidades en el espacio modelo y 27 bloques, como en el DXF; el dibujo entero igual; cada entidad por su handle dibuja lo mismo (334, y 333 en 2013 y 2018), a 2,3e-12. Fuera, el gancho del `LEADER` (DW2-4) y, en 2013 y 2018, la `SPLINE` por ajuste (DW3-5). Ningún objeto sin leer. |
| 2. Entre versiones | **Pasa con lo explicado:** frente al DWG 2000, la geometría de lo que está en los dos es la misma bit a bit (sin textos ni nombres, que AutoCAD cambia al guardar en otra versión: DW3-9). Lo que falta, en los anónimos regenerados. |
| 3. Un proyecto real | **Pasa:** el DWG 2018 de la vivienda de Alhaurín frente al DXF que exportó el cliente. 1 665 entidades en el espacio modelo, 1 845 emparejadas por handle, error máximo 1,1e-14; el dibujo entero igual (2 238 segmentos, 13 211 cuerdas, 4 145 puntos, 50 textos). Sobra un anónimo huérfano, `*D18` (DW3-8). Se lee en 16 ms. |
| 4. Robustez | **Pasa:** 2 000 ficheros dañados por versión en 2004 y 2018 (`out_danados.txt`): casi todos dan un `ErrorDxf` del fichero entero (cada página comprimida lleva sus sumas; una página dañada invalida su sección, no un objeto), y los demás salen con el mismo dibujo. Nunca un dibujo distinto sin aviso ni otra excepción. En vitest, una tanda de 150 en 2018. |

Tiempo, como información: las muestras de 1,1 MB, en 11–24 ms; la vivienda, 16 ms.

### 11.3 Hallazgos

- **DW3-1: la cabecera de una página de datos lleva la posición en 8 bytes (0x10–0x17), la suma de la cabecera en 0x18 y la de los datos en 0x1C.** ACadSharp lee estos campos un RL antes, pero no los usa. La suma de los datos es la de los bytes comprimidos con semilla 0; la de la cabecera, la de sus 32 bytes con su campo a 0 y con la de los datos como semilla. La de las páginas del sistema, la de sus datos con la de su cabecera (con su campo a 0) como semilla. Las tres se comprobaron en las cuatro muestras.
- **DW3-2: cada página se descomprime a su tamaño máximo (0x7400),** con relleno detrás de lo que es de la sección. Con un tope del tamaño de la sección, el LZ77 se pasaba (ACadSharp escribe en un stream que crece y no lo nota).
- **DW3-3: un color de libro (ENC con 0x4000) no lleva RGB, sólo su handle.** Con el RGB, un `CIRCLE` de la muestra de 2004 se leía más allá de su final. Esta vez ACadSharp acertaba y el recuerdo de la especificación no.
- **DW3-4 (fallo del dibujo de V2c-4): el salto de línea de un `MTEXT` en notación `^`.** El DXF y el DWG hasta 2000 lo escriben «^J»; el DWG desde 2004, como carácter. `textoMtext` (como `plain_mtext` de ezdxf) descodifica ahora `^` seguido de `@`…`_` como un carácter de control, salvo dentro de una fracción apilada. Antes, un texto de varias líneas de un DXF salía con «^J» en la plantilla.
- **DW3-5 (diferencia conocida): desde 2013, una `SPLINE` hecha por ajuste sólo guarda su ajuste** (los puntos y las tangentes de los extremos; comprobado al bit con lo que mide el objeto). Los puntos de control que trae el DXF los calcula AutoCAD al exportar, con su método. Se dibuja como `aplanar.ts` dibuja hoy una spline sin puntos de control: tramos rectos entre los puntos de ajuste, con sus extremos para enganchar. Rehacer los puntos de control de AutoCAD necesitaría su algoritmo de interpolación (las tangentes interiores y su parametrización); está en lo que queda (§11.4).
- **DW3-6: un atributo de varias líneas (2018)** lleva su texto en un `MTEXT` incrustado y el principal, vacío; el DXF igual. Ni el DWG ni el DXF lo dibujan; en 2000 es un atributo de una línea.
- **DW3-7 (fallo del lector de DXF de V2c-4): lo que va detrás de «101 Embedded Object»** (desde 2018, en `MTEXT` y atributos de varias líneas) es una copia con otro significado de los códigos: allí el 11 es la inserción. El lector de DXF lo tomaba como la dirección del texto y lo giraba (0,03–0,08 rad en la muestra). Ahora se ignora. La vivienda sigue igual frente a ezdxf.
- **DW3-8: AutoCAD no escribe en el DXF los anónimos que nada usa** (en la vivienda, el `*D18`, una cota borrada). El DWG los guarda; no se dibujan y el comparador los dice aparte.
- **DW3-9: al guardar en otra versión, AutoCAD cambia textos y nombres** (la capa «0 @ 1» de 2000 es «0» desde 2010; los saltos de línea de `MTEXT`, `\P` o un carácter; el formato de la fracción de una cota; el nombre del anónimo del bloque dinámico desde 2010), pero no la geometría.

### 11.4 Lo que queda

- **DW4:** el DWG en la app (los selectores, el texto de DW-e y la lectura en el worker) y los criterios 5 y 6 en Chrome. `NavPlantillas.tsx` lo estaba tocando otra sesión: hay que mirarlo antes.
- **DW5:** la 2007 (AC1021), con su Reed-Solomon y su LZ77.
- **Para el usuario:** si se rehacen los puntos de control de las splines por ajuste (DW3-5) y el gancho de los `LEADER` (DW2-4). Los dos son raros en planos de estructura.
