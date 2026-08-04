/**
 * 影视配置订阅导入 - Netlify Function (POST)
 */
const { json, parseBody, loadConfig, saveConfig, base58Decode } = require('./_shared');

exports.handler = async (event) => {
  const data = parseBody(event);
  let raw = (data.base58 || '').trim();
  if (!raw) return json(400, { error: '请输入订阅链接' });
  // 去掉 URL 前缀，只留 base58 段
  raw = raw.replace(/^https?:\/\//, '').split('/').pop().trim();

  try {
    const cfg = JSON.parse(base58Decode(raw));
    if (!cfg || typeof cfg.api_site !== 'object' || cfg.api_site === null) {
      return json(400, { error: '订阅内容不是有效的 MoonTV 配置' });
    }
    if (typeof cfg.custom_category !== 'object' || !Array.isArray(cfg.custom_category)) cfg.custom_category = [];
    if (typeof cfg.cache_time !== 'number') cfg.cache_time = 7200;
    await saveConfig(cfg);
    return json(200, { ok: true, message: '订阅导入成功' });
  } catch (e) {
    return json(400, { error: `订阅解析失败: ${e.message}` });
  }
};
