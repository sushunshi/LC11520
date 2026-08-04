/**
 * 媒体 CORS 代理 - Netlify Function
 * 用于播放源不支持 CORS 时绕过限制（m3u8 会重写分片地址为代理地址）
 * 用法: /api/media-proxy?url=<encodeURIComponent(媒体地址)>
 */
const { json } = require('./_shared');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const url = (event.queryStringParameters || {}).url || '';
  if (!url) return json(400, { error: '缺少 url 参数' });
  if (!/^https?:\/\//.test(url)) return json(400, { error: 'url 格式无效' });

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0.0.0',
        Referer: new URL(url).origin + '/',
      },
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    const contentType = resp.headers.get('content-type') || '';
    const isM3u8 = /m3u8|mpegurl/i.test(contentType) || /\.m3u8/i.test(url);

    if (isM3u8) {
      // 文本：重写分片地址，全部走代理，避免浏览器 CORS
      const text = await resp.text();
      const base = new URL(url);
      const proxyBase = '/api/media-proxy?url=';
      const lines = text.split('\n').map((line) => {
        const l = line.trim();
        if (!l || l.startsWith('#')) return line;
        const abs = new URL(l, url).href;
        return proxyBase + encodeURIComponent(abs);
      });
      return {
        statusCode: 200,
        headers: {
          ...CORS,
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-store',
        },
        body: lines.join('\n'),
      };
    }

    // 二进制媒体：base64 透传
    const buf = Buffer.from(await resp.arrayBuffer());
    return {
      statusCode: resp.status,
      headers: { ...CORS, 'Content-Type': contentType || 'video/mp4' },
      body: buf.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (e) {
    return json(500, { error: `代理失败: ${e.message}` });
  }
};
