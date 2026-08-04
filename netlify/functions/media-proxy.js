/**
 * 媒体 CORS 代理 - Netlify Function（精简版）
 * 仅代理 m3u8 manifest，分片地址重写为绝对地址走 CDN 直连（避免循环代理）
 */
const { json } = require('./_shared');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0' },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const text = await resp.text();
    const isM3u8 = /\.m3u8/i.test(url);
    if (!isM3u8) {
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' },
        body: text,
      };
    }
    // 重写分片为绝对地址（CDN 直连，避开循环）
    const lines = text.split('\n').map(function (line) {
      const t = line.trim();
      if (!t || t.charAt(0) === '#') return line;
      try { return new URL(t, url).href; } catch (e) { return line; }
    });
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/vnd.apple.mpegurl' },
      body: lines.join('\n'),
    };
  } catch (e) {
    return json(500, { error: e.message });
  }
};