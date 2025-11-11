const REQUEST_TIMEOUT_MS = 45000;

/**
 * pendingRequests maps tabId -> { sendResponse, timer, logs }
 */
const pendingRequests = new Map();

function createLogEntry(step, meta) {
  const entry = {
    step,
    source: 'background',
    timestamp: new Date().toISOString()
  };
  if (meta !== undefined) {
    entry.meta = meta;
  }
  return entry;
}

function appendLog(logs, step, meta) {
  logs.push(createLogEntry(step, meta));
}

function sendImmediateResponse(sendResponse, payload, logs = []) {
  sendResponse({
    ...payload,
    debug: logs
  });
}

function isValidProfileUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname === 'www.linkedin.com' &&
      parsed.pathname.startsWith('/in/')
    );
  } catch (err) {
    return false;
  }
}

function cleanupPendingRequest(tabId, result, contentLogs = []) {
  const pending = pendingRequests.get(tabId);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingRequests.delete(tabId);

  const combinedLogs = [
    ...pending.logs,
    ...(contentLogs || []).map((entry) =>
      entry && typeof entry === 'object'
        ? { ...entry, source: entry.source || 'content' }
        : entry
    )
  ];

  const payload = { ...result, debug: combinedLogs };

  try {
    pending.sendResponse(payload);
  } catch (err) {
    console.error('Failed to respond to external page', err);
  }
}

function ensureTabClosed(tabId) {
  chrome.tabs.remove(tabId, () => {
    if (chrome.runtime.lastError) {
      // Tab might already be closed; ignore.
    }
  });
}

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  const requestLogs = [
    createLogEntry('external-message', {
      action: message?.action,
      url: message?.url,
      origin: sender.origin || 'unknown'
    })
  ];

  if (message?.action !== 'scrapeProfile') {
    appendLog(requestLogs, 'unsupported-action', { action: message?.action });
    sendImmediateResponse(sendResponse, { status: 'error', reason: 'Unsupported action' }, requestLogs);
    return;
  }

  if (!isValidProfileUrl(message.url)) {
    appendLog(requestLogs, 'invalid-url', { url: message.url });
    sendImmediateResponse(sendResponse, { status: 'error', reason: 'Invalid LinkedIn profile URL' }, requestLogs);
    return;
  }

  appendLog(requestLogs, 'tab-create-request', { url: message.url });

  chrome.tabs.create({ url: message.url, active: false }, (tab) => {
    if (chrome.runtime.lastError || !tab?.id) {
      appendLog(requestLogs, 'tab-create-failed', {
        error: chrome.runtime.lastError?.message || 'Unknown error'
      });
      sendImmediateResponse(sendResponse, { status: 'error', reason: 'Unable to open profile tab' }, requestLogs);
      return;
    }

    appendLog(requestLogs, 'tab-create-success', { tabId: tab.id });

    const timer = setTimeout(() => {
      appendLog(requestLogs, 'timeout', { tabId: tab.id, ms: REQUEST_TIMEOUT_MS });
      cleanupPendingRequest(tab.id, {
        status: 'error',
        reason: 'Timed out waiting for LinkedIn content'
      });
      ensureTabClosed(tab.id);
    }, REQUEST_TIMEOUT_MS);

    pendingRequests.set(tab.id, { sendResponse, timer, logs: requestLogs });
  });

  // Keep the messaging channel open for the async scrape result.
  return true;
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!sender.tab?.id || !pendingRequests.has(sender.tab.id)) {
    return;
  }

  if (message?.action === 'profileScraped') {
    cleanupPendingRequest(
      sender.tab.id,
      {
        status: 'success',
        profile: message.profile,
        scrapedAt: new Date().toISOString()
      },
      message.debugLogs || []
    );
    ensureTabClosed(sender.tab.id);
  } else if (message?.action === 'profileError') {
    cleanupPendingRequest(
      sender.tab.id,
      {
        status: 'error',
        reason: message.reason || 'Content script failed'
      },
      message.debugLogs || []
    );
    ensureTabClosed(sender.tab.id);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (!pendingRequests.has(tabId)) return;
  cleanupPendingRequest(tabId, {
    status: 'error',
    reason: 'LinkedIn tab closed before scraping completed'
  });
});
