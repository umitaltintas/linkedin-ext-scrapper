if (!window.__linkedinScraperInjected) {
  window.__linkedinScraperInjected = true;

  const MAX_EXPERIENCES = 5;
  const MAX_SKILLS = 15;
  const MAX_EDUCATION = 4;
  const OBSERVER_TIMEOUT_MS = 10000;
  const debugLogs = [];
  const WAIT_FOR_SECTIONS_MS = 15000;
  const WAIT_POLL_INTERVAL_MS = 400;
  const POST_MAIN_GRACE_MS = 1200;

  function serializeMeta(meta) {
    if (meta == null) return meta;
    if (Array.isArray(meta)) {
      return meta.map((value) => serializeMeta(value));
    }
    if (meta instanceof Error) {
      return meta.message;
    }
    if (typeof meta === 'object') {
      const result = {};
      Object.entries(meta).forEach(([key, value]) => {
        result[key] = serializeMeta(value);
      });
      return result;
    }
    if (typeof meta === 'function') {
      return meta.name || 'function';
    }
    return meta;
  }

  function debugLog(step, meta) {
    const entry = {
      step,
      timestamp: new Date().toISOString()
    };
    if (meta !== undefined) {
      entry.meta = serializeMeta(meta);
    }
    debugLogs.push(entry);
    if (typeof console !== 'undefined' && typeof console.debug === 'function') {
      console.debug('[linkedin-scraper]', step, entry.meta || '');
    }
  }

  debugLog('content-script-init', { href: window.location.href });

  function textContent(el) {
    return el ? el.textContent.trim().replace(/\s+/g, ' ') : null;
  }

  function queryText(selector) {
    const el = document.querySelector(selector);
    return textContent(el);
  }

  function observeUntil(selector, timeout = OBSERVER_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(selector);
      if (existing) {
        resolve(existing);
        return;
      }

      const observer = new MutationObserver(() => {
        const node = document.querySelector(selector);
        if (node) {
          observer.disconnect();
          resolve(node);
        }
      });

      observer.observe(document, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timeout waiting for selector: ${selector}`));
      }, timeout);
    });
  }

  function extractExperiences() {
    const experienceSection =
      document.querySelector('section[id="experience"]') ||
      document.querySelector('section[data-view-name="profile-component-EXPERIENCE"]') ||
      document.querySelector('#experience + div');

    if (!experienceSection) return [];

    const preferredItems = Array.from(
      experienceSection.querySelectorAll('[data-view-name="profile-component-entity"]')
    );
    const fallbackItems = Array.from(
      experienceSection.querySelectorAll('li.artdeco-list__item, li.pvs-list__item')
    ).filter((item) => item.querySelector('div.display-flex'));
    const items = preferredItems.length ? preferredItems : fallbackItems;

    return items.slice(0, MAX_EXPERIENCES).map((item) => {
      const title =
        textContent(
          item.querySelector(
            '.t-bold span[aria-hidden="true"], .mr1 span[aria-hidden="true"], .hoverable-link-text span[aria-hidden="true"]'
          )
        ) || textContent(item.querySelector('[data-field="experience_title"]'));

      const companyLine =
        textContent(
          item.querySelector(
            '.t-14.t-normal span[aria-hidden="true"], .pv-entity__secondary-title, [data-field="experience_company_link"] span[aria-hidden="true"]'
          )
        ) || null;

      let company = companyLine;
      let employmentType = null;
      if (companyLine?.includes('·')) {
        const [primary, ...rest] = companyLine.split('·').map((chunk) => chunk.trim());
        company = primary || companyLine;
        employmentType = rest.join(' · ') || null;
      }

      const duration =
        textContent(
          item.querySelector(
            '.pvs-entity__caption-wrapper span[aria-hidden="true"], .pvs-entity__caption-wrapper, span.t-14.t-normal.t-black--light span[aria-hidden="true"]'
          )
        ) || null;

      let location = null;
      const metaRows = Array.from(item.querySelectorAll('span.t-14.t-normal.t-black--light'))
        .map((node) => textContent(node))
        .filter(Boolean);
      if (metaRows.length > 1) {
        location = metaRows.find((row) => row !== duration) || metaRows[1];
      } else {
        location =
          textContent(
            item.querySelector(
              '.pv-entity__location span:nth-child(2), [data-field="positionLocation"] span[aria-hidden="true"]'
            )
          ) || null;
      }

      const description = textContent(
        item.querySelector(
          'div.inline-show-more-text, .pvs-list__outer-container div.inline, .pvs-entity__description'
        )
      );

      const logoSrc = item.querySelector('a[data-field="experience_company_logo"] img')?.src || null;

      const roleSkills = Array.from(
        item.querySelectorAll('[data-field="position_contextual_skills_see_details"] strong')
      )
        .map((node) => textContent(node))
        .filter(Boolean);

      return {
        title,
        company,
        employmentType,
        duration,
        location,
        description,
        companyLogo: logoSrc,
        roleSkills
      };
    });
  }

  function extractEducation() {
    const educationSection =
      document.querySelector('section[id="education"]') ||
      document.querySelector('section[data-view-name="profile-component-EDUCATION"]');

    if (!educationSection) return [];

    const preferredItems = Array.from(
      educationSection.querySelectorAll('[data-view-name="profile-component-entity"]')
    );
    const fallbackItems = Array.from(
      educationSection.querySelectorAll('li.artdeco-list__item, li.pvs-list__item')
    );
    const eduItems = preferredItems.length ? preferredItems : fallbackItems;

    return eduItems.slice(0, MAX_EDUCATION).map((item) => {
      const school =
        textContent(
          item.querySelector(
            '.t-bold span[aria-hidden="true"], .hoverable-link-text span[aria-hidden="true"], .pv-entity__school-name'
          )
        ) || textContent(item.querySelector('a[data-field="education_school"] span[aria-hidden="true"]'));

      const degreeLine =
        textContent(
          item.querySelector(
            '.t-14.t-normal span[aria-hidden="true"], .pv-entity__degree-name span:nth-child(2), .pvs-entity__subtitle span:nth-child(2)'
          )
        ) || null;

      let degree = degreeLine;
      let field = null;
      if (degreeLine?.includes(',')) {
        const [deg, ...rest] = degreeLine.split(',').map((chunk) => chunk.trim());
        degree = deg;
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
        item.querySelector('a.pvs-entity__image-container--outline-offset img')?.src || null;

      return { school, degree, field, dates, activities, description, logo };
    });
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForSelectors(selectors, timeout = WAIT_FOR_SECTIONS_MS) {
    const start = Date.now();
    const missing = () => selectors.filter((selector) => !document.querySelector(selector));

    while (Date.now() - start < timeout) {
      const remaining = missing();
      if (!remaining.length) {
        debugLog('sections-ready', { selectors });
        return true;
      }
      await delay(WAIT_POLL_INTERVAL_MS);
    }

    debugLog('sections-timeout', { selectors });
    return false;
  }

  async function waitForAnySelector(selectors, timeout = WAIT_FOR_SECTIONS_MS) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const hit = selectors.find((selector) => document.querySelector(selector));
      if (hit) {
        debugLog('section-any-ready', { selector: hit });
        return true;
      }
      await delay(WAIT_POLL_INTERVAL_MS);
    }
    debugLog('section-any-timeout', { selectors });
    return false;
  }

  function normalizeProfilePath(profileUrl) {
    try {
      const url = new URL(profileUrl);
      const basePath = url.pathname.split('/details/')[0];
      return basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
    } catch (error) {
      console.warn('Failed to parse profile URL', error);
      debugLog('skills-path-error', { reason: error.message });
      return null;
    }
  }

  async function fetchSkillsDocument(profileUrl) {
    const profilePath = normalizeProfilePath(profileUrl || window.location.href);
    if (!profilePath) {
      throw new Error('Could not determine profile path for skills page');
    }

    const url = new URL(window.location.href);
    url.pathname = `${profilePath}/details/skills/`;
    url.hash = '';

    debugLog('skills-fetch-url', { url: url.toString() });

    const response = await fetch(url.toString(), {
      credentials: 'include',
      headers: {
        'X-Requested-With': 'XMLHttpRequest'
      }
    });

    debugLog('skills-fetch-response', { status: response.status });

    if (!response.ok) {
      debugLog('skills-fetch-error-status', { status: response.status });
      throw new Error(`Failed to load skills page (${response.status})`);
    }

    const html = await response.text();
    const parser = new DOMParser();
    return parser.parseFromString(html, 'text/html');
  }

  function parseSkillsFromDocument(doc) {
    const entities = Array.from(
      doc.querySelectorAll('[data-view-name="profile-component-entity"]')
    );

    debugLog('skills-details-found', { count: entities.length });

    if (!entities.length) return [];

    return entities.slice(0, MAX_SKILLS).map((item) => {
      const name =
        textContent(
          item.querySelector(
            'a[data-field="skill_page_skill_topic"] span[aria-hidden="true"], .t-bold span[aria-hidden="true"]'
          )
        ) || null;

      const detailItems = Array.from(
        item.querySelectorAll('.pvs-entity__sub-components li')
      );
      const detailTexts = detailItems.map((detail) => textContent(detail)).filter(Boolean);

      const endorsementsEntry = detailTexts.find((text) => /onay/i.test(text));
      let endorsements = null;
      if (endorsementsEntry) {
        const match = endorsementsEntry.replace(/[^0-9]/g, '');
        endorsements = match ? Number(match) : endorsementsEntry;
      }

      const assessmentPassed = detailTexts.some((text) =>
        /LinkedIn Yetenek/i.test(text || '')
      );

      const insights = detailTexts.filter(
        (text) =>
          text &&
          !/onay/i.test(text) &&
          !/LinkedIn Yetenek/i.test(text)
      );

      const relatedLinks = Array.from(
        item.querySelectorAll('.pvs-entity__sub-components a')
      ).map((anchor) => ({
        href: anchor.href,
        label: textContent(anchor)
      }));

      return {
        name,
        endorsements,
        assessmentPassed,
        insights,
        relatedLinks
      };
    });
  }

  function parseInlineSkills(root) {
    const skillsSections = [
      root.querySelector('section[id="skills"]'),
      root.querySelector('section[data-view-name="profile-component-SKILLS"]'),
      root.querySelector('.pv-skill-categories-section')
    ].filter(Boolean);

    if (!skillsSections.length) return [];

    const collected = [];

    skillsSections.forEach((section) => {
      const items = section.querySelectorAll('li');
      items.forEach((item) => {
        const name =
          textContent(item.querySelector('span.mr1 span[aria-hidden="true"]')) ||
          textContent(item.querySelector('span.pv-skill-category-entity__name-text'));

        if (!name) return;

        const endorsementCount = textContent(
          item.querySelector('.pv-skill-entity__endorsement-count, .t-12.t-black--light')
        );

        collected.push({
          name,
          endorsements: endorsementCount || null,
          assessmentPassed: false,
          insights: [],
          relatedLinks: []
        });
      });
    });

    const deduped = [];
    const seen = new Set();
    collected.forEach((skill) => {
      if (skill.name && !seen.has(skill.name)) {
        deduped.push(skill);
        seen.add(skill.name);
      }
    });

    const result = deduped.slice(0, MAX_SKILLS);
    debugLog('skills-inline-return', { count: result.length });
    return result;
  }

  async function extractSkills(profileUrl) {
    try {
      const doc = await fetchSkillsDocument(profileUrl);
      const parsed = parseSkillsFromDocument(doc);
      if (parsed.length) {
        debugLog('skills-details-used', { count: parsed.length });
        return parsed;
      }
      debugLog('skills-details-empty');
    } catch (error) {
      console.warn('Falling back to inline skills', error);
      debugLog('skills-fetch-fallback', { reason: error.message });
    }

    const inlineSkills = parseInlineSkills(document);
    debugLog('skills-inline-used', { count: inlineSkills.length });
    return inlineSkills;
  }

  async function collectProfile() {
    try {
      debugLog('collect-start');
      debugLog('wait-for-main');
      await observeUntil('main');
      debugLog('dom-ready');
      if (POST_MAIN_GRACE_MS) {
        await delay(POST_MAIN_GRACE_MS);
        debugLog('post-main-grace', { ms: POST_MAIN_GRACE_MS });
      }
      await waitForSelectors(['main h1']);
      await waitForAnySelector(
        [
          'section[id="experience"] li',
          'section[data-view-name="profile-component-EXPERIENCE"] [data-view-name="profile-component-entity"]'
        ],
        WAIT_FOR_SECTIONS_MS
      );
      await waitForAnySelector(
        [
          'section[id="education"] li',
          'section[data-view-name="profile-component-EDUCATION"] [data-view-name="profile-component-entity"]'
        ],
        WAIT_FOR_SECTIONS_MS
      );
      await waitForAnySelector(
        [
          'section[id="skills"] li',
          'section[data-view-name="profile-component-SKILLS"] li',
          '.pv-skill-categories-section li'
        ],
        WAIT_FOR_SECTIONS_MS
      );
      const name = queryText('main h1');
      const headline =
        queryText('.pv-text-details__left-panel .text-body-medium, .text-body-medium.break-words');
      const location = queryText(
        '.pv-text-details__left-panel .text-body-small, .inline.t-black--light.break-words'
      );
      const about = textContent(
        document.querySelector('section[id="about"] div.inline-show-more-text, section[data-view-name="profile-component-ABOUT"] div')
      );
      const experiences = extractExperiences();
      const education = extractEducation();
      const skills = await extractSkills(window.location.href);

      debugLog('profile-basic', { hasName: Boolean(name) });
      debugLog('profile-counts', {
        experiences: experiences.length,
        education: education.length,
        skills: skills.length
      });

      if (!name) {
        throw new Error('LinkedIn DOM not ready yet');
      }

      debugLog('profile-ready');

      chrome.runtime.sendMessage({
        action: 'profileScraped',
        profile: { name, headline, location, about, experiences, education, skills },
        debugLogs
      });
    } catch (error) {
      debugLog('profile-error', { reason: error.message || 'Unknown error' });
      chrome.runtime.sendMessage({
        action: 'profileError',
        reason: error.message || 'Unknown error',
        debugLogs
      });
    }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    collectProfile();
  } else {
    window.addEventListener('DOMContentLoaded', collectProfile, { once: true });
  }
}
