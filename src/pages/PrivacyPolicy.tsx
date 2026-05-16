import { useLanguage } from '../hooks/useLanguage';
import { useScrollReveal } from '../components/ScrollReveal';

export default function PrivacyPolicy() {
  const { t } = useLanguage();
  const reveal = useScrollReveal();

  return (
    <div className="min-h-screen bg-cream-50 pt-10 pb-20">
      <div ref={reveal.ref} className={`max-w-3xl mx-auto px-5 transition-all duration-700 ${reveal.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
        <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-gold-500 mb-4 block">{t('Legal', 'Legal')}</span>
        <h1 className="font-serif text-3xl sm:text-4xl font-normal text-earth-900 leading-snug mb-2">
          {t('Privacy Policy', 'Política de Privacidad')}
        </h1>
        <p className="text-earth-500 text-sm mb-8">{t('Last Updated: May 5, 2025', 'Última Actualización: 5 de mayo de 2025')}</p>

        <div className="space-y-8 text-earth-700 text-sm leading-relaxed">
          <section>
            <h2 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('1. Introduction', '1. Introducción')}</h2>
            <p>
              {t(
                'Clear Point Senior Advisors ("we," "us," or "our") respects your privacy and is committed to protecting your personal information. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit our website or use our services.',
                'Clear Point Senior Advisors ("nosotros" o "nuestro") respeta su privacidad y se compromete a proteger su información personal. Esta Política de Privacidad explica cómo recopilamos, usamos, divulgamos y protegemos su información cuando visita nuestro sitio web o utiliza nuestros servicios.'
              )}
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('2. Information We Collect', '2. Información Que Recopilamos')}</h2>
            <p className="mb-2">{t('We may collect the following types of information:', 'Podemos recopilar los siguientes tipos de información:')}</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>{t('Personal identifiers: name, phone number, email address, ZIP code', 'Identificadores personales: nombre, número de teléfono, correo electrónico, código postal')}</li>
              <li>{t('Medicare-related information: current coverage, medications, doctors', 'Información relacionada con Medicare: cobertura actual, medicamentos, médicos')}</li>
              <li>{t('Usage data: pages visited, time spent, clicks, form interactions', 'Datos de uso: páginas visitadas, tiempo dedicado, clics, interacciones con formularios')}</li>
              <li>{t('Device data: IP address, browser type, operating system', 'Datos del dispositivo: dirección IP, tipo de navegador, sistema operativo')}</li>
              <li>{t('Marketing data: UTM parameters, referral sources', 'Datos de marketing: parámetros UTM, fuentes de referencia')}</li>
            </ul>
          </section>

          <section>
            <h2 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('3. How We Use Your Information', '3. Cómo Usamos Su Información')}</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>{t('To provide Medicare guidance and plan comparisons', 'Para proporcionar orientación de Medicare y comparaciones de planes')}</li>
              <li>{t('To communicate with you by phone, SMS, or email', 'Para comunicarnos con usted por teléfono, SMS o correo electrónico')}</li>
              <li>{t('To process enrollment applications with insurance carriers', 'Para procesar solicitudes de inscripción con aseguradoras')}</li>
              <li>{t('To send appointment reminders and follow-up communications', 'Para enviar recordatorios de citas y comunicaciones de seguimiento')}</li>
              <li>{t('To comply with legal and regulatory requirements', 'Para cumplir con requisitos legales y regulatorios')}
              </li>
              <li>{t('To improve our website and services', 'Para mejorar nuestro sitio web y servicios')}</li>
            </ul>
          </section>

          <section>
            <h2 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('4. TCPA Consent & SMS Communications', '4. Consentimiento TCPA y Comunicaciones SMS')}</h2>
            <p>
              {t(
                'By providing your phone number and checking the consent box on our forms, you expressly consent to receive marketing calls and text messages from Clear Point Senior Advisors at the number you provided. These calls may be made using an automatic telephone dialing system. Message and data rates may apply. You are not required to consent as a condition of purchasing any goods or services. You may revoke your consent at any time by replying STOP to any text message or by calling us at 1-866-310-8702.',
                'Al proporcionar su número de teléfono y marcar la casilla de consentimiento en nuestros formularios, usted consiente expresamente recibir llamadas de marketing y mensajes de texto de Clear Point Senior Advisors en el número que proporcionó. Estas llamadas pueden realizarse utilizando un sistema de marcado telefónico automático. Pueden aplicarse tarifas de mensajes y datos. No está obligado a consentir como condición para comprar bienes o servicios. Puede revocar su consentimiento en cualquier momento respondiendo STOP a cualquier mensaje de texto o llamándonos al 1-866-310-8702.'
              )}
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('5. Who We Share Information With', '5. Con Quién Compartimos Información')}</h2>
            <p>
              {t(
                'We do not sell your personal information. We may share your information with: (a) insurance carriers when you choose to enroll in a plan; (b) service providers who assist us in operating our website and delivering services; (c) legal or regulatory authorities when required by law. All third parties are contractually bound to protect your information.',
                'No vendemos su información personal. Podemos compartir su información con: (a) aseguradoras cuando elige inscribirse en un plan; (b) proveedores de servicios que nos ayudan a operar nuestro sitio web y brindar servicios; (c) autoridades legales o regulatorias cuando lo requiera la ley. Todos los terceros están contractualmente obligados a proteger su información.'
              )}
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('6. Data Retention', '6. Retención de Datos')}</h2>
            <p>
              {t(
                'We retain your personal information for as long as necessary to fulfill the purposes for which it was collected, including for legal, accounting, or regulatory requirements. For TCPA compliance, we retain consent records for at least 10 years.',
                'Conservamos su información personal durante el tiempo necesario para cumplir los fines para los que fue recopilada, incluyendo requisitos legales, contables o regulatorios. Para cumplimiento TCPA, conservamos registros de consentimiento por al menos 10 años.'
              )}
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('7. Your Rights', '7. Sus Derechos')}</h2>
            <p className="mb-2">{t('You have the right to:', 'Usted tiene derecho a:')}</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>{t('Access the personal information we hold about you', 'Acceder a la información personal que tenemos sobre usted')}</li>
              <li>{t('Request correction of inaccurate information', 'Solicitar corrección de información inexacta')}</li>
              <li>{t('Request deletion of your personal information (subject to legal retention requirements)', 'Solicitar eliminación de su información personal (sujeto a requisitos legales de retención)')}</li>
              <li>{t('Opt out of marketing communications', 'Optar por no recibir comunicaciones de marketing')}</li>
              <li>{t('Revoke TCPA consent at any time', 'Revocar el consentimiento TCPA en cualquier momento')}</li>
            </ul>
            <p className="mt-2">
              {t('To exercise these rights, contact us at ', 'Para ejercer estos derechos, contáctenos en ')}<a href="mailto:info@clearpointsenioradvisors.com" className="text-gold-500 hover:underline">info@clearpointsenioradvisors.com</a> {t('or call', 'o llame al')} <a href="tel:18663108702" className="text-gold-500 hover:underline">1-866-310-8702</a>.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('8. Security', '8. Seguridad')}</h2>
            <p>
              {t(
                'We use industry-standard security measures to protect your personal information, including encryption, secure servers, and access controls. However, no method of transmission over the internet is 100% secure.',
                'Utilizamos medidas de seguridad estándar de la industria para proteger su información personal, incluyendo encriptación, servidores seguros y controles de acceso. Sin embargo, ningún método de transmisión por internet es 100% seguro.'
              )}
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('9. Changes to This Policy', '9. Cambios a Esta Política')}</h2>
            <p>
              {t(
                'We may update this Privacy Policy from time to time. The updated version will be posted on this page with the revised date. We encourage you to review this page periodically.',
                'Podemos actualizar esta Política de Privacidad de vez en cuando. La versión actualizada se publicará en esta página con la fecha revisada. Le recomendamos revisar esta página periódicamente.'
              )}
            </p>
          </section>

          <section>
            <h2 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('10. Contact Us', '10. Contáctenos')}</h2>
            <p>
              {t('If you have questions about this Privacy Policy, please contact us:', 'Si tiene preguntas sobre esta Política de Privacidad, contáctenos:')}<br />
              <strong>Clear Point Senior Advisors</strong><br />
              Email: <a href="mailto:info@clearpointsenioradvisors.com" className="text-gold-500 hover:underline">info@clearpointsenioradvisors.com</a><br />
              Phone: <a href="tel:18663108702" className="text-gold-500 hover:underline">1-866-310-8702</a><br />
              {t('TTY: 711', 'TTY: 711')}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
