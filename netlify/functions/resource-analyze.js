/**
 * 页面嗅探 - Netlify Function
 */
const { json, parseBody, httpGet, extractUrls, detectPlatform, extractMediaLinks } = require('./_shared');

exports.handler = async (event) => {
  let rawInput = (parseBody(event).url || '').trim();
  if (!rawInput) return json(400, { error: '请输入 URL' });

  const extracted = extractUrls(rawInput);
  let url = extracted || (rawInput.startsWith('http') ? rawInput : 'https://' + rawInput);
  url = url.trim();
  if (!/^https?:\/\//.test(url)) url = 'https://' + url;

  let platform = detectPlatform(url);
  const result = {
    url,
    original_input: rawInput !== url ? rawInput.slice(0, 200) : null,
    platform,
    page_title: '',
    media: null,
    raw_links: [],
  };

  try {
    const r = await httpGet(url, 10000);
    const finalUrl = r.url || url;
    if (r.status === 200 && r.body) {
      result.final_url = finalUrl;
      if (!platform) {
        platform = detectPlatform(finalUrl);
        result.platform = platform;
      }
      const tm = r.body.match(/<title[^>]*>(.*?)<\/title>/is);
      if (tm) result.page_title = tm[1].trim().slice(0, 200);

      result.media = extractMediaLinks(r.body, finalUrl, finalUrl);

      const raw = [];
      const re1 = /(?:src|href|data-url|data-src|poster)=["'](https?:\/\/[^"'\s]+)["']/gi;
      let m;
      while ((m = re1.exec(r.body))) raw.push(m[1]);
      const re2 = /["'](https?:\/\/[^"'\s]{10,})["']/g;
      while ((m = re2.exec(r.body))) raw.push(m[1]);
      result.raw_links = [...new Set(raw)].slice(0, 50);

      if (platform && ['抖音', '快手', '小红书', '微信视频号'].includes(platform.name)) {
        result.note = '该平台页面为 JS 渲染，视频链接可能无法直接获取。请使用 res-downloader 桌面版进行 MITM 代理截获。';
      }
    } else {
      result.error = r.status ? `页面返回 HTTP ${r.status}` : '无法访问此 URL';
    }
  } catch (e) {
    result.error = `请求失败: ${e.message}`;
  }

  return json(200, result);
};
