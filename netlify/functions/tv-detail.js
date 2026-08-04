/**
 * 影视详情 - Netlify Function
 */
const { json, loadConfig, cacheGet, cacheSet, cmsApi } = require('./_shared');

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const vodId = (q.vod_id || '').trim();
  const source = (q.source || '').trim();
  if (!vodId || !source) return json(400, { error: '缺少参数' });

  const cfg = await loadConfig();
  const cacheTime = Number(cfg.cache_time) || 7200;
  const site = (cfg.api_site || {})[source];
  if (!site) return json(404, { error: '资源站不存在' });

  const cached = cacheGet(`detail_${source}_${vodId}`);
  if (cached) return json(200, cached);

  const data = await cmsApi(site.api, 'detail', { ids: vodId });
  if (!data || !Array.isArray(data.list) || !data.list.length) {
    return json(400, { error: '获取详情失败' });
  }
  const d = data.list[0];
  const detail = {
    source,
    site_name: site.name || source,
    vod_id: d.vod_id,
    vod_name: d.vod_name || '',
    vod_pic: d.vod_pic || '',
    vod_remarks: d.vod_remarks || '',
    vod_actor: d.vod_actor || '',
    vod_director: d.vod_director || '',
    vod_writer: d.vod_writer || '',
    vod_year: d.vod_year || '',
    vod_area: d.vod_area || '',
    vod_lang: d.vod_lang || '',
    vod_score: d.vod_score || '',
    vod_type: d.vod_type || '',
    vod_content: d.vod_content || '',
    vod_play_from: d.vod_play_from || '',
    vod_play_url: d.vod_play_url || '',
    vod_down_url: d.vod_down_url || '',
    vod_time: d.vod_time || '',
  };
  cacheSet(`detail_${source}_${vodId}`, detail, cacheTime);
  return json(200, detail);
};
