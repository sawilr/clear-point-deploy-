import { useState } from 'react';
import { useLanguage } from '../hooks/useLanguage';
import { useScrollReveal } from './ScrollReveal';
import { ChevronDown } from './icons';

interface FAQItem {
  q: string;
  qEs: string;
  a: string;
  aEs: string;
}

interface FAQProps {
  items: FAQItem[];
  title?: string;
  titleEs?: string;
}

export function FAQ({ items, title, titleEs }: FAQProps) {
  const { t } = useLanguage();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const { ref, visible } = useScrollReveal();

  return (
    <div ref={ref} className={`transition-all duration-700 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
      {title && (
        <div className="text-center max-w-2xl mx-auto mb-14">
          <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-gold-500 mb-4 block">{t('FAQ', 'Preguntas Frecuentes')}</span>
          <h2 className="font-serif text-3xl sm:text-4xl lg:text-[2.6rem] font-normal text-earth-900 leading-snug">
            {t(title, titleEs || title)}
          </h2>
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-5">
        {items.map((item, i) => {
          const isOpen = openIndex === i;
          return (
            <div
              key={i}
              className="bg-white rounded-xl shadow-xs border-l-4 border-gold-200 hover:border-gold-400 transition-colors overflow-hidden"
            >
              <button
                onClick={() => setOpenIndex(isOpen ? null : i)}
                className="w-full flex items-start justify-between gap-4 p-6 text-left"
                aria-expanded={isOpen}
              >
                <h3 className="font-serif text-base font-semibold text-earth-900">{t(item.q, item.qEs)}</h3>
                <ChevronDown className={`w-5 h-5 text-gold-400 flex-shrink-0 mt-0.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              <div className={`overflow-hidden transition-all duration-300 ${isOpen ? 'max-h-96' : 'max-h-0'}`}>
                <p className="px-6 pb-6 text-earth-600 text-sm leading-relaxed">{t(item.a, item.aEs)}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
