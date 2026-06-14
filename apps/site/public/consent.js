/* Falsafa — privacy-aware analytics consent.

   Model:
   - GDPR (EEA + UK + Switzerland): opt-in. Analytics stays DENIED until the visitor clicks Accept.
   - US (California CCPA/CPRA + other states): opt-out. Analytics granted by default with a notice and a
     "Do Not Sell or Share" opt-out. Global Privacy Control (GPC) is honored automatically as an opt-out.
   - India (DPDP) + rest of world: notice + opt-out (lenient).

   The data layer is gated by Google Consent Mode v2 region defaults set in the layout, which Google
   enforces by IP server-side — so EU data is protected even if this UI never loads. This file only
   handles the banner UX and remembering the visitor's choice. */
(function () {
  'use strict';

  var GA_ID = window.FALSAFA_GA_ID || '';
  if (!GA_ID || GA_ID.indexOf('G-XXXX') === 0) return; // not configured yet

  var KEY = 'falsafa_consent_v1';
  // EEA + UK + Switzerland — the opt-in (GDPR-style) regions.
  var GDPR = {AT:1,BE:1,BG:1,HR:1,CY:1,CZ:1,DK:1,EE:1,FI:1,FR:1,DE:1,GR:1,HU:1,IE:1,IT:1,LV:1,LT:1,
    LU:1,MT:1,NL:1,PL:1,PT:1,RO:1,SK:1,SI:1,ES:1,SE:1,IS:1,LI:1,NO:1,GB:1,CH:1};

  function gtag(){ (window.dataLayer = window.dataLayer || []).push(arguments); }
  function store(v){ try { localStorage.setItem(KEY, JSON.stringify({a:v,t:Date.now()})); } catch(e){} }
  function read(){ try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch(e){ return null; } }
  function apply(granted){ gtag('consent','update',{ analytics_storage: granted ? 'granted' : 'denied' }); }

  var lastGDPR = null, lastCC = null;

  function start(){
    var prev = read();
    if (prev && (prev.a === 'granted' || prev.a === 'denied')) { apply(prev.a === 'granted'); attachManager(); return; }
    if (navigator.globalPrivacyControl === true) { apply(false); store('denied'); attachManager(); return; }
    detect(function(info){
      lastCC = info && info.country_code ? String(info.country_code).toUpperCase() : null;
      lastGDPR = lastCC ? !!GDPR[lastCC] : true; // unknown region -> strict (opt-in), the safe default
      banner(lastGDPR, lastCC);
      attachManager();
    });
  }

  function detect(cb){
    var done = false, t = setTimeout(function(){ if(!done){ done = true; cb(null); } }, 2500);
    try {
      fetch('https://get.geojs.io/v1/ip/geo.json', { cache: 'force-cache' })
        .then(function(r){ return r.json(); })
        .then(function(j){ if(done) return; done = true; clearTimeout(t); cb(j); })
        .catch(function(){ if(done) return; done = true; clearTimeout(t); cb(null); });
    } catch(e){ if(!done){ done = true; clearTimeout(t); cb(null); } }
  }

  function el(tag, cls, html){ var e = document.createElement(tag); if(cls) e.className = cls; if(html != null) e.innerHTML = html; return e; }

  function banner(isGDPR, cc){
    if (document.getElementById('consent')) return;
    var isUS = cc === 'US';
    var body, primaryLabel, secondaryLabel;
    if (isGDPR) {
      body = 'We use Google Analytics to understand how this library is used. With your consent we set analytics cookies. You can change your choice anytime.';
      primaryLabel = 'Accept'; secondaryLabel = 'Reject';
    } else if (isUS) {
      body = 'We use Google Analytics to understand traffic. You can opt out at any time. California residents: this is your &ldquo;Do Not Sell or Share My Personal Information&rdquo; choice.';
      primaryLabel = 'Got it'; secondaryLabel = 'Opt out';
    } else {
      body = 'We use Google Analytics to understand how this library is used. You can opt out anytime.';
      primaryLabel = 'Got it'; secondaryLabel = 'Opt out';
    }

    var wrap = el('div','consent'); wrap.id = 'consent';
    wrap.setAttribute('role','dialog'); wrap.setAttribute('aria-label','Privacy and cookies');
    var inner = el('div','consent-inner');
    var text = el('div','consent-text');
    text.appendChild(el('strong','consent-title','Your privacy'));
    text.appendChild(el('p', null, body));
    var actions = el('div','consent-actions');
    var secondary = el('button','consent-btn consent-secondary', secondaryLabel); secondary.type = 'button';
    var primary = el('button','consent-btn consent-primary', primaryLabel); primary.type = 'button';
    actions.appendChild(secondary); actions.appendChild(primary);
    inner.appendChild(text); inner.appendChild(actions);
    wrap.appendChild(inner);
    document.body.appendChild(wrap);
    requestAnimationFrame(function(){ wrap.classList.add('show'); });

    function choose(granted){ apply(granted); store(granted ? 'granted' : 'denied'); close(); }
    function close(){ wrap.classList.remove('show'); setTimeout(function(){ if(wrap.parentNode) wrap.parentNode.removeChild(wrap); }, 350); }
    primary.addEventListener('click', function(){ choose(true); });    // Accept / Got it  -> grant
    secondary.addEventListener('click', function(){ choose(false); }); // Reject / Opt out -> deny
  }

  function attachManager(){
    var link = document.getElementById('cookie-prefs');
    if (!link) return;
    link.style.display = '';
    link.addEventListener('click', function(e){
      e.preventDefault();
      if (lastGDPR !== null) { banner(lastGDPR, lastCC); return; }
      detect(function(info){
        var cc = info && info.country_code ? String(info.country_code).toUpperCase() : null;
        banner(cc ? !!GDPR[cc] : true, cc);
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
