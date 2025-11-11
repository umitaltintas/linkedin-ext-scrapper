// linkedin profile scraper – resilient SPA/lazy-load aware
// GÜNCELLENMİŞ VERSİYON
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
    // multi-lingual matches (en/tr + loose)
    const patterns = [
      /see more|show more|open full text/i,
      /daha fazla gör|devamını oku/i,
       // "show all X experiences" gibi kalıpları da yakalamak için daha esnek bir yapı
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
    // GÜNCELLENDİ: Bölüm artık `id`'ye sahip bir `div`'i içeren `section`'dan bulunuyor.
    const anchor = document.querySelector('#experience');
    const section = anchor ? anchor.closest('section') : null;

    if (!section) return [];
    
    // item nodes (new & old)
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

      // company + employment type often appear on one line: "Company · Full-time"
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

      // Location can be on a separate muted row
      let location = null;
      const metaRows = Array.from(
        item.querySelectorAll('span.t-14.t-normal.t-black--light, .pv-entity__location span:nth-child(2)')
      )
        .map(textContent)
        .filter(Boolean);

      // Lokasyon genellikle duration'dan farklı olan ikinci meta satırıdır.
      const potentialLocations = metaRows.filter(r => r !== duration && !r.includes('ay') && !r.includes('yıl') && !r.includes('mo') && !r.includes('yr'));
      location = potentialLocations[0] || null;

      const description =
        textContent(
          item.querySelector(
            'div.inline-show-more-text, .pvs-list__outer-container div.inline, .pvs-entity__description'
          )
        ) || null;

      const logo =
        item.querySelector('a[data-field="experience_company_logo"] img, a.pvs-entity__image-container img')
          ?.src || null;

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
        companyLogo: logo,
        roleSkills
      };
    });

    return results;
  }

  function extractEducation() {
    // GÜNCELLENDİ: Bölüm artık `id`'ye sahip bir `div`'i içeren `section`'dan bulunuyor.
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

      const logo =
        item.querySelector('a.pvs-entity__image-container--outline-offset img, a[href*="/school/"] img')?.src || null;

      return { school, degree, field, dates, activities, description, logo };
    });
  }

  // ---------- skills ----------
  function normalizeProfilePath(profileUrl) {
    try {
      const url = new URL(profileUrl);
      const base = url.pathname.split('/details/')[0];
      return base.endsWith('/') ? base.slice(0, -1) : base;
    } catch (e) {
      debugLog('skills-path-error', { reason: e.message });
      return null;
    }
  }

  async function tryClickShowAllSkills() {
    const triggers = Array.from(document.querySelectorAll('a, button, [role="button"]'));
    // GÜNCELLENDİ: Regex, "17 yeteneğin tümünü göster" gibi dinamik sayıları da yakalayacak şekilde güncellendi.
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

  function parseSkillsFromDocument(doc) {
    const entities = Array.from(
      doc.querySelectorAll('[data-view-name="profile-component-entity"]')
    );
    if (!entities.length) return [];

    const skills = entities.map((item) => {
      const name =
        textContent(
          item.querySelector(
            'a[data-field="skill_page_skill_topic"] span[aria-hidden="true"], .t-bold span[aria-hidden="true"]'
          )
        ) || null;

      const detailItems = Array.from(item.querySelectorAll('.pvs-entity__sub-components li'));
      const detailTexts = detailItems.map(textContent).filter(Boolean);

      const endorsementsEntry = detailTexts.find((t) => /endorse|onay/i.test(t || ''));
      let endorsements = null;
      if (endorsementsEntry) {
        const digits = endorsementsEntry.replace(/[^0-9]/g, '');
        endorsements = digits ? Number(digits) : endorsementsEntry;
      }

      const assessmentPassed = detailTexts.some((t) =>
        /linkedin skill|linkedin yetenek/i.test(t || '')
      );

      const insights = detailTexts.filter(
        (t) => t && !/endorse|onay/i.test(t) && !/linkedin skill|linkedin yetenek/i.test(t)
      );

      const relatedLinks = Array.from(item.querySelectorAll('.pvs-entity__sub-components a')).map(
        (a) => ({ href: a.href, label: textContent(a) })
      );

      return { name, endorsements, assessmentPassed, insights, relatedLinks };
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
    // GÜNCELLENDİ: Bölüm seçicisi düzeltildi.
    const anchor = root.querySelector('#skills');
    const section = anchor ? anchor.closest('section') : null;
    
    if (!section) return [];

    const collected = [];
    section.querySelectorAll('li [data-view-name="profile-component-entity"]').forEach((item) => {
        const name =
          textContent(item.querySelector('.t-bold span[aria-hidden="true"]'));
        if (!name) return;

        const endorsementCount = null; // Bu yeni UI'da doğrudan görünmüyor.

        collected.push({
          name,
          endorsements: endorsementCount,
          assessmentPassed: false,
          insights: [],
          relatedLinks: []
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
    
    const inline = parseInlineSkills(document);
    debugLog('skills-inline-used', { count: inline.length });
    return inline;
  }

  // ---------- collector ----------
  async function collectProfile() {
    try {
      debugLog('collect-start', { href: location.href });
      await observeUntil('main');
      if (POST_MAIN_GRACE_MS) await delay(POST_MAIN_GRACE_MS);

      await autoScrollPage();
      await expandAllSeeMore();
      
      await waitForSelectors(['main h1']);
      // GÜNCELLENDİ: Bekleme seçicileri yeni yapıya uyarlandı.
      await waitForAnySelector(
        [
          '[data-view-name="profile-card"]:has(#experience) li',
        ],
        WAIT_FOR_SECTIONS_MS
      );
      await waitForAnySelector(
        [
          '[data-view-name="profile-card"]:has(#education) li',
        ],
        WAIT_FOR_SECTIONS_MS
      );
      await waitForAnySelector(
        [
          '[data-view-name="profile-card"]:has(#skills) li',
        ],
        WAIT_FOR_SECTIONS_MS
      );

      const name = queryText('main h1');
      const headline =
        queryText('.text-body-medium.break-words') || null;
      // GÜNCELLENDİ: Lokasyon seçicisi daha spesifik hale getirildi.
      const locationTxt =
        queryText('span.text-body-small.inline.t-black--light.break-words') || null;
      
      const aboutAnchor = document.querySelector('#about');
      const aboutSection = aboutAnchor ? aboutAnchor.closest('section') : null;
      const about = aboutSection ? textContent(aboutSection.querySelector('div.inline-show-more-text, div[data-test-id="about-section-show-more"]')) : null;

      const experiences = extractExperiences();
      const education = extractEducation();
      const skills = await extractSkills(window.location.href);

      if (!name) throw new Error('LinkedIn DOM not ready yet');

      debugLog('profile-ready', {
        name: !!name,
        exps: experiences.length,
        edus: education.length,
        skills: skills.length
      });

      safeSendMessage({
        action: 'profileScraped',
        profile: {
          name,
          headline,
          location: locationTxt,
          about,
          experiences,
          education,
          skills
        },
        debugLogs
      });
    } catch (error) {
      debugLog('profile-error', { reason: error.message || 'Unknown error', stack: error.stack });
      safeSendMessage({
        action: 'profileError',
        reason: error.message || 'Unknown error',
        debugLogs
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