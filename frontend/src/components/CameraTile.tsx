import React, { useRef, useEffect, useMemo, useState } from 'react';
import { 
  Camera, 
  Eye, 
  Moon, 
  Maximize2, 
  ZoomIn, 
  ZoomOut, 
  Crosshair, 
  UserCheck, 
  UserX, 
  Scan, 
  Radio, 
  ShieldAlert, 
  Layers,
  VideoOff,
  Smartphone,
  PhoneOff,
  Power,
  RefreshCw
} from 'lucide-react';
import { CameraChannel, DetectedFace, ThreatLevel, SampleScenario } from '@shared/types';
import { SAMPLE_SCENARIOS } from '../data/sampleScenarios';
import { deduplicateFaces } from '../utils/faceDeduplication';
import { RealtimeFaceTracker } from '@shared/utils/realtimeFaceTracker';

interface CameraTileProps {
  camera: CameraChannel;
  isSelected: boolean;
  onSelect: () => void;
  onScanChannel: (channelId: string) => void;
  isScanningThisChannel: boolean;
  onUpdateChannel: (channelId: string, updates: Partial<CameraChannel>) => void;
  onToggleFeed?: () => void;
  onToggleWebcam?: () => void;
  isWebcamStarting?: boolean;
  videoStream: MediaStream | null;
  webRtcStream?: MediaStream | null;
  onSelectFace: (face: DetectedFace) => void;
  selectedFaceId?: string;
  isCompact?: boolean;
  showBoundingBoxes?: boolean;
  showHudOverlay?: boolean;
}

export const CameraTile: React.FC<CameraTileProps> = ({
  camera,
  isSelected,
  onSelect,
  onScanChannel,
  isScanningThisChannel,
  onUpdateChannel,
  onToggleFeed,
  onToggleWebcam,
  isWebcamStarting = false,
  videoStream,
  webRtcStream,
  onSelectFace,
  selectedFaceId,
  isCompact = false,
  showBoundingBoxes = true,
  showHudOverlay = true,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const trackerRef = useRef<RealtimeFaceTracker | null>(null);
  if (!trackerRef.current) {
    trackerRef.current = new RealtimeFaceTracker();
  }

  const [liveFaces, setLiveFaces] = useState<DetectedFace[]>([]);
  const [imageFailed, setImageFailed] = useState(false);

  // Bind video stream if webcam mode or WebRTC phone stream
  useEffect(() => {
    const video = videoRef.current;
    const stream = camera.feedMode === 'webcam'
      ? videoStream
      : camera.feedMode === 'phone_stream'
        ? webRtcStream
        : null;
    if (!video) return;

    if (!stream) {
      video.srcObject = null;
      return;
    }

    video.srcObject = stream;
    const resumePlayback = () => {
      const hasLiveTrack = stream.getVideoTracks().some((track) => track.readyState === 'live');
      if (video.srcObject === stream && hasLiveTrack && video.paused) {
        void video.play().catch(() => {});
      }
    };
    video.addEventListener('pause', resumePlayback);
    video.addEventListener('stalled', resumePlayback);
    void video.play().catch(() => {});

    return () => {
      video.removeEventListener('pause', resumePlayback);
      video.removeEventListener('stalled', resumePlayback);
      if (video.srcObject === stream) video.srcObject = null;
    };
  }, [camera.feedMode, videoStream, webRtcStream]);

  const isWebRtcLive = camera.feedMode === 'phone_stream' && Boolean(webRtcStream);

  // Determine if feed is active or closed / standby
  const isPhoneLive = camera.feedMode === 'phone_stream' && Boolean(
    isWebRtcLive || (
      camera.phoneConnected && 
      camera.lastFrameReceivedAt && 
      (Date.now() - camera.lastFrameReceivedAt < 4500)
    )
  );

  const isWebcamLive = camera.feedMode === 'webcam'
    ? Boolean(videoStream?.getVideoTracks().some((track) => track.readyState === 'live'))
    : true;
  const isBluetoothLive = camera.feedMode === 'bluetooth' ? Boolean(camera.customImageSrc || videoStream) : true;

  const isFeedClosed = Boolean(
    camera.isClosed ||
    camera.status === 'OFFLINE' ||
    (camera.feedMode === 'phone_stream' && !isPhoneLive) ||
    (camera.feedMode === 'webcam' && !isWebcamLive && !isWebcamStarting) ||
    (camera.feedMode === 'bluetooth' && !isBluetoothLive)
  );

  useEffect(() => {
    setLiveFaces([]);
  }, [camera.feedMode, camera.scenarioId, camera.customImageSrc, camera.streamUrl, camera.deviceId]);

  // Continuous real-time optical face & movement tracking loop
  useEffect(() => {
    let isMounted = true;
    let trackingPassActive = false;
    let intervalId: any = null;

    const runOpticalTrackingPass = async () => {
      if (trackingPassActive) return;
      trackingPassActive = true;

      try {
        if (isFeedClosed) {
          if (isMounted) setLiveFaces([]);
          return;
        }
        const v = videoRef.current;
        const img = imgRef.current;
        const source = v || (camera.feedMode === 'phone_stream' ? img : null);
        if (!source) return;

        if (source instanceof HTMLVideoElement) {
          if (source.readyState < 2 || source.paused) return;
        } else if (source instanceof HTMLImageElement) {
          if (!source.complete || source.naturalWidth === 0) return;
        }

        // Preserve the last server-confirmed identity until a newer scan
        // replaces it. Scan age alone does not make an enrolled person unknown.
        const verified = camera.lastScanResult?.faces || [];
        const result = await trackerRef.current!.track(source, verified, {
          cameraId: camera.id,
          zoneId: camera.zone,
        });
        if (!isMounted) return;

        if (result.faces && result.faces.length > 0) {
          setLiveFaces(result.faces);
        } else if (verified.length > 0) {
          setLiveFaces(verified);
        } else {
          setLiveFaces([]);
        }

        // Fast optical trigger: fire scan immediately when motion or a new face enters
        if (result.hasSignificantMotion && !isScanningThisChannel) {
          onScanChannel(camera.id);
        }
      } catch (err) {
        // Continue tracking
      } finally {
        trackingPassActive = false;
      }
    };

    if (camera.feedMode === 'webcam' || camera.feedMode === 'phone_stream') {
      intervalId = setInterval(runOpticalTrackingPass, 100);
    } else {
      setLiveFaces(camera.lastScanResult?.faces || []);
    }

    return () => {
      isMounted = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [camera.feedMode, isWebRtcLive, isFeedClosed, camera.lastScanResult, isScanningThisChannel, camera.id, onScanChannel]);

  // Find scenario image if simulation mode
  const currentScenario = SAMPLE_SCENARIOS.find((s) => s.id === camera.scenarioId) || SAMPLE_SCENARIOS[0];
  const imageSource = camera.feedMode === 'phone_stream'
    ? `/api/phone-camera/mjpeg/${camera.pairCode || 'PHONE-1'}`
    : camera.feedMode === 'ip_stream'
      ? camera.streamUrl || camera.customImageSrc || ''
      : (camera.customImageSrc || currentScenario.imageUrl);

  useEffect(() => {
    setImageFailed(false);
  }, [imageSource]);

  // Helper for bounding box styles that dynamically adapt to exact face size
  const getBoxStyle = (box: [number, number, number, number]) => {
    if (!box || box.length < 4) return { display: 'none' };
    const [ymin, xmin, ymax, xmax] = box;
    const top = Math.max(0, Math.min(99, (ymin / 1000) * 100));
    const left = Math.max(0, Math.min(99, (xmin / 1000) * 100));
    // Allows micro-boxes for distant faces and full forehead-to-chin boxes for close faces
    const width = Math.max(0.4, Math.min(100 - left, ((xmax - xmin) / 1000) * 100));
    const height = Math.max(0.4, Math.min(100 - top, ((ymax - ymin) / 1000) * 100));

    return {
      top: `${top}%`,
      left: `${left}%`,
      width: `${width}%`,
      height: `${height}%`,
    };
  };

  const getThreatColorClass = (threat: ThreatLevel) => {
    switch (threat) {
      case 'CRITICAL':
        return 'border-red-600 shadow-red-500/30 ring-red-500';
      case 'HIGH':
        return 'border-orange-500 shadow-orange-500/20 ring-orange-500';
      case 'MEDIUM':
        return 'border-amber-500 shadow-amber-500/20 ring-amber-500';
      default:
        return 'border-zinc-800 ring-zinc-700';
    }
  };

  const activeFaces = !isFeedClosed && camera.feedMode !== 'simulation'
    ? (liveFaces && liveFaces.length > 0)
      ? liveFaces
      : (camera.lastScanResult?.faces || [])
    : [];
  const detectedFaces = useMemo(() => deduplicateFaces(activeFaces), [activeFaces]);
  const hasHighThreat = camera.activeThreatLevel === 'CRITICAL' || camera.activeThreatLevel === 'HIGH';
  const hasCriticalAlert = !isFeedClosed && camera.feedMode !== 'simulation' && hasHighThreat;
  const hasSimulatedThreat = !isFeedClosed && camera.feedMode === 'simulation' && hasHighThreat;

  return (
    <div
      id={`camera-tile-${camera.id}`}
      onClick={onSelect}
      className={`group relative rounded-xl overflow-hidden border-2 bg-black transition-all flex flex-col cursor-pointer ${
        isSelected
          ? 'border-amber-400 ring-2 ring-amber-400/40 shadow-xl'
          : hasCriticalAlert
          ? 'border-red-500/80 shadow-lg shadow-red-950/40 animate-pulse'
          : hasSimulatedThreat
          ? 'border-violet-500/80 shadow-lg shadow-violet-950/30'
          : isFeedClosed
          ? 'border-zinc-850 shadow-md'
          : 'border-zinc-800 hover:border-zinc-700 shadow-md'
      }`}
    >
      {/* Top Header Bar */}
      <div className="absolute top-0 inset-x-0 z-30 bg-gradient-to-b from-zinc-950/90 via-zinc-950/60 to-transparent p-2.5 flex items-center justify-between text-[11px] font-mono text-zinc-300 backdrop-blur-[2px]">
        <div className="flex items-center gap-2">
          <div
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold ${
              hasCriticalAlert
                ? 'bg-red-600 text-white animate-bounce'
                : isFeedClosed
                ? 'bg-zinc-900/90 text-zinc-500 border border-zinc-800'
                : 'bg-zinc-900/90 text-zinc-300 border border-zinc-700'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                hasCriticalAlert
                  ? 'bg-white animate-ping'
                  : isFeedClosed
                  ? 'bg-zinc-600'
                  : 'bg-emerald-400 animate-pulse'
              }`}
            />
            <span>CAM {camera.channelNumber < 10 ? `0${camera.channelNumber}` : camera.channelNumber}</span>
          </div>

          <span className="font-semibold text-white truncate max-w-[120px] sm:max-w-[160px]">
            {camera.zone}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Zoom Level Indicator / Direct Reset */}
          {!isFeedClosed && (camera.ptzZoom || 1) > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUpdateChannel(camera.id, { ptzZoom: 1 });
              }}
              className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-400/50 text-[9px] font-bold tracking-wider hover:bg-amber-500/30"
              title="Reset Zoom to 1.0x (No Zoom)"
            >
              {camera.ptzZoom}x
            </button>
          )}

          {isFeedClosed ? (
            <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 text-[9px] font-bold tracking-wider flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500/80" />
              <span>ZONE CLOSED</span>
            </span>
          ) : camera.feedMode === 'webcam' ? (
            <span className="px-1.5 py-0.5 rounded bg-blue-600 text-white text-[9px] font-bold tracking-wider">
              WEBCAM
            </span>
          ) : camera.feedMode === 'phone_stream' ? (
            <span className="px-1.5 py-0.5 rounded bg-indigo-600 text-white text-[9px] font-bold tracking-wider flex items-center gap-1">
              <Smartphone className="w-2.5 h-2.5" />
              <span>PHONE LIVE</span>
              {camera.phoneDeviceModel && <span className="opacity-80 truncate max-w-[50px]">({camera.phoneDeviceModel})</span>}
            </span>
          ) : camera.feedMode === 'bluetooth' ? (
            <span className="px-1.5 py-0.5 rounded bg-indigo-500 text-white text-[9px] font-bold tracking-wider">
              BT CAM
            </span>
          ) : camera.feedMode === 'ip_stream' ? (
            <span className="px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[9px] font-bold tracking-wider">
              IP STREAM
            </span>
          ) : camera.feedMode === 'simulation' ? (
            <span className="px-1.5 py-0.5 rounded bg-violet-700 text-white text-[9px] font-bold tracking-wider">
              SIMULATION
            </span>
          ) : camera.feedMode === 'upload' ? (
            <span className="px-1.5 py-0.5 rounded bg-amber-600 text-white text-[9px] font-bold tracking-wider">
              SNAPSHOT
            </span>
          ) : (
            <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[9px] font-semibold border border-zinc-700">
              OPTICAL
            </span>
          )}

          {onToggleWebcam && (
            <button
              type="button"
              aria-label={camera.feedMode !== 'webcam'
                ? `Open webcam for camera ${camera.channelNumber}`
                : isWebcamLive
                  ? `Stop webcam for camera ${camera.channelNumber}`
                  : `Retry webcam for camera ${camera.channelNumber}`}
              title={camera.isClosed
                ? 'Re-open this camera feed before choosing a webcam'
                : camera.feedMode !== 'webcam'
                  ? `Use a laptop or connected webcam for CAM ${camera.channelNumber}`
                  : isWebcamLive
                    ? 'Stop this webcam and return to the simulation feed'
                    : 'Retry the webcam connection'}
              disabled={camera.isClosed || isWebcamStarting}
              onClick={(event) => {
                event.stopPropagation();
                onToggleWebcam();
              }}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                camera.feedMode === 'webcam'
                  ? 'bg-blue-600 border-blue-500 text-white hover:bg-blue-500'
                  : 'bg-zinc-900/80 border-zinc-700 text-zinc-300 hover:text-blue-300 hover:border-blue-500'
              }`}
            >
              <Camera className="w-2.5 h-2.5" />
              <span>{isWebcamStarting
                ? camera.feedMode === 'webcam' ? 'RECONNECTING' : 'OPENING'
                : camera.feedMode === 'webcam' ? isWebcamLive ? 'STOP CAM' : 'RETRY CAM' : 'USE CAM'}</span>
            </button>
          )}

          {/* Night Vision Icon */}
          {!isFeedClosed && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUpdateChannel(camera.id, { nightVision: !camera.nightVision });
              }}
              className={`p-1 rounded text-[10px] transition-all border ${
                camera.nightVision
                  ? 'bg-emerald-600 text-white border-emerald-500'
                  : 'bg-zinc-900/80 text-zinc-400 border-zinc-700 hover:text-white'
              }`}
              title="Toggle Night Vision"
            >
              <Moon className="w-3 h-3" />
            </button>
          )}

          {/* Quick Power / Close Feed Button */}
          {onToggleFeed && (
            <button
              id={`btn-power-cam-${camera.id}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleFeed();
              }}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition-all border ${
                isFeedClosed
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500 shadow-sm animate-pulse'
                  : 'bg-zinc-900/80 text-zinc-300 border-zinc-700 hover:text-red-400 hover:border-red-600 hover:bg-zinc-800'
              }`}
              title={
                isFeedClosed
                  ? `Re-open feed for ${camera.zone} (Restore Online)`
                  : `Close feed for ${camera.zone} (Generates Blind Spot Security Incident)`
              }
            >
              <Power className="w-2.5 h-2.5" />
              <span className="text-[8px] sm:text-[9px]">{isFeedClosed ? 'RE-OPEN' : 'CLOSE'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Video / Feed Visual Container */}
      <div
        className={`relative aspect-[16/9] w-full bg-black flex items-center justify-center overflow-hidden transition-all duration-300 ${
          camera.nightVision && !isFeedClosed ? 'brightness-125 contrast-125' : ''
        }`}
        style={{
          transform: !isFeedClosed ? `scale(${camera.ptzZoom || 1})` : 'none',
          transformOrigin: 'center center',
        }}
      >
        {/* Closed Zone Black Standby State */}
        {isFeedClosed ? (
          <div className="w-full h-full bg-black flex flex-col items-center justify-center text-center p-4 select-none relative overflow-hidden">
            {/* Background subtle grid */}
            <div className="absolute inset-0 bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:16px_16px] opacity-20 pointer-events-none" />
            
            <div className="relative z-10 flex flex-col items-center">
              <div className="w-12 h-12 rounded-2xl bg-zinc-950 border border-zinc-800 flex items-center justify-center mb-2.5 shadow-2xl">
                {camera.feedMode === 'phone_stream' ? (
                  <PhoneOff className="w-6 h-6 text-zinc-600 animate-pulse" />
                ) : (
                  <VideoOff className="w-6 h-6 text-red-500 animate-pulse" />
                )}
              </div>

              <div className="flex items-center gap-2 mb-1">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                <span className="font-mono text-xs font-bold text-red-400 tracking-widest uppercase">
                  FEED CLOSED • BLIND SPOT ACTIVE
                </span>
              </div>

              <p className="text-[11px] text-zinc-400 font-mono max-w-[240px]">
                {camera.feedMode === 'phone_stream'
                  ? 'Phone transmitter disconnected. Security incident registered in Incident Log.'
                  : `Camera feed turned off for ${camera.zone}. Unmonitored blind spot incident logged.`}
              </p>

              {/* Action Button to Re-Open Feed */}
              <button
                id={`btn-reopen-camera-${camera.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFeed ? onToggleFeed() : onUpdateChannel(camera.id, { isClosed: false, status: 'ONLINE' });
                }}
                className="mt-3 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-mono font-bold flex items-center gap-1.5 shadow-lg shadow-emerald-950/40 transition-all cursor-pointer"
              >
                <Power className="w-3.5 h-3.5" />
                <span>RE-OPEN CAMERA FEED</span>
              </button>

              {camera.feedMode === 'phone_stream' && (
                <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[10px] font-mono text-zinc-400">
                  <span className="text-zinc-500">PAIR CODE:</span>
                  <span className="font-bold text-amber-400">{camera.pairCode || 'PHONE-1'}</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Night vision phosphor green overlay */}
            {camera.nightVision && (
              <div className="absolute inset-0 z-10 pointer-events-none bg-emerald-950/30 mix-blend-color backdrop-saturate-200" />
            )}

            {showHudOverlay && (
              <>
                <div className="absolute inset-0 z-10 pointer-events-none">
                  <div className="absolute top-0 bottom-0 left-1/3 border-l border-white/15" />
                  <div className="absolute top-0 bottom-0 left-2/3 border-l border-white/15" />
                  <div className="absolute left-0 right-0 top-1/3 border-t border-white/15" />
                  <div className="absolute left-0 right-0 top-2/3 border-t border-white/15" />
                </div>
                <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center opacity-30 group-hover:opacity-60 transition-opacity">
                  <Crosshair className="w-6 h-6 text-white/50" />
                </div>
              </>
            )}

            {/* Scan Laser animation */}
            {isScanningThisChannel && (
              <div className="absolute inset-x-0 z-25 h-1 bg-gradient-to-r from-transparent via-amber-400 to-transparent shadow-[0_0_12px_#f59e0b] animate-[bounce_1.5s_infinite] pointer-events-none" />
            )}

            {/* Live Feed Display */}
            {camera.feedMode === 'webcam' || (camera.feedMode === 'phone_stream' && isWebRtcLive) ? (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                {camera.feedMode === 'webcam' && !isWebcamLive && isWebcamStarting && (
                  <div className="absolute inset-0 z-20 flex items-center justify-center bg-zinc-950/75 text-zinc-200">
                    <div className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/90 px-3 py-2 font-mono text-[11px] font-bold">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-amber-400" />
                      RECONNECTING WEBCAM…
                    </div>
                  </div>
                )}
              </>
            ) : (
              imageFailed || !imageSource ? (
                <div className="w-full h-full min-h-24 flex flex-col items-center justify-center gap-2 bg-zinc-950 text-zinc-400 text-center px-4">
                  <Camera className="w-6 h-6 text-zinc-600" />
                  <span className="font-mono text-[10px]">
                    {camera.feedMode === 'simulation'
                      ? 'Preview image unavailable. Scenario scans still work.'
                      : 'Image unavailable. Check the camera URL or connection.'}
                  </span>
                </div>
              ) : (
                <img
                  ref={imgRef}
                  src={imageSource}
                  alt={camera.name}
                  referrerPolicy="no-referrer"
                  onError={() => setImageFailed(true)}
                  className="w-full h-full object-cover"
                />
              )
            )}

            {/* Bounding Boxes Layer */}
            {showBoundingBoxes && detectedFaces.map((face, fIdx) => {
              const boxStyle = getBoxStyle(face.box_2d);
              const isAuth = face.status === 'AUTHORIZED';
              const isUnverified = face.status === 'UNKNOWN' || face.status === 'SUSPICIOUS';
              const cornerColor = isAuth ? 'border-emerald-300' : isUnverified ? 'border-amber-300' : 'border-red-300';
              const isFaceSelected = selectedFaceId === face.id;
              const isNearTop = face.box_2d && face.box_2d[0] < 90;
              const isSmallDistantFace = face.box_2d && ((face.box_2d[2] - face.box_2d[0]) < 75 || (face.box_2d[3] - face.box_2d[1]) < 75);

              return (
                <div
                  key={`box-${camera.id}-${face.id || 'face'}-${fIdx}`}
                  style={{
                    ...boxStyle,
                    transition: 'top 0.08s ease-out, left 0.08s ease-out, width 0.08s ease-out, height 0.08s ease-out',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectFace(face);
                  }}
                  className={`absolute z-20 ${isSmallDistantFace ? 'rounded-sm' : 'rounded-md'} border-2 cursor-pointer transition-shadow ${
                    isAuth
                      ? 'border-emerald-400 bg-emerald-500/15 shadow-[0_0_12px_rgba(16,185,129,0.35)]'
                      : isUnverified
                      ? 'border-amber-400 bg-amber-500/15 shadow-[0_0_12px_rgba(245,158,11,0.35)]'
                      : 'border-red-500 bg-red-500/25 shadow-[0_0_16px_rgba(239,68,68,0.6)] animate-pulse'
                  } ${isFaceSelected ? 'ring-2 ring-amber-400 ring-offset-2 ring-offset-black' : ''}`}
                >
                  {/* Corner brackets for medium and large faces */}
                  {!isSmallDistantFace && (
                    <>
                      <div className={`absolute -top-1 -left-1 w-2 h-2 border-t-2 border-l-2 ${cornerColor}`} />
                      <div className={`absolute -top-1 -right-1 w-2 h-2 border-t-2 border-r-2 ${cornerColor}`} />
                      <div className={`absolute -bottom-1 -left-1 w-2 h-2 border-b-2 border-l-2 ${cornerColor}`} />
                      <div className={`absolute -bottom-1 -right-1 w-2 h-2 border-b-2 border-r-2 ${cornerColor}`} />
                    </>
                  )}

                  {/* Tag / Badge */}
                  <div
                    className={`absolute ${isNearTop ? 'top-1' : '-top-6'} left-0 px-1.5 py-0.5 rounded ${isSmallDistantFace ? 'text-[7px]' : 'text-[8px] sm:text-[9px]'} font-mono font-bold whitespace-nowrap shadow-lg flex items-center gap-1 uppercase tracking-tight z-30 pointer-events-none ${
                      isAuth 
                        ? 'bg-emerald-600 text-white border border-emerald-300 shadow-emerald-950/40' 
                        : isUnverified
                        ? 'bg-amber-500 text-zinc-950 border border-amber-200 shadow-amber-950/40'
                        : 'bg-red-600 text-white border border-red-300 shadow-red-950/60 animate-pulse'
                    }`}
                  >
                    {isAuth
                      ? <UserCheck className="w-2.5 h-2.5 text-emerald-100 flex-shrink-0" />
                      : isUnverified
                      ? <Scan className="w-2.5 h-2.5 flex-shrink-0" />
                      : <UserX className="w-2.5 h-2.5 text-white flex-shrink-0" />}
                    <span>
                      {isAuth
                        ? `VERIFIED: ${face.matchedName || 'STAFF'} (${face.matchedPersonnelId || 'CLEAR'}) • ${camera.zone}`
                        : isUnverified
                        ? `${face.status === 'SUSPICIOUS' ? 'REVIEW REQUIRED' : 'UNVERIFIED'}: ${face.matchedName || 'Identity not confirmed'} • ${camera.zone}`
                        : `⚠️ UNAUTHORIZED: ${face.matchedName || 'UNREGISTERED'} • ${camera.zone}`}
                    </span>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Bottom Telemetry & Quick Action Bar */}
      <div className="bg-zinc-900 border-t border-zinc-800 px-3 py-2 flex items-center justify-between text-[10px] font-mono text-zinc-400">
        <div className="flex items-center gap-2">
          {isFeedClosed ? (
            <span className="text-zinc-500 font-semibold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
              <span>OFFLINE / STANDBY</span>
            </span>
          ) : (
            <>
              <span className="text-zinc-300 font-semibold">{camera.fps} FPS</span>
              <span className="text-zinc-600">•</span>
              <span className="text-zinc-500 hidden sm:inline">{camera.resolution.split(' ')[0]}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* Zoom controls suite */}
          {!isFeedClosed && (
            <div className="flex items-center bg-zinc-950/80 rounded-md border border-zinc-700/80 p-0.5">
              {/* Zoom Out / Decrease */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const current = camera.ptzZoom || 1;
                  const next = Math.max(1, Math.round((current - 0.25) * 100) / 100);
                  onUpdateChannel(camera.id, { ptzZoom: next });
                }}
                disabled={(camera.ptzZoom || 1) <= 1}
                className={`p-1 rounded text-zinc-300 transition-colors ${
                  (camera.ptzZoom || 1) <= 1
                    ? 'opacity-30 cursor-not-allowed'
                    : 'hover:bg-zinc-800 hover:text-white'
                }`}
                title="Zoom Out (-0.25x)"
              >
                <ZoomOut className="w-3 h-3" />
              </button>

              {/* Current Zoom Toggle / Reset to 1x */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const current = camera.ptzZoom || 1;
                  const next = current >= 3 ? 1 : current === 1 ? 1.5 : current === 1.5 ? 2 : current === 2 ? 3 : 1;
                  onUpdateChannel(camera.id, { ptzZoom: next });
                }}
                className={`px-1.5 py-0.5 text-[9px] font-mono font-bold rounded transition-colors ${
                  (camera.ptzZoom || 1) > 1
                    ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title="Click to cycle zoom presets (1x, 1.5x, 2x, 3x)"
              >
                {(camera.ptzZoom || 1).toFixed(1)}x
              </button>

              {/* Zoom In / Increase */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const current = camera.ptzZoom || 1;
                  const next = Math.min(3, Math.round((current + 0.25) * 100) / 100);
                  onUpdateChannel(camera.id, { ptzZoom: next });
                }}
                disabled={(camera.ptzZoom || 1) >= 3}
                className={`p-1 rounded text-zinc-300 transition-colors ${
                  (camera.ptzZoom || 1) >= 3
                    ? 'opacity-30 cursor-not-allowed'
                    : 'hover:bg-zinc-800 hover:text-white'
                }`}
                title="Zoom In (+0.25x)"
              >
                <ZoomIn className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Quick Scan Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onScanChannel(camera.id);
            }}
            disabled={isScanningThisChannel || isFeedClosed}
            className={`flex items-center gap-1 px-2 py-1 rounded font-bold transition-all ${
              isFeedClosed
                ? 'bg-zinc-950 text-zinc-600 border border-zinc-800 cursor-not-allowed opacity-50'
                : isScanningThisChannel
                ? 'bg-zinc-700 text-zinc-400 cursor-not-allowed'
                : 'bg-zinc-800 hover:bg-zinc-700 active:bg-amber-600 text-zinc-200 hover:text-white border border-zinc-700'
            }`}
            title={isFeedClosed ? 'Camera zone closed / offline' : isScanningThisChannel ? 'Analyzing the latest camera frame' : 'Scan this camera feed'}
          >
            <Scan className={`w-3 h-3 ${isScanningThisChannel ? 'animate-spin' : ''}`} />
            <span>{isFeedClosed ? 'CLOSED' : isScanningThisChannel ? 'ANALYZING' : 'SCAN'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
