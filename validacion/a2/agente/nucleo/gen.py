import json
xs=[0,6,12,18]; ys=[0,5,10,15]
pil=[]
for i,x in enumerate(xs):
    for j,y in enumerate(ys):
        pil.append({"id":f"P{x}-{y}","x":x,"y":y,"desde":"C","hasta":"N1","seccion":"P50x50"})
ejeY={0:0.10,5:5,10:10,15:14.90}
ejeX={0:0.10,6:6,12:12,18:17.90}
vig=[]
for y in ys:
    vig.append({"id":f"VX{y}","planta":"N1","puntos":[[-0.25,ejeY[y]],[18.25,ejeY[y]]],"seccion":"V30x50"})
for x in xs:
    vig.append({"id":f"VY{x}","planta":"N1","puntos":[[ejeX[x],-0.25],[ejeX[x],15.25]],"seccion":"V30x50"})
cargas=[{"tipo":"superficie","id":"SU-N1","caso":"Q","planta":"N1","losa":"L-N1","q":[0,0,-3]}]
for y in ys:
    cargas.append({"tipo":"pilar","id":f"V-P0-{y}","caso":"V","pilar":f"P0-{y}","ejes":"global","q":[2,0,0]})
p={"esquema":"concreta-fem/proyecto@1","nombre":"Retícula de una planta con núcleo de muros",
 "modelo":{
  "plantas":[{"id":"N1","altura":None},{"id":"C","tipo":"sotano","altura":1.5}],
  "materiales":[{"id":"HA-25","tipo":"hormigon","fck":25}],
  "secciones":[{"id":"P50x50","material":"HA-25","forma":"rectangular","b":0.5,"h":0.5},
               {"id":"V30x50","material":"HA-25","forma":"rectangular","b":0.3,"h":0.5}],
  "pilares":pil,"vigas":vig,
  "losas":[{"id":"L-N1","planta":"N1","contorno":[[-0.25,-0.25],[18.25,-0.25],[18.25,15.25],[-0.25,15.25]],
            "huecos":[[[6.6,5.4],[11.4,5.4],[11.4,9.6],[6.6,9.6]]],"espesor":0.22,"material":"HA-25"}],
  "muros":[{"id":"NUCLEO","puntos":[[6,5],[12,5],[12,10],[6,10],[6,5]],"desde":"C","hasta":"N1","espesor":0.25,
            "material":"HA-25","base":"empotrado","huecos":[{"desde":2.4,"hasta":3.4,"z0":0,"z1":1.2}]}],
  "casos":[{"id":"G","pesoPropio":True},{"id":"Q"},{"id":"V"}],
  "cargas":cargas},
 "opciones":{"tamanoMalla":1}}
with open("proyecto.json","w",encoding="utf-8",newline="") as f: json.dump(p,f,ensure_ascii=False,indent=2)
