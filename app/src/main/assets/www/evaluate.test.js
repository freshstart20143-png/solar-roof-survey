// 執行：node test/evaluate.test.js
const assert = require('assert');
const E = require('../app/src/main/assets/www/evaluate.js');

// 公司簡報案例：19.58 kW、桃園（苗栗以北）
const f = E.finance(19.58, E.SUN['桃園'], 'north');
assert.strictEqual(Math.round(f.avgKwh), 20016, '20 年平均每年發電');
assert.strictEqual(Math.round(f.avgIncome), 131658, '每年售電');
assert.strictEqual(f.rate, 6.5777);
assert.strictEqual(Math.round(f.totalIncome * 0.1), 263316, '租金 = 20 年累計售電 × 10%');

// 係數
assert.strictEqual(+E.TOTAL_FACTOR.toFixed(4), 18.86);
assert.strictEqual(+E.AVG_FACTOR.toFixed(4), 0.943);

// 級距邊界算較高那一級
assert.strictEqual(E.finance(10, 3, 'north').tier, '10–20 kW');
assert.strictEqual(E.finance(9.99, 3, 'north').tier, '1–10 kW');
assert.strictEqual(E.finance(20, 3, 'north').rate, 5.2087);

// 三組費率（115 年屋頂型）
assert.deepStrictEqual(E.RATES.north, [6.8754, 6.5777, 5.2087, 5.03, 4.6574, 4.4501]);
assert.deepStrictEqual(E.RATES.south, [6.0312, 5.7704, 4.5711, 4.4231, 4.1001, 3.9066]);
assert.deepStrictEqual(E.RATES.taitung, [6.4814, 6.201, 4.9111, 4.7468, 4.3973, 4.1965]);

// 各縣市：日照與費率組別
const expect = {
  基隆: [2.56, 'north'], 台北: [2.56, 'north'], 新北: [2.56, 'north'], 桃園: [2.97, 'north'], 新竹: [2.92, 'north'],
  苗栗: [3.37, 'north'], 台中: [3.42, 'south'], 彰化: [3.73, 'south'], 南投: [3.34, 'south'], 雲林: [3.59, 'south'],
  嘉義: [3.6, 'south'], 台南: [3.58, 'south'], 高雄: [3.58, 'south'], 屏東: [3.5, 'south'], 宜蘭: [2.64, 'north'],
  花蓮: [2.8, 'north'], 台東: [2.89, 'taitung']
};
assert.strictEqual(E.REGIONS.length, 17);
for (const [c, [h, g]] of Object.entries(expect)) {
  const s = E.sunFor({ region: c });
  assert.strictEqual(s.hours, h, c + ' 日照');
  assert.strictEqual(s.rateGroup, g, c + ' 費率組別');
}

// 同一個屋頂，台南比桃園日照多、費率低
const tn = E.evaluate({ groundM2: 50 * E.PING, region: '台南' });
assert.strictEqual(tn.fin.rate, 4.5711);
assert.strictEqual(tn.fin.groupLabel, '台中以南');
assert.strictEqual(Math.round(tn.fin.avgIncome), Math.round(24.03 * 3.58 * 365 * 0.943 * 4.5711));

// 片數：50 坪估 54 片
const r50 = E.evaluate({ groundM2: 50 * E.PING, region: '新竹' });
assert.strictEqual(r50.metrics.panels, 54);
assert.strictEqual(r50.metrics.kw, 24.03);
assert.strictEqual(r50.status, 'pass');

// 狀態判斷
assert.strictEqual(E.evaluate({ groundM2: 14 * E.PING }).status, 'near'); // 剛好 14 坪 → 15 片 6.68 kW
assert.strictEqual(E.evaluate({ groundM2: 8 * E.PING }).status, 'fail');

// 地址文字
assert.strictEqual(E.regionFromText('臺灣桃園市中壢區'), '桃園');
assert.strictEqual(E.regionFromText('新北市板橋區'), '新北');
assert.strictEqual(E.regionFromText('臺北市大安區'), '台北');
assert.strictEqual(E.sunFor({ addr: '臺東縣成功鎮' }).rateGroup, 'taitung');

// 用位置判斷最近縣市
const near = [
  [121.01, 24.83, '新竹'],   // 竹北
  [120.68, 24.14, '台中'],   // 台中市區
  [120.91, 24.69, '苗栗'],   // 頭份
  [120.49, 22.67, '屏東'],   // 屏東市
  [120.30, 22.62, '高雄'],   // 高雄市區
  [121.61, 23.99, '花蓮'],
  [121.14, 22.75, '台東'],
  [121.22, 24.96, '桃園'],   // 中壢
  [120.20, 22.99, '台南']
];
for (const [lng, lat, c] of near) assert.strictEqual(E.nearestCounty(lng, lat), c, `${lng},${lat}`);
const g = E.sunFor({ lng: 120.68, lat: 24.14 });
assert.strictEqual(g.region, '台中');
assert.strictEqual(g.guessed, true);

// 面積
const sq = [[121, 24.8], [121.0001, 24.8], [121.0001, 24.8001], [121, 24.8001]];
assert.ok(Math.abs(E.polyAreaM2(sq) - 111.3) < 1);
assert.ok(E.pointInPoly(121.00005, 24.80005, sq));

console.log('全部通過');
