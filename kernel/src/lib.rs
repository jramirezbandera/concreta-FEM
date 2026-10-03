//! Núcleo numérico del motor FEM 3D de Concreta.
//!
//! Sólo hace una cosa: factorizar en LDLᵀ dispersa (supernodal, con faer) la K reducida
//! que ensambla el motor en TypeScript, y resolver bloques de lados derechos.
//! Todo lo demás (elementos, restricciones, ensamblado, esfuerzos) vive en TypeScript.
//!
//! API WASM (`Nucleo`), sin copias para los arrays grandes:
//! 1. `new Nucleo(n, colPtr, rowIdx, perm?, modo)`: análisis simbólico (triángulo superior CSC).
//! 2. `valoresPtr()`: vista en la memoria WASM donde JS escribe los valores de K.
//! 3. `factorizar()`: LDLᵀ numérica.
//! 4. `ladosPtr(nrhs)` + `resolver(nrhs)`: lados derechos en orden de columnas, en el sitio.
//! 5. `diagonal()` y `estadisticas()`: pivotes e información del factor.

pub mod factor;

#[cfg(target_arch = "wasm32")]
mod wasm {
    use crate::factor::{Factor, Modo};
    use wasm_bindgen::prelude::*;

    /// Versión de la API; el envoltorio TS la comprueba al cargar el módulo.
    #[wasm_bindgen(js_name = versionApi)]
    pub fn version_api() -> u32 {
        1
    }

    /// Memoria lineal del módulo, para construir vistas sobre `valoresPtr()` y `ladosPtr()`.
    #[wasm_bindgen(js_name = memoria)]
    pub fn memoria() -> JsValue {
        wasm_bindgen::memory()
    }

    #[wasm_bindgen]
    pub struct Nucleo {
        factor: Factor,
        valores: Vec<f64>,
        lados: Vec<f64>,
    }

    fn error(e: crate::factor::Error) -> JsError {
        JsError::new(&e.to_string())
    }

    #[wasm_bindgen]
    impl Nucleo {
        /// `modo`: 0 = automático, 1 = supernodal, 2 = simplicial.
        #[wasm_bindgen(constructor)]
        pub fn new(
            n: u32,
            col_ptr: Vec<u32>,
            row_idx: Vec<u32>,
            perm: Option<Vec<u32>>,
            modo: u8,
        ) -> Result<Nucleo, JsError> {
            let modo = match modo {
                1 => Modo::Supernodal,
                2 => Modo::Simplicial,
                _ => Modo::Auto,
            };
            let nnz = row_idx.len();
            let factor = Factor::analizar(n as usize, col_ptr, row_idx, perm.as_deref(), modo).map_err(error)?;
            let mut valores = Vec::new();
            valores.try_reserve_exact(nnz).map_err(|_| JsError::new("sin memoria"))?;
            valores.resize(nnz, 0.0);
            Ok(Nucleo { factor, valores, lados: Vec::new() })
        }

        /// Dirección (en bytes) de los `nnz` valores de K en la memoria WASM.
        #[wasm_bindgen(js_name = valoresPtr)]
        pub fn valores_ptr(&mut self) -> usize {
            self.valores.as_mut_ptr() as usize
        }

        pub fn factorizar(&mut self) -> Result<(), JsError> {
            self.factor.factorizar(&self.valores).map_err(error)
        }

        /// Reserva n·nrhs valores para los lados derechos y devuelve su dirección.
        /// La dirección puede cambiar en cada llamada (y si la memoria crece): JS rehace la vista.
        #[wasm_bindgen(js_name = ladosPtr)]
        pub fn lados_ptr(&mut self, nrhs: u32) -> Result<usize, JsError> {
            let len = self.factor.n() * nrhs as usize;
            if self.lados.len() != len {
                self.lados = Vec::new();
                self.lados.try_reserve_exact(len).map_err(|_| JsError::new("sin memoria"))?;
                self.lados.resize(len, 0.0);
            }
            Ok(self.lados.as_mut_ptr() as usize)
        }

        pub fn resolver(&mut self, nrhs: u32) -> Result<(), JsError> {
            self.factor.resolver(&mut self.lados, nrhs as usize).map_err(error)
        }

        pub fn diagonal(&self) -> Result<Vec<f64>, JsError> {
            self.factor.diagonal().map_err(error)
        }

        /// [n, nnz(A superior), nnz(L), supernodal (0/1), nº de supernodos]
        pub fn estadisticas(&self) -> Vec<f64> {
            vec![
                self.factor.n() as f64,
                self.factor.nnz_a() as f64,
                self.factor.nnz_l() as f64,
                if self.factor.es_supernodal() { 1.0 } else { 0.0 },
                self.factor.n_supernodos() as f64,
            ]
        }
    }
}
