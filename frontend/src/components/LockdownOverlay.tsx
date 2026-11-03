import React, { useEffect } from 'react';
import { Unlock, AlertOctagon, Siren } from 'lucide-react';
import { soundEngine } from '../utils/audioAlert';

interface LockdownOverlayProps {
  isActive: boolean;
  onDeactivate: () => void;
  zone: string;
}

export const LockdownOverlay: React.FC<LockdownOverlayProps> = ({
  isActive,
  onDeactivate,
  zone,
}) => {
  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => {
      soundEngine.playLockdownSiren();
    }, 1200);
    return () => clearInterval(interval);
  }, [isActive]);

  if (!isActive) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(28rem,calc(100vw-2rem))] pointer-events-none">
      <div
        role="alert"
        aria-live="assertive"
        className="pointer-events-auto bg-white/95 backdrop-blur border-2 border-red-600 rounded-2xl p-4 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <div className="flex items-center gap-1 text-red-600 shrink-0 pt-0.5">
            <Siren className="w-5 h-5 animate-pulse" />
            <AlertOctagon className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-mono font-bold tracking-widest text-red-700 uppercase">
              Local lockdown alert • {zone}
            </div>
            <p className="mt-1 text-xs font-mono text-zinc-700">
              Live camera feeds remain active. This dashboard does not control physical doors or notify an external response team.
            </p>
            <button
              id="btn-deactivate-lockdown"
              onClick={onDeactivate}
              className="mt-3 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-mono font-bold text-[11px] tracking-wide uppercase transition-all shadow active:scale-95"
            >
              <Unlock className="w-3.5 h-3.5" />
              <span>Deactivate (Admin Required)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
