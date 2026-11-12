// 光電屋頂探勘：屋頂估算與收益計算（純函式，可在 Node 單獨測試）
(function (root) {
  const PING = 3.30579;            // 1 坪 = 3.30579 m²
  const DECAY = 0.006;             // 每年直線衰退 0.6%（固定）
  const YEARS = 20;
  const TOTAL_FACTOR = YEARS - DECAY * YEARS * (YEARS - 1) / 2; // 18.86
  const AVG_FACTOR = TOTAL_FACTOR / YEARS;                       // 0.943

  // 全台 17 縣市：日照用哪一區、費率用哪一組、判斷最近縣市用的參考點 [經度, 緯度]
  const COUNTIES = [
    { name: '基隆', sun: '雙北', rate: 'north', pts: [[121.74, 25.13]] },
    { name: '台北', sun: '雙北', rate: 'north', pts: [[121.52, 25.05], [121.50, 25.13], [121.57, 25.03]] },
    { name: '新北', sun: '雙北', rate: 'north', pts: [[121.46, 25.01], [121.44, 25.17], [121.37, 24.93], [121.54, 24.97], [121.66, 25.07], [121.43, 25.06]] },
    { name: '桃園', sun: '桃園', rate: 'north', pts: [[121.30, 24.99], [121.22, 24.95], [121.29, 24.88], [121.10, 24.97], [121.15, 25.06]] },
    { name: '新竹', sun: '新竹', rate: 'north', pts: [[120.97, 24.80], [121.01, 24.83], [121.09, 24.74], [121.04, 24.90], [121.16, 24.71]] },
    { name: '苗栗', sun: '苗栗', rate: 'north', pts: [[120.82, 24.56], [120.91, 24.69], [120.65, 24.44], [120.78, 24.43], [120.87, 24.61]] },
    { name: '台中', sun: '台中', rate: 'south', pts: [[120.68, 24.15], [120.72, 24.25], [120.62, 24.35], [120.55, 24.27], [120.70, 24.07], [120.84, 24.27]] },
    { name: '彰化', sun: '彰化', rate: 'south', pts: [[120.54, 24.08], [120.57, 23.96], [120.43, 24.06], [120.47, 23.88], [120.55, 23.86]] },
    { name: '南投', sun: '南投', rate: 'south', pts: [[120.69, 23.91], [120.97, 23.96], [120.69, 23.83], [120.79, 23.97], [120.80, 23.72]] },
    { name: '雲林', sun: '雲林', rate: 'south', pts: [[120.53, 23.71], [120.43, 23.71], [120.30, 23.57], [120.25, 23.75], [120.43, 23.79]] },
    { name: '嘉義', sun: '嘉義', rate: 'south', pts: [[120.45, 23.48], [120.25, 23.46], [120.43, 23.55], [120.32, 23.36], [120.55, 23.43]] },
    { name: '台南', sun: '台南', rate: 'south', pts: [[120.21, 23.00], [120.32, 23.31], [120.25, 23.03], [120.32, 23.18], [120.41, 23.12], [120.27, 22.93]] },
    { name: '高雄', sun: '高雄', rate: 'south', pts: [[120.31, 22.63], [120.36, 22.63], [120.48, 22.89], [120.30, 22.73], [120.25, 22.80], [120.39, 22.75]] },
    { name: '屏東', sun: '屏東', rate: 'south', pts: [[120.49, 22.67], [120.45, 22.47], [120.74, 22.00], [120.54, 22.55], [120.60, 22.80], [120.63, 22.37]] },
    { name: '宜蘭', sun: '宜蘭', rate: 'north', pts: [[121.75, 24.75], [121.77, 24.68], [121.84, 24.60], [121.82, 24.85]] },
    { name: '花蓮', sun: '花蓮', rate: 'north', pts: [[121.60, 23.98], [121.31, 23.33], [121.42, 23.66], [121.50, 23.86]] },
    { name: '台東', sun: '台東', rate: 'taitung', pts: [[121.15, 22.76], [121.37, 23.10], [120.89, 22.34], [121.21, 23.10], [121.03, 22.58]] }
  ];
  const REGIONS = COUNTIES.map(c => c.name);
  const COUNTY = {};
  COUNTIES.forEach(c => { COUNTY[c.name] = c; });

  // 2025 年氣象署各地區日照時數（每日小時數）
  const SUN_AREAS = ['雙北', '桃園', '新竹', '苗栗', '台中', '彰化', '南投', '雲林', '嘉義', '台南', '高雄', '屏東', '宜蘭', '花蓮', '台東'];
  const SUN = { 雙北: 2.56, 桃園: 2.97, 新竹: 2.92, 苗栗: 3.37, 台中: 3.42, 彰化: 3.73, 南投: 3.34, 雲林: 3.59,
    嘉義: 3.6, 台南: 3.58, 高雄: 3.58, 屏東: 3.5, 宜蘭: 2.64, 花蓮: 2.8, 台東: 2.89 };

  // 115 年屋頂型躉購費率（元/度），依地區分三組
  const RATE_TIERS = [
    { min: 0, label: '1–10 kW' }, { min: 10, label: '10–20 kW' }, { min: 20, label: '20–50 kW' },
    { min: 50, label: '50–100 kW' }, { min: 100, label: '100–500 kW' }, { min: 500, label: '500 kW 以上' }
  ];
  const RATES = {
    north: [6.8754, 6.5777, 5.2087, 5.0300, 4.6574, 4.4501],
    south: [6.0312, 5.7704, 4.5711, 4.4231, 4.1001, 3.9066],
    taitung: [6.4814, 6.2010, 4.9111, 4.7468, 4.3973, 4.1965]
  };
  const RATE_GROUP_LABEL = { north: '苗栗以北', south: '台中以南', taitung: '台東' };

  // 板子尺寸 1.879 m × 1.045 m
  const PANEL_M2 = 1.879 * 1.045;

  const DEFAULTS = {
    coverage: 0.65,       // 可鋪板面積佔屋頂比例
    minRoofPing: 14,      // 屋頂面積下限（坪）
    minKw: 7,             // 可裝容量下限（kW）
    panelW: 445,          // 板子瓦數
    sun: SUN,
    nearMargin: 0.85
  };

  function panelsFor(m2, o) { return Math.floor(m2 * o.coverage / PANEL_M2 + 1e-9); }

  // 從地址文字找縣市
  function regionFromText(t) {
    t = String(t || '').replace(/臺/g, '台');
    let best = null, at = Infinity;
    for (const r of REGIONS) { const i = t.indexOf(r); if (i >= 0 && i < at) { best = r; at = i; } }
    return best;
  }
  // 用位置找最近的縣市（參考點最近者），只是預設，使用者可以改
  function nearestCounty(lng, lat) {
    if (!isFinite(lng) || !isFinite(lat)) return null;
    const kx = Math.cos(lat * Math.PI / 180);
    let best = null, bd = Infinity;
    for (const c of COUNTIES) for (const p of c.pts) {
      const dx = (p[0] - lng) * kx, dy = p[1] - lat, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = c.name; }
    }
    return best;
  }
  function countyOf(b) {
    if (COUNTY[b.region]) return { county: b.region, guessed: false };
    const t = regionFromText(b.addr);
    if (t) return { county: t, guessed: false };
    const n = nearestCounty(b.lng, b.lat);
    if (n) return { county: n, guessed: true };
    return { county: '新竹', guessed: true };
  }
  function sunFor(b, o) {
    const sun = (o && o.sun) || SUN;
    const c = countyOf(b), info = COUNTY[c.county];
    const v = sun[info.sun] != null && isFinite(+sun[info.sun]) ? +sun[info.sun] : SUN[info.sun];
    return { region: c.county, area: info.sun, hours: v, rateGroup: info.rate, guessed: c.guessed };
  }

  // 剛好在級距邊界算較高那一級
  function tierIndex(kw) {
    let i = 0;
    for (let k = 0; k < RATE_TIERS.length; k++) if (kw >= RATE_TIERS[k].min) i = k;
    return i;
  }
  function finance(kw, hours, group) {
    const g = RATES[group] ? group : 'north';
    const first = kw * hours * 365;
    const i = tierIndex(kw);
    const rate = RATES[g][i];
    const avgKwh = first * AVG_FACTOR, totalKwh = first * TOTAL_FACTOR;
    return { firstKwh: first, avgKwh, totalKwh, rate, tier: RATE_TIERS[i].label, group: g, groupLabel: RATE_GROUP_LABEL[g],
      avgIncome: avgKwh * rate, totalIncome: totalKwh * rate };
  }

  function evaluate(b, opt) {
    const o = Object.assign({}, DEFAULTS, opt || {});
    const m2 = b.groundM2 || 0;
    const panels = panelsFor(m2, o);
    const kw = Math.round(panels * o.panelW) / 1000;
    const m = { panels, kw, roofPing: m2 / PING };
    const sun = sunFor(b, o);
    const fin = finance(kw, sun.hours, sun.rateGroup);
    const checks = [
      { ok: m.roofPing >= o.minRoofPing - 1e-9, ratio: m.roofPing / o.minRoofPing,
        fail: `屋頂 ${m.roofPing.toFixed(1)} 坪，未達 ${o.minRoofPing} 坪` },
      { ok: kw >= o.minKw - 1e-9, ratio: kw / o.minKw,
        fail: `屋頂估計只能裝 ${kw.toFixed(2)} kW，未達 ${o.minKw} kW` }
    ];
    const failed = checks.filter(c => !c.ok);
    let status = 'pass';
    if (failed.length) status = failed.length === 1 && failed[0].ratio >= o.nearMargin ? 'near' : 'fail';
    return { status, reasons: failed.map(c => c.fail), metrics: m, fin, sun };
  }

  // 幾何：pts 為 [[經度, 緯度], ...]
  function polyAreaM2(pts) {
    if (!pts || pts.length < 3) return 0;
    const lat0 = pts.reduce((s, p) => s + p[1], 0) / pts.length * Math.PI / 180;
    const kx = 111320 * Math.cos(lat0), ky = 110574;
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      s += p[0] * kx * q[1] * ky - q[0] * kx * p[1] * ky;
    }
    return Math.abs(s) / 2;
  }
  function pointInPoly(lng, lat, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function centroid(pts) {
    return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  }

  const api = { PING, PANEL_M2, DECAY, AVG_FACTOR, TOTAL_FACTOR, COUNTIES, REGIONS, SUN, SUN_AREAS, RATES, RATE_GROUP_LABEL,
    RATE_TIERS, DEFAULTS, panelsFor, regionFromText, nearestCounty, countyOf, sunFor, tierIndex, finance, evaluate,
    polyAreaM2, pointInPoly, centroid };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SolarEval = api;
})(this);
