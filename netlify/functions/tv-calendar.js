/**
 * 番剧日历 - Netlify Function (Bangumi 代理)
 */
const { json, httpGetJson, cacheGet, cacheSet } = require('./_shared');

exports.handler = async () => {
  const cached = cacheGet('anime_calendar');
  if (cached) return json(200, cached);

  try {
    const data = await httpGetJson('https://api.bgm.tv/calendar', 12000, {
      'User-Agent': 'LunaTV/1.0 (https://github.com/MoonTechLab/LunaTV)',
    });
    if (!data || !Array.isArray(data)) return json(400, { error: '番剧日历获取失败' });

    const weekdayCn = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const days = data.map((day) => {
      const items = (day.items || []).slice(0, 12).map((s) => ({
        name: s.name || '',
        name_cn: s.name_cn || '',
        image: (s.images || {}).large || '',
        rating: (s.rating || {}).score || '',
        air_date: s.air_date || '',
      }));
      const wid = ((day.weekday || {}).id || 0) % 7;
      return { weekday: weekdayCn[wid], items };
    });
    const result = { days };
    cacheSet('anime_calendar', result, 3600);
    return json(200, result);
  } catch (e) {
    return json(500, { error: `番剧日历获取失败: ${e.message}` });
  }
};
