const BASE_URL = 'https://danbooru.donmai.us';

function cleanBaseUrl(url = BASE_URL) { return String(url).replace(/\/$/, ''); }

export async function searchDanbooruTags({ query, login = '', apiKey = '', baseUrl = BASE_URL, limit = 20, signal } = {}) {
  const keyword = String(query || '').trim();
  if (!keyword) return [];
  const url = new URL(`${cleanBaseUrl(baseUrl)}/tags.json`);
  url.searchParams.set('search[name_matches]', `${keyword}*`);
  url.searchParams.set('limit', String(Math.max(1, Math.min(50, Number(limit) || 20))));
  if (login && apiKey) { url.searchParams.set('login', login); url.searchParams.set('api_key', apiKey); }
  const response = await fetch(url, { method: 'GET', credentials: 'omit', signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Danbooru HTTP ${response.status}`);
  const rows = await response.json();
  return (Array.isArray(rows) ? rows : []).map(tag => ({
    name: tag.name,
    category: Number(tag.category ?? 0),
    postCount: Number(tag.post_count ?? 0),
  }));
}

export const DANBOORU_CATEGORY = Object.freeze({ 0: '一般', 1: '画师', 3: '版权', 4: '角色', 5: '元标签' });
