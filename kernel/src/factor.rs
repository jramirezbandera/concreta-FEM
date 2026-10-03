//! LDLᵀ dispersa de una matriz simétrica, sobre faer.
//!
//! Entrada: triángulo superior en CSC (índices u32), sin duplicados. La ordenación es AMD
//! (la de faer) o una permutación dada por el llamador (disección anidada por plantas, E1).
//!
//! El análisis simbólico se hace una vez por patrón; la factorización numérica se puede
//! repetir con valores nuevos sobre el mismo patrón, y la resolución trabaja por bloques
//! de lados derechos (columna a columna, en orden de columnas).

use faer::dyn_stack::{MemBuffer, MemStack, StackReq};
use faer::linalg::cholesky::ldlt::factor::{LdltError, LdltRegularization};
use faer::sparse::linalg::cholesky::{
    factorize_symbolic_cholesky, CholeskySymbolicParams, LdltRef, SymbolicCholesky,
    SymbolicCholeskyRaw, SymmetricOrdering,
};
use faer::sparse::linalg::SupernodalThreshold;
use faer::sparse::{SparseColMatRef, SymbolicSparseColMatRef};
use faer::{Conj, MatMut, Par, Side};

/// Cómo elegir entre la factorización supernodal y la simplicial.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Modo {
    /// Lo decide faer por la relación de flops (por defecto).
    Auto,
    Supernodal,
    Simplicial,
}

#[derive(Debug)]
pub enum Error {
    /// Patrón CSC mal formado (punteros, índices fuera de rango o en el triángulo inferior).
    Patron(String),
    /// Sin memoria para el análisis o la factorización.
    Memoria,
    /// Pivote nulo en la columna `columna` de la matriz original (sin permutar).
    PivoteNulo { columna: usize },
    /// Se pidió resolver sin factorizar antes.
    SinFactorizar,
}

impl core::fmt::Display for Error {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Error::Patron(m) => write!(f, "patrón CSC no válido: {m}"),
            Error::Memoria => write!(f, "sin memoria"),
            Error::PivoteNulo { columna } => write!(f, "pivote nulo en la columna {columna}"),
            Error::SinFactorizar => write!(f, "la matriz no está factorizada"),
        }
    }
}

/// Factorización LDLᵀ con el patrón fijo.
pub struct Factor {
    n: usize,
    col_ptr: Vec<u32>,
    row_idx: Vec<u32>,
    simbolica: SymbolicCholesky<u32>,
    l_valores: Vec<f64>,
    factorizada: bool,
}

/// Comprueba que (col_ptr, row_idx) es un triángulo superior CSC válido y ordenado.
fn validar_patron(n: usize, col_ptr: &[u32], row_idx: &[u32]) -> Result<(), Error> {
    if col_ptr.len() != n + 1 {
        return Err(Error::Patron(format!("col_ptr tiene {} entradas, se esperaban {}", col_ptr.len(), n + 1)));
    }
    if col_ptr[0] != 0 || col_ptr[n] as usize != row_idx.len() {
        return Err(Error::Patron("col_ptr[0] ≠ 0 o col_ptr[n] ≠ nnz".into()));
    }
    for j in 0..n {
        let (a, b) = (col_ptr[j] as usize, col_ptr[j + 1] as usize);
        if a > b {
            return Err(Error::Patron(format!("col_ptr decrece en la columna {j}")));
        }
        let mut previa: i64 = -1;
        for &i in &row_idx[a..b] {
            let i = i as i64;
            if i > j as i64 {
                return Err(Error::Patron(format!("entrada ({i}, {j}) bajo la diagonal")));
            }
            if i <= previa {
                return Err(Error::Patron(format!("índices de fila desordenados o repetidos en la columna {j}")));
            }
            previa = i;
        }
    }
    Ok(())
}

impl Factor {
    /// Análisis simbólico. `perm`: permutación de llenado opcional (perm[k] = columna original
    /// que va en la posición k); si es `None`, AMD.
    pub fn analizar(
        n: usize,
        col_ptr: Vec<u32>,
        row_idx: Vec<u32>,
        perm: Option<&[u32]>,
        modo: Modo,
    ) -> Result<Factor, Error> {
        validar_patron(n, &col_ptr, &row_idx)?;
        let perm_inv: Option<Vec<u32>> = match perm {
            None => None,
            Some(p) => {
                if p.len() != n {
                    return Err(Error::Patron("la permutación no tiene n entradas".into()));
                }
                let mut inv = vec![u32::MAX; n];
                for (k, &c) in p.iter().enumerate() {
                    if c as usize >= n || inv[c as usize] != u32::MAX {
                        return Err(Error::Patron("la permutación no es biyectiva".into()));
                    }
                    inv[c as usize] = k as u32;
                }
                Some(inv)
            }
        };
        let simbolica = {
            let a = SymbolicSparseColMatRef::new_checked(n, n, &col_ptr, None, &row_idx);
            let ord = match (perm, &perm_inv) {
                (Some(p), Some(inv)) => SymmetricOrdering::Custom(faer::perm::PermRef::new_checked(p, inv, n)),
                _ => SymmetricOrdering::Amd,
            };
            let umbral = match modo {
                Modo::Auto => SupernodalThreshold::AUTO,
                Modo::Supernodal => SupernodalThreshold::FORCE_SUPERNODAL,
                Modo::Simplicial => SupernodalThreshold::FORCE_SIMPLICIAL,
            };
            let params = CholeskySymbolicParams {
                supernodal_flop_ratio_threshold: umbral,
                ..Default::default()
            };
            factorize_symbolic_cholesky(a, Side::Upper, ord, params).map_err(|_| Error::Memoria)?
        };
        Ok(Factor { n, col_ptr, row_idx, simbolica, l_valores: Vec::new(), factorizada: false })
    }

    pub fn n(&self) -> usize {
        self.n
    }

    /// Entradas no nulas del triángulo superior de A.
    pub fn nnz_a(&self) -> usize {
        self.row_idx.len()
    }

    /// Valores almacenados del factor (incluye los ceros de la amalgamación de supernodos).
    pub fn nnz_l(&self) -> usize {
        self.simbolica.len_val()
    }

    pub fn es_supernodal(&self) -> bool {
        matches!(self.simbolica.raw(), SymbolicCholeskyRaw::Supernodal(_))
    }

    pub fn n_supernodos(&self) -> usize {
        match self.simbolica.raw() {
            SymbolicCholeskyRaw::Supernodal(s) => s.n_supernodes(),
            SymbolicCholeskyRaw::Simplicial(_) => 0,
        }
    }

    /// Factorización numérica con los valores de A en el patrón del análisis.
    pub fn factorizar(&mut self, valores: &[f64]) -> Result<(), Error> {
        if valores.len() != self.row_idx.len() {
            return Err(Error::Patron(format!(
                "{} valores para un patrón de {} entradas",
                valores.len(),
                self.row_idx.len()
            )));
        }
        self.factorizada = false;
        let len = self.simbolica.len_val();
        if self.l_valores.len() != len {
            self.l_valores = Vec::new();
            self.l_valores.try_reserve_exact(len).map_err(|_| Error::Memoria)?;
            self.l_valores.resize(len, 0.0);
        }
        let a = SparseColMatRef::new(
            SymbolicSparseColMatRef::new_checked(self.n, self.n, &self.col_ptr, None, &self.row_idx),
            valores,
        );
        let par = Par::Seq;
        let req = self.simbolica.factorize_numeric_ldlt_scratch::<f64>(par, Default::default());
        let mut mem = MemBuffer::try_new(req).map_err(|_| Error::Memoria)?;
        let res = self.simbolica.factorize_numeric_ldlt::<f64>(
            &mut self.l_valores,
            a,
            Side::Upper,
            LdltRegularization::default(),
            par,
            MemStack::new(&mut mem),
            Default::default(),
        );
        match res {
            Ok(_) => {
                self.factorizada = true;
                Ok(())
            }
            Err(LdltError::ZeroPivot { index }) => {
                // faer 0.24 da el índice en base 1 en la simplicial y en base 0 en la supernodal.
                let index = if self.es_supernodal() { index } else { index - 1 };
                let columna = match self.simbolica.perm() {
                    Some(p) => p.arrays().0[index] as usize,
                    None => index,
                };
                Err(Error::PivoteNulo { columna })
            }
        }
    }

    /// Resuelve A·X = B en el sitio. `b` tiene `nrhs` columnas de longitud n, en orden de columnas.
    pub fn resolver(&self, b: &mut [f64], nrhs: usize) -> Result<(), Error> {
        if !self.factorizada {
            return Err(Error::SinFactorizar);
        }
        if b.len() != self.n * nrhs {
            return Err(Error::Patron(format!("el bloque tiene {} valores; se esperaban {}", b.len(), self.n * nrhs)));
        }
        let par = Par::Seq;
        let req: StackReq = self.simbolica.solve_in_place_scratch::<f64>(nrhs, par);
        let mut mem = MemBuffer::try_new(req).map_err(|_| Error::Memoria)?;
        let x = MatMut::from_column_major_slice_mut(b, self.n, nrhs);
        LdltRef::new(&self.simbolica, &self.l_valores).solve_in_place_with_conj(
            Conj::No,
            x,
            par,
            MemStack::new(&mut mem),
        );
        Ok(())
    }

    /// Diagonal D de la factorización, en el orden de las columnas originales (sin permutar).
    /// Sirve para la inercia (pivotes negativos) y para detectar mecanismos por pivote pequeño
    /// frente a la diagonal de A (H12).
    pub fn diagonal(&self) -> Result<Vec<f64>, Error> {
        if !self.factorizada {
            return Err(Error::SinFactorizar);
        }
        let n = self.n;
        let mut d_perm = vec![0.0f64; n];
        match self.simbolica.raw() {
            SymbolicCholeskyRaw::Supernodal(s) => {
                let cpv = s.col_ptr_for_val();
                let beg = s.supernode_begin();
                let end = s.supernode_end();
                let nps = s.nnz_per_super();
                for k in 0..s.n_supernodes() {
                    let (a, b) = (beg[k] as usize, end[k] as usize);
                    let ncols = b - a;
                    let nrows = nps[k] as usize + ncols;
                    let base = cpv[k] as usize;
                    for c in 0..ncols {
                        d_perm[a + c] = self.l_valores[base + c * nrows + c];
                    }
                }
            }
            SymbolicCholeskyRaw::Simplicial(s) => {
                let cp = s.col_ptr();
                let ri = s.row_idx();
                for j in 0..n {
                    for p in cp[j] as usize..cp[j + 1] as usize {
                        if ri[p] as usize == j {
                            d_perm[j] = self.l_valores[p];
                            break;
                        }
                    }
                }
            }
        }
        Ok(match self.simbolica.perm() {
            None => d_perm,
            Some(p) => {
                let fwd = p.arrays().0;
                let mut d = vec![0.0f64; n];
                for k in 0..n {
                    d[fwd[k] as usize] = d_perm[k];
                }
                d
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Laplaciano 1D (n×n) + diagonal, en triángulo superior CSC.
    fn laplaciano(n: usize) -> (Vec<u32>, Vec<u32>, Vec<f64>) {
        let (mut cp, mut ri, mut v) = (vec![0u32], vec![], vec![]);
        for j in 0..n {
            if j > 0 {
                ri.push((j - 1) as u32);
                v.push(-1.0);
            }
            ri.push(j as u32);
            v.push(2.5);
            cp.push(ri.len() as u32);
        }
        (cp, ri, v)
    }

    fn producto(n: usize, cp: &[u32], ri: &[u32], v: &[f64], x: &[f64]) -> Vec<f64> {
        let mut y = vec![0.0; n];
        for j in 0..n {
            for p in cp[j] as usize..cp[j + 1] as usize {
                let i = ri[p] as usize;
                y[i] += v[p] * x[j];
                if i != j {
                    y[j] += v[p] * x[i];
                }
            }
        }
        y
    }

    #[test]
    fn resuelve_y_recupera_la_diagonal() {
        for modo in [Modo::Supernodal, Modo::Simplicial, Modo::Auto] {
            let n = 200;
            let (cp, ri, v) = laplaciano(n);
            let mut f = Factor::analizar(n, cp.clone(), ri.clone(), None, modo).unwrap();
            f.factorizar(&v).unwrap();
            let x0: Vec<f64> = (0..2 * n).map(|i| ((i * 37) % 11) as f64 - 5.0).collect();
            let mut b = [producto(n, &cp, &ri, &v, &x0[..n]), producto(n, &cp, &ri, &v, &x0[n..])].concat();
            f.resolver(&mut b, 2).unwrap();
            let err = b.iter().zip(&x0).map(|(a, b)| (a - b).abs()).fold(0.0, f64::max);
            assert!(err < 1e-12, "{modo:?}: error {err}");
            // det(A) = Π d_i y todos positivos (SPD)
            let d = f.diagonal().unwrap();
            assert!(d.iter().all(|&x| x > 0.0), "{modo:?}");
        }
    }

    #[test]
    fn detecta_pivote_nulo() {
        // Matriz singular: dos GDL unidos por un muelle sin apoyo. Sólo detecta pivotes
        // exactamente nulos; los mecanismos reales se diagnostican con `diagonal()`.
        for modo in [Modo::Supernodal, Modo::Simplicial] {
            let cp = vec![0u32, 1, 3];
            let ri = vec![0u32, 0, 1];
            let v = vec![1.0, -1.0, 1.0];
            let mut f = Factor::analizar(2, cp, ri, Some(&[0, 1]), modo).unwrap();
            match f.factorizar(&v) {
                Err(Error::PivoteNulo { columna }) => assert_eq!(columna, 1, "{modo:?}"),
                otro => panic!("{modo:?}: {otro:?}"),
            }
        }
    }

    #[test]
    fn rechaza_patrones_malos() {
        assert!(Factor::analizar(2, vec![0, 1, 2], vec![0, 0], None, Modo::Auto).is_ok());
        assert!(Factor::analizar(2, vec![0, 2, 2], vec![0, 1], None, Modo::Auto).is_err()); // bajo la diagonal
        assert!(Factor::analizar(2, vec![0, 1, 3], vec![0, 1, 0], None, Modo::Auto).is_err()); // desordenado
    }
}
