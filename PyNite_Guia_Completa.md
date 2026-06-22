# PyNite — Guía completa para entender el módulo y construir un frontend web

> Documento de referencia técnica y "playbook" para un agente de código.
> Basado en el código fuente del repositorio [JWock82/PyNite](https://github.com/JWock82/PyNite) (versión **3.0.0**) y en la [documentación oficial](https://pynite.readthedocs.io/en/latest/index.html).
> Autor de la librería: D. Craig Brinck, PE, SE · Licencia MIT · Python ≥ 3.11.

---

## Índice

1. [Qué es PyNite](#1-qué-es-pynite)
2. [Instalación y dependencias](#2-instalación-y-dependencias)
3. [Conceptos fundamentales](#3-conceptos-fundamentales)
4. [Flujo de trabajo típico](#4-flujo-de-trabajo-típico)
5. [Referencia de la API: `FEModel3D`](#5-referencia-de-la-api-femodel3d)
6. [Tipos de análisis](#6-tipos-de-análisis)
7. [Extracción de resultados](#7-extracción-de-resultados)
8. [Visualización (`Renderer`)](#8-visualización-renderer)
9. [Convenciones y errores comunes (gotchas)](#9-convenciones-y-errores-comunes-gotchas)
10. [Ejemplos completos](#10-ejemplos-completos)
11. [Arquitectura recomendada para el frontend web](#11-arquitectura-recomendada-para-el-frontend-web)
12. [Despliegue con WebAssembly / Pyodide (sin servidor)](#12-despliegue-con-webassembly--pyodide-sin-servidor)
13. [Cómo debe trabajar el agente de código](#13-cómo-debe-trabajar-el-agente-de-código)
14. [Checklist y referencias](#14-checklist-y-referencias)

---

## 1. Qué es PyNite

**PyNite** (paquete PyPI `PyNiteFEA`, importado como `Pynite`) es una librería de **análisis de estructuras por el método de los elementos finitos (FEM) en 3D**, elástica y lineal, escrita en Python puro (apoyada en NumPy/SciPy). Está pensada para análisis estructural de ingeniería civil/edificación: pórticos, vigas, celosías, muros, losas y cimentaciones.

### Capacidades principales

- **Análisis estático 3D** de estructuras elásticas.
- **Análisis P-Δ** (P-Big-Delta y P-little-delta) de pórticos.
- **Análisis modal** (frecuencias naturales y modos de vibración).
- **Análisis pushover no lineal** de pórticos de acero (sólo perfiles de acero, calibrado para secciones en I — en desarrollo).
- **Elementos tipo barra/viga** (members) con liberaciones de extremos (releases) → permite modelar celosías.
- **Elementos tipo muelle** (springs): bidireccionales, sólo-tracción o sólo-compresión.
- **Elementos "tension-only" / "compression-only"** (arriostramientos, contactos).
- **Elementos de placa/lámina**: cuadriláteros (`Quad`, formulación DKMQ) y rectangulares (`Plate`).
- **Mallado automático**: rectángulos, anillos, troncos de cono, cilindros, muros de cortante y losas de cimentación.
- **Cargas** nodales, puntuales y distribuidas en barras, presión en placas, y **peso propio**.
- **Casos de carga** y **combinaciones de carga** con factores.
- **Diagramas** de cortante, momento, axil, torsor y deformada por barra.
- **Renderizado 3D** del modelo y la deformada (PyVista/VTK).
- **Informes PDF** (con `pdfkit` + `Jinja2`).

### Filosofía y limitaciones

- **Precisión por validación**: el desarrollador contrasta resultados contra problemas de libros de texto (Timoshenko, Bedford & Fowler, etc.).
- **Simplicidad** sobre cantidad de funciones.
- **Unidades agnósticas**: PyNite NO gestiona unidades; tú eres responsable de usar unidades consistentes (ver §3).
- El **pushover** sólo soporta secciones de acero en I. Las **losas de cimentación** (`MatFoundation`) están en beta.
- El renderizado VTK antiguo se está retirando en favor de **PyVista**.
- No hay **serialización nativa** del modelo a JSON/archivo (relevante para el frontend; ver §11).

---

## 2. Instalación y dependencias

```bash
# Instalación completa (incluye renderizado PyVista, reporting PDF, etc.)
pip install PyNiteFEA[all]

# Mínima (sólo cálculo, sin render ni informes)
pip install PyNiteFEA
```

### Extras disponibles (definidos en `setup.py`)

| Extra | Incluye | Para qué |
|-------|---------|----------|
| `[all]` | IPython, vtk≥9.3, pyvista[all,trame], trame_jupyter_extension, ipywidgets, pdfkit, Jinja2 | Todo |
| `[vtk]` | IPython, vtk≥9.3 | Render VTK antiguo |
| `[pyvista]` | pyvista[all,trame], trame_jupyter_extension, ipywidgets | Render moderno |
| `[reporting]` | pdfkit, Jinja2 | Informes PDF |
| `[derivations]` | jupyterlab, sympy | Derivaciones simbólicas |

### Dependencias mínimas

`numpy >= 2.4.0`, `scipy`, `PrettyTable`, `matplotlib`.

> ⚠️ Para un **backend web headless** (sin pantalla), el cálculo sólo necesita las dependencias mínimas. PyVista/VTK sólo hacen falta si vas a generar imágenes/escenas 3D en el servidor (ver §11). En servidores Linux sin GPU, el render off-screen requiere además librerías del sistema (p. ej. `libgl1`, `xvfb`).

### Importación básica

```python
from Pynite import FEModel3D          # clase principal del modelo
from Pynite.Rendering import Renderer  # render PyVista (también en Pynite.Visualization)
from Pynite import ShearWall           # utilidad de muro de cortante
```

---

## 3. Conceptos fundamentales

### 3.1. El objeto modelo

Todo gira en torno a una instancia de `FEModel3D`. El modelo es un **contenedor** de diccionarios (clave = nombre del objeto):

| Diccionario | Contiene | Acceso típico |
|-------------|----------|---------------|
| `model.nodes` | nodos (`Node3D`) | `model.nodes['N1']` |
| `model.members` | barras físicas (`PhysMember`) | `model.members['M1']` |
| `model.springs` | muelles | `model.springs['S1']` |
| `model.plates` | placas rectangulares | `model.plates['P1']` |
| `model.quads` | cuadriláteros | `model.quads['Q1']` |
| `model.meshes` | mallas generadas | `model.meshes['MSH1']` |
| `model.materials` | materiales | `model.materials['Steel']` |
| `model.sections` | secciones | `model.sections['W10x33']` |
| `model.load_combos` | combinaciones de carga | `model.load_combos['1.2D+1.0W']` |

> Casi todos los métodos `add_*` devuelven el **nombre** del objeto creado (string). Si pasas `name=None`, PyNite genera un nombre único automáticamente.

### 3.2. Sistema de coordenadas

- **Global**: ejes `X`, `Y`, `Z`. Por convención de PyNite (y del renderer) el eje **`Y` es el vertical** (gravedad en `-Y`).
- **Local de barra**: eje `x` a lo largo del eje de la barra (del nodo `i` al `j`); ejes `y`, `z` transversales. El parámetro `rotation` de `add_member` gira la sección alrededor del eje local x.
- **Notación de direcciones en cargas**:
  - **MAYÚSCULAS** (`FX, FY, FZ, MX, MY, MZ`) → sistema **global**.
  - **minúsculas** (`Fx, Fy, Fz, Mx, My, Mz`) → sistema **local** de la barra.

### 3.3. Grados de libertad (DOF)

Cada nodo tiene **6 GDL**: 3 traslaciones (`DX, DY, DZ`) y 3 rotaciones (`RX, RY, RZ`). Los apoyos restringen estos GDL; las cargas y desplazamientos se aplican sobre ellos.

### 3.4. Unidades

**PyNite NO tiene unidades.** Debes elegir un sistema **consistente** y mantenerlo en TODO el modelo:

| Sistema | Longitud | Fuerza | Módulo E | Densidad ρ |
|---------|----------|--------|----------|------------|
| Imperial (habitual en ejemplos) | in (pulgadas) | kip | ksi (kip/in²) | kci (kip/in³) |
| SI | m | kN | kN/m² | (masa/volumen consistente) |

> Regla de oro: si las longitudes están en metros y las fuerzas en kN, entonces `E` va en kN/m², las inercias en m⁴, las áreas en m², los momentos resultan en kN·m, etc. **El frontend debe fijar y mostrar claramente el sistema de unidades y convertir en un único punto.**

### 3.5. Casos vs. combinaciones de carga

- **Caso de carga** (`case`): etiqueta de un grupo de cargas (`'D'`, `'L'`, `'W'`, `'Case 1'`...). Las cargas se asignan a un caso.
- **Combinación** (`add_load_combo`): suma ponderada de casos, p. ej. `{'D': 1.2, 'W': 1.0}`.
- Si **no defines ninguna combinación**, PyNite crea una por defecto llamada **`'Combo 1'`** que incluye el caso por defecto **`'Case 1'`** con factor 1.0.
- **Todos los resultados se almacenan por combinación** (diccionarios indexados por el nombre de la combinación).

---

## 4. Flujo de trabajo típico

El orden canónico para construir y resolver un modelo:

```python
from Pynite import FEModel3D

# 1) Crear el modelo
model = FEModel3D()

# 2) Nodos (geometría)
model.add_node('N1', 0, 0, 0)
model.add_node('N2', 168, 0, 0)

# 3) Material
model.add_material('Steel', E=29000, G=11200, nu=0.3, rho=2.836e-4)

# 4) Sección
model.add_section('MySection', A=20, Iy=100, Iz=150, J=250)

# 5) Barra(s)
model.add_member('M1', 'N1', 'N2', 'Steel', 'MySection')

# 6) Apoyos
model.def_support('N1', True, True, True, False, False, False)
model.def_support('N2', True, True, True, True,  False, False)

# 7) Cargas (asignadas a casos)
model.add_member_dist_load('M1', 'Fy', -200/1000/12, -200/1000/12, 0, 168, case='D')

# 8) Combinaciones (opcional; si no, se usa 'Combo 1')
model.add_load_combo('1.4D', {'D': 1.4})

# 9) Análisis
model.analyze(check_statics=True)

# 10) Resultados
print(model.nodes['N1'].RxnFY['1.4D'])
print(model.members['M1'].max_moment('Mz', '1.4D'))
```

**Regla de dependencias**: un material y una sección deben existir **antes** de crear la barra que los usa; los nodos deben existir antes de la barra; las barras/nodos antes de las cargas que los referencian. El frontend debe respetar este orden al traducir su modelo de datos a llamadas PyNite.

---

## 5. Referencia de la API: `FEModel3D`

> Firmas extraídas del código fuente v3.0.0 (`Pynite/FEModel3D.py`). Los valores tras `=` son los **defaults**.

### 5.1. Geometría y elementos

```python
add_node(name, X, Y, Z) -> str
```
Crea un nodo en las coordenadas globales (X, Y, Z).

```python
add_material(name, E, G, nu, rho, fy=None) -> str
```
Material elástico. `E`=módulo de elasticidad, `G`=módulo de cortante, `nu`=Poisson, `rho`=densidad (para peso propio/masa), `fy`=límite elástico (opcional, usado en pushover).

```python
add_section(name, A, Iy, Iz, J) -> str
```
Sección genérica. `A`=área, `Iy`/`Iz`=inercias respecto a ejes locales y/z, `J`=constante de torsión.

```python
add_steel_section(name, A, Iy, Iz, J, Zy, Zz, material_name) -> str
```
Sección de acero con módulos plásticos `Zy`, `Zz` (necesarios para pushover). Va ligada a un material.

```python
add_member(name, i_node, j_node, material_name, section_name,
           rotation=0.0, tension_only=False, comp_only=False) -> str
```
Barra entre dos nodos. `rotation` gira la sección (grados) sobre el eje local x. `tension_only`/`comp_only` hacen la barra no lineal (sólo tracción/compresión).

```python
add_spring(name, i_node, j_node, ks, tension_only=False, comp_only=False) -> str
```
Muelle axial entre dos nodos con rigidez `ks`.

```python
add_plate(name, i_node, j_node, m_node, n_node, t, material_name,
          kx_mod=1.0, ky_mod=1.0) -> str
```
Placa rectangular de 4 nodos, espesor `t`. `kx_mod`/`ky_mod` modifican rigidez (p. ej. para fisuración).

```python
add_quad(name, i_node, j_node, m_node, n_node, t, material_name,
         kx_mod=1.0, ky_mod=1.0) -> str
```
Cuadrilátero general de 4 nodos (formulación DKMQ; admite geometría no rectangular). Los 4 nodos deben darse en orden (i→j→m→n).

### 5.2. Mallado (genera nodos + elementos automáticamente)

```python
add_rectangle_mesh(name, mesh_size, width, height, thickness, material_name,
                   kx_mod=1.0, ky_mod=1.0, origin=(0,0,0), plane='XY',
                   x_control=None, y_control=None, start_node=None,
                   start_element=None, element_type='Quad') -> str
```
Malla rectangular. `plane` ∈ `'XY'|'YZ'|'XZ'`; `element_type` ∈ `'Quad'|'Rect'`.

```python
add_annulus_mesh(name, mesh_size, outer_radius, inner_radius, thickness,
                 material_name, kx_mod=1.0, ky_mod=1.0, origin=(0,0,0),
                 axis='Y', start_node=None, start_element=None) -> str
add_frustrum_mesh(name, mesh_size, large_radius, small_radius, height, thickness, ...) -> str
add_cylinder_mesh(name, mesh_size, radius, height, ...) -> str
add_shear_wall(name, mesh_size, length, height, thickness, material_name,
               ky_mod=0.35, plane='XY', origin=[0,0,0])
add_mat_foundation(name, mesh_size, length_X, length_Z, thickness, material_name,
                   ks, origin=[0,0,0], x_control=[], y_control=[])
```
> Las mallas se **generan automáticamente** al analizar. Puedes forzar la generación previa con `model.meshes['MSH1'].generate()` para iterar sobre sus nodos/elementos antes de analizar (p. ej. aplicar cargas o apoyos por posición).

### 5.3. Apoyos, liberaciones y desplazamientos impuestos

```python
def_support(node_name, support_DX=False, support_DY=False, support_DZ=False,
            support_RX=False, support_RY=False, support_RZ=False)
```
Restringe GDL (True = restringido). Ejemplos:
- Empotramiento: `def_support('N1', True, True, True, True, True, True)`
- Apoyo fijo (rótula): `def_support('N1', True, True, True, False, False, False)`
- Apoyo deslizante: restringe sólo la dirección perpendicular.

```python
def_support_spring(node_name, dof, stiffness, direction=None)
```
Apoyo elástico. `dof` ∈ `'DX','DY','DZ','RX','RY','RZ'`; `direction` puede limitarlo a `'+'`/`'-'` (sólo-tracción/compresión).

```python
def_node_disp(node_name, direction, magnitude)
```
Desplazamiento/giro impuesto en un GDL (asentamientos, etc.).

```python
def_releases(member_name, Dxi=False, Dyi=False, Dzi=False, Rxi=False, Ryi=False, Rzi=False,
                          Dxj=False, Dyj=False, Dzj=False, Rxj=False, Ryj=False, Rzj=False)
```
Libera GDL en los extremos `i` y `j` de una barra. **Para hacer una barra de celosía** (biarticulada) se liberan los momentos en ambos extremos: `Ryi=Rzi=Ryj=Rzj=True`.

### 5.4. Cargas

```python
add_node_load(node_name, direction, P, case='Case 1')
```
Carga puntual en nodo. `direction` ∈ `'FX','FY','FZ','MX','MY','MZ'` (sólo global).

```python
add_member_pt_load(member_name, direction, P, x, case='Case 1')
```
Carga puntual en barra a distancia `x` (local). `direction` admite local (`Fx,Fy,Fz,Mx,My,Mz`) **y** global (`FX,FY,FZ,MX,MY,MZ`).

```python
add_member_dist_load(member_name, direction, w1, w2, x1=None, x2=None,
                     case='Case 1', self_weight=False)
```
Carga distribuida (trapezoidal de `w1` a `w2`) entre `x1` y `x2` (por defecto, toda la barra). `direction` ∈ `'Fx','Fy','Fz','FX','FY','FZ'`.

```python
add_member_self_weight(global_direction, factor, case='Case 1')
```
Aplica peso propio a TODAS las barras en una dirección global (usa ρ·A). `factor` puede ser `-1` para que actúe hacia abajo.

```python
add_plate_surface_pressure(plate_name, pressure, case='Case 1')
add_quad_surface_pressure(quad_name, pressure, case='Case 1')
```
Presión perpendicular a la superficie del elemento.

```python
add_load_combo(name, factors, combo_tags=None)
```
Combinación, p. ej. `add_load_combo('1.2D+1.0L', {'D':1.2, 'L':1.0})`. `combo_tags` permite agrupar combinaciones (p. ej. `['strength']`) para filtrar en el análisis.

```python
delete_loads()   # borra todas las cargas del modelo
```

### 5.5. Edición del modelo

```python
merge_duplicate_nodes(tolerance=0.001) -> list   # fusiona nodos coincidentes (útil tras mallar)
delete_node(node_name)
delete_spring(spring_name)
delete_member(member_name)
delete_mesh(mesh_name)
rename()                                          # renumera/normaliza nombres
orphaned_nodes()                                  # nodos sin conectar
```

### 5.6. Métodos de bajo nivel (avanzado)

`Ke()`, `Kg()`, `Km()`, `M()`, `FER()`, `P()`, `D()` devuelven matrices de rigidez elástica/geométrica/plástica, de masa, vector de cargas de empotramiento, vector de cargas y vector de desplazamientos. **No los necesita un frontend típico**; son para depuración o usos académicos.

---

## 6. Tipos de análisis

```python
analyze_linear(log=False, check_stability=True, check_statics=False,
               sparse=True, combo_tags=None)
```
Análisis lineal de **primer orden**. El más rápido. Ignora P-Δ y elementos no lineales (tension/comp-only se tratan como lineales). Úsalo para modelos puramente lineales.

```python
analyze(log=False, check_stability=True, check_statics=False, max_iter=30,
        sparse=True, combo_tags=None, spring_tolerance=0, member_tolerance=0,
        num_steps=1)
```
Análisis general (primer orden) que **sí itera** para resolver elementos no lineales (tension-only/comp-only, apoyos elásticos direccionales). Es el método **por defecto** recomendado salvo que necesites P-Δ.

```python
analyze_PDelta(log=False, check_stability=True, max_iter=30, sparse=True, combo_tags=None)
```
Análisis **P-Δ** (segundo orden). Para capturar P-δ (efecto local) conviene dividir cada barra en ~3 segmentos.

```python
analyze_modal(num_modes=12, mass_combo_name='Combo 1', mass_direction='Y',
              gravity=1.0, log=False, check_stability=True)
```
Análisis **modal**: frecuencias propias y modos. La masa se deriva de las cargas de la combinación indicada.

```python
analyze_pushover(log=False, check_stability=True, push_combo='Push', max_iter=30,
                 tol=0.01, sparse=True, combo_tags=None, control_node=None,
                 control_direction='DX', control_limit=None, traces=None)
```
**Pushover** no lineal (sólo acero, secciones en I). Empuja monótonamente hasta `control_limit` en `control_node`.

**Parámetros comunes útiles:**
- `check_statics=True`: imprime una comprobación de equilibrio global (sumatorio de reacciones vs. cargas). Muy recomendable para validar.
- `check_stability=True`: detecta inestabilidades/mecanismos (GDL sin rigidez).
- `log=True`: imprime progreso (útil en backend para logging).
- `sparse=True`: usa matrices dispersas (más rápido en modelos grandes).
- `combo_tags`: analiza sólo las combinaciones con esas etiquetas.

> Tras analizar, `model.solution` queda fijado al tipo de análisis. Cualquier `add_*` posterior pone `model.solution = None` (hay que reanalizar).

---

## 7. Extracción de resultados

> **Todos los resultados se indexan por el nombre de la combinación de carga.** Si no definiste combinaciones, usa `'Combo 1'`.

### 7.1. Resultados en nodos (`Node3D`)

Cada nodo expone diccionarios `{nombre_combo: valor}`:

| Atributo | Significado |
|----------|-------------|
| `node.DX, DY, DZ` | desplazamientos de traslación |
| `node.RX, RY, RZ` | rotaciones |
| `node.RxnFX, RxnFY, RxnFZ` | reacciones de fuerza (en apoyos) |
| `node.RxnMX, RxnMY, RxnMZ` | reacciones de momento |

```python
ux   = model.nodes['N2'].DX['1.2D+1.0W']      # desplazamiento horizontal
Ry   = model.nodes['N1'].RxnFY['1.4D']        # reacción vertical
Mz   = model.nodes['N1'].RxnMZ['1.2D+1.0W']   # reacción de momento
```

> Ojo: son **diccionarios** → se accede con corchetes `[...]` y el nombre de la combinación, **no** con paréntesis.

### 7.2. Resultados en barras (`PhysMember`)

Acceso: `m = model.members['M1']`. Métodos (todos aceptan `combo_name`, por defecto `'Combo 1'`):

**Esfuerzos en un punto `x` (local):**
```python
m.shear('Fy', x, combo_name)        # cortante en dirección local Fy o Fz
m.moment('Mz', x, combo_name)       # momento flector My o Mz
m.axial(x, combo_name)              # esfuerzo axil
m.torque(x, combo_name)             # torsor
m.deflection('dy', x, combo_name)   # flecha local dx, dy o dz
m.rel_deflection('dy', x, combo_name)  # flecha relativa a la cuerda
```

**Valores extremos** (devuelven el valor; si pasas una lista de `combo_tags`, devuelven `(valor, combo)`):
```python
m.max_shear('Fy', combo_name)
m.min_shear('Fy', combo_name)
m.max_moment('Mz', combo_name)
m.min_moment('Mz', combo_name)
m.max_axial(combo_name)
m.min_axial(combo_name)
m.max_torque(combo_name)
m.min_torque(combo_name)
m.max_deflection('dy', combo_name)
m.min_deflection('dy', combo_name)
```

**Arrays para graficar** (¡clave para el frontend! devuelven `numpy.ndarray`):
```python
m.shear_array('Fy', n_points, combo_name, x_array=None)       # -> [[x...],[V...]]
m.moment_array('Mz', n_points, combo_name, x_array=None)
m.axial_array(n_points, combo_name, x_array=None)
m.torque_array(n_points, combo_name, x_array=None)
m.deflection_array('dy', n_points, combo_name, x_array=None)
```
Cada array tiene forma `(2, n_points)`: la primera fila son las posiciones `x` y la segunda el valor. Estos son los datos que enviarás al frontend para dibujar los diagramas con una librería JS (Plotly, Chart.js, D3…).

**Gráficas matplotlib** (para uso de escritorio/notebook, **no** para web directa):
```python
m.plot_shear('Fy', combo_name)
m.plot_moment('Mz', combo_name)
m.plot_axial(combo_name)
m.plot_torque(combo_name)
m.plot_deflection('dy', combo_name)
```
> En el backend web usa los `*_array()`, no los `plot_*` (estos abren ventanas matplotlib).

Direcciones válidas: cortante `'Fy'|'Fz'`, momento `'My'|'Mz'`, flecha `'dx'|'dy'|'dz'`.

### 7.3. Resultados en placas/cuadriláteros y mallas

Cada `Quad`/`Plate` devuelve **arrays de NumPy** evaluados en coordenadas naturales `(xi, eta)` ∈ [-1, 1] (o (x, y) en rectángulos):

```python
q = model.quads['Q1']
q.moment(xi, eta, local=True, combo_name='Combo 1')    # -> [Mx, My, Mxy]
q.shear(xi, eta, local=True, combo_name='Combo 1')     # -> [Qx, Qy]
q.membrane(xi, eta, local=True, combo_name='Combo 1')  # -> [Sx, Sy, Txy]  (esfuerzos de membrana)
```

A nivel de **malla** hay extremos directos:
```python
model.meshes['MSH1'].max_moment('Mx', '1.0W')
model.meshes['MSH1'].min_moment('Mx', '1.0W')
# 'Mx','My','Mxy','Qx','Qy', etc.
```

---

## 8. Visualización (`Renderer`)

PyNite usa **PyVista** (sobre VTK) para renderizar en 3D. La clase está en `Pynite.Rendering.Renderer` (alias en `Pynite.Visualization`).

```python
from Pynite.Rendering import Renderer
rndr = Renderer(model)

# Atributos configurables (con sus defaults):
rndr.annotation_size      # tamaño de texto/glifos (auto si no se fija: 5% de la menor distancia entre nodos)
rndr.deformed_shape = True       # mostrar deformada (default False)
rndr.deformed_scale = 50         # factor de amplificación de la deformada (default 30)
rndr.render_nodes = True         # dibujar nodos (default True)
rndr.render_loads = True         # dibujar cargas (default True)
rndr.combo_name = '1.2D+1.0W'    # combinación a mostrar (default 'Combo 1')
rndr.case = None                 # alternativamente, mostrar un CASO de carga
rndr.labels = True               # etiquetas de nodos/barras
rndr.color_map = 'Mx'            # contorno en placas/quads: 'dz','Mx','My','Mxy','Qx','Qy','Sx','Sy','Txy'
rndr.scalar_bar = True           # barra de color del contorno
rndr.scalar_bar_text_size = 24
rndr.member_diagrams = 'Mz'      # superpone diagrama en barras: None,'Fx','Fy','Fz','My','Mz','Tx'
rndr.diagram_scale = 50
rndr.member_csys = False         # dibuja ejes locales de barra
rndr.theme = 'default'           # 'default' o 'print' (fondo/colores para imprimir)
rndr.window_width  = 800
rndr.window_height = 600

# Métodos:
rndr.render_model(reset_camera=True, off_screen=False)   # abre ventana interactiva
rndr.screenshot(filepath='./img.png', interact=True, reset_camera=False)  # guarda PNG
rndr.update(reset_camera=True, off_screen=False)         # recalcula la escena
```

> **Importante para web**: `render_model()` abre una **ventana de escritorio** y bloquea — no sirve para un servidor web. Para un frontend, usa una de las estrategias de §11 (screenshot off-screen, exportar la escena, o —recomendado— enviar geometría+resultados como JSON y renderizar en el navegador con three.js).

Para render headless en servidor:
```python
import pyvista as pv
pv.OFF_SCREEN = True              # antes de crear el Renderer
rndr = Renderer(model)
rndr.deformed_shape = True
rndr.screenshot('out.png', interact=False)   # genera PNG sin abrir ventana
```

---

## 9. Convenciones y errores comunes (gotchas)

1. **Resultados por combinación, con corchetes**: `node.DX['Combo 1']` (dict), no `node.DX(...)`.
2. **`'Combo 1'` por defecto**: si no defines combinaciones, todos los resultados están bajo `'Combo 1'`; las cargas sin `case` van a `'Case 1'`.
3. **Direcciones mayúscula/minúscula**: MAYÚSCULAS = global, minúsculas = local. Es la fuente nº1 de errores en cargas distribuidas/puntuales.
4. **Unidades consistentes**: PyNite no avisa de inconsistencias. Resultados absurdos suelen ser errores de unidades (p. ej. mezclar in y ft, o E en MPa con longitudes en m).
5. **Orden de construcción**: material y sección antes que la barra; nodos antes que barras/cargas.
6. **Celosías**: una "barra" por defecto transmite momentos. Para celosía pura, libera momentos en extremos con `def_releases` (o usa `tension_only`).
7. **Reanálisis**: cualquier `add_*` invalida la solución (`model.solution=None`); hay que volver a llamar a `analyze*`.
8. **Estabilidad**: si el modelo está mal sujeto (mecanismo), `check_stability` lanza error. Verifica apoyos y conectividad. `merge_duplicate_nodes()` ayuda tras mallar.
9. **`check_statics=True`** es tu mejor amigo para validar: comprueba el equilibrio global.
10. **Mallas**: se generan al analizar; si quieres aplicar cargas/apoyos por posición, llama antes a `model.meshes[...].generate()` e itera sobre `model.nodes` / `model.quads`.
11. **No hay guardado/carga nativo**: el modelo vive en memoria. El frontend debe serializar su propio estado (ver §11).
12. **`plot_*` y `render_model()` son bloqueantes/escritorio**: en backend usa `*_array()` y render off-screen.

---

## 10. Ejemplos completos

### 10.1. Viga simplemente apoyada con carga uniforme

```python
from Pynite import FEModel3D

beam = FEModel3D()
beam.add_node('N1', 0, 0, 0)
beam.add_node('N2', 168, 0, 0)          # 14 ft = 168 in

E, G, nu, rho = 29000, 11200, 0.3, 2.836e-4
beam.add_material('Steel', E, G, nu, rho)
beam.add_section('MySection', 20, 100, 150, 250)   # A, Iy, Iz, J
beam.add_member('M1', 'N1', 'N2', 'Steel', 'MySection')

beam.def_support('N1', True, True, True, False, False, False)
beam.def_support('N2', True, True, True, True,  False, False)

beam.add_member_dist_load('M1', 'Fy', -200/1000/12, -200/1000/12, 0, 168)  # 200 plf

beam.analyze()

print('Reacción izq:', {k: float(v) for k, v in beam.nodes['N1'].RxnFY.items()})
print('Momento máx:', beam.members['M1'].max_moment('Mz'))
```

### 10.2. Pórtico 2D con carga lateral (combinaciones + P-Δ)

```python
from Pynite import FEModel3D

frame = FEModel3D()
frame.add_node('N1', 0, 0, 0)
frame.add_node('N2', 0, 12*12, 0)
frame.add_node('N3', 15*12, 12*12, 0)
frame.add_node('N4', 15*12, 0, 0)

frame.add_material('Steel', 29000, 11200, 0.3, 0.490/12**3)
frame.add_section('W10x33', 9.71, 36.6, 171, 0.58)   # A, Iy, Iz, J
frame.add_section('W8x24',  7.08, 18.3, 82.7, 0.346)

frame.add_member('Col1', 'N1', 'N2', 'Steel', 'W10x33')
frame.add_member('Col2', 'N4', 'N3', 'Steel', 'W10x33')
frame.add_member('Beam', 'N2', 'N3', 'Steel', 'W8x24')

frame.def_support('N1', True, True, True, True, True, True)   # empotrado
frame.def_support('N4', True, True, True, True, True, True)

frame.add_member_dist_load('Beam', 'Fy', -0.024/12, -0.024/12, case='D')
frame.add_node_load('N2', 'FX', 10, case='W')                 # viento

frame.add_load_combo('1.2D+1.0W', {'D': 1.2, 'W': 1.0})
frame.add_load_combo('0.9D+1.0W', {'D': 0.9, 'W': 1.0})

frame.analyze_PDelta(log=True)

print('Deriva lateral:', frame.nodes['N2'].DX['1.2D+1.0W'])
print('Cortante columna:', frame.members['Col1'].max_shear('Fy', '1.2D+1.0W'))
```

### 10.3. Celosía espacial (liberaciones de momento)

```python
from Pynite import FEModel3D

truss = FEModel3D()
for n, (x, y, z) in {'A':(1.1,-0.4,0),'B':(1,0,0),'C':(0,0,0.6),
                     'D':(0,0,-0.4),'E':(0,0.8,0)}.items():
    truss.add_node(n, x, y, z)

for n in ('C','D','E'):
    truss.def_support(n, True, True, True, True, True, True)

truss.add_material('Rigid', 99999999, 100, 0.3, 1)
truss.add_section('TrussSection', 100, 100, 100, 100)

for m, (i, j) in {'AB':('A','B'),'AC':('A','C'),'AD':('A','D'),
                  'BC':('B','C'),'BD':('B','D'),'BE':('B','E')}.items():
    truss.add_member(m, i, j, 'Rigid', 'TrussSection')

# Liberar momentos en extremos -> barras biarticuladas
for m in ('AC','AD','BC','BD','BE'):
    truss.def_releases(m, False,False,False,False,True,True,
                           False,False,False,False,True,True)

truss.add_node_load('A', 'FX', 10)
truss.add_node_load('A', 'FY', 60)
truss.add_node_load('A', 'FZ', 20)

truss.analyze(check_statics=True)
print('Axil BC:', truss.members['BC'].max_axial())
```

### 10.4. Muro de hormigón con cuadriláteros (malla + presión + contornos)

```python
from Pynite import FEModel3D

t, width, height, mesh_size, load = 1, 10, 20, 1, 250   # ft, psf
model = FEModel3D()
E = 57000*(4000)**0.5*12**2                              # psf
model.add_material('Concrete', E, 0.4*E, 0.17, 150)

model.add_rectangle_mesh('MSH1', mesh_size, width, height, t, 'Concrete',
                         1, 1, [0, 0, 0], 'XY', element_type='Quad')
model.meshes['MSH1'].generate()

for el in model.quads.values():
    model.add_quad_surface_pressure(el.name, load, case='W')

for node in model.nodes.values():
    if (round(node.Y,10) in (0, height)) or (round(node.X,10) in (0, width)):
        model.def_support(node.name, True, True, True, True, True, True)

model.add_load_combo('1.0W', {'W': 1.0})
model.analyze(check_statics=True)

print('Mx máx:', model.meshes['MSH1'].max_moment('Mx', '1.0W'))
```

> Más ejemplos en la carpeta [`Examples/`](https://github.com/JWock82/Pynite/tree/main/Examples): vigas sobre lecho elástico, pórticos arriostrados, análisis modal, pushover, P-Delta, losa de cimentación, muros de cortante, etc.

---

## 11. Arquitectura recomendada para el frontend web

El objetivo: una **interfaz gráfica web** para (a) introducir datos del modelo, (b) lanzar el análisis y (c) visualizar resultados (deformada 3D, diagramas, reacciones, tablas).

PyNite es una librería **Python de escritorio/cálculo**, sin API web ni serialización. La arquitectura natural es **backend Python + frontend SPA**:

```
┌──────────────────────────┐        HTTP/JSON         ┌───────────────────────────┐
│  FRONTEND (navegador)     │  <───────────────────>   │  BACKEND (Python)          │
│  - React/Vue/Svelte       │                          │  - FastAPI / Flask         │
│  - Editor de modelo (form │   POST /analyze {modelo} │  - Traduce JSON -> PyNite  │
│    + canvas 3D)           │   ──────────────────────>│  - model.analyze()         │
│  - three.js / R3F (3D)    │                          │  - Serializa resultados    │
│  - Plotly (diagramas)     │   <── {resultados JSON} ─│                            │
└──────────────────────────┘                          └───────────────────────────┘
```

### 11.1. Esquema de datos JSON (contrato frontend↔backend)

Como PyNite no serializa, **define tú el esquema**. Propuesta:

```jsonc
{
  "units": "kip-in",                       // metadato; el backend asume consistencia
  "nodes":    [{ "name": "N1", "x": 0, "y": 0, "z": 0 }],
  "materials":[{ "name": "Steel", "E": 29000, "G": 11200, "nu": 0.3, "rho": 2.836e-4, "fy": 50 }],
  "sections": [{ "name": "W10x33", "A": 9.71, "Iy": 36.6, "Iz": 171, "J": 0.58 }],
  "members":  [{ "name": "M1", "i": "N1", "j": "N2",
                 "material": "Steel", "section": "W10x33",
                 "rotation": 0, "tension_only": false, "comp_only": false,
                 "releases": null }],
  "supports": [{ "node": "N1", "DX": true, "DY": true, "DZ": true,
                 "RX": false, "RY": false, "RZ": false }],
  "node_loads":  [{ "node": "N2", "direction": "FX", "P": 10, "case": "W" }],
  "dist_loads":  [{ "member": "M1", "direction": "Fy", "w1": -0.1, "w2": -0.1,
                    "x1": null, "x2": null, "case": "D" }],
  "pt_loads":    [{ "member": "M1", "direction": "Fy", "P": -5, "x": 84, "case": "L" }],
  "combos":   [{ "name": "1.2D+1.0W", "factors": { "D": 1.2, "W": 1.0 } }],
  "analysis": { "type": "PDelta", "check_statics": true }   // linear | analyze | PDelta | modal
}
```

### 11.2. Capa de construcción del modelo (backend)

Una función que recorre el JSON **en el orden de dependencias** (materiales → secciones → nodos → barras → apoyos → cargas → combos):

```python
from Pynite import FEModel3D

def build_model(payload: dict) -> FEModel3D:
    m = FEModel3D()
    for mat in payload.get("materials", []):
        m.add_material(mat["name"], mat["E"], mat["G"], mat["nu"], mat["rho"], mat.get("fy"))
    for s in payload.get("sections", []):
        m.add_section(s["name"], s["A"], s["Iy"], s["Iz"], s["J"])
    for n in payload["nodes"]:
        m.add_node(n["name"], n["x"], n["y"], n["z"])
    for mb in payload.get("members", []):
        m.add_member(mb["name"], mb["i"], mb["j"], mb["material"], mb["section"],
                     mb.get("rotation", 0.0),
                     mb.get("tension_only", False), mb.get("comp_only", False))
        if mb.get("releases"):
            m.def_releases(mb["name"], *mb["releases"])   # lista de 12 booleanos
    for sp in payload.get("supports", []):
        m.def_support(sp["node"], sp.get("DX",False), sp.get("DY",False), sp.get("DZ",False),
                                   sp.get("RX",False), sp.get("RY",False), sp.get("RZ",False))
    for l in payload.get("node_loads", []):
        m.add_node_load(l["node"], l["direction"], l["P"], l.get("case","Case 1"))
    for l in payload.get("dist_loads", []):
        m.add_member_dist_load(l["member"], l["direction"], l["w1"], l["w2"],
                               l.get("x1"), l.get("x2"), l.get("case","Case 1"))
    for l in payload.get("pt_loads", []):
        m.add_member_pt_load(l["member"], l["direction"], l["P"], l["x"], l.get("case","Case 1"))
    for c in payload.get("combos", []):
        m.add_load_combo(c["name"], c["factors"], c.get("combo_tags"))
    return m
```

### 11.3. Capa de análisis + serialización de resultados

```python
def run_analysis(m: FEModel3D, cfg: dict) -> None:
    t = cfg.get("type", "analyze")
    cs = cfg.get("check_statics", False)
    if   t == "linear": m.analyze_linear(check_statics=cs)
    elif t == "PDelta": m.analyze_PDelta()
    elif t == "modal":  m.analyze_modal(num_modes=cfg.get("num_modes", 12))
    else:               m.analyze(check_statics=cs)

def serialize_results(m: FEModel3D, combos: list[str], n_points: int = 20) -> dict:
    out = {"nodes": {}, "members": {}}
    for name, nd in m.nodes.items():
        out["nodes"][name] = {
            "disp": {c: [float(nd.DX[c]), float(nd.DY[c]), float(nd.DZ[c]),
                         float(nd.RX[c]), float(nd.RY[c]), float(nd.RZ[c])] for c in combos},
            "rxn":  {c: [float(nd.RxnFX[c]), float(nd.RxnFY[c]), float(nd.RxnFZ[c]),
                         float(nd.RxnMX[c]), float(nd.RxnMY[c]), float(nd.RxnMZ[c])] for c in combos},
        }
    for name, mb in m.members.items():
        out["members"][name] = {}
        for c in combos:
            out["members"][name][c] = {
                "shear_y":  mb.shear_array('Fy', n_points, c).tolist(),
                "moment_z": mb.moment_array('Mz', n_points, c).tolist(),
                "axial":    mb.axial_array(n_points, c).tolist(),
                "defl_y":   mb.deflection_array('dy', n_points, c).tolist(),
                "max_moment_z": float(mb.max_moment('Mz', c)),
                "min_moment_z": float(mb.min_moment('Mz', c)),
                "max_shear_y":  float(mb.max_shear('Fy', c)),
            }
    return out
```

> Nota: convierte los valores NumPy a `float`/`list` con `float(...)` y `.tolist()` para que sean serializables a JSON. Filtra `combos` solo a las que existen en `m.load_combos`.

### 11.4. Endpoint FastAPI de ejemplo

```python
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

@app.post("/analyze")
def analyze(payload: dict):
    m = build_model(payload)
    run_analysis(m, payload.get("analysis", {}))
    combos = list(m.load_combos.keys()) or ['Combo 1']
    return serialize_results(m, combos)

@app.post("/render")          # opción: PNG del modelo (render off-screen)
def render(payload: dict):
    import pyvista as pv
    pv.OFF_SCREEN = True
    m = build_model(payload); run_analysis(m, payload.get("analysis", {}))
    from Pynite.Rendering import Renderer
    r = Renderer(m); r.deformed_shape = True
    r.combo_name = (list(m.load_combos) or ['Combo 1'])[0]
    r.screenshot('/tmp/out.png', interact=False)
    # ...devolver el PNG (FileResponse) o codificado en base64...
```

### 11.5. Estrategia de visualización 3D en el navegador

Tres opciones, de menor a mayor calidad de UX:

1. **PNG en servidor (más simple)**: `pv.OFF_SCREEN = True` + `Renderer.screenshot()`. El backend devuelve una imagen. Sin interactividad. Requiere PyVista/VTK + librerías gráficas del SO en el servidor (xvfb/EGL en Linux).
2. **Geometría + resultados como JSON, render en el cliente (recomendado)**: el backend envía nodos, conectividad y desplazamientos; el frontend dibuja con **three.js / react-three-fiber**. Total interactividad (rotar, zoom, animar la deformada con `deformed_scale`). La deformada se obtiene sumando a cada nodo `DX/DY/DZ` × escala.
3. **Exportar escena PyVista a web**: PyVista/trame puede servir escenas VTK.js o exportar HTML; más pesado, útil si quieres reusar el render exacto de PyNite.

**Diagramas (cortante/momento/axil/flecha)**: usa siempre los `*_array(direction, n_points, combo)` del backend → JSON → dibuja con **Plotly.js / Chart.js / D3** en el cliente. No uses `plot_*` (abren matplotlib en el servidor).

### 11.6. Componentes de UI sugeridos

- **Editor de geometría**: tabla de nodos (x,y,z) + tabla de barras (i, j, material, sección) o, mejor, un canvas 3D con creación interactiva.
- **Biblioteca de materiales y secciones** (catálogo reutilizable; p. ej. perfiles AISC/europeos precargados).
- **Editor de apoyos**: checkboxes de los 6 GDL por nodo.
- **Editor de cargas**: por caso, con selector de dirección (global/local) y tipo (nodal/puntual/distribuida/presión).
- **Gestor de combinaciones**: tabla nombre → {caso: factor}.
- **Panel de resultados**: selector de combinación; tablas de reacciones y desplazamientos; diagramas por barra; vista 3D de la deformada con contorno para placas (`color_map`).
- **Selector de unidades** global y conversión en un único punto.
- **Validación previa** (ver §13) antes de enviar al backend.

---

## 12. Despliegue con WebAssembly / Pyodide (sin servidor)

PyNite puede ejecutarse **íntegramente en el navegador**, sin backend Python, gracias a **[Pyodide](https://pyodide.org/)** (la distribución de CPython compilada a WebAssembly). No se "recompila PyNite a WASM": lo que se compila a WASM es el **intérprete de Python + NumPy + SciPy**; sobre él se instala PyNite, que es **Python puro** y por tanto corre tal cual.

Resultado: una **app estática** (HTML + JS) que se hospeda en GitHub Pages, Netlify, Cloudflare Pages, etc., calcula en el dispositivo del usuario, funciona **offline** tras la primera carga y **no envía datos a ningún servidor**.

### 12.1. Arquitectura (todo en el cliente)

```
┌───────────────────────────────────────────────────────────────┐
│  NAVEGADOR (una sola SPA estática, sin servidor de cálculo)     │
│                                                                 │
│  UI (React/Vue/JS) ──JSON modelo──▶ Pyodide (WASM)              │
│   - formularios                      ├─ CPython + NumPy + SciPy │
│   - three.js (3D)                    └─ PyNite (Python puro)    │
│   - Plotly (diagramas) ◀──JSON resultados── runPython(...)      │
└───────────────────────────────────────────────────────────────┘
```

El **contrato JSON y las funciones `build_model()` / `run_analysis()` / `serialize_results()` de §11 son idénticos**: el mismo código Python se ejecuta dentro de Pyodide en lugar de en FastAPI. Esto permite empezar con backend y migrar a WASM (o soportar ambos) sin reescribir la lógica.

### 12.2. Compatibilidad de dependencias

| Dependencia | ¿Funciona en Pyodide? | Cómo |
|-------------|----------------------|------|
| **PyNite** (núcleo de cálculo) | ✅ | Python puro → `micropip.install("PyNiteFEA", deps=False)` |
| **numpy** | ✅ | Build WASM oficial de Pyodide |
| **scipy** | ✅ | Build WASM oficial (necesario para los solvers dispersos) |
| **prettytable** | ✅ | Python puro → `micropip` |
| **matplotlib** | ✅ | Incluido en Pyodide (sólo si algo lo importa; no se usa para web) |
| **pyvista / vtk** | ❌ | No existen en WASM → se sustituyen por three.js/Plotly (ya previsto en §11.5) |

> No se pierde nada relevante: en la arquitectura web el `Renderer` de PyVista ya estaba sustituido por render en JS. Sólo perderías el endpoint `/render` (PNG en servidor), que no aplica sin servidor.

#### ⚠️ El escollo de la versión de NumPy

PyNite 3.0.0 fija `numpy>=2.4.0`, pero **Pyodide estable (0.29.4) incluye numpy 2.2.5 y scipy 1.14.1**. Si haces `micropip.install("PyNiteFEA")` sin más, la resolución de dependencias **falla**. Tres salidas:

1. **Instalar sin resolver dependencias** (lo más práctico): carga numpy/scipy con `loadPackage` y luego `micropip.install("PyNiteFEA", { deps: false })`. El pin `>=2.4.0` es casi seguro conservador (no un requisito de API), así que debería funcionar sobre 2.2.5 — **pero hay que validarlo** con tus modelos (ver §13.5).
2. Usar una build de Pyodide más reciente/nightly cuyo numpy sea ≥ 2.4.0.
3. Empaquetar una versión de PyNite cuyo pin de numpy sea ≤ la de Pyodide.

### 12.3. Cómo cargar PyNite en Pyodide

```js
const pyodide = await loadPyodide();
await pyodide.loadPackage(["numpy", "scipy", "micropip"]);   // builds WASM nativas
const micropip = pyodide.pyimport("micropip");
await micropip.install("prettytable");                        // dependencia pura-Python
await micropip.install("PyNiteFEA", { deps: false });         // evita el conflicto de numpy
```

### 12.4. Proof of concept completo (un solo archivo HTML)

```html
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>PyNite WASM</title>
<script src="https://cdn.jsdelivr.net/pyodide/v0.29.4/full/pyodide.js"></script>
</head>
<body>
<button id="run" disabled>Calcular viga</button>
<pre id="out">Cargando Pyodide… (descarga ~15-30 MB la primera vez)</pre>

<script type="module">
const out = document.getElementById("out");
const btn = document.getElementById("run");

// 1) Arrancar Pyodide + dependencias (cacheable por el navegador)
const pyodide = await loadPyodide();
await pyodide.loadPackage(["numpy", "scipy", "micropip"]);
const micropip = pyodide.pyimport("micropip");
await micropip.install("prettytable");
await micropip.install("PyNiteFEA", { deps: false });

// 2) Definir en Python las MISMAS funciones build_model/run_analysis/serialize_results de §11
pyodide.runPython(`
import json
from Pynite import FEModel3D

def build_and_solve(payload_json):
    p = json.loads(payload_json)
    m = FEModel3D()
    for mat in p.get("materials", []):
        m.add_material(mat["name"], mat["E"], mat["G"], mat["nu"], mat["rho"], mat.get("fy"))
    for s in p.get("sections", []):
        m.add_section(s["name"], s["A"], s["Iy"], s["Iz"], s["J"])
    for n in p["nodes"]:
        m.add_node(n["name"], n["x"], n["y"], n["z"])
    for mb in p.get("members", []):
        m.add_member(mb["name"], mb["i"], mb["j"], mb["material"], mb["section"])
    for sp in p.get("supports", []):
        m.def_support(sp["node"], sp.get("DX",False), sp.get("DY",False), sp.get("DZ",False),
                                   sp.get("RX",False), sp.get("RY",False), sp.get("RZ",False))
    for l in p.get("dist_loads", []):
        m.add_member_dist_load(l["member"], l["direction"], l["w1"], l["w2"],
                               l.get("x1"), l.get("x2"), l.get("case","Case 1"))
    for c in p.get("combos", []):
        m.add_load_combo(c["name"], c["factors"])
    m.analyze()
    combos = list(m.load_combos.keys()) or ["Combo 1"]
    res = {"nodes": {}, "members": {}}
    for name, nd in m.nodes.items():
        res["nodes"][name] = {c: {"DY": float(nd.DY[c]), "RxnFY": float(nd.RxnFY[c])} for c in combos}
    for name, mb in m.members.items():
        res["members"][name] = {c: {
            "moment_z": mb.moment_array("Mz", 20, c).tolist(),
            "max_moment_z": float(mb.max_moment("Mz", c)),
        } for c in combos}
    return json.dumps(res)
`);

btn.disabled = false;
out.textContent = "Listo. Pulsa el botón.";

// 3) Al pulsar: construir el JSON del modelo en JS y resolver en Python
btn.onclick = () => {
  const modelo = {
    nodes: [{name:"N1",x:0,y:0,z:0}, {name:"N2",x:168,y:0,z:0}],
    materials: [{name:"Steel", E:29000, G:11200, nu:0.3, rho:2.836e-4}],
    sections: [{name:"S", A:20, Iy:100, Iz:150, J:250}],
    members: [{name:"M1", i:"N1", j:"N2", material:"Steel", section:"S"}],
    supports: [
      {node:"N1", DX:true, DY:true, DZ:true},
      {node:"N2", DX:true, DY:true, DZ:true, RX:true}
    ],
    dist_loads: [{member:"M1", direction:"Fy", w1:-0.0139, w2:-0.0139}],
    combos: []
  };
  const build = pyodide.globals.get("build_and_solve");
  const resultado = JSON.parse(build(JSON.stringify(modelo)));  // Python -> JSON -> objeto JS
  out.textContent = JSON.stringify(resultado, null, 2);
  // Aquí: alimentar three.js (deformada con DY) y Plotly (resultado.members.M1["Combo 1"].moment_z)
};
</script>
</body>
</html>
```

> **Intercambio de datos Python↔JS**: la vía más robusta es serializar a JSON (`json.dumps` en Python ↔ `JSON.parse` en JS), como arriba. Evita problemas de conversión de tipos NumPy y de gestión de memoria de los *proxies* de Pyodide. Recuerda convertir todo a `float`/`.tolist()` antes de `json.dumps`.

### 12.5. Reutilizar el código de §11

No dupliques lógica: mete `build_model()`, `run_analysis()` y `serialize_results()` (de §11.2–11.3) en un módulo `.py` y cárgalo en Pyodide con `pyodide.runPythonAsync(await (await fetch('solver.py')).text())`, o empaquétalo como wheel. Así el **mismo solver** sirve para backend FastAPI y para WASM; sólo cambia la "cáscara" (HTTP vs `runPython`).

### 12.6. Rendimiento, tamaño y límites

- **Descarga inicial**: Pyodide + numpy + scipy ≈ **15–30 MB** (se cachea; la primera carga tarda varios segundos). Cárgalo de forma diferida y muestra progreso.
- **Velocidad**: WASM va ~**2–5× más lento** que nativo. Para vigas, pórticos y celosías (cientos a pocos miles de GDL) es **fluido**. Para **mallas grandes de placas/quads** (decenas de miles de GDL) puede ralentizarse.
- **Memoria**: WASM es de 32 bits → límite práctico de **~2–4 GB**. Modelos de malla muy grandes pueden agotarla.
- **Bloqueo de UI**: `runPython` es síncrono y congela la pestaña. Para modelos no triviales, **ejecuta Pyodide en un Web Worker** (ver §12.7) y comunica con `postMessage`.

### 12.7. Buenas prácticas

- **Web Worker**: corre Pyodide en un worker dedicado; la UI sigue respondiendo y puedes mostrar un *spinner* / barra de progreso durante el análisis.
- **Caché**: fija la versión de Pyodide en el CDN (`v0.29.4`) o autohospédalo; el navegador cachea los `.wasm`/wheels en cargas posteriores.
- **Persistencia**: guarda el JSON del modelo en `localStorage`/IndexedDB o permite exportar/importar `.json` (PyNite no persiste estado; tú gestionas el guardado).
- **Validación**: aplica las validaciones de §13.2 en JS *antes* de llamar a Python, para dar errores inmediatos sin arrancar el solver.
- **Precarga**: empieza a descargar Pyodide al cargar la página (en segundo plano) para que esté listo cuando el usuario termine de introducir datos.

### 12.8. ¿WebAssembly o backend? — guía de decisión

| Criterio | WebAssembly / Pyodide | Backend Python (FastAPI) |
|----------|----------------------|--------------------------|
| Coste de servidor | **Nulo** (hosting estático) | Servidor/contenedor a mantener |
| Privacidad / offline | **Datos en el cliente, offline** | Datos viajan al servidor |
| Tamaño de modelos | Pequeños/medianos | **Grandes (mallas extensas)** |
| Velocidad de cálculo | 2–5× más lenta | **Nativa** |
| Carga inicial | 15–30 MB la 1ª vez | Ligera (sólo la SPA) |
| Informes PDF (pdfkit) | ❌ (no en WASM) | **✅** |
| Concurrencia / multiusuario | Cada cliente calcula lo suyo | Centralizado, escalable con workers |

**Recomendación**: para una herramienta de vigas/pórticos/celosías y mallas modestas, **Pyodide/WASM es muy atractivo** (sin servidor, privado, desplegable como sitio estático). Para mallas grandes, informes PDF o cálculo intensivo centralizado, usa **backend**. Un diseño **híbrido** (WASM por defecto, *fallback* al backend cuando el modelo supere cierto tamaño) reutiliza el mismo solver en ambos lados.

---

## 13. Cómo debe trabajar el agente de código

Pautas para un agente que implemente o mantenga este sistema:

### 13.1. Principios

1. **El backend es la única fuente de verdad del cálculo.** Nunca reimplementes el FEM en JS; llama a PyNite.
2. **Respeta el orden de dependencias** al construir el modelo (materiales/secciones → nodos → barras → apoyos → cargas → combos → análisis).
3. **Unidades consistentes**: trata las unidades en una sola capa. Documenta el sistema elegido y conviértelo una sola vez.
4. **Idempotencia**: cada petición `/analyze` reconstruye el modelo desde cero a partir del JSON (PyNite no persiste estado entre peticiones). No reutilices instancias entre requests sin reanalizar.
5. **Serializa con tipos nativos**: `float()` y `.tolist()` sobre todo lo que venga de NumPy.
6. **Maneja `'Combo 1'`/`'Case 1'`** como valores por defecto cuando el usuario no define combos/casos.

### 13.2. Validaciones antes de analizar (en frontend y/o backend)

- Nombres únicos de nodos, barras, materiales, secciones, combos.
- Toda barra referencia nodos, material y sección existentes.
- Toda carga referencia un nodo/barra existente.
- Direcciones válidas:
  - Nodal: `FX,FY,FZ,MX,MY,MZ`.
  - Puntual en barra: `Fx,Fy,Fz,Mx,My,Mz` o globales `FX,FY,FZ,MX,MY,MZ`.
  - Distribuida: `Fx,Fy,Fz,FX,FY,FZ`.
- Existe al menos un apoyo suficiente para que la estructura no sea un mecanismo.
- Factores de combinación referencian casos que tienen cargas.

### 13.3. Manejo de errores de PyNite

- **`ValueError` de dirección**: dirección de carga inválida → valida en el frontend.
- **`NameError`**: nodo/barra inexistente referenciado → valida referencias.
- **Inestabilidad** (`check_stability`): el modelo es un mecanismo → revisa apoyos/conectividad. Sugiere `merge_duplicate_nodes()` tras mallar.
- **Resultados absurdos**: casi siempre unidades inconsistentes; activa `check_statics=True` y muestra el balance al usuario.
- Captura excepciones en el endpoint y devuélvelas como JSON `{ "error": "...", "detail": "..." }` con código 400, para que el frontend las muestre.

### 13.4. Rendimiento

- Usa `sparse=True` (default) para modelos grandes.
- `analyze_linear` si no hay no-linealidades (mucho más rápido).
- Para mallas grandes, genera y cachea geometría; envía resultados con `n_points` razonable (p. ej. 20) por barra.
- Considera ejecutar el análisis en una tarea en segundo plano (worker/cola) si los modelos son grandes, y exponer progreso (`log=True` capturando stdout).

### 13.5. Pruebas

- Valida contra los ejemplos de la carpeta `Examples/` (tienen resultados esperados de libros de texto). Úsalos como **tests de regresión** del backend.
- Comprueba el equilibrio con `check_statics=True`.

---

## 14. Checklist y referencias

### Checklist de implementación del frontend

- [ ] Definir y fijar el **sistema de unidades** (UI + conversión única).
- [ ] Esquema JSON del modelo (§11.1) acordado entre front y back.
- [ ] `build_model()` que respeta el orden de dependencias (§11.2).
- [ ] `run_analysis()` con selección de tipo de análisis (§11.3).
- [ ] `serialize_results()` con conversión a tipos JSON (§11.3).
- [ ] Endpoints `/analyze` (+ opcional `/render`) con manejo de errores (§11.4, §13.3).
- [ ] Visor 3D (three.js / R3F) que dibuja modelo + deformada (§11.5).
- [ ] Diagramas por barra a partir de `*_array()` con Plotly/Chart.js.
- [ ] Tablas de reacciones y desplazamientos por combinación.
- [ ] Validaciones previas (§13.2).
- [ ] Tests contra `Examples/` (§13.5).
- [ ] (Opcional) Despliegue sin servidor con Pyodide/WASM y *fallback* a backend (§12).

### Referencias

- Repositorio: <https://github.com/JWock82/PyNite>
- Documentación: <https://pynite.readthedocs.io/en/latest/index.html>
- Ejemplos: <https://github.com/JWock82/Pynite/tree/main/Examples>
- PyPI: `PyNiteFEA` — `pip install PyNiteFEA[all]`
- Soporte/consultoría del autor: Building.Code@outlook.com

---

> **Resumen para el agente**: PyNite = motor FEM 3D en Python, sin UI ni persistencia. Construye un **backend** (FastAPI) que traduzca un **JSON de modelo** a llamadas `FEModel3D`, analice (`analyze`/`analyze_PDelta`/`analyze_linear`/`analyze_modal`) y **serialice resultados** (reacciones y desplazamientos por combinación + arrays de esfuerzos por barra). El **frontend** (React + three.js + Plotly) edita el modelo, lanza el análisis y dibuja deformada y diagramas. Cuida unidades, orden de construcción y direcciones de carga (mayúscula=global, minúscula=local).
