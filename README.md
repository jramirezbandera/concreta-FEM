# Concreta FEM 3D

Motor de cálculo por elementos finitos 3D para edificios. Se desarrolla para integrarlo después en Concreta, donde sus resultados alimentarán los módulos de comprobación.

- **Estado:** spike E0 y fase E1 (núcleo del motor: GDL, restricciones, ensamblado, diagnósticos y equilibrio) superados ([spike-e0.md](docs/fem3d/spike-e0.md), [fase-e1.md](docs/fem3d/fase-e1.md)); lo siguiente es E2, las barras.
- **Arquitectura prevista:**
  - en TypeScript: elementos (lámina DKMQ24, barra de Timoshenko), restricciones por transformación, ensamblado y recuperación de esfuerzos;
  - en un núcleo Rust con `faer` compilado a WebAssembly: la factorización LDLᵀ supernodal.
- **Unidades:** kN y m.
- **Uso:** `bun install`, `bun run test:run` y `bun run nucleo:verificar` (el último necesita Rust; los tests, no).
- **Documentos:**
  - [docs/fem3d/investigacion-id.md](docs/fem3d/investigacion-id.md): investigación de I+D con índice. Se lee primero el índice y luego sólo la sección que haga falta;
  - [docs/fem3d/diseno-tecnico.md](docs/fem3d/diseno-tecnico.md): diseño técnico v0.1;
  - [docs/fem3d/spike-e0.md](docs/fem3d/spike-e0.md): resultado del spike E0;
  - [docs/fem3d/fase-e1.md](docs/fem3d/fase-e1.md): resultado de la fase E1 (núcleo del motor).

Repositorio privado. Todos los derechos reservados.
