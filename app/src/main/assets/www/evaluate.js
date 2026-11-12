// 光電屋頂探勘：屋頂估算與收益計算（純函式，可在 Node 單獨測試）
(function (root) {
  const PING = 3.30579;            // 1 坪 = 3.30579 m²
  const DECAY = 0.006;             // 每年直線衰退 0.6%（固定）
  const YEARS = 20;
  const TOTAL_FACTOR = YEARS - DECAY * YEARS * (YEARS - 1) / 2; // 18.86
  const AVG_FACTOR = TOTAL_FACTOR / YEARS;                       // 0.943

  const REGIONS = ['桃園', '新竹', '苗栗'];
  // 115 年屋頂型躉購費率（苗栗以北）
  const RATE_TIERS = [
    { min: 0, label: '1–10 kW' }, { min: 10, label: '10–20 kW' }, { min: 20, label: '20–50 kW' },
    { min: 50, label: '50–100 kW' }, { min: 100, label: '100–500 kW' }, { min: 500, label: '500 kW 以上' }
  ];
  // 板子尺寸 1.879 m × 1.045 m
  const PANEL_M2 = 1.879 * 1.045;

  const DEFAULTS = {
    coverage: 0.65,       // 可鋪板面積佔屋頂比例
    minRoofPing: 14,      // 屋頂面積下限（坪）
    minKw: 7,             // 可裝容量下限（kW）
    panelW: 445,          // 板子瓦數
    sun: { 桃園: 2.97, 新竹: 2.92, 苗栗: 3.37 },   // 2025 年氣象署，每日小時數
    rates: [6.8754, 6.5777, 5.2087, 5.03, 4.6574, 4.4501],
    nearMargin: 0.85
  };

  function panelsFor(m2, o) { return Math.floor(m2 * o.coverage / PANEL_M2 + 1e-9); }

  function regionFromText(t) {
    t = String(t || '').replace(/臺/g, '台');
    for (const r of REGIONS) if (t.indexOf(r) >= 0) return r;
    return null;
  }
  function sunFor(b, o) {
    const sun = (o && o.sun) || DEFAULTS.sun;
    const region = REGIONS.indexOf(b.region) >= 0 ? b.region : regionFromText(b.addr);
    if (region) return { region, hours: +(sun[region] != null ? sun[region] : DEFAULTS.sun[region]), guessed: false };
    return { region: '新竹', hours: +(sun['新竹'] != null ? sun['新竹'] : DEFAULTS.sun['新竹']), guessed: true };
  }

  // 剛好在級距邊界算較高那一級
  function tierIndex(kw) {
    let i = 0;
    for (let k = 0; k < RATE_TIERS.length; k++) if (kw >= RATE_TIERS[k].min) i = k;
    return i;
  }
  function finance(kw, hours, o) {
    const rates = (o && o.rates) || DEFAULTS.rates;
    const first = kw * hours * 365;
    const i = tierIndex(kw);
    const rate = +rates[i];
    const avgKwh = first * AVG_FACTOR, totalKwh = first * TOTAL_FACTOR;
    return { firstKwh: first, avgKwh, totalKwh, rate, tier: RATE_TIERS[i].label, avgIncome: avgKwh * rate, totalIncome: totalKwh * rate };
  }

  function evaluate(b, opt) {
    const o = Object.assign({}, DEFAULTS, opt || {});
    const m2 = b.groundM2 || 0;
    const panels = panelsFor(m2, o);
    const kw = Math.round(panels * o.panelW) / 1000;
    const m = { panels, kw, roofPing: m2 / PING };
    const sun = sunFor(b, o);
    const fin = finance(kw, sun.hours, o);
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

  const api = { PING, PANEL_M2, DECAY, AVG_FACTOR, TOTAL_FACTOR, REGIONS, RATE_TIERS, DEFAULTS,
    panelsFor, regionFromText, sunFor, tierIndex, finance, evaluate, polyAreaM2, pointInPoly, centroid };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SolarEval = api;
})(this);
