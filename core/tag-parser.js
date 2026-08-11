export function extractImageBlocks(text = '') {
  const blocks = [];
  const re = /<image(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/image>/gi;
  let match;
  while ((match = re.exec(String(text)))) {
    const raw = match[1].trim();
    if (raw) blocks.push({ raw, index: blocks.length, offset: match.index });
  }
  return blocks;
}

export function normalizePrompt(prompt = '') {
  return String(prompt)
    .replace(/[，、；：]/g, ',')
    .replace(/[；;]/g, ',')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)
    .filter((x, i, a) => a.indexOf(x) === i)
    .join(', ');
}

export async function digest(text) {
  const data = new TextEncoder().encode(String(text));
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('');
}
