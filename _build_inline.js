// Build script: 把 tv2.js inline 到 tv.html, 同时干掉 hls.js CDN 引用
// 不用 replace 的字符串替换 (避免 $$ 转义问题), 用 indexOf + slice
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname);
const tv2 = fs.readFileSync(path.join(repo, 'static/js/tv2.js'), 'utf8');
const html = fs.readFileSync(path.join(repo, 'tv.html'), 'utf8');

// 1. 干掉 hls.js CDN 引用
let out = html.replace(
  /<script\s+src=["']https:\/\/cdn\.jsdelivr\.net\/npm\/hls\.js[^"']+["']><\/script>\s*\n?/i,
  '<!-- hls.js removed: 浏览器无法加载外部脚本, 改走原生 MSE (playHlsNative) -->\n'
);

// 2. 用 indexOf + slice 替换 tv2.js 引用
const tv2Pattern = /<script\s+src=["']\/static\/js\/tv2\.js(?:\?v=\d+)?["']><\/script>/i;
const tv2Match = out.match(tv2Pattern);
if (!tv2Match) {
  console.error('ERROR: 没找到 tv2.js script 引用');
  process.exit(1);
}
const before = out.slice(0, tv2Match.index);
const after = out.slice(tv2Match.index + tv2Match[0].length);
out = before + '<script>\n/* tv2.js inline @ ' + new Date().toISOString() + ' */\n' + tv2 + '\n</script>' + after;

fs.writeFileSync(path.join(repo, 'tv.html'), out);
console.log('OK, tv.html inline 完成, 大小:', out.length, '字节');

// 验证关键位置 $$$ 是否完整
const check = out.includes("split('$$$')");
console.log('check split($$$) 完整:', check);
if (!check) {
  console.error('!!! inline 后 $$$ 被损坏 !!!');
  process.exit(1);
}