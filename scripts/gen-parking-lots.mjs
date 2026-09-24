// Generate a sample parking-lot status file for the monitor mode.
// Usage: node scripts/gen-parking-lots.mjs [count] [output]
// Example: node scripts/gen-parking-lots.mjs 500 public/parking-lots-500.json
import { writeFileSync } from 'node:fs';

const count = Math.max(1, Number(process.argv[2]) || 500);
const output = process.argv[3] || `public/parking-lots-${count}.json`;

// Deterministic pseudo-random so the sample is stable between runs.
let seed = 20260924;
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const districts = ['东城', '西城', '南湖', '北苑', '高新', '临港', '滨江', '中央'];
const kinds = ['停车场', '地下车库', '立体车库', '路侧泊位'];
const problems = {
  warning: ['剩余车位不足 5%', '闸机响应缓慢', '车位检测器 3 个离线', '摄像头画面模糊'],
  major: ['支付服务连接超时', '车位检测器离线超过 10 个', '入口道闸间歇性故障', '车牌识别率异常'],
  critical: ['出口道闸故障，车辆无法离场', '控制器离线', '消防联动报警', '供电中断'],
};

const lots = [];
for (let i = 1; i <= count; i++) {
  const roll = random();
  const severity = roll < 0.88 ? 'ok' : roll < 0.94 ? 'warning' : roll < 0.98 ? 'major' : 'critical';
  const district = districts[Math.floor(random() * districts.length)];
  const kind = kinds[Math.floor(random() * kinds.length)];
  const lot = {
    id: `P${String(i).padStart(3, '0')}`,
    name: `${district}${kind} ${String(i).padStart(3, '0')}`,
    severity,
    updatedAt: '2026-09-24T08:00:00+08:00',
  };
  if (severity !== 'ok') {
    const pool = problems[severity];
    lot.message = pool[Math.floor(random() * pool.length)];
  }
  lots.push(lot);
}

writeFileSync(output, `${JSON.stringify({ lots }, null, 2)}\n`);
const summary = lots.reduce((acc, lot) => ({ ...acc, [lot.severity]: (acc[lot.severity] || 0) + 1 }), {});
console.log(`Wrote ${lots.length} lots to ${output}`, summary);
