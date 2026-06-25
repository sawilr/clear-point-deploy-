import { useEffect } from 'react';
import { Link } from 'react-router';
import { useLanguage } from '../hooks/useLanguage';
import { CheckIcon, PhoneIcon } from '../components/icons';
import { track, Events } from '../lib/analytics';

// Dedicated post-submit confirmation page. Linkable as a GTM conversion
// destination. Fires a generic, PII-free thank_you_view event on mount.
export default function ThankYou() {
  const { t, lang } = useLanguage();

  useEffect(() => {
    track(Events.THANK_YOU_VIEW, { event_category: 'lead', event_label: 'thank_you_page', language: lang });
  }, [lang]);

  return (
    <div className="min-h-screen bg-cream-50 pt-16 pb-24">
      <div className="max-w-xl mx-auto px-5 text-center">
        <div className="w-16 h-16 bg-sage-200 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckIcon className="w-8 h-8 text-sage-500" />
        </div>
        <h1 className="font-serif text-3xl sm:text-4xl font-normal text-earth-900 leading-snug mb-4">
          {t('Thank you — we received your information.', 'Gracias — recibimos su información.')}
        </h1>
        <p className="text-earth-700 text-base leading-relaxed mb-8">
          {t(
            'A licensed ClearPoint Senior Advisors advisor will contact you soon. If you would like to speak with someone right away, you can call us.',
            'Un asesor licenciado de Clear Point Senior Advisors se comunicará con usted pronto. Si prefiere hablar con alguien de inmediato, puede llamarnos.'
          )}
        </p>
        <a
          href="tel:18663108702"
          className="cp-btn inline-flex items-center justify-center gap-2 bg-earth-800 text-cream-50 hover:bg-earth-900 transition-all hover:shadow-soft mb-4"
        >
          <PhoneIcon className="w-4 h-4" />
          1-866-310-8702
        </a>
        <p className="text-earth-600 text-sm mt-4">
          <Link to="/" className="underline text-earth-800 font-semibold hover:text-gold-500">
            {t('Return to homepage', 'Volver al inicio')}
          </Link>
        </p>
        <p className="text-earth-500 text-xs mt-6">
          {t('Reply STOP to unsubscribe from SMS. Message frequency may vary.', 'Responda STOP para cancelar suscripción de SMS. La frecuencia de mensajes puede variar.')}
        </p>
      </div>
    </div>
  );
}
