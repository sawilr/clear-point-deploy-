import { useLanguage } from '../hooks/useLanguage';
import { useScrollReveal } from '../components/ScrollReveal';
import { PhoneIcon, MailIcon } from '../components/icons';

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
        <p className="text-earth-500 text-sm mb-8">{t('Last Updated: May 5, 2025', 'Última Actualización: 5 de mayo de 2025')}</p>

        <div className="space-y-8 text-earth-700 text-sm leading-relaxed">
          <section>
            <h2 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('Our Commitment', 'Nuestro Compromiso')}</h2>
            <p>
              {t(
                'Clear Point Senior Advisors is committed to making our website accessible to everyone, including people with disabilities. We are continually working to improve the accessibility of our site in accordance with the Web Content Accessibility Guidelines (WCAG) 2.1 Level AA standards.',
                'Clear Point Senior Advisors se compromete a hacer que nuestro sitio web sea accesible para todos, incluidas las personas con discapacidades. Continuamente trabajamos para mejorar la accesibilidad de nuestro sitio de acuerdo con las pautas de Accesibilidad al Contenido Web (WCAG) 2.1 Nivel AA.'
              )}
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('Accessibility Measures We Take', 'Medidas de Accesibilidad Que Tomamos')}</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>{t('Keyboard Navigation: All interactive elements are accessible using only a keyboard.', 'Navegación por Teclado: Todos los elementos interactivos son accesibles usando solo un teclado.')}</li>
              <li>{t('Screen Reader Support: We use semantic HTML and ARIA labels to support screen readers.', 'Soporte para Lectores de Pantalla: Utilizamos HTML semántico y etiquetas ARIA para soportar lectores de pantalla.')}</li>
              <li>{t('Color Contrast: Text and interactive elements meet WCAG 2.1 AA contrast ratios.', 'Contraste de Color: El texto y los elementos interactivos cumplen con las relaciones de contraste WCAG 2.1 AA.')}</li>
              <li>{t('Resizable Text: Our layout supports text resizing up to 200% without loss of content or functionality.', 'Texto Redimensionable: Nuestro diseño soporta el redimensionamiento de texto hasta 200% sin pérdida de contenido o funcionalidad.')}</li>
              <li>{t('Alt Text: All meaningful images have descriptive alt text. Decorative images use empty alt attributes.', 'Texto Alternativo: Todas las imágenes significativas tienen texto alternativo descriptivo. Las imágenes decorativas usan atributos alt vacíos.')}</li>
              <li>{t('Form Labels: All form fields have associated labels for screen reader compatibility.', 'Etiquetas de Formularios: Todos los campos de formulario tienen etiquetas asociadas para compatibilidad con lectores de pantalla.')}</li>
              <li>{t('Focus Indicators: All interactive elements have visible focus states.', 'Indicadores de Enfoque: Todos los elementos interactivos tienen estados de enfoque visibles.')}</li>
              <li>{t('Language Toggle: Content is available in both English and Spanish.', 'Cambio de Idioma: El contenido está disponible en inglés y español.')}</li>
            </ul>
          </section>

          <section>
            <h2 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('Third-Party Content', 'Contenido de Terceros')}</h2>
            <p>
              {t(
                'Our website may contain links to external websites or embedded content from third parties (such as GoHighLevel forms and calendars). We cannot control the accessibility of third-party content and encourage you to review their accessibility statements.',
                'Nuestro sitio web puede contener enlaces a sitios web externos o contenido incrustado de terceros (como formularios y calendarios de GoHighLevel). No podemos controlar la accesibilidad del contenido de terceros y le recomendamos revisar sus declaraciones de accesibilidad.'
              )}
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('Known Limitations', 'Limitaciones Conocidas')}</h2>
            <p>
              {t(
                'We are aware of the following limitations and are actively working to address them: (a) some PDF documents may not be fully accessible; (b) some third-party embedded widgets may have limited accessibility features.',
                'Somos conscientes de las siguientes limitaciones y estamos trabajando activamente para abordarlas: (a) algunos documentos PDF pueden no ser completamente accesibles; (b) algunos widgets incrustados de terceros pueden tener características de accesibilidad limitadas.'
              )}
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('Feedback & Assistance', 'Retroalimentación y Asistencia')}</h2>
            <p>
              {t(
                'If you experience any difficulty accessing content on this website, or if you need information in an alternative format, please contact us. We will make every reasonable effort to accommodate your needs.',
                'Si experimenta alguna dificultad para acceder al contenido de este sitio web, o si necesita información en un formato alternativo, contáctenos. Haremos todos los esfuerzos razonables para satisfacer sus necesidades.'
              )}
            </p>
            <div className="mt-4 bg-cream-50 rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-3">
                <PhoneIcon className="w-4 h-4 text-gold-500" />
                <a href="tel:18663108702" className="text-earth-800 font-semibold hover:text-gold-500 transition-colors">1-866-310-8702</a>
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
