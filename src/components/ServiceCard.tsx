import { useLanguage } from '../hooks/useLanguage';
import { ArrowRight } from './icons';
import { Link } from 'react-router';

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
  return (
    <Link to={link} className="group bg-cream-50 rounded-2xl overflow-hidden shadow-soft hover:shadow-card transition-all duration-300 hover:-translate-y-1 block">
      <div className="aspect-[4/3] overflow-hidden">
        <img src={image} alt={t(title, titleEs)} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
      </div>
      <div className="p-5">
        <h3 className="font-serif text-lg font-semibold text-earth-900 mb-2">{t(title, titleEs)}</h3>
        <p className="text-earth-600 text-sm leading-relaxed mb-3">{t(description, descriptionEs)}</p>
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-gold-500 group-hover:text-gold-400 transition-colors">
          {t('Learn more', 'Más información')} <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
        </span>
      </div>
    </Link>
  );
}
