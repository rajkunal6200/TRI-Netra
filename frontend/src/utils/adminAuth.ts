import { AdminUser, AdminAuthState } from '@shared/types';
import { safeGetItem, safeSetItem } from '@shared/utils/storage';
import { traceRuntimeEvent } from './runtimeDiagnostics';

const ADMIN_STORAGE_KEY = 'trinetra_admin_session';
const ADMIN_SESSION_POLICY_KEY = 'trinetra_admin_session_policy_v2';
const DEFAULT_USERNAME = 'admin';

export function getStoredAdminSession(): AdminAuthState {
  try {
    const raw = safeGetItem(ADMIN_STORAGE_KEY) || getSessionStorageItem(ADMIN_STORAGE_KEY);
    if (!raw) return { isAdmin: false, user: null };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.username === 'string' && typeof parsed.token === 'string') {
      return {
        isAdmin: true,
        user: parsed,
      };
    }
  } catch (e) {
    console.warn('Failed to parse admin session:', e);
  }
  return { isAdmin: false, user: null };
}

export function getCachedAdminSessionUser(): AdminUser | null {
  if (safeGetItem(ADMIN_SESSION_POLICY_KEY) !== 'explicit-remember-v2') return null;
  const stored = getStoredAdminSession();
  if (!stored.user?.token || stored.user.token.startsWith('local_') || stored.user.token.startsWith('adm_local_')) {
    return null;
  }
  return getCachedAdminUserWithinSessionWindow(stored.user);
}

export async function verifyAdminSession(): Promise<AdminUser | null> {
  // Older builds remembered admin sessions by default. Clear that one-time
  // legacy session so the new explicit opt-in policy cannot auto-login users.
  if (safeGetItem(ADMIN_SESSION_POLICY_KEY) !== 'explicit-remember-v2') {
    const legacySession = getStoredAdminSession();
    clearStoredAdminSession();
    safeSetItem(ADMIN_SESSION_POLICY_KEY, 'explicit-remember-v2');
    if (legacySession.user?.token) {
      void fetch('/api/admin/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${legacySession.user.token}` },
      }).catch(() => {});
    }
    return null;
  }

  const stored = getStoredAdminSession();
  if (!stored.user?.token || stored.user.token.startsWith('local_') || stored.user.token.startsWith('adm_local_')) {
    clearStoredAdminSession();
    return null;
  }
  const verifyingToken = stored.user.token;

  try {
    const response = await fetch('/api/admin/verify', {
      headers: { Authorization: `Bearer ${verifyingToken}`, Accept: 'application/json' },
      cache: 'no-store',
    });
    traceRuntimeEvent('admin.session.verify.response', { status: response.status });

    // Only an explicit unauthorized response means the token is invalid. A
    // temporary server error (or a non-JSON proxy response) must not erase a
    // same-tab login while the surveillance API is recovering.
    if (response.status === 401) {
      traceRuntimeEvent('admin.session.verify.invalid');
      clearStoredAdminSessionIfTokenMatches(verifyingToken);
      return null;
    }

    if (!response.ok) {
      traceRuntimeEvent('admin.session.verify.transientFailure', { status: response.status });
      return getCachedAdminUserWithinSessionWindow(stored.user);
    }

    let data: { success?: boolean; authenticated?: boolean; user?: AdminUser };
    try {
      data = await response.json();
    } catch {
      traceRuntimeEvent('admin.session.verify.invalidPayload');
      return getCachedAdminUserWithinSessionWindow(stored.user);
    }

    if (!data.success || !data.authenticated || !data.user) {
      traceRuntimeEvent('admin.session.verify.invalidPayload');
      return getCachedAdminUserWithinSessionWindow(stored.user);
    }
    return { ...data.user, token: verifyingToken } as AdminUser;
  } catch {
    // A dropped verification request is not proof that the operator logged
    // out. Keep the same-tab session for the server's 8-hour session window.
    traceRuntimeEvent('admin.session.verify.networkFailure');
    return getCachedAdminUserWithinSessionWindow(stored.user);
  }
}

function getCachedAdminUserWithinSessionWindow(user: AdminUser): AdminUser | null {
  const loginTime = Date.parse(user.loginTime || '');
  const withinServerSessionWindow = Number.isFinite(loginTime) &&
    Date.now() - loginTime >= 0 &&
    Date.now() - loginTime < 8 * 60 * 60 * 1000;
  traceRuntimeEvent('admin.session.cacheFallback', { available: withinServerSessionWindow });
  return withinServerSessionWindow ? user : null;
}

function clearStoredAdminSession(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(ADMIN_STORAGE_KEY);
  } catch {
    // Storage can be disabled by browser privacy settings.
  }
  try {
    window.sessionStorage.removeItem(ADMIN_STORAGE_KEY);
  } catch {
    // Storage can be disabled by browser privacy settings.
  }
}

function getSessionStorageItem(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function clearStoredAdminSessionIfTokenMatches(token: string): void {
  if (getStoredAdminSession().user?.token === token) {
    clearStoredAdminSession();
  }
}

export async function loginAdmin(
  usernameInput: string,
  passwordInput: string,
  rememberSession = true
): Promise<{ success: boolean; user?: AdminUser; error?: string }> {
  const cleanUser = (usernameInput || 'admin').trim() || DEFAULT_USERNAME;
  const cleanPass = passwordInput || '';

  if (!cleanPass) {
    return { success: false, error: 'Password is required' };
  }

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: cleanUser, password: cleanPass }),
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success && typeof data.token === 'string' && data.user) {
      const user: AdminUser = {
        username: data.user?.username || cleanUser,
        role: data.user?.role || 'SYSTEM_ADMINISTRATOR',
        loginTime: data.user?.loginTime || new Date().toISOString(),
        token: data.token,
      };

      const serializedUser = JSON.stringify(user);
      if (rememberSession) {
        safeSetItem(ADMIN_STORAGE_KEY, serializedUser);
        try {
          window.sessionStorage.removeItem(ADMIN_STORAGE_KEY);
        } catch {
          // Keep the persistent session if session storage is unavailable.
        }
      } else {
        // Keep a login for this tab's lifetime so a page refresh or component
        // recovery does not silently log the operator out.
        clearStoredAdminSession();
        try {
          window.sessionStorage.setItem(ADMIN_STORAGE_KEY, serializedUser);
        } catch {
          // The active React session still works if browser storage is blocked.
        }
      }
      return { success: true, user };
    } else {
      return { success: false, error: data.error || 'Invalid admin credentials.' };
    }
  } catch {
    return { success: false, error: 'Unable to reach the admin authentication service.' };
  }
}

export async function quickDemoLogin(): Promise<{ success: boolean; user?: AdminUser; error?: string }> {
  return loginAdmin('admin', 'admin123', false);
}

export async function resetAdminCredentials(): Promise<boolean> {
  try {
    const response = await fetch('/api/admin/reset', { method: 'POST' });
    const data = await response.json().catch(() => ({}));
    return response.ok && Boolean(data.success);
  } catch {
    return false;
  }
}

export async function logoutAdmin(): Promise<void> {
  try {
    const session = getStoredAdminSession();
    if (session.user?.token) {
      await fetch('/api/admin/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.user.token}`,
        },
      }).catch(() => {});
    }
  } catch (e) {
    // Ignore network errors on logout
  } finally {
    clearStoredAdminSession();
  }
}

export async function changeAdminPassword(
  currentPassword: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  if (!currentPassword || !newPassword) {
    return { success: false, error: 'Current and new password are required' };
  }
  if (newPassword.length < 8 || newPassword.length > 256) {
    return { success: false, error: 'New password must be between 8 and 256 characters' };
  }

  // Check server change password
  try {
    const session = getStoredAdminSession();
    const res = await fetch('/api/admin/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session.user?.token ? { Authorization: `Bearer ${session.user.token}` } : {}),
      },
      body: JSON.stringify({ currentPassword, newPassword }),
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success) {
      return { success: true };
    } else {
      return { success: false, error: data.error || 'Failed to update password' };
    }
  } catch {
    return { success: false, error: 'Unable to reach the admin authentication service.' };
  }
}
