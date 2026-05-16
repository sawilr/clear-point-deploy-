import { useLanguage } from '../hooks/useLanguage';
import { useScrollReveal } from '../components/ScrollReveal';

export default function Terms() {
  const { t } = useLanguage();
  const reveal = useScrollReveal();

  return (
    <div className="min-h-screen bg-cream-50 pt-10 pb-20">
      <div ref={reveal.ref} className={`max-w-3xl mx-auto px-5 transition-all duration-700 ${reveal.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
        <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-gold-500 mb-4 block">{t('Legal', 'Legal')}</span>
        <h1 className="font-serif text-3xl sm:text-4xl font-normal text-earth-900 leading-snug mb-2">
          {t('Terms of Use', 'Términos de Uso')}
        </h1>
        <p className="text-earth-500 text-sm mb-8">{t('Last Updated: May 5, 2025', 'Última Actualización: 5 de mayo de 2025')}</p>

        <div className="space-y-8 text-earth-700 text-sm leading-relaxed">
          <section>
            <h2 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('1. Agreement to Terms', '1. Acuerdo a los Términos')}</h2>
            <p>
              {t(
                'By accessing or using the Clear Point Senior Advisors website, you agree to be bound by these Terms of Use. If you do not agree to these terms, please do not use this website.',
                'Al acceder o usar el sitio web de Clear Point Senior Advisors, usted acepta estar sujeto a estos Términos de Uso. Si no está de acuerdo con estos términos, por favor no use este sitio web.'
              )}
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('2. Not Medical, Legal, or Tax Advice', '2. No Es Asesoramiento Médico, Legal o Fiscal')}</h2>
            <p>
              {t(
                'The content on this website is for informational and educational purposes only. It does not constitute medical, legal, tax, or financial advice. Always consult with qualified professionals before making healthcare or insurance decisions.',
                'El contenido de este sitio web es solo para fines informativos y educativos. No constituye asesoramiento médico, legal, fiscal o financiero. Consulte siempre con profesionales calificados antes de tomar decisiones de salud o seguros.'
              )}
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('3. Insurance Agent Relationship', '3. Relación de Agente de Seguros')}</h2>
            <p>
              {t(
                'Clear Point Senior Advisors is a licensed insurance agency. We are compensated by insurance carriers when you enroll in a plan through us. There is no cost to you for our services. We are independent agents — we are not employed by any insurance company.',
                'Clear Point Senior Advisors es una agencia de seguros licenciada. Somos compensados por aseguradoras cuando se inscribe en un plan a través de nosotros. No hay costo para usted por nuestros servicios. Somos agentes independientes — no estamos empleados por ninguna compañía de seguros.'
              )}
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('4. No Government Affiliation', '4. Sin Afiliación Gubernamental')}</h2>
            <p>
              {t(
                'We are not affiliated with, endorsed by, or connected to the U.S. Government, the Centers for Medicare & Medicaid Services (CMS), or the federal Medicare program. We do not offer every plan available in your area.',
                'No estamos afiliados, respaldados ni conectados con el Gobierno de los Estados Unidos, los Centros de Servicios de Medicare y Medicaid (CMS), o el programa federal de Medicare. No ofrecemos todos los planes disponibles en su área.'
              )}
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('5. Scope of Appointment (SOA)', '5. Alcance de Cita (SOA)')}</h2>
            <p>
              {t(
                'Federal Medicare rules require a completed Scope of Appointment before we can discuss specific Medicare Advantage or Part D plans with you. By requesting a consultation, you agree to complete an SOA. The SOA is informational only and does not obligate you to enroll in any plan.',
                'Las reglas federales de Medicare requieren un Alcance de Cita completado antes de que podamos discutir planes específicos de Medicare Advantage o Parte D con usted. Al solicitar una consulta, usted acepta completar un SOA. El SOA es solo informativo y no lo obliga a inscribirse en ningún plan.'
              )}
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('6. Plan Availability', '6. Disponibilidad de Planes')}</h2>
            <p>
              {t(
                'Plan availability, benefits, and costs vary by location and are subject to change. The information on this website may not reflect the most current plan data. Always verify current plan information directly with the carrier or through Medicare.gov.',
                'La disponibilidad de planes, beneficios y costos varía por ubicación y está sujeta a cambios. La información en este sitio web puede no reflejar los datos de planes más actualizados. Verifique siempre la información actual del plan directamente con la aseguradora o a través de Medicare.gov.'
              )}
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('7. Intellectual Property', '7. Propiedad Intelectual')}</h2>
            <p>
              {t(
                'All content on this website, including text, graphics, logos, and images, is the property of Clear Point Senior Advisors and is protected by copyright and other intellectual property laws. You may not reproduce, distribute, or create derivative works without our written permission.',
                'Todo el contenido de este sitio web, incluyendo texto, gráficos, logotipos e imágenes, es propiedad de Clear Point Senior Advisors y está protegido por derechos de autor y otras leyes de propiedad intelectual. No puede reproducir, distribuir o crear trabajos derivados sin nuestro permiso por escrito.'
              )}
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('8. Limitation of Liability', '8. Limitación de Responsabilidad')}</h2>
            <p>
              {t(
                'To the fullest extent permitted by law, Clear Point Senior Advisors shall not be liable for any direct, indirect, incidental, consequential, or punitive damages arising from your use of this website or our services.',
                'En la máxima medida permitida por la ley, Clear Point Senior Advisors no será responsable por daños directos, indirectos, incidentales, consecuentes o punitivos derivados de su uso de este sitio web o nuestros servicios.'
              )}
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('9. Governing Law', '9. Ley Aplicable')}</h2>
            <p>
              {t(
                'These Terms of Use shall be governed by and construed in accordance with the laws of the State of New York, without regard to its conflict of law provisions.',
                'Estos Términos de Uso se regirán e interpretarán de acuerdo con las leyes del Estado de Nueva York, sin tener en cuenta sus disposiciones de conflicto de leyes.'
              )}
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('10. Changes to Terms', '10. Cambios a los Términos')}</h2>
            <p>
              {t(
                'We reserve the right to modify these Terms of Use at any time. Changes will be posted on this page with the updated date. Your continued use of the website after changes constitutes acceptance of the revised terms.',
                'Nos reservamos el derecho de modificar estos Términos de Uso en cualquier momento. Los cambios se publicarán en esta página con la fecha actualizada. Su uso continuado del sitio web después de los cambios constituye la aceptación de los términos revisados.'
              )}
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('11. Contact', '11. Contacto')}</h2>
            <p>
              {t('Questions about these Terms? Contact us at ', '¿Preguntas sobre estos Términos? Contáctenos en ')}<a href="mailto:info@clearpointsenioradvisors.com" className="text-gold-500 hover:underline">info@clearpointsenioradvisors.com</a> {t('or', 'o')} <a href="tel:18663108702" className="text-gold-500 hover:underline">1-866-310-8702</a>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}