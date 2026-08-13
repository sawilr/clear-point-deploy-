import { useLanguage } from '../hooks/useLanguage';
import { useScrollReveal } from '../components/ScrollReveal';
import { PhoneIcon, MailIcon } from '../components/icons';

// AUDIT 2026-08-12 — rewritten per IP-protection + claim-control remediation:
// no third-party vendor names in public copy, no absolute conformance claims
// ("all elements", "meet WCAG AA") without a current verifying audit. WCAG is
// referenced as the standard we work toward, not a certified status.
export default function Accessibility() {
  const { t } = useLanguage();
  const reveal = useScrollReveal();

  return (
    <div className="min-h-screen bg-cream-50 pt-10 pb-20">
      <div ref={reveal.ref} className={`max-w-3xl mx-auto px-5 transition-all duration-700 ${reveal.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
        <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-gold-500 mb-4 block">{t('Legal', 'Legal')}</span>
        <h1 className="font-serif text-3xl sm:text-4xl font-normal text-earth-900 leading-snug mb-2">
          {t('Accessibility Statement', 'Declaración de Accesibilidad')}
        </h1>
        <p className="text-earth-600 text-sm mb-8">{t('Last Updated: August 12, 2026', 'Última Actualización: 12 de agosto de 2026')}</p>

        <div className="space-y-8 text-earth-700 text-sm leading-relaxed">
          <section>
            <h2 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('Our Commitment', 'Nuestro Compromiso')}</h2>
            <p>
              {t(
                'Clear Point Senior Advisors is committed to providing an accessible website experience for all visitors, including people with disabilities.',
                'Clear Point Senior Advisors se compromete a ofrecer una experiencia web accesible para todos los visitantes, incluidas las personas con discapacidades.'
              )}
            </p>
            <p className="mt-3">
              {t(
                'We continually work to improve the accessibility and usability of our website and use the Web Content Accessibility Guidelines (WCAG) as an important reference for our accessibility efforts.',
                'Trabajamos continuamente para mejorar la accesibilidad y usabilidad de nuestro sitio web y utilizamos las Pautas de Accesibilidad para el Contenido Web (WCAG) como una referencia importante en nuestros esfuerzos de accesibilidad.'
              )}
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('Accessibility Measures', 'Medidas de Accesibilidad')}</h2>
            <p className="mb-3">{t('Our accessibility efforts include reviewing areas such as:', 'Nuestros esfuerzos de accesibilidad incluyen la revisión de áreas como:')}</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>{t('Keyboard navigation', 'Navegación por teclado')}</li>
              <li>{t('Screen reader compatibility', 'Compatibilidad con lectores de pantalla')}</li>
              <li>{t('Text and interface contrast', 'Contraste de texto e interfaz')}</li>
              <li>{t('Text resizing', 'Redimensionamiento de texto')}</li>
              <li>{t('Alternative text for meaningful images', 'Texto alternativo para imágenes significativas')}</li>
              <li>{t('Form labels and instructions', 'Etiquetas e instrucciones de formularios')}</li>
              <li>{t('Visible keyboard focus', 'Enfoque de teclado visible')}</li>
              <li>{t('Responsive/mobile usability', 'Usabilidad móvil y adaptable')}</li>
              <li>{t('English and Spanish content', 'Contenido en inglés y español')}</li>
            </ul>
            <p className="mt-3">
              {t(
                'Because websites, browsers, assistive technologies, and third-party services continue to evolve, accessibility is an ongoing process.',
                'Debido a que los sitios web, los navegadores, las tecnologías de asistencia y los servicios de terceros continúan evolucionando, la accesibilidad es un proceso continuo.'
              )}
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('Third-Party Content', 'Contenido de Terceros')}</h2>
            <p>
              {t(
                'Our website may contain links to external websites or embedded services provided by third parties, including forms, scheduling tools, and other interactive features.',
                'Nuestro sitio web puede contener enlaces a sitios web externos o servicios incrustados proporcionados por terceros, incluidos formularios, herramientas de programación y otras funciones interactivas.'
              )}
            </p>
            <p className="mt-3">
              {t(
                'Some third-party components may be outside our direct technical control. We work to configure these services with accessibility in mind and encourage visitors who experience an accessibility barrier to contact us for assistance.',
                'Algunos componentes de terceros pueden estar fuera de nuestro control técnico directo. Trabajamos para configurar estos servicios teniendo en cuenta la accesibilidad y animamos a los visitantes que encuentren una barrera de accesibilidad a contactarnos para recibir asistencia.'
              )}
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('Known Limitations', 'Limitaciones Conocidas')}</h2>
            <p>
              {t(
                'Some documents or third-party interactive components may not provide the same level of accessibility as the primary Clear Point Senior Advisors website. We continually evaluate these areas and work to improve the experience where reasonably possible.',
                'Algunos documentos o componentes interactivos de terceros pueden no ofrecer el mismo nivel de accesibilidad que el sitio web principal de Clear Point Senior Advisors. Evaluamos continuamente estas áreas y trabajamos para mejorar la experiencia cuando es razonablemente posible.'
              )}
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('Feedback & Assistance', 'Retroalimentación y Asistencia')}</h2>
            <p>
              {t(
                'If you experience difficulty accessing information or using any part of our website, or if you need information in another format, please contact us. We will make reasonable efforts to provide assistance.',
                'Si tiene dificultades para acceder a la información o usar cualquier parte de nuestro sitio web, o si necesita información en otro formato, contáctenos. Haremos esfuerzos razonables para brindarle asistencia.'
              )}
            </p>
            <div className="mt-4 bg-cream-50 rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-3">
                <PhoneIcon className="w-4 h-4 text-gold-500" />
                <a href="tel:18557208555" className="text-earth-800 font-semibold hover:text-gold-500 transition-colors">1-855-720-8555</a>
              </div>
              <div className="flex items-center gap-3">
                <MailIcon className="w-4 h-4 text-gold-500" />
                <a href="mailto:info@clearpointsenioradvisors.com" className="text-earth-800 font-semibold hover:text-gold-500 transition-colors">info@clearpointsenioradvisors.com</a>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
