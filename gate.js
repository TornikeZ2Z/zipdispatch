/* Zip To Zip — sign-in gate.
   Blanks the page until a @ziptozipmoving.com Google account signs in.
   Client-side soft gate (GitHub Pages = static hosting; the underlying sheets stay public).
   Reuses the apps' existing Google OAuth client. Include early in <head>:  <script src="gate.js"></script>  */
(function () {
  var DOMAIN = 'ziptozipmoving.com';
  var CLIENT_ID = '712386117874-epqesoppk5fftq0j2gpp7becbk7cu72q.apps.googleusercontent.com';
  var KEY = 'ztz_gate_v1', TTL = 12 * 60 * 60 * 1000; // 12h
  function endsAt(email) { return typeof email === 'string' && email.toLowerCase().slice(-(DOMAIN.length + 1)) === '@' + DOMAIN; }
  function valid(a) { return a && a.exp > Date.now() && endsAt(a.email); }
  try { if (valid(JSON.parse(localStorage.getItem(KEY) || 'null'))) return; } catch (e) {}

  var css =
    'html.ztzlock body>*:not(#ztzgate){visibility:hidden!important}' +
    '#ztzgate{position:fixed;inset:0;z-index:2147483647;background:#F7F6F2;display:flex;align-items:center;justify-content:center;padding:20px;font-family:Inter,system-ui,sans-serif}' +
    '#ztzgate .gc{background:#fff;border:1px solid #E6E4DC;border-radius:18px;padding:42px 38px;max-width:400px;width:100%;text-align:center;box-shadow:0 24px 60px rgba(31,35,41,.14)}' +
    '#ztzgate .glogo{height:38px;margin-bottom:18px}' +
    '#ztzgate h1{font-family:"Barlow Condensed",Inter,sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.05em;font-size:25px;color:#1F2329;margin:0 0 8px}' +
    '#ztzgate p{color:#646B73;font-size:14px;line-height:1.5;margin:0 0 24px}' +
    '#ztzgate p b{color:#1F2329}' +
    '#ztzgate .gbtn{display:flex;justify-content:center;min-height:44px}' +
    '#ztzgate .gerr{color:#C0392B;font-size:13px;line-height:1.45;margin-top:18px;min-height:16px}';
  var st = document.createElement('style'); st.textContent = css; document.documentElement.appendChild(st);
  document.documentElement.classList.add('ztzlock');

  function dec(jwt) { try { return JSON.parse(decodeURIComponent(escape(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); } catch (e) { return null; } }
  function mount() {
    if (document.getElementById('ztzgate')) return;
    var g = document.createElement('div'); g.id = 'ztzgate';
    g.innerHTML = '<div class="gc"><img class="glogo" src="logo.png" alt="Zip To Zip" onerror="this.style.display=\'none\'">' +
      '<h1>Zip To Zip Operations</h1>' +
      '<p>Internal tools. Sign in with your <b>@' + DOMAIN + '</b> Google account to continue.</p>' +
      '<div class="gbtn" id="ztzbtn"></div><div class="gerr" id="ztzerr"></div></div>';
    (document.body || document.documentElement).appendChild(g);
  }
  function cb(resp) {
    var c = dec(resp && resp.credential), e = document.getElementById('ztzerr');
    var email = c && c.email ? String(c.email).toLowerCase() : '';
    var hd = c && c.hd ? String(c.hd).toLowerCase() : '';
    if (c && (hd === DOMAIN || endsAt(email))) {
      try { localStorage.setItem(KEY, JSON.stringify({ email: email, exp: Date.now() + TTL })); } catch (x) {}
      document.documentElement.classList.remove('ztzlock');
      var g = document.getElementById('ztzgate'); if (g && g.parentNode) g.parentNode.removeChild(g);
    } else if (e) {
      e.textContent = 'Access is limited to @' + DOMAIN + ' accounts' + (email ? ' — you used ' + email : '') + '. Choose another account.';
      try { google.accounts.id.disableAutoSelect(); } catch (x) {}
    }
  }
  function ready() { return !!(window.google && google.accounts && google.accounts.id); }
  function whenReady(fn, n) { if (ready()) return fn(); if ((n || 0) > 80) return; setTimeout(function () { whenReady(fn, (n || 0) + 1); }, 200); }
  function initGoogle() {
    google.accounts.id.initialize({ client_id: CLIENT_ID, callback: cb, hd: DOMAIN, auto_select: false, cancel_on_tap_outside: false });
    var b = document.getElementById('ztzbtn');
    if (b) google.accounts.id.renderButton(b, { theme: 'filled_blue', size: 'large', text: 'signin_with', shape: 'pill', width: 260 });
    try { google.accounts.id.prompt(); } catch (x) {}
  }
  function start() {
    mount();
    if (!ready() && !document.querySelector('script[src*="accounts.google.com/gsi/client"]')) {
      var s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true;
      s.onerror = function () { var e = document.getElementById('ztzerr'); if (e) e.textContent = 'Could not load Google sign-in. Reload to try again.'; };
      document.documentElement.appendChild(s);
    }
    whenReady(initGoogle);
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
