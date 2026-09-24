// Parking-lot monitor: data model, severity mapping, grid layout, and URL configuration.
// Pure helpers only (no three.js / React) so they can run under the Node test runner.

export type ParkingSeverity = 'ok' | 'warning' | 'major' | 'critical';

export interface ParkingLot {
  id: string;
  name: string;
  severity: ParkingSeverity;
  message?: string;
  updatedAt?: string;
  /** Optional fixed grid cell. Lots without both row and col are auto-placed. */
  row?: number;
  col?: number;
}

export interface PlacedParkingLot {
  lot: ParkingLot;
  row: number;
  col: number;
  /** World-space centre of the block on the platter (y is ground level). */
  x: number;
  z: number;
}

export interface ParkingLayout {
  cells: PlacedParkingLot[];
  /** Distance between neighbouring lot centres. */
  pitch: number;
  /** Footprint width of one lot block. */
  lotSize: number;
  rows: number;
  cols: number;
}

export interface ParkingLayoutOptions {
  lotSize?: number;
  gap?: number;
  /** Largest allowed edge-to-edge span of the lot grid; the pitch shrinks to fit. */
  maxSpan?: number;
}

export interface ParkingMonitorConfig {
  enabled: boolean;
  sourceUrl: string;
  intervalMs: number;
  /** Platter rotation override in radians per second; null keeps the visualizer's saved setting. */
  rotationSpeed: number | null;
}

export const PARKING_SEVERITIES: ParkingSeverity[] = ['ok', 'warning', 'major', 'critical'];

/**
 * Colours are plain sRGB hex so CSS and the block shader show the same tone.
 * The wall is a deep-blue field: healthy blocks are a quiet steel blue below the bloom threshold,
 * and alarms climb a warm, glowing ramp gold -> coral -> hot red. Alternatives are listed in Project.md.
 */
export const PARKING_SEVERITY_COLORS: Record<ParkingSeverity, string> = {
  ok: '#2b74d8',
  warning: '#ffc857',
  major: '#ff7a45',
  critical: '#ff3355',
};

export const PARKING_SEVERITY_LEVEL: Record<ParkingSeverity, number> = {
  ok: 0,
  warning: 1,
  major: 2,
  critical: 3,
};

/**
 * Block heights (ground level is the top of the 1-unit ground cells).
 * Every problem lot shares one alarm height; healthy lots are a low block at half that height.
 */
export const PARKING_GROUND_HEIGHT = 1;
export const PARKING_ALARM_HEIGHT = 7;
export const PARKING_OK_HEIGHT = PARKING_ALARM_HEIGHT / 2;
/** Gap between the top of a block and its beacon label. */
export const PARKING_BEACON_GAP = 3.2;

export const DEFAULT_PARKING_LOT_SIZE = 3.2;
export const DEFAULT_PARKING_LOT_GAP = 2.2;
export const DEFAULT_PARKING_MAX_SPAN = 100;

export const DEFAULT_PARKING_SOURCE_URL = '/parking-lots.json';
export const DEFAULT_PARKING_POLL_SECONDS = 10;
export const MIN_PARKING_POLL_SECONDS = 2;
export const PARKING_MONITOR_CAMERA_STORAGE_KEY = 'sonic_parking_monitor_camera';

const SEVERITY_ALIASES: Record<string, ParkingSeverity> = {
  ok: 'ok',
  normal: 'ok',
  healthy: 'ok',
  fine: 'ok',
  good: 'ok',
  online: 'ok',
  green: 'ok',
  cyan: 'ok',
  none: 'ok',
  info: 'ok',
  '0': 'ok',
  warning: 'warning',
  warn: 'warning',
  minor: 'warning',
  low: 'warning',
  yellow: 'warning',
  attention: 'warning',
  '1': 'warning',
  major: 'major',
  error: 'major',
  high: 'major',
  orange: 'major',
  degraded: 'major',
  '2': 'major',
  critical: 'critical',
  fatal: 'critical',
  alarm: 'critical',
  emergency: 'critical',
  offline: 'critical',
  down: 'critical',
  red: 'critical',
  '3': 'critical',
};

/**
 * Map whatever a data source sends to one of the four severities.
 * Missing means "nothing reported" (ok); an unrecognised value is never shown as ok.
 */
export function normalizeParkingSeverity(value: unknown): ParkingSeverity {
  if (value === undefined || value === null || value === '') return 'ok';
  if (typeof value === 'boolean') return value ? 'ok' : 'critical';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'warning';
    const level = Math.max(0, Math.min(3, Math.round(value)));
    return PARKING_SEVERITIES[level];
  }
  const key = String(value).trim().toLowerCase();
  return SEVERITY_ALIASES[key] ?? 'warning';
}

function toOptionalInteger(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric) : undefined;
}

function toOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text ? text : undefined;
}

/**
 * Accepts either an array of lots or an object with a `lots` / `data` / `items` array.
 * Severity may arrive as `severity`, `status` or `level`. Duplicate ids keep the first entry.
 */
export function normalizeParkingLots(input: unknown): ParkingLot[] {
  let source: unknown[] = [];
  if (Array.isArray(input)) {
    source = input;
  } else if (input && typeof input === 'object') {
    const record = input as Record<string, unknown>;
    const candidate = record.lots ?? record.data ?? record.items;
    if (Array.isArray(candidate)) source = candidate;
  }

  const seen = new Set<string>();
  const lots: ParkingLot[] = [];

  source.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    const record = entry as Record<string, unknown>;
    const id = toOptionalString(record.id) ?? toOptionalString(record.code) ?? `lot-${index + 1}`;
    if (seen.has(id)) return;
    seen.add(id);

    const severitySource = record.severity ?? record.status ?? record.level;
    const lot: ParkingLot = {
      id,
      name: toOptionalString(record.name) ?? toOptionalString(record.title) ?? id,
      severity: normalizeParkingSeverity(severitySource),
    };

    const message = toOptionalString(record.message) ?? toOptionalString(record.detail) ?? toOptionalString(record.reason);
    if (message) lot.message = message;
    const updatedAt = toOptionalString(record.updatedAt) ?? toOptionalString(record.updated_at) ?? toOptionalString(record.time);
    if (updatedAt) lot.updatedAt = updatedAt;

    const row = toOptionalInteger(record.row);
    const col = toOptionalInteger(record.col ?? record.column);
    if (row !== undefined && col !== undefined) {
      lot.row = row;
      lot.col = col;
    }

    lots.push(lot);
  });

  return lots;
}

export function summarizeParkingLots(lots: ParkingLot[]): Record<ParkingSeverity, number> {
  const summary: Record<ParkingSeverity, number> = { ok: 0, warning: 0, major: 0, critical: 0 };
  for (const lot of lots) summary[lot.severity] += 1;
  return summary;
}

export function parkingLotTargetHeight(severity: ParkingSeverity): number {
  return severity === 'ok' ? PARKING_OK_HEIGHT : PARKING_ALARM_HEIGHT;
}

/**
 * Place lots on a square grid centred on the platter.
 * Lots with explicit row/col keep their cell; the rest fill free cells row by row.
 */
export function layoutParkingLots(lots: ParkingLot[], options: ParkingLayoutOptions = {}): ParkingLayout {
  const requestedLotSize = Math.max(0.5, options.lotSize ?? DEFAULT_PARKING_LOT_SIZE);
  const requestedGap = Math.max(0, options.gap ?? DEFAULT_PARKING_LOT_GAP);
  const maxSpan = Math.max(requestedLotSize, options.maxSpan ?? DEFAULT_PARKING_MAX_SPAN);

  if (lots.length === 0) {
    return { cells: [], pitch: requestedLotSize + requestedGap, lotSize: requestedLotSize, rows: 0, cols: 0 };
  }

  const occupied = new Set<string>();
  const fixed: Array<{ lot: ParkingLot; row: number; col: number }> = [];
  const auto: ParkingLot[] = [];

  for (const lot of lots) {
    if (lot.row !== undefined && lot.col !== undefined && !occupied.has(`${lot.row}:${lot.col}`)) {
      occupied.add(`${lot.row}:${lot.col}`);
      fixed.push({ lot, row: lot.row, col: lot.col });
    } else {
      auto.push(lot);
    }
  }

  let side = Math.max(1, Math.ceil(Math.sqrt(lots.length)));
  for (const cell of fixed) {
    side = Math.max(side, cell.row + 1, cell.col + 1);
  }

  const placed: Array<{ lot: ParkingLot; row: number; col: number }> = [...fixed];
  let cursor = 0;
  for (const lot of auto) {
    // Walk row-major until a free cell shows up; grow the grid if fixed cells filled it.
    while (true) {
      const row = Math.floor(cursor / side);
      const col = cursor % side;
      cursor += 1;
      if (row >= side) {
        side += 1;
        cursor = 0;
        continue;
      }
      const key = `${row}:${col}`;
      if (occupied.has(key)) continue;
      occupied.add(key);
      placed.push({ lot, row, col });
      break;
    }
  }

  let minRow = Infinity;
  let maxRow = -Infinity;
  let minCol = Infinity;
  let maxCol = -Infinity;
  for (const cell of placed) {
    minRow = Math.min(minRow, cell.row);
    maxRow = Math.max(maxRow, cell.row);
    minCol = Math.min(minCol, cell.col);
    maxCol = Math.max(maxCol, cell.col);
  }

  const rows = maxRow - minRow + 1;
  const cols = maxCol - minCol + 1;
  const steps = Math.max(1, Math.max(rows, cols) - 1);

  let pitch = requestedLotSize + requestedGap;
  let lotSize = requestedLotSize;
  if (Math.max(rows, cols) > 1 && steps * pitch + lotSize > maxSpan) {
    // Give every lot an equal slice of the allowed span; the block keeps a visible gap.
    pitch = maxSpan / (steps + 1);
    lotSize = Math.min(requestedLotSize, pitch * 0.7);
  }

  const centerRow = (minRow + maxRow) / 2;
  const centerCol = (minCol + maxCol) / 2;

  const cells: PlacedParkingLot[] = placed.map((cell) => ({
    lot: cell.lot,
    row: cell.row,
    col: cell.col,
    x: (cell.col - centerCol) * pitch,
    z: (cell.row - centerRow) * pitch,
  }));

  return { cells, pitch, lotSize, rows, cols };
}

function readParam(params: URLSearchParams[], key: string): string | null {
  for (const bag of params) {
    const value = bag.get(key);
    if (value !== null && value !== '') return value;
  }
  return null;
}

/**
 * Monitor mode is switched on by `?mode=monitor`, `#monitor`, `#/monitor` or `#mode=monitor`.
 * `source` overrides the JSON URL, `interval` the polling period in seconds,
 * `rotate` the platter rotation speed (radians per second, `0` for a still wall).
 */
export function resolveParkingMonitorConfig(location: { search?: string; hash?: string }): ParkingMonitorConfig {
  const search = new URLSearchParams(location.search ?? '');
  const rawHash = (location.hash ?? '').replace(/^#\/?/, '');
  const hashParams = new URLSearchParams(rawHash.includes('=') ? rawHash : '');
  const bags = [search, hashParams];

  const hashIsMonitor = /^monitor(?:[/?].*)?$/i.test(rawHash);
  const enabled = readParam(bags, 'mode')?.toLowerCase() === 'monitor' || hashIsMonitor;

  const sourceUrl = readParam(bags, 'source') ?? DEFAULT_PARKING_SOURCE_URL;
  const intervalSeconds = Number(readParam(bags, 'interval'));
  const intervalMs = (Number.isFinite(intervalSeconds) && intervalSeconds > 0
    ? Math.max(MIN_PARKING_POLL_SECONDS, intervalSeconds)
    : DEFAULT_PARKING_POLL_SECONDS) * 1000;

  const rotateParam = readParam(bags, 'rotate');
  const rotateValue = rotateParam === null ? NaN : Number(rotateParam);
  const rotationSpeed = Number.isFinite(rotateValue) ? rotateValue : null;

  return { enabled, sourceUrl, intervalMs, rotationSpeed };
}

/** URL of the same page without monitor-mode switches, used by the "back to visualizer" link. */
export function buildVisualizerUrl(location: { pathname?: string; search?: string; hash?: string }): string {
  const params = new URLSearchParams(location.search ?? '');
  params.delete('mode');
  params.delete('source');
  params.delete('interval');
  params.delete('rotate');
  const query = params.toString();
  return `${location.pathname ?? '/'}${query ? `?${query}` : ''}`;
}
