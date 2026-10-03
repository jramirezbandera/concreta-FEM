import time, json, numpy as np, os
from cvxopt import matrix, blas, lapack
res = {'coretype': os.environ.get('OPENBLAS_CORETYPE', 'auto')}
for n in (1000, 2000):
    A = matrix(np.random.default_rng(0).standard_normal((n, n)))
    C = matrix(0.0, (n, n))
    t = time.perf_counter(); blas.gemm(A, A, C); dt = time.perf_counter() - t
    res[f'cvxopt_dgemm_{n}'] = round(2*n**3/dt/1e9, 2)
    S = matrix(np.asarray(A) @ np.asarray(A).T + n*np.eye(n))
    t = time.perf_counter(); lapack.potrf(S); dt = time.perf_counter() - t
    res[f'cvxopt_potrf_{n}'] = round(n**3/3/dt/1e9, 2)
print(json.dumps(res))
