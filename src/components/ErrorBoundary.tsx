import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State { hasError: boolean }

// PHASE 7 — Last-resort fallback if any React render throws.
// Without this, an exception in ChatBot / CustomerServiceBot / SmartMedicareReview
// would unmount the entire app and show a white screen — terrible UX for a senior
// who can't refresh out of it. This wraps the whole tree in App.tsx.
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State { return { hasError: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log to console only — Vite drops console in prod, so this is dev-only noise.
    // For production observability, wire Sentry/LogRocket here.
    if (typeof console !== 'undefined') {
      console.error('[ErrorBoundary]', error, info);
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    const isEs = typeof navigator !== 'undefined' && (navigator.language || '').toLowerCase().startsWith('es');
    const heading = isEs ? 'Algo salió mal' : 'Something went wrong';
    const sub = isEs
      ? 'Estamos teniendo un problema técnico. Por favor llámenos para asistencia inmediata.'
      : 'We are having a technical issue. Please call us for immediate assistance.';
    const phoneLabel = isEs ? 'Llamar a Clear Point' : 'Call Clear Point';
    const reloadLabel = isEs ? 'Recargar página' : 'Reload page';
    return (
      <div className="min-h-screen bg-cream-50 flex items-center justify-center px-6 py-12">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-soft border border-cream-200 p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mx-auto mb-5 text-3xl font-serif">!</div>
          <h1 className="font-serif text-2xl text-earth-900 mb-3">{heading}</h1>
          <p className="text-earth-700 text-sm leading-relaxed mb-6">{sub}</p>
          <a
            href="tel:+18663108702"
            className="block w-full bg-earth-800 text-cream-50 font-semibold py-3 rounded-lg hover:bg-earth-900 transition-colors mb-3"
          >
            {phoneLabel}: 1-866-310-8702
          </a>
          <button
            type="button"
            onClick={() => { try { window.location.reload(); } catch { /* no-op */ } }}
            className="block w-full border border-cream-300 text-earth-700 font-medium py-2.5 rounded-lg hover:bg-cream-50 transition-colors"
          >
            {reloadLabel}
          </button>
          <p className="text-xs text-earth-500 mt-5">TTY: 711 · Mon–Fri 9am–6pm ET</p>
        </div>
      </div>
    );
  }
}
