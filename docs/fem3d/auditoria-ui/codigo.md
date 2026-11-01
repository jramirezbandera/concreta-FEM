# Auditoría de UX y accesibilidad por lectura de código: Concreta FEM 3D (app/)

Fecha: 2026-11-01. Revisado leyendo `app/src/` y los textos que llegan a pantalla desde `src/editor/`,
`src/agente/`, `src/compilador/` y `src/visor/`. No se ha abierto el navegador. Los hallazgos marcados
como «por confirmar» dependen de cómo se comporte en ejecución.

Rutas relativas a `D:\PROGRAMACION\Concreta FEM\`.

**Resumen:** 40 hallazgos. Ninguno es alto (no he encontrado ningún camino que pierda datos guardados
sin poder deshacerlo). Hay 14 medios y 26 bajos.

**Lo que ya está bien, para no volver a revisarlo:**
- todo `localStorage` va con try/catch (`armazon/paneles.ts`, `vistas/estado.ts`, `tema/ThemeProvider.tsx`);
- los botones que sólo llevan icono tienen `aria-label` y `title`;
- Esc en los diálogos se captura en la fase de captura y sólo cierra el de encima (`Dialogos.tsx:30-41`);
- las respuestas de versiones viejas se descartan (`gen`, `ErrorObsoleto`, `usePedido`);
- los atajos globales comprueban `enCampo` y `[role=grid]`.

---

## 1. Fallos de UX en el código

### C-01 · «Recargar lo guardado» puede dejar la app bloqueada en «RESULTADOS DESACTUALIZADOS»
**Severidad:** media (bloquea)
**Dónde:** `app/src/sesion/useProyecto.ts:466-479` (y `:500-510` en la vigilancia)
**Qué pasa:** `recargarDisco` hace `setDesactualizado(true)` y luego, si `o.leer()` devuelve `null`
(el proyecto se borró en otra pestaña, o el fichero desapareció o se renombró en el disco), pone el
error de guardado y sale **sin volver a poner `desactualizado` a false**.
- La píldora se queda en «ABRIENDO · RESULTADOS DESACTUALIZADOS».
- «Recalcular» queda deshabilitado (`App.tsx:369`: `!!ed && proyecto.desactualizado`), y el botón «Calcular» no sale.
- Sólo se sale de ahí editando algo o recargando la página.
- Si `o.leer` lanza (un fallo de IndexedDB), además queda una promesa rechazada sin manejar.

**Propuesta:** en las dos salidas (`!l` y `catch`) volver a `setDesactualizado(false)` y decir qué
pasó con una banda (no sólo con `guardado.error`). Ofrecer «Exportar lo de aquí».
**Estado:** cierto.

### C-02 · Si falla el pedido `compilar`, la app dice a la vez «Compilando…» y «NO SE PUEDE ABRIR», y no da el motivo
**Severidad:** media (engaña)
**Dónde:** `app/src/sesion/useProyecto.ts:230-238`; `app/src/App.tsx:76`; `app/src/espacios/Modelo.tsx:537-539`
**Qué pasa:** con `!k.ok` (un `visor/error-interno` del worker, `worker.ts:51-54`) se llama a
`setErrores` y `setFase("error")`, pero el estado sigue siendo el de «sin compilar», con `compilando: true`.
- La píldora dice «NO SE PUEDE ABRIR».
- El navegador dice «Compilando: los diagnósticos, la malla y el cálculo salen al terminar».
- La insignia de Diagnósticos se queda en «…».
- `proyecto.errores` no se ve en ningún sitio: `PantallaError` sólo sale si no hay estado, y `Modelo.tsx:539` exige `e.compila`.

**Propuesta:** al fallar `compilar`, quitar `compilando` del estado (o guardar un estado «falló»).
Enseñar `errores` en la banda común (C-03).
**Estado:** el camino del código es cierto; que se dispare (una excepción interna al compilar) está por confirmar.

### C-03 · Por qué falló el cálculo sólo se ve en una nota del navegador, y no en Diagnósticos
**Severidad:** media
**Dónde:** `app/src/espacios/Modelo.tsx:539`; `app/src/App.tsx:76`; `app/src/sesion/useProyecto.ts:274-276, 359-361`
**Qué pasa:**
- Cuando `calcular` devuelve `!ok` (un mecanismo, el equilibrio fuera de 1e-9, una memoria que no cabe), los diagnósticos van a `proyecto.errores`.
- La única forma de verlos es un `<p>` en la sección «Proyecto» del Navegador. Con el navegador plegado no se ven.
- La píldora «EL CÁLCULO FALLÓ» no lleva `title`.
- La pestaña Diagnósticos lista `estado.diagnosticos` y no los incluye, así que tampoco sus ids clicables: el pilar o el nudo del mecanismo no se puede elegir con un clic.

**Propuesta:** una banda `role="alert"` bajo la barra (como «No se guardó») con los mensajes y los ids
clicables. Meter estos errores en la lista de Diagnósticos.
**Estado:** cierto.

### C-04 · La pantalla de error culpa al fichero de cualquier fallo, también si falla la red o el worker
**Severidad:** media (engaña)
**Dónde:** `app/src/App.tsx:461-476` (texto en `:465`); `app/src/sesion/cliente.ts:24-27`
**Qué pasa:** `PantallaError` dice siempre «El fichero no es un proyecto válido (JSON o esquema).
Corríjalo…». Se ve esa misma pantalla:
- si no se pudo descargar el núcleo («No se pudo descargar el núcleo de cálculo»);
- si el worker falló;
- si el servidor local no responde (`visor/fichero`).

Además, `bytesNucleo` guarda en `wasm` la promesa **rechazada**. Tras un fallo de red, todo proyecto
que se abra después falla igual hasta recargar la página.
**Propuesta:** elegir el texto según el código: `visor/error-interno`, `visor/fichero` y núcleo frente a
esquema. En `bytesNucleo`, `wasm = null` si falla. Poner un botón «Volver a Mis proyectos».
**Estado:** cierto.

### C-05 · En el navegador, la cabecera dice «Guardando…» cuando no se está guardando
**Severidad:** media (engaña)
**Dónde:** `app/src/App.tsx:321-331`; `app/src/sesion/useProyecto.ts:530-534`
**Qué pasa:** en modo `auto` el texto es `ed.sinGuardar ? "Guardando…" : "Guardado"`.
- Con un error de guardado, el autoguardado se para (`guardado.tipo === "error"`) hasta el siguiente cambio, pero la cabecera sigue con «Guardando…» indefinidamente.
- Con un conflicto pasa lo mismo.
- La banda roja dice «No se guardó», y las dos cosas se contradicen.

**Propuesta:** tres estados: «Sin guardar · error» y «Conflicto», con el color de la banda, y
«Guardando…» sólo mientras `guardado.tipo === "guardando"` (o durante la pausa).
**Estado:** cierto.

### C-06 · Revisión da, en un proyecto del navegador, unas instrucciones de firma que no pueden funcionar
**Severidad:** media (engaña)
**Dónde:** `app/src/pantallas/Revision.tsx:105, 109, 199-203`; `app/src/sesion/almacen.ts:335-338`; `app/src/sesion/useProyecto.ts:303-308`
**Qué pasa:** el origen del navegador es `tipo: "origen"`, con fichero `proyecto.json`, así que el panel:
- dice «El visor vuelve a leer las firmas cuando cambian»;
- propone `bun run fem firmar proyecto.json --por "Nombre"`.

Pero ese fichero no existe en el disco, y `origenNavegador.leer()` devuelve `null` para todo lo que no
sea `proyecto.json`. Ninguna firma se verá nunca: siempre «SIN FIRMAR». Es el flujo por defecto en la web (AL-a).
**Propuesta:** con `origen.navegador`, decir que la firma se hace sobre el `proyecto.json` exportado,
con la carpeta abierta, y ofrecer «Exportar» al lado. No prometer que se relee.
**Estado:** cierto.

### C-07 · «Sobrescribir el del disco» pisa los cambios de fuera de un clic y sin decir qué se pierde
**Severidad:** media
**Dónde:** `app/src/App.tsx:387-398`; `app/src/sesion/origen.ts:130-153`
**Qué pasa:** en un conflicto, «Recargar del disco» avisa: «(se pierden los cambios de aquí)».
- «Sobrescribir el del disco» no avisa de nada, aunque destruye lo que cambió el agente o el ingeniero.
- En una carpeta no queda copia.
- En el navegador sólo queda una versión si la última tiene más de `VERSIONES.cadaMs`.
- No hay confirmación.

**Propuesta:** etiqueta simétrica: «Sobrescribir (se pierden los cambios del disco)». Una
confirmación en la propia banda, como en Inicio. Antes de pisar en una carpeta, dejar
`proyecto.json.bak` o versionar siempre.
**Estado:** cierto.

### C-08 · Borrar con dependencias: el modo por defecto es «Borrarlos también» y el foco está en «Borrar»
**Severidad:** media
**Dónde:** `app/src/editor/Dialogos.tsx:70, 99, 121-127`
**Qué pasa:** al borrar algo que otros usan (una planta desde `GestorPlantas.tsx:139`, una sección o un
material), el diálogo arranca en cascada (`useState("borrar")`) con `autoFocus` en el botón primario.
Un Intro reflejo borra la planta con todas sus vigas, losas y cargas. Se deshace con Ctrl+Z, pero:
- en el navegador ya se ha autoguardado;
- el botón destructivo tiene el estilo primario (`btn-p`), no el de peligro (ver C-35).

**Propuesta:** por defecto, «Pasarlos a otro» si hay candidatos. Foco en «Cancelar». Botón «Borrar N
objetos» con color de peligro y el número total en el propio botón.
**Estado:** cierto.

### C-09 · Los gestores tiran sin avisar lo que se ha escrito en la ficha
**Severidad:** media (pierde lo escrito)
**Dónde:** `app/src/editor/Gestores.tsx:225-230, 331-334, 807-810` (`ir`); `app/src/editor/Dialogos.tsx:30-43` (Esc y clic en el fondo)
**Qué pasa:** en Secciones y Materiales, con campos cambiados (`cambiada`/`cambiado` ya se calculan), lo
escrito se pierde sin aviso si:
- se hace clic en otro elemento de la lista;
- se pulsa «Nueva»;
- se pulsa Esc, incluso con el foco en un campo, donde en el resto de la app Esc sólo deshace ese campo;
- se hace clic fuera del diálogo.

**Propuesta:** si `cambiada`, pedir confirmación en línea («Hay cambios sin aplicar: Aplicar ·
Descartar»). Esc en un campo con cambios deshace el campo, como en el inspector. El clic en el fondo
no cierra un gestor.
**Estado:** cierto.

### C-10 · Lo elegido en Resultados y en Cargas se pierde al cambiar de modo o de espacio; «Recalcular» manda un momento a Modelo
**Severidad:** media
**Dónde:**
- `app/src/pantallas/Losas.tsx:101-106` y `app/src/pantallas/Armado.tsx:485-490` (estado local);
- `app/src/espacios/Modelo.tsx:88` (`caso` activo);
- `app/src/App.tsx:117, 432` (`key={espacioValido}`);
- `app/src/sesion/useProyecto.ts:226`.

**Qué pasa:**
- **Resultados:** la combinación, la magnitud, la escala manual, los filtros y la armadura son `useState` de cada modo. Pasar de Losas a Pilares y volver lo deja todo por defecto (uz, «Por defecto»).
- **Cargas:** el caso activo se pierde al ir a Modelo y volver.
- **«Recalcular» desde Resultados:** `cargar` fija primero el estado sin compilar (`calculado: false`). `espacioValido` pasa a «modelo», `EspacioModelo` se monta y, al acabar, se vuelve a Resultados con todo reiniciado.
- **Al recargar:** tampoco se recuerda el espacio, porque la URL sólo lleva `?local=`.

**Propuesta:**
- subir esas elecciones al contexto o a `ContextoVistas`, por proyecto y con `localStorage` protegido;
- durante un recálculo, conservar el espacio (enseñar el aviso en lugar de cambiar de espacio);
- escribir `espacio` y `modo` en la URL.

**Estado:** cierto (el salto de espacio, por lectura de código: falta verlo en el navegador).

### C-11 · Acciones de Inicio sin manejar errores: no pasa nada y no se dice por qué
**Severidad:** baja
**Dónde:** `app/src/Inicio.tsx:112-115` (exportar), `:196-200` (borrar), `:222` (duplicar), `:242` (abrir un ejemplo); `app/src/pantallas/Revision.tsx:122-125` (copiar la orden)
**Qué pasa:** son promesas sin `catch`. Si IndexedDB falla, si el trozo del ejemplo no está en la
caché sin conexión o si el portapapeles se niega, el botón no hace nada visible:
- «Borrar» deja la fila en confirmación;
- «Copiada» no sale nunca.

**Propuesta:** `.catch((e) => setError(...))` en todas. En Revisión, el mismo mensaje que `copiarTabla` (`Hoja.tsx:607-610`).
**Estado:** cierto.

### C-12 · Abrir un proyecto del navegador o vigilar el fichero sin `catch`: un clic que no hace nada
**Severidad:** baja
**Dónde:** `app/src/sesion/useProyecto.ts:312-325` (`abrirOrigen`), `:488-518` (`mirar`, sólo `try/finally`); `app/src/pantallas/Losas.tsx:124-128`; `app/src/pantallas/Armado.tsx:515-521`; `app/src/vistas/Zona.tsx:662-674`
**Qué pasa:**
- **`abrirOrigen`:** si `o.leer` lanza (`origenNavegador` → `tx` de IndexedDB), la IIFE rechaza sin manejar y la fase sigue en «vacio». Un clic en «Mis proyectos» no hace nada.
- **`mirar`:** puede rechazar cada segundo.
- **Clics de valor y de elegir:** hacen `await cliente.pedir()` sin `try`. Con el cliente cerrado por una edición llega `ErrorObsoleto` sin manejar (es ruido en la consola).

**Propuesta:** `try/catch` con un mensaje en `abrirOrigen` y `mirar` (este último, con un aviso tras
varios fallos seguidos), e ignorar `ErrorObsoleto` en los clics.
**Estado:** cierto (el disparo es raro).

### C-13 · Doble envío: «Crear» y «Guardar en mis proyectos» pueden crear proyectos duplicados
**Severidad:** baja
**Dónde:** `app/src/Inicio.tsx:82-95, 153-165`; `app/src/sesion/useProyecto.ts:562-585`; `app/src/App.tsx:172, 333`
**Qué pasa:** ni el formulario de «Proyecto nuevo» ni `alNavegador` se protegen mientras esperan a `crear()`.
- Un doble clic, o dos Ctrl+S antes de que `setFuente` llegue a `fuenteRef`, crea dos entradas en IndexedDB.
- Una de ellas queda huérfana en «Mis proyectos».

**Propuesta:** una marca `creando` (en una ref) que deshabilite el botón e ignore el segundo envío.
**Estado:** cierto.

### C-14 · Los diagnósticos `info` se pintan como «AVISO» y cuentan como avisos
**Severidad:** baja
**Dónde:** `app/src/componentes/comunes.tsx:145-147`; `app/src/espacios/Modelo.tsx:440-441, 447`; `src/visor/sesion.ts:264-265`
**Qué pasa:**
- `ListaDiagnosticos` sólo distingue error y lo demás: `apoyo/a-viga` y `apoyo/en-pilar` (`src/compilador/losas.ts:1369-1375`, `info`) salen con la píldora amarilla «AVISO».
- La insignia de Diagnósticos y el selector de plantas los suman a los avisos.

**Propuesta:** una tercera píldora «INFO» neutra, fuera del recuento de avisos.
**Estado:** cierto.

---

## 2. Accesibilidad

### C-15 · Los diálogos no llevan el foco dentro, no lo atrapan y no lo devuelven
**Severidad:** media
**Dónde:** `app/src/editor/Dialogos.tsx:26-56`; `app/src/armazon/Paleta.tsx:31, 49-53`
**Qué pasa:** `Dialogo` pone `role="dialog"` y `aria-modal`, pero:
- **Foco inicial:** no lo mueve dentro. Copiar, Ábacos, Vigas de borde, Versiones y los gestores de secciones y materiales no tienen `autoFocus`, así que el foco se queda en el botón de la barra, detrás del fondo.
- **Tab:** sale del diálogo a la página.
- **Al cerrar:** el foco no vuelve a quien lo abrió. La Paleta también lo pierde.

**Propuesta:** en `Dialogo`, guardar `document.activeElement` al montar y devolverle el foco al
desmontar; enfocar el primer control (o el cuerpo, con `tabIndex=-1`); atrapar Tab y Mayús+Tab.
Usar `aria-labelledby` con el `h2`.
**Estado:** cierto.

### C-16 · La ayuda «?» sólo sale al pasar el ratón: con el teclado, con un lector o en pantalla táctil no se ve
**Severidad:** media
**Dónde:** `app/src/componentes/Ayuda.tsx:53-65`
**Qué pasa:** el «?» es un `<i aria-hidden>` con `onMouseEnter` y `onMouseLeave`: sin foco, sin clic y
sin `aria-describedby`. Las ayudas del inspector y de los gestores son la única explicación de muchos
campos (multiplicadores, casetón, ψ…). El comentario de la cabecera y CLAUDE.md hablan de un
interruptor «Ayudas» que ya no está en el código.
**Propuesta:** un `<button>` con `aria-describedby` hacia el globo, que se abra con foco o clic y se
cierre con Esc. O bien el texto de ayuda como `aria-description` del campo.
**Estado:** cierto.

### C-17 · La hoja (`role="grid"`) no anuncia la celda activa
**Severidad:** baja
**Dónde:** `app/src/editor/Hoja.tsx:691` y `:209-224`
**Qué pasa:** el foco está en el contenedor y las celdas son `<td>` sin `role="gridcell"`, sin
`aria-selected` y sin `aria-activedescendant`. Al moverse con las flechas un lector no dice nada. La
ayuda de la columna, en la barra de estado (`role="status"`), sí se anuncia.
**Propuesta:** `id` por celda y `aria-activedescendant` en el contenedor, `aria-selected` en la activa.
**Estado:** cierto.

### C-18 · Roles ARIA sin el teclado que prometen (pestañas y radios)
**Severidad:** baja
**Dónde:**
- `role="tablist"`/`tab`: `app/src/editor/Hoja.tsx:648-653`, `app/src/armazon/Disposicion.tsx:274-291`, `app/src/editor/GestorPlantas.tsx:175-183`;
- `role="radio"`: `app/src/editor/Gestores.tsx:349-357, 851-857`, `app/src/editor/GestorPlantas.tsx:269-271`.

**Qué pasa:** ni las flechas ni el tabindex itinerante funcionan: cada opción es un paso de Tab, y las
pestañas no tienen `aria-controls` ni un `tabpanel` asociado. El selector de punto fijo
(`app/src/dibujo/Plantilla.tsx:902-915`) sí lo hace bien.
**Propuesta:** reutilizar el patrón del punto fijo en un componente común `GrupoRadio` / `Pestanas`.
**Estado:** cierto.

### C-19 · Filas de tabla y diagramas que sólo responden al ratón
**Severidad:** baja
**Dónde:** `app/src/pantallas/Pilares.tsx:211`; `app/src/pantallas/Reacciones.tsx:150`; `app/src/pantallas/Armado.tsx:594, 641-645`; `app/src/pantallas/Vigas.tsx:481` y el `svg` de `:177-178`
**Qué pasa:** `<tr className="clic" onClick>` sin `tabIndex`, sin rol y sin tecla. Con el teclado no se
puede elegir un pilar del cuadro, una franja o una zona de refuerzo (encuadrarla).
**Propuesta:** un botón en la primera celda (o `tabIndex=0` con Intro/Espacio y `aria-selected`).
**Estado:** cierto.

### C-20 · El asa del panel inferior no se mueve con el teclado
**Severidad:** baja
**Dónde:** `app/src/armazon/Disposicion.tsx:258-272`
**Qué pasa:** `role="separator"` sin `tabIndex`, sin `aria-valuenow`/`min`/`max` y sin flechas.
**Propuesta:** `tabIndex=0`, ↑/↓ de 20 px y los `aria-value*`.
**Estado:** cierto.

### C-21 · Elegir fichero sin teclado o sin foco visible
**Severidad:** baja
**Dónde:** `app/src/plantilla/NavPlantillas.tsx:137-140`; `app/src/Inicio.tsx:147-150`
**Qué pasa:**
- **«Elegir…» de una plantilla DXF:** es un `<label>` con un `<input type="file" hidden>`, que sale del orden de Tab, así que con el teclado no se puede volver a elegir el plano.
- **Inicio:** el `input` es `sr-only` dentro de un `label.btn`. Recibe el foco, pero el anillo de `.btn:focus-visible` no se pinta porque el que tiene el foco es el input.

**Propuesta:** un `<button>` que llame a `input.click()` (como «Plantilla DXF» de la barra,
`Modelo.tsx:355`), o `.btn:focus-within`.
**Estado:** cierto.

### C-22 · El color como única señal
**Severidad:** baja
**Dónde:** `app/src/componentes/comunes.tsx:192-193` (equilibrio > 1e-9); `app/src/pantallas/Pilares.tsx:115` (ν > 0,65); `app/src/armazon/Disposicion.tsx:127` (`<i aria-label>` sin rol)
**Qué pasa:**
- El equilibrio que no cuadra y el axil reducido por encima del aviso sólo se marcan con el color de la celda.
- En la planta, el punto de errores y avisos es un `<i>` con `aria-label`, que los lectores suelen ignorar.

**Propuesta:** un símbolo o un texto («!», «> 0,65») junto al color, y `role="img"` en el indicador.
**Estado:** cierto.

### C-23 · Las dos opciones de «Copiar a otras plantas» no forman un grupo de radios
**Severidad:** baja
**Dónde:** `app/src/editor/Dialogos.tsx:189, 195`
**Qué pasa:** los dos `type="radio"` no tienen `name`. Son dos paradas de Tab sueltas, las flechas no
pasan de una a otra y no se anuncian como grupo.
**Propuesta:** `name="copiar-que"`, como el `name="modo"` de DialogoBorrar.
**Estado:** cierto.

---

## 3. Textos

### C-24 · Software comercial nombrado en textos que se ven (prohibido por el proyecto)
**Severidad:** media (incumple una regla explícita)
**Dónde:**
- `app/src/Inicio.tsx:26`: ejemplo «Pórtico de acero de 7 plantas (SAP2000 1-022, A2)», en la pantalla de inicio;
- `app/src/editor/Gestores.tsx:398`: «…con las áreas de cortante de CSI.» (el fabricante de SAP2000 y ETABS), que se ve en el gestor de secciones;
- `src/compilador/compilar.ts:468`: «…en ETABS 15, E6-3…», en el aviso del dintel en un diafragma, que sale en Diagnósticos.

**Qué pasa:** la regla del proyecto (memoria «Sin software comercial en la app») lo prohíbe en los
textos de la app.
**Propuesta:**
- «Pórtico de acero de 7 plantas (caso de validación 1-022)»;
- «…con las áreas de cortante de la sección (Timoshenko)»;
- «…(un 7 % con dinteles de 1,5 m y un 35 % con los de 6 m en los modelos de contraste)».

Añadir una prueba que busque esos nombres en los literales que llegan a pantalla.
**Estado:** cierto.

### C-25 · Códigos internos de la investigación en mensajes, ayudas e hipótesis
**Severidad:** media
**Dónde (ejemplos):**
- **`title` de la barra:** `app/src/espacios/Modelo.tsx:326` «(GE2)», `:351` «(GE3)», `:352-353` «(GE)».
- **Inspector y gestores:** `app/src/editor/FichaForjado.tsx:106-107` «(CY3)», «(RV-a)»; `app/src/editor/Gestores.tsx:573` «(D4)».
- **Resultados:** `app/src/pantallas/Losas.tsx:192` «SPR (E5)… (H43)» y `:217` «(E5-7)»; `app/src/pantallas/Desplomes.tsx:138, 200` «(A3)»; `app/src/pantallas/Vigas.tsx:369, 453` «(C1-d)».
- **Revisión:** `app/src/pantallas/Revision.tsx:172` «(A3)… En el edificio objetivo…».
- **Inicio:** `app/src/Inicio.tsx:27-28` «(A2)», «Edificio objetivo».
- **Ayudas de tabla:** `src/editor/tablas.ts:187` «(C1-d)», `:416` «C1-c».
- **Diagnósticos:** `src/compilador/validar.ts:279, 283, 287, 342, 1092`; `src/compilador/losas.ts:419, 441, 960-970`.
- **Hipótesis del compilador** (Modelo › Propiedades): `src/compilador/compilar.ts:487-644` («fase LV, CY-g», «H52, C2-a, G-4», «AU-4», «fase TB»…).

**Qué pasa:** para el ingeniero son ruido: no puede buscar «C4-i» en ningún sitio que tenga a mano.
**Propuesta:** quitar los paréntesis de código de los literales que llegan a pantalla (dejarlos en los
comentarios) o cambiarlos por la referencia que el usuario sí tiene (artículo del CE o del CTE). En las
hipótesis, decir la regla en palabras.
**Estado:** cierto.

### C-26 · Jerga de desarrollo en la barra de estado, las píldoras y las notas
**Severidad:** baja
**Dónde:**
- **Píldora y pie:** `app/src/App.tsx:75-81` («CALCULADO · 3fa9c2d1», la huella), `:289-290` («resultados de .fem/… (CLI)», «.fem no se usó»), `:369` («sin usar los resultados de .fem/»), `:446-451` («sha256 de resultados.bin», «núcleo WASM»).
- **Diálogos y vistas:** `app/src/editor/Dialogos.tsx:268, 282, 363, 447` y `app/src/vistas/Zona.tsx:499` («Cambia la huella»); `app/src/editor/Gestores.tsx:398` («compilarSeccion», un nombre de función).
- **Modelo:** `app/src/espacios/Modelo.tsx:450` («Los de `fem validar` y `fem calcular`»), `:528` (la huella como valor de la sección), `:773` («de `fem resumen`»).

**Qué pasa:** la huella y el sha256 tienen sentido en Revisión, para la trazabilidad. En el resto
enturbian lo que importa: si los resultados son de esta versión.
**Propuesta:**
- píldora «CALCULADO», con la huella en el `title`;
- «hay que volver a calcular» en lugar de «cambia la huella»;
- el sha256 y el núcleo, sólo en Revisión › Identidad.

**Estado:** cierto.

### C-27 · «El fichero cambió» cuando lo que cambió es una edición en la app o un «Recalcular»
**Severidad:** baja (confunde)
**Dónde:** el mismo bloque `aviso` copiado en 15 sitios:
- `app/src/pantallas/Losas.tsx:46, 54`
- `app/src/pantallas/Pilares.tsx:47, 71`
- `app/src/pantallas/Vigas.tsx:51, 76`
- `app/src/pantallas/Armado.tsx:86, 95, 576`
- `app/src/pantallas/Reacciones.tsx:63, 96`
- `app/src/pantallas/Desplomes.tsx:117`
- `app/src/pantallas/Revision.tsx:162`
- `app/src/vistas/Zona.tsx:698, 702`

Sólo `app/src/espacios/Modelo.tsx:635` distingue «Compilando la versión editada…».
**Qué pasa:** con `desactualizado` por deshacer (Ctrl+Z en Resultados) o por recalcular, el usuario lee
que «el fichero cambió» sin haber tocado ningún fichero.
**Propuesta:** un único componente `AvisoDesactualizado`, con tres textos: editado, recalculando y
cambiado fuera.
**Estado:** cierto.

### C-28 · Separador decimal mezclado: punto en unos números y coma en otros
**Severidad:** baja
**Dónde:** `app/src/App.tsx:281-290` («compilado en 3.27 s»); `src/compilador/compilar.ts:468` («1.50 m de luz… dinteles de 1,5 m», en la misma frase); `src/compilador/losas.ts:419, 441, 968`; `src/compilador/cargas.ts:887, 911`; `src/compilador/esfuerzosFranjas.ts:697, 705, 863`
**Qué pasa:** el resto de la app usa `fmt` o `coma` (coma decimal), pero estos mensajes salen con `toFixed`.
**Propuesta:** usar `coma()` o `fmt()` también en los diagnósticos y en el pie.
**Estado:** cierto.

### C-29 · Desplegables con los valores internos, sin tildes
**Severidad:** baja
**Dónde:** `src/editor/tablas.ts:143-145` (`fijas` sin `texto`), `:184` «sotano», `:187` «rigido», `:218` «hormigon», `:865` «instantanea»
**Qué pasa:**
- El desplegable del inspector y de la hoja enseña el identificador del JSON. En la misma lista, la opción por defecto sí va con tilde: «(rígido salvo en la más baja)».
- Casetón y bovedilla ya tienen `TEXTO_CASETON` y `TEXTO_BOVEDILLA`.
- La ayuda de `diafragma` también dice «rigido o ninguno».

**Propuesta:** un `texto` con tilde para cada valor de `fijas`, sin cambiar el valor (pegar y escribir en la hoja siguen aceptando las dos formas).
**Estado:** cierto.

### C-30 · Una misma cosa con dos nombres: forjado y losa, caso e hipótesis, planta y nivel
**Severidad:** baja
**Dónde:**
- **Forjado / losa / paño:** la tabla y la herramienta dicen «Forjados» y «Forjado», pero:
  - `app/src/espacios/Modelo.tsx:485` dice «elija las vigas, losas, paños, apoyos o cargas», mientras que `:379` dice «vigas, forjados, apoyos o cargas»;
  - `app/src/editor/Dialogos.tsx:198` dice «losas, paños»;
  - el diálogo «Vigas de borde» rotula el campo «Forjado» (`:416`) y dice «No hay ninguna losa» (`:409`);
  - `app/src/pantallas/Inspector.tsx:18` dice «forjado · losa maciza»;
  - los diagnósticos hablan de «la losa L1» y de «paño».
- **Caso / hipótesis:** `src/editor/tablas.ts:953` («caso: la hipótesis en que va») y `app/src/App.tsx:224` («Nuevo caso… / Hipótesis típicas…»). Además, «Hipótesis del compilador» (`Modelo.tsx:778`) usa la misma palabra para las suposiciones del modelo.
- **Planta / nivel:** `app/src/editor/GestorPlantas.tsx:454` «N niveles».

**Propuesta:**
- «forjado» para todo lo que el usuario dibuja, y «losa maciza», «reticular» o «unidireccional» como tipo;
- «caso de carga» siempre, y «Supuestos del cálculo» para las hipótesis del compilador;
- «plantas».

**Estado:** cierto.

### C-31 · Plurales sin concordancia
**Severidad:** baja
**Dónde:** `app/src/editor/Hoja.tsx:592` («Pegadas 1 filas»); `app/src/editor/Dialogos.tsx:84` («…y 1 objetos que lo usaban»), `:167, 169` («Copiar 1 objetos…», «Creados 1 objetos»)
**Propuesta:** una ayuda `plural(n, "fila", "filas")`, que ya se hace a mano en otros sitios (`Hoja.tsx:591`).
**Estado:** cierto.

### C-32 · Unidades que faltan o que cambian en el mismo formulario
**Severidad:** baja
**Dónde:** `app/src/pantallas/Pilares.tsx:204-205`; `app/src/editor/Gestores.tsx:683-688, 849`
**Qué pasa:**
- **Cuadro de pilares:** las cabeceras «|My|» y «|Mz|» no llevan unidad, mientras que «N kN» sí, y la tabla de tramos de al lado dice «|My| kN·m» (`:252-253`).
- **Gestor de materiales:** E va en MPa en el hormigón y el acero, y en kN/m² en «General», que es un factor 1000 fácil de confundir al cambiar de tipo.
- **Ayuda de «tipo»:** dice «General: E, ν y γ a mano», pero los campos son E, G y γ.

**Propuesta:** «|My| kN·m» y «|Mz| kN·m»; E y G en MPa en los tres tipos (convertir al guardar) o un aviso visible; corregir la ayuda.
**Estado:** cierto.

---

## 4. Coherencia de componentes

### C-33 · Los menús flotantes se cierran de formas distintas
**Severidad:** baja
**Dónde:** `app/src/vistas/Zona.tsx:476-482` (Guardar la vista), `:520-526` (Opciones de la vista 3D); `app/src/dibujo/Enganches.tsx:40-56`
**Qué pasa:** la lista de enganches se cierra con Esc y con un clic fuera. «Vistas guardadas» y
«Opciones de la vista» sólo se cierran con su X o con su botón. Esc fuera de un campo, además, suelta
lo elegido (`App.tsx:195`) y el menú sigue abierto.
**Propuesta:** un componente `Desplegado` común: Esc, clic fuera y foco de vuelta al botón.
**Estado:** cierto.

### C-34 · El botón «Borrar» tiene tres aspectos
**Severidad:** baja
**Dónde:**
- rojo en `app/src/Inicio.tsx:191-203` (estilo en línea);
- primario de acento en `app/src/editor/Dialogos.tsx:99`;
- normal en `app/src/editor/Gestores.tsx:316, 796` y `app/src/editor/GestorPlantas.tsx:139`.

**Propuesta:** una clase `btn-peligro` en el tema y usarla en toda acción destructiva.
**Estado:** cierto.

### C-35 · Campos numéricos repetidos, cada uno con su lectura y su validación
**Severidad:** baja
**Dónde:**
- `leer` en `app/src/editor/Gestores.tsx:72`;
- `numero` en `app/src/editor/Dialogos.tsx:292`;
- `CampoNumero` y `leerNumero` en `app/src/plantilla/NavPlantillas.tsx:232-250`;
- `CeldaMultiplicador` en `app/src/editor/FichaForjado.tsx:150-174`, un `<input>` con clases propias y no `.sel`;
- los del inspector, en `app/src/editor/Formulario.tsx:326-347`.

**Qué pasa:**
- Cada uno decide distinto cuándo escribe (en cada cambio, al salir o con Intro), qué hace Esc y cómo dice el error (texto, `title` o borde).
- En Ábacos y Vigas de borde, un campo vacío vale 0 (`Number("")`) en lugar de «falta».

**Propuesta:** un `CampoNumero` común con la coma decimal, «falta» o «no es un número», la unidad y el
mismo Intro, Esc y salida que el inspector.
**Estado:** cierto.

### C-36 · Intro confirma en unos diálogos y en otros no
**Severidad:** baja
**Dónde:**
- sin Intro: `app/src/editor/Dialogos.tsx:338-352` (Ábacos), `:415-429` (Vigas de borde) y Copiar;
- con Intro: `app/src/editor/Gestores.tsx:338-340`, `app/src/editor/GestorPlantas.tsx:169-171`, `app/src/vistas/Zona.tsx:497` y el formulario de Inicio.

**Propuesta:** envolver el cuerpo de `Dialogo` en un `<form onSubmit>` con la acción primaria.
**Estado:** cierto.

### C-37 · Controles con estilos en línea en lugar de variantes del tema
**Severidad:** baja
**Dónde:**
- `app/src/componentes/comunes.tsx:154` (botón de id de 22 px);
- `app/src/Inicio.tsx:144, 147` (`height: 34`);
- `app/src/plantilla/NavPlantillas.tsx:115-118, 137` (`ib-chip` con `width: auto`, usado como botón de texto);
- `app/src/editor/Hoja.tsx:670-673` (`btn` de 28 px);
- `app/src/App.tsx:373` (color en línea);
- `app/src/espacios/Modelo.tsx:683-684` (fuentes en línea).

**Qué pasa:** de paso, los `input type="file"` se vacían en `Modelo.tsx:358`, pero no en
`Inicio.tsx:149` ni en `NavPlantillas.tsx:139`: volver a elegir el mismo fichero tras un error no hace nada.
**Propuesta:** variantes `btn-sm`, `btn-texto` y `btn-grande` en `index.css`; `x.target.value = ""` en todos los ficheros.
**Estado:** cierto.

---

## 5. Rendimiento percibido

### C-38 · Arrastrar el panel inferior escribe en `localStorage` y vuelve a pintar la app en cada movimiento
**Severidad:** baja
**Dónde:** `app/src/armazon/Disposicion.tsx:267-270`; `app/src/armazon/paneles.ts:52-58`
**Qué pasa:** cada `pointermove` llama a `p.poner({ alto })`, que hace `setMapa` en `App` y un
`localStorage.setItem` síncrono. Cambia el valor de `ContextoPaneles`, y con él se vuelven a pintar
todos los que usan `usePaneles` (el espacio entero).
**Propuesta:** durante el arrastre, cambiar la altura con un estilo o una variable CSS local y guardar
sólo en `pointerup`.
**Estado:** las escrituras, cierto; que se note el coste, por confirmar.

### C-39 · Escribir en una celda puede volver a pintar todas las filas de la hoja
**Severidad:** baja
**Dónde:** `app/src/editor/Hoja.tsx:722-731` (`onCelda` en línea, que depende de `editando`), `:139` y `:731` (`onValor = setEditando`)
**Qué pasa:** `FilaHoja` va con `memo`, pero `onCelda` se rehace con cada tecla (cierra sobre
`editando`, `confirmar` y `mover`), así que la comparación de `memo` falla en todas las filas. Con
cientos de cargas sin el filtro «sólo planta», cada tecla repinta toda la tabla.
**Propuesta:** pasar a las filas callbacks estables (`useRef` con la última versión, o un `dispatch`)
y dejar `editando` sólo en la fila activa.
**Estado:** por confirmar (depende de lo que memorice el React Compiler).

### C-40 · Efectos sin dependencias que vuelven a registrar oyentes globales en cada render
**Severidad:** baja
**Dónde:** `app/src/espacios/Modelo.tsx:264-277` (modo «eligiendo») y `:284-295` (Supr)
**Qué pasa:**
- Cada render de `EspacioModelo` quita y vuelve a poner `keydown` y `pointerdown` en `window`, también mientras se mueve el ratón por la planta si eso provoca renders.
- No hay fuga, pero es trabajo inútil, y el orden de los oyentes de Esc depende del último render.

**Propuesta:** dependencias explícitas y refs para lo que cambia (`enTablas`, `eligiendo`).
**Estado:** cierto.
