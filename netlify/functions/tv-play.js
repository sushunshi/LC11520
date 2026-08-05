/**
 * 影视播放解析 - Netlify Function
 * 解析播放地址（自动处理"分享页"式 URL，提取真实 m3u8/mp4）
 *
 * 智能线路选择：
 * 1. 默认选第一个有 m3u8/mp4 直连的 group（不需要再解析分享页）
 * 2. 否则选第一个 group，再 resolvePlayableUrl 解析分享页
 * 3. 解析失败 → 返回 502 + 所有 groups，让前端能切换线路
 *
 * 关键：返回 playable_url 前会主动验证 m3u8 真的返回 m3u8 文本
 * （很多资源站的失效资源返回的是 404 HTML 页面），验证失败时自动
 * 跳到下一个 group 重试，所有 group 都不可用时返回 502 + groups。
 */
const { json, loadConfig, cacheGet, cacheSet, cmsApi, parsePlayGroups, resolvePlayableUrl, httpGet } = require('./_shared');

const MEDIA_EXT = /\.(m3u8|mp4|mov|webm|flv|mkv)(\?|$)/i;

// 验证 m3u8 URL 真的返回 m3u8 文本
async function verifyM3u8(url) {
  if (!/^https?:\/\//i.test(url)) return false;
  // 普通 GET 拉 m3u8 文本（m3u8 都很小，几 KB 之内）
  const r = await httpGet(url, 8000, { Accept: 'application/vnd.apple.mpegurl,*/*' });
  if (r.status !== 200 && r.status !== 206) {
    console.log('[verifyM3u8] non-2xx', url, 'status:', r.status, 'ct:', r.headers && r.headers['content-type']);
    return false;
  }
  const ct = (r.headers && r.headers['content-type']) || '';
  if (/text\/html/i.test(ct)) {
    console.log('[verifyM3u8] html content-type', url, 'body head:', (r.body || '').slice(0, 100));
    return false;
  }
  const body = r.body || '';
  if (body.trim().slice(0, 16).indexOf('#EXTM3U') !== 0) {
    console.log('[verifyM3u8] not m3u8 text', url, 'body head:', body.slice(0, 100));
    return false;
  }
  return true;
}

// 验证结果缓存（10 分钟）
function getVerifyCache(url) {
  return cacheGet(`m3u8v_${url}`);
}
function setVerifyCache(url, ok) {
  cacheSet(`m3u8v_${url}`, ok ? '1' : '0', 600);
}

async function isM3u8Valid(url) {
  const c = getVerifyCache(url);
  if (c === '1') return true;
  if (c === '0') return false;
  const ok = await verifyM3u8(url);
  setVerifyCache(url, ok);
  return ok;
}

// 挑选一个能验证通过的 group/ep（按 group 顺序遍历）
async function pickPlayableGroup(groups, source, vodId) {
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    for (let j = 0; j < g.eps.length; j++) {
      const ep = g.eps[j];
      let candidate = ep.url;
      // 分享页 → 先解析
      if (candidate && !MEDIA_EXT.test(candidate)) {
        const ck = `playable_${source}_${vodId}_${i}_${j}`;
        const cached = cacheGet(ck);
        if (cached) {
          candidate = cached;
        } else {
          const resolved = await resolvePlayableUrl(candidate, 5000);
          if (resolved) {
            candidate = resolved;
            cacheSet(ck, resolved, 3600);
          }
        }
      }
      if (!candidate || !MEDIA_EXT.test(candidate)) continue;
      if (!/^https?:\/\//i.test(candidate)) continue;
      // 验证 m3u8
      if (await isM3u8Valid(candidate)) {
        return { groupIdx: i, epIdx: j, ep, from: g.from, playableUrl: candidate };
      }
    }
  }
  return null;
}

function buildUnavailable(source, site, detail, groups, group, failedUrl) {
  return {
    error: '该资源所有线路暂不可用，请尝试其他资源或稍后再试',
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
    auto_switched: (picked.groupIdx !== groupIdx || picked.epIdx !== epIdx) ? true : false,
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

  // 验证 m3u8 真的有效；如果当前 group/ep 失效，自动跳到下一个能用的
  if (playableUrl && MEDIA_EXT.test(playableUrl) && /^https?:\/\//i.test(playableUrl)) {
    if (!(await isM3u8Valid(playableUrl))) {
      const better = await pickPlayableGroup(groups, source, vodId);
      if (better) {
        return buildPlayResponse({
          site, source, detail, groups, group, groupIdx, epIdx,
          picked: better,
          vodId,
        });
      }
      return json(502, buildUnavailable(source, site, detail, groups, group, target.url));
    }
  } else if (!playableUrl || !MEDIA_EXT.test(playableUrl)) {
    const better = await pickPlayableGroup(groups, source, vodId);
    if (better) {
      return buildPlayResponse({
        site, source, detail, groups, group, groupIdx, epIdx,
        picked: better,
        vodId,
      });
    }
    return json(502, buildUnavailable(source, site, detail, groups, group, target.url));
  }

  return buildPlayResponse({
    site, source, detail, groups, group, groupIdx, epIdx,
    picked: { groupIdx, epIdx, ep: target, from: group.from, playableUrl },
    vodId,
  });
};
