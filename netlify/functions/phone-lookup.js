/**
 * 手机归属 - Netlify Function
 * libphonenumber-js 解析校验 + 360 手机卫士归属地/运营商（免 key，仅中国大陆号段）
 */
const { parsePhoneNumberFromString, getCountryCallingCode } = require('libphonenumber-js/max');
const { json, parseBody, httpGet } = require('./_shared');

const TYPE_MAP = {
  MOBILE: '手机',
  FIXED_LINE: '固定电话',
  FIXED_LINE_OR_MOBILE: '固定电话或手机',
  TOLL_FREE: '免费电话',
  PREMIUM_RATE: '付费电话',
  SHARED_COST: '共享费用电话',
  VOIP: 'VoIP',
  PERSONAL_NUMBER: '个人号码',
  PAGER: '寻呼机',
  UAN: 'UAN',
};

const SP_MAP = { 移动: '中国移动', 联通: '中国联通', 电信: '中国电信', 广电: '中国广电' };

const COUNTRY_ZH = {
  CN: '中国', US: '美国/加拿大', GB: '英国', JP: '日本', KR: '韩国', FR: '法国', DE: '德国',
  RU: '俄罗斯', IT: '意大利', AU: '澳大利亚', IN: '印度', BR: '巴西', MX: '墨西哥', ES: '西班牙',
  SG: '新加坡', TH: '泰国', VN: '越南', PH: '菲律宾', MY: '马来西亚', ID: '印尼', TW: '中国台湾',
  HK: '中国香港', MO: '中国澳门', TR: '土耳其', NL: '荷兰', SE: '瑞典', NO: '挪威', DK: '丹麦',
  FI: '芬兰', PL: '波兰', UA: '乌克兰', CH: '瑞士', AT: '奥地利', BE: '比利时', PT: '葡萄牙',
  GR: '希腊', HU: '匈牙利', CZ: '捷克', RO: '罗马尼亚', NZ: '新西兰', ZA: '南非', EG: '埃及',
  NG: '尼日利亚', AR: '阿根廷', CL: '智利', CO: '哥伦比亚', PE: '秘鲁', PK: '巴基斯坦',
  BD: '孟加拉国', LK: '斯里兰卡', IR: '伊朗', SA: '沙特阿拉伯', AE: '阿联酋', IL: '以色列',
};

const COUNTRY_TZ = {
  CN: 'Asia/Shanghai', US: 'America/New_York', GB: 'Europe/London', JP: 'Asia/Tokyo',
  KR: 'Asia/Seoul', DE: 'Europe/Berlin', FR: 'Europe/Paris', RU: 'Europe/Moscow',
  AU: 'Australia/Sydney', IN: 'Asia/Kolkata', SG: 'Asia/Singapore', HK: 'Asia/Hong_Kong',
  TW: 'Asia/Taipei', MO: 'Asia/Macau', TH: 'Asia/Bangkok', VN: 'Asia/Ho_Chi_Minh',
  MY: 'Asia/Kuala_Lumpur', ID: 'Asia/Jakarta', PH: 'Asia/Manila',
};

async function lookupCn360(nationalNumber) {
  // 360 手机卫士接口：返回省 + 运营商
  try {
    const r = await httpGet(`https://cx.shouji.360.cn/phonearea.php?number=${nationalNumber}`, 6000, { Referer: 'https://shouji.360.cn/' });
    if (r.status === 200 && r.body) {
      const d = JSON.parse(r.body);
      if (d && d.code === 0 && d.data) {
        const sp = SP_MAP[d.data.sp] || d.data.sp || '未知';
        const province = d.data.province || '';
        const city = d.data.city || '';
        return { province, city, carrier: sp, location: city && city !== province ? `${province} ${city}` : province };
      }
    }
  } catch (e) {}
  return null;
}

exports.handler = async (event) => {
  const { phone } = parseBody(event);
  if (!phone) return json(400, { error: '请输入手机号码' });

  let digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('00')) digits = '+' + digits.slice(2);
  if (!digits.startsWith('+')) digits = '+86' + digits.replace(/^\+/, '');

  let number = null;
  try {
    number = parsePhoneNumberFromString(digits);
  } catch (e) {}

  // fallback 简化解析（无国家码时尝试 CN）
  if (!number) {
    try {
      number = parsePhoneNumberFromString(phone.replace(/[^\d]/g, ''), 'CN');
    } catch (e2) {}
  }

  // 基础信息
  const base = {
    valid: false,
    possible: false,
    original: phone,
    formatted: digits,
    national_fmt: digits,
    e164: digits,
    country_code: '',
    national_number: digits.replace(/[^\d]/g, ''),
    location_zh: '未知',
    location_en: '',
    carrier_zh: '未知',
    carrier_en: '',
    region_code: '',
    number_type: '未知',
    timezone: '未知',
    geo_lat: null,
    geo_lon: null,
  };

  if (!number) return json(200, base);

  try {
    base.valid = number.isValid();
    base.possible = number.isPossible();
    base.country_code = '+' + number.countryCallingCode;
    base.national_number = number.nationalNumber;
    base.formatted = number.formatInternational();
    base.national_fmt = number.formatNational();
    base.e164 = number.number;
    base.region_code = number.country || '未知';
    const type = number.getType();
    base.number_type = TYPE_MAP[type] || '未知';
    base.location_zh = COUNTRY_ZH[number.country] || '未知';
    base.timezone = COUNTRY_TZ[number.country] || '未知';

    // CN 号段：360 接口补充归属地 + 运营商
    if (number.country === 'CN' && base.national_number.length === 11 && base.national_number.startsWith('1')) {
      const info = await lookupCn360(base.national_number);
      if (info) {
        base.location_zh = info.location || base.location_zh;
        base.carrier_zh = info.carrier;
      }
    }
  } catch (e) {}

  return json(200, base);
};
