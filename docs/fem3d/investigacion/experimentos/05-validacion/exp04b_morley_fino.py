from exp04_esviada import morley
for n in (24, 48, 64):
    v, nw = morley(n, "Quad")
    print(f"Quad {n}x{n}: w_c = {v:.4f} ({(v/4.455-1)*100:+.2f} %)", flush=True)
