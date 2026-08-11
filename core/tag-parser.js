export const DEFAULT_IMAGE_RULES = Object.freeze([
  { id: 'marker-image-hash', name: 'image### 图片块', enabled: true, mode: 'markers', start: 'image###', end: '###' },
  { id: 'marker-image-tag', name: '<image> 图片块（兼容）', enabled: true, mode: 'markers', start: '<image>', end: '</image>' },
]);

const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const safeFlags = value => [...new Set(String(value || '').replace(/[^gimsu]/g, '') + 'g')].join('');

export function normalizeRules(rules) {
  const source = Array.isArray(rules) && rules.length ? rules : DEFAULT_IMAGE_RULES;
  return source.filter(rule => rule && rule.enabled !== false).map(rule => ({ ...rule, mode: rule.mode === 'regex' ? 'regex' : 'markers' }));
}

export function extractByRules(text = '', rules = DEFAULT_IMAGE_RULES) {
  const input = String(text); const blocks = []; const used = new Set();
  for (const rule of normalizeRules(rules)) {
    try {
      const regex = rule.mode === 'regex'
        ? new RegExp(rule.pattern || '', safeFlags(rule.flags))
        : new RegExp(`${escapeRegex(rule.start || '')}([\\s\\S]*?)${escapeRegex(rule.end || '')}`, 'gi');
      if (!regex.source || regex.source === '(?:)') continue;
      let match; let guard = 0;
      while ((match = regex.exec(input)) && guard++ < 30) {
        const raw = String(match[1] ?? '').trim(); const key = `${match.index}:${raw}`;
        if (raw && !used.has(key)) { used.add(key); blocks.push({ raw, matched: match[0], index: blocks.length, offset: match.index, ruleId: rule.id, ruleName: rule.name }); }
        if (match[0] === '') regex.lastIndex++;
      }
    } catch (error) { console.debug('[SceneFrame] invalid parser rule', rule.name, error); }
  }
  return blocks.sort((a, b) => a.offset - b.offset).map((block, index) => ({ ...block, index }));
}

export function extractImageBlocks(text = '') { return extractByRules(text, DEFAULT_IMAGE_RULES); }

export function normalizePrompt(prompt = '') {
  return String(prompt).replace(/[，、；：]/g, ',').replace(/[；;]/g, ',').split(',').map(x => x.trim()).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(', ');
}

export async function digest(text) {
  const data = new TextEncoder().encode(String(text));
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('');
}
