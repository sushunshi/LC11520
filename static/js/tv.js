/**
 * MoonTV / LunaTV 前端逻辑 — 全细节还原
 */
(function(){
'use strict';

// ========== 工具 ==========
function $(id){return document.getElementById(id);}
function esc(s){
    if(s===null||s===undefined)return '';
    var d=document.createElement('div');d.textContent=String(s);return d.innerHTML;
}
function stripHtml(s){
    if(!s)return '';
    return s.replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').trim();
}
function shortName(n){return n&&n.length>16?n.slice(0,15)+'…':n;}

// ========== 存储 ==========
var favKey='moontv_favorites';
var histKey='moontv_history';
function loadFav(){try{return JSON.parse(localStorage.getItem(favKey)||'[]');}catch(e){return [];}}
function saveFav(list){localStorage.setItem(favKey,JSON.stringify(list));}
function loadHist(){try{return JSON.parse(localStorage.getItem(histKey)||'[]');}catch(e){return [];}}
function saveHist(list){localStorage.setItem(histKey,JSON.stringify(list.slice(0,50)));}

function isFav(vid,src){return loadFav().some(function(f){return f.vid===vid&&f.src===src;});}

// ========== 全局状态 ==========
var state={
    config:null,
    siteName:'MoonTV',
    categories:[],
    curCategory:{type:'movie',query:'热门'},
    searchWd:'',
    searchResults:null,
    detail:null,
    playing:null,
};

// ========== 播放器 ==========
var player=null;
var playerUrl=null;
var playerProxied=false;
function destroyPlayer(){
    if(player){try{player.destroy(false);}catch(e){}player=null;}
}

function proxyMedia(url){
    return '/.netlify/functions/media-proxy?url='+encodeURIComponent(url);
}

function openPlayer(title, url, epName, eps, from, vodId, source){
    destroyPlayer();
    playerUrl=url;
    playerProxied=false;
    $('player-title').textContent=title;
    $('player-ep-info').textContent=epName||'';
    $('player-overlay').style.display='flex';
    $('player-back').onclick=closePlayer;

    // render episodes
    var peEl=$('player-episodes');
    peEl.innerHTML='';
    if(eps&&eps.length){
        eps.forEach(function(e,i){
            var b=document.createElement('button');
            b.className='pe';
            b.textContent=e.name||(i+1);
            if(e.name===epName)b.classList.add('current');
            b.onclick=function(){
                if(state.detail)playUrl(state.detail,e,i+1);
            };
            peEl.appendChild(b);
        });
    }

    buildPlayer(url,title,epName);
}

function buildPlayer(url,title,epName){
    destroyPlayer();
    var container=$('player-container');
    container.innerHTML='<video id="html5-player" controls autoplay playsinline style="width:100%;height:100%;background:#000;object-fit:contain"></video>';
    var video=container.querySelector('video');
    player={destroy:function(){try{video.pause();video.removeAttribute('src');video.load();}catch(e){}}};
    var isHls=/\.m3u8/i.test(url);
    if(isHls){
        // HLS (m3u8) 在浏览器里 CORS/兼容性问题多，直接给外链让用户用 VLC/IDM
        video.remove();
        showPlaybackError(url);
        return;
    }
    video.src=url;
    video.onerror=function(){showPlaybackError(url);};
}

// 播放失败时显示错误面板（含 m3u8 链接供复制到外部播放器）
function showPlaybackError(url){
    var container=$('player-container');
    if(!container)return;
    container.innerHTML='<div style="padding:24px;color:#fff;text-align:center;max-width:560px;margin:0 auto;font-size:14px;line-height:1.7">'+
        '<div style="font-size:40px;margin-bottom:12px">⚠️</div>'+
        '<div style="font-weight:700;margin-bottom:8px">无法在此浏览器播放</div>'+
        '<div style="color:#9aa1ad;margin-bottom:16px">可能是 CORS 或网络限制，复制下方链接到 VLC / 迅雷 / IDM 等工具观看</div>'+
        '<textarea id="play-err-url" style="width:100%;height:80px;padding:8px;background:#0f1115;color:#e8eaed;border:1px solid #262a32;border-radius:6px;font-size:11px;font-family:monospace;resize:none" readonly>'+esc(url)+'</textarea>'+
        '<div style="display:flex;gap:8px;margin-top:10px;justify-content:center">'+
            '<button id="play-err-copy" style="padding:8px 18px;background:#f43f5e;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px">复制链接</button>'+
            '<a href="'+esc(url)+'" target="_blank" rel="noopener" style="padding:8px 18px;background:#1e2128;color:#e8eaed;border:1px solid #262a32;border-radius:6px;text-decoration:none;font-size:13px">浏览器打开</a>'+
        '</div></div>';
    var btn=document.getElementById('play-err-copy');
    if(btn) btn.onclick=function(){
        var ta=document.getElementById('play-err-url');
        ta.select();
        try{navigator.clipboard.writeText(ta.value);btn.textContent='✓ 已复制';setTimeout(function(){btn.textContent='复制链接';},2000);}catch(e){document.execCommand('copy');}
    };
}

function closePlayer(){
    destroyPlayer();
    $('player-overlay').style.display='none';
}

// ========== 渲染工具 ==========
function coverHtml(name,extra){
    // 无图时生成渐变文字占位
    var ch=(name||'?').trim().charAt(0);
    return '<div class="ph-grad">'+esc(ch)+'</div>'+(extra||'');
}

function cardHtml(item){
    var pic=item.vod_pic||'';
    var name=item.vod_name||item.title||'';
    var sub=item.vod_remarks||(item.rate?('评分 '+item.rate):(item.year||''));
    var score=item.vod_score||'';
    var inner=pic
        ?'<img src="'+esc(pic)+'" loading="lazy" onerror="this.parentElement.innerHTML=\''+coverHtml(name).replace(/'/g,"\\'")+'\'">'
        :coverHtml(name);
    return '<div class="card" onclick="location.hash=\'#/detail/'+esc(item.site_key||'')+'/'+esc(item.vod_id||'')+'\'">'+
        '<div class="card-poster">'+
            inner+
            (sub?'<div class="card-remarks">'+esc(sub)+'</div>':'')+
            (score?'<div class="card-score">'+esc(score)+'</div>':'')+
        '</div>'+
        '<div class="card-body">'+
            '<div class="card-name">'+esc(name)+'</div>'+
            '<div class="card-sub">'+esc(item.site_name||'')+'</div>'+
        '</div>'+
    '</div>';
}

function loadingHtml(){return '<div class="loading"><div class="spinner"></div><div>加载中...</div></div>';}
function emptyHtml(msg){return '<div class="empty"><div class="big">&#127902;</div><div>'+esc(msg||'暂无内容')+'</div></div>';}

// ========== 路由 ==========
function router(){
    var hash=location.hash||'#/';
    var parts=hash.replace(/^#\/?/,'').split('/');
    var route=parts[0]||'home';
    destroyPlayer();

    document.querySelectorAll('[data-nav]').forEach(function(el){
        var n=el.getAttribute('data-nav');
        el.classList.toggle('active',n===route);
    });
    closeSidebar();

    if(route==='home')renderHome();
    else if(route==='search')renderSearch(decodeURIComponent(parts[1]||''));
    else if(route==='detail')renderDetail(parts[1]||'',parts[2]||'');
    else if(route==='calendar')renderCalendar();
    else if(route==='favorites')renderFavorites();
    else if(route==='history')renderHistory();
    else renderHome();
}

// ========== 首页 ==========
var homeData={douban:[],sourceLists:[]};

function renderHome(){
    var main=$('tv-main');
    main.innerHTML='<div class="view" id="home-view">'+
        '<div class="view-head"><div class="view-title">影视</div></div>'+
        '<div class="cat-tabs" id="home-cats"></div>'+
        '<div id="home-douban"></div>'+
        '<div id="home-sources"></div>'+
    '</div>';

    // category tabs (movie first, then tv)
    var catsHtml='';
    state.categories.forEach(function(c,i){
        catsHtml+='<button class="chip'+(i===0?' active':'')+'" data-idx="'+i+'">'+esc(c.name||c.query)+'</button>';
    });
    $('home-cats').innerHTML=catsHtml;
    $('home-cats').querySelectorAll('.chip').forEach(function(ch){
        ch.onclick=function(){
            $('home-cats').querySelectorAll('.chip').forEach(function(x){x.classList.remove('active');});
            ch.classList.add('active');
            state.curCategory=state.categories[parseInt(ch.dataset.idx,10)];
            loadDouban();
        };
    });

    loadDouban();
    loadSourceLists();
}

async function loadDouban(){
    var el=$('home-douban');
    if(!el)return;
    el.innerHTML='<div class="view-head"><div class="view-title">'+esc(state.curCategory.name||state.curCategory.query)+'</div></div>'+loadingHtml();
    try{
        var r=await fetch('/api/tv/douban?type='+encodeURIComponent(state.curCategory.type)+'&tag='+encodeURIComponent(state.curCategory.query));
        var d=await r.json();
        if(d.items&&d.items.length){
            var html='<div class="view-head"><div class="view-title">'+esc(state.curCategory.name||state.curCategory.query)+'</div></div><div class="card-grid">';
            d.items.forEach(function(s){
                html+='<div class="card" onclick="openDouban(\''+esc(s.title)+'\')">'+
                    '<div class="card-poster">'+(s.cover?'<img src="'+esc(s.cover)+'" loading="lazy" onerror="this.parentElement.innerHTML=\''+coverHtml(s.title).replace(/'/g,"\\'")+'\'">':coverHtml(s.title))+
                    (s.rate?'<div class="card-score">'+esc(s.rate)+'</div>':'')+'</div>'+
                    '<div class="card-body"><div class="card-name">'+esc(s.title)+'</div><div class="card-sub">豆瓣</div></div>'+
                '</div>';
            });
            el.innerHTML=html+'</div>';
        }else{
            el.innerHTML=emptyHtml('豆瓣数据获取失败，可尝试切换分类或检查网络');
        }
    }catch(e){
        el.innerHTML=emptyHtml('豆瓣数据获取失败');
    }
}

function openDouban(title){
    // use douban title to search across sources
    location.hash='#/search/'+encodeURIComponent(title);
}
window.openDouban=openDouban;

async function loadSourceLists(){
    var el=$('home-sources');
    if(!el)return;
    try{
        var r=await fetch('/api/tv/home');
        var d=await r.json();
        if(d.error){el.innerHTML=emptyHtml(d.error);return;}
        if(!d.lists||!d.lists.length){el.innerHTML=emptyHtml('暂无资源站数据');return;}
        el.innerHTML='';
        d.lists.forEach(function(list){
            if(!list.items||!list.items.length)return;
            var sec=document.createElement('div');
            sec.className='view';
            sec.style.marginTop='24px';
            var html='<div class="view-head"><div class="view-title">'+esc(list.name)+'</div><span class="view-more" onclick="location.hash=\'#/search/'+esc(list.name)+'\'">更多 &rsaquo;</span></div><div class="card-grid">';
            list.items.forEach(function(item){html+=cardHtml(item);});
            html+='</div>';
            sec.innerHTML=html;
            el.appendChild(sec);
        });
    }catch(e){
        el.innerHTML=emptyHtml('资源站加载失败');
    }
}

// ========== 搜索 ==========
async function renderSearch(wd){
    state.searchWd=wd||state.searchWd;
    var main=$('tv-main');
    main.innerHTML='<div class="view"><div class="view-head"><div class="view-title">搜索：'+esc(state.searchWd)+'</div></div><div id="search-body">'+loadingHtml()+'</div></div>';

    if(!state.searchWd){
        main.innerHTML='<div class="view"><div class="view-head"><div class="view-title">搜索</div></div>'+emptyHtml('请输入关键词')+'</div>';
        return;
    }
    try{
        var r=await fetch('/api/tv/search?wd='+encodeURIComponent(state.searchWd));
        var d=await r.json();
        if(d.error){$('search-body').innerHTML=emptyHtml(d.error);return;}
        if(!d.results||!d.results.length){
            $('search-body').innerHTML=emptyHtml('未找到相关影视，试试其他关键词');
            return;
        }
        var body=$('search-body');
        var tabs='<div class="search-source-tabs">';
        d.results.forEach(function(res,idx){
            tabs+='<button class="chip'+(idx===0?' active':'')+'" data-idx="'+idx+'">'+esc(res.name)+' ('+res.items.length+')</button>';
        });
        tabs+='</div><div id="search-results"></div>';
        body.innerHTML=tabs;

        body.querySelectorAll('.chip').forEach(function(ch){
            ch.onclick=function(){
                body.querySelectorAll('.chip').forEach(function(x){x.classList.remove('active');});
                ch.classList.add('active');
                showSearchResults(d.results[parseInt(ch.dataset.idx,10)]);
            };
        });
        showSearchResults(d.results[0]);
    }catch(e){
        $('search-body').innerHTML=emptyHtml('搜索失败');
    }
}

function showSearchResults(res){
    var el=$('search-results');
    if(!el)return;
    if(!res||!res.items||!res.items.length){
        el.innerHTML=emptyHtml('该源暂无结果');
        return;
    }
    var html='<div class="search-count">'+esc(res.name)+' 共 '+res.items.length+' 条结果</div><div class="card-grid">';
    res.items.forEach(function(item){html+=cardHtml(item);});
    el.innerHTML=html+'</div>';
}

// ========== 详情 ==========
async function renderDetail(source,vodId){
    var main=$('tv-main');
    main.innerHTML='<div class="view">'+loadingHtml()+'</div>';
    try{
        var r=await fetch('/api/tv/detail?source='+encodeURIComponent(source)+'&vod_id='+encodeURIComponent(vodId));
        var d=await r.json();
        if(d.error){main.innerHTML='<div class="view">'+emptyHtml(d.error)+'</div>';return;}
        state.detail=d;

        // parse play groups
        var groups=parsePlayGroups(d.vod_play_from,d.vod_play_url);

        var html='<div class="view">'+
            '<div class="detail-hero">'+
                '<div class="detail-poster">'+(d.vod_pic?'<img src="'+esc(d.vod_pic)+'" onerror="this.parentElement.innerHTML=\''+coverHtml(d.vod_name).replace(/'/g,"\\'")+'\'">':coverHtml(d.vod_name))+'</div>'+
                '<div class="detail-info">'+
                    '<div class="detail-title">'+esc(d.vod_name)+'</div>'+
                    (d.vod_score?'<div class="detail-score">'+esc(d.vod_score)+'</div>':'')+
                    '<div class="detail-tags">'+
                        (d.vod_year?'<span class="dtag">'+esc(d.vod_year)+'</span>':'')+
                        (d.vod_area?'<span class="dtag">'+esc(d.vod_area)+'</span>':'')+
                        (d.vod_lang?'<span class="dtag">'+esc(d.vod_lang)+'</span>':'')+
                        (d.vod_type?'<span class="dtag">'+esc(d.vod_type)+'</span>':'')+
                        (d.vod_remarks?'<span class="dtag">'+esc(d.vod_remarks)+'</span>':'')+
                    '</div>'+
                    '<div class="detail-meta">'+
                        (d.vod_director?'<div><b>导演：</b>'+esc(d.vod_director)+'</div>':'')+
                        (d.vod_actor?'<div><b>主演：</b>'+esc(d.vod_actor)+'</div>':'')+
                    '</div>'+
                    '<div class="detail-desc">'+(d.vod_content?esc(stripHtml(d.vod_content).substring(0,300)):'暂无简介')+'</div>'+
                    '<div class="detail-actions">'+
                        '<button class="btn primary" id="btn-play-first">&#9654; 立即播放</button>'+
                        '<button class="btn ghost" id="btn-fav-toggle">'+(isFav(vodId,source)?'&#10003; 已收藏':'&#9825; 收藏')+'</button>'+
                    '</div>'+
                '</div>'+
            '</div>';

        // episodes section
        if(groups.length){
            html+='<div class="ep-section"><div class="ep-section-title">剧集列表</div>';
            if(groups.length>1){
                html+='<div class="ep-from-tabs">';
                groups.forEach(function(g,i){
                    html+='<button class="ep-from'+(i===0?' active':'')+'" data-g="'+i+'">'+esc(g.from)+'</button>';
                });
                html+='</div>';
            }
            html+='<div class="ep-grid" id="ep-grid">';
            groups[0].eps.forEach(function(e,i){
                html+='<button class="ep-item" data-g="0" data-ep="'+(i+1)+'">'+esc(e.name||(i+1))+'</button>';
            });
            html+='</div></div>';
        }else{
            html+='<div class="ep-section"><div class="ep-section-title">剧集列表</div>'+emptyHtml('暂无播放源')+'</div>';
        }

        html+='</div>';
        main.innerHTML=html;

        // from tabs
        main.querySelectorAll('.ep-from').forEach(function(t){
            t.onclick=function(){
                main.querySelectorAll('.ep-from').forEach(function(x){x.classList.remove('active');});
                t.classList.add('active');
                var gi=parseInt(t.dataset.g,10);
                var grid=$('ep-grid');
                grid.innerHTML='';
                groups[gi].eps.forEach(function(e,i){
                    var b=document.createElement('button');
                    b.className='ep-item';b.dataset.g=gi;b.dataset.ep=i+1;
                    b.textContent=e.name||(i+1);
                    b.onclick=playEp;
                    grid.appendChild(b);
                });
            };
        });

        // episode click
        main.querySelectorAll('.ep-item').forEach(function(ep){ep.onclick=playEp;});

        // play first
        $('btn-play-first').onclick=function(){
            if(groups.length&&groups[0].eps.length)playUrl(d,groups[0].eps[0],1);
        };

        // favorite toggle
        $('btn-fav-toggle').onclick=function(){
            var favs=loadFav();
            if(isFav(vodId,source)){
                favs=favs.filter(function(f){return!(f.vid===vodId&&f.src===source);});
                this.textContent='&#9825; 收藏';
                this.classList.remove('active');
            }else{
                favs.unshift({vid:vodId,src:source,name:d.vod_name,pic:d.vod_pic,sub:d.vod_remarks,time:Date.now()});
                this.textContent='&#10003; 已收藏';
                this.classList.add('active');
            }
            saveFav(favs);
        };
    }catch(e){
        main.innerHTML='<div class="view">'+emptyHtml('详情加载失败')+'</div>';
    }
}

function parsePlayGroups(fromStr,urlStr){
    var fromList=(fromStr||'').split('$$$').filter(function(x){return x.trim();});
    var groupList=(urlStr||'').split('$$$').filter(function(x){return x.trim();});
    var groups=[];
    groupList.forEach(function(group,i){
        var from=(i<fromList.length&&fromList[i].trim())?fromList[i].trim():(i+1);
        var eps=[];
        group.split('#').forEach(function(pair){
            pair=pair.trim();
            if(pair.indexOf('$')>-1){
                var parts=pair.split('$');
                var url=parts.slice(1).join('$');
                if(url.indexOf('javascript')===0)return;
                eps.push({name:parts[0],url:url});
            }
        });
        if(eps.length)groups.push({from:from,eps:eps});
    });
    return groups;
}

function playEp(e){
    var g=parseInt(e.target.dataset.g,10);
    var ep=parseInt(e.target.dataset.ep,10);
    var groups=parsePlayGroups(state.detail.vod_play_from,state.detail.vod_play_url);
    if(!groups[g]||!groups[g].eps[ep-1])return;
    playUrl(state.detail,groups[g].eps[ep-1],ep);
}

async function playUrl(detail,ep,epIndex){
    // save history
    var hist=loadHist();
    hist=hist.filter(function(h){return!(h.vid===detail.vod_id&&h.src===detail.source);});
    hist.unshift({vid:detail.vod_id,src:detail.source,name:detail.vod_name,pic:detail.vod_pic,ep:epIndex,epName:ep.name,time:Date.now(),url:ep.url});
    saveHist(hist);

    // try resolve via server to get playable url (share page → m3u8/mp4)
    var url=ep.url;
    try{
        var r=await fetch('/api/tv/play?source='+encodeURIComponent(detail.source)+'&vod_id='+encodeURIComponent(detail.vod_id)+'&ep='+epIndex);
        var d=await r.json();
        if(d.playable_url)url=d.playable_url;
        else if(d.episode&&d.episode.url)url=d.episode.url;
    }catch(e){}

    var groups=parsePlayGroups(detail.vod_play_from,detail.vod_play_url);
    openPlayer(detail.vod_name,url,ep.name,groups[0]?groups[0].eps:[],'',detail.vod_id,detail.source);
}

// ========== 番剧日历 ==========
async function renderCalendar(){
    var main=$('tv-main');
    main.innerHTML='<div class="view"><div class="view-head"><div class="view-title">番剧日历</div></div>'+loadingHtml()+'</div>';
    try{
        var r=await fetch('/api/tv/calendar');
        var d=await r.json();
        if(d.error){main.innerHTML='<div class="view">'+emptyHtml(d.error)+'</div>';return;}
        var html='<div class="view"><div class="view-head"><div class="view-title">番剧日历</div></div><div class="cal-days">';
        d.days.forEach(function(day){
            if(!day.items.length)return;
            html+='<div class="cal-day"><div class="cal-day-head">'+esc(day.weekday)+'</div><div class="cal-day-items">';
            day.items.forEach(function(it){
                html+='<div class="cal-item">'+
                    (it.image?'<img src="'+esc(it.image)+'" loading="lazy" onerror="this.style.display=\'none\'">':'')+
                    '<div><div class="cal-item-name">'+esc(it.name_cn||it.name)+'</div>'+
                    '<div class="cal-item-meta">'+(it.rating?'评分 '+esc(it.rating):esc(it.air_date||''))+'</div></div>'+
                '</div>';
            });
            html+='</div></div>';
        });
        main.innerHTML=html+'</div></div>';
    }catch(e){
        main.innerHTML='<div class="view">'+emptyHtml('番剧日历加载失败')+'</div>';
    }
}

// ========== 收藏 / 历史 ==========
function renderFavorites(){
    var main=$('tv-main');
    var favs=loadFav();
    if(!favs.length){
        main.innerHTML='<div class="view"><div class="view-head"><div class="view-title">我的收藏</div></div>'+emptyHtml('还没有收藏，去发现好片吧')+'</div>';
        return;
    }
    var html='<div class="view"><div class="view-head"><div class="view-title">我的收藏</div></div><div class="storage-grid">';
    favs.forEach(function(f){
        html+='<div class="storage-item" onclick="location.hash=\'#/detail/'+esc(f.src)+'/'+esc(f.vid)+'\'">'+
            (f.pic?'<img src="'+esc(f.pic)+'" loading="lazy" onerror="this.parentElement.innerHTML=\''+coverHtml(f.name).replace(/'/g,"\\'")+'\'">':coverHtml(f.name))+
            '<button class="si-del" data-vid="'+esc(f.vid)+'" data-src="'+esc(f.src)+'">&times;</button>'+
            '<div class="si-body"><div class="si-name">'+esc(f.name)+'</div><div class="si-sub">'+esc(f.sub||'')+'</div></div>'+
        '</div>';
    });
    main.innerHTML=html+'</div></div>';
    main.querySelectorAll('.si-del').forEach(function(b){
        b.onclick=function(e){
            e.stopPropagation();
            var favs2=loadFav().filter(function(f){return!(f.vid===b.dataset.vid&&f.src===b.dataset.src);});
            saveFav(favs2);
            renderFavorites();
        };
    });
}

function renderHistory(){
    var main=$('tv-main');
    var hist=loadHist();
    if(!hist.length){
        main.innerHTML='<div class="view"><div class="view-head"><div class="view-title">继续观看</div></div>'+emptyHtml('暂无观看记录')+'</div>';
        return;
    }
    var html='<div class="view"><div class="view-head"><div class="view-title">继续观看</div></div><div class="storage-grid">';
    hist.forEach(function(h){
        html+='<div class="storage-item" onclick="playHistory(\''+esc(h.src)+'\',\''+esc(h.vid)+'\',\''+esc(h.ep)+'\')">'+
            (h.pic?'<img src="'+esc(h.pic)+'" loading="lazy" onerror="this.parentElement.innerHTML=\''+coverHtml(h.name).replace(/'/g,"\\'")+'\'">':coverHtml(h.name))+
            '<button class="si-del" data-hid="'+esc(h.src+'_'+h.vid)+'">&times;</button>'+
            '<div class="si-body"><div class="si-name">'+esc(h.name)+'</div><div class="si-sub">'+esc(h.epName||('第'+h.ep+'集'))+'</div></div>'+
            (h.ep?'<div class="progress-bar" style="width:30%"></div>':'')+
        '</div>';
    });
    main.innerHTML=html+'</div></div>';
    main.querySelectorAll('.si-del').forEach(function(b){
        b.onclick=function(e){
            e.stopPropagation();
            var hid=b.dataset.hid;
            var hist2=loadHist().filter(function(h){return h.src+'_'+h.vid!==hid;});
            saveHist(hist2);
            renderHistory();
        };
    });
}

function playHistory(src,vid,ep){
    // navigate to detail then play that episode
    location.hash='#/detail/'+src+'/'+vid;
    setTimeout(function(){
        var groups=parsePlayGroups(state.detail.vod_play_from,state.detail.vod_play_url);
        if(groups[0]&&groups[0].eps[ep-1])playUrl(state.detail,groups[0].eps[ep-1],parseInt(ep,10));
    },800);
}
window.playHistory=playHistory;

// ========== 设置 ==========
function openSettings(){
    $('settings-modal').style.display='flex';
    fetch('/api/tv/config').then(function(r){return r.json();}).then(function(d){
        var c=d.config||{};
        state.config=c;
        $('set-site-name').value=state.siteName||'MoonTV';
        $('set-announcement').value=announcementText||'';
        $('set-cache-time').value=c.cache_time||7200;
        $('set-config').value=JSON.stringify(c,null,2);
    });
}
function closeSettings(){$('settings-modal').style.display='none';}

async function saveSettings(){
    try{
        var cfg=JSON.parse($('set-config').value);
        state.config=cfg;
        var r=await fetch('/api/tv/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:cfg})});
        var d=await r.json();
        state.siteName=$('set-site-name').value||'MoonTV';
        $('site-name').textContent=state.siteName;
        document.title=state.siteName+' — 影视聚合播放器';
        // rebuild categories
        loadCategories();
        closeSettings();
        router();
    }catch(e){
        alert('配置 JSON 格式错误: '+e.message);
    }
}

var announcementText='';

function loadCategories(){
    var cfg=state.config||{};
    var cats=cfg.custom_category||[];
    state.categories=cats.length?cats:[{name:'热门',type:'movie',query:'热门'}];
    if(!state.categories.some(function(c){return c.type==='movie';})){
        state.categories.unshift({name:'热门',type:'movie',query:'热门'});
    }
    // sidebar category list
    var cl=$('category-list');
    if(cl){
        var html='';
        var movieCat=cats.filter(function(c){return c.type==='movie';});
        var tvCat=cats.filter(function(c){return c.type==='tv';});
        if(movieCat.length){html+='<div class="cat-group-label">电影</div>';movieCat.forEach(function(c){html+='<button class="cat-chip">'+esc(c.name||c.query)+'</button>';});}
        if(tvCat.length){html+='<div class="cat-group-label">剧集</div>';tvCat.forEach(function(c){html+='<button class="cat-chip">'+esc(c.name||c.query)+'</button>';});}
        cl.innerHTML=html;
        cl.querySelectorAll('.cat-chip').forEach(function(ch){
            ch.onclick=function(){
                state.curCategory={type:ch.textContent,query:ch.textContent};
                // find matching category in state.categories
                var match=state.categories.find(function(c){return c.name===ch.textContent;});
                if(match)state.curCategory=match;
                location.hash='#/';
                setTimeout(router,50);
            };
        });
    }
}

// ========== 初始化 ==========
function init(){
    // load config
    fetch('/api/tv/config').then(function(r){return r.json();}).then(function(d){
        var c=d.config||{};
        state.config=c;
        state.siteName='MoonTV';
        document.title=state.siteName+' — 影视聚合播放器';
        $('site-name').textContent=state.siteName;
        announcementText='';
        loadCategories();
    });

    // events
    window.addEventListener('hashchange',router);
    $('global-search-btn').onclick=doGlobalSearch;
    $('global-search-input').addEventListener('keydown',function(e){if(e.key==='Enter')doGlobalSearch();});
    $('btn-fav').onclick=function(){location.hash='#/favorites';};
    $('btn-settings').onclick=openSettings;
    $('btn-settings-2').onclick=openSettings;
    $('settings-close').onclick=closeSettings;
    $('settings-cancel').onclick=closeSettings;
    $('settings-save').onclick=saveSettings;
    $('btn-subscribe-import').onclick=importSubscribe;
    $('btn-subscribe-copy').onclick=copySubscribe;
    $('sidebar-toggle').onclick=function(){$('sidebar').classList.add('open');$('sidebar-mask').classList.add('show');};
    $('sidebar-mask').onclick=closeSidebar;
    $('announcement-close').onclick=function(){$('announcement').style.display='none';};

    // bottom nav
    document.querySelectorAll('.bottom-nav a,.side-item').forEach(function(el){
        if(!el.dataset.nav)return;
        el.onclick=function(){document.querySelectorAll('.bottom-nav a,.side-item').forEach(function(x){x.classList.remove('active');});};
    });

    router();
}

function closeSidebar(){
    $('sidebar').classList.remove('open');
    $('sidebar-mask').classList.remove('show');
}

function doGlobalSearch(){
    var wd=$('global-search-input').value.trim();
    if(!wd)return;
    location.hash='#/search/'+encodeURIComponent(wd);
}

async function importSubscribe(){
    var raw=$('set-subscribe').value.trim();
    if(!raw){return;}
    try{
        var r=await fetch('/api/tv/config/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({base58:raw})});
        var d=await r.json();
        if(d.error){$('subscribe-hint').textContent=d.error;$('subscribe-hint').style.color='#f87171';return;}
        $('subscribe-hint').textContent=d.message;$('subscribe-hint').style.color='#4ade80';
        setTimeout(function(){closeSettings();location.reload();},800);
    }catch(e){
        $('subscribe-hint').textContent='导入失败: '+e.message;$('subscribe-hint').style.color='#f87171';
    }
}

async function copySubscribe(){
    try{
        var r=await fetch('/api/tv/config');
        var d=await r.json();
        var sub=d.config_base58||'';
        navigator.clipboard.writeText(sub).then(function(){
            $('subscribe-hint').textContent='订阅链接已复制';
            $('subscribe-hint').style.color='#4ade80';
        });
    }catch(e){}
}

// start
document.addEventListener('DOMContentLoaded',init);
})();
