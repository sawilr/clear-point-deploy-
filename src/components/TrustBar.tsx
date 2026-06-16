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

  // Stats softened to claims we can defend without external substantiation.
  // Removed prior unverifiable volume counts ("5,000+ Seniors Helped" and
  // "20+ Carriers Compared") in favor of factual, verifiable attributes:
  // the agency IS licensed + independent, the site IS bilingual, broker
  // compensation IS paid by carriers ($0 to client — industry standard),
  // and the licensed-states list IS accurate.
  const defaultStats: Stat[] = [
    { num: 'Licensed', labelEn: 'Independent Advisors', labelEs: 'Asesores Independientes' },
    { num: 'Bilingual', labelEn: 'English & Español', labelEs: 'Inglés y Español' },
    { num: '$0', labelEn: 'Cost to You', labelEs: 'Costo Para Usted' },
    // HIDDEN per Sawil 2026-06: FL pending authorization. Original below.
    // { num: 'NY·FL·CT·NJ', labelEn: 'States Served', labelEs: 'Estados Atendidos' },
    { num: 'NY·CT·NJ', labelEn: 'States Served', labelEs: 'Estados Atendidos' },
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
        <p className="text-center text-[13px] text-cream-50/55 mt-3">{t('Final plan availability and carrier participation vary by area and appointment status.', 'La disponibilidad final de planes y la participación de aseguradoras varían por área y estado de cita.')}</p>
        {/* Sawil 2026-06-16 compliance audit — "How We Get Paid" disclosure next
            to the "$0 Cost to You" claim. CMS best practice: clarify the
            commission model without sounding like a government benefit. */}
        <p className="text-center text-[13px] text-cream-50/60 mt-2 max-w-2xl mx-auto">{t(
          'Our service is no cost to you. If you enroll in a plan through us, ClearPoint may be compensated by the insurance carrier. Your plan cost is not increased because you use our help.',
          'Nuestro servicio no tiene costo para usted. Si se inscribe en un plan a través de nosotros, ClearPoint puede recibir compensación de la aseguradora. El costo de su plan no aumenta por usar nuestra ayuda.'
        )}</p>
      </div>
    </div>
  );
}
