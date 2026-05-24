const $ = (id) => document.getElementById(id);
const startBtn = $('startBtn');
const statusBar = $('statusBar');
const spinner = $('spinner');
const statusText = $('statusText');
const resultArea = $('resultArea');
const emptyState = $('emptyState');
const settingsModal = $('settingsModal');
const settingsBtn = $('settingsBtn');
const modalCloseBtn = $('modalCloseBtn');
const saveConfigBtn = $('saveConfigBtn');
const apiKeyInput = $('apiKeyInput');
const endpointInput = $('endpointInput');
const modelInput = $('modelInput');
const formError = $('formError');
const STORAGE_KEYS = {
  LLM_API_KEY: 'llmApiKey',
  LLM_ENDPOINT: 'llmEndpoint',
  LLM_MODEL: 'llmModel',
};
const DEFAULTS = {
  endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  model: 'qwen-long',
};
async function loadConfig() {
  const data = await chrome.storage.local.get([STORAGE_KEYS.LLM_API_KEY, STORAGE_KEYS.LLM_ENDPOINT, STORAGE_KEYS.LLM_MODEL]);
  return {
    apiKey: data[STORAGE_KEYS.LLM_API_KEY] || '',
    endpoint: data[STORAGE_KEYS.LLM_ENDPOINT] || DEFAULTS.endpoint,
    model: data[STORAGE_KEYS.LLM_MODEL] || DEFAULTS.model,
  };
}
async function saveConfig(apiKey, endpoint, model) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.LLM_API_KEY]: apiKey,
    [STORAGE_KEYS.LLM_ENDPOINT]: endpoint || DEFAULTS.endpoint,
    [STORAGE_KEYS.LLM_MODEL]: model || DEFAULTS.model,
  });
}
function openSettings() {
  loadConfig().then(cfg => {
    apiKeyInput.value = cfg.apiKey;
    endpointInput.value = cfg.endpoint;
    modelInput.value = cfg.model;
    formError.classList.add('hidden');
  });
  settingsModal.classList.remove('hidden');
}
function closeSettings() {
  settingsModal.classList.add('hidden');
}
async function ensureConfigOrShowSettings() {
  const cfg = await loadConfig();
  if (!cfg.apiKey) {
    openSettings();
    return false;
  }
  return true;
}
function setStatus(type, text, showSpinner = false) {
  statusBar.className = 'status-bar ' + type;
  statusText.textContent = text;
  spinner.classList.toggle('hidden', !showSpinner);
  statusBar.classList.remove('hidden');
}
function hideStatus() {
  statusBar.classList.add('hidden');
}
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
function renderResult(data) {
  resultArea.classList.add('visible');
  emptyState.style.display = 'none';
  $('thesisText').textContent = data.core_thesis || '(无核心论点)';
  const argsContainer = $('argumentsContainer');
  argsContainer.innerHTML = '';
  if (data.key_arguments && data.key_arguments.length > 0) {
    data.key_arguments.forEach((arg, i) => {
      const div = document.createElement('div');
      div.className = 'argument-item';
      div.innerHTML = `
        <div class="argument-header">
          <span class="argument-num">${i + 1}</span>
          <span class="argument-text">${escapeHTML(arg.argument)}</span>
        </div>
        ${arg.original_quote ? `<div class="original-quote">${escapeHTML(arg.original_quote)}</div>` : ''}
      `;
      argsContainer.appendChild(div);
    });
  } else {
    argsContainer.innerHTML = '<div style="color: var(--md-text-hint); font-size: 13px;">本文无明确论点链（纯资讯报道）</div>';
  }
  $('evidenceText').textContent = data.supporting_evidence || '(未提供)';
  $('conclusionText').textContent = data.conclusion || '(未提供)';
  const termsContainer = $('termsContainer');
  termsContainer.innerHTML = '';
  if (data.technical_terms && data.technical_terms.length > 0) {
    data.technical_terms.forEach(term => {
      const div = document.createElement('div');
      div.className = 'term-item';
      const enDisplay = term.term_en ? ` (${escapeHTML(term.term_en)})` : '';
      div.innerHTML = `
        <div class="term-name">${escapeHTML(term.term)}${enDisplay}</div>
        <div class="term-def">${escapeHTML(term.definition)}</div>
      `;
      termsContainer.appendChild(div);
    });
  } else {
    termsContainer.innerHTML = '<div style="color: var(--md-text-hint); font-size: 13px;">未发现专业术语</div>';
  }
  const readingContainer = $('readingContainer');
  readingContainer.innerHTML = '';
  if (data.reading_recommendation) {
    const rec = data.reading_recommendation;
    const badgeText = rec.need_deep_read ? '建议精读' : '可跳过';
    const badgeClass = rec.need_deep_read ? 'deep' : 'skip';
    let html = `<div class="reading-badge ${badgeClass}">${badgeText}</div>`;
    html += `<div class="reading-reason">${escapeHTML(rec.reason || '')}</div>`;
    if (rec.highlight_sections && rec.highlight_sections.length > 0) {
      html += '<div style="margin-top:8px;font-size:12px;color:var(--md-text-hint);margin-bottom:4px;">重点阅读：</div>';
      rec.highlight_sections.forEach(section => {
        html += `<div class="highlight-item">${escapeHTML(section)}</div>`;
      });
    }
    readingContainer.innerHTML = html;
  }
  if (data.metadata && data.metadata.article_type) {
    const badge = document.createElement('div');
    badge.className = 'article-type-badge';
    badge.textContent = data.metadata.article_type;
    $('conclusionCard').querySelector('.card-body').appendChild(badge);
  }
}
settingsBtn.addEventListener('click', openSettings);
modalCloseBtn.addEventListener('click', closeSettings);
settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) closeSettings();
});
saveConfigBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    formError.textContent = '请输入 API 密钥';
    formError.classList.remove('hidden');
    return;
  }
  formError.classList.add('hidden');
  await saveConfig(key, endpointInput.value.trim(), modelInput.value.trim());
  closeSettings();
  setStatus('success', '配置已保存');
  setTimeout(hideStatus, 2000);
});
apiKeyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveConfigBtn.click();
});
(async function init() {
  await ensureConfigOrShowSettings();
})();
startBtn.addEventListener('click', async () => {
  const hasConfig = await ensureConfigOrShowSettings();
  if (!hasConfig) return;
  startBtn.disabled = true;
  resultArea.classList.remove('visible');
  emptyState.style.display = 'none';
  hideStatus();
  setStatus('loading', '正在提取文章内容...', true);
  const resp = await chrome.runtime.sendMessage({ action: 'START_SUMMARY' });
  if (!resp) {
    setStatus('error', '无响应，请检查 Service Worker 是否正常运行');
    startBtn.disabled = false;
    return;
  }
  if (!resp.success) {
    setStatus('error', resp.error || '处理失败');
    startBtn.disabled = false;
    return;
  }
  setStatus('success', '分析完成 ✓');
  renderResult(resp.data);
  if (resp.usage) {
    $('tokensInfo').textContent =
      `Token 消耗: ${resp.usage.total_tokens || '?'} (输入 ${resp.usage.prompt_tokens || '?'}, 输出 ${resp.usage.completion_tokens || '?'})`;
  }
  startBtn.disabled = false;
});