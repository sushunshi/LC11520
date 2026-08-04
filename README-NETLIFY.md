# GhostTrack OSINT + MoonTV — Netlify 部署指南

本项目是**全栈 Netlify 部署版**：
- 前端 = 静态页面（`index.html` / `tv.html` / `static/`）
- 后端 = **Netlify Functions**（Node.js 无服务器函数，位于 `netlify/functions/`）
- 前端 API 路径 `/api/...` 由 `netlify.toml` 自动重定向到对应函数

> 本地 Flask 版（`python app.py`）仍然可用，二者共用同一套前端。

---

## 一、部署步骤（5 分钟）

### 1. 推送到 GitHub

```bash
cd ghosttrack-osint
git init
git add .
git commit -m "GhostTrack OSINT + MoonTV"
# 在 GitHub 新建仓库后：
git remote add origin https://github.com/你的用户名/仓库名.git
git push -u origin main
```

> `netlify/functions/` 与 `package.json` 必须一起提交，Netlify 会自动安装依赖。

### 2. 连接 Netlify

1. 打开 https://app.netlify.com → **Add new site → Import an existing project**
2. 选择 GitHub 上的仓库
3. 构建设置保持默认即可（`netlify.toml` 已配好 publish 目录与重定向）
4. 点击 **Deploy**，等 1-2 分钟
5. 部署完成后得到 `https://xxxxx.netlify.app`

### 3. 完成

- 主站：`https://xxxxx.netlify.app/`
- 影视聚合：`https://xxxxx.netlify.app/tv`（可在浏览器地址栏"安装应用"成为 PWA）

---

## 二、功能说明（与本地版一致）

| 模块 | 说明 |
|------|------|
| IP 定位 | ip-api.com + 反向 DNS（服务端执行） |
| 手机归属 | libphonenumber-js 解析 + 360 手机卫士归属地/运营商（免 key） |
| 用户名搜索 | 并发检测 20 个社交平台 + GitHub 详情 |
| 资源嗅探 | 页面媒体提取 / M3U8 解析 / 抖音视频解析 |
| 影视聚合 | 多源搜索 / 详情 / 播放（ArtPlayer+HLS）/ 番剧日历 / 豆瓣 / 收藏 |

## 三、影视配置存储

- 影视设置中的**配置文件**保存在 **Netlify Blobs**（`tv-config` 存储桶），跨部署持久化，无需数据库。
- 订阅导入 / 导出（base58）与 LunaTV 完全兼容。

## 四、注意事项

1. **Netlify Functions 超时限制**：免费版函数最长 10 秒（部分套餐 26 秒）。影视搜索/首页会自动限制并发与超时，正常使用没问题；个别慢资源站可能返回空。
2. **视频下载**：Netlify 上「下载」按钮会自动改为直接打开视频直链（`<a download>`），不再走代理——因为函数代理大文件会超时。
3. **默认资源站**（131资源 / 蓝志）为社区公开接口，失效时在「影视设置」里换成你自己的苹果 CMS V10 API。
4. **隐私**：所有外部请求都从 Netlify 服务器发起（而非访客浏览器），浏览器不会直接接触第三方站点。

## 五、本地开发

```bash
# 本地 Flask（需要 Python）
pip install flask phonenumbers
python app.py          # http://127.0.0.1:5000

# 本地跑 Netlify Functions
npm install
npx netlify dev        # 需要安装 netlify-cli
```
