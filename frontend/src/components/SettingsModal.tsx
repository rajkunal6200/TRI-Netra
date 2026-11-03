import React from 'react';
import { 
  Settings, 
  Volume2, 
  VolumeX, 
  ShieldAlert, 
  Sliders, 
  Zap, 
  Eye, 
  Moon, 
  Lock, 
  CheckCircle2,
  Bell
} from 'lucide-react';
import { SurveillanceSettings } from '@shared/types';
import { soundEngine } from '../utils/audioAlert';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: SurveillanceSettings;
  onUpdateSettings: (newSettings: Partial<SurveillanceSettings>) => void;
  isAdmin?: boolean;
  onOpenAdminLogin?: () => void;
  onRequireAdmin?: (actionCallback: () => void, promptReason: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  isAdmin = false,
  onOpenAdminLogin,
  onRequireAdmin,
}) => {
  if (!isOpen) return null;

  const updateRestrictedSetting = (update: () => void, promptReason: string) => {
    if (isAdmin) {
      update();
    } else if (onRequireAdmin) {
      onRequireAdmin(update, promptReason);
    } else {
      onOpenAdminLogin?.();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white border border-zinc-200 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 my-8">
        <div className="flex items-center justify-between border-b border-zinc-200 pb-3">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-zinc-900" />
            <h3 className="font-bold text-base text-zinc-950">
              Surveillance Engine & Alert Configurations
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-950 font-mono text-sm"
          >
            ✕ Close
          </button>
        </div>

        {/* Admin Authorization Status Banner */}
        <div className={`p-3 rounded-xl border flex items-center justify-between text-xs font-mono ${
          isAdmin 
            ? 'bg-emerald-50 border-emerald-200 text-emerald-900' 
            : 'bg-zinc-50 border-zinc-200 text-zinc-700'
        }`}>
          <div className="flex items-center gap-2">
            {isAdmin ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <Lock className="w-4 h-4 text-amber-600 shrink-0" />
            )}
            <div>
              <div className="font-bold">
                {isAdmin ? 'Admin Clearance: Verified' : 'Operator Mode: Restricted'}
              </div>
              <div className="text-[11px] text-zinc-500">
                {isAdmin ? 'Authorized to tune parameters & defense triggers.' : 'Login with admin password for full privileges.'}
              </div>
            </div>
          </div>
          {onOpenAdminLogin && (
            <button
              id="btn-settings-admin-login"
              type="button"
              onClick={onOpenAdminLogin}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                isAdmin
                  ? 'bg-white hover:bg-emerald-100 text-emerald-800 border-emerald-300'
                  : 'bg-zinc-950 hover:bg-zinc-800 text-white border-zinc-950'
              }`}
            >
              {isAdmin ? 'Admin Security' : 'Admin Login'}
            </button>
          )}
        </div>

        <div className="space-y-4 text-xs">
          {/* Security Strictness Profile */}
          <div className="space-y-1.5">
            <label className="font-mono font-bold text-zinc-700 uppercase block">
              Security Strictness Mode
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'STANDARD', label: 'Standard', desc: 'Default office check' },
                { id: 'HIGH_SECURITY', label: 'High Sec', desc: 'Strict badge & clearance' },
                { id: 'MAXIMUM_RESTRICTION', label: 'Lockdown Strict', desc: 'Zero tolerance unknown' },
              ].map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => updateRestrictedSetting(
                    () => onUpdateSettings({ securityMode: mode.id as SurveillanceSettings['securityMode'] }),
                    'Admin clearance required to change the security strictness mode.'
                  )}
                  className={`p-2.5 rounded-lg border text-left transition-all ${
                    settings.securityMode === mode.id
                      ? 'bg-zinc-950 border-zinc-950 text-white font-bold shadow-sm'
                      : 'bg-zinc-50 border-zinc-200 text-zinc-700 hover:text-zinc-950 hover:border-zinc-300'
                  }`}
                >
                  <div className="font-bold text-xs">{mode.label}</div>
                  <div className="text-[10px] opacity-80 mt-0.5 font-mono">{mode.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Auto-Scan Interval */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-mono font-bold text-zinc-700 uppercase">
                Continuous Auto-Scan Frequency
              </label>
              <span className="font-mono text-zinc-950 font-bold">
                {settings.scanIntervalSeconds === 1 ? '⚡ 1s Ultra-Fast' : `Every ${settings.scanIntervalSeconds}s`}
              </span>
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {[1, 2, 3, 5, 8].map((sec) => (
                <button
                  key={sec}
                  onClick={() => onUpdateSettings({ scanIntervalSeconds: sec })}
                  className={`py-1.5 rounded-lg border text-center font-mono font-bold transition-all text-xs ${
                    settings.scanIntervalSeconds === sec
                      ? 'bg-zinc-950 border-zinc-950 text-white shadow-sm'
                      : 'bg-zinc-50 border-zinc-200 text-zinc-700 hover:text-zinc-950 hover:border-zinc-300'
                  }`}
                >
                  {sec === 1 ? '⚡ 1s' : sec === 2 ? '2s' : `${sec}s`}
                </button>
              ))}
            </div>
          </div>

          {/* Audio Siren Volume & Test */}
          <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-200 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-mono font-bold text-zinc-800 uppercase">
                <Bell className="w-3.5 h-3.5 text-amber-600" />
                <span>Audible Threat Siren</span>
              </div>
              <button
                onClick={() => {
                  onUpdateSettings({ audioAlerts: !settings.audioAlerts });
                  soundEngine.setMuted(!settings.audioAlerts);
                }}
                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                  settings.audioAlerts
                    ? 'bg-zinc-950 text-white border border-zinc-950'
                    : 'bg-zinc-200 text-zinc-700 border border-zinc-300'
                }`}
              >
                {settings.audioAlerts ? 'AUDIO ENABLED' : 'MUTED'}
              </button>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.1"
                value={settings.alertVolume}
                onChange={(e) => {
                  const vol = parseFloat(e.target.value);
                  onUpdateSettings({ alertVolume: vol });
                  soundEngine.setVolume(vol);
                }}
                className="flex-1 accent-zinc-950 cursor-pointer"
              />
              <span className="font-mono text-zinc-600 text-xs w-10 text-right font-bold">
                {Math.round(settings.alertVolume * 100)}%
              </span>
            </div>

            <div className="flex items-center flex-wrap gap-2 pt-1">
              <button
                onClick={() => soundEngine.testAudioSystem()}
                className="px-2.5 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-[10px] font-mono font-bold shadow-xs flex items-center gap-1"
              >
                <span>🚨 Test Voice & Siren Alert</span>
              </button>
              <button
                onClick={() => soundEngine.playIntruderAlarm()}
                className="px-2.5 py-1 rounded bg-red-50 hover:bg-red-100 border border-red-200 text-[10px] font-mono text-red-700 font-bold shadow-2xs"
              >
                Siren Only
              </button>
              <button
                onClick={() => soundEngine.playAuthorizedChime()}
                className="px-2.5 py-1 rounded bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-[10px] font-mono text-emerald-800 font-bold shadow-2xs"
              >
                Auth Chime
              </button>
            </div>
          </div>

          {/* Display & Visual Toggles */}
          <div className="space-y-2 pt-1">
            <label className="font-mono font-bold text-zinc-700 uppercase block">
              HUD & Visual Overlay Controls
            </label>

            <div className="space-y-2">
              <label className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-50 border border-zinc-200 cursor-pointer hover:bg-zinc-100/60">
                <span className="text-zinc-800 font-medium">Show AI Face Bounding Boxes & Confidence</span>
                <input
                  type="checkbox"
                  checked={settings.showBoundingBoxes}
                  onChange={(e) => onUpdateSettings({ showBoundingBoxes: e.target.checked })}
                  className="accent-zinc-950 w-4 h-4"
                />
              </label>

              <label className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-50 border border-zinc-200 cursor-pointer hover:bg-zinc-100/60">
                <span className="text-zinc-800 font-medium">Show CCTV Tactical Grid & Crosshairs</span>
                <input
                  type="checkbox"
                  checked={settings.showHudOverlay}
                  onChange={(e) => onUpdateSettings({ showHudOverlay: e.target.checked })}
                  className="accent-zinc-950 w-4 h-4"
                />
              </label>

              <label className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-50 border border-zinc-200 cursor-pointer hover:bg-zinc-100/60">
                <span className="text-zinc-800 font-medium">Auto-Trigger Lockdown on Critical Threat</span>
                <input
                  type="checkbox"
                  checked={settings.autoLockdownOnCritical}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    updateRestrictedSetting(
                      () => onUpdateSettings({ autoLockdownOnCritical: enabled }),
                      'Admin clearance required to change automatic lockdown behavior.'
                    );
                  }}
                  className="accent-zinc-950 w-4 h-4"
                />
              </label>
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-3 border-t border-zinc-200">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg bg-zinc-950 hover:bg-zinc-800 text-white text-xs font-bold transition-all shadow-sm uppercase tracking-wider"
          >
            Apply & Save
          </button>
        </div>
      </div>
    </div>
  );
};
