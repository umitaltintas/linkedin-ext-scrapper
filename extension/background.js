// linkedin profile scraper – Navigate to Skills Page Strategy
if (!window.__linkedinScraperInjected) {
  window.__linkedinScraperInjected = true;

  // --- CONFIGURATION ---
  const STORAGE_KEY = 'li_scraper_pending_data';
  const MAX_EXPERIENCES = 50; // Detay sayfasında limit takılmaya gerek yok
  const MAX_SKILLS = 50;
  const MAX_EDUCATION = 10;

  // Timings
  const WAIT_FOR_SECTIONS_MS = 10000;
  const WAIT_POLL_INTERVAL_MS = 250;
  const AUTO_SCROLL_STEPS = 15;
  const AUTO_SCROLL_STEP_PX = 800;
  const AUTO_SCROLL_DELAY_MS = 150;

  // --- LOGGING & UTILS ---
  const debugLogs = [];

  function debugLog(step, meta) {
    const entry = { step, timestamp: new Date().toISOString(), meta };
    debugLogs.push(entry);
    try { console.debug('[linkedin-scraper]', step, meta || ''); } catch {}
  }

  const textContent = (el) => el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
  const queryText = (selector, root = document) => textContent(root.querySelector(selector));
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  function safeSendMessage(payload) {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(payload);
    } else {
      window.postMessage({ __linkedinScraper: true, ...payload }, '*');
    }
  }

  async function autoScrollPage() {
    debugLog('autoscroll-start');
    const totalHeight = document.body.scrollHeight;
    let currentHeight = 0;
    
    while(currentHeight < totalHeight) {
        window.scrollBy(0, AUTO_SCROLL_STEP_PX);
        currentHeight += AUTO_SCROLL_STEP_PX;
        await delay(AUTO_SCROLL_DELAY_MS);
        // Yeni içerik yüklendikçe sayfa uzayabilir
        if(document.body.scrollHeight > totalHeight) {
            // Infinite scroll algılandı, devam et
        }
    }
    // Sayfanın en altına gelindiğinde, footer altındaki "Daha fazla göster" butonlarını kontrol et
    clickAllButtonsLike([/daha fazla göster|show more/i]);
    await delay(1000);
    window.scrollTo(0, 0); // Başa dön
    debugLog('autoscroll-done');
  }

  function clickAllButtonsLike(patterns) {
    const btns = Array.from(document.querySelectorAll('button, a[role="button"], .artdeco-button'));
    let count = 0;
    btns.forEach((b) => {
      const label = (b.innerText || b.getAttribute('aria-label') || '').toLowerCase();
      // Görünür mü kontrolü
      if (b.offsetParent === null) return; 
      
      if (patterns.some((p) => p.test(label))) {
        try { b.click(); count++; } catch(e) {}
      }
    });
    return count;
  }

  async function expandAllSeeMore() {
    const patterns = [/see more|show more|open full text/i, /daha fazla|tümünü gör|devamını oku/i];
    for(let i=0; i<3; i++) {
      if(!clickAllButtonsLike(patterns)) break;
      await delay(500);
    }
  }

  async function waitForSelector(selector, timeout = 5000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
          if (document.querySelector(selector)) return true;
          await delay(200);
      }
      return false;
  }

  // --- EXTRACTORS (Main Page) ---

  function extractExperiences(doc = document) {
    const anchor = doc.querySelector('#experience');
    const section = anchor ? anchor.closest('section') : null;
    if (!section) return [];

    // Ana sayfada genellikle ilk 3-5 tane görünür, detay sayfasına gitmeye gerek yoksa buradan alırız
    // Ama kullanıcı skills sayfasına gitmek istediği için burayı basit tutuyoruz.
    const items = Array.from(section.querySelectorAll('[data-view-name="profile-component-entity"]'));
    
    return items.map((item) => {
        const title = textContent(item.querySelector('.t-bold span[aria-hidden="true"]'));
        const companyLine = textContent(item.querySelector('.t-14.t-normal span[aria-hidden="true"]'));
        let company = companyLine;
        if (companyLine?.includes('·')) {
            company = companyLine.split('·')[0].trim();
        }
        const duration = textContent(item.querySelector('.pvs-entity__caption-wrapper span[aria-hidden="true"]'));
        const location = textContent(item.querySelector('.pv-entity__location span:nth-child(2)')) || 
                         textContent(item.querySelector('span.t-14.t-normal.t-black--light + span.t-14.t-normal.t-black--light span[aria-hidden="true"]'));
        
        return { title, company, duration, location };
    }).slice(0, MAX_EXPERIENCES);
  }

  function extractEducation(doc = document) {
    const anchor = doc.querySelector('#education');
    const section = anchor ? anchor.closest('section') : null;
    if (!section) return [];

    const items = Array.from(section.querySelectorAll('[data-view-name="profile-component-entity"]'));
    return items.map(item => {
        const school = textContent(item.querySelector('.t-bold span[aria-hidden="true"]'));
        const degree = textContent(item.querySelector('.t-14.t-normal span[aria-hidden="true"]'));
        return { school, degree };
    }).slice(0, MAX_EDUCATION);
  }

  // --- EXTRACTORS (Skills Page) ---

  function extractSkillsFromDetailsPage() {
    // Skills sayfası yapısı: scaffold-finite-scroll içinde ul ve li'ler
    const items = Array.from(document.querySelectorAll('[data-view-name="profile-component-entity"]'));
    
    const skills = items.map(item => {
        // Yetenek Adı
        const nameEl = item.querySelector('.t-bold span[aria-hidden="true"]');
        if (!nameEl) return null;
        const name = textContent(nameEl);

        // Alt bileşenler (Onay sayısı, sınav vs.)
        const subItems = Array.from(item.querySelectorAll('.pvs-entity__sub-components li'));
        const subTexts = subItems.map(textContent).filter(Boolean);

        // Onay sayısı (örn: "1 onay")
        const endorsementStr = subTexts.find(t => /onay|endorse/i.test(t));
        let endorsements = 0;
        if (endorsementStr) {
            const match = endorsementStr.match(/\d+/);
            if (match) endorsements = parseInt(match[0], 10);
        }

        const passedAssessment = subTexts.some(t => /assessment|değerlendirme/i.test(t) && /passed|geçti/i.test(t));

        return { name, endorsements, passedAssessment };
    }).filter(Boolean);

    // Tekrarlananları temizle (Set kullanarak)
    const uniqueSkills = [];
    const seen = new Set();
    skills.forEach(s => {
        if(!seen.has(s.name)) {
            seen.add(s.name);
            uniqueSkills.push(s);
        }
    });

    return uniqueSkills.slice(0, MAX_SKILLS);
  }

  // --- MAIN LOGIC FLOW ---

  async function processMainProfilePage() {
    debugLog('phase-1-start', { url: window.location.href });
    
    await waitForSelector('main h1');
    await delay(1000); // DOM stability
    await autoScrollPage();
    await expandAllSeeMore();

    // 1. Temel verileri al
    const name = queryText('main h1');
    const headline = queryText('.text-body-medium.break-words');
    const locationTxt = queryText('span.text-body-small.inline.t-black--light.break-words');
    const aboutAnchor = document.querySelector('#about');
    const aboutSection = aboutAnchor ? aboutAnchor.closest('section') : null;
    const about = aboutSection ? textContent(aboutSection.querySelector('div.inline-show-more-text')) : null;

    const experiences = extractExperiences();
    const education = extractEducation();

    // 2. Verileri paketle
    const partialData = {
        name,
        headline,
        location: locationTxt,
        about,
        experiences,
        education,
        skills: [] // Henüz boş
    };

    // 3. Skills bölümü var mı kontrol et
    const skillsAnchor = document.querySelector('#skills');
    const skillsSection = skillsAnchor ? skillsAnchor.closest('section') : null;

    if (skillsSection) {
        // Skills detay URL'ini bul
        // Genellikle footer'da "Tüm yetenekleri göster" butonu linki vardır
        // Veya URL yapısını tahmin edebiliriz: /in/{user}/details/skills/
        
        let skillsUrl = null;
        
        // Yöntem A: Butondan link al
        const seeAllLink = skillsSection.querySelector('a[id*="navigation-index-"]');
        if (seeAllLink) {
            skillsUrl = seeAllLink.href;
        } else {
            // Yöntem B: URL manipülasyonu (daha güvenilir olabilir)
            const currentUrl = new URL(window.location.href);
            // /in/username/ veya /in/username kısımlarını temizle
            let path = currentUrl.pathname;
            if(path.endsWith('/')) path = path.slice(0, -1);
            skillsUrl = `${currentUrl.origin}${path}/details/skills/`; 
        }

        debugLog('navigating-to-skills', { url: skillsUrl });
        
        // Veriyi kaydet
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(partialData));
        
        // Yönlendir
        window.location.href = skillsUrl;
    } else {
        // Skills bölümü yoksa, işlemi burada bitir
        debugLog('no-skills-section-found');
        safeSendMessage({
            action: 'profileScraped',
            profile: partialData,
            debugLogs
        });
    }
  }

  async function processSkillsPage() {
    debugLog('phase-2-start', { url: window.location.href });

    // 1. Bekleyen veri var mı?
    const pendingDataStr = sessionStorage.getItem(STORAGE_KEY);
    if (!pendingDataStr) {
        debugLog('no-pending-data', 'Running in standalone mode or manual navigation');
        // Eğer script manuel çalıştırıldıysa sadece skills dönebiliriz veya hata vermeyiz.
        // Ancak akışın devamı için return ediyoruz.
        return; 
    }

    const profileData = JSON.parse(pendingDataStr);

    // 2. Sayfanın yüklenmesini ve scroll edilmesini bekle
    await waitForSelector('.scaffold-finite-scroll');
    await delay(1000);
    await autoScrollPage(); // Tüm yeteneklerin yüklenmesi için scroll şart

    // 3. Yetenekleri topla
    const skills = extractSkillsFromDetailsPage();
    debugLog('skills-extracted', { count: skills.length });

    // 4. Veriyi birleştir
    profileData.skills = skills;

    // 5. Temizlik
    sessionStorage.removeItem(STORAGE_KEY);

    // 6. Sonucu gönder
    safeSendMessage({
        action: 'profileScraped',
        profile: profileData,
        debugLogs
    });

    // İsteğe bağlı: Ana profile geri dön veya kullanıcıya bildirim göster
    console.log("Scraping completed via Navigation flow.");
  }

  // --- BOOTSTRAP ---
  (function boot() {
    const url = window.location.href;
    
    if (url.includes('/details/skills')) {
        // Detay sayfasındayız
        if (document.readyState === 'complete') {
            processSkillsPage();
        } else {
            window.addEventListener('load', processSkillsPage);
        }
    } else if (url.includes('/in/') && !url.includes('/details/')) {
        // Ana profil sayfasındayız
        if (document.readyState === 'complete') {
            processMainProfilePage();
        } else {
            window.addEventListener('load', processMainProfilePage);
        }
    } else {
        debugLog('unknown-page-type', { url });
    }
  })();
}