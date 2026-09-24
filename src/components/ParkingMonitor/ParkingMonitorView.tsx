import { Canvas } from '@react-three/fiber';
import { useMemo, useState } from 'react';
import { ParkingMonitorScene } from './ParkingMonitorScene';
import { ParkingMonitorOverlay } from './ParkingMonitorOverlay';
import { useParkingLots } from './useParkingLots';
import { DEFAULT_CAMERA_POSITION } from '../../lib/sceneDefaults';
import { type ThemeColors } from '../../lib/themes';
import { buildVisualizerUrl, type ParkingMonitorConfig } from '../../lib/parkingMonitor';

/**
 * Full-page parking monitor: the 3D platter plus the legend / detail overlay.
 * Rendered by App instead of the music visualizer when monitor mode is switched on.
 */
export function ParkingMonitorView({
  config,
  themeColors,
  rotationSpeed,
  terrainDensity,
  backdropColor,
}: {
  config: ParkingMonitorConfig;
  themeColors: ThemeColors;
  rotationSpeed: number;
  terrainDensity?: number;
  backdropColor: string;
}) {
  const { lots, error, lastUpdated, loading, refresh } = useParkingLots(config.sourceUrl, config.intervalMs);
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);
  const selected = useMemo(() => lots.find((lot) => lot.id === selectedLotId) ?? null, [lots, selectedLotId]);
  const visualizerUrl = useMemo(() => buildVisualizerUrl(window.location), []);

  return (
    <div className="relative min-h-[100dvh] w-screen overflow-hidden font-sans transition-colors duration-1000" style={{ backgroundColor: backdropColor }}>
      <div className="absolute inset-0 z-0">
        <Canvas camera={{ position: DEFAULT_CAMERA_POSITION, fov: 45 }}>
          <ParkingMonitorScene
            lots={lots}
            themeColors={themeColors}
            rotationSpeed={config.rotationSpeed ?? rotationSpeed}
            terrainDensity={terrainDensity}
            selectedLotId={selectedLotId}
            bloom={config.bloom}
            onLotSelect={(lot) => setSelectedLotId(lot.id)}
          />
        </Canvas>
      </div>
      <ParkingMonitorOverlay
        lots={lots}
        error={error}
        lastUpdated={lastUpdated}
        loading={loading}
        sourceUrl={config.sourceUrl}
        selected={selected}
        visualizerUrl={visualizerUrl}
        onRefresh={refresh}
        onCloseSelected={() => setSelectedLotId(null)}
      />
    </div>
  );
}
