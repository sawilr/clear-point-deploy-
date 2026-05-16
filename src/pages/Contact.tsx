import { useLanguage } from '../hooks/useLanguage';
import { Hero } from '../components/Hero';
import { LeadForm } from '../components/LeadForm';
import { CTASection } from '../components/CTASection';
import { useScrollReveal } from '../components/ScrollReveal';
import { PhoneIcon, MailIcon, MapPinIcon, CalendarIcon, GlobeIcon } from '../components/icons';

export default function Contact() {
  const { t } = useLanguage();
  const infoReveal = useScrollReveal();

  return (
    <div className="min-h-screen bg-cream-50">
      <Hero
        image="/hero-bg.jpg"
        eyebrow="Contact Us"
        eyebrowEs="Contáctenos"
        headline="We Are Here to Help"
        headlineEs="Estamos Aquí para Ayudar"
        subheadline="Book a free consultation, call us directly, or send a message. A licensed Medicare advisor will respond within 15 minutes during business hours."
        subheadlineEs="Reserve una consulta gratuita, llámenos directamente o envíe un mensaje. Un asesor de Medicare licenciado responderá en 15 minutos durante horas de oficina."
        variant="page"
      />

      <section ref={infoReveal.ref} className={`py-20 lg:py-28 bg-white transition-all duration-700 ${infoReveal.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
        <div className="max-w-6xl mx-auto px-5">
          <div className="grid lg:grid-cols-[1fr_380px] gap-12 items-start">
            <div className="space-y-10">
              <div>
                <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-gold-500 mb-4 block">{t('Get in Touch', 'Póngase en Contacto')}</span>
                <h2 className="font-serif text-3xl sm:text-4xl font-normal text-earth-900 leading-snug mb-4">
                  {t('Contact Clear Point Senior Advisors', 'Contacte a Clear Point Senior Advisors')}
                </h2>
                <p className="text-earth-600 text-base leading-relaxed">
                  {t(
                    'Whether you are turning 65, reviewing your current plan, or helping a loved one navigate Medicare, we are here to make the process simple and stress-free.',
                    'Ya sea que esté cumpliendo 65 años, revisando su plan actual o ayudando a un ser querido a navegar Medicare, estamos aquí para hacer el proceso simple y sin estrés.'
                  )}
                </p>
              </div>

              <div className="grid sm:grid-cols-2 gap-5">
                {[
                  { icon: <PhoneIcon className="w-5 h-5" />, title: 'Phone', titleEs: 'Teléfono', value: '1-866-310-8702', href: 'tel:18663108702', sub: 'Mon–Fri · 9am–6pm ET', subEs: 'Lun–Vie · 9am–6pm ET' },
                  { icon: <MailIcon className="w-5 h-5" />, title: 'Email', titleEs: 'Correo', value: 'info@clearpointsenioradvisors.com', href: 'mailto:info@clearpointsenioradvisors.com', sub: 'Response within 24h', subEs: 'Respuesta en 24h' },
                  { icon: <MapPinIcon className="w-5 h-5" />, title: 'Service Area', titleEs: 'Área de Servicio', value: 'NY, FL, CT, NJ', href: null, sub: 'Licensed in all four states', subEs: 'Licenciados en los cuatro estados' },
                  { icon: <GlobeIcon className="w-5 h-5" />, title: 'Languages', titleEs: 'Idiomas', value: 'English & Español', href: null, sub: 'All advisors are bilingual', subEs: 'Todos los asesores son bilingües' },
                ].map((item, i) => (
                  <div key={i} className="bg-cream-50 rounded-xl p-5 shadow-xs">
                    <div className="w-10 h-10 rounded-lg bg-gold-100 text-gold-500 flex items-center justify-center mb-3">{item.icon}</div>
                    <h3 className="font-serif text-sm font-semibold text-earth-900 mb-1">{t(item.title, item.titleEs)}</h3>
                    {item.href ? (
                      <a href={item.href} className="text-earth-700 text-sm font-medium hover:text-gold-500 transition-colors">{item.value}</a>
                    ) : (
                      <p className="text-earth-700 text-sm font-medium">{item.value}</p>
                    )}
                    <p className="text-earth-500 text-xs mt-1">{t(item.sub, item.subEs)}</p>
                  </div>
                ))}
              </div>

              <div className="bg-earth-800 rounded-xl p-6 text-cream-50">
                <h3 className="font-serif text-lg text-cream-50 mb-3">{t('Schedule a Free Consultation', 'Programe una Consulta Gratuita')}</h3>
                <p className="text-cream-100/70 text-sm leading-relaxed mb-4">
                  {t(
                    'Book a 30-minute phone or video consultation with a licensed Clear Point Senior Advisors representative. We will review your current situation, answer your questions, and help you understand your options. No pressure. No obligation.',
                    'Reserve una consulta telefónica o por video de 30 minutos con un representante con licencia de Clear Point Senior Advisors. Revisaremos su situación actual, responderemos sus preguntas y le ayudaremos a entender sus opciones. Sin presión. Sin obligación.'
                  )}
                </p>
                <div className="flex items-center gap-3">
                  <CalendarIcon className="w-5 h-5 text-gold-400" />
                  <span className="text-gold-300 font-semibold text-sm">{t('Online scheduling coming soon. Call or fill out the form to book your appointment.', 'Programación en línea próximamente. Llame o complete el formulario para reservar su cita.')}</span>
                </div>
              </div>
            </div>
            <div className="lg:sticky lg:top-28">
              <LeadForm variant="standalone" source="contact-page" />
            </div>
          </div>
        </div>
      </section>

      <CTASection
        headline="Prefer to Call? We Are Ready."
        headlineEs="¿Prefiere Llamar? Estamos Listos."
        subheadline="Speak with a licensed Medicare advisor today. No robots. No hold music. Just real help."
        subheadlineEs="Hable con un asesor de Medicare licenciado hoy. Sin robots. Sin música de espera. Solo ayuda real."
        variant="dark"
      />
    </div>
  );
}
