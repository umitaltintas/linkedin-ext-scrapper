(function initPopup() {
  const input = document.getElementById('extensionId');
  const copyBtn = document.getElementById('copyBtn');
  const statusEl = document.getElementById('copyStatus');

  const extensionId = chrome.runtime.id || '';
  input.value = extensionId;

  async function copyId() {
    if (!extensionId) return;
    try {
      await navigator.clipboard.writeText(extensionId);
      statusEl.textContent = 'ID panoya kopyalandı.';
    } catch (err) {
      // Clipboard API may be unavailable, fall back to manual selection.
      input.select();
      document.execCommand('copy');
      statusEl.textContent = 'Kopyalama denendi; gerekirse (⌘/Ctrl)+C yapın.';
      console.error('Clipboard error', err);
    }
    setTimeout(() => {
      statusEl.textContent = '';
    }, 2500);
  }

  copyBtn.addEventListener('click', copyId);
})();
