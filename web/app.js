const form = document.getElementById('scrape-form');
const statusEl = document.getElementById('status');
const resultSection = document.getElementById('result');
const resultPre = document.getElementById('resultPre');
const extensionIdInput = document.getElementById('extensionId');
const extensionIdHint = document.getElementById('extensionIdHint');
const profileUrlInput = document.getElementById('profileUrl');
const debugPanel = document.getElementById('debug-panel');
const debugList = document.getElementById('debugList');
const sampleProfile = JSON.parse(document.getElementById('sample-json').innerHTML.trim());
const DEFAULT_EXTENSION_ID = 'hnfkpaaphfmbhcaedaejaanfjcghppan';
const canTalkToExtension = typeof chrome !== 'undefined' && !!chrome.runtime?.sendMessage;
const queryParams = new URLSearchParams(window.location.search);
const debugAlwaysOn = queryParams.get('debug') === '1';

function updateExtensionIdHint(source) {
  if (!extensionIdHint) return;
  const messages = {
    query: 'Extension ID URL parametresinden alındı.',
    storage: 'Extension ID daha önce kaydettiğiniz değerle dolduruldu.',
    default: `Extension ID otomatik olarak ${DEFAULT_EXTENSION_ID} değerine ayarlandı.`
  };
  extensionIdHint.textContent = messages[source] || '';
}

(function hydrateExtensionInput() {
  const fromQuery = queryParams.get('ext');
  const fromStorage = localStorage.getItem('extensionId');
  const resolved = fromQuery || fromStorage || DEFAULT_EXTENSION_ID;
  extensionIdInput.value = resolved;
  if (!fromQuery && !fromStorage) {
    localStorage.setItem('extensionId', resolved);
  }
  const source = fromQuery ? 'query' : fromStorage ? 'storage' : 'default';
  updateExtensionIdHint(source);
})();

function setStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = type ? `status ${type}` : 'status';
}

function renderResult(profile) {
  resultPre.textContent = JSON.stringify(profile, null, 2);
  resultSection.hidden = false;
}

function formatTimestamp(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return ts;
  }
}

function renderDebug(logs = []) {
  if (!logs.length && !debugAlwaysOn) {
    debugPanel.hidden = true;
    debugList.innerHTML = '';
    return;
  }

  debugPanel.hidden = false;
  debugList.innerHTML = '';

  if (!logs.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'Debug aktif ancak log gelmedi.';
    debugList.appendChild(empty);
    return;
  }

  logs.forEach((log) => {
    const entry = document.createElement('div');
    entry.className = 'log-entry';

    const metaRow = document.createElement('div');
    metaRow.className = 'log-meta';

    const step = document.createElement('span');
    step.className = 'log-step';
    step.textContent = log.step || 'unknown';

    const time = document.createElement('time');
    time.textContent = formatTimestamp(log.timestamp);

    metaRow.append(step, time);
    entry.appendChild(metaRow);

    if (log.meta) {
      const pre = document.createElement('pre');
      const metaText =
        typeof log.meta === 'string' ? log.meta : JSON.stringify(log.meta, null, 2);
      pre.textContent = metaText;
      entry.appendChild(pre);
    }

    debugList.appendChild(entry);
  });
}

function sendScrapeRequest(extensionId, profileUrl) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      extensionId,
      { action: 'scrapeProfile', url: profileUrl },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      }
    );
  });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const extensionId = extensionIdInput.value.trim();
  const profileUrl = profileUrlInput.value.trim();

  if (!extensionId) {
    setStatus('Lütfen extension ID alanını doldurun.', 'error');
    return;
  }

  localStorage.setItem('extensionId', extensionId);
  setStatus('LinkedIn profili açılıyor...', '');
  resultSection.hidden = true;
  renderDebug([]);

  let response;
  try {
    if (!canTalkToExtension) {
      setStatus('Chrome dışındasınız veya eklentiye erişim yok. Mock veri gösteriliyor.', 'error');
      renderResult(sampleProfile);
      renderDebug([]);
      return;
    }

    response = await sendScrapeRequest(extensionId, profileUrl);

    if (response?.status === 'success') {
      setStatus('Veri başarıyla geldi.', 'success');
      renderResult(response.profile);
      renderDebug(response.debug || []);
    } else {
      throw new Error(response?.reason || 'Bilinmeyen hata');
    }
  } catch (error) {
    console.error(error);
    setStatus(error.message, 'error');
    renderDebug(response?.debug || []);
  }
});

if (!canTalkToExtension) {
  setStatus('Uyarı: Bu sayfa extension ile konuşamıyor. Chrome üzerinde http://localhost altında deneyin.', 'error');
  renderDebug([]);
}
