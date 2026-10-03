// Worker creado ANTES de que el SW reclame la página: ¿sus fetch pasan por el SW?
self.onmessage = async () => {
  const r = await fetch("./dato.txt?t=" + Date.now());
  self.postMessage((await r.text()).trim());
};
