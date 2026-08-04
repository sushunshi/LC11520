/**
 * 媒体 CORS 代理 - Netlify Function（彻底走代理版）
 *
 * 所有媒体请求（含 m3u8 manifest + ts/mp4 分片）都经过本函数，
 * 响应统一带 CORS 头，前端永远同源，彻底解决浏览器的 m3u8 CORS 限制。
 *
 * - m3u8 文本：解析后把所有分片/子 playlist URL 重写为代理 URL
 * - 其他资源（ts/mp4/m4s...）：直接 fetch 并转发二进制
 */
const { json, absUrl } = require('./_shared');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS, HEAD',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
  'Access-Control-Max-Age': '86400',
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36';

function proxyUrl(target) {
  return '/.netlify/functions/media-proxy?url=' + encodeURIComponent(target);
}

function isM3u8(u) {
  return /\.m3u8(\?|$)/i.test(u);
}

function rewriteM3u8Text(text, baseUrl) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.charAt(0) === '#') continue;
    // URI attributes in tags (key="value", value="uri")
    // 仅重写 value 中的绝对路径 / 相对路径，不动带参数的签名串? 这里我们无脑全包到代理，安全
    let abs;
    try { abs = absUrl(t, baseUrl); } catch (e) { continue; }
    lines[i] = proxyUrl(abs);
  }
  return lines.join('\n');
}

exports.handler = async (event) => {
  // CORS 预检
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const url = (event.queryStringParameters || {}).url || '';
  if (!url) return json(400, { error: 'missing url' });
  if (!/^https?:\/\//i.test(url)) return json(400, { error: 'invalid url' });

  // 简单防回环：禁止代理自己
  if (/netlify\.functions\/media-proxy/.test(url)) {
    return json(400, { error: 'loop' });
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);

    const upstreamHeaders = { 'User-Agent': UA, Accept: '*/*' };
    // 透传 Range，请求分片更稳
    const range = (event.headers || {})['range'] || (event.headers || {})['Range'];
    if (range) upstreamHeaders['Range'] = range;
    const referer = (event.headers || {})['referer'] || (event.headers || {})['Referer'];
    if (referer) upstreamHeaders['Referer'] = referer;

    const resp = await fetch(url, {
      headers: upstreamHeaders,
      signal: ctrl.signal,
      redirect: 'follow',
    });
    clearTimeout(timer);

    const contentType = resp.headers.get('content-type') || '';
    const contentLength = resp.headers.get('content-length') || '';
    const contentRange = resp.headers.get('content-range') || '';
    const acceptRanges = resp.headers.get('accept-ranges') || '';

    if (isM3u8(url) || /mpegurl/i.test(contentType)) {
      const text = await resp.text();
      const rewritten = rewriteM3u8Text(text, resp.url || url);
      return {
        statusCode: 200,
        headers: {
          ...CORS,
          'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'Cache-Control': 'public, max-age=300, s-maxage=300',
        },
        body: rewritten,
      };
    }

    // 二进制分片：直接转发 ArrayBuffer
    const buf = await resp.arrayBuffer();
    const body = Buffer.from(buf);
    return {
      statusCode: resp.status,
      headers: {
        ...CORS,
        'Content-Type': contentType || 'application/octet-stream',
        ...(contentLength ? { 'Content-Length': contentLength } : {}),
        ...(contentRange ? { 'Content-Range': contentRange } : {}),
        ...(acceptRanges ? { 'Accept-Ranges': acceptRanges } : { 'Accept-Ranges': 'bytes' }),
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
      body: body.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (e) {
    return json(502, { error: 'proxy fetch failed: ' + (e && e.message || 'unknown') });
  }
};
