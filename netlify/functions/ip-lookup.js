/**
 * IP 定位 - Netlify Function
 * 调用 ip-api.com + 反向 DNS
 */
const dns = require('dns');
const { json, parseBody, httpGetJson } = require('./_shared');

function reverseDns(ip) {
  return new Promise((resolve) => {
    dns.reverse(ip, (err, hostnames) => {
      resolve(err || !hostnames || !hostnames.length ? null : hostnames[0]);
    });
  });
}

function riskFlags(org, isp, asname) {
  const combined = ((org || '') + ' ' + (isp || '') + ' ' + (asname || '')).toLowerCase();
  const flags = [];
  const hostingKw = ['hosting', 'vps', 'cloud', 'server', 'datacenter', 'colo', 'dedicated', 'amazon', 'google cloud', 'azure', 'digitalocean', 'linode', 'vultr', 'ovh', 'hetzner'];
  const proxyKw = ['vpn', 'proxy', 'tor', 'relay', 'exit', 'tunnel'];
  if (hostingKw.some((k) => combined.includes(k))) flags.push({ type: 'hosting', label: '数据中心/托管', severity: 'info' });
  if (proxyKw.some((k) => combined.includes(k))) flags.push({ type: 'proxy', label: '可能为 VPN/代理', severity: 'warn' });
  return flags;
}

exports.handler = async (event) => {
  const { ip } = parseBody(event);
  if (!ip) return json(400, { error: '请输入 IP 地址' });
  if (!/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(ip)) {
    return json(400, { error: 'IP 格式无效' });
  }

  const parts = ip.split('.').map(Number);
  const isPrivate =
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254);

  if (isPrivate) {
    return json(200, {
      ip, country: '本地/内网', countryCode: 'LO', region: '-', city: '-', zip: '-',
      lat: null, lon: null, timezone: '-', isp: '私有/保留地址', org: '本地网络', as_info: '-',
      rdns: null, risk_flags: [{ type: 'private', label: '私有/内网地址', severity: 'info' }], is_private: true,
    });
  }

  try {
    const fields = 'status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,asname,query,mobile,proxy,hosting';
    const data = await httpGetJson(`http://ip-api.com/json/${ip}?fields=${fields}`, 8000, { 'User-Agent': 'GhostTrack-OSINT/2.0' });
    if (!data || data.status !== 'success') {
      return json(400, { error: (data && data.message) || '查询失败' });
    }
    const rdns = await reverseDns(ip);
    return json(200, {
      ip: data.query, country: data.country, countryCode: data.countryCode,
      region: data.regionName, city: data.city, zip: data.zip,
      lat: data.lat, lon: data.lon, timezone: data.timezone,
      isp: data.isp, org: data.org,
      as_info: `${data.as || ''} ${data.asname || ''}`.trim(),
      mobile: !!data.mobile, proxy: !!data.proxy, hosting: !!data.hosting,
      rdns,
      risk_flags: riskFlags(data.org, data.isp, data.asname),
      is_private: false,
    });
  } catch (e) {
    return json(500, { error: `查询失败: ${e.message}` });
  }
};
