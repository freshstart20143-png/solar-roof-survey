// 光電屋頂探勘：畫面與操作（不呼叫任何 Google API，資料只存在這支手機）
(function () {
'use strict';
const E = window.SolarEval;
const $ = id => document.getElementById(id);
const IN_APP = location.host === 'appassets.androidplatform.net';
const EASYMAP = 'https://easymap.moi.gov.tw/Z10Web/Normal';
const REGIONS = E.REGIONS;

// ---------- 本機儲存 ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('手機儲存空間不足，請到設定清除舊資料'); } }
};
const saved = store.get('ss_settings', {});
const D = E.DEFAULTS;
const settings = {
  base: saved.base === 'emap' ? 'emap' : 'photo',
  defRegion: REGIONS.indexOf(saved.defRegion) >= 0 ? saved.defRegion : '新竹',
  coverage: saved.coverage > 0 ? saved.coverage : D.coverage,
  minRoofPing: saved.minRoofPing != null ? saved.minRoofPing : D.minRoofPing,
  minKw: saved.minKw != null ? saved.minKw : D.minKw,
  panelW: saved.panelW > 0 ? saved.panelW : D.panelW,
  sun: Object.assign({}, D.sun, saved.sun || {}),
  rates: Array.isArray(saved.rates) && saved.rates.length === 6 ? saved.rates : D.rates.slice(),
  nearMargin: D.nearMargin
};
// 只保留手動劃的屋頂
let buildings = {};
for (const [id, b] of Object.entries(store.get('ss_buildings', {}))) if (b && b.poly && !b.parent) buildings[id] = b;
let flags = store.get('ss_flags', {});
const saveAll = () => { store.set('ss_buildings', buildings); store.set('ss_flags', flags); };
const saveSettings = () => store.set('ss_settings', settings);

const fmt = (n, d) => (n || 0).toLocaleString('zh-TW', { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 });
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// ---------- 地圖（可旋轉、不能傾斜） ----------
function tileUrl(layer) {
  return IN_APP ? `https://appassets.androidplatform.net/tile/${layer}/{z}/{y}/{x}`
    : `https://wmts.nlsc.gov.tw/wmts/${layer}/default/GoogleMapsCompatible/{z}/{y}/{x}`;
}
const lastView = store.get('ss_view', null);
let map;
try {
  map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: {
        photo: { type: 'raster', tiles: [tileUrl('PHOTO2')], tileSize: 256, maxzoom: 19, attribution: '內政部國土測繪中心' },
        emap: { type: 'raster', tiles: [tileUrl('EMAP')], tileSize: 256, maxzoom: 19, attribution: '內政部國土測繪中心' }
      },
      layers: [
        { id: 'photo', type: 'raster', source: 'photo', layout: { visibility: settings.base === 'emap' ? 'none' : 'visible' } },
        { id: 'emap', type: 'raster', source: 'emap', layout: { visibility: settings.base === 'emap' ? 'visible' : 'none' } }
      ]
    },
    center: lastView ? [lastView[1], lastView[0]] : [121.05, 24.75],
    zoom: lastView ? lastView[2] : 11,
    bearing: lastView ? (lastView[3] || 0) : 0,
    minZoom: 6, maxZoom: 21, maxPitch: 0, pitchWithRotate: false, touchPitch: false,
    attributionControl: { compact: true }
  });
} catch (e) {
  // 有些預覽視窗不允許地圖在背景運作
  document.body.innerHTML = '<div style="padding:40px 24px;font-size:17px;line-height:1.7;color:var(--ink)"><b>這裡無法顯示地圖</b><br>' +
    '請把這個檔案下載到手機，用 <b>Chrome</b> 打開。<br><span style="font-size:13px;color:var(--muted)">（' + esc(String(e && e.message || e).slice(0, 120)) + '）</span></div>';
  return;
}
map.touchZoomRotate.enableRotation();
map.on('moveend', () => { const c = map.getCenter(); store.set('ss_view', [c.lat, c.lng, map.getZoom(), map.getBearing()]); });
const updateCompass = () => { $('needle').style.transform = `rotate(${-map.getBearing()}deg)`; };
map.on('rotate', updateCompass);
$('compass').onclick = () => map.easeTo({ bearing: 0, duration: 400 });
updateCompass();

// 圖層在地圖樣式一讀好就加上，不等空拍圖磚下載完，
// 這樣網路慢的時候劃屋頂也看得到填色和邊線
const EMPTY = { type: 'FeatureCollection', features: [] };
let mapReady = false;
function setupLayers() {
  if (mapReady) return;
  mapReady = true;
  map.addSource('res', { type: 'geojson', data: EMPTY });
  map.addSource('pts', { type: 'geojson', data: EMPTY });
  map.addSource('draw', { type: 'geojson', data: EMPTY });
  map.addLayer({ id: 'res-fill', type: 'fill', source: 'res', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'op'] } });
  map.addLayer({ id: 'res-line', type: 'line', source: 'res', paint: { 'line-color': ['get', 'color'], 'line-width': 2 } });
  map.addLayer({ id: 'draw-fill', type: 'fill', source: 'draw', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': css('--draw'), 'fill-opacity': 0.4 } });
  map.addLayer({ id: 'draw-line', type: 'line', source: 'draw', paint: { 'line-color': css('--draw'), 'line-width': 3 } });
  map.addLayer({ id: 'pts', type: 'circle', source: 'pts', paint: {
    'circle-color': ['get', 'color'], 'circle-radius': ['get', 'r'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
  render();
  if (draw) updateDraw();
}
if (map.isStyleLoaded()) setupLayers(); else map.once('style.load', setupLayers);
map.once('load', setupLayers);

const COLORS = { pass: '--pass', near: '--near', fail: '--fail', flag: '--flag' };
const LABELS = { pass: '符合', near: '接近', fail: '不符', flag: '疑似頂加' };
const show = Object.assign({ pass: true, near: true, fail: true, flag: true }, store.get('ss_show', {}));

function statusOf(b) {
  const r = E.evaluate(b, settings);
  if (flags[b.id]) { r.status = 'flag'; r.reasons = ['已標記為疑似頂樓加蓋，排除']; }
  return r;
}

function render() {
  const counts = { pass: 0, near: 0, fail: 0, flag: 0 };
  const polys = [], pts = [];
  for (const id in buildings) {
    const b = buildings[id];
    const r = statusOf(b);
    counts[r.status]++;
    if (!show[r.status]) continue;
    const color = css(COLORS[r.status]);
    polys.push({ type: 'Feature', properties: { color, op: r.status === 'pass' ? 0.3 : 0.15 },
      geometry: { type: 'Polygon', coordinates: [b.poly.concat([b.poly[0]])] } });
    pts.push({ type: 'Feature', properties: { id, color, r: r.status === 'pass' ? 8 : 6 }, geometry: { type: 'Point', coordinates: [b.lng, b.lat] } });
  }
  if (mapReady) {
    map.getSource('res').setData({ type: 'FeatureCollection', features: polys });
    map.getSource('pts').setData({ type: 'FeatureCollection', features: pts });
  }
  const lg = $('legend'); lg.innerHTML = '';
  for (const k of ['pass', 'near', 'fail', 'flag']) {
    const c = document.createElement('button');
    c.className = 'chip' + (show[k] ? '' : ' off');
    c.innerHTML = `<i style="background:var(${COLORS[k]})"></i>${LABELS[k]} <b>${counts[k]}</b>`;
    c.onclick = () => { show[k] = !show[k]; store.set('ss_show', show); render(); };
    lg.appendChild(c);
  }
}

// ---------- 底部抽屜與提示 ----------
let sheetView = null;
function openSheet(title, html, view) {
  sheetView = view || null;
  hideHint();
  $('sheetTitle').textContent = title; $('sheetBody').innerHTML = html; $('sheet').hidden = false;
}
function closeSheet() { $('sheet').hidden = true; sheetView = null; }
$('sheetClose').onclick = closeSheet;

let toastTimer;
function hideHint() { clearTimeout(toastTimer); $('hint').hidden = true; }
function toast(t, ms) {
  const h = $('hint'); h.textContent = t; h.hidden = false;
  clearTimeout(toastTimer); if (ms !== 0) toastTimer = setTimeout(() => { h.hidden = true; }, ms || 3000);
}
function copyText(t, done) {
  const ok = () => toast(done || '已複製', 5000);
  try { if (window.Android && window.Android.copy) { window.Android.copy(t); ok(); return; } } catch (e) {}
  try { if (navigator.clipboard) { navigator.clipboard.writeText(t).then(ok, () => toast(t, 8000)); return; } } catch (e) {}
  toast(t, 8000);
}

// ---------- 屋頂估算 ----------
function showDetail(id) {
  const b = buildings[id]; if (!b) return;
  const r = statusOf(b), m = r.metrics, f = r.fin;
  const nav = `https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lng}&travelmode=driving`;
  const sat = `https://www.google.com/maps/@?api=1&map_action=map&center=${b.lat},${b.lng}&zoom=20&basemap=satellite`;
  openSheet('屋頂估算', `
    <span class="status st-${r.status}">${LABELS[r.status]}</span>
    ${r.reasons.length ? '<ul class="reasons">' + r.reasons.map(x => `<li>${esc(x)}</li>`).join('') + '</ul>' : ''}
    <div class="form">
      <label for="fAddr">地址（自己填，查地籍時會用到）</label>
      <input id="fAddr" type="text" value="${esc(b.addr || '')}" placeholder="例：新竹縣湖口鄉榮光一路277號">
      <label>所在地區（決定日照時數）</label>
      <div class="basepick">${REGIONS.map(g => `<button data-g="${g}" class="${r.sun.region === g ? 'on' : ''}">${g}</button>`).join('')}</div>
    </div>
    <div class="hero">
      <div class="stat"><div class="k">可裝容量（估計）</div><div class="v">${fmt(m.kw, 2)}<small>kW</small></div><div class="k">${m.panels} 片 × ${settings.panelW}W</div></div>
      <div class="stat"><div class="k">20 年平均每年售電</div><div class="v">${fmt(f.avgIncome)}<small>元</small></div><div class="k">躉購 ${f.rate} 元/度</div></div>
    </div>
    <div class="grid">
      <div class="stat"><div class="k">20 年平均每年發電</div><div class="v">${fmt(f.avgKwh)}<small>度</small></div></div>
      <div class="stat"><div class="k">躉購費率（${esc(f.tier)}）</div><div class="v">${f.rate}<small>元/度</small></div></div>
      <div class="stat"><div class="k">20 年累計發電</div><div class="v">${fmt(f.totalKwh)}<small>度</small></div></div>
      <div class="stat"><div class="k">20 年累計售電</div><div class="v">${fmt(f.totalIncome)}<small>元</small></div></div>
      <div class="stat"><div class="k">屋頂面積（劃的）</div><div class="v">${fmt(m.roofPing, 1)}<small>坪</small></div></div>
      <div class="stat"><label class="k" for="fFloors">登記樓層（查地籍後填）</label><input id="fFloors" type="number" inputmode="numeric" min="1" max="99" value="${b.floors || ''}" placeholder="例 3"></div>
    </div>
    <div class="meta">
      ${esc(r.sun.region)} 日照 ${r.sun.hours} 小時/天　每年衰退 0.6%<br>
      片數 = 屋頂面積 × 鋪設比例 ${Math.round(settings.coverage * 100)}% ÷ 每片面積。<b>沒有判斷遮蔭</b>，請自己看空拍確認有沒有被旁邊的樓擋住。僅供篩選參考，報價前請現場確認。
    </div>
    <div class="actions">
      <a class="btn primary" href="${nav}" target="_blank" rel="noopener">導航過去</a>
      <a class="btn" href="${sat}" target="_blank" rel="noopener">Google 空拍確認</a>
      <a class="btn" id="btnEasy" href="${EASYMAP}" target="_blank" rel="noopener">查地籍樓層</a>
      <button class="btn ${flags[id] ? '' : 'flag'}" id="btnFlag">${flags[id] ? '取消頂加標記' : '標記疑似頂加'}</button>
      <button class="btn danger full" id="btnDel">刪除這個屋頂</button>
    </div>`, 'detail:' + id);

  $('fAddr').onchange = () => { b.addr = $('fAddr').value.trim(); saveAll(); toast('已存地址'); };
  $('sheetBody').querySelectorAll('.basepick button').forEach(btn => btn.onclick = () => {
    b.addr = $('fAddr').value.trim();
    b.region = btn.dataset.g; settings.defRegion = b.region; saveSettings(); saveAll(); render(); showDetail(id);
  });
  $('fFloors').onchange = () => {
    const v = parseInt($('fFloors').value, 10);
    if (v > 0) b.floors = v; else delete b.floors;
    saveAll(); toast(v > 0 ? `已存：登記 ${v} 樓` : '已清除登記樓層');
  };
  $('btnEasy').onclick = () => {
    const a = $('fAddr').value.trim();
    if (a) { b.addr = a; saveAll(); copyText(a, '已複製地址，到地籍網站「門牌地址定位」貼上'); }
    else toast('還沒填地址，請在地籍網站手動輸入', 5000);
  };
  $('btnFlag').onclick = () => {
    b.addr = $('fAddr').value.trim();
    if (flags[id]) delete flags[id]; else flags[id] = true;
    saveAll(); render(); showDetail(id);
  };
  let armed = false;
  $('btnDel').onclick = () => {
    if (!armed) { armed = true; $('btnDel').textContent = '再按一次確認刪除'; return; }
    delete buildings[id]; delete flags[id]; saveAll(); render(); closeSheet(); toast('已刪除');
  };
}

// ---------- 劃屋頂 ----------
let draw = null;
function startDraw() {
  if (map.getZoom() < 17) { toast('請先把地圖放大到看得清楚一棟一棟的屋頂，再按「劃屋頂」', 5000); return; }
  if (draw) endDraw();
  closeSheet(); hideHint();
  draw = { pts: [], markers: [] };
  document.body.classList.add('drawing');
  $('drawPanel').hidden = false;
  updateDraw();
}
function addDrawPoint(ll) {
  const idx = draw.pts.length;
  draw.pts.push([ll.lng, ll.lat]);
  const el = document.createElement('div'); el.className = 'vertex';
  const mk = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(ll).addTo(map);
  mk.on('drag', () => { const q = mk.getLngLat(); draw.pts[idx] = [q.lng, q.lat]; updateDraw(); });
  draw.markers.push(mk);
  updateDraw();
}
function updateDraw() {
  const p = draw.pts;
  let data = EMPTY;
  // 點到第 3 個角起，中間就填滿
  if (p.length >= 3) data = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [p.concat([p[0]])] }, properties: {} };
  else if (p.length === 2) data = { type: 'Feature', geometry: { type: 'LineString', coordinates: p }, properties: {} };
  if (mapReady) map.getSource('draw').setData(data);
  $('drawArea').textContent = p.length >= 3 ? `已點 ${p.length} 個角　面積 ${fmt(E.polyAreaM2(p) / E.PING, 1)} 坪` : `已點 ${p.length} 個角`;
  $('drawDone').disabled = p.length < 3;
}
function endDraw() {
  draw.markers.forEach(m => m.remove());
  draw = null;
  if (mapReady) map.getSource('draw').setData(EMPTY);
  document.body.classList.remove('drawing');
  $('drawPanel').hidden = true;
}
$('drawUndo').onclick = () => { if (!draw.pts.length) return; draw.pts.pop(); draw.markers.pop().remove(); updateDraw(); };
$('drawCancel').onclick = () => endDraw();
$('drawDone').onclick = () => {
  const pts = draw.pts.slice();
  if (E.polyAreaM2(pts) / E.PING > 1000) { toast('劃出來超過 1,000 坪，不像一棟透天。請按「復原一點」重新點屋頂的角', 6000); return; }
  const c = E.centroid(pts);
  const id = 'm' + Date.now();
  buildings[id] = { id, manual: true, poly: pts, lng: c[0], lat: c[1], groundM2: E.polyAreaM2(pts), region: settings.defRegion, t: Date.now() };
  endDraw(); saveAll(); render(); showDetail(id);
};
$('btnDrawNew').onclick = () => startDraw();

map.on('click', ev => {
  if (draw) {
    const t = ev.originalEvent && ev.originalEvent.target;
    if (t && t.closest && t.closest('.vertex')) return;
    addDrawPoint(ev.lngLat); return;
  }
  const p = ev.point;
  const hits = mapReady ? map.queryRenderedFeatures([[p.x - 12, p.y - 12], [p.x + 12, p.y + 12]], { layers: ['pts'] }) : [];
  if (hits.length) { showDetail(hits[0].properties.id); return; }
  for (const id in buildings) {
    const b = buildings[id];
    if (E.pointInPoly(ev.lngLat.lng, ev.lngLat.lat, b.poly) && show[statusOf(b).status]) { showDetail(id); return; }
  }
  toast('按下方「劃屋頂」，再點屋頂的每個角');
});

// ---------- 屋頂清單 ----------
const ORDER = { pass: 0, near: 1, fail: 2, flag: 3 };
function viewContains(b) {
  const p = map.project([b.lng, b.lat]), c = map.getContainer();
  return p.x >= 0 && p.y >= 0 && p.x <= c.clientWidth && p.y <= c.clientHeight;
}
function listRow(x) {
  const b = x.b, m = x.r.metrics, f = x.r.fin;
  return `<i style="background:var(${COLORS[x.r.status]})"></i>
    <div class="lt"><div class="a">${esc(b.addr || '（還沒填地址）')}</div>
    <div class="n">${fmt(m.kw, 2)} kW　每年售電 ${fmt(f.avgIncome / 10000, 1)} 萬${b.floors ? `　登記 ${b.floors} 樓` : ''}</div>
    <span>${LABELS[x.r.status]}　${m.panels} 片　屋頂 ${fmt(m.roofPing, 1)} 坪</span></div>
    <span>›</span>`;
}
function showList() {
  const rows = Object.values(buildings).map(b => ({ b, r: statusOf(b) }))
    .sort((a, b) => ORDER[a.r.status] - ORDER[b.r.status] || b.r.metrics.kw - a.r.metrics.kw);
  const inView = rows.filter(x => viewContains(x.b));
  const list = inView.length ? inView : rows;
  if (!list.length) {
    openSheet('屋頂清單', '<p class="msg">還沒有劃任何屋頂。把地圖放大到看得清楚屋頂，按下方「劃屋頂」開始。</p>');
    return;
  }
  openSheet(`屋頂清單（${inView.length ? '目前畫面' : '全部'} ${list.length} 個）`,
    '<ul class="list">' + list.map(x => `<li data-id="${esc(x.b.id)}">${listRow(x)}</li>`).join('') + '</ul>', 'list');
  $('sheetBody').querySelectorAll('li').forEach(li => li.onclick = () => {
    const b = buildings[li.dataset.id]; map.easeTo({ center: [b.lng, b.lat], zoom: Math.max(map.getZoom(), 19) }); showDetail(b.id);
  });
}
$('btnList').onclick = showList;

// ---------- 定位 ----------
let meMarker = null;
$('btnLocate').onclick = () => {
  if (!navigator.geolocation) { toast('這支手機無法定位'); return; }
  toast('定位中…', 0);
  navigator.geolocation.getCurrentPosition(p => {
    $('hint').hidden = true;
    const ll = [p.coords.longitude, p.coords.latitude];
    if (!meMarker) { const el = document.createElement('div'); el.className = 'me'; meMarker = new maplibregl.Marker({ element: el }); }
    meMarker.setLngLat(ll).addTo(map);
    map.easeTo({ center: ll, zoom: 18 });
  }, () => toast('無法取得位置，請確認已允許定位權限'), { enableHighAccuracy: true, timeout: 15000 });
};

// ---------- 設定 ----------
function openSettings() {
  const s = settings;
  const rateInputs = E.RATE_TIERS.map((t, i) => `<div><label for="fRate${i}">${t.label}</label><input id="fRate${i}" type="number" inputmode="decimal" step="0.0001" value="${s.rates[i]}"></div>`).join('');
  openSheet('設定', `
    <div class="form">
      <h3 style="border-top:0;padding-top:0;margin-top:4px">篩選條件</h3>
      <div class="row">
        <div><label for="fRoof">屋頂面積至少（坪）</label><input id="fRoof" type="number" inputmode="decimal" value="${s.minRoofPing}"></div>
        <div><label for="fKw">可裝容量至少（kW）</label><input id="fKw" type="number" inputmode="decimal" value="${s.minKw}"></div>
      </div>
      <h3>板子與日照</h3>
      <div class="row">
        <div><label for="fPanelW">板子瓦數（W）</label><input id="fPanelW" type="number" inputmode="numeric" value="${s.panelW}"></div>
        <div><label for="fCov">鋪設比例（%）</label><input id="fCov" type="number" inputmode="numeric" value="${Math.round(s.coverage * 100)}"></div>
      </div>
      <div class="note">鋪設比例：屋頂扣掉樓梯間、女兒牆、走道後能放板子的比例，預設 65%。</div>
      <div class="row3">
        <div><label for="fSunTao">桃園日照</label><input id="fSunTao" type="number" inputmode="decimal" step="0.01" value="${s.sun['桃園']}"></div>
        <div><label for="fSunHsq">新竹日照</label><input id="fSunHsq" type="number" inputmode="decimal" step="0.01" value="${s.sun['新竹']}"></div>
        <div><label for="fSunMia">苗栗日照</label><input id="fSunMia" type="number" inputmode="decimal" step="0.01" value="${s.sun['苗栗']}"></div>
      </div>
      <div class="note">每日日照小時數（2025 年氣象署統計）。每年衰退固定 0.6%。</div>
      <h3>躉購費率（屋頂型，苗栗以北，元/度）</h3>
      <div class="row3">${rateInputs}</div>
      <h3>底圖</h3>
      <div class="basepick"><button id="bPhoto" class="${s.base === 'photo' ? 'on' : ''}">空拍圖</button><button id="bEmap" class="${s.base === 'emap' ? 'on' : ''}">街道圖</button></div>
      <div class="actions"><button class="btn primary full" id="saveS">儲存</button>
        <button class="btn full" id="clearS">清除所有屋頂（${Object.keys(buildings).length} 個）</button></div>
    </div>`, 'settings');
  const pickBase = k => {
    settings.base = k; saveSettings();
    map.setLayoutProperty('photo', 'visibility', k === 'photo' ? 'visible' : 'none');
    map.setLayoutProperty('emap', 'visibility', k === 'emap' ? 'visible' : 'none');
    $('bPhoto').classList.toggle('on', k === 'photo'); $('bEmap').classList.toggle('on', k === 'emap');
  };
  $('bPhoto').onclick = () => pickBase('photo');
  $('bEmap').onclick = () => pickBase('emap');
  $('saveS').onclick = () => {
    const num = (id, d) => { const v = parseFloat($(id).value); return isFinite(v) && v >= 0 ? v : d; };
    s.minRoofPing = num('fRoof', D.minRoofPing); s.minKw = num('fKw', D.minKw);
    s.panelW = Math.max(1, num('fPanelW', D.panelW));
    s.coverage = Math.min(100, Math.max(1, num('fCov', D.coverage * 100))) / 100;
    s.sun = { 桃園: num('fSunTao', D.sun['桃園']), 新竹: num('fSunHsq', D.sun['新竹']), 苗栗: num('fSunMia', D.sun['苗栗']) };
    s.rates = E.RATE_TIERS.map((t, i) => num('fRate' + i, D.rates[i]));
    saveSettings(); render(); closeSheet(); toast('已儲存');
  };
  let armed = false;
  $('clearS').onclick = () => {
    if (!armed) { armed = true; $('clearS').textContent = '再按一次確認清除'; $('clearS').classList.add('flag'); return; }
    buildings = {}; flags = {}; saveAll(); render(); closeSheet(); toast('已清除');
  };
}
$('btnSettings').onclick = openSettings;

// 安卓返回鍵：依序結束劃屋頂、關視窗，最後才離開
window.__back = function () {
  if (draw) { endDraw(); return 'closed'; }
  if (!$('sheet').hidden) { closeSheet(); return 'closed'; }
  return 'none';
};

render();
if (!Object.keys(buildings).length) toast('把地圖放大到看得清楚屋頂，按下方「劃屋頂」開始', 6000);
})();
