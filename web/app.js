const { useState, useEffect, useRef } = React;
const ReactJson = window.ReactJson || window.ReactJsonView;

const DEFAULT_EXTENSION_ID = 'hnfkpaaphfmbhcaedaejaanfjcghppan';

// Sample data
const sampleProfile = JSON.parse(
  document.getElementById('sample-json').innerHTML.trim()
);

const canTalkToExtension =
  typeof chrome !== 'undefined' && !!chrome.runtime?.sendMessage;

function updateExtensionIdHint(source) {
  const messages = {
    query: 'Extension ID URL parametresinden alındı.',
    storage: 'Extension ID daha önce kaydettiğiniz değerle dolduruldu.',
    default: `Extension ID otomatik olarak ${DEFAULT_EXTENSION_ID} değerine ayarlandı.`
  };
  return messages[source] || '';
}

function App() {
  const [extensionId, setExtensionId] = useState(DEFAULT_EXTENSION_ID);
  const [extensionIdHint, setExtensionIdHint] = useState('');
  const [profileUrl, setProfileUrl] = useState('');
  const [status, setStatus] = useState('');
  const [statusType, setStatusType] = useState('');
  const [result, setResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const queryParams = useRef(new URLSearchParams(window.location.search));

  // Initialize extension ID from query or storage
  useEffect(() => {
    const fromQuery = queryParams.current.get('ext');
    const fromStorage = localStorage.getItem('extensionId');
    const resolved = fromQuery || fromStorage || DEFAULT_EXTENSION_ID;

    setExtensionId(resolved);

    const source = fromQuery ? 'query' : fromStorage ? 'storage' : 'default';
    setExtensionIdHint(updateExtensionIdHint(source));

    if (!fromQuery && !fromStorage) {
      localStorage.setItem('extensionId', resolved);
    }

    if (!canTalkToExtension) {
      setStatus(
        'Uyarı: Bu sayfa extension ile konuşamıyor. Chrome üzerinde http://localhost altında deneyin.',
        'error'
      );
    }
  }, []);

  function sendScrapeRequest(extId, profileUrlValue) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        extId,
        { action: 'scrapeProfile', url: profileUrlValue },
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

  async function handleSubmit(e) {
    e.preventDefault();

    const trimmedExtId = extensionId.trim();
    const trimmedUrl = profileUrl.trim();

    if (!trimmedExtId) {
      setStatus('Lütfen extension ID alanını doldurun.');
      setStatusType('error');
      return;
    }

    localStorage.setItem('extensionId', trimmedExtId);
    setStatus('LinkedIn profili açılıyor...');
    setStatusType('');
    setResult(null);
    setIsLoading(true);

    try {
      if (!canTalkToExtension) {
        setStatus(
          'Chrome dışındasınız veya eklentiye erişim yok. Mock veri gösteriliyor.',
          'error'
        );
        setStatusType('error');
        setResult(sampleProfile);
        setIsLoading(false);
        return;
      }

      const response = await sendScrapeRequest(trimmedExtId, trimmedUrl);

      if (response?.status === 'success') {
        setStatus('Veri başarıyla geldi.');
        setStatusType('success');
        setResult(response.profile);
      } else {
        throw new Error(response?.reason || 'Bilinmeyen hata');
      }
    } catch (error) {
      console.error(error);
      setStatus(error.message);
      setStatusType('error');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="hero card">
        <p className="eyebrow">LinkedIn Relay</p>
        <h1>LinkedIn Profili Çekme</h1>
        <p>
          Chrome eklentisi ile konuşarak LinkedIn profilini otomatik açar ve
          veriyi bu sayfada gösterir.
        </p>
        <div className="hero-meta">
          <span className="pill">Canlı Demo</span>
          <span className="pill pill-muted">Beta</span>
        </div>
      </header>

      <main className="layout">
        <section className="card form-card">
          <form onSubmit={handleSubmit}>
            <div className="field-grid">
              <label className="field">
                <span>Extension ID</span>
                <input
                  type="text"
                  value={extensionId}
                  onChange={(e) => setExtensionId(e.target.value)}
                  placeholder="chrome://extensions → Ayrıntılar → ID"
                  required
                />
                {extensionIdHint && (
                  <p className="hint">{extensionIdHint}</p>
                )}
              </label>

              <label className="field">
                <span>LinkedIn Profil URL'si</span>
                <input
                  type="url"
                  value={profileUrl}
                  onChange={(e) => setProfileUrl(e.target.value)}
                  placeholder="https://www.linkedin.com/in/username/"
                  pattern="https://www.linkedin.com/in/.*"
                  required
                />
              </label>
            </div>

            <button type="submit" disabled={isLoading}>
              <span>{isLoading ? 'Yükleniyor...' : 'Profili Çek'}</span>
            </button>
          </form>

          {status && (
            <div className={`status ${statusType}`}>{status}</div>
          )}

          {result && (
            <section className="result">
              <div className="result-header">
                <div>
                  <p className="eyebrow">Sonuç</p>
                  <h2>Profil Verisi</h2>
                </div>
                <span className="pill pill-success">Hazır</span>
              </div>
              <div className="json-viewer-root">
                {ReactJson ? (
                  <ReactJson
                    src={result}
                    theme="monokai"
                    iconStyle="circle"
                    indentWidth={2}
                    collapsed={false}
                    displayObjectSize={true}
                    displayDataTypes={true}
                    enableClipboard={true}
                    quotesOnKeys={true}
                    sortKeys={false}
                  />
                ) : (
                  <pre>{JSON.stringify(result, null, 2)}</pre>
                )}
              </div>
            </section>
          )}
        </section>

        <section className="card info-card">
          <h2>Kurulum Özet</h2>
          <ol>
            <li>
              Eklentiyi <strong>chrome://extensions</strong> sayfasından
              yükleyin.
            </li>
            <li>
              Extension ID alanı otomatik gelir; farklıysa formdan güncelleyin.
            </li>
            <li>
              Bu sayfayı <strong>http(s)://localhost</strong> altında açın (ör.{' '}
              <code>npx serve web</code>).
            </li>
            <li>Tarayıcıda LinkedIn hesabınıza giriş yapın.</li>
            <li>Her istek yeni sekmede profili açar ve veriyi bu sayfaya yollar.</li>
          </ol>
          <p className="hint">
            Not: LinkedIn DOM yapısı sık değişebilir. Demo amaçlı temel alanlar
            (isim, başlık, lokasyon ve ilk 5 deneyim) parse edilir.
          </p>
        </section>
      </main>
    </div>
  );
}

// Render the app
ReactDOM.render(<App />, document.getElementById('root'));
