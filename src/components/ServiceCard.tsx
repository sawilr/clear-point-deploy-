import { useLanguage, useLocalizedPath } from '../hooks/useLanguage';
import { ArrowRight } from './icons';
import { Link } from 'react-router';
import { PictureImg } from './PictureImg';

interface ServiceCardProps {
  image: string;
  title: string;
  titleEs: string;
  description: string;
  descriptionEs: string;
  link: string;
}

export function ServiceCard({ image, title, titleEs, description, descriptionEs, link }: ServiceCardProps) {
  const { t } = useLanguage();
  // Sawil 2026-07-28 AUDIT CPF-003 — callers pass EN paths ('/part-d'); the card
  // resolves them into the URL space the visitor is actually browsing.
  const lp = useLocalizedPath();
  return (
    <Link to={lp(link)} className="group bg-cream-50 rounded-2xl overflow-hidden shadow-soft hover:shadow-card transition-all duration-300 hover:-translate-y-1 active:scale-[0.99] block">
      <div className="aspect-[4/3] overflow-hidden bg-cream-100">
        {/* Sawil 2026-06-30 AUDIT FIX (perf PERF-009) — service cards are below the
            fold; lazy-load so they don't compete with the LCP hero. The aspect-[4/3]
            wrapper already reserves space, so this adds no layout shift. */}
        <PictureImg src={image} alt={t(title, titleEs)} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" decoding="async" />
      </div>
      <div className="p-5">
        <h3 className="font-serif text-lg font-semibold text-earth-900 mb-2">{t(title, titleEs)}</h3>
        <p className="text-earth-600 text-base leading-relaxed mb-3">{t(description, descriptionEs)}</p>
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-gold-500 group-hover:text-gold-400 transition-colors">
          {t('Learn more', 'Más información')} <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </span>
      </div>
    </Link>
  );
}
