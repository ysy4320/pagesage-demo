const STORAGE_KEYS = {
  LLM_ENDPOINT: 'llmEndpoint',
  LLM_API_KEY: 'llmApiKey',
  LLM_MODEL: 'llmModel',
};
const DEFAULT_ENDPOINT = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const DEFAULT_MODEL = 'qwen-long';
const CHUNK_MAX_CHARS = 12000;
const CHUNK_SYSTEM_PROMPT = `你是一位文本分析师。请从以下段落中提取核心信息，返回一个JSON对象：
{
  "summary": "段落核心内容概括（50字内）",
  "key_points": ["要点1", "要点2"],
  "evidence": "段落中出现的具体数据或引用（如有）"
}
仅返回JSON，不要包含markdown代码块标记。`;
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));
function normalizeEndpoint(endpoint) {
  const trimmed = endpoint.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  return trimmed + '/chat/completions';
}
function parseAIResponse(content) {
  try {
    return JSON.parse(content);
  } catch (_) {}
  const cleaned = content
    .replace(/^[\s\S]*?```(?:json)?\s*/i, '')
    .replace(/\s*```[\s\S]*$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {}
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (e2) {}
  }
  return null;
}
async function _apiCall(systemPrompt, userText) {
  let config;
  try {
    config = await chrome.storage.local.get({
      [STORAGE_KEYS.LLM_ENDPOINT]: DEFAULT_ENDPOINT,
      [STORAGE_KEYS.LLM_API_KEY]: '',
      [STORAGE_KEYS.LLM_MODEL]: DEFAULT_MODEL,
    });
  } catch (e) {
    return { success: false, error: `Failed to read storage: ${e.message}` };
  }
  const endpoint = normalizeEndpoint(config[STORAGE_KEYS.LLM_ENDPOINT]);
  const apiKey = config[STORAGE_KEYS.LLM_API_KEY];
  const model = config[STORAGE_KEYS.LLM_MODEL] || DEFAULT_MODEL;
  if (!apiKey) {
    return { success: false, error: 'API 密钥未配置，请在侧边栏设置中填写' };
  }
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userText },
        ],
        temperature: 0.3,
        max_tokens: 4096,
      }),
    });
    if (!response.ok) {
      let errorBody = '';
      try { errorBody = await response.text(); } catch (_) {}
      return {
        success: false,
        error: `API error ${response.status}${errorBody ? ': ' + errorBody.slice(0, 500) : ''}`,
      };
    }
    const body = await response.json();
    if (!body.choices || !body.choices[0] || !body.choices[0].message) {
      return { success: false, error: 'Unexpected API response format: missing choices' };
    }
    const content = body.choices[0].message.content.trim();
    const parsed = parseAIResponse(content);
    if (parsed === null) {
      return { success: false, error: 'Model response is not valid JSON', raw: content.slice(0, 500) };
    }
    return { success: true, data: parsed, usage: body.usage || null };
  } catch (e) {
    return { success: false, error: `Network or request error: ${e.message}` };
  }
}
function splitIntoChunks(text, maxSize) {
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const chunks = [];
  let current = [];
  for (const p of paragraphs) {
    if (current.join('\n\n').length + p.length > maxSize && current.length > 0) {
      chunks.push(current.join('\n\n'));
      current = [p];
    } else {
      current.push(p);
    }
  }
  if (current.length > 0) chunks.push(current.join('\n\n'));
  return chunks;
}
async function summarizeChunks(chunks) {
  const summaries = [];
  for (let i = 0; i < chunks.length; i++) {
    const result = await _apiCall(CHUNK_SYSTEM_PROMPT, chunks[i]);
    if (!result.success) return result;
    summaries.push(result.data);
  }
  return { success: true, data: summaries };
}
const FINAL_SYSTEM_PROMPT = `你是一名专家级信息分析师。你的任务是对用户提供的长文章纯文本进行深度结构化分析，并返回严格的 JSON 对象。
## 输出要求
- 直接返回纯净的 JSON，不要包含任何 markdown 代码块标记（如 \`\`\`json）
- 输出必须能被 JSON.parse() 直接解析
- 不要添加任何说明文字、注释或前缀
## JSON 结构
{
  "core_thesis": "一句话概括文章核心论点",
  "key_arguments": [
    {
      "argument": "分论点",
      "original_quote": "支撑该论点的原文关键句（15-30字）"
    }
  ],
  "supporting_evidence": "关键论据或数据的简要概括",
  "conclusion": "文章结论或展望",
  "technical_terms": [
    {
      "term": "术语",
      "term_en": "English Term",
      "definition": "一句话解释"
    }
  ],
  "reading_recommendation": {
    "need_deep_read": true,
    "reason": "建议精读或可跳过的具体原因",
    "highlight_sections": ["建议重点阅读的段落描述或小标题"]
  },
  "metadata": {
    "article_type": "文章类型标签"
  }
}
## 分项规范
### 1. core_thesis
- 用一句话精准提炼全文最核心的论点或主旨，不超过 50 字
- 如果文章是纯资讯报道（无明确论点），此字段填写文章最核心的事实陈述
### 2. key_arguments（数组，每项为对象）
- 数量要求：3~5 条分论点
- argument：每个论点用一句话表述，按逻辑顺序排列
- original_quote：从原文截取一句最能支撑该论点的原话，15~30 字；若原文无合适的短句可引用，填写"原文段落较长，已在上方概括"
- 纯资讯例外：如果文章是纯资讯报道（简讯、快讯等），本身没有明确的论点链，允许 key_arguments 返回空数组 []，但必须在 metadata.article_type 中标注为"纯资讯"
### 3. supporting_evidence
- 概括文中引用的关键数据、案例、研究成果或权威引用，不超过 150 字
- 优先保留具体数字、比例、时间等可量化信息
### 4. conclusion
- 总结文章的最终结论、观点立场或对未来展望，不超过 80 字
- 纯资讯文章可填写 null
### 5. technical_terms（数组，每项为对象）
- 提取文中出现的重要专业术语，0~5 个
- term：中文术语名称
- term_en：英文对应词，赋值规则按优先级如下：
  1. 优先使用原文中出现的英文原词
  2. 若原文无英文，根据上下文推断最可能的英文对应词，并在值末尾标注（推断）
  3. 若确实无法推断，填写"无对应英文"
- definition：一句话通俗解释该术语
### 6. reading_recommendation（对象）
- need_deep_read：布尔值
  - true → 建议精读。触发条件：文章包含实操方法、影响个人决策的信息、颠覆常识的观点、需要批判性思考的内容
  - false → 可跳过。触发条件：一般性资讯、纯娱乐内容、信息密度低、与大多数读者无关的垂直话题
- reason：给出判断的具体理由，一句话
- highlight_sections：数组，建议重点阅读的段落描述或小标题
  - 当 need_deep_read 为 false 时，此数组返回 []
### 7. metadata（对象）
- article_type：文章类型标签，可选值：
  - "学术分析" | "评论观点" | "纯资讯" | "教程指南" | "叙事报道" | "其他"
  - 当 key_arguments 返回空数组时，此项必须为"纯资讯"
## 质量准则
- 严格基于原文内容，禁止编造原文未提及的信息
- 保持客观中立，不添加个人评价或立场
- 中文为主，术语保留原文并与中文解释共存
- 如果原文缺少某个字段所需的信息，使用 null 而非省略字段`;
async function processLongText(text) {
  const chunks = splitIntoChunks(text, CHUNK_MAX_CHARS);
  const chunkResult = await summarizeChunks(chunks);
  if (!chunkResult.success) return chunkResult;
  const merged = chunkResult.data.map((s, i) =>
    `[段落 ${i + 1}] 概括：${s.summary}\n要点：${(s.key_points || []).join('；')}\n数据：${s.evidence || '无'}`
  ).join('\n\n');
  if (merged.length > CHUNK_MAX_CHARS) {
    return processLongText(merged);
  }
  return _apiCall(FINAL_SYSTEM_PROMPT, merged);
}
async function callLLM(articleText) {
  if (!articleText || typeof articleText !== 'string') {
    return { success: false, error: 'Invalid article text' };
  }
  if (articleText.length > CHUNK_MAX_CHARS) {
    return processLongText(articleText);
  }
  return _apiCall(FINAL_SYSTEM_PROMPT, articleText);
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'START_SUMMARY') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) {
          sendResponse({ success: false, error: '未找到活动标签页' });
          return;
        }
        const contentResp = await chrome.tabs.sendMessage(tab.id, { action: 'EXTRACT_CONTENT' });
        if (!contentResp || !contentResp.success) {
          sendResponse({ success: false, error: contentResp?.error || '文章提取失败' });
          return;
        }
        const llmResp = await callLLM(contentResp.text);
        if (!llmResp.success) {
          sendResponse({ success: false, error: llmResp.error });
          return;
        }
        sendResponse({ success: true, data: llmResp.data, usage: llmResp.usage });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
  if (message.action === 'EXTRACT_CONTENT') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) {
          sendResponse({ success: false, error: 'No active tab found' });
          return;
        }
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'EXTRACT_CONTENT' });
        sendResponse(response);
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
  if (message.action === 'CALL_LLM') {
    (async () => {
      const result = await callLLM(message.text);
      sendResponse(result);
    })();
    return true;
  }
  if (message.action === 'LLM_GET_CONFIG') {
    (async () => {
      try {
        const config = await chrome.storage.local.get({
          [STORAGE_KEYS.LLM_ENDPOINT]: DEFAULT_ENDPOINT,
          [STORAGE_KEYS.LLM_API_KEY]: '',
          [STORAGE_KEYS.LLM_MODEL]: DEFAULT_MODEL,
        });
        sendResponse({
          success: true,
          config: {
            endpoint: config[STORAGE_KEYS.LLM_ENDPOINT],
            model: config[STORAGE_KEYS.LLM_MODEL],
            hasKey: !!config[STORAGE_KEYS.LLM_API_KEY],
          },
        });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
});