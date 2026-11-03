import React from 'react';
import { AlertOctagon, BellOff, CheckCircle2, ChevronRight, ShieldAlert, Siren, UserX } from 'lucide-react';
import { SecurityIncident } from '@shared/types';

interface AlertBannerProps {
  activeIncidents: SecurityIncident[];
  onAcknowledge: (incidentId: string) => void;
  onDispatchSecurity: (incidentId: string) => void;
  onViewDetails: (incident: SecurityIncident) => void;
  onSilenceAll: () => void;
}

export const AlertBanner: React.FC<AlertBannerProps> = ({
  activeIncidents,
  onAcknowledge,
  onDispatchSecurity,
  onViewDetails,
  onSilenceAll,
}) => {
  if (activeIncidents.length === 0) return null;

  const highestPriorityIncident = activeIncidents[0];
  const count = activeIncidents.length;

  const isCritical = highestPriorityIncident.threatLevel === 'CRITICAL';
  const isHigh = highestPriorityIncident.threatLevel === 'HIGH';

  const unauthFaces = highestPriorityIncident.faces.filter(
    (f) => f.status === 'UNAUTHORIZED' || f.status === 'SUSPICIOUS' || f.status === 'UNKNOWN'
  );

  return (
    <div
      id="surveillance-active-alert-banner"
      className={`border-b transition-all duration-300 relative overflow-hidden ${
        isCritical
          ? 'bg-red-50 border-red-200 text-red-950'
          : isHigh
          ? 'bg-rose-50 border-rose-200 text-rose-950'
          : 'bg-amber-50 border-amber-200 text-amber-950'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          {/* Main Info */}
          <div className="flex items-start sm:items-center gap-3">
            <div
              className={`p-2.5 rounded-xl flex-shrink-0 ${
                isCritical
                  ? 'bg-red-600 text-white animate-pulse shadow-md shadow-red-600/30'
                  : isHigh
                  ? 'bg-red-600 text-white'
                  : 'bg-amber-600 text-white'
              }`}
            >
              <Siren className="w-5 h-5" />
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold text-[10px] uppercase px-2 py-0.5 rounded bg-red-600 text-white tracking-wider">
                  SECURITY ALERT • {highestPriorityIncident.threatLevel}
                </span>
                <span className="font-mono text-xs text-zinc-700 bg-white/80 px-2 py-0.5 rounded border border-red-200">
                  Channel: <strong className="text-zinc-950">{highestPriorityIncident.channelName || (highestPriorityIncident.channelNumber ? `CAM 0${highestPriorityIncident.channelNumber}` : 'Active Feed')}</strong>
                </span>
                <span className="font-mono text-xs text-zinc-600">
                  Zone: <strong className="text-zinc-950">{highestPriorityIncident.zone}</strong>
                </span>
                {count > 1 && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white border border-red-200 font-mono font-bold text-red-700">
                    +{count - 1} more camera breach{count - 1 > 1 ? 'es' : ''}
                  </span>
                )}
              </div>

              <div className="text-sm font-bold mt-1 flex items-center gap-2 text-zinc-900">
                <UserX className="w-4 h-4 text-red-600 flex-shrink-0" />
                <span>
                  {unauthFaces.length > 0
                    ? `[${highestPriorityIncident.channelName || (highestPriorityIncident.channelNumber ? `CAM 0${highestPriorityIncident.channelNumber}` : 'Feed')}] Unauthorized subject detected: ${unauthFaces[0].threatReason || 'Unrecognized face in sector'}`
                    : highestPriorityIncident.title}
                </span>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center flex-wrap gap-2 w-full md:w-auto justify-end">
            <button
              id="btn-dispatch-security"
              onClick={() => onDispatchSecurity(highestPriorityIncident.id)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-red-600 hover:bg-red-700 text-white shadow-sm transition-all uppercase tracking-wide"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Dispatch Security</span>
            </button>

            <button
              id="btn-acknowledge-alert"
              onClick={() => onAcknowledge(highestPriorityIncident.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white hover:bg-zinc-50 text-zinc-800 border border-zinc-300 shadow-sm transition-all"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Acknowledge</span>
            </button>

            <button
              id="btn-view-alert-details"
              onClick={() => onViewDetails(highestPriorityIncident)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-900 hover:bg-zinc-800 text-white shadow-sm transition-all"
            >
              <span>Forensic View</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>

            <button
              id="btn-silence-siren"
              onClick={onSilenceAll}
              title="Silence siren audio"
              className="p-2 rounded-lg bg-white border border-zinc-300 hover:bg-zinc-100 text-zinc-600 hover:text-zinc-900 shadow-sm transition-all"
            >
              <BellOff className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
