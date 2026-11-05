# DW: la plantilla desde un DWG (plan)

> **Fecha:** 2026-11-05. **Estado:** DW-a, DW-b y DW-c decididas por el usuario el 2026-11-05 (§6); DW-d y DW-e, propuestas.
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
