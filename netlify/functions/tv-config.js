/**
 * 影视配置 - Netlify Function (GET/POST)
 * 存储使用 Netlify Blobs
 */
const { json, parseBody, loadConfig, saveConfig, base58Encode } = require('./_shared');

exports.handler = async (event) => {
  if (event.httpMethod === 'GET') {
    const cfg = await loadConfig();
    return json(200, { config: cfg, config_base58: base58Encode(JSON.stringify(cfg)) });
  }

  if (event.httpMethod === 'POST') {
    const data = parseBody(event);
    let cfg = data.config || {};
    if (typeof cfg !== 'object' || Array.isArray(cfg)) cfg = {};
    if (typeof cfg.api_site !== 'object' || cfg.api_site === null || Array.isArray(cfg.api_site)) cfg.api_site = {};
    if (!Array.isArray(cfg.custom_category)) cfg.custom_category = [];
    if (typeof cfg.cache_time !== 'number') cfg.cache_time = 7200;
    await saveConfig(cfg);
    return json(200, { ok: true, config_base58: base58Encode(JSON.stringify(cfg)) });
  }

  return json(405, { error: 'Method Not Allowed' });
};
