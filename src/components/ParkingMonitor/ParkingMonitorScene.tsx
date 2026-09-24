import { extend, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MonitorBlockShaderMaterial, type MonitorBlockShaderMaterialInstance } from './MonitorBlockShaderMaterial';
import { themes, type ThemeColors } from '../../lib/themes';
import { DEFAULT_TERRAIN_DENSITY, deriveTerrainGridSettings } from '../../lib/groundEqSettings';
import { DEFAULT_CAMERA_STATE, normalizeCameraState } from '../../lib/sceneDefaults';
import { clampAnimationBlend } from '../../lib/terrainResponse';
import {
  PARKING_BEACON_GAP,
  PARKING_GROUND_HEIGHT,
  PARKING_MONITOR_CAMERA_STORAGE_KEY,
  PARKING_SEVERITY_COLORS,
  PARKING_SEVERITY_LEVEL,
  layoutParkingLots,
  parkingLotTargetHeight,
  type ParkingLot,
  type PlacedParkingLot,
} from '../../lib/parkingMonitor';

extend({ MonitorBlockShaderMaterial });

const HOVER_LINGER_MS = 400;
const HEIGHT_RESPONSE_RATE = 7;
const MIN_FIT_DISTANCE = 30;
const MAX_FIT_DISTANCE = 120;

type BeaconProps = {
  cell: PlacedParkingLot;
  getHeight: () => number;
  onSelect: (lot: ParkingLot) => void;
  onHoverChange: (hovering: boolean) => void;
};

/** Vertical stem + dot above a block, topped by a clickable DOM label with the lot name. */
function LotBeacon({ cell, getHeight, onSelect, onHoverChange }: BeaconProps) {
  const groupRef = useRef<THREE.Group>(null);
  const color = PARKING_SEVERITY_COLORS[cell.lot.severity];

  useFrame(() => {
    if (groupRef.current) groupRef.current.position.y = getHeight();
  });

  return (
    <group ref={groupRef} position={[cell.x, getHeight(), cell.z]}>
      <mesh position={[0, PARKING_BEACON_GAP / 2, 0]}>
        <boxGeometry args={[0.16, PARKING_BEACON_GAP, 0.16]} />
        <meshBasicMaterial color={color} toneMapped={false} transparent opacity={0.85} depthWrite={false} fog={false} />
      </mesh>
      <mesh position={[0, PARKING_BEACON_GAP, 0]}>
        <sphereGeometry args={[0.3, 12, 12]} />
        <meshBasicMaterial color={color} toneMapped={false} fog={false} />
      </mesh>
      <Html position={[0, PARKING_BEACON_GAP + 1.1, 0]} center zIndexRange={[30, 10]} style={{ pointerEvents: 'auto' }}>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSelect(cell.lot);
          }}
          onPointerEnter={() => onHoverChange(true)}
          onPointerLeave={() => onHoverChange(false)}
          className="flex items-center gap-2 whitespace-nowrap rounded-full border bg-black/70 px-4 py-2 text-sm font-semibold tracking-wide text-white shadow-2xl backdrop-blur-md transition-transform hover:scale-105 cursor-pointer select-none"
          style={{ borderColor: color, boxShadow: `0 0 18px ${color}55` }}
        >
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
          {cell.lot.name}
        </button>
      </Html>
    </group>
  );
}

export function ParkingMonitorScene({
  lots,
  themeColors = themes['ink-wash'],
  rotationSpeed = 0,
  terrainDensity = DEFAULT_TERRAIN_DENSITY,
  selectedLotId = null,
  onLotSelect,
}: {
  lots: ParkingLot[];
  themeColors?: ThemeColors;
  rotationSpeed?: number;
  terrainDensity?: number;
  selectedLotId?: string | null;
  onLotSelect?: (lot: ParkingLot) => void;
}) {
  const { camera, gl } = useThree();
  const controlsRef = useRef<any>(null);
  const platterRef = useRef<THREE.Group>(null);
  const platterRotationRef = useRef(0);

  const groundMeshRef = useRef<THREE.InstancedMesh>(null);
  const groundMatRef = useRef<MonitorBlockShaderMaterialInstance>(null);
  const lotMeshRef = useRef<THREE.InstancedMesh>(null);
  const lotMatRef = useRef<MonitorBlockShaderMaterialInstance>(null);

  const grid = useMemo(() => deriveTerrainGridSettings(terrainDensity), [terrainDensity]);
  const layout = useMemo(() => layoutParkingLots(lots), [lots]);
  const lotCount = layout.cells.length;

  const groundStatus = useMemo(() => new Float32Array(grid.instanceCount).fill(-1), [grid.instanceCount]);
  const groundIndex = useMemo(() => Float32Array.from({ length: grid.instanceCount }, (_, i) => i), [grid.instanceCount]);
  const lotStatus = useMemo(() => new Float32Array(Math.max(1, lotCount)), [lotCount]);
  const lotIndex = useMemo(() => Float32Array.from({ length: Math.max(1, lotCount) }, (_, i) => i), [lotCount]);

  // Current animated heights, remembered per lot id so a reload does not replay the rise.
  // Lots seen for the first time start flush with the ground and rise into place.
  const heightByIdRef = useRef(new Map<string, number>());
  const heights = useMemo(() => {
    const known = heightByIdRef.current;
    const next = new Float32Array(Math.max(1, lotCount));
    const liveIds = new Set<string>();
    layout.cells.forEach((cell, i) => {
      next[i] = known.get(cell.lot.id) ?? PARKING_GROUND_HEIGHT;
      liveIds.add(cell.lot.id);
    });
    for (const id of Array.from(known.keys())) {
      if (!liveIds.has(id)) known.delete(id);
    }
    return next;
  }, [layout, lotCount]);

  const tempMatrix = useMemo(() => new THREE.Matrix4(), []);
  const tempPosition = useMemo(() => new THREE.Vector3(), []);
  const tempScale = useMemo(() => new THREE.Vector3(), []);
  const identityQuaternion = useMemo(() => new THREE.Quaternion(), []);

  // --- camera persistence (separate key from the music visualizer) ---
  const saveCamera = useCallback(() => {
    if (!controlsRef.current) return;
    try {
      localStorage.setItem(PARKING_MONITOR_CAMERA_STORAGE_KEY, JSON.stringify({
        position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        target: { x: controlsRef.current.target.x, y: controlsRef.current.target.y, z: controlsRef.current.target.z },
      }));
    } catch (error) {
      console.error('Failed to save monitor camera state', error);
    }
  }, [camera]);

  const hasSavedCameraRef = useRef(false);
  const hasFittedCameraRef = useRef(false);

  useEffect(() => {
    let cameraState = DEFAULT_CAMERA_STATE;
    try {
      const saved = localStorage.getItem(PARKING_MONITOR_CAMERA_STORAGE_KEY);
      if (saved) {
        cameraState = normalizeCameraState(JSON.parse(saved));
        hasSavedCameraRef.current = true;
      }
    } catch (error) {
      console.error('Failed to restore monitor camera state', error);
    }
    camera.position.set(cameraState.position.x, cameraState.position.y, cameraState.position.z);
    const timer = window.setTimeout(() => {
      if (controlsRef.current) {
        controlsRef.current.target.set(cameraState.target.x, cameraState.target.y, cameraState.target.z);
        controlsRef.current.update();
      }
    }, 0);

    window.addEventListener('beforeunload', saveCamera);
    return () => {
      window.clearTimeout(timer);
      saveCamera();
      window.removeEventListener('beforeunload', saveCamera);
    };
  }, [camera, saveCamera]);

  // First load without a saved camera: pull the factory view in so the lot grid fills the screen.
  useEffect(() => {
    if (hasFittedCameraRef.current || hasSavedCameraRef.current || layout.cells.length === 0 || !controlsRef.current) return;
    hasFittedCameraRef.current = true;
    const span = Math.max(layout.rows, layout.cols) * layout.pitch;
    const distance = THREE.MathUtils.clamp(span * 1.7 + 18, MIN_FIT_DISTANCE, MAX_FIT_DISTANCE);
    const direction = new THREE.Vector3(
      DEFAULT_CAMERA_STATE.position.x,
      DEFAULT_CAMERA_STATE.position.y,
      DEFAULT_CAMERA_STATE.position.z,
    ).normalize();
    camera.position.copy(direction.multiplyScalar(distance));
    controlsRef.current.target.set(0, 0, 0);
    controlsRef.current.update();
  }, [layout, camera]);

  // --- static ground grid; cells under a lot are hidden so the slab sits in a clean cut-out ---
  useLayoutEffect(() => {
    const mesh = groundMeshRef.current;
    if (!mesh) return;
    const { gridSize, spacing, boxWidth } = grid;
    const offset = (gridSize * spacing) / 2;
    const clearance = layout.lotSize / 2 + boxWidth / 2;

    // Mark the ground cells covered by each lot footprint (index range per axis, not a full scan).
    const hiddenCells = new Uint8Array(gridSize * gridSize);
    const indexRange = (center: number) => [
      Math.max(0, Math.ceil((center - clearance + offset) / spacing)),
      Math.min(gridSize - 1, Math.floor((center + clearance + offset) / spacing)),
    ];
    for (const cell of layout.cells) {
      const [x0, x1] = indexRange(cell.x);
      const [z0, z1] = indexRange(cell.z);
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) hiddenCells[x * gridSize + z] = 1;
      }
    }

    let i = 0;
    for (let x = 0; x < gridSize; x++) {
      for (let z = 0; z < gridSize; z++) {
        const px = x * spacing - offset;
        const pz = z * spacing - offset;
        const hidden = hiddenCells[i] === 1;
        tempPosition.set(px, PARKING_GROUND_HEIGHT / 2, pz);
        tempScale.set(hidden ? 0 : 1, hidden ? 0 : PARKING_GROUND_HEIGHT, hidden ? 0 : 1);
        tempMatrix.compose(tempPosition, identityQuaternion, tempScale);
        mesh.setMatrixAt(i, tempMatrix);
        i++;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [grid, layout, tempMatrix, tempPosition, tempScale, identityQuaternion]);

  // --- lot status attribute + initial matrices ---
  useLayoutEffect(() => {
    const mesh = lotMeshRef.current;
    if (!mesh) return;
    layout.cells.forEach((cell, i) => {
      lotStatus[i] = PARKING_SEVERITY_LEVEL[cell.lot.severity];
    });
    const statusAttribute = mesh.geometry.getAttribute('aStatus') as THREE.BufferAttribute | undefined;
    if (statusAttribute) statusAttribute.needsUpdate = true;

    layout.cells.forEach((cell, i) => {
      const h = heights[i];
      tempPosition.set(cell.x, h / 2, cell.z);
      tempScale.set(1, h, 1);
      tempMatrix.compose(tempPosition, identityQuaternion, tempScale);
      mesh.setMatrixAt(i, tempMatrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [layout, lotStatus, heights, tempMatrix, tempPosition, tempScale, identityQuaternion]);

  // --- hover / pin state ---
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);
  const hoverTimerRef = useRef<number | null>(null);

  const cancelHoverClear = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  const scheduleHoverClear = useCallback(() => {
    cancelHoverClear();
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      setHoverIndex(null);
    }, HOVER_LINGER_MS);
  }, [cancelHoverClear]);

  useEffect(() => cancelHoverClear, [cancelHoverClear]);

  useEffect(() => {
    // Layout changed (lots reloaded): drop indexes that no longer exist.
    setHoverIndex((current) => (current !== null && current < lotCount ? current : null));
    setPinnedIndex((current) => (current !== null && current < lotCount ? current : null));
  }, [lotCount]);

  useEffect(() => {
    gl.domElement.style.cursor = hoverIndex !== null ? 'pointer' : '';
    return () => {
      gl.domElement.style.cursor = '';
    };
  }, [gl, hoverIndex]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPinnedIndex(null);
        setHoverIndex(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handlePointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (event.instanceId === undefined || event.instanceId >= lotCount) return;
    event.stopPropagation();
    cancelHoverClear();
    setHoverIndex(event.instanceId);
  };

  const handlePointerOut = () => {
    scheduleHoverClear();
  };

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.instanceId === undefined || event.instanceId >= lotCount) return;
    event.stopPropagation();
    const index = event.instanceId;
    setPinnedIndex((current) => (current === index ? null : index));
  };

  const handleBeaconHover = (hovering: boolean, index: number) => {
    if (hovering) {
      cancelHoverClear();
      setHoverIndex(index);
    } else {
      scheduleHoverClear();
    }
  };

  const selectedIndex = useMemo(
    () => (selectedLotId ? layout.cells.findIndex((cell) => cell.lot.id === selectedLotId) : -1),
    [layout, selectedLotId],
  );

  const beaconIndexes = useMemo(() => {
    const set = new Set<number>();
    if (hoverIndex !== null) set.add(hoverIndex);
    if (pinnedIndex !== null) set.add(pinnedIndex);
    if (selectedIndex >= 0) set.add(selectedIndex);
    return Array.from(set).filter((index) => index < lotCount);
  }, [hoverIndex, pinnedIndex, selectedIndex, lotCount]);

  // --- per-frame: platter rotation, theme colour easing, height animation, hover uniform ---
  useFrame((state, delta) => {
    if (platterRef.current) {
      platterRotationRef.current += rotationSpeed * delta;
      platterRef.current.rotation.y = platterRotationRef.current;
    }

    const colorBlend = clampAnimationBlend(3.0 * delta);
    const t = themeColors;
    for (const mat of [groundMatRef.current, lotMatRef.current]) {
      if (!mat) continue;
      mat.uTime = state.clock.getElapsedTime();
      mat.uBaseColor1.lerp(t.uBaseColor1, colorBlend);
      mat.uBaseColor2.lerp(t.uBaseColor2, colorBlend);
      mat.uFogColor.lerp(t.uFogColor, colorBlend);
    }
    if (lotMatRef.current) {
      lotMatRef.current.uHoverIndex = hoverIndex ?? -1;
    }

    const mesh = lotMeshRef.current;
    if (!mesh || lotCount === 0) return;
    const known = heightByIdRef.current;
    const blend = clampAnimationBlend(1 - Math.exp(-HEIGHT_RESPONSE_RATE * delta));
    let dirty = false;
    for (let i = 0; i < lotCount; i++) {
      const cell = layout.cells[i];
      const target = parkingLotTargetHeight(cell.lot.severity);
      const current = heights[i];
      if (Math.abs(current - target) < 0.002) {
        if (current !== target) {
          heights[i] = target;
          known.set(cell.lot.id, target);
          dirty = true;
        }
        continue;
      }
      heights[i] = THREE.MathUtils.lerp(current, target, blend);
      known.set(cell.lot.id, heights[i]);
      dirty = true;
    }
    if (!dirty) return;
    for (let i = 0; i < lotCount; i++) {
      const cell = layout.cells[i];
      const h = heights[i];
      tempPosition.set(cell.x, h / 2, cell.z);
      tempScale.set(1, h, 1);
      tempMatrix.compose(tempPosition, identityQuaternion, tempScale);
      mesh.setMatrixAt(i, tempMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enablePan
        enableRotate
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE }}
        minDistance={5}
        maxDistance={140}
        maxPolarAngle={Math.PI / 2 - 0.1}
        onEnd={saveCamera}
      />

      <group ref={platterRef}>
        <instancedMesh
          key={`ground-${grid.instanceCount}`}
          ref={groundMeshRef}
          args={[undefined as any, undefined as any, grid.instanceCount]}
          frustumCulled={false}
        >
          <boxGeometry args={[grid.boxWidth, 1, grid.boxWidth]}>
            <instancedBufferAttribute attach="attributes-aStatus" args={[groundStatus, 1]} />
            <instancedBufferAttribute attach="attributes-aIndex" args={[groundIndex, 1]} />
          </boxGeometry>
          {/* @ts-ignore */}
          <monitorBlockShaderMaterial ref={groundMatRef} transparent={true} />
        </instancedMesh>

        {lotCount > 0 && (
          <instancedMesh
            key={`lots-${lotCount}-${layout.lotSize}`}
            ref={lotMeshRef}
            args={[undefined as any, undefined as any, lotCount]}
            frustumCulled={false}
            onPointerMove={handlePointerMove}
            onPointerOut={handlePointerOut}
            onClick={handleClick}
            onPointerMissed={() => setPinnedIndex(null)}
          >
            <boxGeometry args={[layout.lotSize, 1, layout.lotSize]}>
              <instancedBufferAttribute attach="attributes-aStatus" args={[lotStatus, 1]} />
              <instancedBufferAttribute attach="attributes-aIndex" args={[lotIndex, 1]} />
            </boxGeometry>
            {/* @ts-ignore */}
            <monitorBlockShaderMaterial ref={lotMatRef} transparent={true} />
          </instancedMesh>
        )}

        {beaconIndexes.map((index) => {
          const cell = layout.cells[index];
          if (!cell) return null;
          return (
            <LotBeacon
              key={cell.lot.id}
              cell={cell}
              getHeight={() => heights[index] ?? PARKING_GROUND_HEIGHT}
              onSelect={(lot) => onLotSelect?.(lot)}
              onHoverChange={(hovering) => handleBeaconHover(hovering, index)}
            />
          );
        })}
      </group>
    </>
  );
}
