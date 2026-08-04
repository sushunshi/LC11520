"""
LunaTV (MoonTV) Integration - 影视聚合后端
Flask Blueprint: 苹果CMS V10 API 聚合 / 豆瓣数据 / 番剧日历 / 配置管理
"""
import re
import os
import json
import time
import base64
import ssl
import urllib.request
import urllib.parse
import urllib.error
import threading
from flask import Blueprint, render_template, request, jsonify, Response

tv_bp = Blueprint("tv", __name__, url_prefix="")

# ---------- paths ----------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "tv_config.json")

# ---------- default config ----------
DEFAULT_CONFIG = {
    "cache_time": 7200,
    "api_site": {
        "131zy": {
            "api": "https://appapi.131zy.net/api.php/provide/vod",
            "name": "131资源",
            "detail": ""
        },
        "lzzy": {
            "api": "https://cj.lziapi.com/api.php/provide/vod",
            "name": "蓝志资源",
            "detail": ""
        }
    },
    "custom_category": [
        {"name": "热门", "type": "movie", "query": "热门"},
        {"name": "最新", "type": "movie", "query": "最新"},
        {"name": "豆瓣高分", "type": "movie", "query": "豆瓣高分"},
        {"name": "华语", "type": "movie", "query": "华语"},
        {"name": "欧美", "type": "movie", "query": "欧美"},
        {"name": "日韩", "type": "movie", "query": "日韩"},
        {"name": "动作", "type": "movie", "query": "动作"},
        {"name": "科幻", "type": "movie", "query": "科幻"},
        {"name": "喜剧", "type": "movie", "query": "喜剧"},
        {"name": "悬疑", "type": "movie", "query": "悬疑"},
        {"name": "恐怖", "type": "movie", "query": "恐怖"},
        {"name": "动漫", "type": "movie", "query": "动漫"},
        {"name": "热门剧集", "type": "tv", "query": "热门"},
        {"name": "美剧", "type": "tv", "query": "美剧"},
        {"name": "英剧", "type": "tv", "query": "英剧"},
        {"name": "韩剧", "type": "tv", "query": "韩剧"},
        {"name": "日剧", "type": "tv", "query": "日剧"},
        {"name": "国产剧", "type": "tv", "query": "国产剧"},
        {"name": "综艺", "type": "tv", "query": "综艺"},
        {"name": "纪录片", "type": "tv", "query": "纪录片"}
    ]
}

# ---------- cache ----------
_cache = {}
_cache_lock = threading.Lock()

def _cache_get(key):
    with _cache_lock:
        entry = _cache.get(key)
        if entry and time.time() < entry["expire"]:
            return entry["value"]
        return None

def _cache_set(key, value, ttl):
    with _cache_lock:
        _cache[key] = {"value": value, "expire": time.time() + ttl}


# ---------- config load/save ----------
def load_config():
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                cfg = json.load(f)
                if "api_site" not in cfg:
                    cfg["api_site"] = {}
                if "custom_category" not in cfg:
                    cfg["custom_category"] = []
                if "cache_time" not in cfg:
                    cfg["cache_time"] = 7200
                return cfg
        except Exception:
            pass
    return json.loads(json.dumps(DEFAULT_CONFIG))

def save_config(cfg):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


# ---------- HTTP helpers ----------
_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36"

def _http_get(url, timeout=10, headers=None):
    h = {"User-Agent": _UA, "Accept": "*/*"}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, headers=h)
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        resp = urllib.request.urlopen(req, timeout=timeout, context=ctx)
        return resp.getcode(), resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            pass
        return e.code, body
    except Exception:
        return None, ""


def _abs_url(url, base):
    """把相对地址解析为绝对地址。"""
    if url.startswith("http://") or url.startswith("https://"):
        return url
    if url.startswith("//"):
        return "https:" + url
    return urllib.parse.urljoin(base, url)


# ---------- 苹果CMS V10 API ----------
def _cms_api(api_base, ac, params=None):
    """Call an AppleCMS V10 vod API."""
    url = api_base.rstrip("/") + "/?ac=" + ac
    if params:
        url += "&" + urllib.parse.urlencode(params)
    code, body = _http_get(url)
    if code != 200:
        return None
    try:
        return json.loads(body)
    except Exception:
        return None


def _normalize_item(item, site_key, site_name):
    """Normalize a CMS list item."""
    return {
        "site_key": site_key,
        "site_name": site_name,
        "vod_id": item.get("vod_id"),
        "vod_name": item.get("vod_name", ""),
        "vod_pic": item.get("vod_pic", ""),
        "vod_remarks": item.get("vod_remarks", ""),
        "vod_actor": item.get("vod_actor", ""),
        "vod_director": item.get("vod_director", ""),
        "vod_year": item.get("vod_year", ""),
        "vod_area": item.get("vod_area", ""),
        "vod_lang": item.get("vod_lang", ""),
        "vod_score": item.get("vod_score", ""),
        "vod_type": item.get("vod_type", ""),
        "vod_time": item.get("vod_time", ""),
    }


# ===================== 页面 =====================
@tv_bp.route("/tv")
def tv_page():
    cfg = load_config()
    return render_template("tv.html", config=cfg)


@tv_bp.route("/tv-manifest")
def tv_manifest():
    """PWA manifest for installability."""
    return jsonify({
        "name": "MoonTV",
        "short_name": "MoonTV",
        "description": "影视聚合播放器",
        "start_url": "/tv",
        "display": "standalone",
        "background_color": "#0f1115",
        "theme_color": "#f43f5e",
        "icons": [{
            "src": "data:image/svg+xml," + urllib.parse.quote('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#f43f5e"/><circle cx="16" cy="16" r="5" fill="#fff"/></svg>'),
            "sizes": "any",
            "type": "image/svg+xml"
        }]
    })


# ===================== 配置 =====================
@tv_bp.route("/api/tv/config", methods=["GET", "POST"])
def tv_config():
    if request.method == "GET":
        cfg = load_config()
        return jsonify({"config": cfg, "config_base58": base58_encode(json.dumps(cfg, ensure_ascii=False))})
    data = request.get_json(force=True)
    cfg = data.get("config") or {}
    # sanitize
    if not isinstance(cfg.get("api_site"), dict):
        cfg["api_site"] = {}
    if not isinstance(cfg.get("custom_category"), list):
        cfg["custom_category"] = []
    if not isinstance(cfg.get("cache_time"), (int, float)):
        cfg["cache_time"] = 7200
    save_config(cfg)
    return jsonify({"ok": True, "config_base58": base58_encode(json.dumps(cfg, ensure_ascii=False))})


@tv_bp.route("/api/tv/config/subscribe", methods=["POST"])
def tv_subscribe():
    """Import config from base58 subscription link."""
    data = request.get_json(force=True)
    raw = (data.get("base58") or "").strip()
    # strip common prefixes
    raw = raw.replace("https://", "").replace("http://", "").split("/")[-1].strip()
    try:
        json_str = base58_decode(raw)
        cfg = json.loads(json_str)
        if not isinstance(cfg.get("api_site"), dict):
            return jsonify({"error": "订阅内容不是有效的 MoonTV 配置"}), 400
        save_config(cfg)
        return jsonify({"ok": True, "message": "订阅导入成功"})
    except Exception as e:
        return jsonify({"error": f"订阅解析失败: {str(e)}"}), 400


# ===================== 首页 / 分类 =====================
@tv_bp.route("/api/tv/home")
def tv_home():
    cfg = load_config()
    cache_time = int(cfg.get("cache_time", 7200))
    source_key = request.args.get("source", "all")

    # gather sources to query
    sources = []
    if source_key == "all":
        sources = list(cfg.get("api_site", {}).items())
    elif source_key in cfg.get("api_site", {}):
        sources = [(source_key, cfg["api_site"][source_key])]

    result = {"sources": [], "lists": []}
    for key, site in sources:
        entry = {"source": key, "name": site.get("name", key), "items": []}
        cached = _cache_get(f"home_{key}")
        if cached:
            entry["items"] = cached
            result["lists"].append(entry)
            result["sources"].append({"key": key, "name": site.get("name", key)})
            continue
        api = site.get("api", "")
        if not api:
            continue
        data = _cms_api(api, "list", {"pg": 1})
        if not data or not isinstance(data.get("list"), list):
            continue
        items = [_normalize_item(i, key, site.get("name", key)) for i in data["list"][:24]]
        _cache_set(f"home_{key}", items, cache_time)
        entry["items"] = items
        result["sources"].append({"key": key, "name": site.get("name", key)})
        result["lists"].append(entry)

    if not result["lists"]:
        return jsonify({"sources": [], "lists": [], "error": "暂无可用资源站，请在影视设置中配置"})

    return jsonify(result)


# ===================== 搜索（多源） =====================
@tv_bp.route("/api/tv/search")
def tv_search():
    wd = (request.args.get("wd") or "").strip()
    pg = int(request.args.get("pg", "1"))
    max_pages = 5
    if not wd:
        return jsonify({"error": "请输入搜索关键词"}), 400

    cfg = load_config()
    cache_time = int(cfg.get("cache_time", 7200))
    results = []

    def search_one(key, site):
        api = site.get("api", "")
        if not api:
            return
        cached = _cache_get(f"search_{key}_{wd}")
        if cached:
            results.append(cached)
            return
        data = _cms_api(api, "search", {"wd": wd, "pg": pg})
        if not data or not isinstance(data.get("list"), list):
            return
        items = [_normalize_item(i, key, site.get("name", key)) for i in data["list"][:30]]
        entry = {"source": key, "name": site.get("name", key), "items": items}
        _cache_set(f"search_{key}_{wd}", entry, cache_time)
        results.append(entry)

    threads = []
    for key, site in cfg.get("api_site", {}).items():
        t = threading.Thread(target=search_one, args=(key, site))
        t.start()
        threads.append(t)
    for t in threads:
        t.join(timeout=12)

    results = [r for r in results if r["items"]]
    return jsonify({"wd": wd, "results": results})


# ===================== 详情 =====================
@tv_bp.route("/api/tv/detail")
def tv_detail():
    vod_id = (request.args.get("vod_id") or "").strip()
    source = (request.args.get("source") or "").strip()
    if not vod_id or not source:
        return jsonify({"error": "缺少参数"}), 400

    cfg = load_config()
    cache_time = int(cfg.get("cache_time", 7200))
    site = cfg.get("api_site", {}).get(source)
    if not site:
        return jsonify({"error": "资源站不存在"}), 404

    cached = _cache_get(f"detail_{source}_{vod_id}")
    if cached:
        return jsonify(cached)

    data = _cms_api(site.get("api", ""), "detail", {"ids": vod_id})
    if not data or not isinstance(data.get("list"), list) or not data["list"]:
        return jsonify({"error": "获取详情失败"}), 400

    d = data["list"][0]
    detail = {
        "source": source,
        "site_name": site.get("name", source),
        "vod_id": d.get("vod_id"),
        "vod_name": d.get("vod_name", ""),
        "vod_pic": d.get("vod_pic", ""),
        "vod_remarks": d.get("vod_remarks", ""),
        "vod_actor": d.get("vod_actor", ""),
        "vod_director": d.get("vod_director", ""),
        "vod_writer": d.get("vod_writer", ""),
        "vod_year": d.get("vod_year", ""),
        "vod_area": d.get("vod_area", ""),
        "vod_lang": d.get("vod_lang", ""),
        "vod_score": d.get("vod_score", ""),
        "vod_type": d.get("vod_type", ""),
        "vod_content": d.get("vod_content", ""),
        "vod_play_from": d.get("vod_play_from", ""),
        "vod_play_url": d.get("vod_play_url", ""),
        "vod_down_url": d.get("vod_down_url", ""),
        "vod_time": d.get("vod_time", ""),
    }
    _cache_set(f"detail_{source}_{vod_id}", detail, cache_time)
    return jsonify(detail)


# ===================== 播放解析 =====================
@tv_bp.route("/api/tv/play")
def tv_play():
    """Parse play URL for a video: vod_id + ep index (+ play_from group)."""
    vod_id = (request.args.get("vod_id") or "").strip()
    source = (request.args.get("source") or "").strip()
    ep = int(request.args.get("ep", "1"))
    play_from = (request.args.get("from") or "").strip()

    cfg = load_config()
    site = cfg.get("api_site", {}).get(source)
    if not site:
        return jsonify({"error": "资源站不存在"}), 404

    cached = _cache_get(f"detail_{source}_{vod_id}")
    if cached:
        detail = cached
    else:
        data = _cms_api(site.get("api", ""), "detail", {"ids": vod_id})
        if not data or not isinstance(data.get("list"), list) or not data["list"]:
            return jsonify({"error": "获取播放信息失败"}), 400
        detail = data["list"][0]
        _cache_set(f"detail_{source}_{vod_id}", detail, int(cfg.get("cache_time", 7200)))

    vod_play_url = detail.get("vod_play_url", "") or ""
    vod_play_from = detail.get("vod_play_from", "") or ""

    # parse groups: "线路1$$$线路2" and each group "ep1$url#ep2$url"
    from_list = [f.strip() for f in vod_play_from.split("$$$") if f.strip()]
    groups = [g.strip() for g in vod_play_url.split("$$$") if g.strip()]

    # choose group
    group_idx = 0
    if play_from and from_list:
        for i, f in enumerate(from_list):
            if f == play_from:
                group_idx = i
                break
    elif ep > 1:
        group_idx = 0

    if not groups or group_idx >= len(groups):
        return jsonify({"error": "没有可播放的线路"}), 400

    group = groups[group_idx]
    episodes = []
    for pair in group.split("#"):
        pair = pair.strip()
        if "$" not in pair:
            continue
        name, url = pair.split("$", 1)
        episodes.append({"name": name, "url": url})

    if not episodes:
        return jsonify({"error": "无播放源"}), 400

    ep_idx = min(max(ep - 1, 0), len(episodes) - 1)
    target = episodes[ep_idx]

    # sanitize play url: strip javascript:void(0)
    if target["url"].startswith("javascript"):
        target["url"] = ""

    # resolve 分享页 → 真实 m3u8/mp4
    playable_url = target["url"]
    if target["url"] and not re.search(r"\.(m3u8|mp4|mov|webm|flv|mkv)(\?|$)", target["url"], re.I):
        cache_key = f"playable_{source}_{vod_id}_{ep_idx}"
        cached = _cache_get(cache_key)
        if cached:
            playable_url = cached
        else:
            resolved = _resolve_share_url(target["url"])
            if resolved:
                playable_url = resolved
                _cache_set(cache_key, resolved, 3600)

    return jsonify({
        "source": source,
        "site_name": site.get("name", source),
        "vod_name": detail.get("vod_name", ""),
        "vod_pic": detail.get("vod_pic", ""),
        "from": from_list[group_idx] if group_idx < len(from_list) else "",
        "ep_index": ep_idx + 1,
        "episode": target,
        "playable_url": playable_url,
        "episode_count": len(episodes),
        "episodes": episodes,
        "vod_id": vod_id,
    })


def _resolve_share_url(url, timeout=8):
    """从分享页提取真实播放地址（var main = 'xxx.m3u8' 等模式）。"""
    import urllib.parse as _up
    if re.search(r"\.(m3u8|mp4|mov|webm|flv|mkv)(\?|$)", url, re.I):
        return url
    try:
        code, body = _http_get(url, timeout=timeout)
        if code != 200 or not body:
            return None
        # var main = "xxx.m3u8" / var xml = "xxx.m3u8"
        m = re.search(r'var\s+(?:main|xml)\s*=\s*["\']([^"\']*?\.m3u8[^"\']*)["\']', body, re.I)
        if m:
            return _abs_url(m.group(1).strip(), url)
        m = re.search(r'var\s+url\s*=\s*["\']([^"\']*?\.m3u8[^"\']*)["\']', body, re.I)
        if m:
            return _abs_url(m.group(1).strip(), url)
        m = re.search(r'["\']((?:https?:)?//[^"\'\s]*?\.m3u8[^"\'\s]*)["\']', body, re.I)
        if m:
            return _abs_url(m.group(1), url)
        m = re.search(r'<(?:video|source)[^>]+src=["\']([^"\']+)["\']', body, re.I)
        if m:
            return _abs_url(m.group(1), url)
        m = re.search(r'["\']((?:https?:)?//[^"\'\s]*?\.(?:mp4|webm|flv)[^"\'\s]*)["\']', body, re.I)
        if m:
            return _abs_url(m.group(1), url)
    except Exception:
        pass
    return None


# ===================== 番剧日历 =====================
@tv_bp.route("/api/tv/calendar")
def tv_calendar():
    """Anime update calendar via server-side proxy."""
    cache_key = "anime_calendar"
    cached = _cache_get(cache_key)
    if cached:
        return jsonify(cached)

    try:
        code, body = _http_get("https://api.bgm.tv/calendar", timeout=12, headers={
            "User-Agent": "LunaTV/1.0 (https://github.com/MoonTechLab/LunaTV)"
        })
        if code != 200:
            return jsonify({"error": "番剧日历获取失败"}), 400
        data = json.loads(body)
        result = []
        weekday_cn = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
        for day in data:
            items = []
            for s in day.get("items", [])[:12]:
                items.append({
                    "name": s.get("name", ""),
                    "name_cn": s.get("name_cn", ""),
                    "image": s.get("images", {}).get("large", ""),
                    "rating": s.get("rating", {}).get("score", ""),
                    "air_date": s.get("air_date", ""),
                })
            result.append({
                "weekday": weekday_cn[int(day.get("weekday", {}).get("id", 0)) % 7],
                "items": items
            })
        _cache_set(cache_key, {"days": result}, 3600)
        return jsonify({"days": result})
    except Exception as e:
        return jsonify({"error": f"番剧日历获取失败: {str(e)}"}), 500


# ===================== 媒体 CORS 代理 =====================
@tv_bp.route("/api/media-proxy")
def tv_media_proxy():
    """CORS 代理：绕过播放源的跨域限制。m3u8 会重写分片地址走代理。"""
    media_url = (request.args.get("url") or "").strip()
    if not media_url:
        return jsonify({"error": "缺少 url 参数"}), 400
    if not media_url.startswith("http"):
        return jsonify({"error": "url 格式无效"}), 400

    try:
        code, body = _http_get(media_url, timeout=15)
        if code != 200 or not body:
            return jsonify({"error": f"代理失败 (HTTP {code or 'timeout'})"}), 400

        is_m3u8 = ".m3u8" in media_url.lower()
        if is_m3u8:
            # 重写分片地址为绝对代理地址
            lines = []
            for line in body.split("\n"):
                l = line.strip()
                if not l or l.startswith("#"):
                    lines.append(line)
                    continue
                abs_url = _abs_url(l, media_url)
                lines.append("/api/media-proxy?url=" + urllib.parse.quote(abs_url, safe=""))
            resp = Response("\n".join(lines), mimetype="application/vnd.apple.mpegurl")
        else:
            # 二进制透传（Flask 下直接返回原始字节流）
            import urllib.request as _ur
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            req = urllib.request.Request(media_url, headers={
                "User-Agent": _UA, "Referer": media_url
            })
            raw = urllib.request.urlopen(req, timeout=15, context=ctx).read()
            resp = Response(raw, mimetype="video/mp4")

        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Cache-Control"] = "no-store"
        return resp
    except Exception as e:
        return jsonify({"error": f"代理失败: {str(e)}"}), 500


# ===================== 豆瓣数据 =====================
DOUBAN_TAGS = {
    "movie": ["热门", "最新", "经典", "豆瓣高分", "冷门佳片", "华语", "欧美", "韩国", "日本",
              "动作", "喜剧", "爱情", "科幻", "悬疑", "恐怖", "治愈", "动漫"],
    "tv": ["热门", "美剧", "英剧", "韩剧", "日剧", "国产剧", "港剧", "日本动画", "综艺", "纪录片"],
}

@tv_bp.route("/api/tv/douban")
def tv_douban():
    """Douban search_subjects API (server-side proxy)."""
    qtype = request.args.get("type", "movie")
    tag = request.args.get("tag", "热门")
    page = int(request.args.get("page", "1"))
    page_limit = int(request.args.get("limit", "20"))
    page_start = (page - 1) * page_limit

    cache_key = f"douban_{qtype}_{tag}_{page}"
    cached = _cache_get(cache_key)
    if cached:
        return jsonify(cached)

    url = ("https://movie.douban.com/j/search_subjects"
           f"?type={urllib.parse.quote(qtype)}"
           f"&tag={urllib.parse.quote(tag)}"
           f"&sort=recommend&page_limit={page_limit}&page_start={page_start}")
    code, body = _http_get(url, timeout=12, headers={"Referer": "https://movie.douban.com/"})
    if code != 200:
        return jsonify({"error": "豆瓣数据获取失败"}), 400
    try:
        data = json.loads(body)
        subjects = data.get("subjects", [])
        items = []
        for s in subjects:
            items.append({
                "title": s.get("title", ""),
                "rate": s.get("rate", ""),
                "cover": s.get("cover", ""),
                "url": s.get("url", ""),
                "id": s.get("id", ""),
            })
        result = {"items": items, "tag": tag, "type": qtype, "page": page}
        _cache_set(cache_key, result, 7200)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": f"豆瓣数据解析失败: {str(e)}"}), 500


# ===================== base58 =====================
BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

def base58_encode(data: str) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    n = int.from_bytes(data, "big")
    res = ""
    while n > 0:
        n, r = divmod(n, 58)
        res = BASE58_ALPHABET[r] + res
    # leading zeros
    for b in data:
        if b == 0:
            res = "1" + res
        else:
            break
    return res

def base58_decode(s: str) -> str:
    n = 0
    for c in s:
        if c not in BASE58_ALPHABET:
            raise ValueError("invalid base58 char: " + c)
        n = n * 58 + BASE58_ALPHABET.index(c)
    full = n.to_bytes((n.bit_length() + 7) // 8, "big") if n > 0 else b""
    # leading 1s
    pad = 0
    for c in s:
        if c == "1":
            pad += 1
        else:
            break
    full = b"\x00" * pad + full
    return full.decode("utf-8")
