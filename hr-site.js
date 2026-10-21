/* happyreturnslocations.us — bundled client-side JS (v2 progressive-load) */

/* ================= Deadline tracker widget (self-contained) ================= */
(function(){
  function pad(n){return n<10?'0'+n:''+n;}
  function fmtDate(d){
    var days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return days[d.getDay()]+', '+months[d.getMonth()]+' '+d.getDate()+', '+d.getFullYear();
  }
  function run(){
    var dateEl=document.getElementById('hr-deadline-date');
    var winEl=document.getElementById('hr-deadline-window');
    var out=document.getElementById('hr-deadline-result');
    if(!dateEl.value){out.innerHTML='<div style="background:var(--red-bg);border:2px solid #991B1B;border-radius:8px;padding:10px 14px;color:#991B1B;font-weight:700">Pick a delivery date to calculate</div>';return;}
    var delivery=new Date(dateEl.value+'T00:00:00');
    var days=parseInt(winEl.value,10);
    var deadline=new Date(delivery.getTime()+days*86400000);
    var today=new Date();today.setHours(0,0,0,0);
    var daysLeft=Math.ceil((deadline-today)/86400000);
    var color,emoji,status;
    if(daysLeft<0){color='#991B1B';emoji='X';status='Window closed '+(-daysLeft)+' day'+(daysLeft===-1?'':'s')+' ago. Happy Returns will not generate a QR code. Contact the retailer directly to request an exception.';}
    else if(daysLeft===0){color='#B45309';emoji='!';status='Today is your last day. Drop off before close of business or the window expires at midnight.';}
    else if(daysLeft<=3){color='#B45309';emoji='!';status=daysLeft+' day'+(daysLeft===1?'':'s')+' left. Drop off today or tomorrow to avoid a last-minute rush.';}
    else if(daysLeft<=7){color='#065F46';emoji='*';status=daysLeft+' days left. Plan the drop-off this week.';}
    else{color='#065F46';emoji='v';status=daysLeft+' days left. Plenty of time.';}
    out.innerHTML='<div style="background:#fff;border:2px solid var(--black);border-radius:10px;padding:12px 14px;box-shadow:2px 2px 0 var(--black)">'+
      '<div style="font-size:15px;font-weight:800;color:var(--black);margin-bottom:4px">Deadline: <span style="background:var(--yellow);padding:2px 8px;border-radius:4px">'+fmtDate(deadline)+'</span></div>'+
      '<div style="font-size:14px;color:'+color+';font-weight:700;margin-top:6px">'+emoji+' '+status+'</div>'+
    '</div>';
  }
  document.addEventListener('DOMContentLoaded',function(){
    var btn=document.getElementById('hr-deadline-go');
    if(btn) btn.addEventListener('click',run);
    var dateEl=document.getElementById('hr-deadline-date');
    if(dateEl){
      var t=new Date();dateEl.max=pad(t.getFullYear())+'-'+pad(t.getMonth()+1)+'-'+pad(t.getDate());
    }
  });
})();

/* ================= Main map app (progressive-load) ================= */
(function(){
'use strict';

var DATA_BASE = 'https://cdn.jsdelivr.net/gh/Azeem-tech314/dev5.476@main/';
var FEATURED = [];                  // ~200 pins loaded first (national coverage)
var BRAND_DATA = {};                // slug -> array of rows (lazy)
var BRAND_LOADING = {};             // slug -> Promise (in-flight)
var INDEX = {brands:[], total:0};
var ACTIVE_BRANDS = new Set();      // empty by default (like breakfast's chains). Activated by search/locate/chip-click.
var FAVS = (function(){try{return new Set(JSON.parse(localStorage.getItem('hr_favs')||'[]'));}catch(e){return new Set();}})();
var STATUS_FILTERS = new Set(['open']);
var USER_LL = null, USER_MARKER = null, CURRENT_AREA = null;
var RADIUS_MI = 25;
var MAP = null, CLUSTER = null;
var RENDER_TIMER = null, POPUP_OPEN = false;
var RADIUS_CACHE = {items:null, ll:null, radius:null};
// (zoom gate + viewport cap removed — working set is now purely state-driven)

var BRAND_META = {
  'The UPS Store':      {slug:'ups-store', color:'#351C15', ring:'#D4A574', emoji:'🟤'},
  'Ulta Beauty':        {slug:'ulta',      color:'#E31C79', ring:'#FFC5DE', emoji:'💗'},
  'UPS Ship Center':    {slug:'ship-ctr',  color:'#ECE70F', ring:'#FFF9A8', emoji:'🟡'},
  'Staples':            {slug:'staples',   color:'#CC0000', ring:'#FFCDD2', emoji:'🔴'}
};
var SLUG_TO_META = {};
Object.keys(BRAND_META).forEach(function(name){ var m=BRAND_META[name]; SLUG_TO_META[m.slug]={name:name,color:m.color,ring:m.ring,emoji:m.emoji}; });

function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function pad(n){return n<10?'0'+n:''+n;}
function nowMins(){var d=new Date();return d.getHours()*60+d.getMinutes();}
function parseHM(s){if(!s)return 0;var p=String(s).split(':');return (+p[0]||0)*60+(+p[1]||0);}
function fmt12(mins){var h=Math.floor(mins/60)%24,m=mins%60,ap=h>=12?'PM':'AM',h12=((h+11)%12)+1;return h12+':'+pad(m)+' '+ap;}
function fmtClock(){var d=new Date(),h=d.getHours(),m=d.getMinutes(),ap=h>=12?'PM':'AM',h12=((h+11)%12)+1;return h12+':'+pad(m)+' '+ap;}
function hav(a,b,c,d){var R=3958.8,T=Math.PI/180,dLat=(c-a)*T,dLng=(d-b)*T;var A=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(a*T)*Math.cos(c*T)*Math.sin(dLng/2)*Math.sin(dLng/2);return 2*R*Math.asin(Math.sqrt(A));}
function saveFavs(){try{localStorage.setItem('hr_favs',JSON.stringify([].concat(Array.from(FAVS))));}catch(e){}}

var DAY_PREFIX = ['Su','Mo','Tu','We','Th','Fr','Sa'];
function parseHoursString(h){
  if(!h) return {};
  var out = {};
  var parts = String(h).split(/[;,]/);
  for(var i=0;i<parts.length;i++){
    var p = parts[i].trim(); if(!p) continue;
    var m = p.match(/^(Mo|Tu|We|Th|Fr|Sa|Su)\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/i);
    if(m){
      var day = m[1].charAt(0).toUpperCase()+m[1].charAt(1).toLowerCase();
      out[day] = {start: parseHM(m[2]), end: parseHM(m[3]), raw: m[2]+'-'+m[3]};
    } else if(/24\/7|24 hours/i.test(p)){
      for(var j=0;j<DAY_PREFIX.length;j++) out[DAY_PREFIX[j]] = {start:0, end:1440, raw:'24 hours'};
    }
  }
  return out;
}
function todayPrefix(){ return DAY_PREFIX[new Date().getDay()]; }
function isOpenNow(h){var p=parseHoursString(h);var t=p[todayPrefix()];if(!t)return false;var n=nowMins();return n>=t.start && n<t.end;}
function todayHoursLabel(h){var p=parseHoursString(h);var t=p[todayPrefix()];if(!t)return 'Closed today';if(t.end-t.start>=1439)return 'Open 24 hours';var n=nowMins();if(n<t.start)return 'Opens '+fmt12(t.start);if(n>=t.end)return 'Closed. Opens tomorrow';return 'Open now. Closes '+fmt12(t.end);}
function humanAllHours(h){var p=parseHoursString(h);var dn={Su:'Sun',Mo:'Mon',Tu:'Tue',We:'Wed',Th:'Thu',Fr:'Fri',Sa:'Sat'};var out=[];var order=['Mo','Tu','We','Th','Fr','Sa','Su'];for(var i=0;i<order.length;i++){var d=order[i],e=p[d];if(e)out.push(dn[d]+': '+fmt12(e.start)+' - '+fmt12(e.end));else out.push(dn[d]+': Closed');}return out.join('<br>');}

var CITY_SNAPS = {
  'new york':[40.7128,-74.006],'los angeles':[34.0522,-118.2437],'chicago':[41.8781,-87.6298],
  'houston':[29.7604,-95.3698],'phoenix':[33.4484,-112.074],'philadelphia':[39.9526,-75.1652],
  'san antonio':[29.4241,-98.4936],'san diego':[32.7157,-117.1611],'dallas':[32.7767,-96.797],
  'austin':[30.2672,-97.7431],'san jose':[37.3382,-121.8863],'jacksonville':[30.3322,-81.6557],
  'fort worth':[32.7555,-97.3308],'columbus':[39.9612,-82.9988],'charlotte':[35.2271,-80.8431],
  'san francisco':[37.7749,-122.4194],'indianapolis':[39.7684,-86.1581],'seattle':[47.6062,-122.3321],
  'denver':[39.7392,-104.9903],'washington':[38.9072,-77.0369],'boston':[42.3601,-71.0589],
  'nashville':[36.1627,-86.7816],'baltimore':[39.2904,-76.6122],'portland':[45.5152,-122.6784],
  'las vegas':[36.1699,-115.1398],'miami':[25.7617,-80.1918],'atlanta':[33.749,-84.388],
  'minneapolis':[44.9778,-93.265],'orlando':[28.5383,-81.3792],'tampa':[27.9506,-82.4572],
  'detroit':[42.3314,-83.0458],'st louis':[38.627,-90.1994],'kansas city':[39.0997,-94.5786],
  'pittsburgh':[40.4406,-79.9959],'cincinnati':[39.1031,-84.512]
};
function normalizeCityQuery(q){return String(q||'').toLowerCase().trim().replace(/,.*/,'').replace(/\s+/g,' ');}
function geocode(q){
  var key = normalizeCityQuery(q);
  if(CITY_SNAPS[key]) return Promise.resolve(CITY_SNAPS[key].slice());
  var url = 'https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=8&countrycodes=us&q='+encodeURIComponent(q);
  return fetch(url,{headers:{'Accept-Language':'en'}}).then(function(r){return r.json();}).then(function(a){
    if(!a||!a.length) throw new Error('No results');
    var CT={city:6,town:5,village:3,municipality:5,administrative:4,county:2,borough:3,suburb:2,neighbourhood:1,hamlet:1};
    var scored=a.map(function(x){var t=x.type||'',cls=x.class||'',base=CT[t]||0;if(cls==='place'||cls==='boundary')base+=1;if(cls==='tourism'||cls==='amenity'||cls==='building'||cls==='shop')base-=3;var imp=+x.importance||0;return{r:x,s:base*10+imp*5};});
    scored.sort(function(a,b){return b.s-a.s;});
    return [+scored[0].r.lat,+scored[0].r.lon];
  });
}

/* ---- Data loading ---- */
function loadBrand(slug){
  if(BRAND_DATA[slug]) return Promise.resolve(BRAND_DATA[slug]);
  if(BRAND_LOADING[slug]) return BRAND_LOADING[slug];
  BRAND_LOADING[slug] = fetch(DATA_BASE+slug+'.json').then(function(r){return r.json();}).then(function(j){
    BRAND_DATA[slug] = j;
    delete BRAND_LOADING[slug];
    invalidateRadiusCache();
    scheduleRender();
    return j;
  }).catch(function(e){delete BRAND_LOADING[slug]; console.warn('load fail',slug,e); return null;});
  return BRAND_LOADING[slug];
}
function loadAllBrands(){ return Promise.all(INDEX.brands.map(function(b){return loadBrand(b.slug);})); }
function allLoadedItems(){
  // Union of all loaded brand data + featured (for trip planner, city grid, modal)
  var out = FEATURED.slice();
  var seen = {}; for(var i=0;i<out.length;i++){seen[out[i].id]=1;}
  INDEX.brands.forEach(function(b){
    var rows = BRAND_DATA[b.slug]; if(!rows) return;
    for(var j=0;j<rows.length;j++){ if(!seen[rows[j].id]){seen[rows[j].id]=1; out.push(rows[j]);} }
  });
  return out;
}

function boot(){
  var nudge = document.getElementById('hr-nudge');
  if(nudge) nudge.innerHTML = '<span class="hr-loader"></span>Loading map...';
  Promise.all([
    fetch(DATA_BASE+'hr-index.json',{cache:'force-cache'}).then(function(r){return r.json();}),
    fetch(DATA_BASE+'hr-featured.json',{cache:'force-cache'}).then(function(r){return r.json();}).catch(function(){return [];})
  ]).then(function(res){
    INDEX = res[0]; FEATURED = res[1]||[];
    // Enrich brands with meta (color/ring/emoji from BRAND_META)
    INDEX.brands.forEach(function(b){
      var meta = SLUG_TO_META[b.slug];
      if(meta){ b.color = meta.color; b.ring = meta.ring; b.emoji = meta.emoji; }
    });
    // Breakfast model: brand chips start OFF. User activates by chip click, search, or location.
    // Brand pages can preset one or more chips by setting window.HR_BRAND_FILTER before this script loads.
    // Accepts a single slug ("ups-store") or an array (["ups-store","ulta"]).
    // On a brand page, also default Open Now OFF so the visible count matches the baked total
    // in the H1 and trust tiles (user can turn Open Now on to filter down).
    ACTIVE_BRANDS = new Set();
    try{
      var hbf = window.HR_BRAND_FILTER;
      if(typeof hbf === 'string' && hbf){ ACTIVE_BRANDS.add(hbf); STATUS_FILTERS.delete('open'); }
      else if(Array.isArray(hbf) && hbf.length){ hbf.forEach(function(s){ if(s) ACTIVE_BRANDS.add(s); }); STATUS_FILTERS.delete('open'); }
    }catch(e){}
    renderBrandChips();
    renderBrandGrid();
    updateBrandStatus();
    initMap();
    startClock();
    wireControls();
    renderMap();     // first paint: featured only
    autoLocate();
    // Background: fetch all 4 brand files in parallel. Each triggers scheduleRender when done.
    loadAllBrands().then(function(){ renderCityGrid(); });
    if(nudge) nudge.innerHTML = 'Tap <b>My Location</b> or search a city or ZIP to see every Happy Returns bar within 25 miles. Showing a national sample at this zoom - zoom in or search to see all 10,017.';
    // Window hooks for tests
    try{
      window.MAP=MAP; window.CLUSTER=CLUSTER; window.INDEX=INDEX;
      Object.defineProperty(window,'ALL',{get:allLoadedItems, configurable:true});
      window.FEATURED=FEATURED; window.BRAND_DATA=BRAND_DATA;
      window.__openFirstMarker=function(cb){
        var f0=null;
        if(window.CLUSTER){window.CLUSTER.eachLayer(function(l){if(!f0 && l instanceof L.Marker) f0=l;});}
        if(!f0) return false;
        var ll = f0.getLatLng();
        window.CLUSTER.zoomToShowLayer(f0,function(){
          setTimeout(function(){
            var fresh=null;
            if(window.CLUSTER){
              window.CLUSTER.eachLayer(function(l){
                if(fresh || !(l instanceof L.Marker)) return;
                var p = l.getLatLng();
                if(Math.abs(p.lat-ll.lat)<1e-5 && Math.abs(p.lng-ll.lng)<1e-5) fresh=l;
              });
            }
            if(!fresh && window.CLUSTER){window.CLUSTER.eachLayer(function(l){if(!fresh && l instanceof L.Marker) fresh=l;});}
            if(fresh){ try{fresh.fire('click');}catch(e){}
              setTimeout(function(){ if(fresh.getPopup && fresh.getPopup() && fresh.isPopupOpen && !fresh.isPopupOpen()){ try{fresh.openPopup();}catch(e){} } if(cb) cb();},200);
            } else if(cb){cb();}
          },100);
        });
        return true;
      };
      // Expose selected functions so brand pages (and tests) can trigger them from inline buttons
      window.openBrandModal = openBrandModal;
      window.__HR_READY=true;
    }catch(e){}
  }).catch(function(e){
    console.error('HR boot failed',e);
    if(nudge) nudge.innerHTML = 'Could not reach the Return Bar data files. Check your connection and refresh.';
  });
}

function renderBrandChips(){
  var wrap = document.getElementById('hr-brands');
  // Brand/retailer pages: HR_BRAND_FILTER = "slug" (string) scopes the map to that one brand
  // and renders only its chip. The other 3 brand chips are hidden since they can't be toggled on.
  var only = (typeof window.HR_BRAND_FILTER === 'string' && window.HR_BRAND_FILTER) ? window.HR_BRAND_FILTER : null;
  var brands = only ? INDEX.brands.filter(function(x){ return x.slug === only; }) : INDEX.brands;
  wrap.innerHTML = brands.map(function(x){
    var on = ACTIVE_BRANDS.has(x.slug) ? ' on' : '';
    return '<span class="hr-bchip'+on+'" data-brand="'+esc(x.slug)+'"><span>'+x.emoji+' '+esc(x.name)+'</span><span class="hr-cn">'+x.count.toLocaleString()+'</span></span>';
  }).join('');
  wrap.querySelectorAll('[data-brand]').forEach(function(el){
    el.addEventListener('click',function(){toggleBrandChip(el.dataset.brand);});
  });
  // On single-brand pages, Show All / Hide All are pointless (only one chip exists).
  if(only){
    var ba = document.querySelector('.hr-b-actions');
    if(ba) ba.style.display = 'none';
    var hdr = document.querySelector('.hr-brands-hdr');
    // Reword the header label to match the single-brand mode
    if(hdr){
      var label = hdr.querySelector('b');
      if(label) label.textContent = '🏪 This map';
    }
  }
}

function toggleBrandChip(slug){
  var chip = document.querySelector('[data-brand="'+slug+'"].hr-bchip');
  if(ACTIVE_BRANDS.has(slug)){
    ACTIVE_BRANDS.delete(slug);
    if(chip) chip.classList.remove('on');
  }else{
    ACTIVE_BRANDS.add(slug);
    if(chip) chip.classList.add('on');
    // Lazy-load brand data if not yet loaded
    if(!BRAND_DATA[slug]) loadBrand(slug);
  }
  invalidateRadiusCache();
  scheduleRender();
  updateBrandStatus();
}

function updateBrandStatus(){
  var n = ACTIVE_BRANDS.size;
  var el = document.getElementById('hr-brands-status');
  if(el) el.textContent = n ? '- '+n+' brand'+(n===1?'':'s')+' showing' : '- tap a brand or search a city to see every bar';
  // Swap the whole "N brands on" segment. Preview covers all 4 brands by design, so say so.
  var wrap = document.getElementById('hr-cnt-brands-wrap');
  if(wrap){
    if(n > 0){
      wrap.innerHTML = '<b id="hr-cnt-brands">'+n+'</b> brand'+(n===1?'':'s')+' on';
    } else {
      wrap.innerHTML = '<b id="hr-cnt-brands">4</b> brands · tap one to narrow';
    }
  }
}

function renderBrandGrid(){
  var g = document.getElementById('hr-brand-grid');
  if(!g) return;
  g.innerHTML = INDEX.brands.map(function(x){
    var hoursLine = 'Open typical retail hours';
    if(x.name==='The UPS Store') hoursLine = '8:30 AM to 6:30 PM weekdays';
    else if(x.name==='Ulta Beauty') hoursLine = '10 AM to 9 PM daily';
    else if(x.name==='UPS Ship Center') hoursLine = '9 AM to 6 PM typical';
    else if(x.name==='Staples') hoursLine = '8 AM to 9 PM weekdays';
    return '<div class="hr-brand-card" data-brand="'+esc(x.slug)+'">'+
      '<button class="hr-expand-btn" data-expand="'+esc(x.slug)+'">Expand &rsaquo;</button>'+
      '<h4>'+x.emoji+' '+esc(x.name)+'</h4>'+
      '<div class="hr-b-cnt">'+x.count.toLocaleString()+' verified US bars</div>'+
      '<div class="hr-b-hours">'+esc(hoursLine)+'</div>'+
      '<div class="hr-b-tag">Tap card: show only '+esc(x.name)+' on map</div>'+
    '</div>';
  }).join('');
  g.querySelectorAll('.hr-brand-card').forEach(function(el){
    el.addEventListener('click',function(e){
      if(e.target.dataset.expand){e.stopPropagation();openBrandModal(e.target.dataset.expand);return;}
      var slug = el.dataset.brand;
      INDEX.brands.forEach(function(b){
        if(b.slug===slug){ACTIVE_BRANDS.add(slug); if(!BRAND_DATA[slug]) loadBrand(slug);}
        else{ACTIVE_BRANDS.delete(b.slug);}
      });
      document.querySelectorAll('.hr-bchip').forEach(function(c){c.classList.toggle('on', c.dataset.brand===slug);});
      invalidateRadiusCache();
      scheduleRender();
      updateBrandStatus();
      document.getElementById('hr-map').scrollIntoView({behavior:'smooth',block:'center'});
    });
  });
}

function initMap(){
  MAP = L.map('hr-map',{scrollWheelZoom:true,zoomControl:true,preferCanvas:true,tap:true,touchZoom:true}).setView([39.8283,-98.5795],4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(MAP);
  CLUSTER = L.markerClusterGroup({showCoverageOnHover:false,maxClusterRadius:70,chunkedLoading:true,chunkInterval:200,chunkDelay:10,removeOutsideVisibleBounds:true});
  MAP.addLayer(CLUSTER);
  // No moveend re-render: the working set is state-driven (chips + USER_LL + filters + radius),
  // so zoom/pan does not change counts and does not need to rebuild markers. Leaflet's cluster
  // handles cluster expansion/contraction on its own.
  MAP.on('popupopen',function(){POPUP_OPEN=true;});
  MAP.on('popupclose',function(){POPUP_OPEN=false;});
}

function autoLocate(){
  if(!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(function(pos){ setUserLL([pos.coords.latitude,pos.coords.longitude]); },function(){},{maximumAge:600000,timeout:5000});
}

function makeIcon(color,ring){
  return L.divIcon({className:'hr-pin',
    html:'<div style="width:20px;height:20px;border-radius:50%;background:'+color+';border:3px solid '+ring+';box-shadow:0 2px 6px rgba(0,0,0,.35)"></div>',
    iconSize:[20,20], iconAnchor:[10,10]});
}

function brandMetaByName(name){
  for(var i=0;i<INDEX.brands.length;i++) if(INDEX.brands[i].name===name) return INDEX.brands[i];
  var m = BRAND_META[name]; if(m) return {name:name,slug:m.slug,color:m.color,ring:m.ring,emoji:m.emoji};
  return {color:'#262626',ring:'#ECE70F',slug:'other',emoji:'*'};
}

function matchesFilter(x,ignoreBrand){
  if(!ignoreBrand){
    var meta = brandMetaByName(x.b);
    if(!ACTIVE_BRANDS.has(meta.slug)) return false;
  }
  if(USER_LL && RADIUS_MI < 100){
    if(hav(USER_LL[0],USER_LL[1],x.lat,x.lng) > RADIUS_MI) return false;
  }
  var favKey = x.id || (x.b+'|'+x.lat+'|'+x.lng);
  var it = STATUS_FILTERS.values(), next = it.next();
  while(!next.done){
    var f = next.value; next = it.next();
    if(f==='favs' && !FAVS.has(favKey)) return false;
    if(f==='open' && !isOpenNow(x.h)) return false;
    if(f==='sun'){var p=parseHoursString(x.h); if(!p.Su) return false;}
    if(f==='late'){var p2=parseHoursString(x.h); var t=p2[todayPrefix()]; if(!t || t.end<19*60) return false;}
    if(f==='early'){var p3=parseHoursString(x.h); var t2=p3[todayPrefix()]; if(!t2 || t2.start>9*60) return false;}
  }
  return true;
}

function popupHtml(x){
  var meta = brandMetaByName(x.b);
  var open = isOpenNow(x.h);
  var badgeCls = open ? 'open' : 'closed';
  var statusTxt = todayHoursLabel(x.h);
  var addrParts = [x.a, x.c, x.s, x.z].filter(Boolean);
  var addr = addrParts.length ? addrParts.join(', ') : '';
  var q = x.lat+','+x.lng;
  var favKey = x.id || (x.b+'|'+x.lat+'|'+x.lng);
  var fav = FAVS.has(favKey);
  var subBrand = x.sb ? ' <span style="color:var(--soft);font-weight:500">('+esc(x.sb)+')</span>' : '';
  return '<div class="hr-pop">'+
    '<div class="hr-pop-head">'+
      '<h4>'+meta.emoji+' '+esc(x.b||'Return Bar')+subBrand+'</h4>'+
      '<div class="hr-pop-actions">'+
        '<button class="hr-pop-fav '+(fav?'on':'')+'" data-fav="'+esc(favKey)+'" title="Save to favorites" type="button">'+(fav?'&hearts;':'&#9825;')+'</button>'+
        '<button class="hr-pop-close" data-close-popup="1" title="Close" type="button" aria-label="Close">&times;</button>'+
      '</div>'+
    '</div>'+
    '<span class="hr-pop-badge '+badgeCls+'">'+esc(statusTxt)+'</span>'+
    (addr?'<div class="hr-pop-line"><b>📍</b> '+esc(addr)+'</div>':'')+
    (x.p?'<div class="hr-pop-line"><b>📞</b> <a href="tel:'+esc(String(x.p).replace(/[^\d+]/g,''))+'">'+esc(x.p)+'</a></div>':'')+
    (x.h?'<div class="hr-pop-line"><b>🕐</b> This week:<br><span style="color:var(--mute);font-size:11.5px;display:block;margin-top:4px">'+humanAllHours(x.h)+'</span></div>':'')+
    (x.d?'<div class="hr-pop-line"><b>💡</b> '+esc(x.d)+'</div>':'')+
    '<div class="hr-pop-btns">'+
      '<a class="hr-pop-btn" href="https://www.google.com/maps/dir/?api=1&destination='+q+'" target="_blank" rel="noopener">Google</a>'+
      '<a class="hr-pop-btn am" href="https://maps.apple.com/?daddr='+q+'" target="_blank" rel="noopener">Apple</a>'+
      '<a class="hr-pop-btn wz" href="https://waze.com/ul?ll='+q+'&navigate=yes" target="_blank" rel="noopener">Waze</a>'+
      (x.p?'<a class="hr-pop-btn call" href="tel:'+esc(String(x.p).replace(/[^\d+]/g,''))+'">Call</a>':'<span></span>')+
    '</div>'+
  '</div>';
}

function scheduleRender(){
  if(RENDER_TIMER) clearTimeout(RENDER_TIMER);
  RENDER_TIMER = setTimeout(function(){ if(POPUP_OPEN){RENDER_TIMER=null;return;} renderMap(); },25);
}

function buildRadiusCache(){
  if(!USER_LL){RADIUS_CACHE={items:null,ll:null,radius:null};return;}
  RADIUS_CACHE.ll = USER_LL; RADIUS_CACHE.radius = RADIUS_MI;
  var u0=USER_LL[0],u1=USER_LL[1],r=RADIUS_MI;
  var items = [];
  var seen = {};
  ACTIVE_BRANDS.forEach(function(slug){
    var rows = BRAND_DATA[slug]; if(!rows) return;
    for(var i=0;i<rows.length;i++){
      var x = rows[i];
      if(hav(u0,u1,x.lat,x.lng) <= r){ if(!seen[x.id]){seen[x.id]=1; items.push(x);} }
    }
  });
  RADIUS_CACHE.items = items;
}
function invalidateRadiusCache(){RADIUS_CACHE.ll=null;}
function radiusCacheValid(){return RADIUS_CACHE.ll===USER_LL && RADIUS_CACHE.radius===RADIUS_MI;}

// Build the "working set" of pins for the current state.
// Two cases (strict — no mixing of featured with chip-selected brands):
//   A. No chips → show only the 204 FEATURED preview
//   B. Chip(s) on → show ONLY the selected brands' pins (no featured, no other brands)
//      + if USER_LL is set, filter those pins to within RADIUS_MI
// Counter stays stable as the user zooms/pans.
function buildWorkingSet(){
  var out = [];
  var usedIds = {};
  if(ACTIVE_BRANDS.size === 0){
    // State A: default preview — the 204 featured pins, hydrated with full data if brands are loaded
    for(var k=0;k<FEATURED.length;k++){
      var f = FEATURED[k];
      if(usedIds[f.id]) continue;
      usedIds[f.id]=1;
      out.push(hydrateFeatured(f));
    }
    return out;
  }
  // State B: only the selected brand(s), filtered by radius if the user has a location
  ACTIVE_BRANDS.forEach(function(slug){
    var rows = BRAND_DATA[slug]; if(!rows) return;
    for(var i=0;i<rows.length;i++){
      var r = rows[i];
      if(USER_LL && RADIUS_MI<100 && hav(USER_LL[0],USER_LL[1],r.lat,r.lng) > RADIUS_MI) continue;
      if(usedIds[r.id]) continue;
      usedIds[r.id]=1;
      out.push(r);
    }
  });
  return out;
}

function isPreviewMode(){ return ACTIVE_BRANDS.size === 0 && !USER_LL; }

function renderMap(){
  if(!CLUSTER) return;
  CLUSTER.clearLayers();
  var ws = buildWorkingSet();
  var preview = isPreviewMode();
  var markers = [];
  for(var i=0;i<ws.length;i++){
    var y = ws[i];
    if(preview){
      // Preview = unfiltered national overview; only the favorites filter still applies
      if(STATUS_FILTERS.has('favs')){
        var fk = y.id || (y.b+'|'+y.lat+'|'+y.lng);
        if(!FAVS.has(fk)) continue;
      }
    } else {
      // Live state — apply status/open/sun/late/early/favs filters (chip + radius already baked into ws)
      if(!matchesFilter(y, true)) continue;
    }
    markers.push(makeMarker(y));
  }
  CLUSTER.addLayers(markers,{chunkedLoading:true});
  updateCounters(ws);
  renderResultsList();
}

function hydrateFeatured(x){
  // If brand data for this row is already in memory, upgrade the featured stub to the full row
  if(x && x.h) return x; // already has hours → already a full row
  var meta = brandMetaByName(x.b);
  var rows = BRAND_DATA[meta.slug];
  if(!rows) return x; // brand not yet loaded; show basic popup
  for(var i=0;i<rows.length;i++){ if(rows[i].id === x.id) return rows[i]; }
  return x;
}

function makeMarker(x){
  var meta = brandMetaByName(x.b);
  var open = isOpenNow(x.h);
  var ring = open ? '#DCFCE7' : (meta.ring||'#FEE2E2');
  var mk = L.marker([x.lat,x.lng],{icon:makeIcon(meta.color, ring)});
  (function(item,m){
    m.on('click',function(){
      MAP.closePopup();
      // Re-hydrate at click time: if the brand file arrived AFTER the marker was placed, upgrade now
      var full = hydrateFeatured(item);
      var mapW = MAP.getSize().x;
      var mw = Math.min(mapW-80, window.innerWidth<600?280:340);
      if(m.getPopup()){ m.unbindPopup(); }
      m.bindPopup(popupHtml(full),{maxWidth:mw,minWidth:220,autoPan:true,autoPanPadding:[40,60],keepInView:true,closeButton:false,autoClose:false,closeOnClick:false});
      m.openPopup();
    });
  })(x,mk);
  return mk;
}

function updateCounters(ws){
  // Counter is bound to the working set (not the viewport). It stays stable while the user
  // zooms or pans; only chip toggles, status filters, location/search, or radius change it.
  if(!ws) ws = buildWorkingSet();
  var preview = isPreviewMode();
  var openFilterOn = STATUS_FILTERS.has('open');
  var shown = 0, open = 0;
  for(var i=0;i<ws.length;i++){
    var y = ws[i];
    if(preview){
      // Preview: pins never drop by Open Now — the Open Now chip is a display toggle here.
      if(STATUS_FILTERS.has('favs')){
        var fk = y.id || (y.b+'|'+y.lat+'|'+y.lng);
        if(!FAVS.has(fk)) continue;
      }
    } else {
      if(!matchesFilter(y, true)) continue;
    }
    shown++;
    if(y.h && isOpenNow(y.h)) open++;
  }
  var el1 = document.getElementById('hr-cnt-shown'), el2 = document.getElementById('hr-cnt-open');
  if(el1) el1.textContent = shown.toLocaleString();
  if(el2) el2.textContent = open.toLocaleString();
  // Hide the "N open right now · " segment when the Open Now chip is OFF
  var openWrap = document.getElementById('hr-cnt-open-wrap');
  if(openWrap) openWrap.style.display = openFilterOn ? '' : 'none';
}

function renderResultsList(){
  var wrap = document.getElementById('hr-results');
  var list = document.getElementById('hr-results-list');
  if(!wrap || !list || !MAP) return;
  if(!USER_LL){wrap.style.display='none'; return;}
  wrap.style.display='';
  var items = [];
  if(!radiusCacheValid()) buildRadiusCache();
  var ws = RADIUS_CACHE.items || [];
  for(var i=0;i<ws.length;i++){var x=ws[i]; if(!matchesFilter(x)) continue; items.push({x:x, dist: hav(USER_LL[0],USER_LL[1],x.lat,x.lng)});}
  var sortMode = document.getElementById('hr-sort').value;
  if(sortMode==='name') items.sort(function(a,b){return (a.x.b||'').localeCompare(b.x.b||'');});
  else items.sort(function(a,b){return a.dist-b.dist;});
  var capped = items.slice(0,100);
  document.getElementById('hr-results-count').textContent = items.length.toLocaleString() + (items.length>100?' (showing nearest 100)':'');
  document.getElementById('hr-results-area').textContent = 'within '+RADIUS_MI+' mi of '+(CURRENT_AREA||'your location');
  if(!capped.length){list.innerHTML = '<div class="hr-result-empty">No Return Bars match the current filters. Widen the radius, remove a filter, or hit Reset.</div>'; return;}
  list.innerHTML = capped.map(renderResultCard).join('');
}

function renderResultCard(it){
  var x = it.x;
  var meta = brandMetaByName(x.b);
  var open = isOpenNow(x.h);
  var badge = open ? 'OPEN' : 'CLOSED';
  var badgeCls = open ? 'open' : 'closed';
  var addr = [x.a, x.c].filter(Boolean).join(', ') || x.c || '';
  var dist = it.dist.toFixed(1)+' mi away';
  var hrsLabel = todayHoursLabel(x.h);
  var gm = 'https://www.google.com/maps/search/?api=1&query='+x.lat+','+x.lng;
  var am = 'https://maps.apple.com/?daddr='+x.lat+','+x.lng;
  var wz = 'https://waze.com/ul?ll='+x.lat+','+x.lng+'&navigate=yes';
  var callBtn = x.p ? '<a class="hr-result-btn call" href="tel:'+esc(String(x.p).replace(/[^\d+]/g,''))+'">Call</a>' : '<a class="hr-result-btn wz" href="'+wz+'" target="_blank" rel="noopener">Waze</a>';
  return '<div class="hr-result-item">'+
    '<div class="hr-result-head"><div class="hr-result-name">'+meta.emoji+' '+esc(x.b||'')+(x.sb?' <span style="color:var(--soft);font-weight:500;font-size:12px">('+esc(x.sb)+')</span>':'')+'</div><span class="hr-result-badge '+badgeCls+'">'+badge+'</span></div>'+
    '<div class="hr-result-addr">'+esc(addr)+'</div>'+
    '<div class="hr-result-meta"><b>'+esc(dist)+'</b> &middot; '+esc(hrsLabel)+(x.p?' &middot; '+esc(x.p):'')+'</div>'+
    '<div class="hr-result-btns">'+
      '<a class="hr-result-btn" href="'+gm+'" target="_blank" rel="noopener">Maps</a>'+
      '<a class="hr-result-btn am" href="'+am+'" target="_blank" rel="noopener">Apple</a>'+
      callBtn+
    '</div>'+
  '</div>';
}

function renderCityGrid(){
  var g = document.getElementById('hr-city-grid');
  if(!g) return;
  var all = allLoadedItems();
  var byCity = {};
  for(var i=0;i<all.length;i++){var x=all[i]; if(!x.c||!x.s) continue; var k=x.c+', '+x.s; if(!byCity[k]) byCity[k]={count:0,lat:x.lat,lng:x.lng}; byCity[k].count++;}
  var cities = Object.keys(byCity).sort(function(a,b){return byCity[b].count-byCity[a].count;}).slice(0,24);
  var emojis = {NY:'NY',CA:'CA',TX:'TX',IL:'IL',FL:'FL',GA:'GA',NV:'NV',AZ:'AZ',WA:'WA',CO:'CO',MA:'MA',PA:'PA',OH:'OH',MD:'MD',OR:'OR',MN:'MN',TN:'TN',MO:'MO',NC:'NC',MI:'MI'};
  g.innerHTML = cities.map(function(name){
    var d = byCity[name]; var st = (name.split(', ')[1]||'').trim(); var em = emojis[st]||'US';
    return '<div class="hr-city" data-lat="'+d.lat+'" data-lng="'+d.lng+'" data-name="'+esc(name)+'">'+
      '<h4>'+em+' '+esc(name)+'</h4>'+
      '<div class="hr-cnt-sm">'+d.count.toLocaleString()+' Return Bars</div>'+
      '<div class="hr-pick">Tap to zoom map here</div></div>';
  }).join('');
  g.querySelectorAll('.hr-city').forEach(function(el){
    el.addEventListener('click',function(){
      var lat=+el.dataset.lat, lng=+el.dataset.lng, name=el.dataset.name;
      if(MAP && !isNaN(lat) && !isNaN(lng)){ CURRENT_AREA=name; setUserLL([lat,lng]); document.getElementById('hr-map').scrollIntoView({behavior:'smooth',block:'center'}); }
    });
  });
}

function setUserLL(ll){
  USER_LL = ll;
  // Breakfast model: as soon as the user has a location, activate all brands (if none active yet)
  if(ACTIVE_BRANDS.size === 0 && INDEX.brands && INDEX.brands.length){
    ACTIVE_BRANDS = new Set(INDEX.brands.map(function(b){return b.slug;}));
    document.querySelectorAll('.hr-bchip').forEach(function(c){c.classList.add('on');});
    updateBrandStatus();
  }
  invalidateRadiusCache();
  if(USER_MARKER) MAP.removeLayer(USER_MARKER);
  USER_MARKER = L.circleMarker(ll,{radius:9,color:'#262626',fillColor:'#ECE70F',fillOpacity:1,weight:3}).addTo(MAP).bindPopup('Your location');
  var z = RADIUS_MI<=5?13 : RADIUS_MI<=15?12 : RADIUS_MI<=30?11 : RADIUS_MI<=50?10 : RADIUS_MI<=100?9 : 8;
  MAP.setView(ll,z);
  setTimeout(function(){if(MAP) MAP.invalidateSize();},200);
  var nudge = document.getElementById('hr-nudge'); if(nudge) nudge.style.display='none';
  // Ensure all brand data is loaded for radius search
  loadAllBrands().then(function(){ invalidateRadiusCache(); scheduleRender(); });
  scheduleRender();
}

function openBrandModal(slug){
  var brand = null;
  for(var i=0;i<INDEX.brands.length;i++) if(INDEX.brands[i].slug===slug){brand=INDEX.brands[i];break;}
  if(!brand) return;
  var modal = document.getElementById('hr-brand-modal');
  document.getElementById('hr-brand-modal-title').innerHTML = brand.emoji+' '+esc(brand.name)+' <span style="color:var(--black);background:var(--yellow);padding:2px 8px;border-radius:4px">&middot; '+brand.count.toLocaleString()+' US bars</span>';
  document.getElementById('hr-brand-modal-meta').textContent = 'Scrollable list of every '+brand.name+' Return Bar. Filter by city, state or ZIP.';
  var list = document.getElementById('hr-brand-modal-list');
  list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--mute)"><span class="hr-loader"></span>Loading '+brand.count.toLocaleString()+' locations...</div>';
  modal.classList.add('on');
  loadBrand(slug).then(function(rows){
    rows = rows || [];
    function render(filter){
      var fil = (filter||'').toLowerCase().trim();
      var f = fil ? rows.filter(function(x){return ((x.a||'')+' '+(x.c||'')+' '+(x.s||'')+' '+(x.z||'')).toLowerCase().indexOf(fil)>=0;}) : rows;
      var top = f.slice(0,300);
      list.innerHTML = top.map(function(x){
        var q = x.lat+','+x.lng;
        return '<div class="hr-loc-item">'+
          '<div style="flex:1;min-width:0">'+
            '<b>'+esc(x.c||'')+', '+esc(x.s||'')+' '+esc(x.z||'')+'</b>'+
            '<div style="color:var(--mute);font-size:12px;margin-top:2px">'+esc(x.a||'')+'</div>'+
            (x.p?'<div style="color:var(--black);font-size:12px;margin-top:2px">'+esc(x.p)+'</div>':'')+
          '</div>'+
          '<div class="hr-loc-btns">'+
            '<a href="https://www.google.com/maps/dir/?api=1&destination='+q+'" target="_blank" rel="noopener">Directions</a>'+
            (x.p?'<a class="call" href="tel:'+esc(String(x.p).replace(/[^\d+]/g,''))+'">Call</a>':'')+
          '</div>'+
        '</div>';
      }).join('') + (f.length>300?'<div style="text-align:center;color:var(--soft);padding:10px;font-size:12px">...and '+(f.length-300).toLocaleString()+' more. Use the filter box above to narrow.</div>' : (f.length===0?'<div style="text-align:center;color:var(--soft);padding:14px">No locations match.</div>':''));
    }
    render('');
    document.getElementById('hr-brand-modal-filter').oninput = function(e){render(e.target.value);};
  });
}

function runTrip(){
  var out = document.getElementById('hr-trip-results');
  var s = document.getElementById('hr-trip-start').value.trim();
  var e = document.getElementById('hr-trip-end').value.trim();
  var d = +document.getElementById('hr-trip-detour').value;
  if(!s || !e){out.innerHTML='<div style="color:var(--red);font-weight:700">Enter both start and end cities.</div>'; return;}
  out.innerHTML = '<div><span class="hr-loader"></span>Geocoding...</div>';
  // Trip planner needs all brand data for accurate route-detour search
  Promise.all([geocode(s), geocode(e), loadAllBrands()]).then(function(pts){
    var A = pts[0], B = pts[1];
    var all = allLoadedItems();
    function detour(x){
      var d12 = hav(A[0],A[1],B[0],B[1]); if(d12<1) return 9999;
      var t = ((x.lat-A[0])*(B[0]-A[0]) + (x.lng-A[1])*(B[1]-A[1])) / (Math.pow(B[0]-A[0],2)+Math.pow(B[1]-A[1],2));
      if(t<0||t>1) return 9999;
      var pLat = A[0]+t*(B[0]-A[0]), pLng = A[1]+t*(B[1]-A[1]);
      return hav(x.lat,x.lng, pLat,pLng);
    }
    var hits = all.map(function(x){return {x:x, d:detour(x)};}).filter(function(c){return c.d<=d;}).sort(function(a,b){return a.d-b.d;}).slice(0,15);
    if(!hits.length){out.innerHTML='<div style="color:var(--mute)">No Return Bars within '+d+' miles of that route. Widen tolerance and try again.</div>';return;}
    out.innerHTML = hits.map(function(c){
      var meta = brandMetaByName(c.x.b); var q = c.x.lat+','+c.x.lng;
      return '<div class="hr-trip-item">'+
        '<span><b>'+meta.emoji+' '+esc(c.x.b||'')+'</b><br><span style="color:var(--mute);font-size:12px">'+esc(c.x.c||'')+', '+esc(c.x.s||'')+' &middot; '+c.d.toFixed(1)+' mi detour</span></span>'+
        '<a class="hr-pop-btn" style="padding:5px 10px" href="https://www.google.com/maps/dir/?api=1&destination='+q+'" target="_blank" rel="noopener">Go</a>'+
      '</div>';
    }).join('');
  }).catch(function(err){out.innerHTML='<div style="color:var(--red);font-weight:700">Geocode failed: '+esc(err.message)+'</div>';});
}

function startClock(){
  var el = document.getElementById('hr-clock');
  function tick(){if(el) el.textContent = fmtClock();}
  tick(); setInterval(tick,30000);
  setInterval(function(){scheduleRender();}, 60000);
}

function wireControls(){
  // Safe helper: attach a handler only if the target exists. Brand/retailer pages
  // omit optional widgets (trip modal, deadline tracker, etc.) so hr-site.js must
  // not crash on a missing element.
  function on(id, ev, fn){ var el = typeof id === 'string' ? document.getElementById(id) : id; if(el) el.addEventListener(ev, fn); }
  document.querySelectorAll('#hr-filters-status .hr-fchip').forEach(function(el){
    el.addEventListener('click',function(){
      var f = el.dataset.f;
      if(STATUS_FILTERS.has(f)){STATUS_FILTERS.delete(f); el.classList.remove('on');}
      else{STATUS_FILTERS.add(f); el.classList.add('on');}
      scheduleRender();
    });
  });
  on('hr-sort','change',function(){scheduleRender();});
  on('hr-radius','input',function(e){
    RADIUS_MI = +e.target.value;
    var lbl=document.getElementById('hr-radius-lbl'); if(lbl) lbl.textContent = RADIUS_MI+' mi';
    invalidateRadiusCache(); scheduleRender();
  });
  on('hr-btn-clear','click',function(){
    STATUS_FILTERS = new Set(['open']);
    RADIUS_MI = 25;
    var r=document.getElementById('hr-radius'); if(r) r.value = 25;
    var rl=document.getElementById('hr-radius-lbl'); if(rl) rl.textContent = '25 mi';
    document.querySelectorAll('#hr-filters-status .hr-fchip').forEach(function(x){x.classList.toggle('on', x.dataset.f==='open');});
    ACTIVE_BRANDS = new Set();
    document.querySelectorAll('.hr-bchip').forEach(function(c){c.classList.remove('on');});
    if(USER_MARKER){MAP.removeLayer(USER_MARKER); USER_MARKER=null;}
    USER_LL = null; CURRENT_AREA = null;
    var li=document.getElementById('hr-loc-input'); if(li) li.value='';
    if(MAP) MAP.setView([39.8283,-98.5795],4);
    var nd = document.getElementById('hr-nudge'); if(nd) nd.style.display='';
    var rs=document.getElementById('hr-results'); if(rs) rs.style.display='none';
    invalidateRadiusCache(); updateBrandStatus(); scheduleRender();
  });
  on('hr-btn-geo','click',function(){
    if(!navigator.geolocation){alert('Geolocation not supported');return;}
    navigator.geolocation.getCurrentPosition(function(pos){ CURRENT_AREA='your location'; setUserLL([pos.coords.latitude,pos.coords.longitude]); },function(e){alert('Location denied: '+e.message);});
  });
  var _seq = 0;
  on('hr-btn-search','click',function(){
    var inp=document.getElementById('hr-loc-input'); if(!inp) return;
    var q = inp.value.trim(); if(!q) return;
    var mySeq = ++_seq;
    geocode(q).then(function(ll){if(mySeq!==_seq) return; CURRENT_AREA = q; setUserLL(ll);})
              .catch(function(e){if(mySeq!==_seq) return; alert('Search failed: '+e.message);});
  });
  on('hr-loc-input','keydown',function(e){if(e.key==='Enter'){var btn=document.getElementById('hr-btn-search'); if(btn) btn.click();}});
  on('hr-btn-fs','click',function(){
    var el = document.getElementById('hr-map');
    if(!document.fullscreenElement){if(el && el.requestFullscreen) el.requestFullscreen();}
    else{document.exitFullscreen();}
    setTimeout(function(){if(MAP) MAP.invalidateSize();},300);
  });
  on('hr-btn-trip','click',function(){var m=document.getElementById('hr-trip-modal'); if(m) m.classList.add('on');});
  on('hr-trip-go','click',runTrip);
  on('hr-b-all','click',function(){
    ACTIVE_BRANDS = new Set(INDEX.brands.map(function(b){return b.slug;}));
    document.querySelectorAll('.hr-bchip').forEach(function(c){c.classList.add('on');});
    invalidateRadiusCache(); updateBrandStatus(); scheduleRender();
  });
  on('hr-b-none','click',function(){
    ACTIVE_BRANDS = new Set();
    document.querySelectorAll('.hr-bchip').forEach(function(c){c.classList.remove('on');});
    invalidateRadiusCache(); updateBrandStatus(); scheduleRender();
  });
  document.querySelectorAll('[data-close]').forEach(function(el){el.addEventListener('click',function(){el.closest('.hr-modal').classList.remove('on');});});
  document.querySelectorAll('.hr-modal').forEach(function(m){m.addEventListener('click',function(e){if(e.target===m) m.classList.remove('on');});});
  document.body.addEventListener('click',function(e){
    var t = e.target;
    if(t && t.dataset && t.dataset.fav){
      var k = t.dataset.fav;
      if(FAVS.has(k)){FAVS.delete(k); t.classList.remove('on'); t.textContent='♡';}
      else{FAVS.add(k); t.classList.add('on'); t.textContent='♥';}
      saveFavs();
    }
    if(t && t.dataset && t.dataset.closePopup && MAP) MAP.closePopup();
  });
}

function waitLeaflet(){
  if(typeof L==='undefined' || typeof L.markerClusterGroup==='undefined'){return setTimeout(waitLeaflet,100);}
  boot();
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',waitLeaflet);
else waitLeaflet();
})();
