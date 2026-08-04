/**
 * 资源下载代理 - Netlify Function
 * 注意：Netlify 函数有超时限制，大文件建议直接用直链下载（前端已自动切换）
 */
const { json, parseBody } = require('./_shared');

exports.handler = async (event) => {
  let url, fname;
  if (event.body && event.headers['content-type'] && event.headers['content-type'].includes('application/json')) {
    const data = parseBody(event);
    url = (data.url || '').trim();
    fname = data.filename;
  } else if (event.body) {
    // form-urlencoded
    const params = new URLSearchParams(event.body);
    url = (params.get('url') || '').trim();
    fname = params.get('filename');
  } else {
    const params = event.queryStringParameters || {};
    url = (params.url || '').trim();
    fname = params.filename;
  }

  if (!url) return json(400, { error: '请提供下载链接' });
  if (!/^https?:\/\//.test(url)) return json(400, { error: '链接格式无效' });

  const safeName = (fname || 'video.mp4').replace(/[\\/*?:"<>|]/g, '_');
  const finalName = /\.(mp4|mov|webm|flv|mkv)$/i.test(safeName) ? safeName : safeName + '.mp4';

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0.0.0',
        Referer: url,
      },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) return json(400, { error: `上游返回 HTTP ${resp.status}` });

    const buf = await resp.arrayBuffer();
    const contentType = resp.headers.get('content-type') || 'video/mp4';
    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(finalName)}`,
      },
      body: Buffer.from(buf).toString('base64'),
      isBase64Encoded: true,
    };
  } catch (e) {
    return json(500, { error: `下载失败: ${e.message}` });
  }
};
