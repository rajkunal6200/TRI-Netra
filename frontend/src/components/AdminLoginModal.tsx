import React, { useState, useEffect } from 'react';
import { 
  Lock, 
  ShieldCheck, 
  Eye, 
  EyeOff, 
  AlertCircle, 
  KeyRound, 
  CheckCircle2, 
  User, 
  Sparkles, 
  LogOut,
  RefreshCw
} from 'lucide-react';
import { AdminUser } from '@shared/types';
import { loginAdmin, changeAdminPassword, logoutAdmin, quickDemoLogin, resetAdminCredentials } from '../utils/adminAuth';

interface AdminLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  isAdmin: boolean;
  adminUser: AdminUser | null;
  onLoginSuccess: (user: AdminUser) => void;
  onLogoutSuccess: () => void;
  promptReason?: string;
}

export const AdminLoginModal: React.FC<AdminLoginModalProps> = ({
  isOpen,
  onClose,
  isAdmin,
  adminUser,
  onLoginSuccess,
  onLogoutSuccess,
  promptReason,
}) => {
  const [tab, setTab] = useState<'login' | 'change_password' | 'profile'>('login');
  
  // Login form state
  const [username, setUsername] = useState<string>('admin');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [rememberMe, setRememberMe] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [successMessage, setSuccessMessage] = useState<string>('');

  // Change password form state
  const [currentPassword, setCurrentPassword] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [showNewPassword, setShowNewPassword] = useState<boolean>(false);

  // Sync tab when modal opens
  useEffect(() => {
    if (isOpen) {
      setErrorMessage('');
      setSuccessMessage('');
      if (isAdmin) {
        setTab('profile');
      } else {
        setTab('login');
      }
    }
  }, [isOpen, isAdmin]);

  if (!isOpen) return null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');
    setIsSubmitting(true);

    try {
      const result = await loginAdmin(username, password, rememberMe);
      if (result.success && result.user) {
        setSuccessMessage('Authentication verified. Admin access granted.');
        onLoginSuccess(result.user);
        setTimeout(() => {
          onClose();
        }, 500);
      } else {
        setErrorMessage(result.error || 'Authentication failed. Please check credentials.');
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Authentication error. Please retry.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuickFill = () => {
    setUsername('admin');
    setPassword('admin123');
    setErrorMessage('');
  };

  const handleOneClickLogin = async () => {
    setUsername('admin');
    setPassword('admin123');
    setErrorMessage('');
    setSuccessMessage('');
    setIsSubmitting(true);
    try {
      const result = await quickDemoLogin();
      if (result.success && result.user) {
        setSuccessMessage('Admin clearance verified. Welcome back.');
        onLoginSuccess(result.user);
        setTimeout(() => {
          onClose();
        }, 400);
      } else {
        setErrorMessage(result.error || 'Authentication error.');
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to authenticate.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetCredentials = async () => {
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const resetSucceeded = await resetAdminCredentials();
      if (!resetSucceeded) {
        setErrorMessage('Credential reset is unavailable. Ask an administrator to configure the server.');
        return;
      }
      setUsername('admin');
      setPassword('admin123');
      setSuccessMessage('Password reset to default (admin123) and terminal unlocked.');
    } catch (e: any) {
      setErrorMessage('Failed to reset credentials.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChangePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (newPassword !== confirmPassword) {
      setErrorMessage('New passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      setErrorMessage('New password must be at least 8 characters');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await changeAdminPassword(currentPassword, newPassword);
      if (result.success) {
        setSuccessMessage('Password updated successfully. Remember your new credentials.');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setErrorMessage(result.error || 'Failed to update password');
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Password update failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await logoutAdmin();
    onLogoutSuccess();
    setTab('login');
    setPassword('');
    setSuccessMessage('Admin session terminated. Operator mode active.');
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-zinc-950/70 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white border border-zinc-200 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5 my-8 relative">
        {/* Header with Defense Icon */}
        <div className="flex items-start justify-between border-b border-zinc-100 pb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-md ${
              isAdmin 
                ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' 
                : 'bg-zinc-900 text-white border border-zinc-700'
            }`}>
              {isAdmin ? <ShieldCheck className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-black text-base text-zinc-950 uppercase font-sans tracking-tight">
                  {isAdmin ? 'Admin Console' : 'Security Clearance Login'}
                </h3>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase ${
                  isAdmin 
                    ? 'bg-emerald-100 text-emerald-800' 
                    : 'bg-zinc-100 text-zinc-700'
                }`}>
                  {isAdmin ? 'Authorized' : 'Restricted'}
                </span>
              </div>
              <p className="text-xs text-zinc-500 font-mono mt-0.5">
                TRINETRA OPTICAL DEFENSE AUTHORIZATION
              </p>
            </div>
          </div>
          <button
            id="btn-close-admin-modal"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-950 font-mono text-sm px-2 py-1 rounded hover:bg-zinc-100 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Reason banner if triggered by a restricted action */}
        {promptReason && !isAdmin && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-amber-900">Authorization Required</p>
              <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">{promptReason}</p>
            </div>
          </div>
        )}

        {/* Tab Navigation if Logged In */}
        {isAdmin && (
          <div className="flex items-center bg-zinc-100 p-1 rounded-xl border border-zinc-200">
            <button
              id="tab-admin-profile"
              onClick={() => { setTab('profile'); setErrorMessage(''); setSuccessMessage(''); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                tab === 'profile'
                  ? 'bg-white text-zinc-950 shadow-sm border border-zinc-200/80'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>Status</span>
            </button>
            <button
              id="tab-admin-change-pass"
              onClick={() => { setTab('change_password'); setErrorMessage(''); setSuccessMessage(''); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                tab === 'change_password'
                  ? 'bg-white text-zinc-950 shadow-sm border border-zinc-200/80'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Change Password</span>
            </button>
          </div>
        )}

        {/* Alerts & Feedback */}
        {errorMessage && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl p-3 flex flex-col gap-2.5 font-mono">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
              <div className="flex-1 leading-relaxed">{errorMessage}</div>
            </div>
            {import.meta.env.DEV && <div className="flex items-center justify-between pt-2 border-t border-red-200/80 gap-2">
              <button
                type="button"
                onClick={handleResetCredentials}
                className="text-[11px] font-bold text-zinc-600 hover:text-zinc-950 underline cursor-pointer"
              >
                Reset Demo Credentials
              </button>
              <button
                type="button"
                id="btn-error-one-click-login"
                onClick={handleOneClickLogin}
                className="px-3 py-1.5 rounded-lg bg-zinc-950 hover:bg-zinc-800 text-white font-bold text-xs transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>Demo Login</span>
              </button>
            </div>}
          </div>
        )}

        {successMessage && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl p-3 flex items-start gap-2 font-mono">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
            <div className="flex-1">{successMessage}</div>
          </div>
        )}

        {/* Tab 1: Login Form (When not logged in) */}
        {!isAdmin && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-mono font-bold text-zinc-700 uppercase mb-1.5">
                Admin Username or Clearance ID
              </label>
              <div className="relative">
                <input
                  id="admin-login-username"
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  className="w-full bg-zinc-50 border border-zinc-300 rounded-xl px-3.5 py-2.5 text-sm text-zinc-950 font-mono focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:bg-white transition-all"
                />
                <User className="w-4 h-4 text-zinc-400 absolute right-3.5 top-3" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono font-bold text-zinc-700 uppercase mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  id="admin-login-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your admin password"
                  className="w-full bg-zinc-50 border border-zinc-300 rounded-xl px-3.5 py-2.5 text-sm text-zinc-950 font-mono focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:bg-white transition-all pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-zinc-400 hover:text-zinc-700 p-1 cursor-pointer"
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Development-only demo credentials */}
            {import.meta.env.DEV && <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-3 text-xs font-mono text-zinc-600 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <span className="text-zinc-500">Default: </span>
                <span className="font-bold text-zinc-900">admin</span> / <span className="font-bold text-zinc-900">admin123</span>
              </div>
              <div className="flex items-center gap-1.5 self-end sm:self-auto">
                <button
                  type="button"
                  id="btn-quick-fill-credentials"
                  onClick={handleQuickFill}
                  className="text-[11px] font-bold text-zinc-700 bg-white hover:bg-zinc-100 border border-zinc-300 px-2.5 py-1 rounded-md transition-colors cursor-pointer"
                >
                  Fill Form
                </button>
                <button
                  type="button"
                  id="btn-quick-demo-login"
                  onClick={handleOneClickLogin}
                  disabled={isSubmitting}
                  className="text-[11px] font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 px-2.5 py-1 rounded-md transition-colors flex items-center gap-1 cursor-pointer shadow-sm"
                >
                  <Sparkles className="w-3 h-3 text-amber-700" />
                  1-Click Login
                </button>
              </div>
            </div>}

            <div className="flex items-center justify-between text-xs">
              <label className="flex items-center gap-2 cursor-pointer select-none text-zinc-600">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                />
                <span>Keep session active</span>
              </label>
            </div>

            <button
              id="btn-admin-submit-login"
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-zinc-950 hover:bg-zinc-800 text-white font-bold py-3 rounded-xl shadow-md transition-all flex items-center justify-center gap-2 text-sm tracking-wide disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Verifying Credentials...</span>
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  <span>Authenticate as Admin</span>
                </>
              )}
            </button>
          </form>
        )}

        {/* Tab 2: Profile & Active Status (When Logged In) */}
        {isAdmin && tab === 'profile' && (
          <div className="space-y-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-sm">
                AD
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-bold text-emerald-950 font-mono">
                  {adminUser?.username || 'admin'}
                </h4>
                <p className="text-xs text-emerald-700 font-mono">
                  Role: {adminUser?.role || 'SYSTEM_ADMINISTRATOR'}
                </p>
                <p className="text-[11px] text-emerald-600 font-mono mt-0.5">
                  Authenticated: {adminUser?.loginTime ? new Date(adminUser.loginTime).toLocaleTimeString() : 'Current Session'}
                </p>
              </div>
            </div>

            <div className="space-y-2 text-xs font-mono text-zinc-600 border border-zinc-200 rounded-xl p-3 bg-zinc-50">
              <div className="flex items-center justify-between pb-1.5 border-b border-zinc-200/60">
                <span>Personnel Directory Management:</span>
                <span className="font-bold text-emerald-700">UNRESTRICTED</span>
              </div>
              <div className="flex items-center justify-between pb-1.5 border-b border-zinc-200/60">
                <span>Surveillance Configurations:</span>
                <span className="font-bold text-emerald-700">UNRESTRICTED</span>
              </div>
              <div className="flex items-center justify-between pb-1.5 border-b border-zinc-200/60">
                <span>Emergency Sector Lockdown:</span>
                <span className="font-bold text-emerald-700">AUTHORIZED</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Incident Log Clearance:</span>
                <span className="font-bold text-emerald-700">AUTHORIZED</span>
              </div>
            </div>

            <div className="flex gap-2.5 pt-2">
              <button
                id="btn-admin-logout"
                type="button"
                onClick={handleLogout}
                className="flex-1 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-bold py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 text-xs font-mono cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>Lock Console / Logout</span>
              </button>
              <button
                id="btn-admin-done"
                type="button"
                onClick={onClose}
                className="flex-1 bg-zinc-950 hover:bg-zinc-800 text-white font-bold py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 text-xs font-mono cursor-pointer"
              >
                <span>Return to Feed</span>
              </button>
            </div>
          </div>
        )}

        {/* Tab 3: Change Password Form (When Logged In) */}
        {isAdmin && tab === 'change_password' && (
          <form onSubmit={handleChangePasswordSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-mono font-bold text-zinc-700 uppercase mb-1">
                Current Password
              </label>
              <input
                id="admin-change-current-pass"
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Current password"
                className="w-full bg-zinc-50 border border-zinc-300 rounded-xl px-3 py-2 text-sm font-mono text-zinc-950 focus:outline-none focus:ring-2 focus:ring-zinc-950"
              />
            </div>

            <div>
              <label className="block text-xs font-mono font-bold text-zinc-700 uppercase mb-1">
                New Admin Password
              </label>
              <div className="relative">
                <input
                  id="admin-change-new-pass"
                  type={showNewPassword ? 'text' : 'password'}
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="w-full bg-zinc-50 border border-zinc-300 rounded-xl px-3 py-2 text-sm font-mono text-zinc-950 focus:outline-none focus:ring-2 focus:ring-zinc-950 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-2.5 top-2 text-zinc-400 hover:text-zinc-700 p-1"
                >
                  {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono font-bold text-zinc-700 uppercase mb-1">
                Confirm New Password
              </label>
              <input
                id="admin-change-confirm-pass"
                type={showNewPassword ? 'text' : 'password'}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                className="w-full bg-zinc-50 border border-zinc-300 rounded-xl px-3 py-2 text-sm font-mono text-zinc-950 focus:outline-none focus:ring-2 focus:ring-zinc-950"
              />
            </div>

            <div className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setTab('profile')}
                className="flex-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold py-2.5 rounded-xl transition-all text-xs font-mono"
              >
                Cancel
              </button>
              <button
                id="btn-admin-save-password"
                type="submit"
                disabled={isSubmitting}
                className="flex-1 bg-zinc-950 hover:bg-zinc-800 text-white font-bold py-2.5 rounded-xl transition-all text-xs font-mono disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSubmitting ? 'Updating...' : 'Save New Password'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
