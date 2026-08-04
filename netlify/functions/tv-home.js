/**
 * 影视首页 - Netlify Function
 * 多资源站最新列表（带缓存）
 */
const { json, loadConfig, cacheGet, cacheSet, cmsApi, normalizeItem } = require('./_shared');

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const sourceKey = q.source || 'all';
  const cfg = await loadConfig();
  const cacheTime = Number(cfg.cache_time) || 7200;

  const siteMap = cfg.api_site || {};
  let entries = Object.entries(siteMap);
  if (sourceKey !== 'all' && siteMap[sourceKey]) {
    entries = [[sourceKey, siteMap[sourceKey]]];
  }

  const lists = [];
  const sources = [];
  for (const [key, site] of entries) {
    const name = site.name || key;
    const entry = { source: key, name, items: [] };
    const cached = cacheGet(`home_${key}`);
    if (cached) {
      entry.items = cached;
      sources.push({ key, name });
      lists.push(entry);
      continue;
    }
    if (!site.api) continue;
    const data = await cmsApi(site.api, 'list', { pg: 1 });
    if (!data || !Array.isArray(data.list)) continue;
    const items = data.list.slice(0, 24).map((i) => normalizeItem(i, key, name));
    entry.items = items;
    cacheSet(`home_${key}`, items, cacheTime);
    sources.push({ key, name });
    lists.push(entry);
  }

  if (!lists.length) {
    return json(200, { sources: [], lists: [], error: '暂无可用资源站，请在影视设置中配置' });
  }
  return json(200, { sources, lists });
};
