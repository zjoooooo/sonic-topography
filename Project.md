# Parking Monitor Mode

Sonic Topography can run as a parking-lot status wall instead of a music visualizer.
Every parking lot becomes one block on the 3D platter:

| State | Height | Colour |
| --- | --- | --- |
| No problem | low block, half the alarm height | grass green `#52c95b` |
| Warning | alarm height | yellow `#ffd43b` |
| Major | alarm height | orange `#ff8c2e` |
| Critical | alarm height | red `#ff3c41` |

All problem blocks rise to exactly the same alarm height; only the colour tells the severity apart.
Healthy lots are a low green block at exactly half that height, so the wall has two clean levels.
The ground stays flat (no idle wave animation) so the blocks are the only relief.

Hovering a block shows a beacon above it: a thin stem, a dot, and a label with the lot name
floating a fixed distance above the block top. The label is a button; clicking it opens the
detail card in the top-right corner. Clicking the block itself pins its beacon (useful on touch
screens); `Esc` or clicking empty space unpins it.

## Opening the monitor

Start the dev server (`npm run dev`) and open:

```text
http://127.0.0.1:3000/?mode=monitor
```

The following switches are recognised in the query string or the hash (`#mode=monitor&...`):

| Parameter | Default | Meaning |
| --- | --- | --- |
| `mode=monitor` (or `#monitor`) | off | turn monitor mode on |
| `source=<url>` | `/parking-lots.json` | JSON endpoint to poll |
| `interval=<seconds>` | `10` | polling period, minimum `2` |
| `rotate=<radians per second>` | saved visualizer setting | platter rotation; `rotate=0` gives a still wall |

A larger sample with 500 lots ships in `public/parking-lots-500.json`:

```text
http://127.0.0.1:3000/?mode=monitor&source=/parking-lots-500.json&rotate=0
```

Regenerate a sample of any size with `node scripts/gen-parking-lots.mjs <count> <output>`.

Example with a real backend polled every 5 seconds:

```text
http://127.0.0.1:3000/?mode=monitor&source=http%3A%2F%2F10.0.0.5%3A8000%2Fapi%2Flots&interval=5
```

Theme colours, terrain density, and platter rotation speed are taken from the settings saved in
the normal visualizer; `rotate=0` overrides the rotation for the monitor only.
On the first visit the camera is pulled in so the lot grid fills the view; drag to orbit, scroll to
zoom, and the view is remembered (under its own storage key, separate from the music visualizer).
"Back to visualizer" in the legend panel returns to the music mode.

## Data format

The endpoint returns JSON. Either a bare array or an object with a `lots` (or `data` / `items`) array:

```json
{
  "lots": [
    { "id": "P01", "name": "东门停车场", "severity": "ok" },
    { "id": "P07", "name": "医院停车场", "severity": "critical", "message": "出口道闸故障", "updatedAt": "2026-09-24T07:55:00+08:00" },
    { "id": "P20", "name": "固定位置", "severity": "warning", "row": 0, "col": 3 }
  ]
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `id` (or `code`) | yes | unique key; duplicates keep the first entry; missing ids become `lot-<n>` |
| `name` (or `title`) | no | label shown on the beacon; defaults to the id |
| `severity` (or `status` / `level`) | no | see mapping below; missing means `ok` |
| `message` (or `detail` / `reason`) | no | shown on the detail card |
| `updatedAt` (or `updated_at` / `time`) | no | shown on the detail card |
| `row`, `col` | no | fixed grid cell; lots without both are auto-placed row by row |

Severity mapping (case-insensitive):

| Result | Accepted values |
| --- | --- |
| `ok` | `ok`, `normal`, `healthy`, `fine`, `good`, `online`, `green`, `cyan`, `none`, `info`, `0`, `true` |
| `warning` | `warning`, `warn`, `minor`, `low`, `yellow`, `attention`, `1` |
| `major` | `major`, `error`, `high`, `orange`, `degraded`, `2` |
| `critical` | `critical`, `fatal`, `alarm`, `emergency`, `offline`, `down`, `red`, `3`, `false` |

Any other value is shown as `warning` so an unknown state is never painted as healthy.

Lots are laid out on a centred square grid. When the grid would be wider than the visible platter
(about 100 units) the spacing shrinks automatically so every lot stays in view.

If a poll fails, the last good list stays on screen and the error is shown in the legend panel.

## Files

| File | Role |
| --- | --- |
| `src/lib/parkingMonitor.ts` | data model, severity mapping, grid layout, URL config (pure, unit-tested) |
| `src/lib/parkingMonitor.test.ts` | Node tests: `npx tsx src/lib/parkingMonitor.test.ts` |
| `src/components/ParkingMonitor/ParkingMonitorView.tsx` | full-page monitor: Canvas + overlay, selection state |
| `src/components/ParkingMonitor/ParkingMonitorScene.tsx` | ground grid, lot blocks, height animation, hover/pin, beacons |
| `src/components/ParkingMonitor/MonitorBlockShaderMaterial.ts` | shader for ground cells and status blocks |
| `src/components/ParkingMonitor/ParkingMonitorOverlay.tsx` | legend, counts, source/error line, detail card |
| `src/components/ParkingMonitor/useParkingLots.ts` | polling hook |
| `public/parking-lots.json` | sample data used by the default source URL |
| `public/parking-lots-500.json` | 500-lot sample for load and layout checks |
| `scripts/gen-parking-lots.mjs` | generator for sample files of any size |
| `src/App.tsx` | switches to `ParkingMonitorView` when the URL enables monitor mode |

Tunable constants live at the top of `src/lib/parkingMonitor.ts`:
`PARKING_ALARM_HEIGHT` (problem block height; healthy blocks are half of it), `PARKING_BEACON_GAP` (label distance
above the block), `DEFAULT_PARKING_LOT_SIZE` / `DEFAULT_PARKING_LOT_GAP` (block footprint and spacing).
