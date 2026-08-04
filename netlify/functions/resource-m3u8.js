/**
 * M3U8 解析 - Netlify Function
 */
const { json, parseBody, httpGet, parseM3u8, extractMediaLinks, extractUrls } = require('./_shared');

exports.handler = async (event) => {
  let url = (parseBody(event).url || '').trim();
  if (!url) return json(400, { error: '请输入 M3U8 地址' });
  const ext = extractUrls(url);
  if (ext) url = ext;
  if (!/^https?:\/\//.test(url)) url = 'https://' + url;

  try {
    const r = await httpGet(url, 10000);
    if (r.status !== 200 || !r.body) {
      return json(400, { error: `获取失败 (HTTP ${r.status || 'timeout'})` });
    }
    const { meta, segments } = parseM3u8(r.body, url);
    const mediaInPlaylist = extractMediaLinks(r.body, url, url);
    return json(200, {
      url,
      is_master: meta.isMaster,
      target_duration: meta.targetDuration,
      total_duration: meta.totalDuration,
      segment_count: segments.length,
      segments: segments.slice(0, 100),
      total_segments: segments.length,
      media_in_playlist: mediaInPlaylist,
    });
  } catch (e) {
    return json(500, { error: `解析失败: ${e.message}` });
  }
};
