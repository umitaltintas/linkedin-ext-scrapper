// linkedin profile scraper – resilient SPA/lazy-load aware
// GÜNCELLENMİŞ VERSİYON (Yetenekler sayfası HTML'i ile uyumlu)
if (!window.__linkedinScraperInjected) {
  window.__linkedinScraperInjected = true;

  const MAX_EXPERIENCES = 5;
  const MAX_SKILLS = 15;
  const MAX_EDUCATION = 4;

  // Timings (faster)
  const OBSERVER_TIMEOUT_MS = 6000;
  const WAIT_FOR_SECTIONS_MS = 12000;
  const WAIT_POLL_INTERVAL_MS = 250;
  const POST_MAIN_GRACE_MS = 400;

  const AUTO_SCROLL_STEPS = 10;
  const AUTO_SCROLL_STEP_PX = 800;
  const AUTO_SCROLL_DELAY_MS = 100;

  const STORAGE_KEY = '__linkedin_scraper_state_v2';
  const SKILLS_PATH_SEGMENT = '/details/skills';

  const debugLogs = [];

  // ---------- utils ----------
  const serializeMeta = (meta) => {
    if (meta == null) return meta;
    if (Array.isArray(meta)) return meta.map(serializeMeta);
    if (meta instanceof Error) return meta.message;
    if (typeof meta === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(meta)) out[k] = serializeMeta(v);
      return out;
    }
    if (typeof meta === 'function') return meta.name || 'function';
    return meta;
  };

  function debugLog(step, meta) {
    const entry = { step, timestamp: new Date().toISOString() };
    if (meta !== undefined) entry.meta = serializeMeta(meta);
    debugLogs.push(entry);
    try {
      console.debug?.('[linkedin-scraper]', step, entry.meta ?? '');
    } catch { }
  }

  const textContent = (el) =>
    el ? el.textContent.replace(/\s+/g, ' ').trim() : null;

  const queryText = (selector, root = document) =>
    textContent(root.querySelector(selector));

  function safeSendMessage(payload) {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(payload);
    } else {
      window.postMessage({ __linkedinScraper: true, ...payload }, '*');
    }
  }

  function savePendingState(data) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      debugLog('state-save-error', { reason: err.message });
    }
  }

  function loadPendingState() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      debugLog('state-load-error', { reason: err.message });
      return null;
    }
  }

  function clearPendingState() {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      debugLog('state-clear-error', { reason: err.message });
    }
  }

  function isSkillsPage() {
    return window.location.pathname.includes(SKILLS_PATH_SEGMENT);
  }

  function buildSkillsUrl(profilePath) {
    if (!profilePath) return null;
    const trimmed = profilePath.replace(/\/$/, '');
    const url = new URL(window.location.href);
    url.pathname = `${trimmed}/details/skills/`;
    url.search = '';
    url.hash = '';
    return url.toString();
  }

  function observeUntil(selector, timeout = OBSERVER_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(selector);
      if (existing) return resolve(existing);

      const obs = new MutationObserver(() => {
        const node = document.querySelector(selector);
        if (node) {
          obs.disconnect();
          resolve(node);
        }
      });
      obs.observe(document, { childList: true, subtree: true });
      setTimeout(() => {
        obs.disconnect();
        reject(new Error(`Timeout waiting for selector: ${selector}`));
      }, timeout);
    });
  }

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitForSelectors(selectors, timeout = WAIT_FOR_SECTIONS_MS) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (selectors.every((s) => document.querySelector(s))) return true;
      await delay(WAIT_POLL_INTERVAL_MS);
    }
    debugLog('sections-timeout', { selectors });
    return false;
  }

  async function waitForAnySelector(selectors, timeout = WAIT_FOR_SECTIONS_MS) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const hit = selectors.find((s) => document.querySelector(s));
      if (hit) return true;
      await delay(WAIT_POLL_INTERVAL_MS);
    }
    debugLog('section-any-timeout', { selectors });
    return false;
  }

  async function autoScrollPage() {
    debugLog('autoscroll-start');
    for (let i = 0; i < AUTO_SCROLL_STEPS; i++) {
      window.scrollBy(0, AUTO_SCROLL_STEP_PX);
      await delay(AUTO_SCROLL_DELAY_MS);
    }
    window.scrollTo({ top: 0 });
    debugLog('autoscroll-done');
  }

  function clickAllButtonsLike(patterns) {
    const btns = Array.from(document.querySelectorAll('button, a[role="button"], a.artdeco-button'));
    let count = 0;
    btns.forEach((b) => {
      const label = (b.innerText || b.getAttribute('aria-label') || '').toLowerCase();
      if (patterns.some((p) => p.test(label))) {
        b.click();
        count++;
      }
    });
    return count;
  }

  async function expandAllSeeMore() {
    const patterns = [
      /see more|show more|open full text/i,
      /daha fazla gör|devamını oku/i,
      /(tümünü göster|show all)/i
    ];
    let rounds = 0;
    while (rounds < 3) {
      const clicked = clickAllButtonsLike(patterns);
      debugLog('expand-round', { round: rounds + 1, clicked });
      if (!clicked) break;
      rounds++;
      await delay(500);
    }
  }

  // ---------- sections: experience / education ----------
  function extractExperiences() {
    const anchor = document.querySelector('#experience');
    const section = anchor ? anchor.closest('section') : null;

    if (!section) return [];
    
    const items =
      Array.from(section.querySelectorAll('[data-view-name="profile-component-entity"]')) ||
      [];

    const fallbackItems = Array.from(
      section.querySelectorAll('li.pvs-list__item, li.artdeco-list__item')
    ).filter((li) => li.querySelector('div.display-flex'));

    const nodes = items.length ? items : fallbackItems;

    const results = nodes.slice(0, MAX_EXPERIENCES).map((item) => {
      const title =
        textContent(
          item.querySelector(
            '.t-bold span[aria-hidden="true"], .mr1 span[aria-hidden="true"], .hoverable-link-text span[aria-hidden="true"], [data-field="experience_title"] span[aria-hidden="true"]'
          )
        ) || queryText('[data-field="experience_title"]', item);

      const companyLine =
        textContent(
          item.querySelector(
            '.t-14.t-normal span[aria-hidden="true"], .pv-entity__secondary-title, [data-field="experience_company_link"] span[aria-hidden="true"]'
          )
        ) || null;

      let company = companyLine || null;
      let employmentType = null;
      if (companyLine?.includes('·')) {
        const [c, ...rest] = companyLine.split('·').map((s) => s.trim());
        company = c || companyLine;
        employmentType = rest.join(' · ') || null;
      }

      const duration =
        textContent(
          item.querySelector(
            '.pvs-entity__caption-wrapper span[aria-hidden="true"], .pvs-entity__caption-wrapper, span.t-14.t-normal.t-black--light span[aria-hidden="true"]'
          )
        ) || null;

      let location = null;
      const metaRows = Array.from(
        item.querySelectorAll('span.t-14.t-normal.t-black--light, .pv-entity__location span:nth-child(2)')
      )
        .map(textContent)
        .filter(Boolean);

      const potentialLocations = metaRows.filter(r => r !== duration && !r.includes('ay') && !r.includes('yıl') && !r.includes('mo') && !r.includes('yr'));
      location = potentialLocations[0] || null;

      const description =
        textContent(
          item.querySelector(
            'div.inline-show-more-text, .pvs-list__outer-container div.inline, .pvs-entity__description'
          )
        ) || null;


      const roleSkills = Array.from(
        item.querySelectorAll('[data-field="position_contextual_skills_see_details"] strong')
      )
        .map(textContent)
        .filter(Boolean);

      return {
        title,
        company,
        employmentType,
        duration,
        location,
        description,
        roleSkills
      };
    });

    return results;
  }

  function extractEducation() {
    const anchor = document.querySelector('#education');
    const section = anchor ? anchor.closest('section') : null;

    if (!section) return [];

    const preferred = Array.from(
      section.querySelectorAll('[data-view-name="profile-component-entity"]')
    );
    const fallback = Array.from(section.querySelectorAll('li.pvs-list__item, li.artdeco-list__item'));
    const nodes = preferred.length ? preferred : fallback;

    return nodes.slice(0, MAX_EDUCATION).map((item) => {
      const school =
        textContent(
          item.querySelector(
            '.t-bold span[aria-hidden="true"], .hoverable-link-text span[aria-hidden="true"], .pv-entity__school-name, a[data-field="education_school"] span[aria-hidden="true"]'
          )
        ) || null;

      const degreeLine =
        textContent(
          item.querySelector(
            '.t-14.t-normal span[aria-hidden="true"], .pv-entity__degree-name span:nth-child(2), .pvs-entity__subtitle span:nth-child(2)'
          )
        ) || null;

      let degree = degreeLine || null;
      let field = null;
      if (degreeLine?.includes(',')) {
        const [d, ...rest] = degreeLine.split(',').map((s) => s.trim());
        degree = d;
        field = rest.join(', ') || null;
      } else {
        field =
          textContent(
            item.querySelector(
              '.pv-entity__fos span:nth-child(2), [data-field="education_field_of_study"] span[aria-hidden="true"]'
            )
          ) || null;
      }

      const dates =
        textContent(
          item.querySelector(
            '.pvs-entity__caption-wrapper span[aria-hidden="true"], span.pv-entity__dates span:nth-child(2)'
          )
        ) || null;

      const activities = textContent(
        item.querySelector('[data-field="education_activities_and_societies"] span[aria-hidden="true"]')
      );

      const description = textContent(
        item.querySelector('div.inline-show-more-text, .pvs-entity__description')
      );


      return { school, degree, field, dates, activities, description };
    });
  }

  // ---------- skills ----------
  function extractBaseProfilePath(pathname) {
    if (!pathname) return null;
    const match = pathname.match(/^\/in\/[^/]+/);
    return match ? match[0] : null;
  }

  function normalizeProfilePath(profileUrl) {
    if (!profileUrl) return null;
    try {
      const url = new URL(profileUrl);
      const base = extractBaseProfilePath(url.pathname);
      return base;
    } catch (e) {
      debugLog('skills-path-error', { reason: e.message });
      return null;
    }
  }

  function getCanonicalProfileUrl() {
    const canonical =
      document.querySelector('link[rel="canonical"]')?.href ||
      document.querySelector('meta[property="og:url"]')?.content ||
      null;
    return canonical;
  }

  function determineProfileBasePath() {
    const canonical = getCanonicalProfileUrl();
    const fromCanonical = normalizeProfilePath(canonical);
    if (fromCanonical) {
      debugLog('profile-path-canonical', { path: fromCanonical, canonical });
      return fromCanonical;
    }
    const fallback = normalizeProfilePath(window.location.href);
    if (fallback) {
      debugLog('profile-path-fallback', { path: fallback });
      return fallback;
    }
    debugLog('profile-path-missing');
    return null;
  }

  async function tryClickShowAllSkills() {
    const triggers = Array.from(document.querySelectorAll('a, button, [role="button"]'));
    const hit = triggers.find((el) => {
      const t = (el.innerText || el.getAttribute('aria-label') || '').toLowerCase();
      return /(show all|see all|tümünü göster) \d* (skills|yeteneğin|yetenek)/i.test(t);
    });
    if (hit) {
      hit.click();
      debugLog('skills-show-all-clicked');
      await delay(600);
      await autoScrollPage();
      await waitForAnySelector(
        ['[data-view-name="profile-component-entity"]', 'li.pvs-list__item'],
        8000
      );
      // "Tümünü göster" bir modal açmak yerine yeni bir sayfaya yönlendirebilir.
      // Bu durumda, güncel `document` nesnesini döndürmek yeterlidir.
      return document;
    }
    return null;
  }

  async function fetchSkillsDocument(profileUrl) {
    const profilePath = normalizeProfilePath(profileUrl || window.location.href);
    if (!profilePath) throw new Error('Could not determine profile path for skills page');

    const url = new URL(window.location.href);
    url.pathname = `${profilePath}/details/skills/`;
    url.hash = '';

    debugLog('skills-fetch-url', { url: url.toString() });

    const res = await fetch(url.toString(), {
      credentials: 'include',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'text/html, */*;q=0.1'
      }
    });

    debugLog('skills-fetch-response', { status: res.status });

    if (!res.ok) throw new Error(`Failed to load skills page (${res.status})`);

    const html = await res.text();
    const parser = new DOMParser();
    return parser.parseFromString(html, 'text/html');
  }

  /**
   * Bu fonksiyon, hem `fetch` ile çekilen `/details/skills` sayfasının HTML'ini
   * hem de "Tümünü göster" butonuna tıklandıktan sonra açılan sayfanın DOM'unu ayrıştırabilir.
   * Yapı, `data-view-name="profile-component-entity"` ve `.pvs-entity__sub-components` gibi
   * anahtar sınıflara dayandığı için dayanıklıdır.
   */
  function parseSkillsFromDocument(doc) {
    const entities = Array.from(
      doc.querySelectorAll('[data-view-name="profile-component-entity"]')
    );
    if (!entities.length) return [];

    const skills = entities.map((item) => {
      // Yetenek adı
      const name =
        textContent(
          item.querySelector(
            'a[data-field="skill_page_skill_topic"] span[aria-hidden="true"], .t-bold span[aria-hidden="true"]'
          )
        ) || null;

      // Yetenekle ilgili detaylar (onaylar, değerlendirmeler, deneyimler)
      const detailItems = Array.from(item.querySelectorAll('.pvs-entity__sub-components li'));
      const detailTexts = detailItems.map(textContent).filter(Boolean);

      // Onay (endorsement) sayısını bul ve ayıkla
      const endorsementsEntry = detailTexts.find((t) => /endorse|onay/i.test(t || ''));
      let endorsements = null;
      if (endorsementsEntry) {
        const digits = endorsementsEntry.replace(/[^0-9]/g, '');
        endorsements = digits ? Number(digits) : endorsementsEntry;
      }
      
      // Yetenek değerlendirmesini geçip geçmediğini kontrol et
      const assessmentPassed = detailTexts.some((t) =>
        /linkedin skill|linkedin yetenek/i.test(t || '')
      );
      
      // Diğer bilgileri (örneğin, "2 deneyim...") insight olarak kaydet
      const insights = detailTexts.filter(
        (t) => t && !/endorse|onay/i.test(t) && !/linkedin skill|linkedin yetenek/i.test(t)
      );

    

      return { name, endorsements, assessmentPassed, insights };
    });

    const seen = new Set();
    const out = [];
    for (const s of skills) {
      if (s.name && !seen.has(s.name)) {
        seen.add(s.name);
        out.push(s);
      }
      if (out.length >= MAX_SKILLS) break;
    }
    return out;
  }

  function parseInlineSkills(root) {
    const anchor = root.querySelector('#skills');
    const section = anchor ? anchor.closest('section') : null;
    
    if (!section) return [];

    const collected = [];
    section.querySelectorAll('li [data-view-name="profile-component-entity"]').forEach((item) => {
        const name =
          textContent(item.querySelector('.t-bold span[aria-hidden="true"]'));
        if (!name) return;

        const endorsementCount = null; // Bu UI'da doğrudan görünmüyor.

        collected.push({
          name,
          endorsements: endorsementCount,
          assessmentPassed: false,
          insights: []
        });
      });

    const seen = new Set();
    const out = [];
    for (const s of collected) {
      if (s.name && !seen.has(s.name)) {
        seen.add(s.name);
        out.push(s);
      }
      if (out.length >= MAX_SKILLS) break;
    }
    debugLog('skills-inline-return', { count: out.length });
    return out;
  }

  async function extractSkills(profileUrl) {
    // 1. "Tümünü göster" butonuna tıkla ve açılan sayfayı/modalı kullan
    try {
      const maybeDoc = await tryClickShowAllSkills();
      if (maybeDoc) {
        const parsed = parseSkillsFromDocument(maybeDoc);
        if (parsed.length) {
          debugLog('skills-from-show-all', { count: parsed.length });
          return parsed;
        }
      }
    } catch (e) {
      debugLog('skills-show-all-error', { reason: e.message });
    }

    // 2. /details/skills sayfasını fetch ile çek
    try {
      const doc = await fetchSkillsDocument(profileUrl);
      const parsed = parseSkillsFromDocument(doc);
      if (parsed.length) {
        debugLog('skills-from-details', { count: parsed.length });
        return parsed;
      }
      debugLog('skills-details-empty');
    } catch (e) {
      debugLog('skills-fetch-fallback', { reason: e.message });
    }
    
    // 3. Son çare olarak ana profildeki inline yetenekleri al
    const inline = parseInlineSkills(document);
    debugLog('skills-inline-used', { count: inline.length });
    return inline;
  }

  // ---------- collector ----------
  async function collectMainProfile() {
    debugLog('collect-main-start', { href: location.href });

    clearPendingState();

    await observeUntil('main');
    if (POST_MAIN_GRACE_MS) await delay(POST_MAIN_GRACE_MS);

    await autoScrollPage();
    await expandAllSeeMore();

    await waitForSelectors(['main h1']);
    await waitForAnySelector(['[data-view-name="profile-card"]:has(#experience) li'], WAIT_FOR_SECTIONS_MS);
    await waitForAnySelector(['[data-view-name="profile-card"]:has(#education) li'], WAIT_FOR_SECTIONS_MS);
    await waitForAnySelector(['[data-view-name="profile-card"]:has(#skills) li'], WAIT_FOR_SECTIONS_MS);

    const name = queryText('main h1');
    const headline = queryText('.text-body-medium.break-words') || null;
    const locationTxt = queryText('span.text-body-small.inline.t-black--light.break-words') || null;

    const aboutAnchor = document.querySelector('#about');
    const aboutSection = aboutAnchor ? aboutAnchor.closest('section') : null;
    const about = aboutSection
      ? textContent(
          aboutSection.querySelector('div.inline-show-more-text, div[data-test-id="about-section-show-more"]')
        )
      : null;

    if (!name) throw new Error('LinkedIn DOM not ready yet');

    const experiences = extractExperiences();
    const education = extractEducation();

    const partialProfile = {
      name,
      headline,
      location: locationTxt,
      about,
      experiences,
      education
    };

    debugLog('profile-main-ready', {
      exps: experiences.length,
      edus: education.length
    });

    const profilePath = determineProfileBasePath();
    const skillsUrl = buildSkillsUrl(profilePath);

    if (skillsUrl) {
      debugLog('navigate-skills', { skillsUrl });
      savePendingState({
        phase: 'awaitSkills',
        profileBasePath: profilePath,
        skillsUrl,
        partialProfile,
        logs: debugLogs.slice()
      });
      window.location.href = skillsUrl;
      return false;
    }

    debugLog('skills-navigation-unavailable');
    const skills = await extractSkills(window.location.href);

    debugLog('profile-ready', {
      exps: experiences.length,
      edus: education.length,
      skills: skills.length
    });

    safeSendMessage({
      action: 'profileScraped',
      profile: { ...partialProfile, skills },
      debugLogs
    });

    return true;
  }

  async function collectSkillsPhase() {
    const pending = loadPendingState();
    if (!pending || pending.phase !== 'awaitSkills') {
      debugLog('skills-phase-no-state');
      throw new Error('Skills page opened without pending state');
    }

    debugLog('collect-skills-start', { href: location.href });

    await observeUntil('main');
    if (POST_MAIN_GRACE_MS) await delay(POST_MAIN_GRACE_MS);
    await autoScrollPage();
    await expandAllSeeMore();
    await waitForAnySelector(
      ['[data-view-name="profile-component-entity"]', '.scaffold-finite-scroll__content li'],
      WAIT_FOR_SECTIONS_MS + 3000
    );

    const parsed = parseSkillsFromDocument(document);
    const skills = parsed.length ? parsed : parseInlineSkills(document);

    debugLog('skills-phase-complete', { skills: skills.length });

    const combinedLogs = [...(pending.logs || []), ...debugLogs];
    const profile = { ...(pending.partialProfile || {}), skills };

    clearPendingState();

    safeSendMessage({
      action: 'profileScraped',
      profile,
      debugLogs: combinedLogs
    });
  }

  async function collectProfile() {
    try {
      if (isSkillsPage()) {
        await collectSkillsPhase();
        return;
      }

      const delivered = await collectMainProfile();
      if (!delivered) {
        // Navigation to skills page initiated; response will be sent in the next phase.
        return;
      }
    } catch (error) {
      debugLog('profile-error', { reason: error.message || 'Unknown error', stack: error.stack });
      const pending = loadPendingState();
      const combinedLogs = pending?.logs ? [...pending.logs, ...debugLogs] : debugLogs;
      clearPendingState();
      safeSendMessage({
        action: 'profileError',
        reason: error.message || 'Unknown error',
        debugLogs: combinedLogs
      });
    }
  }

  // ---------- SPA navigation handling ----------
  function hookSpaNavigation(run) {
    const origPush = history.pushState;
    const origReplace = history.replaceState;

    function wrapped(fn) {
      return function () {
        const prev = location.href;
        const res = fn.apply(this, arguments);
        const now = location.href;
        if (prev !== now) {
          debugLog('spa-route-change', { from: prev, to: now });
          setTimeout(run, 800);
        }
        return res;
      };
    }

    history.pushState = wrapped(origPush);
    history.replaceState = wrapped(origReplace);
    window.addEventListener('popstate', () => {
      debugLog('spa-popstate');
      setTimeout(run, 800);
    });
  }

  // boot
  (function boot() {
    debugLog('content-script-init', { href: window.location.href });
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      collectProfile();
    } else {
      window.addEventListener('DOMContentLoaded', collectProfile, { once: true });
    }
    hookSpaNavigation(collectProfile);
  })();
}
