/**
 * 影视播放解析 - Netlify Function
 * 解析播放地址（自动处理"分享页"式 URL，提取真实 m3u8/mp4）
 */
const { json, loadConfig, cacheGet, cacheSet, cmsApi, parsePlayGroups, resolvePlayableUrl } = require('./_shared');

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const vodId = (q.vod_id || '').trim();
  const source = (q.source || '').trim();
  const ep = parseInt(q.ep || '1', 10) || 1;
  const playFrom = (q.from || '').trim();

  const cfg = await loadConfig();
  const site = (cfg.api_site || {})[source];
  if (!site) return json(404, { error: '资源站不存在' });

  let detail = cacheGet(`detail_${source}_${vodId}`);
  if (!detail) {
    const data = await cmsApi(site.api, 'detail', { ids: vodId });
    if (!data || !Array.isArray(data.list) || !data.list.length) {
      return json(400, { error: '获取播放信息失败' });
    }
    detail = data.list[0];
    cacheSet(`detail_${source}_${vodId}`, detail, Number(cfg.cache_time) || 7200);
  }

  const groups = parsePlayGroups(detail.vod_play_from, detail.vod_play_url);
  if (!groups.length) return json(400, { error: '没有可播放的线路' });

  let groupIdx = 0;
  if (playFrom) {
    const idx = groups.findIndex((g) => g.from === playFrom);
    if (idx > -1) groupIdx = idx;
  }
  const group = groups[groupIdx];
  const epIdx = Math.min(Math.max(ep - 1, 0), group.eps.length - 1);
  const target = group.eps[epIdx];

  // 解析真实可播放地址（分享页 → m3u8/mp4），带短缓存
  let playableUrl = target.url;
  if (target.url && !/\.(m3u8|mp4|mov|webm|flv|mkv)(\?|$)/i.test(target.url)) {
    const cacheKey = `playable_${source}_${vodId}_${epIdx}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      playableUrl = cached;
    } else {
      const resolved = await resolvePlayableUrl(target.url, 8000);
      if (resolved) {
        playableUrl = resolved;
        cacheSet(cacheKey, resolved, 3600);
      }
    }
  }

  // 关键：浏览器端 CORS 不能访问第三方 m3u8 域名，
  // 所以 playable_url 始终包装成走 Netlify 代理的同源 URL。
  // 前端 hls.js / MSE 拿到同源 URL 就能直接 fetch / XHR 分片。
  const proxyUrl = playableUrl && /^https?:\/\//i.test(playableUrl)
    ? '/.netlify/functions/media-proxy?url=' + encodeURIComponent(playableUrl)
    : playableUrl;

  return json(200, {
    source,
    site_name: site.name || source,
    vod_name: detail.vod_name || '',
    vod_pic: detail.vod_pic || '',
    from: group.from,
    ep_index: epIdx + 1,
    episode: target,
    playable_url: proxyUrl,        // 兼容字段：直接可喂播放器（同源）
    proxy_url: proxyUrl,           // 新字段：明确语义
    original_url: playableUrl,     // 原始 m3u8 URL，供「复制到外部播放器」用
    episode_count: group.eps.length,
    episodes: group.eps,
    vod_id: vodId,
  });
};
