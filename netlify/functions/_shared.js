/**
 * GhostTrack OSINT Netlify Functions - 共享工具
 * 所有 function 依赖此模块（Netlify 会自动打包相对导入）
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36';

// ---------- 响应工具 ----------
function json(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(obj),
  };
}

function parseBody(event) {
  try {
    return JSON.parse(event.body || '{}');
  } catch (e) {
    return {};
  }
}

// ---------- HTTP 工具 ----------
async function httpGet(url, timeout = 8000, headers = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: '*/*', ...headers },
      signal: ctrl.signal,
    });
    const text = await resp.text();
    return {
      status: resp.status,
      url: resp.url,
      body: text,
      headers: {
        'content-type': resp.headers.get('content-type') || '',
        'access-control-allow-origin': resp.headers.get('access-control-allow-origin') || '',
      },
    };
  } catch (e) {
    return { status: 0, url, body: '', headers: {} };
  } finally {
    clearTimeout(timer);
  }
}

async function httpGetJson(url, timeout = 8000, headers = {}) {
  const r = await httpGet(url, timeout, headers);
  if (r.status !== 200 || !r.body) return null;
  try {
    return JSON.parse(r.body);
  } catch (e) {
    return null;
  }
}

// ---------- URL 工具 ----------
function absUrl(url, base) {
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('//')) return 'https:' + url;
  try {
    return new URL(url, base).href;
  } catch (e) {
    return url;
  }
}

function extractUrls(text) {
  const re = /https?:\/\/[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+[^\s\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]*/g;
  const found = text.match(re);
  if (!found || !found.length) return null;
  return found[found.length - 1].replace(/[.,;:!?)]+$/, '');
}

// ---------- 平台识别 ----------
const PLATFORMS = [
  { name: '微信视频号', domain: 'channels.weixin.qq.com', icon: 'wechat', color: '#07c160' },
  { name: '抖音', domain: 'douyin.com', icon: 'tiktok', color: '#000' },
  { name: '快手', domain: 'kuaishou.com', icon: 'kuaishou', color: '#ff4906' },
  { name: '小红书', domain: 'xiaohongshu.com', icon: 'xiaohongshu', color: '#fe2c55' },
  { name: 'Bilibili', domain: 'bilibili.com', icon: 'bilibili', color: '#fb7299' },
  { name: 'YouTube', domain: 'youtube.com', icon: 'youtube', color: '#f00' },
  { name: '酷狗音乐', domain: 'kugou.com', icon: 'kugou', color: '#2e8bff' },
  { name: 'QQ音乐', domain: 'y.qq.com', icon: 'qqmusic', color: '#31c27c' },
  { name: '网易云音乐', domain: 'music.163.com', icon: 'netease', color: '#ec4141' },
  { name: '微博', domain: 'weibo.com', icon: 'weibo', color: '#e6162d' },
  { name: '知乎', domain: 'zhihu.com', icon: 'zhihu', color: '#0084ff' },
  { name: '百度网盘', domain: 'pan.baidu.com', icon: 'baidu', color: '#3388ff' },
];

function detectPlatform(url) {
  const u = url.toLowerCase();
  for (const p of PLATFORMS) {
    if (u.includes(p.domain)) return p;
  }
  return null;
}

// ---------- 媒体链接提取 ----------
function walkJson(obj, out, base) {
  if (Array.isArray(obj)) {
    obj.forEach((i) => walkJson(i, out, base));
  } else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') {
        const l = v.toLowerCase();
        if (/\.(mp4|mov|webm|flv|mkv)(\?|$)/.test(l)) out.videos.push(absUrl(v, base));
        else if (/\.m3u8(\?|$)/.test(l)) out.m3u8.push(absUrl(v, base));
        else if (/\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/.test(l)) out.images.push(absUrl(v, base));
        else if (/\.(mp3|wav|flac|aac|m4a|ogg)(\?|$)/.test(l)) out.audio.push(absUrl(v, base));
      } else if (v && typeof v === 'object') {
        walkJson(v, out, base);
      }
    }
  }
}

function extractMediaLinks(html, baseUrl, pageUrl) {
  const results = { images: [], videos: [], audio: [], m3u8: [], other: [] };
  const push = (arr, u) => arr.push(absUrl(u, baseUrl));

  // meta tags
  let m;
  const metaRe = /<meta[^>]+(?:property|name)=["'](?:og:video(?::(?:url|secure_url))?|video_url|twitter:image)["'][^>]+content=["']([^"']+)["']/gi;
  while ((m = metaRe.exec(html))) push(results.videos, m[1]);
  const metaImgRe = /<meta[^>]+(?:property|name)=["'](?:og:image(?::(?:url|secure_url))?|twitter:image)["'][^>]+content=["']([^"']+)["']/gi;
  while ((m = metaImgRe.exec(html))) push(results.images, m[1]);

  // JSON-LD
  const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis;
  while ((m = ldRe.exec(html))) {
    try {
      walkJson(JSON.parse(m[1]), results, baseUrl);
    } catch (e) {}
  }

  // embedded JSON in scripts
  const scriptRe = /<script[^>]*>(.*?)<\/script>/gis;
  while ((m = scriptRe.exec(html))) {
    const js = m[1];
    const vm = /["']((?:https?:)?\/\/[^"'\s]*?\.(?:mp4|mov|webm|flv)[^"'\s]*)["']/gi;
    let x;
    while ((x = vm.exec(js))) push(results.videos, x[1]);
    const km = /["'](?:playAddr|video_url|downloadAddr|play_url|srcNoMark)["']\s*:\s*["']([^"']+)["']/gi;
    while ((x = km.exec(js))) {
      if (x[1].startsWith('http')) push(results.videos, x[1]);
    }
  }

  // standard elements
  const imgRe = /<img[^>]+src=["']([^"']+)["']/gi;
  while ((m = imgRe.exec(html))) push(results.images, m[1]);
  const videoRe = /<(?:video|source)[^>]+src=["']([^"']+)["']/gi;
  while ((m = videoRe.exec(html))) {
    const u = absUrl(m[1], baseUrl);
    if (/\.m3u8/i.test(u)) results.m3u8.push(u);
    else results.videos.push(u);
  }
  const audioRe = /<audio[^>]+src=["']([^"']+)["']/gi;
  while ((m = audioRe.exec(html))) push(results.audio, m[1]);

  // bare URLs
  const bareM3u8 = /["'](https?:\/\/[^"'\s]*?\.m3u8[^"'\s]*)["']/gi;
  while ((m = bareM3u8.exec(html))) results.m3u8.push(m[1]);
  const bareVid = /["'](https?:\/\/[^"'\s]*?\.(?:mp4|mov|webm|flv|mkv)[^"'\s]*)["']/gi;
  while ((m = bareVid.exec(html))) results.videos.push(m[1]);
  const bareImg = /["'](https?:\/\/[^"'\s]*?\.(?:jpg|jpeg|png|gif|webp|svg|bmp)[^"'\s]*)["']/gi;
  while ((m = bareImg.exec(html))) results.images.push(m[1]);
  const bareAud = /["'](https?:\/\/[^"'\s]*?\.(?:mp3|wav|flac|ogg|aac|m4a)[^"'\s]*)["']/gi;
  while ((m = bareAud.exec(html))) results.audio.push(m[1]);

  // video ids
  let vid;
  if ((vid = pageUrl.match(/\/(?:video|note|embed)\/(\d{10,20})/))) {
    results.other.push({ type: 'video_id', platform: 'douyin', id: vid[1] });
  }
  if ((vid = pageUrl.match(/\/(?:video|bangumi\/play)\/((?:BV|av|ep|ss)[\w]+)/i))) {
    results.other.push({ type: 'video_id', platform: 'bilibili', id: vid[1] });
  }
  if ((vid = pageUrl.match(/[?&]v=([\w-]{11})/))) {
    results.other.push({ type: 'video_id', platform: 'youtube', id: vid[1] });
  }

  // dedupe
  for (const k of ['images', 'videos', 'audio', 'm3u8']) {
    results[k] = [...new Set(results[k])].slice(0, 30);
  }
  return results;
}

// ---------- M3U8 解析 ----------
const MEDIA_EXT = /\.(m3u8|mp4|mov|webm|flv|mkv|mp3|aac|m4a)(\?|$)/i;

/**
 * 解析"分享页"式播放地址（如 v.lzcdn.com/share/xxx 这类 HTML 页）
 * 页面内通常有 var main = "/2026xx/xxx/index.m3u8?sign=..." 之类的 JS 变量
 */
async function resolvePlayableUrl(url, timeout = 8000) {
  if (MEDIA_EXT.test(url)) return url;

  try {
    const r = await httpGet(url, timeout);
    if (r.status !== 200 || !r.body) return null;
    const finalUrl = r.url || url;
    const ct = (r.headers && r.headers['content-type']) || '';

    if (ct.includes('video') || ct.includes('mpegurl')) return finalUrl;

    const html = r.body;
    // 1. 任意完整 https m3u8 URL（最通用）
    let m = html.match(/["'](https?:\/\/[^"'\s]*?\.m3u8[^"'\s]*?)["']/i);
    if (m) return absUrl(m[1], finalUrl);
    // 2. 任意完整路径（绝对/相对）
    m = html.match(/["']([\/]?[\w\-\/\.\?=&]*?\.m3u8[^"'\s]*?)["']/i);
    if (m) return absUrl(m[1], finalUrl);
    // 3. var 任意名 = "...m3u8..."
    m = html.match(/var\s+\w+\s*=\s*["']([^"']*?\.m3u8[^"']*)["']/i);
    if (m) return absUrl(m[1].trim(), finalUrl);
    // 4. video/source 标签
    m = html.match(/<(?:video|source)[^>]+src=["']([^"']+)["']/i);
    if (m) return absUrl(m[1], finalUrl);
  } catch (e) {}
  return null;
}

function parseM3u8(content, baseUrl) {
  const lines = content.split('\n');
  const segments = [];
  const meta = { targetDuration: null, totalDuration: 0, isMaster: false };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      meta.targetDuration = parseInt(line.split(':')[1], 10);
    } else if (line.startsWith('#EXTINF:')) {
      const dur = parseFloat(line.split(':')[1].split(',')[0]) || 0;
      let segUrl = '';
      for (let j = i + 1; j < lines.length; j++) {
        const nxt = lines[j].trim();
        if (nxt && !nxt.startsWith('#')) {
          segUrl = nxt;
          break;
        }
      }
      if (segUrl) {
        segments.push({ index: segments.length + 1, duration: Math.round(dur * 1000) / 1000, url: absUrl(segUrl, baseUrl) });
        meta.totalDuration = Math.round((meta.totalDuration + dur) * 1000) / 1000;
      }
    } else if (line.startsWith('#EXT-X-STREAM-INF:')) {
      meta.isMaster = true;
      for (let j = i + 1; j < lines.length; j++) {
        const nxt = lines[j].trim();
        if (nxt && !nxt.startsWith('#')) {
          segments.push({ index: segments.length + 1, duration: 0, url: absUrl(nxt, baseUrl), isSubPlaylist: true });
          break;
        }
      }
    }
  }
  return { meta, segments };
}

// ---------- 影视：默认配置 / Blobs 存取 ----------
const DEFAULT_CONFIG = {
  cache_time: 7200,
  api_site: {
    '131zy': { api: 'https://appapi.131zy.net/api.php/provide/vod', name: '131资源', detail: '' },
    lzzy: { api: 'https://cj.lziapi.com/api.php/provide/vod', name: '蓝志资源', detail: '' },
  },
  custom_category: [
    { name: '热门', type: 'movie', query: '热门' },
    { name: '最新', type: 'movie', query: '最新' },
    { name: '豆瓣高分', type: 'movie', query: '豆瓣高分' },
    { name: '华语', type: 'movie', query: '华语' },
    { name: '欧美', type: 'movie', query: '欧美' },
    { name: '日韩', type: 'movie', query: '日韩' },
    { name: '动作', type: 'movie', query: '动作' },
    { name: '科幻', type: 'movie', query: '科幻' },
    { name: '喜剧', type: 'movie', query: '喜剧' },
    { name: '悬疑', type: 'movie', query: '悬疑' },
    { name: '恐怖', type: 'movie', query: '恐怖' },
    { name: '动漫', type: 'movie', query: '动漫' },
    { name: '热门剧集', type: 'tv', query: '热门' },
    { name: '美剧', type: 'tv', query: '美剧' },
    { name: '英剧', type: 'tv', query: '英剧' },
    { name: '韩剧', type: 'tv', query: '韩剧' },
    { name: '日剧', type: 'tv', query: '日剧' },
    { name: '国产剧', type: 'tv', query: '国产剧' },
    { name: '综艺', type: 'tv', query: '综艺' },
    { name: '纪录片', type: 'tv', query: '纪录片' },
  ],
};

let _store = null;
function getStore() {
  if (!_store) {
    // 动态 require，避免在非 Netlify 环境（本地测试）加载失败
    try {
      const { getStore } = require('@netlify/blobs');
      _store = getStore('tv-config');
    } catch (e) {
      _store = null;
    }
  }
  return _store;
}

async function loadConfig() {
  const store = getStore();
  if (store) {
    try {
      const cfg = await store.getJSON('config');
      if (cfg && cfg.api_site && typeof cfg.api_site === 'object') return cfg;
    } catch (e) {}
  }
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

async function saveConfig(cfg) {
  const store = getStore();
  if (store) {
    try {
      await store.setJSON('config', cfg);
    } catch (e) {}
  }
}

// ---------- 影视：缓存 ----------
const cacheMap = new Map();
function cacheGet(key) {
  const e = cacheMap.get(key);
  if (e && Date.now() < e.expire) return e.value;
  return undefined;
}
function cacheSet(key, value, ttlSeconds) {
  cacheMap.set(key, { value, expire: Date.now() + ttlSeconds * 1000 });
}

// ---------- 影视：苹果CMS API ----------
function cmsApi(apiBase, ac, params = {}) {
  const url = new URL(apiBase.replace(/\/+$/, '') + '/');
  url.searchParams.set('ac', ac);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return httpGetJson(url.href, 8000);
}

function normalizeItem(item, siteKey, siteName) {
  return {
    site_key: siteKey,
    site_name: siteName,
    vod_id: item.vod_id,
    vod_name: item.vod_name || '',
    vod_pic: item.vod_pic || '',
    vod_remarks: item.vod_remarks || '',
    vod_actor: item.vod_actor || '',
    vod_director: item.vod_director || '',
    vod_year: item.vod_year || '',
    vod_area: item.vod_area || '',
    vod_lang: item.vod_lang || '',
    vod_score: item.vod_score || '',
    vod_type: item.vod_type || '',
    vod_time: item.vod_time || '',
  };
}

function parsePlayGroups(fromStr, urlStr) {
  const fromList = String(fromStr || '').split('$$$').filter((s) => s.trim());
  const groupList = String(urlStr || '').split('$$$').filter((s) => s.trim());
  const groups = [];
  groupList.forEach((group, i) => {
    const from = fromList[i] && fromList[i].trim() ? fromList[i].trim() : String(i + 1);
    const eps = [];
    group.split('#').forEach((pair) => {
      pair = pair.trim();
      const idx = pair.indexOf('$');
      if (idx > -1) {
        const name = pair.slice(0, idx);
        const url = pair.slice(idx + 1);
        if (!url.startsWith('javascript')) eps.push({ name, url });
      }
    });
    if (eps.length) groups.push({ from, eps });
  });
  return groups;
}

// ---------- base58 ----------
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Encode(str) {
  let bytes = Buffer.from(str, 'utf8');
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let res = '';
  while (n > 0n) {
    res = B58[Number(n % 58n)] + res;
    n = n / 58n;
  }
  for (const b of bytes) {
    if (b === 0) res = '1' + res;
    else break;
  }
  return res;
}
function base58Decode(s) {
  let n = 0n;
  for (const c of s) {
    const idx = B58.indexOf(c);
    if (idx < 0) throw new Error('invalid base58 char: ' + c);
    n = n * 58n + BigInt(idx);
  }
  const hex = n.toString(16);
  const bytes = Buffer.from(hex.length % 2 ? '0' + hex : hex, 'hex');
  let pad = 0;
  for (const c of s) {
    if (c === '1') pad++;
    else break;
  }
  return Buffer.concat([Buffer.alloc(pad), bytes]).toString('utf8');
}

// ---------- 导出 ----------
module.exports = {
  UA,
  json,
  parseBody,
  httpGet,
  httpGetJson,
  absUrl,
  extractUrls,
  PLATFORMS,
  detectPlatform,
  extractMediaLinks,
  parseM3u8,
  resolvePlayableUrl,
  DEFAULT_CONFIG,
  loadConfig,
  saveConfig,
  cacheGet,
  cacheSet,
  cmsApi,
  normalizeItem,
  parsePlayGroups,
  base58Encode,
  base58Decode,
};
