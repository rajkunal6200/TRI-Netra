import React, { useEffect, useState, useRef } from 'react';
import { 
  Plus, 
  UserCheck, 
  Shield, 
  Camera, 
  Upload, 
  Trash2, 
  Sparkles, 
  Check, 
  AlertCircle, 
  Search,
  KeyRound,
  Eye,
  History,
  MapPin,
  X
} from 'lucide-react';
import { AuthorizedPerson, ClearanceLevel } from '@shared/types';
import type { PersonLocationChangeEvent, PersonPresence } from '@shared/utils/personPresence';
import { fetchCurrentPresence, fetchPersonPresenceHistory } from '../utils/trackingApi';

interface PersonnelDirectoryProps {
  personnel: AuthorizedPerson[];
  currentPresence: PersonPresence[];
  onAddPersonnel: (person: AuthorizedPerson) => void;
  onDeletePersonnel: (id: string) => void;
  isAdmin?: boolean;
  onRequireAdmin?: (actionCallback: () => void, promptReason: string) => void;
}

const CLEARANCE_LEVELS: ClearanceLevel[] = [
  'Level 1 - Visitor',
  'Level 2 - Staff',
  'Level 3 - High Security',
  'Level 4 - Executive'
];

const AVAILABLE_ZONES = [
  'Main Entrance',
  'Server Vault',
  'Executive Suite',
  'Loading Bay',
  'Research Lab',
  'Control Room',
  'HVAC & Power Substation'
];

const MAX_FACE_REFERENCE_PHOTOS = 5;
const FACE_REFERENCE_ANGLE_STEPS = [
  { label: 'Front', instruction: 'Look straight at the camera.' },
  { label: 'Left', instruction: 'Turn your head slightly to your left.' },
  { label: 'Right', instruction: 'Turn your head slightly to your right.' },
  { label: 'Chin up', instruction: 'Keep your head centered and tilt your chin slightly up.' },
  { label: 'Chin down', instruction: 'Keep your head centered and tilt your chin slightly down.' },
] as const;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read this photo.'));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function compressFacePhoto(source: string, maxDimension = 1280, quality = 0.88): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Could not prepare this photo for face enrollment.');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(new Error('This photo could not be opened.'));
    image.src = source;
  });
}

type HistoryDisplayEntry = {
  cameraId: string;
  zoneId?: string;
  timestamp: string;
  previousCameraId?: string;
  previousZoneId?: string;
  previousSeenAt?: string;
  concurrent?: boolean;
  isInitial: boolean;
};

export const PersonnelDirectory: React.FC<PersonnelDirectoryProps> = ({
  personnel,
  currentPresence,
  onAddPersonnel,
  onDeletePersonnel,
  isAdmin = false,
  onRequireAdmin,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [historyPerson, setHistoryPerson] = useState<AuthorizedPerson | null>(null);
  const [historyEvents, setHistoryEvents] = useState<PersonLocationChangeEvent[]>([]);
  const [historyPresence, setHistoryPresence] = useState<PersonPresence | null>(null);
  const [historyError, setHistoryError] = useState<string>('');
  const [personId, setPersonId] = useState<string>(() => `auth-${Date.now()}`);
  const [registrationError, setRegistrationError] = useState<string>('');
  const [isRegisteringPerson, setIsRegisteringPerson] = useState<boolean>(false);

  const openRegistrationModal = () => {
    let nextPersonId = `auth-${Date.now()}`;
    let suffix = 1;
    while (personnel.some((person) => person.id === nextPersonId)) {
      nextPersonId = `auth-${Date.now()}-${suffix++}`;
    }
    setPersonId(nextPersonId);
    setRegistrationError('');
    setIsModalOpen(true);
  };

  const handleRegisterClick = () => {
    if (!isAdmin && onRequireAdmin) {
      onRequireAdmin(openRegistrationModal, 'Admin clearance required to register new personnel into the defense directory.');
    } else {
      openRegistrationModal();
    }
  };

  const handleDeleteClick = (personId: string, personName: string) => {
    const confirmAndDelete = () => {
      if (confirm(`Remove ${personName} from authorized personnel directory?`)) {
        onDeletePersonnel(personId);
      }
    };

    if (!isAdmin && onRequireAdmin) {
      onRequireAdmin(
        confirmAndDelete,
        `Admin clearance required to remove ${personName} from the authorized directory.`
      );
    } else {
      confirmAndDelete();
    }
  };

  const handleViewLocationHistory = (person: AuthorizedPerson) => {
    setHistoryPerson(person);
    setHistoryEvents([]);
    setHistoryPresence(null);
    setHistoryError('');
    void Promise.all([fetchPersonPresenceHistory(person.id), fetchCurrentPresence()])
      .then(([events, presences]) => {
        setHistoryEvents(events);
        setHistoryPresence(
          presences
            .filter((presence) => presence.personId === person.id)
            .sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt))[0] ?? null
        );
      })
      .catch((error: unknown) => {
        setHistoryError('Unable to load this person’s location history. Check the tracking service and try again.');
        console.warn('Unable to load person location history:', error);
      });
  };

  // New Personnel Form State
  const [formData, setFormData] = useState({
    name: '',
    role: '',
    department: 'Engineering',
    clearanceLevel: 'Level 2 - Staff' as ClearanceLevel,
    description: '',
    notes: '',
    accessZones: ['Main Entrance', 'Control Room'],
  });

  const [photoBase64, setPhotoBase64] = useState<string>('');
  const [additionalPhotoBase64s, setAdditionalPhotoBase64s] = useState<string[]>([]);
  const [isAddingPhotos, setIsAddingPhotos] = useState<boolean>(false);
  const [isExtractingBiometrics, setIsExtractingBiometrics] = useState<boolean>(false);
  const [extractedBiometrics, setExtractedBiometrics] = useState<{
    isFaceClear: boolean;
    visualDescription: string;
    keyBiometrics: string[];
    qualityScore: number;
  } | null>(null);

  // Capture / Upload references
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const webcamVideoRef = useRef<HTMLVideoElement | null>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const [isWebcamActive, setIsWebcamActive] = useState<boolean>(false);

  useEffect(() => {
    const video = webcamVideoRef.current;
    const stream = webcamStreamRef.current;
    if (!isModalOpen || !isWebcamActive || !video || !stream) return;

    video.srcObject = stream;
    void video.play().catch((error: unknown) => {
      console.warn('Modal webcam playback error:', error);
      setRegistrationError('The camera opened, but its video could not be played. Check browser camera permissions and try again.');
    });
  }, [isModalOpen, isWebcamActive]);

  // Start webcam for photo capture in modal
  const startModalWebcam = async () => {
    setRegistrationError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setRegistrationError('Camera access is unavailable. Open Trinetra on localhost or a secure HTTPS connection.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      webcamStreamRef.current = stream;
      setIsWebcamActive(true);
    } catch (err) {
      console.warn('Modal webcam error:', err);
      const errorName = err instanceof DOMException ? err.name : '';
      const message = errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError'
        ? 'Camera access is blocked. Allow camera permission for this site in your browser settings, then try again.'
        : errorName === 'NotFoundError'
        ? 'No camera was found. Connect a camera or upload a face photo instead.'
        : errorName === 'NotReadableError'
        ? 'The camera is already in use by another app. Close that app and try again.'
        : 'Unable to open the camera. Check its connection and browser permissions, or upload a face photo.';
      setRegistrationError(message);
    }
  };

  const stopModalWebcam = () => {
    const stream = webcamStreamRef.current ?? webcamVideoRef.current?.srcObject as MediaStream | null;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      webcamStreamRef.current = null;
    }
    if (webcamVideoRef.current) {
      webcamVideoRef.current.srcObject = null;
    }
    setIsWebcamActive(false);
  };

  const takeWebcamSnap = () => {
    try {
      const video = webcamVideoRef.current;
      if (!video) return;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        void appendReferencePhotos([dataUrl]);
      }
    } catch (err) {
      console.warn('Failed to take webcam snapshot:', err);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    try {
      const files = Array.from(input.files || []);
      if (files.length === 0) return;
      if (referencePhotos.length + files.length > MAX_FACE_REFERENCE_PHOTOS) {
        setRegistrationError(`You can enroll up to ${MAX_FACE_REFERENCE_PHOTOS} photos for one person.`);
        input.value = '';
        return;
      }
      const hasUnsupportedPhoto = files.some((file) =>
        (!['image/jpeg', 'image/png'].includes(file.type) && !/\.(jpe?g|png)$/i.test(file.name)) || file.size > 10 * 1024 * 1024
      );
      if (hasUnsupportedPhoto) {
        setRegistrationError('Choose JPG or PNG photos, each under 10 MB.');
        input.value = '';
        return;
      }
      const sources = await Promise.all(files.map(readFileAsDataUrl));
      await appendReferencePhotos(sources);
      input.value = '';
    } catch (err) {
      setRegistrationError(err instanceof Error ? err.message : 'Could not read the selected photos.');
      input.value = '';
    }
  };

  // AI Biometric Feature Extractor
  const extractAiBiometrics = async (imgBase64: string) => {
    try {
      setIsExtractingBiometrics(true);
      const res = await fetch('/api/surveillance/extract-facial-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: imgBase64,
          name: formData.name,
          role: formData.role,
        }),
      });
      const json = await res.json();
      if (json.success && json.data) {
        setExtractedBiometrics(json.data);
        if (!formData.description && json.data.visualDescription) {
          setFormData((prev) => ({
            ...prev,
            description: json.data.visualDescription,
          }));
        }
      }
    } catch (err) {
      console.warn('Biometric extraction error:', err);
    } finally {
      setIsExtractingBiometrics(false);
    }
  };

  const referencePhotos = photoBase64 ? [photoBase64, ...additionalPhotoBase64s] : [];
  const nextCaptureAngle = FACE_REFERENCE_ANGLE_STEPS[Math.min(referencePhotos.length, FACE_REFERENCE_ANGLE_STEPS.length - 1)];

  const appendReferencePhotos = async (sources: string[]) => {
    if (sources.length === 0 || isAddingPhotos) return;
    const currentCount = referencePhotos.length;
    if (currentCount + sources.length > MAX_FACE_REFERENCE_PHOTOS) {
      setRegistrationError(`Add up to ${MAX_FACE_REFERENCE_PHOTOS} photos of this person.`);
      return;
    }

    setIsAddingPhotos(true);
    setRegistrationError('');
    try {
      const compressedPhotos = await Promise.all(sources.map((source) => compressFacePhoto(source)));
      if (photoBase64) {
        setAdditionalPhotoBase64s((current) => [...current, ...compressedPhotos]);
      } else {
        setPhotoBase64(compressedPhotos[0]);
        setAdditionalPhotoBase64s((current) => [...current, ...compressedPhotos.slice(1)]);
        setExtractedBiometrics(null);
        void extractAiBiometrics(compressedPhotos[0]);
      }
    } catch (error) {
      setRegistrationError(error instanceof Error ? error.message : 'Could not prepare the selected photos.');
    } finally {
      setIsAddingPhotos(false);
    }
  };

  const removeReferencePhoto = (index: number) => {
    if (index === 0) {
      const [nextPrimary = '', ...remaining] = additionalPhotoBase64s;
      setPhotoBase64(nextPrimary);
      setAdditionalPhotoBase64s(remaining);
      setExtractedBiometrics(null);
      if (nextPrimary) void extractAiBiometrics(nextPrimary);
      return;
    }
    setAdditionalPhotoBase64s((photos) => photos.filter((_, photoIndex) => photoIndex !== index - 1));
  };

  const handleSavePersonnel = async () => {
    if (!formData.name.trim() || referencePhotos.length === 0 || isRegisteringPerson || isAddingPhotos) return;
    setIsRegisteringPerson(true);
    setRegistrationError('');

    try {
      const response = await fetch('/api/surveillance/register-person', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personId, name: formData.name.trim(), imagesBase64: referencePhotos }),
      });
      const result = await response.json();
      const faceEmbeddings: number[][] = Array.isArray(result.embeddings) ? result.embeddings : [];
      if (
        !response.ok || !result.success || faceEmbeddings.length !== referencePhotos.length ||
        faceEmbeddings.some((embedding) => !Array.isArray(embedding) || embedding.length !== 1024 || !embedding.every(Number.isFinite))
      ) {
        throw new Error(result.error || 'Face registration failed. Please try another photo.');
      }
      const primaryPhotoThumbnail = await compressFacePhoto(photoBase64, 320, 0.68);

      const newPerson: AuthorizedPerson = {
        id: personId,
        name: formData.name.trim(),
        role: formData.role.trim() || 'Authorized Personnel',
        department: formData.department,
        clearanceLevel: formData.clearanceLevel,
        photoUrl: primaryPhotoThumbnail,
        description: formData.description || 'Verified personnel with valid security clearance',
        registeredAt: new Date().toISOString(),
        accessZones: formData.accessZones,
        faceEmbedding: faceEmbeddings[0],
        faceEmbeddings,
        notes: formData.notes,
        keyBiometrics: extractedBiometrics?.keyBiometrics || ['Verified facial profile'],
      };

      onAddPersonnel(newPerson);
      setIsModalOpen(false);
      setFormData({
        name: '',
        role: '',
        department: 'Engineering',
        clearanceLevel: 'Level 2 - Staff',
        description: '',
        notes: '',
        accessZones: ['Main Entrance', 'Control Room'],
      });
      setPhotoBase64('');
      setAdditionalPhotoBase64s([]);
      setExtractedBiometrics(null);
      stopModalWebcam();
    } catch (error) {
      setRegistrationError(error instanceof Error ? error.message : 'Face registration failed. Please try again.');
    } finally {
      setIsRegisteringPerson(false);
    }
  };

  const closeRegistrationModal = () => {
    stopModalWebcam();
    setIsModalOpen(false);
    setPhotoBase64('');
    setAdditionalPhotoBase64s([]);
    setIsAddingPhotos(false);
    setExtractedBiometrics(null);
    setRegistrationError('');
    setFormData({
      name: '',
      role: '',
      department: 'Engineering',
      clearanceLevel: 'Level 2 - Staff',
      description: '',
      notes: '',
      accessZones: ['Main Entrance', 'Control Room'],
    });
  };

  const filtered = personnel.filter((p) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.role.toLowerCase().includes(q) ||
      p.department.toLowerCase().includes(q) ||
      p.clearanceLevel.toLowerCase().includes(q)
    );
  });

  const getClearanceBadge = (level: ClearanceLevel) => {
    switch (level) {
      case 'Level 4 - Executive':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'Level 3 - High Security':
        return 'bg-amber-50 text-amber-800 border-amber-200';
      case 'Level 2 - Staff':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'Level 1 - Visitor':
      default:
        return 'bg-zinc-100 text-zinc-700 border-zinc-200';
    }
  };

  const displayHistoryEntries: HistoryDisplayEntry[] = historyEvents.length > 0
    ? [
        {
          cameraId: historyEvents[0].previousCameraId,
          zoneId: historyEvents[0].previousZoneId,
          timestamp: historyEvents[0].previousSeenAt || historyPresence?.firstSeenAt || historyEvents[0].timestamp,
          previousCameraId: undefined,
          previousZoneId: undefined,
          isInitial: true,
        },
        ...historyEvents.map((event) => ({ ...event, isInitial: false })),
      ]
    : historyPresence
    ? [{
        cameraId: historyPresence.cameraId,
        zoneId: historyPresence.zoneId,
        timestamp: historyPresence.firstSeenAt,
        previousCameraId: undefined,
        previousZoneId: undefined,
        isInitial: true,
      }]
    : [];
  const activeLocationsForHistory = historyPerson
    ? currentPresence.filter((presence) => presence.personId === historyPerson.id)
    : [];

  return (
    <div className="space-y-4">
      {/* Header & Registration Trigger */}
      <div className="bg-white p-4 rounded-xl border border-zinc-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
        <div>
          <h2 className="text-base font-bold text-zinc-950 flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-emerald-600" />
            Authorized Personnel Directory & Whitelist
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5 font-mono">
            Enroll several face photos per person for more reliable live matching. Unverified faces go to review; confirmed breaches raise alerts.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isAdmin ? (
            <span className="text-[11px] font-mono font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Admin Clearance: Active
            </span>
          ) : (
            <span className="text-[11px] font-mono text-zinc-500 bg-zinc-100 border border-zinc-200 px-2.5 py-1 rounded-lg">
              Operator Mode (Read-Only)
            </span>
          )}
          <button
            id="btn-register-personnel"
            onClick={handleRegisterClick}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-950 hover:bg-zinc-800 text-white text-xs font-bold shadow-sm transition-all self-start sm:self-auto uppercase tracking-wider cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Person</span>
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="flex items-center justify-between gap-3 bg-white p-3 rounded-xl border border-zinc-200 shadow-sm">
        <div className="relative flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search authorized personnel by name, role, clearance..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-50 border border-zinc-300 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-zinc-950 font-mono"
          />
        </div>
        <div className="text-xs font-mono text-zinc-500">
          Total Authorized: <strong className="text-zinc-950">{personnel.length}</strong>
        </div>
      </div>

      <section className="bg-white p-4 rounded-xl border border-zinc-200 shadow-sm" aria-labelledby="tracked-presence-heading">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 id="tracked-presence-heading" className="text-sm font-bold text-zinc-950">Currently Tracked</h3>
          <span className="text-[10px] font-mono text-zinc-500">{currentPresence.length} active</span>
        </div>
        {currentPresence.length === 0 ? (
          <p className="text-xs text-zinc-500 font-mono">No people are currently tracked.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {currentPresence.map((presence) => (
              <li key={`${presence.personId}:${presence.cameraId}`} className="grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-4 py-2 first:pt-0 last:pb-0 text-xs font-mono">
                <span className="font-bold text-zinc-900">
                  {personnel.find((person) => person.id === presence.personId)?.name || `Unidentified ${presence.personId}`}
                  {personnel.some((person) => person.id === presence.personId) && (
                    <span className="block text-[10px] font-normal text-zinc-500">
                      {personnel.find((person) => person.id === presence.personId)?.role}
                    </span>
                  )}
                </span>
                <span className="text-zinc-600">
                  {presence.zoneId || 'Zone not provided'} · <strong className="text-zinc-900">{presence.cameraId}</strong>
                </span>
                <time className="text-zinc-500" dateTime={presence.lastSeenAt}>
                  Last seen: {new Date(presence.lastSeenAt).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Personnel Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {filtered.map((person) => (
          <div
            key={person.id}
            id={`person-card-${person.id}`}
            className="bg-white border border-zinc-200 rounded-xl p-4 hover:border-zinc-300 transition-all flex flex-col justify-between shadow-sm"
          >
            <div>
              <div className="flex items-start gap-3">
                <img
                  src={person.photoUrl}
                  alt={person.name}
                  className="w-14 h-14 rounded-lg object-cover border border-zinc-200 flex-shrink-0 shadow-sm"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <h3 className="font-bold text-sm text-zinc-950 truncate">{person.name}</h3>
                    <button
                      onClick={() => handleDeleteClick(person.id, person.name)}
                      title="Remove from Authorized Directory"
                      className="p-1 rounded text-zinc-400 hover:text-red-600 hover:bg-zinc-100 transition-all cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="text-xs text-zinc-700 font-medium">{person.role}</div>
                  <div className="text-[11px] text-zinc-500 font-mono">{person.department}</div>
                  <span
                    title={person.faceEmbeddings?.length || person.faceEmbedding ? 'This person can be matched against live camera faces using multiple photo references.' : 'A usable face profile could not be enrolled; live sightings remain unverified.'}
                    className={`inline-flex mt-1 rounded px-1.5 py-0.5 text-[9px] font-mono font-bold ${
                      person.faceEmbeddings?.length || person.faceEmbedding ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {person.faceEmbeddings?.length || person.faceEmbedding
                      ? `${person.faceEmbeddings?.length || 1} PHOTO REFERENCES`
                      : 'FACE NOT ENROLLED'}
                  </span>
                </div>
              </div>

              {/* Clearance Badge & Zones */}
              <div className="mt-3 pt-3 border-t border-zinc-100 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-zinc-500 uppercase">Clearance:</span>
                  <span
                    className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded border ${getClearanceBadge(
                      person.clearanceLevel
                    )}`}
                  >
                    {person.clearanceLevel}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] font-mono text-zinc-500 uppercase block mb-1">
                    Permitted Zones:
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {person.accessZones.map((zone, zIdx) => (
                      <span
                        key={zIdx}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-700 border border-zinc-200 font-mono"
                      >
                        {zone}
                      </span>
                    ))}
                  </div>
                </div>

                {person.description && (
                  <p className="text-[11px] text-zinc-600 line-clamp-2 mt-1 italic font-mono">
                    "{person.description}"
                  </p>
                )}
              </div>
            </div>

            <div className="mt-3 pt-2 text-[10px] font-mono text-zinc-400 flex items-center justify-between border-t border-zinc-100">
              <span>ID: {person.id}</span>
              <button
                type="button"
                onClick={() => handleViewLocationHistory(person)}
                title={`View all location history for ${person.name}`}
                className="flex items-center gap-1 text-zinc-600 hover:text-zinc-950 font-semibold"
              >
                <History className="w-3.5 h-3.5" />
                Location History
              </button>
              <span>Reg: {new Date(person.registeredAt).toLocaleDateString()}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Register Personnel Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-zinc-950/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-zinc-200 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-zinc-200 pb-3">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-zinc-900" />
                <h3 className="font-bold text-sm sm:text-base text-zinc-950">
                  Add Person
                </h3>
              </div>
              <button
                onClick={closeRegistrationModal}
                disabled={isRegisteringPerson || isAddingPhotos}
                className="text-zinc-500 hover:text-zinc-950 text-sm font-mono"
              >
                ✕ Close
              </button>
            </div>

            {/* Photo Capture / Upload Section */}
            <div className="space-y-2">
              <label className="text-xs font-mono font-bold text-zinc-700 uppercase block">
                Face Photos (up to {MAX_FACE_REFERENCE_PHOTOS} references)
              </label>

              <div className="flex flex-col sm:flex-row items-center gap-4 p-3 rounded-xl bg-zinc-50 border border-zinc-200">
                {/* Photo Preview / Webcam */}
                <div className="w-32 h-32 rounded-xl bg-zinc-100 border border-zinc-300 overflow-hidden flex items-center justify-center relative flex-shrink-0">
                  {isWebcamActive ? (
                    <video ref={webcamVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                  ) : photoBase64 ? (
                    <img src={photoBase64} alt="Captured Face" className="w-full h-full object-cover" />
                  ) : (
                    <Camera className="w-8 h-8 text-zinc-400" />
                  )}
                </div>

                {/* Controls */}
                <div className="space-y-2 flex-1 w-full text-center sm:text-left">
                  {isWebcamActive ? (
                    <div className="space-y-2">
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-left">
                        <div className="text-[10px] font-mono font-bold uppercase text-emerald-800">
                          Photo {Math.min(referencePhotos.length + 1, MAX_FACE_REFERENCE_PHOTOS)} of {MAX_FACE_REFERENCE_PHOTOS} · {nextCaptureAngle.label}
                        </div>
                        <div className="text-xs font-semibold text-zinc-800">{nextCaptureAngle.instruction}</div>
                        <div className="text-[10px] text-zinc-600">Make a small turn so both eyes and most of your face stay visible.</div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={takeWebcamSnap}
                          disabled={referencePhotos.length >= MAX_FACE_REFERENCE_PHOTOS || isAddingPhotos || isRegisteringPerson}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold shadow hover:bg-emerald-700 transition-all flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Capture {nextCaptureAngle.label} Photo
                        </button>
                        <button
                          onClick={stopModalWebcam}
                          className="px-3 py-1.5 rounded-lg bg-zinc-200 text-zinc-800 text-xs font-semibold hover:bg-zinc-300"
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={startModalWebcam}
                        disabled={referencePhotos.length >= MAX_FACE_REFERENCE_PHOTOS || isRegisteringPerson || isAddingPhotos}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-zinc-100 border border-zinc-300 text-xs font-semibold text-zinc-800 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Camera className="w-3.5 h-3.5 text-zinc-700" />
                        <span>Use Webcam</span>
                      </button>

                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={referencePhotos.length >= MAX_FACE_REFERENCE_PHOTOS || isRegisteringPerson || isAddingPhotos}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-zinc-100 border border-zinc-300 text-xs font-semibold text-zinc-800 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Upload className="w-3.5 h-3.5 text-zinc-700" />
                        <span>Upload Photos</span>
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,.jpg,.jpeg,.png"
                        multiple
                        className="hidden"
                        onChange={handleFileUpload}
                      />
                    </div>
                  )}

                  {isExtractingBiometrics && (
                    <div className="flex items-center gap-1.5 text-xs text-zinc-700 font-mono animate-pulse">
                      <Sparkles className="w-3.5 h-3.5 animate-spin text-amber-600" />
                      <span>Trinetra AI analyzing facial landmarks...</span>
                    </div>
                  )}

                  {extractedBiometrics && (
                    <div className="text-[11px] font-mono text-emerald-700 flex items-center gap-1 font-semibold">
                      <Check className="w-3.5 h-3.5" />
                      <span>{referencePhotos.length} photo reference{referencePhotos.length === 1 ? '' : 's'} selected (quality: {extractedBiometrics.qualityScore}%)</span>
                    </div>
                  )}
                  {isAddingPhotos && <span className="text-[11px] text-zinc-600 font-mono">Preparing face photos...</span>}
                  {registrationError && (
                    <div role="alert" className="flex items-start gap-1.5 text-xs text-red-700 font-mono">
                      <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                      <span>{registrationError}</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500">
                <span>Use different views: front, slight left/right, then chin up/down. Avoid repeated same-angle photos.</span>
                <span>{referencePhotos.length}/{MAX_FACE_REFERENCE_PHOTOS}</span>
              </div>
              {referencePhotos.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {referencePhotos.map((photo, index) => (
                    <div key={`${index}-${photo.length}`} className="relative w-14 h-14 rounded-lg border border-zinc-300 overflow-hidden">
                      <img src={photo} alt={`Face reference ${index + 1}`} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        aria-label={`Remove photo ${index + 1}`}
                        title="Remove photo"
                        onClick={() => removeReferencePhoto(index)}
                        disabled={isRegisteringPerson || isAddingPhotos}
                        className="absolute top-0.5 right-0.5 rounded-full bg-zinc-950/85 text-white p-0.5 disabled:opacity-50"
                      >
                        <X className="w-3 h-3" />
                      </button>
                      <span className="absolute left-0.5 bottom-0.5 rounded bg-zinc-950/80 text-white px-1 text-[8px] font-mono">{index + 1}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Personnel Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="font-mono text-zinc-600 uppercase block mb-1">Full Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Marcus Vance"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-zinc-50 border border-zinc-300 rounded-lg px-3 py-2 text-zinc-950 focus:outline-none focus:border-zinc-950 font-mono"
                />
              </div>

              <div>
                <label className="font-mono text-zinc-600 uppercase block mb-1">Person ID</label>
                <input
                  type="text"
                  value={personId}
                  readOnly
                  className="w-full bg-zinc-100 border border-zinc-300 rounded-lg px-3 py-2 text-zinc-600 font-mono"
                />
              </div>

              <div>
                <label className="font-mono text-zinc-600 uppercase block mb-1">Role / Title *</label>
                <input
                  type="text"
                  placeholder="e.g. Lead Systems Engineer"
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  className="w-full bg-zinc-50 border border-zinc-300 rounded-lg px-3 py-2 text-zinc-950 focus:outline-none focus:border-zinc-950 font-mono"
                />
              </div>

              <div>
                <label className="font-mono text-zinc-600 uppercase block mb-1">Department</label>
                <input
                  type="text"
                  placeholder="e.g. Cybersecurity & Infrastructure"
                  value={formData.department}
                  onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                  className="w-full bg-zinc-50 border border-zinc-300 rounded-lg px-3 py-2 text-zinc-950 focus:outline-none focus:border-zinc-950 font-mono"
                />
              </div>

              <div>
                <label className="font-mono text-zinc-600 uppercase block mb-1">Clearance Level</label>
                <select
                  value={formData.clearanceLevel}
                  onChange={(e) => setFormData({ ...formData, clearanceLevel: e.target.value as ClearanceLevel })}
                  className="w-full bg-zinc-50 border border-zinc-300 rounded-lg px-3 py-2 text-zinc-950 focus:outline-none focus:border-zinc-950 font-mono"
                >
                  {CLEARANCE_LEVELS.map((lvl) => (
                    <option key={lvl} value={lvl}>
                      {lvl}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Allowed Zones */}
            <div>
              <label className="text-xs font-mono text-zinc-600 uppercase block mb-1.5">
                Authorized Access Zones
              </label>
              <div className="flex flex-wrap gap-1.5">
                {AVAILABLE_ZONES.map((zone) => {
                  const isChecked = formData.accessZones.includes(zone);
                  return (
                    <button
                      type="button"
                      key={zone}
                      onClick={() => {
                        if (isChecked) {
                          setFormData({
                            ...formData,
                            accessZones: formData.accessZones.filter((z) => z !== zone),
                          });
                        } else {
                          setFormData({
                            ...formData,
                            accessZones: [...formData.accessZones, zone],
                          });
                        }
                      }}
                      className={`text-[11px] font-mono px-2.5 py-1 rounded-lg border transition-all ${
                        isChecked
                          ? 'bg-zinc-950 border-zinc-950 text-white font-bold'
                          : 'bg-zinc-100 border-zinc-200 text-zinc-600 hover:border-zinc-400 hover:text-zinc-950'
                      }`}
                    >
                      {isChecked ? '✓ ' : '+ '}
                      {zone}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Visual Description / Traits */}
            <div>
              <label className="text-xs font-mono text-zinc-600 uppercase block mb-1">
                Visual Traits & Description (AI Recognition Prompts)
              </label>
              <textarea
                rows={2}
                placeholder="Physical descriptors (hair style, glasses, build, usual attire)..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full bg-zinc-50 border border-zinc-300 rounded-lg p-2.5 text-xs text-zinc-950 placeholder-zinc-400 focus:outline-none focus:border-zinc-950 font-mono"
              />
            </div>

            {/* Footer buttons */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-200">
              <button
                type="button"
                onClick={closeRegistrationModal}
                disabled={isRegisteringPerson || isAddingPhotos}
                className="px-4 py-2 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-xs font-semibold transition-all border border-zinc-300"
              >
                Cancel
              </button>
              <button
                type="button"
                id="btn-save-personnel-confirm"
                onClick={handleSavePersonnel}
                disabled={!formData.name.trim() || referencePhotos.length === 0 || isRegisteringPerson || isAddingPhotos}
                className="px-5 py-2 rounded-lg bg-zinc-950 hover:bg-zinc-800 text-white text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm uppercase tracking-wider"
              >
                {isRegisteringPerson ? 'Verifying Face...' : 'Add Person'}
              </button>
            </div>
          </div>
        </div>
      )}

      {historyPerson && (
        <div className="fixed inset-0 z-50 bg-zinc-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="person-location-history-title"
            className="bg-white border border-zinc-200 rounded-xl max-w-2xl w-full p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-zinc-200 pb-3">
              <div>
                <h3 id="person-location-history-title" className="font-bold text-base text-zinc-950">
                  Location History: {historyPerson.name}
                </h3>
                <p className="text-[11px] font-mono text-zinc-500">Person ID: {historyPerson.id}</p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryPerson(null)}
                aria-label="Close location history"
                className="p-1 rounded text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {historyPresence && (
              <div className="text-xs font-mono bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-emerald-950">
                Latest recorded location: <strong>{historyPresence.zoneId || 'Zone not provided'}</strong>
                {' · '}{historyPresence.cameraId}
                <span className="block text-[11px] text-emerald-800 mt-1">
                  Last seen {new Date(historyPresence.lastSeenAt).toLocaleString()}
                </span>
              </div>
            )}

            {historyError && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-mono text-red-800">
                {historyError}
              </p>
            )}

            {activeLocationsForHistory.length > 1 && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs font-mono text-blue-950">
                <p className="font-bold mb-2">Simultaneously detected by {activeLocationsForHistory.length} cameras</p>
                <ul className="space-y-1">
                  {activeLocationsForHistory.map((presence) => (
                    <li key={`${presence.cameraId}:${presence.zoneId || ''}`}>
                      {presence.zoneId || 'Zone not provided'} · {presence.cameraId} · {new Date(presence.lastSeenAt).toLocaleTimeString()}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {displayHistoryEntries.length === 0 ? (
              <p className="text-sm text-zinc-500 font-mono">No location history has been recorded for this person yet.</p>
            ) : (
              <ol className="max-h-[60vh] overflow-y-auto divide-y divide-zinc-100">
                {displayHistoryEntries.map((entry, index) => (
                  <li key={`${entry.timestamp}-${index}`} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-start gap-2">
                      <MapPin className="w-4 h-4 mt-0.5 text-emerald-700 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-zinc-900">
                          {entry.isInitial
                            ? 'First recorded location'
                            : entry.concurrent
                              ? `Also detected at ${entry.zoneId || entry.cameraId} while visible at ${entry.previousZoneId || entry.previousCameraId}`
                              : `Moved from ${entry.previousZoneId || entry.previousCameraId} to ${entry.zoneId || entry.cameraId}`}
                        </p>
                        <p className="text-xs text-zinc-600 font-mono">
                          {entry.zoneId || 'Zone not provided'} · {entry.cameraId}
                        </p>
                        <time dateTime={entry.timestamp} className="text-[11px] text-zinc-500 font-mono">
                          {new Date(entry.timestamp).toLocaleString()}
                        </time>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
