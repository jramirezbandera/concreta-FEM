# Espesor equivalente de placa isótropa para las tipologías reticulares de
# src/data/forjadoTipologias.ts (sección en T bruta por intereje, sin cartabones).
# t_eq,I = (12·I/intereje)^(1/3) ; t_eq,A = A/intereje (peso/membrana).
T = [("25+5",300,50,120,820),("30+5",350,50,120,820),("35+5",400,50,120,820),("40+5",450,50,120,820),("35+10",450,100,120,820)]
print("tipo  h  I_T(cm4)  t_eqI(mm)  t_eqA(mm)  I/I_maciza  pp_ρ·t_eqA(kN/m2)")
for k,h,hf,bw,s in T:
    A1=s*hf; y1=h-hf/2; A2=bw*(h-hf); y2=(h-hf)/2
    A=A1+A2; yc=(A1*y1+A2*y2)/A
    I=s*hf**3/12+A1*(y1-yc)**2+bw*(h-hf)**3/12+A2*(y2-yc)**2
    teqI=(12*I/s)**(1/3); teqA=A/s
    print(f"{k:6}{h:4} {I/1e4:9.0f} {teqI:9.1f} {teqA:9.1f} {I/(s*h**3/12):10.3f} {25*teqA/1000:8.2f}")
