// unified scroll-sound script with configurable black/white lists and exceptions
const audio = new Audio(chrome.runtime.getURL('sound.mp3'));
let locked = false;
let enabled = false;
let mo = null;
const attachedEls = new Set();

// Default config used when user hasn't set rules
const DEFAULT_CONFIG = {
  mode: 'whitelist',
  whitelist: [ { host: 'vk.com', pathStartsWith: '/feed' }, { host: 'youtube.com', pathStartsWith: '/shorts' } ],
  whitelist_exceptions: [],
  blacklist: [],
  blacklist_exceptions: []
};
let CURRENT_CONFIG = null;

function log(...args){ try{ console.debug('ScrollNoise:', ...args); }catch(e){} }

function triggerSound(){
  if (locked) return;
  locked = true;
  try{
    audio.currentTime = 0;
    const p = audio.play();
    if (p && p.catch) p.catch(err => log('play rejected', err));
  }catch(e){ log('play threw', e); }
  setTimeout(()=> locked = false, 500);
}

function primeAudio(){
  const once = () => {
    try{ audio.volume = 0; const p = audio.play(); if (p && p.catch) p.catch(()=>{}); setTimeout(()=>audio.volume=1,40);}catch(e){}
    window.removeEventListener('pointerdown', once);
    window.removeEventListener('keydown', once);
  };
  window.addEventListener('pointerdown', once, { once:true, passive:true });
  window.addEventListener('keydown', once, { once:true, passive:true });
}

function attachIfScrollable(el){
  try{
    if (!el || attachedEls.has(el)) return;
    const style = window.getComputedStyle(el);
    if (style.overflowY === 'auto' || style.overflowY === 'scroll' || el.scrollHeight > el.clientHeight){
      el.addEventListener('scroll', triggerSound, { passive:true });
      el.addEventListener('wheel', triggerSound, { passive:true });
      attachedEls.add(el);
    }
  }catch(e){}
}

// named handlers so we can remove later
const _wheelHandler = ()=>triggerSound();
const _touchHandler = ()=>triggerSound();
const _scrollHandler = ()=>triggerSound();
const _keyHandler = (e)=>{ const keys=['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' ']; if(keys.includes(e.key)) triggerSound(); };

function attachGlobalListeners(){
  window.addEventListener('wheel', _wheelHandler, { passive:true });
  window.addEventListener('touchmove', _touchHandler, { passive:true });
  window.addEventListener('scroll', _scrollHandler, { passive:true });
  window.addEventListener('keydown', _keyHandler, false);
}

function removeGlobalListeners(){
  window.removeEventListener('wheel', _wheelHandler);
  window.removeEventListener('touchmove', _touchHandler);
  window.removeEventListener('scroll', _scrollHandler);
  window.removeEventListener('keydown', _keyHandler);
}

function removeAttachedElements(){
  for(const el of Array.from(attachedEls)){
    try{ el.removeEventListener('scroll', triggerSound); el.removeEventListener('wheel', triggerSound); }catch(e){}
    attachedEls.delete(el);
  }
}

function matchRule(rule){
  try{
    const host = location.hostname || '';
    const path = location.pathname || '/';
    if (!rule || !rule.host) return false;
    if (!host.endsWith(rule.host)) return false;
    if (rule.pathStartsWith){
      // special-case: if rule mentions 'shorts' allow any path containing shorts
      if (rule.pathStartsWith.includes('shorts')){
        if (!path.includes('shorts')) return false;
      } else {
        if (!path.startsWith(rule.pathStartsWith)) return false;
      }
    }
    return true;
  }catch(e){ return false; }
}

function doInit(){
  if (enabled) return;
  enabled = true; log('enabled');
  attachGlobalListeners();
  primeAudio();

  const heavyInit = ()=>{
    if (!enabled) return;
    ['#feed_rows','main','#content'].forEach(sel=>{ try{ document.querySelectorAll(sel).forEach(attachIfScrollable); }catch(e){} });
    mo = new MutationObserver(muts=>{
      for(const m of muts) for(const n of m.addedNodes) if(n instanceof Element){ attachIfScrollable(n); try{ n.querySelectorAll && n.querySelectorAll('div, main').forEach(attachIfScrollable); }catch(e){} }
    });
    try{ mo.observe(document.documentElement || document.body, { childList:true, subtree:true }); }catch(e){}
  };
  if ('requestIdleCallback' in window) try{ requestIdleCallback(heavyInit, { timeout:500 }); }catch(e){ setTimeout(heavyInit,300); } else setTimeout(heavyInit,300);
}

function disableAll(){
  if (!enabled) return;
  enabled = false; log('disabled');
  removeGlobalListeners();
  try{ audio.pause(); audio.currentTime = 0; }catch(e){}
  try{ mo && mo.disconnect(); mo = null; }catch(e){}
  try{ removeAttachedElements(); }catch(e){}
}

function evaluateConfig(cfg){
  const config = cfg || CURRENT_CONFIG || DEFAULT_CONFIG;
  const host = location.hostname || '';
  const path = location.pathname || '/';
  const inList = (list)=>{ for(const r of list||[]) if (matchRule(r)) return true; return false; };

  if (config.mode === 'whitelist'){
    // User: whitelist = sites where app will NOT work; app works on all other sites.
    if (inList(config.whitelist) && !inList(config.whitelist_exceptions)){ log('matched whitelist (disabled)'); disableAll(); return; }
    log('not in whitelist -> enabled'); doInit(); return;
  }
  // blacklist mode
  if (config.mode === 'blacklist'){
    // User: blacklist = sites where app WILL work; on other sites it's disabled.
    if (inList(config.blacklist) && !inList(config.blacklist_exceptions)){ log('matched blacklist (enabled)'); doInit(); return; }
    log('not in blacklist -> disabled'); disableAll(); return;
  }
  // default fallback
  disableAll();
}

function loadAndApplyConfig(){
  if (chrome && chrome.storage && chrome.storage.local){
    chrome.storage.local.get(['rulesConfig'], res=>{
      try{ CURRENT_CONFIG = res && res.rulesConfig ? res.rulesConfig : DEFAULT_CONFIG; }catch(e){ CURRENT_CONFIG = DEFAULT_CONFIG; }
      log('loaded config', CURRENT_CONFIG, 'location', location.hostname+location.pathname);
      evaluateConfig(CURRENT_CONFIG);
    });
  } else { CURRENT_CONFIG = DEFAULT_CONFIG; evaluateConfig(CURRENT_CONFIG); }
}

// SPA navigation: re-evaluate on location changes
(function(){
  const _push = history.pushState; history.pushState = function(){ _push.apply(this, arguments); window.dispatchEvent(new Event('locationchange')); };
  const _replace = history.replaceState; history.replaceState = function(){ _replace.apply(this, arguments); window.dispatchEvent(new Event('locationchange')); };
  window.addEventListener('popstate', ()=> window.dispatchEvent(new Event('locationchange')));
  window.addEventListener('locationchange', ()=> loadAndApplyConfig());
  // initial
  loadAndApplyConfig();
})();

// React to storage changes so popup->save applies immediately without page reload
if (chrome && chrome.storage && chrome.storage.onChanged){
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.rulesConfig){
      try{
        CURRENT_CONFIG = changes.rulesConfig.newValue || DEFAULT_CONFIG;
        log('storage changed, reloaded config', CURRENT_CONFIG);
        evaluateConfig(CURRENT_CONFIG);
      }catch(e){ log('storage change handling failed', e); }
    }
  });
}
