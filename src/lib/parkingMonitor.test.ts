import assert from 'node:assert/strict';
import {
  DEFAULT_PARKING_POLL_SECONDS,
  DEFAULT_PARKING_SOURCE_URL,
  MIN_PARKING_POLL_SECONDS,
  PARKING_HEIGHT_MULTIPLIER,
  PARKING_OK_HEIGHT,
  PARKING_SEVERITIES,
  PARKING_SEVERITY_COLORS,
  buildVisualizerUrl,
  layoutParkingLots,
  normalizeParkingLots,
  normalizeParkingSeverity,
  parkingLotTargetHeight,
  resolveParkingMonitorConfig,
  summarizeParkingLots,
  type ParkingLot,
} from './parkingMonitor';

// --- severity mapping ---
assert.equal(normalizeParkingSeverity(undefined), 'ok');
assert.equal(normalizeParkingSeverity(''), 'ok');
assert.equal(normalizeParkingSeverity('OK'), 'ok');
assert.equal(normalizeParkingSeverity('normal'), 'ok');
assert.equal(normalizeParkingSeverity('warn'), 'warning');
assert.equal(normalizeParkingSeverity('yellow'), 'warning');
assert.equal(normalizeParkingSeverity('error'), 'major');
assert.equal(normalizeParkingSeverity('orange'), 'major');
assert.equal(normalizeParkingSeverity('critical'), 'critical');
assert.equal(normalizeParkingSeverity('red'), 'critical');
assert.equal(normalizeParkingSeverity(0), 'ok');
assert.equal(normalizeParkingSeverity(1), 'warning');
assert.equal(normalizeParkingSeverity(2), 'major');
assert.equal(normalizeParkingSeverity(3), 'critical');
assert.equal(normalizeParkingSeverity(99), 'critical');
assert.equal(normalizeParkingSeverity(true), 'ok');
assert.equal(normalizeParkingSeverity(false), 'critical');
// Unknown values must never be painted as healthy.
assert.equal(normalizeParkingSeverity('something-new'), 'warning');

assert.deepEqual(PARKING_SEVERITIES, ['ok', 'warning', 'major', 'critical']);
assert.equal(PARKING_SEVERITY_COLORS.ok, '#22d3ee');
assert.equal(PARKING_SEVERITY_COLORS.warning, '#facc15');
assert.equal(PARKING_SEVERITY_COLORS.major, '#fb923c');
assert.equal(PARKING_SEVERITY_COLORS.critical, '#ef4444');

// --- heights: the healthy block is the unit; warning 2x, major 3x, critical 4x ---
assert.deepEqual(PARKING_HEIGHT_MULTIPLIER, { ok: 1, warning: 2, major: 3, critical: 4 });
assert.equal(parkingLotTargetHeight('ok'), PARKING_OK_HEIGHT);
assert.equal(parkingLotTargetHeight('warning'), PARKING_OK_HEIGHT * 2);
assert.equal(parkingLotTargetHeight('major'), PARKING_OK_HEIGHT * 3);
assert.equal(parkingLotTargetHeight('critical'), PARKING_OK_HEIGHT * 4);

// --- normalizeParkingLots ---
assert.deepEqual(normalizeParkingLots(null), []);
assert.deepEqual(normalizeParkingLots({ lots: 'nope' }), []);

const normalized = normalizeParkingLots({
  lots: [
    { id: 'A', name: '东门', severity: 'ok', message: '  ', updatedAt: '2026-09-24T08:00:00Z' },
    { id: 'B', status: 'warn', reason: 'gate slow', row: '1', col: 2 },
    { id: 'A', name: 'duplicate' },
    { code: 'C', title: 'Titled', level: 3, row: 0 },
    { name: 'No id', severity: 'orange' },
    'garbage',
  ],
});
assert.deepEqual(normalized, [
  { id: 'A', name: '东门', severity: 'ok', updatedAt: '2026-09-24T08:00:00Z' },
  { id: 'B', name: 'B', severity: 'warning', message: 'gate slow', row: 1, col: 2 },
  { id: 'C', name: 'Titled', severity: 'critical' },
  { id: 'lot-5', name: 'No id', severity: 'major' },
]);
assert.deepEqual(normalizeParkingLots([{ id: 'X' }]), [{ id: 'X', name: 'X', severity: 'ok' }]);
assert.deepEqual(normalizeParkingLots({ data: [{ id: 'D', status: 'offline' }] })[0].severity, 'critical');

assert.deepEqual(summarizeParkingLots(normalized), { ok: 1, warning: 1, major: 1, critical: 1 });

// --- layout ---
const single = layoutParkingLots([{ id: '1', name: '1', severity: 'ok' }]);
assert.equal(single.cells.length, 1);
assert.deepEqual([single.cells[0].x, single.cells[0].z], [0, 0]);
assert.equal(single.rows, 1);
assert.equal(single.cols, 1);

const empty = layoutParkingLots([]);
assert.deepEqual(empty.cells, []);

const four = layoutParkingLots(Array.from({ length: 4 }, (_, i) => ({ id: `L${i}`, name: `L${i}`, severity: 'ok' as const })));
assert.equal(four.rows, 2);
assert.equal(four.cols, 2);
const half = four.pitch / 2;
assert.deepEqual(
  four.cells.map((cell) => [cell.x, cell.z]),
  [[-half, -half], [half, -half], [-half, half], [half, half]],
);
// Centred on the platter.
const sumX = four.cells.reduce((sum, cell) => sum + cell.x, 0);
const sumZ = four.cells.reduce((sum, cell) => sum + cell.z, 0);
assert.ok(Math.abs(sumX) < 1e-9 && Math.abs(sumZ) < 1e-9);

// Fixed cells are honoured and auto lots never land on them.
const mixed = layoutParkingLots([
  { id: 'fixed', name: 'fixed', severity: 'ok', row: 0, col: 0 },
  { id: 'auto1', name: 'auto1', severity: 'ok' },
  { id: 'auto2', name: 'auto2', severity: 'ok' },
  { id: 'fixed2', name: 'fixed2', severity: 'ok', row: 1, col: 1 },
]);
const byId = Object.fromEntries(mixed.cells.map((cell) => [cell.lot.id, cell]));
assert.deepEqual([byId.fixed.row, byId.fixed.col], [0, 0]);
assert.deepEqual([byId.fixed2.row, byId.fixed2.col], [1, 1]);
const occupied = new Set(mixed.cells.map((cell) => `${cell.row}:${cell.col}`));
assert.equal(occupied.size, mixed.cells.length);

// Two lots claiming the same cell: the second one is auto-placed instead of overlapping.
const clash = layoutParkingLots([
  { id: 'a', name: 'a', severity: 'ok', row: 0, col: 0 },
  { id: 'b', name: 'b', severity: 'ok', row: 0, col: 0 },
]);
assert.equal(new Set(clash.cells.map((cell) => `${cell.row}:${cell.col}`)).size, 2);

// Many lots shrink the pitch so the grid still fits the visible platter.
const many: ParkingLot[] = Array.from({ length: 400 }, (_, i) => ({ id: `M${i}`, name: `M${i}`, severity: 'ok' }));
const big = layoutParkingLots(many, { maxSpan: 100 });
const xs = big.cells.map((cell) => cell.x);
const zs = big.cells.map((cell) => cell.z);
assert.ok(Math.max(...xs) - Math.min(...xs) + big.lotSize <= 100 + 1e-9);
assert.ok(Math.max(...zs) - Math.min(...zs) + big.lotSize <= 100 + 1e-9);
assert.ok(big.lotSize < big.pitch, 'blocks keep a gap when the grid is compressed');

const small = layoutParkingLots(many.slice(0, 9), { lotSize: 3, gap: 2 });
assert.equal(small.pitch, 5);
assert.equal(small.lotSize, 3);

// --- monitor config from the URL ---
assert.deepEqual(resolveParkingMonitorConfig({ search: '', hash: '' }), {
  enabled: false,
  sourceUrl: DEFAULT_PARKING_SOURCE_URL,
  intervalMs: DEFAULT_PARKING_POLL_SECONDS * 1000,
  rotationSpeed: null,
  bloom: false,
});
assert.equal(resolveParkingMonitorConfig({ search: '?mode=monitor&fx=bloom' }).bloom, true);
assert.equal(resolveParkingMonitorConfig({ hash: '#mode=monitor&fx=BLOOM' }).bloom, true);
assert.equal(resolveParkingMonitorConfig({ search: '?mode=monitor&fx=none' }).bloom, false);
assert.equal(resolveParkingMonitorConfig({ search: '?mode=monitor&rotate=0' }).rotationSpeed, 0);
assert.equal(resolveParkingMonitorConfig({ search: '?mode=monitor&rotate=0.05' }).rotationSpeed, 0.05);
assert.equal(resolveParkingMonitorConfig({ search: '?mode=monitor&rotate=fast' }).rotationSpeed, null);
assert.equal(resolveParkingMonitorConfig({ search: '?mode=monitor' }).enabled, true);
assert.equal(resolveParkingMonitorConfig({ search: '?mode=MONITOR' }).enabled, true);
assert.equal(resolveParkingMonitorConfig({ hash: '#monitor' }).enabled, true);
assert.equal(resolveParkingMonitorConfig({ hash: '#/monitor' }).enabled, true);
assert.equal(resolveParkingMonitorConfig({ hash: '#mode=monitor&interval=5' }).intervalMs, 5000);
assert.equal(resolveParkingMonitorConfig({ hash: '#monitoring' }).enabled, false);
assert.equal(resolveParkingMonitorConfig({ search: '?mode=other' }).enabled, false);

const custom = resolveParkingMonitorConfig({ search: '?mode=monitor&source=http%3A%2F%2F10.0.0.5%3A8000%2Fapi%2Flots&interval=1' });
assert.equal(custom.sourceUrl, 'http://10.0.0.5:8000/api/lots');
assert.equal(custom.intervalMs, MIN_PARKING_POLL_SECONDS * 1000);
assert.equal(resolveParkingMonitorConfig({ search: '?interval=abc' }).intervalMs, DEFAULT_PARKING_POLL_SECONDS * 1000);

assert.equal(buildVisualizerUrl({ pathname: '/', search: '?mode=monitor&source=x&interval=3&rotate=0&fx=bloom', hash: '#monitor' }), '/');
assert.equal(buildVisualizerUrl({ pathname: '/app', search: '?mode=monitor&lang=zh' }), '/app?lang=zh');

console.log('parkingMonitor tests passed');
