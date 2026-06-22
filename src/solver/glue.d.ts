// Declaracion del import `?raw` de Vite para el glue Python. Permite cargar el
// fuente de pynite_glue.py como string en build (sin ejecutarlo en JS) y pasarlo
// a pyodide.runPythonAsync(). Aislado en /src/solver (CLAUDE.md §8).
declare module "*.py?raw" {
  const source: string;
  export default source;
}
