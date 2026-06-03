/* Eggie OS service worker — receives web pushes from the "reminders" Edge Function
   and shows them even when the OS tab (or whole browser window) is closed. 🐙⏰ */
self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "🐙 Eugene", {
    body: d.body || "psst — you asked me to remind you 💗",
    icon: d.icon || "pet-widget/Screenshot 2026-06-02 202234.png",
    data: { url: d.url || "./" },
    tag: d.tag || "eggie-reminder",
    renotify: true,
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ("focus" in c) return c.focus(); }
    return self.clients.openWindow((e.notification.data && e.notification.data.url) || "./");
  }));
});
