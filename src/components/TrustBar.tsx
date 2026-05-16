import { useLanguage } from '../hooks/useLanguage';
import { useScrollReveal } from './ScrollReveal';

interface Stat {
  num: string;
  labelEn: string;
  labelEs: string;
}

interface TrustBarProps {
  stats?: Stat[];
}

export function TrustBar({ stats }: TrustBarProps) {
  const { t } = useLanguage();
  const { ref, visible } = useScrollReveal();

  const defaultStats: Stat[] = [
    { num: '5,000+', labelEn: 'Seniors Helped', labelEs: 'Adultos Mayores Atendidos' },
    { num: '20+', labelEn: 'Carriers Compared', labelEs: 'Aseguradoras Comparadas' },
    { num: '$0', labelEn: 'Cost to You', labelEs: 'Costo Para Usted' },
    { num: 'NY·FL·CT·NJ', labelEn: 'States Served', labelEs: 'Estados Atendidos' },
  ];

  const displayStats = stats || defaultStats;

  return (
    <div ref={ref} className={`bg-earth-800 py-10 transition-all duration-700 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
      <div className="max-w-6xl mx-auto px-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-cream-50/10 rounded-xl overflow-hidden">
          {displayStats.map((s) => (
            <div key={s.labelEn} className="bg-earth-800 py-6 text-center">
              <div className="font-serif text-2xl sm:text-3xl font-bold text-gold-300">{s.num}</div>
              <div className="text-xs text-cream-50/60 mt-1">{t(s.labelEn, s.labelEs)}</div>
            </div>
          ))}
        </div>
        <p className="text-center text-[10px] text-cream-50/30 mt-3">{t('Final plan availability and carrier participation vary by area and appointment status.', 'La disponibilidad final de planes y la participación de aseguradoras varían por área y estado de cita.')}</p>
      </div>
    </div>
  );
}
