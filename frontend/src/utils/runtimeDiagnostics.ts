export interface RuntimeDiagnosticEvent {
  at: string;
  event: string;
  details?: Record<string, unknown>;
}

const TRACE_KEY = 'trinetra_runtime_trace_v1';
const MAX_EVENTS = 40;

export function traceRuntimeEvent(event: string, details?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;

  const entry: RuntimeDiagnosticEvent = {
    at: new Date().toISOString(),
    event,
    ...(details ? { details } : {}),
  };

  let events: RuntimeDiagnosticEvent[] = [];
  try {
    const saved = window.sessionStorage.getItem(TRACE_KEY);
    const parsed: unknown = saved ? JSON.parse(saved) : [];
    events = Array.isArray(parsed) ? parsed as RuntimeDiagnosticEvent[] : [];
  } catch {
    // Diagnostics must never interfere with login or camera behavior.
  }

  events = [...events, entry].slice(-MAX_EVENTS);
  try {
    window.sessionStorage.setItem(TRACE_KEY, JSON.stringify(events));
  } catch {
    // Diagnostics must never interfere with login or camera behavior.
  }
  (window as Window & { __TRINETRA_RUNTIME_TRACE__?: RuntimeDiagnosticEvent[] })
    .__TRINETRA_RUNTIME_TRACE__ = events;

  console.info('[Trinetra runtime]', entry);
}
