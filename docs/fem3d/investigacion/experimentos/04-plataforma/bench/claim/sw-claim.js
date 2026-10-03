// SW mínimo: se activa ya y reclama los clientes; intercepta /dato.txt
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (new URL(e.request.url).pathname.endsWith("/dato.txt")) e.respondWith(new Response("INTERCEPTADO"));
});
