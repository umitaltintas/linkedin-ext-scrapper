const REQUEST_TIMEOUT_MS = 20000;

/**
 * pendingRequests maps tabId -> { sendResponse, timer }
 */
const pendingRequests = new Map();

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

function cleanupPendingRequest(tabId, result) {
  const pending = pendingRequests.get(tabId);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingRequests.delete(tabId);
  if (result) {
    try {
      pending.sendResponse(result);
    } catch (err) {
      console.error('Failed to respond to external page', err);
    }
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
  if (message?.action !== 'scrapeProfile') {
    sendResponse({ status: 'error', reason: 'Unsupported action' });
    return;
  }

  if (!isValidProfileUrl(message.url)) {
    sendResponse({ status: 'error', reason: 'Invalid LinkedIn profile URL' });
    return;
  }

  chrome.tabs.create({ url: message.url, active: false }, (tab) => {
    if (chrome.runtime.lastError || !tab?.id) {
      sendResponse({ status: 'error', reason: 'Unable to open profile tab' });
      return;
    }

    const timer = setTimeout(() => {
      cleanupPendingRequest(tab.id, {
        status: 'error',
        reason: 'Timed out waiting for LinkedIn content'
      });
      ensureTabClosed(tab.id);
    }, REQUEST_TIMEOUT_MS);

    pendingRequests.set(tab.id, { sendResponse, timer });
  });

  // Keep the messaging channel open for the async scrape result.
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!sender.tab?.id || !pendingRequests.has(sender.tab.id)) {
    return;
  }

  if (message?.action === 'profileScraped') {
    cleanupPendingRequest(sender.tab.id, {
      status: 'success',
      profile: message.profile,
      scrapedAt: new Date().toISOString(),
      debug: message.debugLogs || []
    });
    ensureTabClosed(sender.tab.id);
  } else if (message?.action === 'profileError') {
    cleanupPendingRequest(sender.tab.id, {
      status: 'error',
      reason: message.reason || 'Content script failed',
      debug: message.debugLogs || []
    });
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
