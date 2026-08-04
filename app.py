"""
GhostTrack OSINT v2 - Lightweight OSINT Tool
IP Geolocation / Phone Lookup / Username Search / Resource Sniffer
Enhanced with reverse-DNS, proxy detection, map coords, rich profiles.
"""
import re
import json
import socket
import urllib.request
import urllib.error
import urllib.parse
import ssl
import base64
import hashlib
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError as FuturesTimeoutError
from flask import Flask, render_template, request, jsonify, Response
from tv_router import tv_bp

app = Flask(__name__)
app.register_blueprint(tv_bp)

# ---------- Social platforms ----------
SOCIAL_PLATFORMS = [
    {"name":"GitHub",     "url":"https://github.com/{}",           "icon":"github",    "category":"\u4ee3\u7801/\u5f00\u53d1","api":"github"},
    {"name":"Reddit",     "url":"https://www.reddit.com/user/{}",  "icon":"reddit",    "category":"\u793e\u533a","api":None},
    {"name":"YouTube",    "url":"https://www.youtube.com/@{}",     "icon":"youtube",   "category":"\u89c6\u9891","api":None},
    {"name":"Steam",      "url":"https://steamcommunity.com/id/{}","icon":"steam",      "category":"\u6e38\u620f","api":None},
    {"name":"Dev.to",     "url":"https://dev.to/{}",               "icon":"devto",     "category":"\u4ee3\u7801/\u5f00\u53d1","api":None},
    {"name":"Medium",     "url":"https://medium.com/@{}",          "icon":"medium",    "category":"\u535a\u5ba2","api":None},
    {"name":"Keybase",    "url":"https://keybase.io/{}",           "icon":"keybase",   "category":"\u52a0\u5bc6\u901a\u8baf","api":None},
    {"name":"Pinterest",  "url":"https://www.pinterest.com/{}/",   "icon":"pinterest", "category":"\u56fe\u7247","api":None},
    {"name":"Twitch",     "url":"https://www.twitch.tv/{}",        "icon":"twitch",    "category":"\u76f4\u64ad","api":None},
    {"name":"Patreon",    "url":"https://www.patreon.com/{}",      "icon":"patreon",   "category":"\u521b\u4f5c","api":None},
    {"name":"Twitter/X",  "url":"https://x.com/{}",                "icon":"twitter",   "category":"\u793e\u4ea4","api":None},
    {"name":"Telegram",   "url":"https://t.me/{}",                 "icon":"telegram",  "category":"\u5373\u65f6\u901a\u8baf","api":None},
    {"name":"Instagram",  "url":"https://www.instagram.com/{}/",   "icon":"instagram", "category":"\u793e\u4ea4","api":None},
    {"name":"TikTok",     "url":"https://www.tiktok.com/@{}",      "icon":"tiktok",    "category":"\u77ed\u89c6\u9891","api":None},
    {"name":"Spotify",    "url":"https://open.spotify.com/user/{}","icon":"spotify",   "category":"\u97f3\u4e50","api":None},
    {"name":"Vimeo",      "url":"https://vimeo.com/{}",            "icon":"vimeo",     "category":"\u89c6\u9891","api":None},
    {"name":"Dribbble",   "url":"https://dribbble.com/{}",         "icon":"dribbble",  "category":"\u8bbe\u8ba1","api":None},
    {"name":"Behance",    "url":"https://www.behance.net/{}",      "icon":"behance",   "category":"\u8bbe\u8ba1","api":None},
    {"name":"SoundCloud", "url":"https://soundcloud.com/{}",       "icon":"soundcloud","category":"\u97f3\u4e50","api":None},
    {"name":"Flickr",     "url":"https://www.flickr.com/people/{}","icon":"flickr",    "category":"\u6444\u5f71","api":None},
]


# ===================== HTTP helpers =====================
_SSL_CTX = None
def _get_ssl_ctx():
    global _SSL_CTX
    if _SSL_CTX is None:
        _SSL_CTX = ssl.create_default_context()
        _SSL_CTX.check_hostname = False
        _SSL_CTX.verify_mode = ssl.CERT_NONE
    return _SSL_CTX

_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36"

def _http_get(url, timeout=5):
    req = urllib.request.Request(url, headers={"User-Agent":_UA, "Accept":"text/html,*/*"})
    try:
        resp = urllib.request.urlopen(req, timeout=timeout, context=_get_ssl_ctx())
        return resp.getcode(), resp.geturl(), resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        body = ""
        try: body = e.read().decode("utf-8", errors="replace")
        except: pass
        return e.code, None, body
    except Exception:
        return None, None, ""

def _http_get_json(url, timeout=5):
    req = urllib.request.Request(url, headers={"User-Agent":_UA, "Accept":"application/json"})
    try:
        resp = urllib.request.urlopen(req, timeout=timeout, context=_get_ssl_ctx())
        return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None


# ===================== IP LOOKUP =====================
def _reverse_dns(ip):
    """Try to resolve reverse DNS hostname."""
    try:
        hostname, _, _ = socket.gethostbyaddr(ip)
        return hostname
    except Exception:
        return None

def _get_ip_risk_info(data):
    """Analyze IP for risk indicators."""
    flags = []
    org = (data.get("org","") or "").lower()
    isp = (data.get("isp","") or "").lower()
    as_name = (data.get("asname","") or "").lower()
    combined = f"{org} {isp} {as_name}"
    hosting_kw = ["hosting","vps","cloud","server","datacenter","colo","dedicated","amazon","google cloud","azure","digitalocean","linode","vultr","ovh","hetzner"]
    proxy_kw   = ["vpn","proxy","tor","relay","exit","tunnel"]
    for kw in hosting_kw:
        if kw in combined:
            flags.append({"type":"hosting","label":"数据中心/托管","severity":"info"})
            break
    for kw in proxy_kw:
        if kw in combined:
            flags.append({"type":"proxy","label":"\u53ef\u80fd\u4e3a VPN/\u4ee3\u7406","severity":"warn"})
            break
    return flags

@app.route("/api/ip-lookup", methods=["POST"])
def ip_lookup():
    data = request.get_json(force=True)
    ip = (data.get("ip") or "").strip()
    if not ip:
        return jsonify({"error":"\u8bf7\u8f93\u5165 IP \u5730\u5740"}), 400
    if not re.match(r"^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$", ip):
        return jsonify({"error":"IP \u683c\u5f0f\u65e0\u6548"}), 400

    # private / reserved check
    parts = [int(x) for x in ip.split(".")]
    is_private = (
        parts[0]==10 or
        (parts[0]==172 and 16<=parts[1]<=31) or
        (parts[0]==192 and parts[1]==168) or
        parts[0]==127 or
        (parts[0]==169 and parts[1]==254)
    )
    if is_private:
        return jsonify({
            "ip":ip,"country":"\u672c\u5730/\u5185\u7f51","countryCode":"LO",
            "region":"-","city":"-","zip":"-","lat":None,"lon":None,
            "timezone":"-","isp":"\u79c1\u6709/\u4fdd\u7559\u5730\u5740",
            "org":"\u672c\u5730\u7f51\u7edc","as_info":"-",
            "rdns":None,"risk_flags":[{"type":"private","label":"\u79c1\u6709/\u5185\u7f51\u5730\u5740","severity":"info"}],
            "is_private":True,
        })

    try:
        fields = "status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,asname,query,mobile,proxy,hosting"
        api_url = f"http://ip-api.com/json/{ip}?fields={fields}"
        req = urllib.request.Request(api_url, headers={"User-Agent":"GhostTrack-OSINT/2.0"})
        resp = urllib.request.urlopen(req, timeout=8, context=_get_ssl_ctx())
        result = json.loads(resp.read().decode("utf-8"))
        if result.get("status") != "success":
            return jsonify({"error":result.get("message","\u67e5\u8be2\u5931\u8d25")}), 400

        rdns = _reverse_dns(ip)
        risk_flags = _get_ip_risk_info(result)

        return jsonify({
            "ip":result.get("query"),
            "country":result.get("country"),
            "countryCode":result.get("countryCode"),
            "region":result.get("regionName"),
            "city":result.get("city"),
            "zip":result.get("zip"),
            "lat":result.get("lat"),
            "lon":result.get("lon"),
            "timezone":result.get("timezone"),
            "isp":result.get("isp"),
            "org":result.get("org"),
            "as_info":f'{result.get("as","")} {result.get("asname","")}'.strip(),
            "mobile":bool(result.get("mobile")),
            "proxy":bool(result.get("proxy")),
            "hosting":bool(result.get("hosting")),
            "rdns":rdns,
            "risk_flags":risk_flags,
            "is_private":False,
        })
    except Exception as e:
        return jsonify({"error":f"\u67e5\u8be2\u5931\u8d25: {str(e)}"}), 500


# ===================== PHONE LOOKUP =====================
def _geocode_location(loc_str):
    """Try to geocode a location string to lat/lon via Nominatim."""
    if not loc_str or loc_str == "\u672a\u77e5":
        return None, None
    try:
        url = f"https://nominatim.openstreetmap.org/search?q={urllib.request.quote(loc_str)}&format=json&limit=1"
        data = _http_get_json(url, timeout=5)
        if data and len(data)>0:
            return float(data[0]["lat"]), float(data[0]["lon"])
    except Exception:
        pass
    return None, None

def _analyze_phone_number(phone: str) -> dict:
    raw = phone.strip()
    digits = re.sub(r"[^\d+]", "", raw)
    if digits.startswith("00"):
        digits = "+" + digits[2:]

    # ---- phonenumbers path ----
    try:
        import phonenumbers
        from phonenumbers import geocoder, carrier, NumberParseException, timezone as pn_timezone
        try:
            parsed = phonenumbers.parse(digits, "CN")
        except NumberParseException:
            try:
                parsed = phonenumbers.parse("+86"+digits.lstrip("+"), "CN")
            except NumberParseException:
                parsed = phonenumbers.parse(digits, None)

        if not phonenumbers.is_possible_number(parsed):
            for region in ["CN","US","GB","JP","KR","DE","FR","IN","BR","RU"]:
                try:
                    parsed = phonenumbers.parse(digits, region)
                    if phonenumbers.is_possible_number(parsed):
                        break
                except Exception:
                    continue

        valid = phonenumbers.is_valid_number(parsed)
        possible = phonenumbers.is_possible_number(parsed)
        country_code = f"+{parsed.country_code}"
        national_number = str(parsed.national_number)
        intl_fmt = phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.INTERNATIONAL)
        national_fmt = phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.NATIONAL)
        e164_fmt = phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)

        # location
        location_zh = "\u672a\u77e5"; location_en = ""
        try:
            location_zh = geocoder.description_for_number(parsed, "zh") or "\u672a\u77e5"
        except: pass
        try:
            location_en = geocoder.description_for_number(parsed, "en") or ""
        except: pass

        # carrier
        carrier_zh = "\u672a\u77e5"; carrier_en = ""
        try:
            carrier_zh = carrier.name_for_number(parsed, "zh") or "\u672a\u77e5"
        except: pass
        try:
            carrier_en = carrier.name_for_number(parsed, "en") or ""
        except: pass

        region_code = phonenumbers.region_code_for_number(parsed) or "\u672a\u77e5"

        # timezone
        tz_list = pn_timezone.time_zones_for_number(parsed)
        timezone_str = ", ".join(tz_list) if tz_list else "\u672a\u77e5"

        # number type
        nt = phonenumbers.number_type(parsed)
        nt_map = {0:"\u56fa\u5b9a\u7535\u8bdd",1:"\u624b\u673a",2:"\u56fa\u5b9a\u7535\u8bdd\u6216\u624b\u673a",3:"\u514d\u8d39\u7535\u8bdd",4:"\u4ed8\u8d39\u7535\u8bdd",5:"\u5171\u4eab\u8d39\u7528\u7535\u8bdd",6:"VoIP",7:"\u4e2a\u4eba\u53f7\u7801",8:"\u5bfb\u547c\u673a",9:"UAN",10:"\u672a\u77e5",27:"\u7d27\u6025\u7535\u8bdd"}
        num_type = nt_map.get(nt, "\u672a\u77e5")

        # geocode location for map
        loc_for_geo = location_zh if location_zh != "\u672a\u77e5" else location_en
        geo_lat, geo_lon = _geocode_location(loc_for_geo)

        return {
            "valid":valid, "possible":possible,
            "original":phone, "formatted":intl_fmt,
            "national_fmt":national_fmt, "e164":e164_fmt,
            "country_code":country_code, "national_number":national_number,
            "location_zh":location_zh, "location_en":location_en,
            "carrier_zh":carrier_zh, "carrier_en":carrier_en,
            "region_code":region_code, "number_type":num_type,
            "timezone":timezone_str, "geo_lat":geo_lat, "geo_lon":geo_lon,
        }
    except (ImportError, NameError):
        pass

    # ---- regex fallback ----
    country_map = {
        "86":("\u4e2d\u56fd","CN"),"1":("\u7f8e\u56fd/\u52a0\u62ff\u5927","US"),"44":("\u82f1\u56fd","GB"),"81":("\u65e5\u672c","JP"),
        "82":("\u97e9\u56fd","KR"),"33":("\u6cd5\u56fd","FR"),"49":("\u5fb7\u56fd","DE"),"7":("\u4fc4\u7f57\u65af","RU"),
        "39":("\u610f\u5927\u5229","IT"),"61":("\u6fb3\u5927\u5229\u4e9a","AU"),"91":("\u5370\u5ea6","IN"),"55":("\u5df4\u897f","BR"),
        "52":("\u58a8\u897f\u54e5","MX"),"34":("\u897f\u73ed\u7259","ES"),"65":("\u65b0\u52a0\u5761","SG"),"66":("\u6cf0\u56fd","TH"),
        "84":("\u8d8a\u5357","VN"),"63":("\u83f2\u5f8b\u5bbe","PH"),"60":("\u9a6c\u6765\u897f\u4e9a","MY"),"62":("\u5370\u5c3c","ID"),
        "886":("\u4e2d\u56fd\u53f0\u6e7e","TW"),"852":("\u4e2d\u56fd\u9999\u6e2f","HK"),"853":("\u4e2d\u56fd\u6fb3\u95e8","MO"),
        "90":("\u571f\u8033\u5176","TR"),"31":("\u8377\u5170","NL"),"46":("\u745e\u5178","SE"),
        "47":("\u632a\u5a01","NO"),"45":("\u4e39\u9ea6","DK"),"358":("\u82ac\u5170","FI"),"48":("\u6ce2\u5170","PL"),
        "380":("\u4e4c\u514b\u5170","UA"),"41":("\u745e\u58eb","CH"),"43":("\u5965\u5730\u5229","AT"),"32":("\u6bd4\u5229\u65f6","BE"),
        "351":("\u8461\u8404\u7259","PT"),"30":("\u5e0c\u814a","GR"),"36":("\u5308\u7259\u5229","HU"),
        "420":("\u6377\u514b","CZ"),"40":("\u7f57\u9a6c\u5c3c\u4e9a","RO"),"64":("\u65b0\u897f\u5170","NZ"),
        "27":("\u5357\u975e","ZA"),"20":("\u57c3\u53ca","EG"),"54":("\u963f\u6839\u5ef7","AR"),
        "56":("\u667a\u5229","CL"),"57":("\u54e5\u4f26\u6bd4\u4e9a","CO"),"51":("\u79d8\u9c81","PE"),
        "92":("\u5df4\u57fa\u65af\u5766","PK"),"880":("\u5b5f\u52a0\u62c9\u56fd","BD"),"966":("\u6c99\u7279\u963f\u62c9\u4f2f","SA"),
        "971":("\u963f\u8054\u914b","AE"),"972":("\u4ee5\u8272\u5217","IL"),
    }
    matched_country, matched_cc = None, None
    for cc, (name, code) in sorted(country_map.items(), key=lambda x:-len(x[0])):
        if digits.lstrip("+").startswith(cc):
            matched_country, matched_cc = name, f"+{cc}"
            break
    if not matched_country:
        matched_country, matched_cc = ("\u672a\u77e5\u56fd\u9645\u53f7\u7801", digits[:4]) if digits.startswith("+") else ("\u4e2d\u56fd\uff08\u9ed8\u8ba4\uff09","+86")

    loc = matched_country
    geo_lat, geo_lon = _geocode_location(loc)
    return {"valid":True,"possible":True,"original":phone,
            "formatted":f"{matched_cc} {digits.lstrip('+').removeprefix(matched_cc.lstrip('+'))}",
            "national_fmt":"","e164":"",
            "country_code":matched_cc,"national_number":"",
            "location_zh":loc,"location_en":"",
            "carrier_zh":"\u9700\u5b89\u88c5phonenumbers\u5e93","carrier_en":"",
            "region_code":"CN" if matched_country=="\u4e2d\u56fd\uff08\u9ed8\u8ba4\uff09" else "??",
            "number_type":"\u672a\u77e5","timezone":"\u672a\u77e5",
            "geo_lat":geo_lat,"geo_lon":geo_lon}


@app.route("/api/phone-lookup", methods=["POST"])
def phone_lookup():
    data = request.get_json(force=True)
    phone = (data.get("phone") or "").strip()
    if not phone:
        return jsonify({"error":"\u8bf7\u8f93\u5165\u624b\u673a\u53f7\u7801"}), 400
    return jsonify(_analyze_phone_number(phone))


# ===================== USERNAME SEARCH =====================
def _check_one_platform(plat, username):
    profile_url = plat["url"].format(username)
    status, final_url, body = _http_get(profile_url, timeout=5)
    exists = (status == 200)
    if status in (301, 302) and final_url:
        exists = username.lower() in final_url.lower()

    detail = None
    if exists and plat.get("api") == "github":
        gh = _http_get_json(f"https://api.github.com/users/{username}", timeout=4)
        if gh:
            detail = {
                "avatar": gh.get("avatar_url",""),
                "bio": gh.get("bio",""),
                "name": gh.get("name",""),
                "company": gh.get("company",""),
                "blog": gh.get("blog",""),
                "location": gh.get("location",""),
                "followers": gh.get("followers",0),
                "following": gh.get("following",0),
                "public_repos": gh.get("public_repos",0),
                "created_at": gh.get("created_at",""),
            }

    return {
        "platform":plat["name"],"url":profile_url,
        "icon":plat["icon"],"category":plat["category"],
        "exists":exists,"status_code":status or 0,
        "detail":detail,
    }


@app.route("/api/username-search", methods=["POST"])
def username_search():
    data = request.get_json(force=True)
    username = (data.get("username") or "").strip()
    if not username:
        return jsonify({"error":"\u8bf7\u8f93\u5165\u7528\u6237\u540d"}), 400
    if not re.match(r"^[a-zA-Z0-9_\-.]{2,30}$", username):
        return jsonify({"error":"\u7528\u6237\u540d\u683c\u5f0f\u65e0\u6548"}), 400

    results = []
    with ThreadPoolExecutor(max_workers=12) as pool:
        futures = {pool.submit(_check_one_platform, p, username): p for p in SOCIAL_PLATFORMS}
        try:
            for future in as_completed(futures, timeout=20):
                try:
                    results.append(future.result(timeout=5))
                except Exception:
                    p = futures[future]
                    results.append({"platform":p["name"],"url":p["url"].format(username),"icon":p["icon"],"category":p["category"],"exists":False,"status_code":0,"error":True,"detail":None})
        except FuturesTimeoutError:
            for future, p in futures.items():
                if not future.done():
                    future.cancel()
                    results.append({"platform":p["name"],"url":p["url"].format(username),"icon":p["icon"],"category":p["category"],"exists":False,"status_code":0,"error":True,"detail":None})

    results.sort(key=lambda r: (not r["exists"], r["platform"]))
    found = [r for r in results if r["exists"]]
    return jsonify({
        "username":username,
        "total_platforms":len(results),
        "found_count":len(found),
        "found":found,
        "not_found":[r for r in results if not r["exists"]],
        "all":results,
    })


# ===================== RESOURCE SNIFFER =====================
PLATFORM_PATTERNS = [
    {"name":"\u5fae\u4fe1\u89c6\u9891\u53f7","domain":"channels.weixin.qq.com","icon":"wechat","color":"#07c160"},
    {"name":"\u6296\u97f3","domain":"douyin.com","icon":"tiktok","color":"#000"},
    {"name":"\u5feb\u624b","domain":"kuaishou.com","icon":"kuaishou","color":"#ff4906"},
    {"name":"\u5c0f\u7ea2\u4e66","domain":"xiaohongshu.com","icon":"xiaohongshu","color":"#fe2c55"},
    {"name":"Bilibili","domain":"bilibili.com","icon":"bilibili","color":"#fb7299"},
    {"name":"YouTube","domain":"youtube.com","icon":"youtube","color":"#f00"},
    {"name":"\u9177\u72d7\u97f3\u4e50","domain":"kugou.com","icon":"kugou","color":"#2e8bff"},
    {"name":"QQ\u97f3\u4e50","domain":"y.qq.com","icon":"qqmusic","color":"#31c27c"},
    {"name":"\u7f51\u6613\u4e91\u97f3\u4e50","domain":"music.163.com","icon":"netease","color":"#ec4141"},
    {"name":"\u5fae\u535a","domain":"weibo.com","icon":"weibo","color":"#e6162d"},
    {"name":"\u77e5\u4e4e","domain":"zhihu.com","icon":"zhihu","color":"#0084ff"},
    {"name":"\u767e\u5ea6\u7f51\u76d8","domain":"pan.baidu.com","icon":"baidu","color":"#3388ff"},
]

def _detect_platform(url):
    """Guess which platform a URL belongs to."""
    url_lower = url.lower()
    for p in PLATFORM_PATTERNS:
        if p["domain"] in url_lower:
            return p
    return None

def _extract_media_links(html, base_url, page_url=""):
    """Extract image/video/audio URLs from HTML using regex + meta tags + JSON."""
    results = {"images":[], "videos":[], "audio":[], "m3u8":[], "other":[]}

    # --- Meta tags: og:video, og:image, twitter:image ---
    for m in re.finditer(r'<meta[^>]+(?:property|name)=["\'](?:og:video(?::(?:url|secure_url))?|video_url|twitter:image)["\'][^>]+content=["\']([^"\']+)["\']', html, re.I):
        u = _abs_url(m.group(1), base_url)
        results["videos"].append(u)
    for m in re.finditer(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\'](?:og:video(?::(?:url|secure_url))?|video_url)["\']', html, re.I):
        u = _abs_url(m.group(1), base_url)
        results["videos"].append(u)
    for m in re.finditer(r'<meta[^>]+(?:property|name)=["\'](?:og:image(?::(?:url|secure_url))?|twitter:image)["\'][^>]+content=["\']([^"\']+)["\']', html, re.I):
        results["images"].append(_abs_url(m.group(1), base_url))
    for m in re.finditer(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\'](?:og:image)["\']', html, re.I):
        results["images"].append(_abs_url(m.group(1), base_url))

    # --- JSON-LD structured data ---
    for m in re.finditer(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', html, re.I|re.S):
        try:
            ld = json.loads(m.group(1))
            _walk_json(ld, results, base_url)
        except Exception:
            pass

    # --- Embedded JSON in <script> tags ---
    # Look for JSON objects containing video/mp4 URLs (common in Douyin, Kuaishou etc)
    for m in re.finditer(r'<script[^>]*>(.*?)</script>', html, re.I|re.S):
        js = m.group(1)
        # JSON objects with video URLs
        for vm in re.finditer(r'["\']((?:https?:)?//[^"\'\s]*?\.(?:mp4|mov|webm|flv)[^"\'\s]*)["\']', js, re.I):
            results["videos"].append(_abs_url(vm.group(1), base_url))
        # key: "playAddr", "video_url", "downloadAddr", "play_url"
        for vm in re.finditer(r'["\'](?:playAddr|video_url|downloadAddr|play_url|srcNoMark|bitRateList)["\']\s*:\s*["\']([^"\']+)["\']', js, re.I):
            u = vm.group(1)
            if u.startswith("//"): u = "https:" + u
            if u.startswith("http"):
                results["videos"].append(u)

    # --- Standard HTML elements ---
    for m in re.finditer(r'<img[^>]+src=["\']([^"\']+)["\']', html, re.I):
        results["images"].append(_abs_url(m.group(1), base_url))
    for m in re.finditer(r'<(?:video|source)[^>]+src=["\']([^"\']+)["\']', html, re.I):
        u = _abs_url(m.group(1), base_url)
        if ".m3u8" in u.lower():
            results["m3u8"].append(u)
        else:
            results["videos"].append(u)
    for m in re.finditer(r'<audio[^>]+src=["\']([^"\']+)["\']', html, re.I):
        results["audio"].append(_abs_url(m.group(1), base_url))

    # --- Bare URLs in text/JS ---
    for m in re.finditer(r'["\'](https?://[^"\'\s]*?\.m3u8[^"\'\s]*)["\']', html, re.I):
        results["m3u8"].append(m.group(1))
    for m in re.finditer(r'["\'](https?://[^"\'\s]*?\.(?:mp4|mov|webm|flv|mkv)[^"\'\s]*)["\']', html, re.I):
        results["videos"].append(m.group(1))
    for m in re.finditer(r'["\'](https?://[^"\'\s]*?\.(?:jpg|jpeg|png|gif|webp|svg|bmp)[^"\'\s]*)["\']', html, re.I):
        results["images"].append(m.group(1))
    for m in re.finditer(r'["\'](https?://[^"\'\s]*?\.(?:mp3|wav|flac|ogg|aac|m4a)[^"\'\s]*)["\']', html, re.I):
        results["audio"].append(m.group(1))

    # --- Video ID extraction ---
    # Douyin video ID from URL: /video/1234567890
    vid_match = re.search(r'/(?:video|note|embed)/(\d{10,20})', page_url)
    if vid_match:
        results["other"].append({"type":"video_id","platform":"douyin","id":vid_match.group(1)})
    # Bilibili: /video/BVxxxx or /video/av12345
    bv_match = re.search(r'/(?:video|bangumi/play)/((?:BV|av|ep|ss)[\w]+)', page_url)
    if bv_match:
        results["other"].append({"type":"video_id","platform":"bilibili","id":bv_match.group(1)})
    # YouTube: /watch?v=xxx
    yt_match = re.search(r'[?&]v=([\w-]{11})', page_url)
    if yt_match:
        results["other"].append({"type":"video_id","platform":"youtube","id":yt_match.group(1)})

    # deduplicate
    for k in results:
        if k == "other":
            continue
        results[k] = list(dict.fromkeys(results[k]))[:30]

    return results

def _walk_json(obj, results, base_url):
    """Recursively walk JSON looking for media URLs."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, str):
                if any(v.lower().endswith(ext) for ext in ['.mp4','.mov','.webm','.flv','.mkv','.m3u8']):
                    results["videos" if '.m3u8' not in v else 'm3u8'].append(_abs_url(v, base_url))
                elif any(v.lower().endswith(ext) for ext in ['.jpg','.jpeg','.png','.gif','.webp']):
                    results["images"].append(_abs_url(v, base_url))
                elif any(v.lower().endswith(ext) for ext in ['.mp3','.wav','.flac','.aac','.m4a','.ogg']):
                    results["audio"].append(_abs_url(v, base_url))
            elif isinstance(v, (dict, list)):
                _walk_json(v, results, base_url)
    elif isinstance(obj, list):
        for item in obj:
            if isinstance(item, (dict, list)):
                _walk_json(item, results, base_url)

def _abs_url(url, base):
    if url.startswith("http://") or url.startswith("https://"):
        return url
    if url.startswith("//"):
        return "https:" + url
    if url.startswith("/"):
        return urllib.parse.urljoin(base, url)
    return urllib.parse.urljoin(base, url)

def _parse_m3u8(content, base_url):
    """Parse an M3U8 playlist into structured data."""
    lines = content.strip().split("\n")
    segments = []
    meta = {"target_duration":None,"total_duration":0,"is_master":False}

    for i, line in enumerate(lines):
        line = line.strip()
        if line.startswith("#EXT-X-TARGETDURATION:"):
            meta["target_duration"] = int(float(line.split(":")[1]))
        elif line.startswith("#EXTINF:"):
            dur_str = line.split(":")[1].split(",")[0]
            dur = float(dur_str)
            # next non-comment line is the segment URL
            seg_url = ""
            for j in range(i+1, len(lines)):
                nxt = lines[j].strip()
                if nxt and not nxt.startswith("#"):
                    seg_url = nxt
                    break
            if seg_url:
                segments.append({
                    "index":len(segments)+1,
                    "duration":round(dur,3),
                    "url":_abs_url(seg_url, base_url),
                })
                meta["total_duration"] = round(meta["total_duration"]+dur, 3)
        elif line.startswith("#EXT-X-STREAM-INF:"):
            meta["is_master"] = True
            # extract sub-playlist URLs from master playlist
            for j in range(i+1, len(lines)):
                nxt = lines[j].strip()
                if nxt and not nxt.startswith("#"):
                    segments.append({
                        "index":len(segments)+1,
                        "duration":0,
                        "url":_abs_url(nxt, base_url),
                        "is_sub_playlist":True,
                    })
                    break

    return meta, segments


@app.route("/api/resource/analyze", methods=["POST"])
def resource_analyze():
    data = request.get_json(force=True)
    raw_input = (data.get("url") or "").strip()
    if not raw_input:
        return jsonify({"error":"\u8bf7\u8f93\u5165 URL"}), 400

    # extract valid URLs from pasted text (e.g. Douyin share text)
    # use non-capturing groups so findall returns strings, not tuples
    urls = re.findall(r"https?://[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+[^\s\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]*", raw_input)
    if urls:
        # prefer the last URL (share texts usually put the real link last)
        url = urls[-1].rstrip(".,;:!?)")
    elif raw_input.startswith("http://") or raw_input.startswith("https://"):
        url = raw_input
    else:
        # check if it looks like a domain
        if re.match(r"^[\w.-]+\.[a-z]{2,}", raw_input, re.I):
            url = "https://" + raw_input
        else:
            url = "https://" + raw_input  # try anyway

    # normalise URL
    url = url.strip()
    if not url.startswith("http"):
        url = "https://" + url

    platform = _detect_platform(url)
    result = {
        "url": url,
        "original_input": raw_input[:200] if raw_input != url else None,
        "platform": platform,
        "page_title": "",
        "media": None,
        "raw_links": [],
    }

    # fetch the page
    try:
        status, final_url, html = _http_get(url, timeout=10)
        if final_url and final_url != url:
            result["final_url"] = final_url
            # re-detect platform on redirected URL
            if not platform:
                platform = _detect_platform(final_url)
                result["platform"] = platform
        if status == 200 and html:
            result["final_url"] = result.get("final_url") or url
            # extract title
            tm = re.search(r"<title[^>]*>(.*?)</title>", html, re.I|re.S)
            if tm: result["page_title"] = tm.group(1).strip()[:200]
            # extract media (pass final_url for video ID detection)
            result["media"] = _extract_media_links(html, result["final_url"], result["final_url"])
            # also extract all unique absolute links
            raw = re.findall(r'(?:src|href|data-url|data-src|poster)=["\'](https?://[^"\'\s]+)["\']', html, re.I)
            raw2 = re.findall(r'["\'](https?://[^"\'\s]{10,})["\']', html)
            all_raw = list(dict.fromkeys(raw + raw2))[:50]
            result["raw_links"] = all_raw

            # hint for JS-rendered platforms
            if platform and platform["name"] in ("\u6296\u97f3","\u5feb\u624b","\u5c0f\u7ea2\u4e66","\u5fae\u4fe1\u89c6\u9891\u53f7"):
                result["note"] = "\u8be5\u5e73\u53f0\u9875\u9762\u4e3a JS \u6e32\u67d3\uff0c\u89c6\u9891\u94fe\u63a5\u53ef\u80fd\u65e0\u6cd5\u76f4\u63a5\u83b7\u53d6\u3002\u8bf7\u4f7f\u7528 res-downloader \u684c\u9762\u7248\u8fdb\u884c MITM \u4ee3\u7406\u622a\u83b7\u3002"
        else:
            result["error"] = f"\u9875\u9762\u8fd4\u56de HTTP {status}" if status else "\u65e0\u6cd5\u8bbf\u95ee\u6b64 URL"
    except Exception as e:
        result["error"] = f"\u8bf7\u6c42\u5931\u8d25: {str(e)}"

    return jsonify(result)


@app.route("/api/resource/m3u8", methods=["POST"])
def resource_m3u8():
    data = request.get_json(force=True)
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"error":"\u8bf7\u8f93\u5165 M3U8 \u5730\u5740"}), 400
    if not url.startswith("http"):
        url = "https://" + url

    try:
        status, _, content = _http_get(url, timeout=10)
        if status != 200 or not content:
            return jsonify({"error":f"\u83b7\u53d6\u5931\u8d25 (HTTP {status or 'timeout'})"}), 400

        meta, segments = _parse_m3u8(content, url)
        html_media = _extract_media_links(content, url)

        return jsonify({
            "url":url,
            "is_master":meta["is_master"],
            "target_duration":meta["target_duration"],
            "total_duration":meta["total_duration"],
            "segment_count":len(segments),
            "segments":segments[:100],  # limit to 100 segments
            "total_segments":len(segments),
            "media_in_playlist":html_media,
        })
    except Exception as e:
        return jsonify({"error":f"\u89e3\u6790\u5931\u8d25: {str(e)}"}), 500


# ===================== VIDEO RESOLVER =====================
def _resolve_douyin(video_id):
    """Try to get direct video URL from Douyin API."""
    headers = {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
        "Referer": "https://www.douyin.com/",
    }
    # Try the item detail API
    api_url = f"https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id={video_id}"
    try:
        req = urllib.request.Request(api_url, headers=headers)
        resp = urllib.request.urlopen(req, timeout=10, context=_get_ssl_ctx())
        data = json.loads(resp.read().decode("utf-8"))
        aweme = data.get("aweme_detail", {})
        if not aweme:
            return None

        video = aweme.get("video", {})
        result = {
            "desc": aweme.get("desc", ""),
            "author": aweme.get("author", {}).get("nickname", ""),
            "duration": aweme.get("duration", 0),
            "urls": [],
        }

        # Get play addresses (with watermark)
        play_addr = video.get("play_addr", {})
        for ul in play_addr.get("url_list", []):
            result["urls"].append({"label":"\u6709\u6c34\u5370","url":ul})

        # Try to get no-watermark by replacing watermark=2 with watermark=
        # Or use play_addr_h264 / play_addr_lowbr
        for key in ["play_addr_h264", "play_addr_lowbr"]:
            alt = video.get(key, {})
            for ul in alt.get("url_list", []):
                result["urls"].append({"label":key,"url":ul})

        # Try constructing no-watermark URL from the first play_addr URL
        if result["urls"]:
            base_url = result["urls"][0]["url"]
            # Common trick: replace the watermark marker
            nowm = base_url.replace("watermark=1", "watermark=0").replace("watermark=2", "watermark=0")
            if nowm != base_url:
                result["urls"].insert(0, {"label":"\u65e0\u6c34\u5370(\u5c1d\u8bd5)","url":nowm})

        # Cover image
        cover = video.get("cover", {}).get("url_list", [])
        if cover:
            result["cover"] = cover[0]

        return result
    except Exception:
        return None


@app.route("/api/resource/resolve", methods=["POST"])
def resource_resolve():
    """Resolve a platform URL to direct downloadable media URLs."""
    data = request.get_json(force=True)
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"error":"\u8bf7\u8f93\u5165 URL"}), 400

    # Extract URL from share text
    urls = re.findall(r"https?://[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+[^\s\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]*", url)
    if urls:
        url = urls[-1].rstrip(".,;:!?)")
    if not url.startswith("http"):
        url = "https://" + url

    platform = _detect_platform(url)
    result = {"url":url, "platform":platform, "resolved":[], "note":""}

    # Follow redirect first
    try:
        status, final_url, _ = _http_get(url, timeout=8)
        if final_url:
            result["final_url"] = final_url
    except Exception:
        pass

    final_url = result.get("final_url", url)

    # Douyin resolver
    if platform and platform["name"] == "\u6296\u97f3":
        # Extract video ID from final URL
        vid_match = re.search(r'/(?:video|note)/(\d{10,20})', final_url)
        # Also try from share redirect
        if not vid_match:
            vid_match = re.search(r'/video/(\d{10,20})', url)
        if vid_match:
            video_id = vid_match.group(1)
            dy = _resolve_douyin(video_id)
            if dy:
                result["resolved"] = dy["urls"]
                result["desc"] = dy.get("desc","")
                result["author"] = dy.get("author","")
                result["duration"] = dy.get("duration",0)
                result["cover"] = dy.get("cover","")
                result["note"] = "\u70b9\u51fb\u94fe\u63a5\u53ef\u76f4\u63a5\u4e0b\u8f7d\uff0c\u6216\u590d\u5236\u94fe\u63a5\u7528\u4e0b\u8f7d\u5de5\u5177\u4e0b\u8f7d"
            else:
                result["note"] = "\u65e0\u6cd5\u89e3\u6790\u8be5\u89c6\u9891\uff0c\u53ef\u80fd\u9700\u8981 Cookie \u6216\u89c6\u9891\u5df2\u5220\u9664"
                vid_info = {"type":"video_id","platform":"douyin","id":video_id}
                result["resolved"].append(vid_info)
        else:
            result["note"] = "\u65e0\u6cd5\u63d0\u53d6\u89c6\u9891 ID\uff0c\u8bf7\u786e\u8ba4\u94fe\u63a5\u662f\u5426\u6b63\u786e"

    # For direct video URLs, just return them
    elif any(url.lower().endswith(ext) for ext in ['.mp4','.mov','.webm','.flv','.mkv']):
        result["resolved"].append({"label":"\u76f4\u94fe","url":url})
        result["note"] = "\u76f4\u63a5\u89c6\u9891\u94fe\u63a5\uff0c\u53ef\u76f4\u63a5\u4e0b\u8f7d"

    # For m3u8
    elif '.m3u8' in url.lower():
        result["resolved"].append({"label":"M3U8","url":url})
        result["note"] = "M3U8 \u64ad\u653e\u5217\u8868\uff0c\u53ef\u7528\u4e0b\u8f7d\u5de5\u5177\u4e0b\u8f7d\u6216\u5728 M3U8 \u89e3\u6790\u9762\u677f\u4e2d\u67e5\u770b\u5206\u7247"

    # Generic: try og:video meta
    else:
        try:
            _, _, html = _http_get(final_url, timeout=8)
            if html:
                for m in re.finditer(r'<meta[^>]+property=["\']og:video(?::(?:url|secure_url))?["\'][^>]+content=["\']([^"\']+)["\']', html, re.I):
                    result["resolved"].append({"label":"OG Video","url":_abs_url(m.group(1), final_url)})
                for m in re.finditer(r'<(?:video|source)[^>]+src=["\']([^"\']+)["\']', html, re.I):
                    result["resolved"].append({"label":"Video Tag","url":_abs_url(m.group(1), final_url)})
        except Exception:
            pass

        if not result["resolved"]:
            result["note"] = "\u672a\u627e\u5230\u53ef\u4e0b\u8f7d\u7684\u89c6\u9891\u94fe\u63a5\u3002\u8be5\u5e73\u53f0\u53ef\u80fd\u9700\u8981\u684c\u9762\u5de5\u5177\u8fdb\u884c MITM \u4ee3\u7406\u622a\u53d6\u3002"

    return jsonify(result)


@app.route("/api/resource/download", methods=["POST"])
def resource_download():
    """Stream a video URL as a downloadable file. Supports JSON and form POST."""
    url = None
    fname = None
    if request.is_json:
        data = request.get_json(force=True)
        url = (data.get("url") or "").strip()
        fname = data.get("filename")
    else:
        url = (request.form.get("url") or "").strip()
        fname = request.form.get("filename")
    safe_name = re.sub(r'[\\/*?:"<>|]', '_', fname)
    if not safe_name.endswith('.mp4'):
        if '.mp4' in url.lower():
            safe_name += '.mp4'
        elif '.mov' in url.lower():
            safe_name += '.mov'
        else:
            safe_name += '.mp4'

    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36",
            "Referer": url,
        })
        resp = urllib.request.urlopen(req, timeout=30, context=_get_ssl_ctx())
        content_type = resp.headers.get("Content-Type", "video/mp4")
        content_length = resp.headers.get("Content-Length")

        from flask import Response
        def generate():
            while True:
                chunk = resp.read(8192)
                if not chunk:
                    break
                yield chunk

        headers = {
            "Content-Disposition": f'attachment; filename*=UTF-8\'\'{urllib.parse.quote(safe_name)}',
            "Content-Type": content_type,
        }
        if content_length:
            headers["Content-Length"] = content_length

        return Response(generate(), headers=headers)
    except Exception as e:
        return jsonify({"error":f"\u4e0b\u8f7d\u5931\u8d25: {str(e)}"}), 500


# ===================== Routes =====================
@app.route("/")
def index():
    return render_template("index.html")


if __name__ == "__main__":
    print(" GhostTrack OSINT v2 \u2192 http://127.0.0.1:5000")
    app.run(host="127.0.0.1", port=5000, debug=False, threaded=True)
