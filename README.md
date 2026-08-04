# GhostTrack OSINT + MoonTV 影视聚合

轻量级开源情报工具 + 影视聚合播放器，部署在 **Netlify**（静态前端 + Netlify Functions 后端）。

## 功能

| 模块 | 说明 |
|------|------|
| 🔍 IP 定位 | ip-api.com + 反向 DNS + 代理/托管检测 |
| 📱 手机归属 | libphonenumber-js 解析 + 360 手机卫士归属地/运营商（免 key） |
| 👤 用户名搜索 | 并发检测 20 个社交平台 + GitHub 详情 |
| 🕸️ 资源嗅探 | 页面媒体提取 / M3U8 解析 / 抖音视频解析 |
| 🎬 影视聚合 | 多源搜索 / 详情 / 播放（ArtPlayer + HLS.js）/ 番剧日历 / 豆瓣 / 收藏/继续观看 |

## 目录结构

```
├── index.html / tv.html      # 前端页面
├── static/                   # 前端静态资源 (CSS/JS)
├── netlify.toml              # Netlify 配置 + /api/* 重定向到函数
├── package.json              # 函数依赖 (libphonenumber-js, @netlify/blobs)
├── netlify/functions/        # 后端（Netlify Functions, Node.js）
│   ├── ip-lookup.js          # IP 定位
│   ├── phone-lookup.js       # 手机归属
│   ├── username-search.js    # 用户名搜索
│   ├── resource-*.js         # 资源嗅探 / M3U8 / 解析 / 下载
│   ├── media-proxy.js        # 媒体 CORS 代理
│   └── tv-*.js               # 影视聚合 API
├── app.py / tv_router.py     # 本地 Flask 开发版（可选）
└── templates/                # Flask 模板（与根目录 HTML 一致）
```

## 部署到 Netlify

1. 把本仓库连接到 Netlify（Import from GitHub）
2. 构建设置无需修改（`netlify.toml` 已配置）
3. 部署完成即获得 `https://xxx.netlify.app`

影视配置（资源站 API）保存在 **Netlify Blobs**，在页面「影视设置」中管理，支持 base58 订阅导入/导出（与 LunaTV 兼容）。

## 本地开发

```bash
# Netlify 函数本地调试
npm install
npx netlify dev

# 或使用 Flask 版
pip install flask phonenumbers
python app.py   # http://127.0.0.1:5000
```

## 免责声明

仅供学习与合法安全研究、个人使用。影视内容均来自第三方资源站，本站不存储任何视频资源。
