const audio = new Audio(chrome.runtime.getURL('sound.mp3'));
let locked = false, enabled = false, mo = null;
const attachedEls = new Set();
let audioContext, audioBuffer, gainNode, compressor, audioFetchInProgress = false;
let _effectEl, _effectTimeout;
const pendingAddedNodes = [];
let processScheduled = false;

const log = (...a) => { try{ console.debug('ScrollNoise:', ...a); }catch(e){} };
let USER_ENABLED = true;
let USER_MODE = 'soft';
let hardActivityTimer = null;
let hardIdleTimeout = 1460;
let hardListenersAdded = false;
let _hardEl = null;

// Оптимизация: кэширование DOM-запросов
let _cachedElements = {
  head: null,
  documentElement: null,
  body: null
};

function getHead() {
  if (!_cachedElements.head) _cachedElements.head = document.head;
  return _cachedElements.head;
}

function getDocumentElement() {
  if (!_cachedElements.documentElement) _cachedElements.documentElement = document.documentElement;
  return _cachedElements.documentElement;
}

function getBody() {
  if (!_cachedElements.body) _cachedElements.body = document.body;
  return _cachedElements.body;
}

function ensureHardStyle(){
  if (document.getElementById('scroll-noise-hard-style')) return;
  try{
    const css = `#scroll-noise-hard{position:fixed;inset:0;pointer-events:none;z-index:2147483646;opacity:1;transition:opacity 120ms ease,transform 120ms ease;transform:scale(1.03);background:radial-gradient(ellipse at center, rgba(0,0,0,0) 35%, rgba(0,0,0,0.55) 100%);backdrop-filter:blur(6px) saturate(.8) contrast(.9);-webkit-backdrop-filter:blur(6px) saturate(.8) contrast(.9)}
#scroll-noise-hard.hidden{opacity:0;transform:scale(1);} `;
    const s = document.createElement('style'); s.id = 'scroll-noise-hard-style'; s.textContent = css; getHead()?.appendChild(s);
    _hardEl = document.createElement('div'); _hardEl.id = 'scroll-noise-hard'; getDocumentElement().appendChild(_hardEl);
  }catch(e){}
}

function setHardActive(){
  try{
    if (_hardEl) _hardEl.classList.add('hidden');
  }catch(e){}
}

function setHardIdle(){
  try{
    if (_hardEl) _hardEl.classList.remove('hidden');
  }catch(e){}
}

function onUserActivityForHard(){
  setHardActive();
  if (hardActivityTimer) clearTimeout(hardActivityTimer);
  hardActivityTimer = setTimeout(()=> setHardIdle(), hardIdleTimeout);
}

function addHardListeners(){
  if (hardListenersAdded) return; hardListenersAdded = true;
  ensureHardStyle();
  ['wheel','click','touchstart'].forEach(e => window.addEventListener(e, onUserActivityForHard, {passive:true}));
  setHardIdle();
}

function removeHardListeners(){
  if (!hardListenersAdded) return; hardListenersAdded = false;
  ['wheel','click','touchstart'].forEach(e => window.removeEventListener(e, onUserActivityForHard, {passive:true}));
  if (hardActivityTimer) { clearTimeout(hardActivityTimer); hardActivityTimer = null; }
  try{ if (_hardEl){ _hardEl.remove(); _hardEl = null; } const s = document.getElementById('scroll-noise-hard-style'); if (s) s.remove(); }catch(e){}
}

function initAudioContext(){
  if (audioContext) return;
  try{
    const AC = window.AudioContext || window.webkitAudioContext;
    audioContext = new AC();
    gainNode = audioContext.createGain();
    gainNode.gain.value = 0.4;
    compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = -30;
    compressor.knee.value = 20;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.5;
    gainNode.connect(compressor);
    compressor.connect(audioContext.destination);
    if (!audioFetchInProgress && !audioBuffer){
      audioFetchInProgress = true;
      fetch(chrome.runtime.getURL('sound.mp3')).then(r=>r.arrayBuffer()).then(b=>{
        if (audioContext) audioContext.decodeAudioData(b, d=>{audioBuffer=d;}, e=>log('decode',e));
        audioFetchInProgress = false;
      }).catch(e=>{log('fetch',e);audioFetchInProgress=false;});
    }
  }catch(e){ log('init',e); }
}

function playSoundViaWebAudio(){
  if (!audioContext || !audioBuffer) return false;
  try{
    if (audioContext.state === 'suspended') audioContext.resume().catch(e=>log('resume',e));
    const src = audioContext.createBufferSource();
    src.buffer = audioBuffer;
    const filter = audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3000;
    filter.Q.value = 0.5;
    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.4, audioContext.currentTime + 0.05);
    src.connect(filter);
    filter.connect(gainNode);
    src.start(0);
    src.stop(audioContext.currentTime + audioBuffer.duration - 0.1);
    return true;
  }catch(e){ log('web',e); return false; }
}

// Оптимизация: батчинг для обработки DOM-изменений
function scheduleProcessAddedNodes(){
  if (processScheduled) return;
  processScheduled = true;
  const run = ()=>{
    processScheduled = false;
    if (!enabled){ pendingAddedNodes.length = 0; return; }
    let c = 0;
    // Оптимизация: ограничение количества обрабатываемых элементов за один проход
    const batchSize = Math.min(pendingAddedNodes.length, 50);
    for(let i = 0; i < batchSize; i++){
      const n = pendingAddedNodes.shift();
      if (!n) break;
      try{ 
        attachIfScrollable(n); 
        // Оптимизация: ограничение глубины поиска
        if (n.querySelectorAll) {
          const children = n.querySelectorAll('div,main');
          for(let j = 0; j < Math.min(children.length, 6); j++) {
            attachIfScrollable(children[j]);
          }
        }
      }catch(e){}
      c++;
    }
    if (pendingAddedNodes.length) {
      ('requestIdleCallback' in window ? requestIdleCallback(run,{timeout:300}) : setTimeout(run,150));
    }
  };
  ('requestIdleCallback' in window ? requestIdleCallback(run,{timeout:300}) : setTimeout(run,150));
}

function createVisualEffect(){
  if (USER_MODE === 'hard') return;
  if (_effectEl) return;
  try{
    const css = `#scroll-noise-effect{position:fixed;inset:0;pointer-events:none;z-index:2147483647;opacity:0;transition:opacity 180ms,transform 160ms}#scroll-noise-effect::before{content:"";position:absolute;inset:0;background:radial-gradient(ellipse,rgba(0,0,0,0) 35%,rgba(0,0,0,.18) 70%);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}`;
    const s = document.createElement('style'); 
    s.textContent = css; 
    getHead()?.appendChild(s);
    _effectEl = document.createElement('div'); 
    _effectEl.id = 'scroll-noise-effect'; 
    getDocumentElement().appendChild(_effectEl);
  }catch(e){}
}

function showVisualEffect(){
  if (!_effectEl) createVisualEffect();
  if (!_effectEl) return;
  try{
    if (_effectTimeout) clearTimeout(_effectTimeout);
    _effectEl.style.opacity = '1';
    _effectEl.style.transform = 'scale(1.03)';
    _effectTimeout = setTimeout(()=>{ 
      try{ _effectEl.style.opacity = '0'; _effectEl.style.transform = 'scale(1)'; }catch(e){} 
    }, 260);
  }catch(e){}
}

const DEFAULT_CONFIG = {mode:'blacklist', whitelist:[], whitelist_exceptions:[], blacklist:[], blacklist_exceptions:[]};
let CURRENT_CONFIG = DEFAULT_CONFIG;

// ФИКС: Функция для безопасного воспроизведения звука с обработкой автовоспроизведения
async function triggerSound(){
  if (locked) return;
  locked = true;
  
  // Инициализация аудиоконтекста при первом вызове
  if (!audioContext) {
    initAudioContext();
  }
  
  // Попытка воспроизведения через Web Audio
  let played = playSoundViaWebAudio();
  
  // Fallback на HTML5 Audio с обработкой ошибки автовоспроизведения
  if (!played) {
    try {
      // Сброс и попытка воспроизведения
      audio.currentTime = 0;
      audio.volume = 0.4;
      
      // Обработка политики автовоспроизведения
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(async error => {
          if (error.name === 'NotAllowedError') {
            log('Autoplay blocked, waiting for user interaction');
            // Ждем пользовательского взаимодействия для разблокировки
            await waitForUserInteraction();
            try {
              audio.currentTime = 0;
              await audio.play();
            } catch (e) {
              log('Fallback play failed:', e);
            }
          }
        });
      }
    } catch(e) {
      log('html5', e);
    }
  }
  
  try{
    if (USER_MODE === 'hard'){
      onUserActivityForHard();
    } else {
      showVisualEffect();
    }
  }catch(e){}
  setTimeout(()=> locked = false, 500);
}

// ФИКС: Функция для ожидания пользовательского взаимодействия
function waitForUserInteraction() {
  return new Promise((resolve) => {
    const events = ['click', 'touchstart', 'keydown', 'mousedown'];
    const handler = () => {
      events.forEach(event => document.removeEventListener(event, handler));
      resolve();
    };
    events.forEach(event => document.addEventListener(event, handler, { once: true }));
  });
}

// ФИКС: Улучшенная инициализация аудио с предзагрузкой
function primeAudio(){
  const once = () => { 
    try{ 
      initAudioContext(); 
      // Предварительная загрузка и подготовка аудио
      audio.volume = 0.1; 
      audio.load(); // Принудительная загрузка
      audio.play().then(() => {
        audio.pause();
        audio.currentTime = 0;
      }).catch(()=>{}); 
      setTimeout(()=> audio.volume = 0.4, 40);
    }catch(e){} 
    window.removeEventListener('pointerdown',once); 
    window.removeEventListener('click',once); 
    window.removeEventListener('keydown',once); 
  };
  
  // Немедленная попытка инициализации, если страница уже интерактивна
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(once, 100);
  }
  
  ['pointerdown','click','keydown'].forEach(e => window.addEventListener(e, once, {once:true, passive:e!=='keydown'}));
}

function attachIfScrollable(el){
  if (!el || attachedEls.has(el)) return;
  try{
    if (el === window || el === getDocumentElement() || el === getBody()) {
      if (getDocumentElement().scrollHeight > getDocumentElement().clientHeight) {
        attachedEls.add(el);
        return;
      }
      return;
    }
    const s = getComputedStyle(el);
    if (s.overflowY === 'auto' || s.overflowY === 'scroll' || el.scrollHeight > el.clientHeight){
      el.addEventListener('scroll', triggerSound, {passive:true});
      el.addEventListener('wheel', triggerSound, {passive:true});
      attachedEls.add(el);
    }
  }catch(e){}
}

const matchRule = (r) => {
  const h = location.hostname, p = location.pathname;
  return r?.host && h.endsWith(r.host) && (!r.pathStartsWith || (r.pathStartsWith.includes('shorts') ? p.includes('shorts') : p.startsWith(r.pathStartsWith)));
};

function attachGlobalListeners(){
  const t = triggerSound;
  window.addEventListener('wheel', t, {passive:true});
  window.addEventListener('touchmove', t, {passive:true});
  window.addEventListener('scroll', t, {passive:true});
  window.addEventListener('click', t, {passive:true});
  document.addEventListener('scroll', t, {passive:true, capture:true});
  window.addEventListener('keydown', (e)=>{ 
    if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(e.key)) t(); 
  });
}

function removeGlobalListeners(){
  const t = triggerSound;
  ['wheel','touchmove','scroll','click'].forEach(e => window.removeEventListener(e, t));
  document.removeEventListener('scroll', t, true);
}

function removeAttachedElements(){
  attachedEls.forEach(el => { 
    try{ 
      el.removeEventListener('scroll', triggerSound); 
      el.removeEventListener('wheel', triggerSound); 
    }catch(e){} 
  });
  attachedEls.clear();
}

// ФИКС: Улучшенная инициализация с немедленной активацией звука
function doInit(){
  if (enabled) return;
  enabled = true;
  log('enabled');
  
  // Немедленная инициализация аудио
  try{ 
    initAudioContext(); 
    // Предварительная загрузка звука
    primeAudio();
  }catch(e){}
  
  attachGlobalListeners();
  
  const init = () => {
    if (!enabled) return;
    
    // Тестовое воспроизведение звука при инициализации (тихий звук)
    setTimeout(() => {
      if (!locked) {
        try {
          // Воспроизводим очень тихий звук для активации аудиоконтекста
          const testVolume = audio.volume;
          audio.volume = 0.05;
          audio.play().then(() => {
            setTimeout(() => {
              audio.pause();
              audio.currentTime = 0;
              audio.volume = testVolume;
            }, 10);
          }).catch(() => {});
        } catch(e) {}
      }
    }, 500);
    
    try{ createVisualEffect(); }catch(e){}
    
    // Оптимизация: селективный поиск элементов
    const selectors = ['#feed_rows','main','#content','[data-testid="Bna"]','._ld0j','#appContent'];
    selectors.forEach(sel => { 
      try{ 
        const elements = document.querySelectorAll(sel);
        for(let i = 0; i < Math.min(elements.length, 10); i++) {
          attachIfScrollable(elements[i]);
        }
      }catch(e){} 
    });
    
    try{ 
      attachIfScrollable(window); 
      attachIfScrollable(getDocumentElement()); 
      attachIfScrollable(getBody()); 
    }catch(e){}
    
    // Оптимизация: более сфокусированный MutationObserver
    mo = new MutationObserver(m => { 
      for(let i = 0; i < m.length; i++) {
        const addedNodes = m[i].addedNodes;
        for(let j = 0; j < addedNodes.length; j++) {
          const n = addedNodes[j];
          if (n instanceof Element) { 
            try{
              pendingAddedNodes.push(n);
              scheduleProcessAddedNodes();
            }catch(e){} 
          }
        }
      }
    });
    
    try{ 
      mo.observe(getDocumentElement(), {
        childList: true, 
        subtree: true,
        // Оптимизация: наблюдаем только определенные атрибуты
        attributeFilter: ['style', 'class']
      }); 
    }catch(e){}
  };
  
  // Оптимизация: задержка инициализации для приоритета загрузки страницы
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(init, 300);
    });
  } else {
    setTimeout(init, 300);
  }
}

function disableAll(){
  if (!enabled) return;
  enabled = false;
  log('disabled');
  removeGlobalListeners();
  try{ audio.pause(); audio.currentTime = 0; }catch(e){}
  try{ mo?.disconnect(); mo = null; }catch(e){}
  try{ removeAttachedElements(); }catch(e){}
  if (_effectTimeout) clearTimeout(_effectTimeout);
  if (_effectEl) { _effectEl.remove(); _effectEl = null; }
}

function evaluateConfig(cfg){
  const c = cfg || CURRENT_CONFIG || DEFAULT_CONFIG;
  const inList = (l) => l?.some(matchRule);
  
  if (c.mode === 'whitelist') {
    if (!inList(c.whitelist) || inList(c.whitelist_exceptions)) doInit(); 
    else disableAll();
  } else if (c.mode === 'blacklist') {
    if (inList(c.blacklist) && !inList(c.blacklist_exceptions)) doInit(); 
    else disableAll();
  } else disableAll();
}

function loadAndApplyConfig(){
  if (chrome?.storage?.local) {
    chrome.storage.local.get(['rulesConfig','enabled','renderMode'], r => {
      CURRENT_CONFIG = r?.rulesConfig || DEFAULT_CONFIG;
      USER_ENABLED = r?.enabled === undefined ? true : !!r.enabled;
      USER_MODE = r?.renderMode || 'soft';
      log('config', { enabled: USER_ENABLED, mode: USER_MODE });
      
      if (!USER_ENABLED) {
        disableAll();
        removeHardListeners();
        return;
      }
      
      evaluateConfig(CURRENT_CONFIG);
      
      if (USER_MODE === 'hard' && enabled) addHardListeners(); 
      else removeHardListeners();
      
      try{
        if (enabled) {
          if (USER_MODE === 'soft') createVisualEffect();
          else { if (_effectEl){ _effectEl.remove(); _effectEl = null; } }
        }
      }catch(e){}
    });
  } else {
    evaluateConfig();
  }
}

// Оптимизация: улучшенный мониторинг изменений URL
(() => {
  let lastUrl = location.href;
  let urlCheckInterval;
  
  const setupHistoryMonitoring = () => {
    const _push = history.pushState;
    history.pushState = function(){ 
      _push.apply(this,arguments); 
      setTimeout(() => checkUrlChange(), 0);
    };
    
    const _replace = history.replaceState;
    history.replaceState = function(){ 
      _replace.apply(this,arguments); 
      setTimeout(() => checkUrlChange(), 0);
    };
    
    window.addEventListener('popstate', () => {
      setTimeout(() => checkUrlChange(), 0);
    });
  };
  
  const checkUrlChange = () => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      loadAndApplyConfig();
    }
  };
  
  setupHistoryMonitoring();
  
  // Оптимизация: менее частые проверки URL
  urlCheckInterval = setInterval(checkUrlChange, 800);
  
  // Очистка при разгрузке страницы
  window.addEventListener('beforeunload', () => {
    clearInterval(urlCheckInterval);
  });
  
  loadAndApplyConfig();
})();

chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.rulesConfig){
    CURRENT_CONFIG = changes.rulesConfig.newValue || DEFAULT_CONFIG;
    log('rulesConfig changed');
    evaluateConfig(CURRENT_CONFIG);
    if (USER_MODE === 'hard' && USER_ENABLED && enabled) addHardListeners(); 
    else removeHardListeners();
  }
  if (changes.enabled){
    USER_ENABLED = !!changes.enabled.newValue;
    log('enabled changed', USER_ENABLED);
    if (!USER_ENABLED) { disableAll(); removeHardListeners(); } 
    else loadAndApplyConfig();
  }
  if (changes.renderMode){
    USER_MODE = changes.renderMode.newValue || 'soft';
    log('renderMode changed', USER_MODE);
    if (USER_MODE === 'hard' && USER_ENABLED && enabled) addHardListeners(); 
    else removeHardListeners();
    try{
      if (enabled && USER_MODE === 'soft') createVisualEffect();
      else if (_effectEl){ _effectEl.remove(); _effectEl = null; }
    }catch(e){}
  }
});