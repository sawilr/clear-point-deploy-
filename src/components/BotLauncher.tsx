// ─────────────────────────────────────────────────────────────────────────────
// PHASE A18 — Single floating launcher for both bots.
//
// Replaces Zara's own floating button. Click → 2-option popover.
//   Option A:  Aprender sobre Medicare → opens Zara via window event
//   Option B:  Tengo un problema       → navigates to /support
//
// Marks document.body[data-cp-launcher-active="1"] so ChatBot.tsx hides
// its own button (cooperative handoff, no DOM hijacking).
//
// Accessibility:
//   - Role="dialog" on the popover
//   - aria-label on the launcher button
//   - Touch targets ≥ 56px (senior-friendly)
//   - Escape closes
//   - Click outside closes
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { GraduationCap, ClipboardList, MessageCircle } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';

export function BotLauncher() {
  const { lang } = useLanguage();
  const isEs = lang === 'es';
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Tell ChatBot to hide its own floating button while this launcher is mounted.
  useEffect(() => {
    document.body.dataset.cpLauncherActive = '1';
    return () => { delete document.body.dataset.cpLauncherActive; };
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current?.contains(e.target as Node)) return;
      if (buttonRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const openZara = () => {
    setOpen(false);
    window.dispatchEvent(new CustomEvent('clearpoint:open-zara'));
  };

  const goSupport = () => {
    setOpen(false);
    navigate('/support');
    // Scroll the page so the CS bot is in view (Support.tsx renders it).
    setTimeout(() => {
      const el = document.getElementById('customer-service-bot') || document.querySelector('main');
      if (el) (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 250);
  };

  return (
    <>
      {/* Popover (rendered above the button) */}
      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-labelledby="cp-launcher-title"
          className="fixed z-[60] bottom-[calc(env(safe-area-inset-bottom)+148px)] right-4 md:bottom-[100px] md:right-6 w-[min(360px,calc(100vw-2rem))] bg-white rounded-2xl shadow-lifted border border-cream-200 overflow-hidden animate-fade-in"
        >
          <header className="px-5 py-4 border-b border-cream-200 bg-cream-50">
            <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-gold-600 mb-1">ClearPoint</p>
            <h2 id="cp-launcher-title" className="font-serif text-lg text-earth-900">
              {isEs ? '¿En qué le ayudamos?' : 'How can we help?'}
            </h2>
          </header>
          <div className="p-2">
            <button
              type="button"
              onClick={openZara}
              className="w-full flex items-start gap-3 p-4 rounded-xl hover:bg-cream-50 transition-colors text-left min-h-[72px]"
            >
              <GraduationCap aria-hidden className="w-6 h-6 flex-shrink-0 text-gold-600" />
              <span className="flex-1">
                <span className="block font-medium text-earth-900 leading-snug">
                  {isEs ? 'Aprender sobre Medicare' : 'Learn about Medicare'}
                </span>
                <span className="block text-xs text-earth-500 mt-0.5">
                  {isEs ? 'Educación general — partes, planes, ahorros' : 'General education — parts, plans, savings'}
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={goSupport}
              className="w-full flex items-start gap-3 p-4 rounded-xl hover:bg-cream-50 transition-colors text-left min-h-[72px]"
            >
              <ClipboardList aria-hidden className="w-6 h-6 flex-shrink-0 text-gold-600" />
              <span className="flex-1">
                <span className="block font-medium text-earth-900 leading-snug">
                  {isEs ? 'Tengo un problema o pregunta' : 'I have a problem or question'}
                </span>
                <span className="block text-xs text-earth-500 mt-0.5">
                  {isEs ? 'Factura, doctor, carta, cobertura…' : 'Bill, doctor, letter, coverage…'}
                </span>
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Floating launcher button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={isEs ? 'Abrir menú de ayuda' : 'Open help menu'}
        // Sawil 2026-06-15 (UX audit L5): on very narrow phones (≤360px) the
        // wide "Help" pill overlapped the hero "Schedule Free Consultation"
        // button. Below 360px the launcher collapses to an icon-only 56px
        // circle so it tucks into the corner without covering the CTA label.
        // Position/behavior unchanged at 361px+ and on tablet/desktop.
        className="cp-zara-fab fixed bottom-[max(76px,calc(env(safe-area-inset-bottom)+72px))] right-4 md:bottom-6 md:right-6 z-50 bg-earth-800 text-cream-50 rounded-2xl shadow-lifted flex items-center gap-2.5 sm:gap-3 px-3.5 py-2.5 sm:px-4 sm:py-3 hover:bg-earth-900 hover:scale-105 active:scale-95 transition-all min-h-[56px] max-[360px]:w-14 max-[360px]:gap-0 max-[360px]:px-0 max-[360px]:justify-center max-[360px]:rounded-full"
      >
        <MessageCircle aria-hidden className="w-5 h-5" />
        <span className="text-sm font-medium pr-1 max-[360px]:hidden">
          {isEs ? 'Ayuda' : 'Help'}
        </span>
      </button>
    </>
  );
}
