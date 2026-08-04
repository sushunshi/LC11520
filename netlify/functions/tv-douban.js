/**
 * 豆瓣数据 - Netlify Function (服务端代理，避免 CORS)
 */
const { json, httpGet, cacheGet, cacheSet } = require('./_shared');

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const type = q.type || 'movie';
  const tag = q.tag || '热门';
  const page = parseInt(q.page || '1', 10) || 1;
  const limit = parseInt(q.limit || '20', 10) || 20;
  const pageStart = (page - 1) * limit;

  const cacheKey = `douban_${type}_${tag}_${page}`;
  const cached = cacheGet(cacheKey);
  if (cached) return json(200, cached);

  const url =
    'https://movie.douban.com/j/search_subjects' +
    `?type=${encodeURIComponent(type)}&tag=${encodeURIComponent(tag)}&sort=recommend&page_limit=${limit}&page_start=${pageStart}`;

  const r = await httpGet(url, 12000, { Referer: 'https://movie.douban.com/' });
  if (r.status !== 200 || !r.body) return json(400, { error: '豆瓣数据获取失败' });

  try {
    const data = JSON.parse(r.body);
    const items = (data.subjects || []).map((s) => ({
      title: s.title || '',
      rate: s.rate || '',
      cover: s.cover || '',
      url: s.url || '',
      id: s.id || '',
    }));
    const result = { items, tag, type, page };
    cacheSet(cacheKey, result, 7200);
    return json(200, result);
  } catch (e) {
    return json(500, { error: `豆瓣数据解析失败: ${e.message}` });
  }
};
