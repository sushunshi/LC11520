/**
 * 影视多源搜索 - Netlify Function
 */
const { json, loadConfig, cacheGet, cacheSet, cmsApi, normalizeItem } = require('./_shared');

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const wd = (q.wd || '').trim();
  const pg = parseInt(q.pg || '1', 10) || 1;
  if (!wd) return json(400, { error: '请输入搜索关键词' });

  const cfg = await loadConfig();
  const cacheTime = Number(cfg.cache_time) || 7200;
  const sites = cfg.api_site || {};

  const searchOne = async (key, site) => {
    const name = site.name || key;
    if (!site.api) return null;
    const cached = cacheGet(`search_${key}_${wd}`);
    if (cached) return cached;
    const data = await cmsApi(site.api, 'search', { wd, pg });
    if (!data || !Array.isArray(data.list)) return null;
    const entry = { source: key, name, items: data.list.slice(0, 30).map((i) => normalizeItem(i, key, name)) };
    if (entry.items.length) cacheSet(`search_${key}_${wd}`, entry, cacheTime);
    return entry;
  };

  const settled = await Promise.allSettled(Object.entries(sites).map(([k, s]) => searchOne(k, s)));
  const results = settled
    .map((r) => (r.status === 'fulfilled' ? r.value : null))
    .filter((r) => r && r.items && r.items.length);

  return json(200, { wd, results });
};
