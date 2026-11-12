// 執行：node test/evaluate.test.js
const assert = require('assert');
const E = require('../app/src/main/assets/www/evaluate.js');

// 公司簡報案例：19.58 kW、桃園
const f = E.finance(19.58, E.DEFAULTS.sun['桃園']);
assert.strictEqual(Math.round(f.avgKwh), 20016, '20 年平均每年發電');
assert.strictEqual(Math.round(f.avgIncome), 131658, '每年售電');
assert.strictEqual(f.rate, 6.5777);
assert.strictEqual(Math.round(f.totalIncome * 0.1), 263316, '租金 = 20 年累計售電 × 10%');

// 係數
assert.strictEqual(+E.TOTAL_FACTOR.toFixed(4), 18.86);
assert.strictEqual(+E.AVG_FACTOR.toFixed(4), 0.943);

// 級距邊界算較高那一級
assert.strictEqual(E.finance(10, 3).tier, '10–20 kW');
assert.strictEqual(E.finance(9.99, 3).tier, '1–10 kW');
assert.strictEqual(E.finance(20, 3).rate, 5.2087);

// 片數：50 坪估 54 片（說明文件的對照）
const r50 = E.evaluate({ groundM2: 50 * E.PING, region: '新竹' });
assert.strictEqual(r50.metrics.panels, 54);
assert.strictEqual(r50.metrics.kw, 24.03);
assert.strictEqual(r50.status, 'pass');

// 狀態判斷
assert.strictEqual(E.evaluate({ groundM2: 14 * E.PING }).status, 'near'); // 剛好 14 坪 → 15 片 6.68 kW，只差容量且 > 85%
assert.strictEqual(E.evaluate({ groundM2: 8 * E.PING }).status, 'fail');
assert.strictEqual(E.evaluate({ groundM2: 13 * E.PING }).sun.guessed, true);

// 地區
assert.strictEqual(E.sunFor({ region: '苗栗' }).hours, 3.37);
assert.strictEqual(E.sunFor({ addr: '臺灣桃園市中壢區' }).region, '桃園');

// 面積
const sq = [[121, 24.8], [121.0001, 24.8], [121.0001, 24.8001], [121, 24.8001]];
assert.ok(Math.abs(E.polyAreaM2(sq) - 111.3) < 1);
assert.ok(E.pointInPoly(121.00005, 24.80005, sq));

console.log('全部通過');
