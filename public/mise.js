/*!
 * Mise picker for other tools. https://app.misedam.com/help/integrations
 *
 *   <script src="https://app.misedam.com/mise.js"></script>
 *
 *   // A pop-over window inside your page. Resolves with the picked assets ([] if cancelled).
 *   Mise.pick({ key: 'mpk_…', multiple: true }).then(function (assets) { … });
 *
 *   // Or inside an element of your own, staying open:
 *   var picker = Mise.embed(document.getElementById('dam'), { key: 'mpk_…', onSelect: function (assets) { … } });
 *   picker.destroy();
 *
 * Options: key (required), multiple (default false), types (['image','logo','product','video']),
 * mode ('modal' default, or 'popup' for a separate window).
 * Each asset: { id, name, type, mime, width, height, alt, description, tags, url, email_url,
 *               thumbnail_url, product, brand }. url is a permanent link to the current version.
 */
(function () {
  'use strict';
  var script = document.currentScript;
  var BASE = script && script.src ? new URL(script.src).origin : 'https://app.misedam.com';

  function pickerUrl(o) {
    if (!o || !o.key) throw new Error('Mise: pass your integration key, e.g. Mise.pick({ key: "mpk_…" })');
    var p = new URLSearchParams({ key: o.key });
    if (o.multiple) p.set('multiple', '1');
    if (o.types) p.set('types', [].concat(o.types).join(','));
    return BASE + '/picker?' + p.toString();
  }

  // Listen to one picker window. Says hello until the picker answers, so it knows which page it's on.
  function connect(getWin, o, done) {
    var ready = false, tries = 0;
    var hello = setInterval(function () {
      var w = getWin();
      if (ready || !w || tries++ > 40) { clearInterval(hello); return; }
      try { w.postMessage({ type: 'mise:hello' }, BASE); } catch (e) {}
    }, 250);
    function onMessage(e) {
      if (e.origin !== BASE || e.source !== getWin()) return;
      var d = e.data || {};
      if (d.source !== 'mise') return;
      if (d.type === 'mise:ready') { ready = true; if (o.onReady) o.onReady(); }
      else if (d.type === 'mise:select') { if (o.onSelect) o.onSelect(d.assets || []); if (done) done(d.assets || []); }
      else if (d.type === 'mise:cancel') { if (o.onCancel) o.onCancel(); if (done) done(null); }
    }
    window.addEventListener('message', onMessage);
    return function () { clearInterval(hello); window.removeEventListener('message', onMessage); };
  }

  function frame(src) {
    var f = document.createElement('iframe');
    f.src = src;
    f.title = 'Pick from Mise';
    f.allow = 'clipboard-write';
    f.style.cssText = 'border:0;width:100%;height:100%;display:block;background:#fff';
    return f;
  }

  function embed(el, o) {
    o = o || {};
    var f = frame(pickerUrl(o));
    el.appendChild(f);
    var stop = connect(function () { return f.contentWindow; }, o);
    return { iframe: f, destroy: function () { stop(); if (f.parentNode) f.parentNode.removeChild(f); } };
  }

  function pick(o) {
    o = o || {};
    return new Promise(function (resolve) {
      if (o.mode === 'popup') {
        var w = window.open(pickerUrl(o), 'mise-picker', 'width=980,height=720');
        if (!w) { resolve([]); return; }
        var stopP = connect(function () { return w; }, o, function (assets) { stopP(); clearInterval(shut); try { w.close(); } catch (e) {} resolve(assets || []); });
        var shut = setInterval(function () { if (w.closed) { clearInterval(shut); stopP(); resolve([]); } }, 500);
        return;
      }
      var wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(42,26,20,.35);display:flex;align-items:center;justify-content:center;padding:24px';
      var box = document.createElement('div');
      box.style.cssText = 'width:min(980px,100%);height:min(720px,100%);border-radius:14px;overflow:hidden;box-shadow:0 24px 60px -20px rgba(0,0,0,.4);background:#fff';
      var f = frame(pickerUrl(o));
      box.appendChild(f); wrap.appendChild(box); document.body.appendChild(wrap);
      function close(assets) { stop(); document.removeEventListener('keydown', esc); if (wrap.parentNode) wrap.parentNode.removeChild(wrap); resolve(assets || []); }
      function esc(e) { if (e.key === 'Escape') close(null); }
      var stop = connect(function () { return f.contentWindow; }, o, close);
      wrap.addEventListener('mousedown', function (e) { if (e.target === wrap) close(null); });
      document.addEventListener('keydown', esc);
    });
  }

  window.Mise = { pick: pick, embed: embed, pickerUrl: pickerUrl, origin: BASE };
})();
