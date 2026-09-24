import { t, useLanguage } from '../../lib/i18n';
import {
  PARKING_SEVERITIES,
  PARKING_SEVERITY_COLORS,
  summarizeParkingLots,
  type ParkingLot,
  type ParkingSeverity,
} from '../../lib/parkingMonitor';

function formatTime(timestamp: number | null) {
  if (!timestamp) return null;
  return new Date(timestamp).toLocaleTimeString([], { hour12: false });
}

function SeverityBadge({ severity, lang }: { severity: ParkingSeverity; lang: 'zh' | 'en' }) {
  const color = PARKING_SEVERITY_COLORS[severity];
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide text-white"
      style={{ borderColor: color, background: `${color}22` }}
    >
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
      {t(`monitor.severity.${severity}`, lang)}
    </span>
  );
}

export function ParkingMonitorOverlay({
  lots,
  error,
  lastUpdated,
  loading,
  sourceUrl,
  selected,
  visualizerUrl,
  onRefresh,
  onCloseSelected,
}: {
  lots: ParkingLot[];
  error: string | null;
  lastUpdated: number | null;
  loading: boolean;
  sourceUrl: string;
  selected: ParkingLot | null;
  visualizerUrl: string;
  onRefresh: () => void;
  onCloseSelected: () => void;
}) {
  const lang = useLanguage();
  const summary = summarizeParkingLots(lots);
  const updatedLabel = formatTime(lastUpdated);
  const panelClass = 'pointer-events-auto rounded-xl border border-white/10 bg-black/60 text-white shadow-2xl backdrop-blur-[20px]';

  return (
    <div className="absolute inset-0 z-10 pointer-events-none select-none" style={{ fontFamily: "'Helvetica Neue', Arial, sans-serif" }}>
      <div className={`${panelClass} absolute left-6 top-6 w-[320px] max-w-[calc(100vw-48px)] p-5`}>
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-lg font-black tracking-widest">{t('monitor.title', lang)}</h1>
          <span className="text-xs text-white/60">{t('monitor.total', lang).replace('{count}', String(lots.length))}</span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {PARKING_SEVERITIES.map((severity) => {
            const color = PARKING_SEVERITY_COLORS[severity];
            return (
              <div key={severity} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                <span className="flex items-center gap-2 text-xs font-semibold tracking-wide">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color, boxShadow: `0 0 10px ${color}88` }} />
                  {t(`monitor.severity.${severity}`, lang)}
                </span>
                <span className="font-mono text-base font-semibold" style={{ color }}>{summary[severity]}</span>
              </div>
            );
          })}
        </div>

        <div className="mt-4 space-y-1 text-xs text-white/60">
          <div>
            {t('monitor.updated', lang)}: {updatedLabel ?? t('monitor.never', lang)}
            {loading && <span className="ml-2 animate-pulse text-white/40">…</span>}
          </div>
          <div className="truncate" title={sourceUrl}>
            {t('monitor.source', lang)}: <span className="font-mono text-white/70">{sourceUrl}</span>
          </div>
          {error && (
            <div className="rounded-md border px-2 py-1 font-mono text-[11px]" style={{ borderColor: PARKING_SEVERITY_COLORS.critical, color: PARKING_SEVERITY_COLORS.critical }}>
              {t('monitor.error', lang)}: {error}
            </div>
          )}
          {!error && !loading && lots.length === 0 && <div style={{ color: PARKING_SEVERITY_COLORS.warning }}>{t('monitor.empty', lang)}</div>}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs font-semibold tracking-widest hover:bg-white/20 cursor-pointer"
          >
            {t('monitor.refresh', lang)}
          </button>
          <a href={visualizerUrl} className="text-xs text-white/60 underline-offset-4 hover:text-white hover:underline">
            {t('monitor.exit', lang)}
          </a>
        </div>
      </div>

      {selected && (
        <div className={`${panelClass} absolute right-6 top-6 w-[340px] max-w-[calc(100vw-48px)] p-5`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-lg font-black tracking-wide">{selected.name}</div>
              <div className="mt-2">
                <SeverityBadge severity={selected.severity} lang={lang} />
              </div>
            </div>
            <button
              type="button"
              onClick={onCloseSelected}
              aria-label={t('monitor.detail.close', lang)}
              className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold tracking-widest text-white/70 hover:bg-white/10 hover:text-white cursor-pointer"
            >
              ✕
            </button>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-white/85">{selected.message ?? t('monitor.detail.noMessage', lang)}</p>
          <dl className="mt-4 space-y-1 text-xs text-white/60">
            <div className="flex gap-2">
              <dt className="w-16 shrink-0">{t('monitor.detail.id', lang)}</dt>
              <dd className="font-mono text-white/80">{selected.id}</dd>
            </div>
            {selected.updatedAt && (
              <div className="flex gap-2">
                <dt className="w-16 shrink-0">{t('monitor.detail.updated', lang)}</dt>
                <dd className="font-mono text-white/80">{selected.updatedAt}</dd>
              </div>
            )}
          </dl>
        </div>
      )}

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/40 px-4 py-1.5 text-[11px] tracking-widest text-white/50 backdrop-blur-md">
        {t('monitor.hint', lang)}
      </div>
    </div>
  );
}
