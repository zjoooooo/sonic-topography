import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeParkingLots, type ParkingLot } from '../../lib/parkingMonitor';

export interface ParkingLotsState {
  lots: ParkingLot[];
  error: string | null;
  lastUpdated: number | null;
  loading: boolean;
}

/**
 * Poll a JSON endpoint for parking-lot statuses.
 * The last good list is kept when a fetch fails, so the wall never goes blank on a hiccup.
 */
export function useParkingLots(sourceUrl: string, intervalMs: number) {
  const [state, setState] = useState<ParkingLotsState>({ lots: [], error: null, lastUpdated: null, loading: true });
  const lastSerializedRef = useRef<string>('');

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(sourceUrl, { cache: 'no-store', signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const lots = normalizeParkingLots(payload);
      // Keep the same array identity when nothing changed so the scene skips a relayout.
      // Decide outside the updater: React StrictMode runs updaters twice, so they must stay pure.
      const serialized = JSON.stringify(lots);
      const unchanged = serialized === lastSerializedRef.current;
      lastSerializedRef.current = serialized;
      const receivedAt = Date.now();
      setState((previous) => ({
        lots: unchanged ? previous.lots : lots,
        error: null,
        lastUpdated: receivedAt,
        loading: false,
      }));
    } catch (error) {
      if (signal?.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      setState((previous) => ({ ...previous, error: message, loading: false }));
    }
  }, [sourceUrl]);

  useEffect(() => {
    const controller = new AbortController();
    lastSerializedRef.current = '';
    setState((previous) => ({ ...previous, loading: true }));
    void load(controller.signal);
    const timer = window.setInterval(() => {
      void load(controller.signal);
    }, Math.max(1000, intervalMs));
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [load, intervalMs]);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  return { ...state, refresh };
}
