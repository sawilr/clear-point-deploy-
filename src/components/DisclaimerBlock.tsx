import { useLanguage } from '../hooks/useLanguage';

interface DisclaimerBlockProps {
  variant?: 'full' | 'compact' | 'inline' | 'privacy';
}

export function DisclaimerBlock({ variant = 'full' }: DisclaimerBlockProps) {
  const { t } = useLanguage();

  if (variant === 'compact') {
    return (
      <div className="text-[11px] text-earth-500 leading-relaxed">
        <p>
          {t(
            'ClearPoint Senior Advisors is an independent insurance agency and is not connected with or endorsed by the U.S. government or the federal Medicare program. Plan availability, benefits, premiums, provider networks, drug coverage, and costs vary by plan, location, and eligibility. A licensed insurance agent may contact you to discuss Medicare-related options. You can also contact Medicare.gov or 1-800-MEDICARE for official information.',
            'ClearPoint Senior Advisors es una agencia de seguros independiente y no está conectada ni respaldada por el gobierno de los Estados Unidos ni por el programa federal de Medicare. La disponibilidad de planes, beneficios, primas, redes de proveedores, cobertura de medicamentos y costos varían según el plan, la ubicación y la elegibilidad. Un agente de seguros licenciado puede contactarte para hablar sobre opciones relacionadas con Medicare. También puedes contactar Medicare.gov o 1-800-MEDICARE para obtener información oficial.'
          )}
        </p>
      </div>
    );
  }

  if (variant === 'inline') {
    return (
      <p className="text-[11px] text-earth-500 leading-relaxed">
        {t(
          'ClearPoint Senior Advisors is an independent insurance agency. Not connected with or endorsed by Medicare, CMS, or the U.S. government. Plan availability varies by location.',
          'ClearPoint Senior Advisors es una agencia de seguros independiente. No está conectada ni respaldada por Medicare, CMS ni el gobierno de EE. UU. La disponibilidad de planes varía por ubicación.'
        )}
      </p>
    );
  }

  if (variant === 'privacy') {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-[12px] text-amber-900 leading-relaxed">
        <p className="font-semibold mb-1.5 flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          {t('Privacy Notice', 'Aviso de Privacidad')}
        </p>
        {/* Compliance-safe draft — owner/legal review recommended before scaled marketing */}
        <p className="mb-1.5">
          {t(
            'ClearPoint Senior Advisors uses the information you provide only to respond to your request and connect you with licensed insurance support. We apply reasonable administrative and technical safeguards to protect the information you submit. Please do not submit Social Security numbers, Medicare ID numbers, banking information, or detailed medical records through this website or chat.',
            'ClearPoint Senior Advisors utiliza la información que proporcionas únicamente para responder a tu solicitud y conectarte con apoyo de seguros licenciado. Aplicamos salvaguardas administrativas y técnicas razonables para proteger la información que envías. Por favor, no envíes números de Seguro Social, números de Medicare, información bancaria ni expedientes médicos detallados a través de este sitio web o chat.'
          )}
        </p>
        <p className="text-[11px] text-amber-700">
          {t(
            'For questions about how your information is handled, contact us at 1-866-310-8702.',
            'Para preguntas sobre cómo se maneja tu información, contáctanos al 1-866-310-8702.'
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="text-[11px] text-cream-50/30 leading-relaxed space-y-2.5">
      <p>
        {t(
          'ClearPoint Senior Advisors is an independent insurance agency and is not connected with or endorsed by the U.S. government or the federal Medicare program. Plan availability, benefits, premiums, provider networks, drug coverage, formularies, pharmacy networks, and costs may vary by plan, service area, and eligibility. A licensed insurance agent may contact you to discuss Medicare-related options. You can also contact Medicare.gov, 1-800-MEDICARE, or your local State Health Insurance Assistance Program (SHIP) for official information and to get information on all of your options.',
          'ClearPoint Senior Advisors es una agencia de seguros independiente y no está conectada ni respaldada por el gobierno de los Estados Unidos ni por el programa federal de Medicare. La disponibilidad de planes, beneficios, primas, redes de proveedores, cobertura de medicamentos, formularios, redes de farmacias y costos pueden variar según el plan, área de servicio y elegibilidad. Un agente de seguros licenciado puede contactarte para hablar sobre opciones relacionadas con Medicare. También puedes contactar Medicare.gov, 1-800-MEDICARE o tu Programa Estatal de Asistencia de Seguro de Salud (SHIP) local para obtener información oficial y sobre todas tus opciones.'
        )}
      </p>
      <p>
        {t(
          'We do not offer every plan available in your area. Any information we provide is limited to the plans we offer in your area. Please contact Medicare.gov or 1-800-MEDICARE to get information on all of your plan options.',
          'No ofrecemos todos los planes disponibles en su área. Cualquier información que proporcionamos se limita a los planes que ofrecemos en su área. Comuníquese con Medicare.gov o 1-800-MEDICARE para obtener información sobre todas sus opciones de planes.'
        )}
      </p>
      <p>
        {t(
          'Submitting a form or requesting a consultation does not enroll you in a Medicare plan. A licensed insurance agent may contact you to discuss Medicare-related options.',
          'Enviar un formulario o solicitar una consulta no lo inscribe en un plan de Medicare. Un agente de seguros licenciado puede contactarlo para hablar sobre opciones relacionadas con Medicare.'
        )}
      </p>
      <p>
        {t(
          'Plans are insured or covered by a Medicare Advantage organization with a Medicare contract and/or a Medicare-approved Part D sponsor. Enrollment in a plan depends on the plan\'s contract renewal with Medicare. Benefits may vary by plan, location, and eligibility. Limitations, copayments, and restrictions may apply.',
          'Los planes están asegurados o cubiertos por una organización de Medicare Advantage con un contrato de Medicare y/o un patrocinador de Parte D aprobado por Medicare. La inscripción en el plan depende de la renovación del contrato del plan con Medicare. Los beneficios pueden variar según el plan, ubicación y elegibilidad. Pueden aplicar limitaciones, copagos y restricciones.'
        )}
      </p>
    </div>
  );
}
