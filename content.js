(async function () {
  const READABILITY_URL = 'https://cdn.jsdelivr.net/npm/@mozilla/readability/Readability.js';
  const NOISE_PATTERNS = [
    /^skip to content/i, /^advertisement/i, /^announcement/i,
    /^loading\.\.\./i, /^please wait/i, /^subscribe now/i,
    /^click here/i, /^share this/i, /^follow us/i,
    /^copyright/i, /^all rights reserved/i, /^terms of service/i,
    /^privacy policy/i, /^cookie/i, /^\d+ comments/i,
    /^related (articles|posts|stories)/i, /^you might also like/i,
    /^recommended for you/i,
  ];
  function cleanInnerText(raw) {
    return raw.split('\n')
      .map(l => l.trim())
      .filter(l => {
        if (!l || l.length < 15) return false;
        if (NOISE_PATTERNS.some(p => p.test(l))) return false;
        return true;
      })
      .join('\n\n');
  }
  function fallbackExtract() {
    if (!document.body) {
      return { success: false, error: 'No document body' };
    }
    const raw = document.body.innerText || '';
    const text = cleanInnerText(raw);
    if (!text) {
      return { success: false, error: 'No meaningful text found in body' };
    }
    const title = document.title || '';
    return {
      success: true,
      title: title,
      text: text,
      length: text.length,
      excerpt: text.slice(0, 200),
      byline: '',
      _fallback: true,
    };
  }
  async function loadReadability() {
    if (typeof Readability !== 'undefined') return true;
    try {
      const resp = await fetch(READABILITY_URL);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const code = await resp.text();
      (0, eval)(code);
      return typeof Readability !== 'undefined';
    } catch (e) {
      console.error('[content] Failed to load Readability:', e);
      return false;
    }
  }
  function extractWithReadability() {
    if (!document.body) return null;
    const doc = document.cloneNode(true);
    const reader = new Readability(doc);
    const article = reader.parse();
    if (!article || !article.textContent || article.textContent.length < 50) return null;
    return {
      success: true,
      title: article.title || '',
      text: article.textContent || '',
      length: article.length || 0,
      excerpt: article.excerpt || '',
      byline: article.byline || '',
    };
  }
  function extractContent() {
    if (typeof Readability !== 'undefined') {
      const result = extractWithReadability();
      if (result) return result;
    }
    return fallbackExtract();
  }
  const loaded = await loadReadability();
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'EXTRACT_CONTENT') {
      const result = extractContent();
      sendResponse(result);
      return true;
    }
  });
})();