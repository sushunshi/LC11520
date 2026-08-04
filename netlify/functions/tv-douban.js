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

  const r = await httpGet(url, 12000, {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': 'https://movie.douban.com/',
    'sec-ch-ua': '"Chromium";v="126", "Not.A/Brand";v="8"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
  });
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
