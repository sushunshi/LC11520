/**
 * 影视播放解析 - Netlify Function
 * 解析播放地址（自动处理"分享页"式 URL，提取真实 m3u8/mp4）
 *
 * 智能线路选择：
 * 1. 默认选第一个有 m3u8/mp4 直连的 group（不需要再解析分享页）
 * 2. 否则选第一个 group，再 resolvePlayableUrl 解析分享页
 * 3. 解析失败 → 返回 502 + 所有 groups，让前端能切换线路
 *
 * m3u8 有效性：
 * - 主动 GET 验证（Range: bytes=0-2047 省流量）
 * - 验证失败/超时 → "未知"状态，仍然返回 playableUrl（让前端兜底）
 * - 验证明确无效（HTML 404 页）→ 返回 502 + groups
 * - 前端 media-proxy 也会拦截 4xx/HTML 错误并返回 502
 * - 播放失败时前端显示"换一条线路"按钮
 */
const { json, loadConfig, cacheGet, cacheSet, cmsApi, parsePlayGroups, resolvePlayableUrl, httpGet } = require('./_shared');

const MEDIA_EXT = /\.(m3u8|mp4|mov|webm|flv|mkv)(\?|$)/i;

// 轻量验证：明确无效（HTML 404）才返回 false，超时/网络错误返回 true（兜底）
async function isM3u8DefinitelyBroken(url) {
  if (!/^https?:\/\//i.test(url)) return true;
  // 用 Range 0-512 省流量
  let r;
  try {
    r = await httpGet(url, 5000, { Range: 'bytes=0-511' });
  } catch (e) {
    return false; // 网络错误 → 不判定为失效，让前端兜底
  }
  if (r.status >= 400) {
    // 4xx/5xx 明确失效
    return true;
  }
  if (r.status === 0) return false; // timeout
  const ct = (r.headers && r.headers['content-type']) || '';
  if (/text\/html/i.test(ct)) return true; // 明确是 HTML 404
  const body = (r.body || '').trim();
  // 头部以 #EXTM3U 开头是有效 m3u8；如果不是但 content-type 是 mpegurl，
  // 可能是 master playlist 的子 playlist 也有 EXTM3U 但格式略不同
  if (body.length > 0 && body.slice(0, 16).indexOf('#EXTM3U') !== 0) {
    // 既不是 HTML，又不是 m3u8：可能是其他内容
    return true;
  }
  return false; // 验证通过或不确定
}

function buildUnavailable(source, site, detail, groups, group, failedUrl) {
  return {
    error: '该资源暂不可用，请尝试其他资源或稍后再试',
    error_code: 'PLAY_SOURCE_UNAVAILABLE',
    source,
    site_name: site.name || source,
    vod_name: detail.vod_name || '',
    vod_pic: detail.vod_pic || '',
    from: group.from,
    failed_url: failedUrl,
    groups: groups.map((g) => ({
      from: g.from,
      count: g.eps.length,
      has_direct: g.eps.some((e) => MEDIA_EXT.test(e.url)),
    })),
  };
}

function buildPlayResponse({ site, source, detail, groups, group, groupIdx, epIdx, picked, vodId }) {
  const proxyUrl = picked.playableUrl && /^https?:\/\//i.test(picked.playableUrl)
    ? '/.netlify/functions/media-proxy?url=' + encodeURIComponent(picked.playableUrl)
    : picked.playableUrl;

  return json(200, {
    source,
    site_name: site.name || source,
    vod_name: detail.vod_name || '',
    vod_pic: detail.vod_pic || '',
    from: picked.from || group.from,
    ep_index: picked.epIdx + 1,
    requested_ep: epIdx + 1,
    requested_from: group.from,
    episode: picked.ep,
    playable_url: proxyUrl,
    proxy_url: proxyUrl,
    original_url: picked.playableUrl,
    episode_count: group.eps.length,
    episodes: group.eps,
    groups: groups.map((g) => ({
      from: g.from,
      count: g.eps.length,
      has_direct: g.eps.some((e) => MEDIA_EXT.test(e.url)),
    })),
    vod_id: vodId,
  });
}

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

  // 选 group：playFrom 指定 > 第一个 m3u8/mp4 直连 group > 第一个
  let groupIdx = 0;
  if (playFrom) {
    const idx = groups.findIndex((g) => g.from === playFrom);
    if (idx > -1) groupIdx = idx;
  } else {
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].eps.some((e) => MEDIA_EXT.test(e.url))) {
        groupIdx = i;
        break;
      }
    }
  }
  const group = groups[groupIdx];
  const epIdx = Math.min(Math.max(ep - 1, 0), group.eps.length - 1);
  const target = group.eps[epIdx];

  // 解析真实可播放地址（分享页 → m3u8/mp4），带短缓存
  let playableUrl = target.url;
  if (target.url && !MEDIA_EXT.test(target.url)) {
    const cacheKey = `playable_${source}_${vodId}_${groupIdx}_${epIdx}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      playableUrl = cached;
    } else {
      const resolved = await resolvePlayableUrl(target.url, 6000);
      if (resolved) {
        playableUrl = resolved;
        cacheSet(cacheKey, resolved, 3600);
      }
    }
  }

  // 解析失败 → 返回 502 + groups（让前端引导用户切换线路）
  if (!playableUrl || !MEDIA_EXT.test(playableUrl)) {
    return json(502, buildUnavailable(source, site, detail, groups, group, target.url));
  }

  // 明确无效的 m3u8（HTML 404 / 4xx / 非 m3u8 文本）→ 返回 502 + groups
  if (/^https?:\/\//i.test(playableUrl)) {
    const ck = `m3u8broken_${playableUrl}`;
    let broken = cacheGet(ck);
    let reason = '';
    if (broken === undefined) {
      // 直接检测，不做超时容错（Netlify 那边挂掉的话能定位）
      let r;
      try {
        r = await httpGet(playableUrl, 5000, { Range: 'bytes=0-511' });
      } catch (e) {
        reason = 'fetch-exception:' + (e && e.message || 'unknown');
        broken = false; // 网络错误 → 兜底
      }
      if (r) {
        if (r.status >= 400) {
          reason = 'status:' + r.status;
          broken = true;
        } else if (r.status === 0) {
          reason = 'timeout';
          broken = false;
        } else {
          const ct = (r.headers && r.headers['content-type']) || '';
          if (/text\/html/i.test(ct)) {
            reason = 'html-ct:' + ct;
            broken = true;
          } else {
            const body = (r.body || '').trim();
            if (body.length > 0 && body.slice(0, 16).indexOf('#EXTM3U') !== 0) {
              reason = 'not-m3u8:[' + body.slice(0, 60) + ']';
              broken = true;
            } else {
              reason = 'ok-ct:' + ct + '-len:' + body.length;
              broken = false;
            }
          }
        }
      }
      cacheSet(ck, broken ? '1' : '0', 600);
    }
    if (broken) {
      // 在 error 信息里附上原因（调试用）
      const resp = buildUnavailable(source, site, detail, groups, group, playableUrl);
      resp.error = resp.error + ' (reason: ' + reason + ')';
      return json(502, resp);
    }
  }

  return buildPlayResponse({
    site, source, detail, groups, group, groupIdx, epIdx,
    picked: { groupIdx, epIdx, ep: target, from: group.from, playableUrl },
    vodId,
  });
};
