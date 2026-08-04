/**
 * GhostTrack OSINT v2 — Frontend (robust edition)
 */
(function(){
'use strict';

// ========== TABS ==========
document.querySelectorAll('.tab').forEach(function(t){
    t.addEventListener('click',function(){
        var tab=t.dataset.tab;
        document.querySelectorAll('.tab').forEach(function(x){x.classList.remove('active');});
        t.classList.add('active');
        document.querySelectorAll('.panel').forEach(function(p){p.classList.remove('active');});
        document.getElementById('panel-'+tab).classList.add('active');
    });
});

// ========== HELPERS ==========
function $(id){return document.getElementById(id);}
function esc(s){
    if(s===null||s===undefined)return '—';
    var d=document.createElement('div');
    d.textContent=String(s);
    return d.innerHTML;
}
function spin(el){el.innerHTML='<div class="spinner">查询中...</div>';}
function err(el,m){el.innerHTML='<div class="error-msg">'+esc(m)+'</div>';}

async function api(url,body){
    var r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var d=await r.json();
    if(!r.ok)throw new Error(d.error||'请求失败');
    return d;
}

function flag(cc){
    if(!cc||cc.length<2||cc==='LO')return '\uD83C\uDF10';
    try{
        return String.fromCodePoint(cc.toUpperCase().charCodeAt(0)-65+0x1F1E6,cc.toUpperCase().charCodeAt(1)-65+0x1F1E6);
    }catch(e){return '\uD83C\uDF10';}
}

function fval(v,fmt){
    // format a value: return '—' if falsy/empty, else string
    if(v===null||v===undefined||v==='')return '—';
    if(fmt==='num'&&typeof v==='number')return v.toFixed(4);
    return String(v);
}

// ========== MAP HELPERS ==========
var activeMaps={};
function destroyMap(key){
    try{if(activeMaps[key]){activeMaps[key].remove();}}catch(e){}
    delete activeMaps[key];
}

function isLeafletReady(){
    return typeof L!=='undefined' && window._leafletReady;
}

function createMap(elId, lat, lon, zoom, popupHtml){
    destroyMap(elId);
    var el=document.getElementById(elId);
    if(!el)return;
    if(lat===null||lon===null||lat===undefined||lon===undefined){
        // No coordinates — show a placeholder message instead
        el.style.display='block';
        el.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text2);font-size:13px;">无可用坐标数据</div>';
        return;
    }
    el.style.display='block';

    if(!isLeafletReady()){
        // Leaflet not loaded — show a fallback static link
        var osmlink='https://www.openstreetmap.org/?mlat='+lat+'&mlon='+lon+'#map='+(zoom||10)+'/'+lat+'/'+lon;
        el.innerHTML=
        '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:8px;color:var(--text2);font-size:13px;padding:20px;">'+
            '<div>地图组件加载中或不可用</div>'+
            '<a href="'+osmlink+'" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:underline;font-size:12px;">在 OpenStreetMap 中查看 ('+lat.toFixed(2)+', '+lon.toFixed(2)+')</a>'+
            '<div id="'+elId+'-retry" style="display:none;"></div>'+
        '</div>';
        // Retry after 2s in case Leaflet loads async
        setTimeout(function(){
            if(isLeafletReady()){
                createMap(elId, lat, lon, zoom, popupHtml);
            }
        },2000);
        return;
    }

    try{
        var m=L.map(el,{zoomControl:true}).setView([lat,lon],zoom||10);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{
            attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; CartoDB',
            maxZoom:18
        }).addTo(m);
        var marker=L.marker([lat,lon]).addTo(m);
        if(popupHtml)marker.bindPopup(popupHtml).openPopup();
        activeMaps[elId]=m;
        // invalidate size after render
        setTimeout(function(){
            try{if(activeMaps[elId])activeMaps[elId].invalidateSize();}catch(e){}
        },300);
    }catch(e){
        console.warn('Map creation failed:',e);
        el.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text2);font-size:13px;">地图初始化失败</div>';
    }
}

// ========== IP LOOKUP ==========
$('ip-search-btn').addEventListener('click',doIp);
$('ip-input').addEventListener('keydown',function(e){if(e.key==='Enter')doIp();});

async function doIp(){
    var ip=$('ip-input').value.trim();if(!ip)return;
    var el=$('ip-result');destroyMap('ip-map');spin(el);
    try{
        var d=await api('/api/ip-lookup',{ip:ip});
        renderIp(el,d);
        // try to create map
        try{
            if(d.lat&&d.lon)setTimeout(function(){createMap('ip-map',d.lat,d.lon,10,'<b>'+esc(d.ip)+'</b><br>'+esc(d.city||'')+', '+esc(d.country||'')+'<br>'+esc(d.isp||''));},200);
        }catch(e){}
    }catch(e){err(el,e.message);}
}

function renderIp(el,d){
    try{
        var fg=flag(d.countryCode);
        var riskHtml='';
        if(d.risk_flags&&d.risk_flags.length>0){
            riskHtml='<div class="risk-section"><div class="risk-title">风险标志</div>';
            for(var i=0;i<d.risk_flags.length;i++){
                var rf=d.risk_flags[i];
                riskHtml+='<span class="tag '+esc(rf.type||'info')+'">'+esc(rf.label)+'</span>';
            }
            riskHtml+='</div>';
        }
        var tags='';
        if(d.is_private)tags+='<span class="tag private">私有/内网</span>';
        if(d.proxy)tags+='<span class="tag proxy">代理</span>';
        if(d.hosting)tags+='<span class="tag hosting">托管/IDC</span>';
        if(d.mobile)tags+='<span class="tag info">移动网络</span>';

        var html=
        '<div class="result-card">'+
            '<div class="section-header">'+
                '<span class="section-flag">'+esc(fg)+'</span>'+
                '<span class="section-badge">'+esc(d.ip||'—')+'</span>'+
                '<span class="section-sub">'+esc(d.country||'—')+'，'+esc(d.city||'—')+'</span>'+
                tags+
            '</div>'+
            '<div class="detail-grid">'+
                '<div class="detail-item"><div class="dl">国家/地区</div><div class="dv">'+esc(d.country)+' ('+esc(d.countryCode)+')</div></div>'+
                '<div class="detail-item"><div class="dl">省/州</div><div class="dv">'+esc(d.region)+'</div></div>'+
                '<div class="detail-item"><div class="dl">城市</div><div class="dv">'+esc(d.city)+'</div></div>'+
                '<div class="detail-item"><div class="dl">邮编</div><div class="dv">'+esc(d.zip)+'</div></div>'+
                '<div class="detail-item"><div class="dl">经纬度</div><div class="dv mono">'+esc(fval(d.lat,'num'))+', '+esc(fval(d.lon,'num'))+'</div></div>'+
                '<div class="detail-item"><div class="dl">时区</div><div class="dv">'+esc(d.timezone)+'</div></div>'+
                '<div class="detail-item"><div class="dl">ISP / 运营商</div><div class="dv">'+esc(d.isp)+'</div></div>'+
                '<div class="detail-item"><div class="dl">组织</div><div class="dv">'+esc(d.org)+'</div></div>'+
                '<div class="detail-item"><div class="dl">AS 信息</div><div class="dv mono">'+esc(d.as_info)+'</div></div>'+
                '<div class="detail-item"><div class="dl">反向 DNS</div><div class="dv mono">'+esc(d.rdns)+'</div></div>'+
            '</div>'+
            riskHtml+
            '<div id="ip-map" class="map-wrap" style="display:none"></div>'+
        '</div>';
        el.innerHTML=html;
    }catch(e){
        console.error('renderIp error:',e);
        err(el,'渲染结果时出错: '+e.message);
    }
}

// ========== PHONE LOOKUP ==========
$('phone-search-btn').addEventListener('click',doPhone);
$('phone-input').addEventListener('keydown',function(e){if(e.key==='Enter')doPhone();});

async function doPhone(){
    var phone=$('phone-input').value.trim();if(!phone)return;
    var el=$('phone-result');destroyMap('phone-map');spin(el);
    try{
        var d=await api('/api/phone-lookup',{phone:phone});
        renderPhone(el,d);
        try{
            if(d.geo_lat&&d.geo_lon)setTimeout(function(){createMap('phone-map',d.geo_lat,d.geo_lon,8,'<b>'+esc(d.location_zh||d.formatted)+'</b><br>'+esc(d.carrier_zh||''));},200);
        }catch(e){}
    }catch(e){err(el,e.message);}
}

function renderPhone(el,d){
    try{
        var vc=d.valid?'ok':'no';
        var vt=d.valid?'有效':(d.possible?'可能有效':'无效');
        var locHtml=(d.location_zh&&d.location_zh!=='未知')?d.location_zh:(d.location_en||'—');
        var carHtml=(d.carrier_zh&&d.carrier_zh!=='未知'&&d.carrier_zh.indexOf('phonenumbers')===-1)?d.carrier_zh:(d.carrier_en||'—');

        el.innerHTML=
        '<div class="result-card">'+
            '<div class="phone-header-bar">'+
                '<span class="phone-num">'+esc(d.formatted||d.original)+'</span>'+
                '<span class="phone-valid '+vc+'">'+vt+'</span>'+
            '</div>'+
            '<div class="detail-grid">'+
                '<div class="detail-item"><div class="dl">国际区号</div><div class="dv mono">'+esc(d.country_code)+'</div></div>'+
                '<div class="detail-item"><div class="dl">地区代码</div><div class="dv">'+esc(d.region_code)+'</div></div>'+
                '<div class="detail-item"><div class="dl">归属地</div><div class="dv">'+esc(locHtml)+'</div></div>'+
                '<div class="detail-item"><div class="dl">运营商</div><div class="dv">'+esc(carHtml)+'</div></div>'+
                '<div class="detail-item"><div class="dl">号码类型</div><div class="dv">'+esc(d.number_type)+'</div></div>'+
                '<div class="detail-item"><div class="dl">时区</div><div class="dv">'+esc(d.timezone)+'</div></div>'+
                '<div class="detail-item"><div class="dl">国内格式</div><div class="dv mono">'+esc(d.national_fmt)+'</div></div>'+
                '<div class="detail-item"><div class="dl">E.164 格式</div><div class="dv mono">'+esc(d.e164)+'</div></div>'+
                '<div class="detail-item"><div class="dl">国内号码</div><div class="dv mono">'+esc(d.national_number)+'</div></div>'+
                '<div class="detail-item"><div class="dl">原始输入</div><div class="dv mono">'+esc(d.original)+'</div></div>'+
            '</div>'+
            '<div id="phone-map" class="map-wrap" style="display:none"></div>'+
        '</div>';
    }catch(e){
        console.error('renderPhone error:',e);
        err(el,'渲染结果时出错: '+e.message);
    }
}

// ========== USERNAME SEARCH ==========
$('username-search-btn').addEventListener('click',doUser);
$('username-input').addEventListener('keydown',function(e){if(e.key==='Enter')doUser();});

async function doUser(){
    var u=$('username-input').value.trim();if(!u)return;
    var el=$('username-result');spin(el);
    try{
        var d=await api('/api/username-search',{username:u});
        renderUser(el,d);
    }catch(e){err(el,e.message);}
}

function renderUser(el,d){
    try{
        var sorted=[].concat(d.all);
        sorted.sort(function(a,b){
            if(a.exists!==b.exists)return a.exists?-1:1;
            if(!!a.error!==!!b.error)return a.error?1:-1;
            return(b.status_code||0)-(a.status_code||0);
        });

        // group by category
        var cats={};
        sorted.forEach(function(item){
            var c=item.category||'其他';
            if(!cats[c])cats[c]=[];
            cats[c].push(item);
        });

        // GitHub detail card
        var ghDetail='';
        var ghFound=null;
        for(var i=0;i<sorted.length;i++){
            if(sorted[i].exists&&sorted[i].platform==='GitHub'&&sorted[i].detail){
                ghFound=sorted[i].detail;break;
            }
        }
        if(ghFound){
            var g=ghFound;
            ghDetail=
            '<div class="gh-detail">'+
                '<div class="gh-header">'+
                    (g.avatar?'<img class="gh-avatar" src="'+esc(g.avatar)+'" alt="" onerror="this.style.display=\'none\'">':'')+
                    '<div class="gh-info">'+
                        '<div class="gh-name">'+esc(g.name||d.username)+'</div>'+
                        '<div class="gh-login">@'+esc(d.username)+'</div>'+
                        (g.bio?'<div class="gh-bio">'+esc(g.bio)+'</div>':'')+
                    '</div>'+
                '</div>'+
                '<div class="gh-stats">'+
                    '<div class="gh-stat"><div class="gh-num">'+fval(g.public_repos,0)+'</div><div class="gh-lbl">Repos</div></div>'+
                    '<div class="gh-stat"><div class="gh-num">'+fval(g.followers,0)+'</div><div class="gh-lbl">Followers</div></div>'+
                    '<div class="gh-stat"><div class="gh-num">'+fval(g.following,0)+'</div><div class="gh-lbl">Following</div></div>'+
                '</div>'+
                (g.company||g.location||g.blog?
                '<div class="gh-meta">'+
                    (g.company?'<span>'+esc(g.company)+'</span>':'')+
                    (g.location?'<span>'+esc(g.location)+'</span>':'')+
                    (g.blog?'<span><a href="'+esc(g.blog)+'" target="_blank" rel="noopener" style="color:var(--accent)">'+esc(g.blog)+'</a></span>':'')+
                '</div>':'')+
            '</div>';
        }

        // platform list
        var platHtml='';
        var catKeys=Object.keys(cats);
        for(var ci=0;ci<catKeys.length;ci++){
            var cat=catKeys[ci];
            var items=cats[cat];
            platHtml+='<div class="cat-section"><div class="cat-title">'+esc(cat)+'</div><div class="platform-grid">';
            for(var j=0;j<items.length;j++){
                var item=items[j];
                var cls=item.exists?'found':(item.error?'error':'not-found');
                var dot=item.exists?'hit':(item.error?'err':'miss');
                var meta=item.error?'连接超时':('HTTP '+item.status_code);
                var tgt=item.exists?' target="_blank" rel="noopener"':'';
                platHtml+='<a href="'+esc(item.url)+'" class="plat-item '+cls+'"'+tgt+'>'+
                    '<div class="picon">'+pIcon(item.icon)+'</div>'+
                    '<div class="pinfo"><div class="pname">'+esc(item.platform)+'</div><div class="pmeta">'+meta+'</div></div>'+
                    '<div class="pdot '+dot+'"></div>'+
                '</a>';
            }
            platHtml+='</div></div>';
        }

        var errCount=0;
        sorted.forEach(function(i){if(i.error)errCount++;});

        el.innerHTML=
        '<div class="user-summary">'+
            '<div class="stat-card"><div class="num green">'+fval(d.found_count,0)+'</div><div class="lbl">找到</div></div>'+
            '<div class="stat-card"><div class="num">'+fval(d.total_platforms,0)+'</div><div class="lbl">已扫描平台</div></div>'+
        '</div>'+
        (errCount>0?'<div class="hint-msg">'+errCount+'个平台连接超时，不影响已命中结果</div>':'')+
        ghDetail+
        platHtml;
    }catch(e){
        console.error('renderUser error:',e);
        err(el,'渲染结果时出错: '+e.message);
    }
}

// ========== PLATFORM ICONS ==========
function pIcon(icon){
    var m={
        github:'<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.387.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.73.083-.73 1.205.085 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.418-1.305.762-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12 24 5.37 18.63 0 12 0z"/></svg>',
        twitter:'<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
        instagram:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/></svg>',
        reddit:'<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="11" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="9" cy="11" r="1.5"/><circle cx="15" cy="11" r="1.5"/></svg>',
        youtube:'<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 00-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.5A3 3 0 00.5 6.2C0 8 0 12 0 12s0 4 .5 5.8a3 3 0 002.1 2.2c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 002.1-2.2c.5-1.8.5-5.8.5-5.8s0-4-.5-5.8z"/></svg>',
        telegram:'<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.12.02-1.96 1.25-5.54 3.66-.52.36-1 .53-1.42.52-.47-.01-1.37-.26-2.03-.48-.82-.27-1.47-.42-1.41-.88.03-.24.36-.48.99-.74 3.91-1.7 6.52-2.83 7.82-3.37 3.72-1.55 4.49-1.82 5-1.83.11 0 .36.03.52.17.14.12.18.28.2.45-.01.06.01.22 0 0z"/></svg>',
        steam:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="11"/><path d="M6 13.5l2.5 1 1-3.5 6.5 4.5c1 .5 2 0 2.5-1s0-2-1-2.5l-4.5-3M8.5 14.5L6 18l3.5 1 1.5-3"/></svg>',
        tiktok:'<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12.5 0c1.3 0 2.6 0 3.9 0 .1 1.5.6 3.1 1.8 4.2 1.1 1.1 2.7 1.6 4.2 1.8v4c-1.4 0-2.9-.4-4.2-1-.6-.2-1.1-.6-1.6-.9 0 2.9 0 5.8 0 8.8-.1 1.4-.5 2.8-1.4 3.9-1.3 1.9-3.6 3.2-5.9 3.2-1.4.1-2.9-.3-4.1-1-2-1.2-3.4-3.4-3.6-5.7 0-.5 0-1 0-1.5.2-1.9 1.1-3.7 2.6-5 1.7-1.4 4-2.1 6.1-1.7 0 1.5 0 3 0 4.4-1-.3-2.1-.2-3 .4-.6.4-1.1 1-1.4 1.8-.2.5-.1 1.1-.1 1.6.2 1.6 1.8 3 3.5 2.9 1.1 0 2.2-.7 2.8-1.6.2-.3.4-.7.4-1.1.1-1.8.1-3.6.1-5.4 0-4 0-8 .1-12z"/></svg>',
        pinterest:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="11"/><path d="M8 12c0-2.5 1.5-5 4-5s5 2 5 5-2 4.5-4 4.5c-.5 0-1-.2-1.5-.5l.5-2 .2-1c.5.5 1 .5 1.5.5 1.5 0 2.5-1 2.5-2.5s-1-3-2.5-3-3 1.5-3 3.5c0 1 .5 2 1 2.5l-.5 2c-.5 1.5-.5 3-.5 3.5.5.5 2 .5 3 .5 4 0 7-3 7-7"/></svg>',
        medium:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="11"/><line x1="8" y1="9" x2="8" y2="15"/><line x1="12" y1="9" x2="12" y2="15"/><line x1="16" y1="10" x2="16" y2="15"/></svg>',
        devto:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="3"/><text x="12" y="17" text-anchor="middle" font-size="14" font-weight="bold" fill="currentColor" stroke="none">D</text></svg>',
        twitch:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 2v16l5 5h4l5-5h3V2H3zm14 12h-2l-3 3v-3H7V4h10v10z"/><rect x="10" y="5" width="1.5" height="6" fill="currentColor" stroke="none"/><rect x="14" y="5" width="1.5" height="6" fill="currentColor" stroke="none"/></svg>',
        spotify:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="11"/><path d="M7 9c3-2 7-2 10 0M7.5 12c2.5-1.5 6.5-1.5 9 0M8 15c2-1 5-1 7 0" stroke-linecap="round"/></svg>',
        patreon:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10" cy="12" r="7"/><rect x="17" y="4" width="3" height="16" rx="1"/></svg>',
        keybase:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="11"/><text x="12" y="17" text-anchor="middle" font-size="15" font-weight="bold" fill="currentColor" stroke="none">K</text></svg>',
        vimeo:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 6.5c-.3 5.5-4 13-11.3 17.7-1.3.9-2.4-.3-2.8-1.3-.5-1.8-1-3.6-1.6-5.4-.6-2-3-2-3-4 0-1.5 2-2.5 3-4 .8-1.2 2.5-3 4.5-3 1.7 0 2.6 1.2 2.6 2.5 0 1.8-1.2 4-1.8 5.7-.5 1.2.5 2.2 1.7 1.5 2.3-1.3 4.2-3.5 5-5.7.5-1.3-.2-2-1.5-2-1.7 0-3.5.7-4.5 1.5"/></svg>',
        dribbble:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="11"/><path d="M3 12c5 3 10 3 14 0M3 8c7 3 14 3 18 0M3 16c6-3 12-3 18 0"/></svg>',
        behance:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="12" rx="1"/><text x="12" y="16" text-anchor="middle" font-size="10" font-weight="bold" fill="currentColor" stroke="none">Be</text></svg>',
        soundcloud:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M2 15v-2c0-.5.5-1 1-1s1 .5 1 1v2c0 .5-.5 1-1 1s-1-.5-1-1zm4-3v3c0 .5.5 1 1 1s1-.5 1-1v-3c0-.5-.5-1-1-1s-1 .5-1 1zm4-2v5c0 .5.5 1 1 1s1-.5 1-1v-5c0-.5-.5-1-1-1s-1 .5-1 1zm4-2v7c0 .5.5 1 1 1s1-.5 1-1V8c0-.5-.5-1-1-1s-1 .5-1 1zm4-1v8c0 .5.3 1 .8 1h.2c2.5 0 4.5-2 4.5-4.5S21.5 7 19 7h-.2c-.5 0-.8.4-.8 1z"/></svg>',
        flickr:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="7" cy="12" r="5"/><circle cx="17" cy="12" r="5"/></svg>',
    };
    return m[icon]||'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/></svg>';
}

// ========== RESOURCE SNIFFER ==========
// Nested tabs inside resource panel
document.querySelectorAll('.res-tab').forEach(function(t){
    t.addEventListener('click',function(){
        var target=t.dataset.restab;
        document.querySelectorAll('.res-tab').forEach(function(x){x.classList.remove('active');});
        t.classList.add('active');
        document.querySelectorAll('.res-panel').forEach(function(p){p.classList.remove('active');});
        document.getElementById('res-'+target).classList.add('active');
    });
});

// Copy to clipboard helper
function copyText(txt,btn){
    if(navigator.clipboard){
        navigator.clipboard.writeText(txt).then(function(){
            btn.textContent='已复制';setTimeout(function(){btn.textContent='复制';},1500);
        }).catch(function(){});
    }else{
        var ta=document.createElement('textarea');ta.value=txt;ta.style.position='fixed';ta.style.opacity='0';
        document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);
        btn.textContent='已复制';setTimeout(function(){btn.textContent='复制';},1500);
    }
}
window.copyText=copyText;

// ---- Page Sniffer ----
$('sniff-btn').addEventListener('click',doSniff);
$('sniff-url').addEventListener('keydown',function(e){if(e.key==='Enter')doSniff();});
// Auto-extract URL from pasted share text — extracts last valid URL
$('sniff-url').addEventListener('paste',function(){
    var self=this;
    setTimeout(function(){
        var v=self.value;
        var urls=v.match(/https?:\/\/[a-zA-Z0-9][-a-zA-Z0-9]*(\.[a-zA-Z0-9][-a-zA-Z0-9]*)+[^\s一-鿿]+/g);
        if(urls&&urls.length){
            var best=urls[urls.length-1].replace(/[.,;:!?)]+$/,'');
            if(best!==v){self.value=best;}
        }
    },50);
});

async function doSniff(){
    var url=$('sniff-url').value.trim();if(!url)return;
    var el=$('sniff-result');spin(el);
    try{
        var d=await api('/api/resource/analyze',{url:url});
        renderSniff(el,d);
    }catch(e){err(el,e.message);}
}

function renderSniff(el,d){
    try{
        var html='<div class="result-card">';

        // Show extracted URL hint if paste was share text
        if(d.original_input){
            html+='<div style="padding:10px 20px;background:rgba(88,166,255,.06);border-bottom:1px solid var(--border);font-size:12px;color:var(--text2);">'+
                '\uD83D\uDD0D \u5df2\u81ea\u52a8\u63d0\u53d6\u94fe\u63a5\uff1a<code style="color:var(--accent);">'+esc(d.url)+'</code>'+
            '</div>';
        }

        // Platform badge
        if(d.platform){
            html+='<div class="platform-info">'+
                '<span class="platform-badge" style="background:'+esc(d.platform.color||'#30363d')+'22;color:'+esc(d.platform.color||'#e6edf3')+'">'+
                    rIcon(d.platform.icon)+' '+esc(d.platform.name)+
                '</span>'+
                '<span style="font-size:13px;color:var(--text2);">来源：'+esc(d.final_url||d.url)+'</span>'+
            '</div>';
        }
        if(d.page_title){
            html+='<div class="section-header"><span style="font-size:14px;color:var(--text);">'+esc(d.page_title)+'</span></div>';
        }

        // Error
        if(d.error){
            html+='<div style="padding:14px 20px;"><div class="error-msg">'+esc(d.error)+'</div></div>';
            if(!d.media&&!d.raw_links.length){html+='</div>';el.innerHTML=html;return;}
        }

        // Note for JS-rendered platforms
        if(d.note){
            html+='<div style="padding:10px 20px;background:rgba(210,153,29,.06);border-bottom:1px solid var(--border);font-size:12px;color:var(--yellow);">\u26A0\uFE0F '+esc(d.note)+'</div>';
        }

        // Media groups
        if(d.media){
            var groups=[
                {key:'videos',label:'视频',icon:'\uD83C\uDFA5'},
                {key:'m3u8',label:'M3U8 播放列表',icon:'\uD83C\uDFAC'},
                {key:'images',label:'图片',icon:'\uD83D\uDDBC\uFE0F'},
                {key:'audio',label:'音频',icon:'\uD83C\uDFB5'},
                {key:'other',label:'其他信息',icon:'\u2139\uFE0F'},
            ];
            for(var gi=0;gi<groups.length;gi++){
                var g=groups[gi];
                var items=d.media[g.key];
                if(!items||!items.length)continue;
                html+='<div class="media-group" style="padding:14px 20px;">'+
                    '<div class="media-group-title">'+g.icon+' '+g.label+' <span class="count">('+items.length+')</span></div>'+
                    '<div class="media-list">';
                for(var i=0;i<items.length;i++){
                    var u=items[i];
                    if(typeof u==='object'){
                        // Video ID object
                        html+='<div class="media-link">'+
                            '<div class="micon">\uD83C\uDFAC</div>'+
                            '<div class="pinfo"><div class="pname">'+esc(u.platform||'')+' Video ID</div><div class="pmeta mono">'+esc(u.id)+'</div></div>'+
                            '<button class="mcopy" onclick="copyText(\''+esc(u.id)+'\',this)">复制 ID</button>'+
                        '</div>';
                    }else{
                        html+='<div class="media-link">'+
                            '<div class="micon">'+g.icon+'</div>'+
                            '<div class="murl" title="'+esc(u)+'">'+esc(u)+'</div>'+
                            '<button class="mcopy" onclick="var t=this.previousElementSibling;copyText(t.title||t.textContent,this)">复制</button>'+
                            '<a href="'+esc(u)+'" target="_blank" rel="noopener" class="mcopy" style="text-decoration:none;margin-left:2px;">打开</a>'+
                        '</div>';
                    }
                }
                html+='</div></div>';
            }
        }

        // Raw links
        if(d.raw_links&&d.raw_links.length){
            html+='<div style="padding:14px 20px;border-top:1px solid var(--border);">'+
                '<div class="media-group-title">\uD83D\uDD17 页面所有链接 <span class="count">('+d.raw_links.length+')</span></div>'+
                '<div class="link-list">';
            for(var ri=0;ri<d.raw_links.length;ri++){
                var lu=d.raw_links[ri];
                html+='<div class="link-row">'+
                    '<span class="lidx">'+(ri+1)+'</span>'+
                    '<span class="lurl" title="'+esc(lu)+'">'+esc(lu)+'</span>'+
                    '<button class="lcpy" onclick="copyText(this.previousElementSibling.previousElementSibling.title,this)">复制</button>'+
                '</div>';
            }
            html+='</div></div>';
        }

        html+='</div>';
        el.innerHTML=html;
    }catch(e){
        console.error('renderSniff error:',e);
        err(el,'渲染结果时出错: '+e.message);
    }
}

// ---- M3U8 Parser ----
$('m3u8-btn').addEventListener('click',doM3u8);
$('m3u8-url').addEventListener('keydown',function(e){if(e.key==='Enter')doM3u8();});

async function doM3u8(){
    var url=$('m3u8-url').value.trim();if(!url)return;
    var el=$('m3u8-result');spin(el);
    try{
        var d=await api('/api/resource/m3u8',{url:url});
        renderM3u8(el,d);
    }catch(e){err(el,e.message);}
}

function renderM3u8(el,d){
    try{
        var html='<div class="result-card">'+
            '<div class="m3u8-info">'+
                '<div class="m3u8-stat"><div class="m3u8-val">'+(d.is_master?'Master':'VOD')+'</div><div class="m3u8-lbl">类型</div></div>'+
                '<div class="m3u8-stat"><div class="m3u8-val">'+fval(d.total_segments,0)+'</div><div class="m3u8-lbl">分片数</div></div>'+
                '<div class="m3u8-stat"><div class="m3u8-val">'+(d.total_duration?d.total_duration.toFixed(1)+'s':'—')+'</div><div class="m3u8-lbl">总时长</div></div>'+
                '<div class="m3u8-stat"><div class="m3u8-val">'+(d.target_duration?d.target_duration+'s':'—')+'</div><div class="m3u8-lbl">目标时长</div></div>'+
            '</div>';

        if(d.segments&&d.segments.length){
            // Check if master playlist
            if(d.is_master){
                html+='<div style="padding:14px 20px;">'+
                    '<div class="media-group-title">\uD83D\uDCCB 子播放列表 ('+d.segment_count+')</div>'+
                    '<div class="media-list">';
                for(var i=0;i<d.segments.length;i++){
                    var s=d.segments[i];
                    html+='<div class="media-link">'+
                        '<div class="micon">\uD83D\uDCCB</div>'+
                        '<div class="murl" title="'+esc(s.url)+'">'+esc(s.url)+'</div>'+
                        '<button class="mcopy" onclick="var t=this.previousElementSibling;copyText(t.title||t.textContent,this)">复制</button>'+
                    '</div>';
                }
                html+='</div></div>';
            }else{
                html+='<div style="overflow-x:auto;">'+
                    '<table class="seg-table">'+
                        '<thead><tr><th>#</th><th>时长</th><th>URL</th><th></th></tr></thead><tbody>';
                for(var j=0;j<d.segments.length;j++){
                    var seg=d.segments[j];
                    html+='<tr>'+
                        '<td class="seg-idx">'+seg.index+'</td>'+
                        '<td class="seg-dur">'+seg.duration.toFixed(1)+'s</td>'+
                        '<td class="mono" title="'+esc(seg.url)+'">'+esc(seg.url)+'</td>'+
                        '<td><button class="mcopy" onclick="copyText(this.parentElement.previousElementSibling.title,this)">复制</button></td>'+
                    '</tr>';
                }
                html+='</tbody></table></div>';
            }
        }

        if(d.media_in_playlist){
            var mg=d.media_in_playlist;
            var m3u8Keys=['images','videos','audio','other'];
            for(var ki=0;ki<m3u8Keys.length;ki++){
                var k=m3u8Keys[ki];
                if(mg[k]&&mg[k].length){
                    html+='<div class="media-group" style="padding:14px 20px;border-top:1px solid var(--border);">'+
                        '<div class="media-group-title">'+k+' <span class="count">('+mg[k].length+')</span></div>'+
                        '<div class="media-list">';
                    for(var mi=0;mi<Math.min(mg[k].length,10);mi++){
                        var mu=mg[k][mi];
                        html+='<div class="media-link">'+
                            '<div class="murl" title="'+esc(mu)+'">'+esc(mu)+'</div>'+
                            '<button class="mcopy" onclick="var t=this.previousElementSibling;copyText(t.title||t.textContent,this)">复制</button>'+
                        '</div>';
                    }
                    html+='</div></div>';
                }
            }
        }

        html+='</div>';
        el.innerHTML=html;
    }catch(e){
        console.error('renderM3u8 error:',e);
        err(el,'渲染结果时出错: '+e.message);
    }
}

// Resource platform icons
function rIcon(icon){
    var m={
        wechat:'<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8.5 11a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm5 0a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM12 2C6.48 2 2 6.48 2 12c0 2.64 1.06 5.04 2.78 6.78L4 22l3.45-1.15A9.93 9.93 0 0012 22c5.52 0 10-4.48 10-10S17.52 2 12 2z"/></svg>',
        tiktok:'<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12.5 0c1.3 0 2.6 0 3.9 0v8.8c1.1.1 2.7.6 4.2 1.8 1.1 1.1 1.7 2.8 1.8 4.2v4c-1.4 0-2.9-.4-2.9-.4l-1.3-.6c0 2.9 0 6-.1 8.8-.1 1.4-.5 2.8-1.4 3.9-1.3 1.9-3.6 3.2-5.9 3.2-1.4.1-2.9-.3-4.1-1-2-1.2-3.4-3.4-3.6-5.7v-1.5c.2-1.9 1.1-3.7 2.6-5 1.7-1.4 3.9-2.1 6.1-1.7v4.5c-1-.3-2.1-.2-3 .4-.6.4-1.1 1-1.4 1.8-.1.5 0 1.1 0 1.6.2 1.6 1.8 3 3.5 2.9 1.1 0 2.2-.7 2.8-1.6l.4-1c.1-1.9 0-3.7 0-5.4C12.4 8 12.5 4 12.5 0z"/></svg>',
        kuaishou:'<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1"><rect x="2" y="2" width="20" height="20" rx="4" fill="none"/><text x="12" y="16" text-anchor="middle" font-size="10" font-weight="bold">快</text></svg>',
        xiaohongshu:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="4"/><text x="12" y="16" text-anchor="middle" font-size="10" font-weight="bold" fill="currentColor" stroke="none">红</text></svg>',
        bilibili:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="M7 4V2m5 2V2m5 2V2"/></svg>',
        youtube:'<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 00-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.5A3 3 0 00.5 6.2C0 8 0 12 0 12s0 4 .5 5.8a3 3 0 002.1 2.2c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 002.1-2.2c.5-1.8.5-5.8.5-5.8s0-4-.5-5.8z"/></svg>',
        kugou:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9 8v8m3-6v6m3-4v4"/></svg>',
        qqmusic:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><text x="12" y="17" text-anchor="middle" font-size="11" font-weight="bold" fill="currentColor" stroke="none">Q</text></svg>',
        netease:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 12c1-2 3-3 5-3s3 1 4 3"/></svg>',
        weibo:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="9" cy="10" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1.5" fill="currentColor" stroke="none"/></svg>',
        zhihu:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><text x="12" y="17" text-anchor="middle" font-size="12" font-weight="bold" fill="currentColor" stroke="none">知</text></svg>',
        baidu:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><text x="12" y="17" text-anchor="middle" font-size="10" font-weight="bold" fill="currentColor" stroke="none">Ba</text></svg>',
    };
    return m[icon]||'';
}

// ========== VIDEO RESOLVER / DOWNLOAD ==========
$('resolve-btn').addEventListener('click',doResolve);
$('resolve-url').addEventListener('keydown',function(e){if(e.key==='Enter')doResolve();});
// Auto-extract URL from pasted share text
$('resolve-url').addEventListener('paste',function(){
    var self=this;
    setTimeout(function(){
        var v=self.value;
        var urls=v.match(/https?:\/\/[a-zA-Z0-9][-a-zA-Z0-9]*(\.[a-zA-Z0-9][-a-zA-Z0-9]*)+[^\s\u4e00-\u9fff]+/g);
        if(urls&&urls.length){
            var best=urls[urls.length-1].replace(/[.,;:!?)]+$/,'');
            if(best!==v){self.value=best;}
        }
    },50);
});

async function doResolve(){
    var url=$('resolve-url').value.trim();if(!url)return;
    var el=$('resolve-result');spin(el);
    try{
        var d=await api('/api/resource/resolve',{url:url});
        renderResolve(el,d);
    }catch(e){err(el,e.message);}
}

function renderResolve(el,d){
    try{
        var html='<div class="result-card">';

        // Platform
        if(d.platform){
            html+='<div class="platform-info">'+
                '<span class="platform-badge" style="background:'+esc(d.platform.color||'#30363d')+'22;color:'+esc(d.platform.color||'#e6edf3')+'">'+
                    rIcon(d.platform.icon)+' '+esc(d.platform.name)+
                '</span>'+
                '<span style="font-size:13px;color:var(--text2);">'+esc(d.final_url||d.url)+'</span>'+
            '</div>';
        }

        // Title/desc
        if(d.desc){
            html+='<div class="section-header"><span style="font-size:14px;">'+esc(d.desc)+'</span></div>';
        }
        if(d.author){
            html+='<div style="padding:0 20px 8px;color:var(--text2);font-size:13px;">@'+esc(d.author)+(d.duration?' \u00B7 '+d.duration+'\u79d2':'')+'</div>';
        }

        // Cover
        if(d.cover){
            html+='<div style="padding:8px 20px 14px;">'+
                '<img src="'+esc(d.cover)+'" style="max-width:200px;max-height:150px;border-radius:8px;border:1px solid var(--border);" alt="" onerror="this.style.display=\'none\'">'+
            '</div>';
        }

        // Note
        if(d.note){
            html+='<div style="padding:10px 20px;background:rgba(63,185,80,.06);border-bottom:1px solid var(--border);font-size:13px;color:var(--green);">'+esc(d.note)+'</div>';
        }

        // Error
        if(d.error){
            html+='<div style="padding:14px 20px;"><div class="error-msg">'+esc(d.error)+'</div></div>';
        }

        // Download URLs
        if(d.resolved&&d.resolved.length){
            html+='<div style="padding:14px 20px;">'+
                '<div class="media-group-title">\uD83D\uDCE5 \u4E0B\u8F7D\u94FE\u63A5 <span class="count">('+d.resolved.length+')</span></div>'+
                '<div class="media-list">';

            for(var i=0;i<d.resolved.length;i++){
                var item=d.resolved[i];
                if(item.url){
                    // Regular URL item
                    var dlurl='/api/resource/download';
                    html+=
                    '<div class="media-link">'+
                        '<div class="micon">\uD83D\uDCE5</div>'+
                        '<div class="pinfo">'+
                            '<div class="pname">'+esc(item.label||'视频')+'</div>'+
                            '<div class="pmeta mono" title="'+esc(item.url)+'">'+esc(item.url.substring(0,80))+'...</div>'+
                        '</div>'+
                        '<button class="mcopy" style="background:var(--green);color:#fff;border-color:var(--green);" onclick="downloadVideo(\''+esc(item.url)+'\',\''+esc(item.label||'video')+'\')">\uD83D\uDCBE \u4E0B\u8F7D</button>'+
                        '<button class="mcopy" style="margin-left:4px;" onclick="copyText(\''+esc(item.url)+'\',this)">\u590D\u5236\u94FE\u63A5</button>'+
                    '</div>';
                }else if(item.id){
                    // Video ID item
                    html+=
                    '<div class="media-link">'+
                        '<div class="micon">\uD83C\uDFAC</div>'+
                        '<div class="pinfo">'+
                            '<div class="pname">'+esc(item.platform||'')+' Video ID</div>'+
                            '<div class="pmeta mono">'+esc(item.id)+'</div>'+
                        '</div>'+
                        '<button class="mcopy" onclick="copyText(\''+esc(item.id)+'\',this)">\u590D\u5236 ID</button>'+
                    '</div>';
                }
            }
            html+='</div></div>';
        }

        // No results
        if((!d.resolved||!d.resolved.length) && !d.error){
            html+='<div class="res-placeholder">'+
                '<p>\u672A\u627E\u5230\u53EF\u4E0B\u8F7D\u7684\u89C6\u9891\u94FE\u63A5</p>'+
                '<p style="font-size:12px;">\u8BF7\u5C1D\u8BD5\u4F7F\u7528\u201C\u9875\u9762\u55C5\u63A2\u201D\u67E5\u770B\u66F4\u591A\u4FE1\u606F</p>'+
            '</div>';
        }

        html+='</div>';
        el.innerHTML=html;
    }catch(e){
        console.error('renderResolve error:',e);
        err(el,'渲染时出错: '+e.message);
    }
}

// Download helper
function downloadVideo(url, label){
    var ext='.mp4';
    if(url.indexOf('.mov')>0)ext='.mov';
    if(url.indexOf('.webm')>0)ext='.webm';
    if(url.indexOf('.flv')>0)ext='.flv';
    var fname=(label||'video').replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g,'_').substring(0,30)+ext;

    // On Netlify (no Flask), direct link is more reliable than function proxy
    if(window.__NETLIFY__||/netlify\.app/.test(location.hostname)){
        var a=document.createElement('a');
        a.href=url;
        a.download=fname;
        a.target='_blank';
        a.rel='noopener';
        document.body.appendChild(a);
        a.click();
        setTimeout(function(){document.body.removeChild(a);},500);
        return;
    }

    // Local Flask: use POST-based download via form proxy
    var form=document.createElement('form');
    form.method='POST';
    form.action='/api/resource/download';
    form.target='_blank';
    form.style.display='none';

    var uInput=document.createElement('input');
    uInput.type='hidden';uInput.name='url';uInput.value=url;
    form.appendChild(uInput);

    var fInput=document.createElement('input');
    fInput.type='hidden';fInput.name='filename';fInput.value=fname;
    form.appendChild(fInput);

    document.body.appendChild(form);
    form.submit();
    setTimeout(function(){document.body.removeChild(form);},1000);

    // Also try opening directly in new tab as fallback
    setTimeout(function(){
        window.open(url,'_blank');
    },2000);
}
window.downloadVideo=downloadVideo;

})();
