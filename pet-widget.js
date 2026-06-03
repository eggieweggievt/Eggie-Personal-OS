/* =====================================================================
   pet-widget.js  —  a draggable / throwable animated sprite-sheet pet
   with an attached AI chat. Vanilla JS, zero dependencies.

   It paces along the bottom of the screen, can be picked up and THROWN
   (gravity + bounce), sits/idles, shows greeting bubbles, and opens a
   chat box anchored to itself. Bring your own sprite sheet + AI.

   QUICK START:
     <script src="pet-widget.js"></script>
     <script>
       PetWidget.init({
         sheet: "fox.png", sheetW: 164, sheetH: 210,
         walk: [ {x:6,y:52,w:35,h:32},{x:44,y:53,w:38,h:31},
                 {x:88,y:52,w:35,h:32},{x:130,y:53,w:34,h:31} ],
         sit:  {x:6,y:10,w:35,h:32},
         scale: 2.1, faces: "right",
         avatar: "Kiko Sit.png",         // round chat-header icon (optional)
         title: "Kiko", subtitle: "your snowfox helper",
         ask: async (q) => {             // wire your own backend here
           const r = await fetch("/api/ask", {method:"POST", body: JSON.stringify({q})});
           return (await r.json()).answer;
         }
       });
     </script>

   Don't know your frame rectangles? Run, in the browser console, on a page
   served from the SAME ORIGIN as your sheet:
       PetWidget.measure("fox.png").then(r => console.log(JSON.stringify(r)))
   It prints the sheet size and the sprite boxes per row. The row with your
   walk frames becomes `walk`; a single isolated frame becomes `sit`.
   ===================================================================== */
(function (global) {
  "use strict";

  function injectCSS(c) {
    if (document.getElementById("pet-widget-css")) return;
    var s = document.createElement("style");
    s.id = "pet-widget-css";
    s.textContent = `
    #pet{position:fixed;bottom:14px;left:90px;z-index:9991;cursor:grab;touch-action:none;user-select:none;filter:drop-shadow(0 5px 7px rgba(80,70,110,.4));}
    #pet:active{cursor:grabbing;}
    #pet .pet-sprite{pointer-events:none;${c.smooth ? "" : "image-rendering:pixelated;"}}
    #petBubble{position:fixed;left:90px;bottom:92px;z-index:9991;max-width:200px;background:#fff;border:1px solid #e4e6f5;border-radius:14px;border-bottom-left-radius:4px;padding:8px 12px;font-size:12.5px;color:#3a3550;box-shadow:0 6px 22px rgba(120,130,200,.18);cursor:pointer;font-family:${c.font};}
    #petChat{position:fixed;left:90px;bottom:120px;z-index:9994;width:310px;max-width:calc(100vw - 36px);height:440px;max-height:74vh;background:#fff;border:1px solid #e4e6f5;border-radius:18px;box-shadow:0 16px 42px rgba(120,110,160,.32);display:flex;flex-direction:column;overflow:hidden;font-family:${c.font};}
    #petChat.pet-hidden,#petBubble.pet-hidden{display:none!important;}
    .pet-head{display:flex;align-items:center;gap:9px;padding:10px 12px;border-bottom:1px solid #e4e6f5;background:linear-gradient(120deg,${c.accentFrom}22,${c.accentTo}22);}
    .pet-av{width:36px;height:36px;border-radius:999px;border:1px solid #e4e6f5;flex:0 0 auto;background:${c.avatar ? '#eef2fb center/cover no-repeat url("' + encodeURI(c.avatar) + '")' : 'linear-gradient(135deg,' + c.accentFrom + ',' + c.accentTo + ')'};display:grid;place-items:center;font-size:18px;color:#fff;}
    .pet-title{font-weight:700;font-size:14px;color:#3a3550;}
    .pet-sub{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#9b96b6;font-weight:700;}
    .pet-x{margin-left:auto;border:none;background:none;font-size:15px;color:#9b96b6;cursor:pointer;}
    .pet-log{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px;}
    .pet-msg{font-size:12.5px;line-height:1.45;padding:8px 11px;border-radius:14px;max-width:86%;white-space:pre-wrap;word-break:break-word;}
    .pet-msg.me{align-self:flex-end;background:linear-gradient(135deg,${c.accentFrom},${c.accentTo});color:#fff;border-bottom-right-radius:4px;}
    .pet-msg.pet{align-self:flex-start;background:#f6f8ff;border:1px solid #e4e6f5;color:#3a3550;border-bottom-left-radius:4px;}
    .pet-input{display:flex;gap:6px;padding:10px;border-top:1px solid #e4e6f5;}
    .pet-input input{flex:1;border:1.5px solid #dde0f1;border-radius:12px;padding:9px 12px;font:inherit;font-size:13px;color:#3a3550;outline:none;}
    .pet-input button{border:none;border-radius:12px;padding:8px 14px;font:inherit;font-weight:700;font-size:13px;color:#fff;cursor:pointer;background:linear-gradient(135deg,${c.accentFrom},${c.accentTo});}
    `;
    document.head.appendChild(s);
  }

  /* -------- frame measuring helper (dev tool) -------- */
  function measure(url) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        try {
          var W = img.naturalWidth, H = img.naturalHeight;
          var cv = document.createElement("canvas"); cv.width = W; cv.height = H;
          var ctx = cv.getContext("2d"); ctx.drawImage(img, 0, 0);
          var d = ctx.getImageData(0, 0, W, H).data;
          function a(x, y) { return d[(y * W + x) * 4 + 3]; }
          function bands(o) { var b = [], s = -1; for (var i = 0; i < o.length; i++) { if (o[i] && s < 0) s = i; else if (!o[i] && s >= 0) { b.push([s, i - 1]); s = -1; } } if (s >= 0) b.push([s, o.length - 1]); return b; }
          var rowOcc = []; for (var y = 0; y < H; y++) { var o = false; for (var x = 0; x < W; x++) { if (a(x, y) > 25) { o = true; break; } } rowOcc.push(o); }
          var rows = bands(rowOcc).map(function (r) {
            var y0 = r[0], y1 = r[1], co = [];
            for (var x = 0; x < W; x++) { var oc = false; for (var y = y0; y <= y1; y++) { if (a(x, y) > 25) { oc = true; break; } } co.push(oc); }
            var frames = bands(co).map(function (c) {
              var x0 = c[0], x1 = c[1], fy0 = H, fy1 = 0;
              for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) if (a(x, y) > 25) { if (y < fy0) fy0 = y; if (y > fy1) fy1 = y; }
              return { x: x0, y: fy0, w: x1 - x0 + 1, h: fy1 - fy0 + 1 };
            });
            return frames;
          });
          resolve({ sheetW: W, sheetH: H, rows: rows });
        } catch (e) { resolve({ error: e.message + " (canvas may be tainted — load the sheet from the same origin)" }); }
      };
      img.onerror = function () { resolve({ error: "could not load " + url }); };
      img.src = url;
    });
  }

  function init(cfg) {
    var c = Object.assign({
      sheet: "sprite.png", sheetW: 0, sheetH: 0,
      walk: [], sit: null, scale: 2, faces: "right",
      speed: 44, frameMs: 150,
      leftClear: 72, rightClear: 72,           // px kept clear of left/right edges (room for your corner buttons)
      greetings: ["Hi!"], greetEveryMs: 45000, greetDelayMs: 3000,
      title: "Pet", subtitle: "your helper",
      accentFrom: "#758ac6", accentTo: "#ff9ed8",
      font: "system-ui,sans-serif",
      avatar: null, smooth: false,
      ask: async function (q) { return "Connect an AI by passing an `ask(question)` function to PetWidget.init. ✨"; },
      reduceMotion: function () { try { return matchMedia("(prefers-reduced-motion:reduce)").matches; } catch (e) { return false; } },
    }, cfg || {});
    if (!c.sit) c.sit = c.walk[0] || { x: 0, y: 0, w: 32, h: 32 };

    injectCSS(c);

    var SPRW = Math.round((Math.max.apply(null, c.walk.concat([c.sit]).map(function (f) { return f.w; })) || 32) * c.scale);
    var SPRH = Math.round((c.sit.h || 32) * c.scale);

    // DOM
    var pet = document.createElement("div"); pet.id = "pet"; pet.title = c.title + " — drag to throw!";
    var sprite = document.createElement("div"); sprite.className = "pet-sprite"; pet.appendChild(sprite);
    var bubble = document.createElement("div"); bubble.id = "petBubble"; bubble.className = "pet-hidden";
    var chat = document.createElement("div"); chat.id = "petChat"; chat.className = "pet-hidden";
    document.body.appendChild(pet); document.body.appendChild(bubble); document.body.appendChild(chat);

    var S = { open: false, busy: false, log: [], raf: null, x: null, y: 0, vx: 0, vy: 0, dir: 1, fi: 0, ft: 0, st: "walk", stt: 0, last: 0 };

    function setFrame(f) {
      var s = c.scale;
      sprite.style.backgroundImage = "url('" + encodeURI(c.sheet) + "')";
      sprite.style.backgroundRepeat = "no-repeat";
      sprite.style.width = (f.w * s) + "px"; sprite.style.height = (f.h * s) + "px";
      sprite.style.backgroundSize = (c.sheetW * s) + "px " + (c.sheetH * s) + "px";
      sprite.style.backgroundPosition = "-" + (f.x * s).toFixed(1) + "px -" + (f.y * s).toFixed(1) + "px";
    }
    function facing() { var flip = (c.faces === "right") ? (S.dir < 0) : (S.dir > 0); return flip ? "scaleX(-1)" : "scaleX(1)"; }
    function bounds() { return { min: c.leftClear, max: Math.max(c.leftClear + 10, innerWidth - c.rightClear - SPRW) }; }
    function positionUI() {
      pet.style.left = Math.round(S.x) + "px"; pet.style.bottom = Math.round(14 + S.y) + "px";
      var topY = Math.round(14 + S.y + SPRH + 8);
      if (!chat.classList.contains("pet-hidden")) {
        var cw = Math.min(310, innerWidth - 16);
        var cl = Math.max(8, Math.min(Math.round(S.x - cw / 2 + SPRW / 2), innerWidth - cw - 8));
        chat.style.left = cl + "px"; chat.style.right = "auto"; chat.style.bottom = topY + "px";
      }
      if (!bubble.classList.contains("pet-hidden")) {
        var bl = Math.max(8, Math.min(Math.round(S.x - 8), innerWidth - 210));
        bubble.style.left = bl + "px"; bubble.style.right = "auto"; bubble.style.bottom = topY + "px";
      }
    }
    function step(now) {
      var dt = Math.min(60, now - (S.last || now)); S.last = now;
      if (S.x == null) S.x = 100;
      if (S.st === "held" || S.open) { setFrame(c.sit); sprite.style.transform = facing(); positionUI(); S.raf = requestAnimationFrame(step); return; }
      if (S.st === "thrown") {
        S.vy -= 2400 * dt / 1000; S.y += S.vy * dt / 1000; S.x += S.vx * dt / 1000;
        var maxX = innerWidth - SPRW;
        if (S.x < 0) { S.x = 0; S.vx = -S.vx * 0.55; } else if (S.x > maxX) { S.x = maxX; S.vx = -S.vx * 0.55; }
        var topMax = innerHeight - SPRH - 20; if (S.y > topMax) { S.y = topMax; S.vy = -S.vy * 0.4; }
        if (S.y <= 0) {
          S.y = 0;
          if (Math.abs(S.vy) < 150) { S.vy = 0; S.vx *= 0.55; if (Math.abs(S.vx) < 30) { var b = bounds(); S.x = Math.max(b.min, Math.min(S.x, b.max)); S.st = "walk"; S.stt = 0; } }
          else { S.vy = -S.vy * 0.5; S.vx *= 0.8; }
        }
        setFrame(c.sit); sprite.style.transform = (S.vx < 0 ? "scaleX(-1)" : "scaleX(1)"); positionUI(); S.raf = requestAnimationFrame(step); return;
      }
      if (c.reduceMotion()) { setFrame(c.sit); sprite.style.transform = facing(); positionUI(); S.raf = requestAnimationFrame(step); return; }
      var b2 = bounds(); S.stt += dt;
      if (S.st === "walk") {
        S.x += S.dir * c.speed * dt / 1000;
        if (S.x <= b2.min) { S.x = b2.min; S.dir = 1; } else if (S.x >= b2.max) { S.x = b2.max; S.dir = -1; }
        S.ft += dt; if (S.ft >= c.frameMs) { S.ft = 0; S.fi = (S.fi + 1) % c.walk.length; }
        setFrame(c.walk[S.fi] || c.sit); sprite.style.transform = facing();
        if (S.stt > 4500 + Math.random() * 4000) { S.st = "sit"; S.stt = 0; }
      } else {
        setFrame(c.sit); sprite.style.transform = facing();
        if (S.stt > 1800 + Math.random() * 2200) { S.st = "walk"; S.stt = 0; }
      }
      positionUI(); S.raf = requestAnimationFrame(step);
    }
    function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]; }); }
    function paintChat() {
      var logHtml = S.log.length
        ? S.log.map(function (m) { return '<div class="pet-msg ' + m.role + '">' + esc(m.text) + "</div>"; }).join("")
        : '<div class="pet-msg pet">Hi! Ask me anything. ✨</div>';
      chat.innerHTML =
        '<div class="pet-head"><div class="pet-av"></div><div style="flex:1"><div class="pet-title">' + esc(c.title) + '</div><div class="pet-sub">' + esc(c.subtitle) + '</div></div><button class="pet-x" data-close>✕</button></div>' +
        '<div class="pet-log" id="petLog">' + logHtml + (S.busy ? '<div class="pet-msg pet">…thinking</div>' : "") + "</div>" +
        '<div class="pet-input"><input id="petInput" placeholder="ask…" ' + (S.busy ? "disabled" : "") + '><button data-send ' + (S.busy ? "disabled" : "") + ">send</button></div>";
      chat.querySelector("[data-close]").onclick = toggle;
      chat.querySelector("[data-send]").onclick = send;
      var input = chat.querySelector("#petInput");
      input.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); send(); } };
      var lg = chat.querySelector("#petLog"); if (lg) lg.scrollTop = lg.scrollHeight;
      if (!S.busy) try { input.focus(); } catch (e) { }
    }
    async function send() {
      var input = chat.querySelector("#petInput"); var q = (input ? input.value : "").trim();
      if (!q || S.busy) return;
      S.log.push({ role: "me", text: q }); S.busy = true; paintChat();
      var ans;
      try { ans = await c.ask(q); ans = ans || "hmm, ask me again?"; }
      catch (e) { ans = "aw, I couldn't reach the server — " + (e.message || "try again"); }
      S.log.push({ role: "pet", text: ans }); S.busy = false; paintChat();
    }
    function toggle() {
      S.open = !S.open;
      if (S.open) { bubble.classList.add("pet-hidden"); S.st = "sit"; S.stt = 0; chat.classList.remove("pet-hidden"); paintChat(); positionUI(); }
      else { chat.classList.add("pet-hidden"); S.st = "walk"; S.stt = 0; }
    }
    function greet() {
      if (S.open) return;
      bubble.textContent = c.greetings[Math.floor(Math.random() * c.greetings.length)];
      bubble.classList.remove("pet-hidden"); positionUI();
      clearTimeout(bubble._h); bubble._h = setTimeout(function () { bubble.classList.add("pet-hidden"); }, 5500);
    }
    bubble.onclick = toggle;

    // drag + throw
    (function () {
      var down = false, moved = false, sx = 0, sy = 0, gox = 0, goy = 0, samp = [];
      pet.addEventListener("pointerdown", function (e) {
        down = true; moved = false; sx = e.clientX; sy = e.clientY; samp = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
        if (S.x == null) S.x = 100; var topScreen = innerHeight - (14 + S.y) - SPRH; gox = e.clientX - S.x; goy = e.clientY - topScreen;
        S.st = "held"; try { pet.setPointerCapture(e.pointerId); } catch (er) { } e.preventDefault();
      });
      pet.addEventListener("pointermove", function (e) {
        if (!down) return; if (Math.abs(e.clientX - sx) > 4 || Math.abs(e.clientY - sy) > 4) moved = true;
        S.x = Math.max(0, Math.min(e.clientX - gox, innerWidth - SPRW));
        S.y = Math.max(0, innerHeight - (e.clientY - goy) - SPRH - 14);
        samp.push({ x: e.clientX, y: e.clientY, t: performance.now() }); if (samp.length > 5) samp.shift(); positionUI();
      });
      function end(e) {
        if (!down) return; down = false; try { pet.releasePointerCapture(e.pointerId); } catch (er) { }
        if (!moved) { S.st = "sit"; toggle(); return; }
        var a = samp[0], z = samp[samp.length - 1], d = Math.max(16, z.t - a.t);
        S.vx = (z.x - a.x) / d * 1000; S.vy = -(z.y - a.y) / d * 1000; S.st = "thrown";
      }
      pet.addEventListener("pointerup", end); pet.addEventListener("pointercancel", end);
    })();

    S.last = performance.now(); S.raf = requestAnimationFrame(step);
    setTimeout(greet, c.greetDelayMs); if (c.greetEveryMs) setInterval(greet, c.greetEveryMs);

    return { open: function () { if (!S.open) toggle(); }, close: function () { if (S.open) toggle(); }, state: S };
  }

  global.PetWidget = { init: init, measure: measure };
})(window);
