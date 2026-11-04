import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Camera, 
  FlipHorizontal, 
  Wifi, 
  WifiOff, 
  Battery, 
  Zap, 
  ZapOff, 
  ShieldCheck, 
  ExternalLink,
  RefreshCw,
  Sliders,
  Maximize2,
  Radio
} from 'lucide-react';
import { PhoneWebRTCTransmitter } from '../utils/webrtc';

interface MobileCameraTransmitterProps {
  initialPairCode?: string;
  initialChannelId?: string;
  onExit?: () => void;
}

export const MobileCameraTransmitter: React.FC<MobileCameraTransmitterProps> = ({
  initialPairCode = 'PHONE-1',
  initialChannelId = 'cam-2',
  onExit,
}) => {
  const [pairCode, setPairCode] = useState<string>(initialPairCode);
  const [channelId, setChannelId] = useState<string>(initialChannelId);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [isStreaming, setIsStreaming] = useState<boolean>(true);
  const [fps, setFps] = useState<number>(24);
  const [hasTorch, setHasTorch] = useState<boolean>(false);
  const [isTorchOn, setIsTorchOn] = useState<boolean>(false);
  const [isConnectedToServer, setIsConnectedToServer] = useState<boolean>(true);
  const [lastUploadedAt, setLastUploadedAt] = useState<string>('Initializing...');
  const [framesSentCount, setFramesSentCount] = useState<number>(0);
  const [deviceModel, setDeviceModel] = useState<string>('');
  const [batteryLevel, setBatteryLevel] = useState<number | undefined>(undefined);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number>(10);
  const [p2pStatus, setP2pStatus] = useState<string>('Initializing P2P...');
  const [isP2pActive, setIsP2pActive] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isUploadingRef = useRef<boolean>(false);
  const activeFetchControllerRef = useRef<AbortController | null>(null);
  const webrtcTransmitterRef = useRef<PhoneWebRTCTransmitter | null>(null);

  // Detect device name
  useEffect(() => {
    const ua = navigator.userAgent;
    let model = 'Smartphone';
    if (/iPhone/i.test(ua)) model = 'Apple iPhone';
    else if (/iPad/i.test(ua)) model = 'Apple iPad';
    else if (/Android/i.test(ua)) {
      const match = ua.match(/Android.*;\s*([^;)]+)\s*\)/);
      model = match ? match[1] : 'Android Mobile';
    } else {
      model = 'Remote Camera Device';
    }
    setDeviceModel(model);

    // Battery API if available
    if ('getBattery' in navigator) {
      (navigator as any).getBattery?.().then((bat: any) => {
        setBatteryLevel(Math.round(bat.level * 100));
        bat.addEventListener('levelchange', () => {
          setBatteryLevel(Math.round(bat.level * 100));
        });
      }).catch(() => {});
    }
  }, []);

  // Initialize camera stream
  const startCamera = useCallback(async () => {
    try {
      setCameraError(null);
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setCameraError('Phone camera access requires a secure HTTPS page. Open the pairing link from a reachable HTTPS address and allow camera permission.');
        return;
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }

      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: facingMode },
          // Keep these as ideals so older phones can negotiate a supported
          // resolution instead of rejecting the camera request entirely.
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      // Initialize Zero-Latency WebRTC P2P Broadcaster
      if (webrtcTransmitterRef.current) {
        webrtcTransmitterRef.current.destroy();
      }

      const transmitter = new PhoneWebRTCTransmitter(pairCode, (status, isConnected) => {
        setP2pStatus(status);
        setIsP2pActive(isConnected);
      });
      transmitter.startBroadcasting(stream);
      webrtcTransmitterRef.current = transmitter;

      // Check for torch capability
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const capabilities: any = videoTrack.getCapabilities?.() || {};
        setHasTorch(!!capabilities.torch);
      }
    } catch (err: any) {
      console.error('Camera stream access failed:', err);
      setCameraError(err.message || 'Unable to access device camera. Please grant camera permissions.');
    }
  }, [facingMode, pairCode]);

  useEffect(() => {
    startCamera();
    return () => {
      if (webrtcTransmitterRef.current) {
        webrtcTransmitterRef.current.destroy();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [startCamera]);

  // Toggle Torch / Flashlight
  const toggleTorch = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (track && hasTorch) {
      try {
        const nextTorch = !isTorchOn;
        await (track as any).applyConstraints({
          advanced: [{ torch: nextTorch }],
        });
        setIsTorchOn(nextTorch);
      } catch (err) {
        console.warn('Torch toggle failed:', err);
      }
    }
  };

  // Flip camera between front and back
  const flipCamera = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  // Ultra-Fast Real-Time Frame Streaming Loop (Adaptive zero-lag pipeline)
  useEffect(() => {
    if (!isStreaming) {
      // Immediately notify server that stream is stopped so the zone goes black without delay
      fetch('/api/phone-camera/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairCode: pairCode.toUpperCase() }),
      }).catch(() => {});
      return;
    }

    let isMounted = true;
    let animationFrameId: number | null = null;
    let lastFrameTime = 0;
    const frameIntervalMs = Math.max(30, Math.round(1000 / fps));

    const renderAndPush = async () => {
      if (!isMounted || !isStreaming) return;

      const now = performance.now();
      const elapsed = now - lastFrameTime;

      if (elapsed >= frameIntervalMs) {
        const video = videoRef.current;
        if (video && video.readyState >= 2 && video.videoWidth > 0) {
          // If previous frame is still in flight, abort it so network buffers never build up lag
          if (activeFetchControllerRef.current) {
            activeFetchControllerRef.current.abort();
            activeFetchControllerRef.current = null;
          }

          isUploadingRef.current = true;
          const sendStart = performance.now();

          const canvas = canvasRef.current || document.createElement('canvas');
          const ctx = canvas.getContext('2d', { alpha: false });
          
          if (ctx) {
            // Preserve enough facial detail for recognition and usable incident snapshots.
            // Never upscale cameras that provide a smaller frame.
            const targetWidth = Math.min(1920, video.videoWidth);
            const scale = targetWidth / video.videoWidth;
            canvas.width = targetWidth;
            canvas.height = Math.round(video.videoHeight * scale);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            // Higher JPEG quality keeps faces clear; frame uploads still replace older
            // in-flight frames so the stream does not build up latency.
            canvas.toBlob(
              async (blob) => {
                if (!blob || !isMounted) {
                  isUploadingRef.current = false;
                  return;
                }

                const controller = new AbortController();
                activeFetchControllerRef.current = controller;

                try {
                  const url = `/api/phone-camera/push-binary/${encodeURIComponent(pairCode.toUpperCase())}?channelId=${encodeURIComponent(channelId)}&deviceModel=${encodeURIComponent(deviceModel)}&fps=${fps}&facingMode=${facingMode}${batteryLevel !== undefined ? `&batteryLevel=${batteryLevel}` : ''}`;
                  
                  const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'image/jpeg' },
                    body: blob,
                    signal: controller.signal,
                  });

                  if (res.ok) {
                    setIsConnectedToServer(true);
                    setFramesSentCount((prev) => prev + 1);
                    setLastUploadedAt(new Date().toLocaleTimeString());
                    const rtt = Math.round(performance.now() - sendStart);
                    setLatencyMs(rtt);
                  } else {
                    setIsConnectedToServer(false);
                  }
                } catch (err: any) {
                  if (err?.name !== 'AbortError') {
                    setIsConnectedToServer(false);
                  }
                } finally {
                  if (activeFetchControllerRef.current === controller) {
                    activeFetchControllerRef.current = null;
                  }
                  isUploadingRef.current = false;
                }
              },
              'image/jpeg',
              0.92
            );

            lastFrameTime = now;
          } else {
            isUploadingRef.current = false;
          }
        }
      }

      if (isMounted && isStreaming) {
        animationFrameId = requestAnimationFrame(renderAndPush);
      }
    };

    animationFrameId = requestAnimationFrame(renderAndPush);

    return () => {
      isMounted = false;
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [isStreaming, fps, pairCode, channelId, deviceModel, batteryLevel, facingMode]);

  // Notify server on exit / page unloads
  useEffect(() => {
    const handleUnload = () => {
      if (navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify({ pairCode: pairCode.toUpperCase() })], {
          type: 'application/json',
        });
        navigator.sendBeacon('/api/phone-camera/stop', blob);
      }
    };

    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);

    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('pagehide', handleUnload);
      handleUnload();
    };
  }, [pairCode]);

  const handleExitTransmitter = () => {
    // Notify server immediately to close the zone
    fetch('/api/phone-camera/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairCode: pairCode.toUpperCase() }),
    }).catch(() => {});

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }

    if (onExit) {
      onExit();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black text-white flex flex-col font-sans select-none overflow-hidden">
      {/* Hidden Canvas for Frame Processing */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Top Mobile Transmitter Bar */}
      <div className="bg-zinc-950/90 border-b border-zinc-800 px-4 py-3 flex items-center justify-between z-20 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-red-600 text-white animate-pulse">
            <Camera className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono font-black text-sm text-white">TRINETRA REMOTE CAM</span>
              <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-mono text-[10px] font-bold border border-amber-500/30">
                {pairCode}
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 font-mono">
              Target: <span className="text-white font-semibold">{channelId.toUpperCase()}</span> | {deviceModel}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isP2pActive ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/90 border border-emerald-400 text-emerald-300 text-xs font-mono font-bold shadow-[0_0_10px_rgba(16,185,129,0.3)]">
              <Radio className="w-3.5 h-3.5 animate-pulse text-emerald-400" />
              <span>P2P 0ms REALTIME</span>
            </div>
          ) : isConnectedToServer ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-950/80 border border-amber-500/40 text-amber-300 text-xs font-mono font-bold">
              <Wifi className="w-3.5 h-3.5 animate-pulse" />
              <span>SYNCING...</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-950/80 border border-red-500/40 text-red-400 text-xs font-mono font-bold">
              <WifiOff className="w-3.5 h-3.5" />
              <span>OFFLINE</span>
            </div>
          )}

          {onExit && (
            <button
              onClick={handleExitTransmitter}
              className="px-3 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold font-mono transition-all"
            >
              Exit
            </button>
          )}
        </div>
      </div>

      {/* Main Full-Screen Video Stage */}
      <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden">
        {cameraError ? (
          <div className="p-6 text-center max-w-md bg-zinc-900 rounded-2xl border border-red-800 m-4">
            <div className="w-12 h-12 rounded-full bg-red-950 border border-red-500 flex items-center justify-center mx-auto mb-3 text-red-400">
              <Camera className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-white mb-1">Camera Permission Required</h3>
            <p className="text-xs text-zinc-400 mb-4">{cameraError}</p>
            <button
              onClick={startCamera}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold transition-all"
            >
              Retry Camera Access
            </button>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        )}

        {/* Optical Scanning HUD Grid Overlay */}
        <div className="absolute inset-0 pointer-events-none border-2 border-emerald-500/20 m-3 rounded-2xl flex flex-col justify-between p-4">
          <div className="flex items-center justify-between text-[11px] font-mono text-emerald-400/80">
            <span>[OPTICAL TRANSMITTER ACTIVE]</span>
            <span className="flex items-center gap-2">
              <span className="text-amber-300">RTT: {latencyMs}ms</span>
              <span>FPS: {fps}</span>
              <span>SENT: {framesSentCount}</span>
            </span>
          </div>

          <div className="flex items-center justify-center">
            <div className="w-16 h-16 border-2 border-dashed border-emerald-400/40 rounded-full animate-spin" style={{ animationDuration: '8s' }} />
          </div>

          <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400">
            <span>FACING: {facingMode.toUpperCase()}</span>
            <span>LAST SYNC: {lastUploadedAt}</span>
          </div>
        </div>
      </div>

      {/* Bottom Floating Control Bar */}
      <div className="bg-zinc-950/95 border-t border-zinc-800 p-4 z-20 backdrop-blur-lg">
        <div className="max-w-md mx-auto flex items-center justify-between gap-3">
          {/* Flip Front / Back */}
          <button
            onClick={flipCamera}
            className="flex-1 py-3 px-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 flex items-center justify-center gap-2 text-xs font-bold font-mono transition-all active:scale-95"
          >
            <FlipHorizontal className="w-4 h-4 text-amber-400" />
            <span>Flip Lens</span>
          </button>

          {/* Torch Toggle */}
          {hasTorch && (
            <button
              onClick={toggleTorch}
              className={`p-3 rounded-xl border flex items-center justify-center transition-all active:scale-95 ${
                isTorchOn
                  ? 'bg-amber-500 text-zinc-950 border-amber-400 shadow-lg shadow-amber-500/30'
                  : 'bg-zinc-900 text-zinc-300 border-zinc-700 hover:bg-zinc-800'
              }`}
              title="Toggle Flashlight Torch"
            >
              {isTorchOn ? <Zap className="w-5 h-5" /> : <ZapOff className="w-5 h-5" />}
            </button>
          )}

          {/* Stream Pause / Play */}
          <button
            onClick={() => setIsStreaming(!isStreaming)}
            className={`flex-1 py-3 px-3 rounded-xl border flex items-center justify-center gap-2 text-xs font-bold font-mono transition-all active:scale-95 ${
              isStreaming
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500 shadow-md'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400 border-zinc-700'
            }`}
          >
            <span className={`w-2.5 h-2.5 rounded-full ${isStreaming ? 'bg-white animate-ping' : 'bg-zinc-500'}`} />
            <span>{isStreaming ? 'STREAMING' : 'PAUSED'}</span>
          </button>

          {/* Target Channel Selector */}
          <select
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs font-mono font-bold px-2.5 py-3 rounded-xl"
          >
            <option value="cam-1">CAM 01</option>
            <option value="cam-2">CAM 02</option>
            <option value="cam-3">CAM 03</option>
            <option value="cam-4">CAM 04</option>
          </select>
        </div>

        {/* Transmission Settings Strip */}
        <div className="max-w-md mx-auto mt-3 pt-3 border-t border-zinc-800/80 flex items-center justify-between text-xs font-mono text-zinc-400">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <span>FPS Rate:</span>
            {[10, 15, 20, 24, 30].map((rate) => (
              <button
                key={rate}
                onClick={() => setFps(rate)}
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  fps === rate ? 'bg-amber-500 text-black shadow-md' : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
                }`}
              >
                {rate}
              </button>
            ))}
          </div>

          {batteryLevel !== undefined && (
            <div className="flex items-center gap-1 text-[11px]">
              <Battery className="w-3.5 h-3.5 text-zinc-400" />
              <span>{batteryLevel}%</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
