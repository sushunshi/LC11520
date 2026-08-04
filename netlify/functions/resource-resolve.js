/**
 * 视频解析下载 - Netlify Function
 * 抖音 API 解析 + 通用 og:video 提取 + 直链识别
 */
const { json, parseBody, httpGet, httpGetJson, extractUrls, detectPlatform, absUrl } = require('./_shared');

async function resolveDouyin(videoId) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    Referer: 'https://www.douyin.com/',
  };
  try {
    const data = await httpGetJson(
      `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${videoId}`,
      10000,
      headers
    );
    const aweme = data && data.aweme_detail;
    if (!aweme) return null;
    const video = aweme.video || {};
    const result = {
      desc: aweme.desc || '',
      author: (aweme.author || {}).nickname || '',
      duration: aweme.duration || 0,
      urls: [],
    };
    const add = (label, urls) => {
      (urls || []).forEach((u) => result.urls.push({ label, url: u }));
    };
    add('有水印', (video.play_addr || {}).url_list);
    add('H264', (video.play_addr_h264 || {}).url_list);
    add('低码率', (video.play_addr_lowbr || {}).url_list);
    if (result.urls.length) {
      const base = result.urls[0].url;
      const nowm = base.replace(/watermark=[12]/, 'watermark=0');
      if (nowm !== base) result.urls.unshift({ label: '无水印(尝试)', url: nowm });
    }
    const cover = (video.cover || {}).url_list || [];
    if (cover.length) result.cover = cover[0];
    return result;
  } catch (e) {
    return null;
  }
}

exports.handler = async (event) => {
  let url = (parseBody(event).url || '').trim();
  if (!url) return json(400, { error: '请输入 URL' });
  const ext = extractUrls(url);
  if (ext) url = ext;
  if (!/^https?:\/\//.test(url)) url = 'https://' + url;

  const platform = detectPlatform(url);
  const result = { url, platform, resolved: [], note: '' };

  // follow redirect
  let finalUrl = url;
  try {
    const r = await httpGet(url, 8000);
    if (r.url) finalUrl = r.url;
  } catch (e) {}

  // 抖音
  if (platform && platform.name === '抖音') {
    const vidMatch = finalUrl.match(/\/(?:video|note)\/(\d{10,20})/) || url.match(/\/video\/(\d{10,20})/);
    if (vidMatch) {
      const videoId = vidMatch[1];
      const dy = await resolveDouyin(videoId);
      if (dy) {
        result.resolved = dy.urls;
        result.desc = dy.desc;
        result.author = dy.author;
        result.duration = dy.duration;
        result.cover = dy.cover;
        result.note = '点击链接可直接下载，或复制链接用下载工具下载';
      } else {
        result.note = '无法解析该视频，可能需要 Cookie 或视频已删除';
        result.resolved.push({ type: 'video_id', platform: 'douyin', id: videoId });
      }
    } else {
      result.note = '无法提取视频 ID，请确认链接是否正确';
    }
  }
  // 直链
  else if (/\.(mp4|mov|webm|flv|mkv)(\?|$)/i.test(url)) {
    result.resolved.push({ label: '直链', url });
    result.note = '直接视频链接，可直接下载';
  }
  // m3u8
  else if (/\.m3u8/i.test(url)) {
    result.resolved.push({ label: 'M3U8', url });
    result.note = 'M3U8 播放列表，可在 M3U8 解析面板查看分片';
  }
  // 通用
  else {
    try {
      const r = await httpGet(finalUrl, 8000);
      if (r.body) {
        const ogRe = /<meta[^>]+property=["']og:video(?::(?:url|secure_url))?["'][^>]+content=["']([^"']+)["']/gi;
        let m;
        while ((m = ogRe.exec(r.body))) result.resolved.push({ label: 'OG Video', url: absUrl(m[1], finalUrl) });
        const vidRe = /<(?:video|source)[^>]+src=["']([^"']+)["']/gi;
        while ((m = vidRe.exec(r.body))) result.resolved.push({ label: 'Video Tag', url: absUrl(m[1], finalUrl) });
      }
    } catch (e) {}
    if (!result.resolved.length) {
      result.note = '未找到可下载的视频链接。该平台可能需要桌面工具进行 MITM 代理截取。';
    }
  }

  return json(200, result);
};
