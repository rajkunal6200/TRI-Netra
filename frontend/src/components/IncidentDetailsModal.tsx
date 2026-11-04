import React, { useState } from 'react';
import { 
  ShieldAlert, 
  MapPin, 
  Clock, 
  UserX, 
  UserCheck, 
  CheckCircle2, 
  Siren, 
  Download, 
  FileSpreadsheet,
  Layers,
  Sparkles,
  Eye,
  Camera,
  User,
  Maximize2
} from 'lucide-react';
import { SecurityIncident, LocationBreadcrumb } from '@shared/types';

interface IncidentDetailsModalProps {
  incident: SecurityIncident | null;
  onClose: () => void;
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
  onDispatchTeam: (id: string) => void;
  onForensicReview: (id: string) => void;
}

export const IncidentDetailsModal: React.FC<IncidentDetailsModalProps> = ({
  incident,
  onClose,
  onAcknowledge,
  onResolve,
  onDispatchTeam,
  onForensicReview,
}) => {
  const [viewMode, setViewMode] = useState<'isolated' | 'full'>('isolated');
  if (!incident) return null;

  const isCritical = incident.threatLevel === 'CRITICAL';
  const isHigh = incident.threatLevel === 'HIGH';

  const activeImageUrl = viewMode === 'full' && incident.fullSceneFrameUrl
    ? incident.fullSceneFrameUrl
    : incident.croppedFaceUrl || incident.capturedFrameUrl;

  const downloadFrame = () => {
    if (!activeImageUrl) return;
    const a = document.createElement('a');
    a.href = activeImageUrl;
    a.download = `incident-${incident.id}-${viewMode === 'full' ? 'scene' : 'subject-portrait'}.jpg`;
    a.click();
  };

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white border border-zinc-200 rounded-2xl max-w-3xl w-full p-6 shadow-2xl space-y-4 my-6">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-zinc-200 pb-3 gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`text-xs font-mono font-bold px-2 py-0.5 rounded uppercase ${
                  isCritical
                    ? 'bg-red-600 text-white animate-pulse'
                    : isHigh
                    ? 'bg-red-600 text-white'
                    : 'bg-amber-600 text-white'
                }`}
              >
                {incident.threatLevel} THREAT
              </span>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-zinc-100 text-zinc-800 border border-zinc-200 font-semibold">
                STATUS: {incident.status}
              </span>
              {incident.category === 'IDENTITY_REVIEW' && (
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-300 font-bold">
                  IDENTITY REVIEW · NOT CONFIRMED UNAUTHORIZED
                </span>
              )}
              {incident.totalSubjectsInScene && incident.totalSubjectsInScene > 1 && (
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-purple-50 text-purple-900 border border-purple-200 font-bold flex items-center gap-1">
                  <User className="w-3 h-3 text-purple-700" />
                  SUBJECT #{incident.subjectIndex} (OF {incident.totalSubjectsInScene})
                </span>
              )}
            </div>
            <h2 className="text-base sm:text-lg font-bold text-zinc-950 mt-1">
              {incident.title}
            </h2>
            <div className="flex items-center gap-3 text-xs font-mono text-zinc-500 mt-0.5 flex-wrap">
              <span className="flex items-center gap-1 font-medium">
                <MapPin className="w-3.5 h-3.5 text-zinc-500" />
                {incident.zone} ({incident.channelName || 'Camera Feed'})
              </span>
              <span>•</span>
              <span className="flex items-center gap-1 font-medium">
                <Clock className="w-3.5 h-3.5 text-zinc-500" />
                {new Date(incident.timestamp).toLocaleTimeString()}
              </span>

              {incident.sightingsCount && incident.sightingsCount > 1 ? (
                <>
                  <span>•</span>
                  <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200 font-bold flex items-center gap-1">
                    <Eye className="w-3 h-3 text-blue-600" />
                    Seen {incident.sightingsCount} times
                  </span>
                </>
              ) : null}

              {incident.isProperlyVisible === false && (
                <>
                  <span>•</span>
                  <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-300 font-bold flex items-center gap-1">
                    <Camera className="w-3 h-3 text-amber-700" />
                    Face Not Properly Visible (Snapshot Saved)
                  </span>
                </>
              )}
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-950 font-mono text-sm p-1 rounded-lg hover:bg-zinc-100"
          >
            ✕ Close
          </button>
        </div>

        {/* Snapshot Forensic Image with HUD Frame & Mode Toggle */}
        <div className="space-y-2">
          {incident.fullSceneFrameUrl && incident.fullSceneFrameUrl !== incident.croppedFaceUrl && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 p-1 bg-zinc-100 rounded-lg border border-zinc-200 text-xs font-mono">
                <button
                  onClick={() => setViewMode('isolated')}
                  className={`flex items-center gap-1 px-3 py-1 rounded-md font-bold transition-all ${
                    viewMode === 'isolated'
                      ? 'bg-white text-zinc-950 shadow-xs border border-zinc-200'
                      : 'text-zinc-600 hover:text-zinc-950'
                  }`}
                >
                  <User className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Isolated Person Photo</span>
                </button>
                <button
                  onClick={() => setViewMode('full')}
                  className={`flex items-center gap-1 px-3 py-1 rounded-md font-bold transition-all ${
                    viewMode === 'full'
                      ? 'bg-white text-zinc-950 shadow-xs border border-zinc-200'
                      : 'text-zinc-600 hover:text-zinc-950'
                  }`}
                >
                  <Maximize2 className="w-3.5 h-3.5 text-zinc-600" />
                  <span>Full Multi-Subject Scene</span>
                </button>
              </div>

              <span className="text-[11px] font-mono text-zinc-500 font-medium">
                {viewMode === 'isolated' ? 'Showing isolated portrait of this person only' : 'Showing wide multi-subject camera frame'}
              </span>
            </div>
          )}

          <div className="relative rounded-xl overflow-hidden bg-zinc-950 border border-zinc-200 aspect-video flex items-center justify-center">
            {activeImageUrl ? (
              <img
                src={activeImageUrl}
                alt="Security Evidence Capture"
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="text-zinc-400 text-xs font-mono">No image recorded</div>
            )}

            <div className="absolute top-2 left-2 px-2.5 py-1 rounded bg-zinc-950/80 backdrop-blur border border-zinc-700 text-[10px] font-mono text-zinc-200 font-bold shadow-sm flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
              <span>
                {viewMode === 'isolated'
                  ? `ISOLATED SUBJECT PORTRAIT • PERSON ONLY • ${incident.id}`
                  : `MULTI-SUBJECT ROOM CONTEXT • ${incident.id}`}
              </span>
            </div>

            <button
              onClick={downloadFrame}
              className="absolute bottom-2 right-2 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/90 hover:bg-white backdrop-blur border border-zinc-300 text-[11px] font-mono text-zinc-900 font-bold transition-all shadow-sm"
            >
              <Download className="w-3 h-3 text-zinc-700" />
              <span>{viewMode === 'isolated' ? 'Download Person Portrait' : 'Download Scene'}</span>
            </button>
          </div>
        </div>

        {/* Complete Multi-Camera Location & Sighting Trail */}
        {(() => {
          const trail: LocationBreadcrumb[] = (incident.locationHistory && incident.locationHistory.length > 0)
            ? incident.locationHistory
            : [
                {
                  zone: incident.zone,
                  channelId: incident.channelId,
                  channelName: incident.channelName || `CAM 0${incident.channelNumber || 1}`,
                  channelNumber: incident.channelNumber,
                  timestamp: incident.firstSeenTimestamp || incident.timestamp,
                  capturedFrameUrl: incident.capturedFrameUrl,
                },
              ];
          const uniqueLocationCount = new Set(trail.map((t) => `${t.zone}:${t.channelId || t.channelName || t.channelNumber || ''}`)).size;

          return (
            <div className="space-y-2.5 bg-zinc-50 border border-zinc-200 rounded-xl p-3.5 shadow-2xs">
              <div className="flex items-center justify-between text-xs font-mono font-bold text-zinc-900 uppercase">
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-red-600" />
                  All Detected Locations & Sightings ({uniqueLocationCount} {uniqueLocationCount === 1 ? 'camera/location' : 'cameras/locations'}, {incident.sightingsCount || trail.length} detections)
                </span>
                <span className="text-[10px] text-zinc-500 font-semibold font-mono">
                  Most recent detection per camera
                </span>
              </div>

              {/* Breadcrumb Map Summary Strip */}
              <div className="flex items-center flex-wrap gap-1.5 p-2 bg-white rounded-lg border border-zinc-200">
                <span className="text-[10px] font-mono font-bold text-zinc-500 uppercase mr-1">Locations:</span>
                {trail.map((crumb, cIdx) => {
                  const isCurrent = cIdx === trail.length - 1;
                  return (
                    <React.Fragment key={cIdx}>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                          isCurrent
                            ? 'bg-red-50 text-red-700 border-red-200 shadow-2xs'
                            : 'bg-zinc-100 text-zinc-700 border-zinc-200'
                        }`}
                      >
                        <span>{crumb.zone}</span>
                        {crumb.channelName && (
                          <span className="text-[9px] opacity-75 font-normal">({crumb.channelName})</span>
                        )}
                        {isCurrent && (
                          <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-ping ml-0.5" />
                        )}
                      </span>
                      {cIdx < trail.length - 1 && (
                        <span className="text-zinc-400 text-xs font-bold font-mono">➔</span>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>

              {/* Most recent sighting per camera/location */}
              <div className="relative pl-4 space-y-3 mt-2 before:content-[''] before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-zinc-300">
                {trail.map((crumb, cIdx) => {
                  const isCurrent = cIdx === trail.length - 1;
                  const thumb = crumb.capturedFrameUrl || incident.capturedFrameUrl;

                  return (
                    <div key={cIdx} className="relative flex items-center justify-between text-xs bg-white p-2 rounded-lg border border-zinc-200/80 shadow-2xs">
                      <span
                        className={`absolute -left-4 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-white ${
                          isCurrent ? 'bg-red-600 ring-2 ring-red-300' : 'bg-zinc-400'
                        }`}
                      />
                      <div className="flex items-center gap-2.5 min-w-0">
                        {thumb && (
                          <img
                            src={thumb}
                            alt={crumb.zone}
                            className="w-8 h-8 rounded object-cover border border-zinc-200 shrink-0"
                          />
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-zinc-950 font-mono truncate">
                              {crumb.zone}
                            </span>
                            {isCurrent && (
                              <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-800 font-mono text-[9px] font-bold">
                                CURRENT
                              </span>
                            )}
                          </div>
                          <span className="text-zinc-500 text-[10px] font-mono">
                            {crumb.channelName || `CAM 0${crumb.channelNumber || 1}`}
                          </span>
                        </div>
                      </div>
                      <span className="text-zinc-500 font-mono text-[10px] shrink-0 font-medium text-right">
                        <span className="block">Last {new Date(crumb.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                        <span className="block">First {new Date(crumb.firstSeenTimestamp || crumb.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · {crumb.sightingsCount || 1} scans</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Breakdown of Identified Subject */}
        <div className="space-y-2">
          <div className="text-xs font-mono font-bold text-zinc-800 uppercase flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-zinc-700" />
              Identified Subject (Person #{incident.subjectIndex || 1})
            </span>
            {incident.totalSubjectsInScene && incident.totalSubjectsInScene > 1 && (
              <span className="text-[10px] font-mono text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200 font-bold">
                Subject #{incident.subjectIndex} of {incident.totalSubjectsInScene} (Separate Incident Record)
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2.5">
            {(incident.faces && incident.faces.length > 0 ? [incident.faces[0]] : []).map((face, fIdx) => {
              const isAuth = face.status === 'AUTHORIZED';
              const isUnverified = face.status === 'UNKNOWN' || face.status === 'SUSPICIOUS';
              const portraitUrl = face.croppedFaceUrl || incident.croppedFaceUrl || incident.capturedFrameUrl;

              return (
                <div
                  key={fIdx}
                  className={`p-3 rounded-xl border text-xs flex items-start gap-3 ${
                    isAuth
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      : isUnverified
                      ? 'bg-amber-50 border-amber-200 text-amber-900'
                      : 'bg-red-50 border-red-200 text-red-900'
                  }`}
                >
                  {/* Subject Isolated Mugshot */}
                  {portraitUrl && (
                    <img
                      src={portraitUrl}
                      alt={face.matchedName || 'Subject Mugshot'}
                      className="w-16 h-16 rounded-lg object-cover border border-zinc-300 bg-zinc-950 flex-shrink-0 shadow-xs"
                    />
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between font-bold">
                      <div className="flex items-center gap-1.5 min-w-0 truncate">
                        {isAuth
                          ? <UserCheck className="w-4 h-4 text-emerald-700 flex-shrink-0" />
                          : isUnverified
                          ? <User className="w-4 h-4 text-amber-700 flex-shrink-0" />
                          : <UserX className="w-4 h-4 text-red-700 flex-shrink-0" />}
                        <span className="text-zinc-950 truncate">{face.matchedName || 'Unrecognized Subject'}</span>
                        <span className={`px-1.5 py-0.5 rounded font-mono text-[9px] font-bold uppercase ${
                          isAuth ? 'bg-emerald-100 text-emerald-800' : isUnverified ? 'bg-amber-100 text-amber-900' : 'bg-red-100 text-red-800'
                        }`}>
                          {isUnverified ? 'UNVERIFIED' : face.status}
                        </span>
                      </div>
                      <span className="font-mono text-[10px] opacity-80 flex-shrink-0 ml-1">
                        Conf: {face.confidence}%
                      </span>
                    </div>

                    <p className="text-[11px] text-zinc-700 mt-1 font-mono line-clamp-2">
                      {face.threatReason || face.activityContext || 'Identity check complete'}
                    </p>

                    {face.features && (
                      <div className="flex flex-wrap gap-1 mt-1.5 text-[10px]">
                        {face.features.ageEstimate && (
                          <span className="px-1.5 py-0.5 rounded bg-white border border-zinc-200 font-mono text-zinc-700 shadow-2xs">
                            {face.features.ageEstimate}
                          </span>
                        )}
                        {face.visibilityStatus && (
                          <span className={`px-1.5 py-0.5 rounded border font-mono font-bold shadow-2xs ${
                            face.visibilityStatus === 'CLEAR' 
                              ? 'bg-white border-zinc-200 text-zinc-800' 
                              : 'bg-amber-100 border-amber-300 text-amber-900'
                          }`}>
                            {face.visibilityStatus}
                          </span>
                        )}
                        {face.features.accessories?.map((a, i) => (
                          <span key={i} className="px-1.5 py-0.5 rounded bg-white border border-zinc-200 font-mono text-zinc-700 shadow-2xs">
                            {a}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Operational Guidance */}
        <div className="bg-zinc-50 p-3.5 rounded-xl border border-zinc-200 space-y-1">
          <div className="text-[10px] font-mono uppercase text-zinc-500 flex items-center gap-1 font-bold">
            <Sparkles className="w-3 h-3 text-amber-600" />
            Recommended Protocol Guidance:
          </div>
          <div className="text-xs font-bold text-zinc-900">
            {incident.recommendedAction || 'Monitor sector and keep logs.'}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-3 border-t border-zinc-200 gap-2 flex-wrap">
          <div className="text-[11px] font-mono text-zinc-500">
            Incident ID: <span className="text-zinc-900 font-semibold">{incident.id}</span>
          </div>

          <div className="flex items-center gap-2">
            {incident.status === 'ACTIVE' && (
              <>
                <button
                  onClick={() => {
                    onDispatchTeam(incident.id);
                    onClose();
                  }}
                  className="flex items-center gap-1 px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-all shadow-sm uppercase tracking-wider"
                >
                  <Siren className="w-3.5 h-3.5" />
                  <span>Log Dispatch Request</span>
                </button>

                <button
                  onClick={() => {
                    onAcknowledge(incident.id);
                    onClose();
                  }}
                  className="flex items-center gap-1 px-3 py-2 rounded-lg bg-white hover:bg-zinc-50 text-zinc-800 text-xs font-semibold transition-all border border-zinc-300 shadow-sm"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-amber-600" />
                  <span>Acknowledge</span>
                </button>
              </>
            )}

            {(incident.status === 'ACKNOWLEDGED' || incident.status === 'DISPATCHED') && (
              <button
                onClick={() => {
                  onResolve(incident.id);
                  onClose();
                }}
                className="flex items-center gap-1 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all shadow-sm"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Mark Threat Resolved</span>
              </button>
            )}

            {incident.category === 'BIOMETRIC_BREACH' && incident.status !== 'FORENSIC_REVIEWED' && (
              <button
                onClick={() => {
                  onForensicReview(incident.id);
                  onClose();
                }}
                className="flex items-center gap-1 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-all shadow-sm"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Mark Forensic Review Complete</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-xs font-semibold transition-all border border-zinc-300"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
