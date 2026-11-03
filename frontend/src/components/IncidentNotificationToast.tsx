import React from 'react';
import { AlertTriangle, ArrowUpRight, X } from 'lucide-react';
import type { SecurityIncident } from '@shared/types';

interface IncidentNotificationToastProps {
  incident: SecurityIncident;
  count: number;
  onView: () => void;
  onDismiss: () => void;
}

export const IncidentNotificationToast: React.FC<IncidentNotificationToastProps> = ({
  incident,
  count,
  onView,
  onDismiss,
}) => {
  const isReview = incident.category === 'IDENTITY_REVIEW';
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`fixed right-4 top-4 z-[70] w-[min(24rem,calc(100vw-2rem))] rounded-xl border p-4 shadow-xl ${
        isReview ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-red-300 bg-red-50 text-red-950'
      }`}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className={`mt-0.5 h-5 w-5 shrink-0 ${isReview ? 'text-amber-600' : 'text-red-600'}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black">
            {isReview ? 'Identity review required' : 'New security incident'}
            {count > 1 ? ` (+${count - 1} more)` : ''}
          </p>
          <p className="mt-1 truncate text-xs font-semibold">{incident.title}</p>
          <p className="mt-0.5 text-xs opacity-80">{incident.zone} · {incident.channelName || 'Camera feed'}</p>
          <button
            type="button"
            onClick={onView}
            className="mt-3 inline-flex items-center gap-1 rounded-md bg-zinc-950 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-zinc-800"
          >
            Open incident log <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss incident notification"
          className="rounded-md p-1 opacity-70 hover:bg-black/5 hover:opacity-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
