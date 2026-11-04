import React, { useEffect, useState } from 'react';
import { 
  AlertTriangle, 
  CheckCircle2, 
  Download, 
  ExternalLink, 
  Filter, 
  Search, 
  ShieldAlert, 
  Siren, 
  Trash2, 
  UserX,
  Clock,
  MapPin,
  FileText,
  Eye,
  Camera,
  Repeat,
  User,
  VideoOff,
  ShieldCheck,
  Maximize2,
  X,
} from 'lucide-react';
import { AuthorizedPerson, SecurityIncident, ThreatLevel } from '@shared/types';
import type { DailyPresenceRecord } from '@shared/utils/dailyPresence';
import type { PersonPresence } from '@shared/utils/personPresence';
import { DEFAULT_CAMERAS } from '../data/defaultCameras';

interface IncidentFeedProps {
  incidents: SecurityIncident[];
  authorizedPersonnel: AuthorizedPerson[];
  todayPresenceRecords: DailyPresenceRecord[];
  currentPresence: PersonPresence[];
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  onViewDetails: (incident: SecurityIncident) => void;
  onDispatchTeam: (id: string) => void;
  isAdmin?: boolean;
  onRequireAdmin?: (actionCallback: () => void, promptReason: string) => void;
}

export const IncidentFeed: React.FC<IncidentFeedProps> = ({
  incidents,
  authorizedPersonnel,
  todayPresenceRecords,
  currentPresence,
  onAcknowledge,
  onResolve,
  onDelete,
  onClearAll,
  onViewDetails,
  onDispatchTeam,
  isAdmin = false,
  onRequireAdmin,
}) => {
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [filterThreat, setFilterThreat] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [enlargedPhoto, setEnlargedPhoto] = useState<{ src: string; name: string; caption: string } | null>(null);

  useEffect(() => {
    if (!enlargedPhoto) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEnlargedPhoto(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [enlargedPhoto]);

  const handleClearAllClick = () => {
    const confirmAndClear = () => {
      if (confirm('Are you sure you want to clear all security incident logs? This action cannot be undone.')) {
        onClearAll();
      }
    };

    if (!isAdmin && onRequireAdmin) {
      onRequireAdmin(
        confirmAndClear,
        'Admin clearance required to purge security incident audit records.'
      );
    } else {
      confirmAndClear();
    }
  };

  const handleDeleteClick = (id: string) => {
    if (!isAdmin && onRequireAdmin) {
      onRequireAdmin(
        () => onDelete(id),
        'Admin clearance required to delete forensic incident records.'
      );
    } else {
      onDelete(id);
    }
  };

  const filteredIncidents = incidents.filter((inc) => {
    if (filterStatus !== 'ALL' && inc.status !== filterStatus) return false;
    if (filterThreat !== 'ALL' && inc.threatLevel !== filterThreat) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = inc.title.toLowerCase().includes(q);
      const matchZone = inc.zone.toLowerCase().includes(q);
      const matchDesc = inc.description.toLowerCase().includes(q);
      if (!matchTitle && !matchZone && !matchDesc) return false;
    }
    return true;
  });

  const verifiedRecordByPerson = new Map(todayPresenceRecords.map((record) => [record.personId, record]));
  const clientDate = new Date();
  const localDateKey = `${clientDate.getFullYear()}-${String(clientDate.getMonth() + 1).padStart(2, '0')}-${String(clientDate.getDate()).padStart(2, '0')}`;
  for (const presence of currentPresence) {
    const existing = verifiedRecordByPerson.get(presence.personId);
    if (!existing) {
      verifiedRecordByPerson.set(presence.personId, {
        personId: presence.personId,
        date: localDateKey,
        firstSeenAt: presence.firstSeenAt,
        lastSeenAt: presence.lastSeenAt,
        currentCameraId: presence.cameraId,
        cameraHistory: [],
        transitionCount: 0,
      });
    } else if (Date.parse(presence.lastSeenAt) > Date.parse(existing.lastSeenAt)) {
      verifiedRecordByPerson.set(presence.personId, { ...existing, lastSeenAt: presence.lastSeenAt, currentCameraId: presence.cameraId });
    }
  }

  const verifiedSightings = Array.from(verifiedRecordByPerson.values())
    .map((record) => {
      const person = authorizedPersonnel.find((candidate) => candidate.id === record.personId);
      const activeLocations = currentPresence.filter((presence) => presence.personId === record.personId);
      const cameraTrail = record.cameraHistory.length > 0
        ? [record.cameraHistory[0].fromCameraId, ...record.cameraHistory.map((transition) => transition.toCameraId)]
        : [record.currentCameraId];
      if (cameraTrail[cameraTrail.length - 1] !== record.currentCameraId) cameraTrail.push(record.currentCameraId);
      const compactTrail = cameraTrail.filter((cameraId, index) => index === 0 || cameraId !== cameraTrail[index - 1]);
      return { record, person, activeLocations, cameraTrail: compactTrail };
    })
    .sort((left, right) => Date.parse(right.record.lastSeenAt) - Date.parse(left.record.lastSeenAt));

  const formatCameraLocation = (cameraId: string, personId: string) => {
    const activePresence = currentPresence.find((presence) => presence.personId === personId && presence.cameraId === cameraId);
    const defaultCamera = DEFAULT_CAMERAS.find((camera) => camera.id === cameraId);
    const zone = activePresence?.zoneId || defaultCamera?.zone;
    const number = defaultCamera?.channelNumber;
    return `${zone ? `${zone} · ` : ''}${number ? `CAM 0${number}` : cameraId}`;
  };

  const exportLogsAsJSON = () => {
    const safeIncidents = incidents.map((incident) => ({
      ...incident,
      identityEmbedding: undefined,
      faces: incident.faces.map((face) => ({ ...face, embedding: undefined })),
    }));
    const auditTrail = {
      generatedAt: new Date().toISOString(),
      verifiedPersons: verifiedSightings.map(({ record, person, cameraTrail }) => ({
        personId: record.personId,
        name: person?.name || `Directory profile ${record.personId}`,
        role: person?.role,
        department: person?.department,
        clearanceLevel: person?.clearanceLevel,
        firstSeenAt: record.firstSeenAt,
        lastSeenAt: record.lastSeenAt,
        currentCameraId: record.currentCameraId,
        cameraTrail,
      })),
      unverifiedIncidents: safeIncidents,
    };
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(auditTrail, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `trinetra-surveillance-audit-${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const getThreatBadge = (level: ThreatLevel) => {
    switch (level) {
      case 'CRITICAL':
        return 'bg-red-600 text-white font-bold animate-pulse';
      case 'HIGH':
        return 'bg-orange-600 text-white font-bold';
      case 'MEDIUM':
        return 'bg-amber-600 text-white font-semibold';
      case 'LOW':
      case 'NONE':
      default:
        return 'bg-emerald-100 text-emerald-800 font-semibold';
    }
  };

  const getStatusBadge = (status: SecurityIncident['status']) => {
    switch (status) {
      case 'ACTIVE':
        return 'bg-red-50 text-red-700 border-red-200 font-bold';
      case 'ACKNOWLEDGED':
        return 'bg-amber-50 text-amber-800 border-amber-200 font-semibold';
      case 'DISPATCHED':
        return 'bg-sky-50 text-sky-800 border-sky-200 font-semibold';
      case 'RESOLVED':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold';
      case 'FORENSIC_REVIEWED':
        return 'bg-indigo-50 text-indigo-700 border-indigo-200 font-semibold';
      default:
        return 'bg-zinc-100 text-zinc-700 border-zinc-200 font-medium';
    }
  };

  return (
    <div className="space-y-4">
      {/* Header & Global Action Bar */}
      <div className="bg-white p-4 rounded-xl border border-zinc-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm">
        <div>
          <h2 className="text-base font-bold text-zinc-950 flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-red-600" />
            Person Detection Logs
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5 font-mono">
            Verified and unverified detections are separated below, with camera locations and sighting times.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            id="btn-export-audit"
            onClick={exportLogsAsJSON}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 border border-zinc-300 text-xs font-bold text-zinc-800 transition-all shadow-sm"
          >
            <Download className="w-3.5 h-3.5 text-zinc-700" />
            <span>Export Audit Trail</span>
          </button>

          {incidents.length > 0 && (
            <button
              id="btn-clear-incidents"
              onClick={handleClearAllClick}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-red-50 border border-zinc-300 hover:border-red-300 text-xs font-semibold text-zinc-600 hover:text-red-700 transition-all shadow-sm cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Logs</span>
            </button>
          )}
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-emerald-100 bg-emerald-50/70 px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-black text-emerald-900">
            <ShieldCheck className="h-4 w-4 text-emerald-700" /> Verified Persons
          </h3>
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-mono font-bold text-emerald-900">
            {verifiedSightings.length} TODAY
          </span>
        </div>
        {verifiedSightings.length === 0 ? (
          <p className="px-4 py-5 text-center text-xs font-mono text-zinc-500">
            No verified person sightings have been recorded today.
          </p>
        ) : (
          <div className="divide-y divide-zinc-100">
            {verifiedSightings.map(({ record, person, activeLocations, cameraTrail }) => {
              const activeCameraIds = Array.from(new Set(activeLocations.map((presence) => presence.cameraId)));
              const currentCameraId = activeCameraIds[0] || record.currentCameraId;
              const initials = person?.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '✓';
              return (
                <article key={`${record.date}-${record.personId}`} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                  {person?.photoUrl ? (
                    <button
                      type="button"
                      onClick={() => setEnlargedPhoto({
                        src: person.photoUrl,
                        name: person.name,
                        caption: `${person.role} · ${formatCameraLocation(currentCameraId, record.personId)}`,
                      })}
                      aria-label={`Enlarge ${person.name}'s photo`}
                      title="Click to enlarge photo"
                      className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-emerald-100 bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      <img
                        src={person.photoUrl}
                        alt={`${person.name} profile`}
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      />
                      <span className="absolute inset-0 flex items-center justify-center bg-zinc-950/0 text-white opacity-0 transition-all group-hover:bg-zinc-950/35 group-hover:opacity-100">
                        <Maximize2 className="h-4 w-4 drop-shadow" />
                      </span>
                    </button>
                  ) : (
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-emerald-100 bg-emerald-50 text-sm font-black text-emerald-800">
                      {initials}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-zinc-950">{person?.name || `Directory profile ${record.personId}`}</span>
                      <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-mono font-bold text-emerald-800">VERIFIED</span>
                      {person?.clearanceLevel && (
                        <span className="rounded bg-zinc-100 px-2 py-0.5 text-[9px] font-mono font-semibold text-zinc-600">{person.clearanceLevel}</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-600">
                      {[person?.role, person?.department].filter(Boolean).join(' · ') || `Person ID: ${record.personId}`}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-700">
                      <span className="inline-flex items-center gap-1 font-semibold">
                        <MapPin className="h-3.5 w-3.5 text-emerald-700" />
                        {activeCameraIds.length > 0
                          ? `LIVE: ${activeCameraIds.map((cameraId) => formatCameraLocation(cameraId, record.personId)).join(', ')}`
                          : formatCameraLocation(currentCameraId, record.personId)}
                      </span>
                      <span className="inline-flex items-center gap-1 text-zinc-500">
                        <Clock className="h-3.5 w-3.5" />
                        Last seen {new Date(record.lastSeenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[10px] font-mono text-zinc-500" title={cameraTrail.map((cameraId) => formatCameraLocation(cameraId, record.personId)).join(' → ')}>
                      LOCATION TRAIL: {cameraTrail.map((cameraId) => formatCameraLocation(cameraId, record.personId)).join(' → ')}
                    </p>
                    {activeCameraIds.length > 1 && (
                      <p className="mt-1 truncate text-[10px] font-mono font-bold text-emerald-800" title={activeCameraIds.map((cameraId) => formatCameraLocation(cameraId, record.personId)).join(', ')}>
                        SIMULTANEOUS LOCATIONS: {activeCameraIds.map((cameraId) => formatCameraLocation(cameraId, record.personId)).join(' · ')}
                      </p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Filter & Search Bar */}
      <div className="bg-white p-3 rounded-xl border border-zinc-200 flex flex-wrap items-center justify-between gap-3 text-xs shadow-sm">
        <div className="flex items-center flex-wrap gap-2">
          {/* Status Filter */}
          <div className="flex items-center bg-zinc-100 rounded-xl p-1 border border-zinc-200">
            {['ALL', 'ACTIVE', 'ACKNOWLEDGED', 'DISPATCHED', 'RESOLVED', 'FORENSIC_REVIEWED'].map((st) => (
              <button
                key={st}
                onClick={() => setFilterStatus(st)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold transition-all ${
                  filterStatus === st
                    ? 'bg-white text-zinc-950 shadow-sm border border-zinc-200/80'
                    : 'text-zinc-600 hover:text-zinc-950'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          {/* Threat Filter */}
          <div className="flex items-center bg-zinc-100 rounded-xl p-1 border border-zinc-200">
            {['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((lvl) => (
              <button
                key={lvl}
                onClick={() => setFilterThreat(lvl)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold transition-all ${
                  filterThreat === lvl
                    ? 'bg-white text-zinc-950 shadow-sm border border-zinc-200/80'
                    : 'text-zinc-600 hover:text-zinc-950'
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>
        </div>

        {/* Search input */}
        <div className="relative min-w-[240px]">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by zone, threat, notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-50 border border-zinc-300 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-zinc-950 font-mono"
          />
        </div>
      </div>

      {/* Unverified/security incidents */}
      <section className="space-y-3">
        <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-black text-amber-950">
            <UserX className="h-4 w-4 text-amber-700" /> Unverified Persons &amp; Security Incidents
          </h3>
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-mono font-bold text-amber-900">
            {filteredIncidents.length} LOGGED
          </span>
        </div>
      <div className="space-y-3">
        {filteredIncidents.length === 0 ? (
          <div className="bg-white border border-zinc-200 rounded-xl p-8 text-center text-zinc-500 shadow-sm">
            <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-2 opacity-80" />
            <div className="text-sm font-bold text-zinc-900">No Unverified Faces or Active Security Incidents</div>
            <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto font-mono">
              Unrecognized faces and security alerts will appear in this section when detected.
            </p>
          </div>
        ) : (
          filteredIncidents.map((incident, idx) => {
            const isCritical = incident.threatLevel === 'CRITICAL';
            const isActive = incident.status === 'ACTIVE';
            const isResolved = incident.status === 'RESOLVED';
            const isIdentityReview = incident.category === 'IDENTITY_REVIEW';

            const cardBorder = isCritical || (isActive && !isIdentityReview)
              ? 'border-l-4 border-l-red-600 bg-red-50/20'
              : isIdentityReview
              ? 'border-l-4 border-l-amber-500 bg-amber-50/30'
              : isResolved
              ? 'border-l-4 border-l-emerald-600 bg-white'
              : 'border-l-4 border-l-amber-500 bg-white';

            return (
              <div
                key={`${incident.id}-${idx}`}
                id={`incident-row-${incident.id}`}
                className={`bg-white border border-zinc-200 rounded-r-xl rounded-l-md p-4 transition-all duration-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm hover:shadow-md ${cardBorder}`}
              >
                {/* Snapshot Thumbnail + Description */}
                <div className="flex items-start gap-3.5 min-w-0">
                  {incident.category === 'CAMERA_OFFLINE' ? (
                    <div 
                      onClick={() => onViewDetails(incident)}
                      className="w-20 h-20 rounded-lg bg-zinc-950 border border-red-500/80 flex flex-col items-center justify-center flex-shrink-0 text-center p-1 shadow-md shadow-red-950/30 cursor-pointer hover:border-red-400"
                    >
                      <VideoOff className="w-7 h-7 text-red-500 animate-pulse mb-1" />
                      <span className="text-[8px] font-mono font-bold text-red-400 uppercase tracking-tighter">
                        FEED OFFLINE
                      </span>
                    </div>
                  ) : incident.capturedFrameUrl ? (
                    <div className="relative flex-shrink-0 group/thumb">
                      <img
                        src={incident.croppedFaceUrl || incident.capturedFrameUrl}
                        alt="Subject Biometric Isolated Portrait"
                        className="w-20 h-20 sm:w-20 sm:h-20 rounded-lg object-cover border border-zinc-200 shadow-sm cursor-pointer hover:opacity-95 bg-zinc-950 transition-all"
                        onClick={() => onViewDetails(incident)}
                      />
                      {incident.totalSubjectsInScene && incident.totalSubjectsInScene > 1 && (
                        <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-zinc-950/85 text-white font-mono text-[9px] font-bold border border-zinc-700 shadow-xs">
                          P{incident.subjectIndex || 1}/{incident.totalSubjectsInScene}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="w-20 h-20 rounded-lg bg-zinc-100 border border-zinc-200 flex items-center justify-center flex-shrink-0">
                      <UserX className="w-6 h-6 text-zinc-400" />
                    </div>
                  )}

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-[9px] font-mono uppercase px-2 py-0.5 rounded font-bold ${getThreatBadge(
                          incident.threatLevel
                        )}`}
                      >
                        {incident.threatLevel}
                      </span>
                      <span
                        className={`text-[9px] font-mono uppercase px-2 py-0.5 rounded border ${
                          isIdentityReview ? 'bg-amber-50 text-amber-800 border-amber-200 font-semibold' : getStatusBadge(incident.status)
                        }`}
                      >
                        {isIdentityReview && isActive ? 'REVIEW REQUIRED' : incident.status}
                      </span>

                      {incident.feedMode === 'simulation' && (
                        <span className="text-[9px] font-mono uppercase px-2 py-0.5 rounded border border-violet-200 bg-violet-50 text-violet-800 font-bold">
                          SIMULATION
                        </span>
                      )}

                      {incident.category === 'IDENTITY_REVIEW' && (
                        <span className="text-[9px] font-mono uppercase px-2 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-900 font-bold">
                          IDENTITY REVIEW · NOT CONFIRMED UNAUTHORIZED
                        </span>
                      )}

                      {/* Camera Signal Loss / Blind Spot Pill */}
                      {incident.category === 'CAMERA_OFFLINE' && (
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-red-100 text-red-800 border border-red-300 flex items-center gap-1 shadow-xs animate-pulse">
                          <VideoOff className="w-3 h-3 text-red-600" />
                          <span>BLIND SPOT / SIGNAL LOSS</span>
                        </span>
                      )}

                      {/* Multi-Person Distinct Subject Pill */}
                      {incident.totalSubjectsInScene && incident.totalSubjectsInScene > 1 && (
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-900 border border-indigo-200 flex items-center gap-1 shadow-xs">
                          <User className="w-3 h-3 text-indigo-600" />
                          <span>SUBJECT #{incident.subjectIndex} (OF {incident.totalSubjectsInScene})</span>
                        </span>
                      )}

                      {/* 1-Hour Sighting Count Badge */}
                      {incident.sightingsCount && incident.sightingsCount > 1 ? (
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200 flex items-center gap-1 shadow-xs">
                          <Eye className="w-3 h-3 text-blue-600" />
                          <span>SEEN {incident.sightingsCount}x</span>
                        </span>
                      ) : null}

                      {/* Multi-Location Movement Breadcrumb Indicator */}
                      {incident.locationHistory && incident.locationHistory.length > 1 && (
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-300 flex items-center gap-1 shadow-xs">
                          <MapPin className="w-3 h-3 text-amber-700" />
                          <span>TRAIL: {Array.from(new Set(incident.locationHistory.map((location) => `${location.zone} (${location.channelName || `CAM 0${location.channelNumber || 1}`})`))).join(' ➔ ')}</span>
                        </span>
                      )}

                      {/* Face Visibility Warning Pill */}
                      {incident.isProperlyVisible === false && (
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-300 flex items-center gap-1 shadow-xs" title={incident.visibilityReason || 'Face not properly visible'}>
                          <Camera className="w-3 h-3 text-amber-700" />
                          <span>UNCLEAR FACE (SNAPSHOT SAVED)</span>
                        </span>
                      )}

                      <span className="text-[11px] font-mono text-zinc-600 flex items-center gap-1 font-medium">
                        <MapPin className="w-3 h-3 text-zinc-500" />
                        {incident.zone}
                      </span>
                      <span className="text-[11px] font-mono text-zinc-600 flex items-center gap-1 font-medium">
                        <Clock className="w-3 h-3 text-zinc-500" />
                        {incident.lastSeenTimestamp && incident.sightingsCount && incident.sightingsCount > 1
                          ? `Last: ${new Date(incident.lastSeenTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
                          : new Date(incident.timestamp).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}
                      </span>
                    </div>

                    <h3 className="font-bold text-sm text-zinc-950 mt-1 truncate">
                      {incident.title}
                    </h3>
                    <p className="text-xs text-zinc-600 mt-0.5 line-clamp-1 font-mono">
                      {incident.description}
                    </p>

                    {/* ALL DETECTED LOCATIONS TRAIL */}
                    {incident.category !== 'CAMERA_OFFLINE' && (() => {
                      const distinctLocs: { zone: string; channelId?: string; channelName?: string; channelNumber?: number; timestamp: string }[] = [];
                      if (incident.locationHistory && incident.locationHistory.length > 0) {
                        for (const crumb of incident.locationHistory) {
                          const previous = distinctLocs[distinctLocs.length - 1];
                          if (
                            distinctLocs.length === 0 || previous.zone !== crumb.zone ||
                            previous.channelId !== crumb.channelId || previous.channelName !== crumb.channelName ||
                            previous.channelNumber !== crumb.channelNumber
                          ) {
                            distinctLocs.push({
                              zone: crumb.zone,
                              channelId: crumb.channelId,
                              channelName: crumb.channelName,
                              channelNumber: crumb.channelNumber,
                              timestamp: crumb.timestamp,
                            });
                          }
                        }
                      } else {
                        distinctLocs.push({
                          zone: incident.zone,
                          channelName: incident.channelName || `CAM 0${incident.channelNumber || 1}`,
                          timestamp: incident.timestamp,
                        });
                      }

                      return (
                        <div className="mt-2 pt-2 border-t border-zinc-100 flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] font-mono font-bold text-zinc-600 uppercase tracking-wider flex items-center gap-1 mr-1">
                            <MapPin className="w-3 h-3 text-red-600" />
                            <span>Locations Detected:</span>
                          </span>
                          {distinctLocs.map((loc, lIdx) => {
                            const isLatest = lIdx === distinctLocs.length - 1;
                            return (
                              <React.Fragment key={lIdx}>
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                                    isLatest
                                      ? 'bg-red-50 text-red-700 border-red-200 shadow-2xs'
                                      : 'bg-zinc-100 text-zinc-700 border-zinc-200'
                                  }`}
                                >
                                  <span>{loc.zone}</span>
                                  <span className="text-[9px] opacity-75 font-normal">({loc.channelName || `CAM 0${loc.channelNumber || 1}`})</span>
                                  <span className="text-[9px] opacity-70 font-normal">{new Date(loc.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                  {isLatest && distinctLocs.length > 1 && (
                                    <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-ping ml-0.5" />
                                  )}
                                </span>
                                {lIdx < distinctLocs.length - 1 && (
                                  <span className="text-zinc-400 text-xs font-bold font-mono">➔</span>
                                )}
                              </React.Fragment>
                            );
                          })}
                          {incident.sightingsCount && incident.sightingsCount > 1 && (
                            <span className="text-[10px] font-mono text-zinc-500 ml-1">
                              ({incident.sightingsCount} total sightings)
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Quick Incident Actions */}
                <div className="flex items-center flex-wrap gap-2 w-full md:w-auto justify-end">
                  {incident.status === 'ACTIVE' && (
                    <>
                      {!isIdentityReview && (
                        <button
                          id={`btn-dispatch-${incident.id}`}
                          onClick={() => onDispatchTeam(incident.id)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-sm transition-all uppercase tracking-wide"
                        >
                          <Siren className="w-3.5 h-3.5" />
                          <span>Log Dispatch</span>
                        </button>
                      )}

                      <button
                        id={`btn-ack-${incident.id}`}
                        onClick={() => onAcknowledge(incident.id)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white hover:bg-zinc-50 border border-zinc-300 text-zinc-800 text-xs font-semibold shadow-sm transition-all"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-amber-600" />
                        <span>Acknowledge</span>
                      </button>
                    </>
                  )}

                  {incident.status === 'ACKNOWLEDGED' && (
                    <button
                      id={`btn-resolve-${incident.id}`}
                      onClick={() => onResolve(incident.id)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all shadow-sm"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Mark Resolved</span>
                    </button>
                  )}

                  <button
                    id={`btn-forensic-view-${incident.id}`}
                    onClick={() => onViewDetails(incident)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-semibold shadow-sm transition-all"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Forensic View</span>
                  </button>

                  <button
                    onClick={() => handleDeleteClick(incident.id)}
                    title="Delete Incident Record"
                    className="p-1.5 rounded-lg bg-white hover:bg-red-50 text-zinc-400 hover:text-red-600 border border-zinc-300 transition-all shadow-sm cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
      </section>

      {enlargedPhoto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${enlargedPhoto.name} photo preview`}
          onClick={() => setEnlargedPhoto(null)}
          className="fixed inset-0 z-[80] flex items-center justify-center bg-zinc-950/85 p-4 backdrop-blur-sm"
        >
          <button
            type="button"
            onClick={() => setEnlargedPhoto(null)}
            aria-label="Close photo preview"
            className="absolute right-4 top-4 rounded-full border border-white/20 bg-zinc-900/80 p-2 text-white hover:bg-zinc-800"
          >
            <X className="h-5 w-5" />
          </button>
          <figure onClick={(event) => event.stopPropagation()} className="flex max-h-full max-w-full flex-col items-center gap-3">
            <img
              src={enlargedPhoto.src}
              alt={`${enlargedPhoto.name} enlarged profile`}
              className="max-h-[82vh] max-w-[min(92vw,64rem)] rounded-xl border border-white/20 bg-zinc-900 object-contain shadow-2xl"
            />
            <figcaption className="text-center text-sm font-semibold text-white">
              {enlargedPhoto.name}<span className="mx-2 text-white/50">·</span>{enlargedPhoto.caption}
            </figcaption>
          </figure>
        </div>
      )}
    </div>
  );
};
