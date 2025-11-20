const DEFAULT = {
  mode: 'whitelist',
  whitelist: [],
  whitelist_exceptions: [],
  blacklist: [],
  blacklist_exceptions: []
};

const DEFAULT_UI = { enabled: true, renderMode: 'soft' };

function renderList(containerId, list) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  list.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'rule';
    const text = document.createElement('span');
    text.textContent = r.host + (r.pathStartsWith || '');
    const rem = document.createElement('button');
    rem.textContent = 'Remove';
    rem.addEventListener('click', () => { list.splice(i,1); renderAll(current); });
    row.appendChild(text); row.appendChild(rem); el.appendChild(row);
  });
}

let current = null;

function renderAll(state){
  renderList('whitelist', state.whitelist);
  renderList('wl_exc', state.whitelist_exceptions);
  renderList('blacklist', state.blacklist);
  renderList('bl_exc', state.blacklist_exceptions);
  document.querySelectorAll('input[name="mode"]').forEach(i => i.checked = (i.value === state.mode));
  // render UI controls
  chrome.storage.local.get(['enabled','renderMode'], res => {
    const enabled = (res.enabled === undefined) ? DEFAULT_UI.enabled : res.enabled;
    const renderMode = res.renderMode || DEFAULT_UI.renderMode;
    const toggle = document.getElementById('toggle');
    if (toggle) toggle.textContent = enabled ? 'Toggle: On' : 'Toggle: Off';
    document.querySelectorAll('input[name="renderMode"]').forEach(i => i.checked = (i.value === renderMode));
  });
}

function load(){
  chrome.storage.local.get(['rulesConfig'], res => {
    current = res.rulesConfig || DEFAULT;
    renderAll(current);

    document.getElementById('wl_add').onclick = () => {
      const host = document.getElementById('wl_host').value.trim();
      const path = document.getElementById('wl_path').value.trim();
      if (!host) return alert('host required');
      current.whitelist.push({ host, pathStartsWith: path || undefined }); renderAll(current);
      document.getElementById('wl_host').value=''; document.getElementById('wl_path').value='';
    };
    document.getElementById('wle_add').onclick = () => {
      const host = document.getElementById('wle_host').value.trim();
      const path = document.getElementById('wle_path').value.trim();
      if (!host) return alert('host required');
      current.whitelist_exceptions.push({ host, pathStartsWith: path || undefined }); renderAll(current);
      document.getElementById('wle_host').value=''; document.getElementById('wle_path').value='';
    };
    document.getElementById('bl_add').onclick = () => {
      const host = document.getElementById('bl_host').value.trim();
      const path = document.getElementById('bl_path').value.trim();
      if (!host) return alert('host required');
      current.blacklist.push({ host, pathStartsWith: path || undefined }); renderAll(current);
      document.getElementById('bl_host').value=''; document.getElementById('bl_path').value='';
    };
    document.getElementById('ble_add').onclick = () => {
      const host = document.getElementById('ble_host').value.trim();
      const path = document.getElementById('ble_path').value.trim();
      if (!host) return alert('host required');
      current.blacklist_exceptions.push({ host, pathStartsWith: path || undefined }); renderAll(current);
      document.getElementById('ble_host').value=''; document.getElementById('ble_path').value='';
    };

    document.getElementById('save').onclick = () => {
      current.mode = document.querySelector('input[name="mode"]:checked').value;
      chrome.storage.local.set({ rulesConfig: current }, () => alert('Saved'));
    };
    document.getElementById('reset').onclick = () => {
      current = DEFAULT; chrome.storage.local.set({ rulesConfig: DEFAULT }, () => { renderAll(DEFAULT); alert('Reset'); });
    };

    // Toggle button
    const toggle = document.getElementById('toggle');
    if (toggle){
      toggle.onclick = () => {
        chrome.storage.local.get(['enabled'], r => {
          const cur = r.enabled === undefined ? DEFAULT_UI.enabled : r.enabled;
          const next = !cur;
          chrome.storage.local.set({ enabled: next }, () => { toggle.textContent = next ? 'Toggle: On' : 'Toggle: Off'; });
        });
      };
    }

    // Render mode radios
    document.querySelectorAll('input[name="renderMode"]').forEach(radio => {
      radio.addEventListener('change', () => {
        if (radio.checked) chrome.storage.local.set({ renderMode: radio.value });
      });
    });
  });
}

window.addEventListener('DOMContentLoaded', load);