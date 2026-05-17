import { useLanguage } from '../hooks/useLanguage';
import { Link } from 'react-router';
import { Hero } from '../components/Hero';
import { TrustBar } from '../components/TrustBar';
import { ServiceCard } from '../components/ServiceCard';
import { FAQ } from '../components/FAQ';
import { CTASection } from '../components/CTASection';
import { useScrollReveal } from '../components/ScrollReveal';
import { PhoneIcon, ChevronRight, ShieldIcon, LockIcon, UsersIcon } from '../components/icons';
import { SmartMedicareReview } from '../components/SmartMedicareReview';
import { LogoSvg } from '../components/LogoSvg';

const services = [
  {
    image: '/senior-adv-3.jpg',
    title: 'Medicare Advantage',
    titleEs: 'Medicare Advantage',
    description: 'All-in-one plans that often include dental, vision, hearing, and Part D drug coverage — sometimes at $0 premium.',
    descriptionEs: 'Planes todo en uno que frecuentemente incluyen dental, visión, audición y cobertura de medicamentos — a veces con prima de $0.',
    link: '/medicare-advantage',
  },
  {
    image: '/service-supplement.jpg',
    title: 'Medicare Supplement',
    titleEs: 'Suplemento de Medicare',
    description: 'Fill the gaps in Original Medicare — reduce or eliminate your out-of-pocket costs for hospital and medical services.',
    descriptionEs: 'Llene los vacíos del Medicare Original — reduzca o elimine sus costos de bolsillo para servicios hospitalarios y médicos.',
    link: '/medicare-supplement',
  },
  {
    image: '/service-partd.jpg',
    title: 'Part D Drug Plans',
    titleEs: 'Planes de Medicamentos Parte D',
    description: 'Stand-alone prescription drug coverage for seniors on Original Medicare. We compare plans based on your specific medications.',
    descriptionEs: 'Cobertura de medicamentos para personas en Medicare Original. Comparamos planes según sus medicamentos específicos.',
    link: '/part-d',
  },
  {
    image: '/service-extrahelp.jpg',
    title: 'Extra Help / LIS',
    titleEs: 'Ayuda Extra / LIS',
    description: 'You may qualify for federal assistance that lowers your drug plan premiums and copays. We check your eligibility at no charge.',
    descriptionEs: 'Puede calificar para asistencia federal que reduce sus primas y copagos. Verificamos su elegibilidad sin cargo.',
    link: '/extra-help',
  },
];

const faqItems = [
  {
    q: 'Is your service really free?',
    qEs: '¿Su servicio es realmente gratuito?',
    a: 'Yes. Our advisors are compensated by the insurance carriers when you enroll — at absolutely no cost to you. This is how independent Medicare brokers work nationwide.',
    aEs: 'Sí. Nuestros asesores son compensados por las aseguradoras cuando usted se inscribe — sin ningún costo para usted. Así es como funcionan los corredores independientes de Medicare en todo el país.',
  },
  {
    q: "What's the difference between Medicare Advantage and a Supplement?",
    qEs: '¿Cuál es la diferencia entre Medicare Advantage y un Suplemento?',
    a: "Medicare Advantage replaces Original Medicare with a private plan (often $0 premium, includes extras). Medicare Supplement (Medigap) works alongside Original Medicare to reduce out-of-pocket costs. The best option depends on your health usage and budget — that's exactly what we help you figure out.",
    aEs: 'Medicare Advantage reemplaza al Medicare Original con un plan privado (frecuentemente prima de $0, incluye extras). El Suplemento de Medicare trabaja junto al Medicare Original para reducir costos de bolsillo. La mejor opción depende de su uso de salud y presupuesto — eso es exactamente lo que le ayudamos a determinar.',
  },
  {
    q: 'When can I enroll or change my Medicare plan?',
    qEs: '¿Cuándo puedo inscribirme o cambiar mi plan de Medicare?',
    a: 'Key enrollment periods: Initial Enrollment (3 months before/after turning 65), Annual Open Enrollment (Oct 15–Dec 7), Medicare Advantage Open Enrollment (Jan 1–Mar 31), and Special Enrollment Periods for qualifying life events.',
    aEs: 'Períodos clave: Inscripción Inicial (3 meses antes/después de cumplir 65), Inscripción Abierta Anual (15 oct–7 dic), Inscripción Abierta de Medicare Advantage (1 ene–31 mar), y Períodos Especiales por eventos de vida calificados.',
  },
  {
    q: 'Do I have to change my doctors?',
    qEs: '¿Tengo que cambiar de médicos?',
    a: 'Not necessarily. We specifically check that your preferred doctors and hospitals are in-network for any plan we recommend before we suggest it.',
    aEs: 'No necesariamente. Verificamos específicamente que sus médicos y hospitales preferidos estén en la red de cualquier plan que recomendemos antes de sugerirlo.',
  },
  {
    q: 'What if I already have Medicare?',
    qEs: '¿Qué pasa si ya tengo Medicare?',
    a: 'We can still help. Many seniors are enrolled in plans that no longer fit their needs — or that have better, cheaper alternatives available. An annual review costs you nothing and could save you hundreds.',
    aEs: 'Aún podemos ayudar. Muchos adultos mayores están inscritos en planes que ya no se ajustan a sus necesidades — o que tienen mejores alternativas disponibles. Una revisión anual no le cuesta nada y podría ahorrarle cientos.',
  },
  {
    q: 'Is my personal information safe?',
    qEs: '¿Está segura mi información personal?',
    a: 'Absolutely. We do not sell, share, or distribute your personal information. We use it only to help you find the right plan. Our systems use industry-standard security protocols.',
    aEs: 'Absolutamente. No vendemos, compartimos ni distribuimos su información personal. La usamos únicamente para ayudarle a encontrar el plan correcto. Nuestros sistemas utilizan protocolos de seguridad estándar de la industria.',
  },
];

const steps = [
  {
    num: '1',
    title: 'Schedule a Free Call',
    titleEs: 'Programe una Llamada Gratuita',
    desc: 'Pick a time that works for you. We come prepared — no homework needed on your end.',
    descEs: 'Elija un horario conveniente. Nosotros llegamos preparados — usted no necesita hacer nada antes.',
  },
  {
    num: '2',
    title: 'We Analyze Your Situation',
    titleEs: 'Analizamos Su Situación',
    desc: 'We review your current coverage, medications, doctors, and budget to identify opportunities and gaps.',
    descEs: 'Revisamos su cobertura actual, medicamentos, médicos y presupuesto para identificar oportunidades y vacíos.',
  },
  {
    num: '3',
    title: 'We Compare Your Options',
    titleEs: 'Comparamos Sus Opciones',
    desc: 'We search 20+ carriers and present only the plans that make sense for your specific needs.',
    descEs: 'Buscamos en más de 20 aseguradoras y le presentamos solo los planes que tienen sentido para sus necesidades.',
  },
  {
    num: '4',
    title: 'You Decide — We Handle the Rest',
    titleEs: 'Usted Decide — Nosotros Hacemos el Resto',
    desc: 'No pressure. If you choose to enroll, we handle the paperwork and stay with you after the sale.',
    descEs: 'Sin presión. Si decide inscribirse, nosotros manejamos el papeleo y permanecemos con usted después.',
  },
];

interface Carrier {
  name: string;
  logo: string;
  alt: string;
  logoClass?: string;
}

const carriers: Carrier[] = [
  { name: 'Aetna',                        logo: '/carriers/aetna.png',            alt: 'Aetna logo'                         },
  { name: 'AARP',                          logo: '/carriers/aarp.png',             alt: 'AARP logo'                          },
  { name: 'Anthem Blue Cross Blue Shield', logo: '/carriers/anthem.png',           alt: 'Anthem Blue Cross Blue Shield logo' },
  { name: 'Cigna Healthcare',              logo: '/carriers/cigna.png',            alt: 'Cigna Healthcare logo',             logoClass: 'scale-[1.38]' },
  { name: 'Clover Health',                 logo: '/carriers/clover.png',           alt: 'Clover Health logo',                logoClass: 'scale-[1.20]' },
  { name: 'EmblemHealth',                  logo: '/carriers/emblemhealth.png',     alt: 'EmblemHealth logo',                 logoClass: 'scale-[1.25]' },
  { name: 'Empire BlueCross BlueShield',   logo: '/carriers/empire.png',           alt: 'Empire BlueCross BlueShield logo'   },
  { name: 'Fidelis Care',                  logo: '/carriers/fidelis.png',          alt: 'Fidelis Care logo',                 logoClass: 'scale-[1.38]' },
  { name: 'Healthfirst',                   logo: '/carriers/healthfirst.png',      alt: 'Healthfirst logo'                   },
  { name: 'Humana',                        logo: '/carriers/humana.png',           alt: 'Humana logo'                        },
  { name: 'UnitedHealthcare',              logo: '/carriers/unitedhealthcare.png', alt: 'UnitedHealthcare logo'              },
  { name: 'Wellcare',                      logo: '/carriers/wellcare.png',         alt: 'Wellcare logo',                     logoClass: 'scale-[1.28]' },
  { name: 'Wellpoint',                     logo: '/carriers/wellpoint.png',        alt: 'Wellpoint logo',                    logoClass: 'scale-[1.15]' },
  { name: 'Centene',                       logo: '/carriers/centene.png',          alt: 'Centene logo'                       },
  { name: 'VNS Health',                    logo: '/carriers/vns-health.svg',       alt: 'VNS Health logo',                   logoClass: 'scale-[1.15]' },
];

export default function Home() {
  const { t } = useLanguage();
  const welcomeReveal = useScrollReveal();
  const servicesReveal = useScrollReveal();
  const howReveal = useScrollReveal();
  const whyReveal = useScrollReveal();
  const testimonialsReveal = useScrollReveal();
  const ctaReveal = useScrollReveal();

  return (
    <div className="min-h-screen bg-cream-50">
      <Hero
        image="/hero-bg.jpg"
        eyebrow="Independent · Licensed · No Cost to You"
        eyebrowEs="Independiente · Licenciado · Sin Costo"
        headline="Navigate Medicare<br><em class='text-gold-300'>with Confidence</em>"
        headlineEs="Navega Medicare<br><em class='text-gold-300'>con Confianza</em>"
        subheadline="We help seniors understand their Medicare options — clearly, honestly, and without pressure. Our advisors work for you, not for an insurance company."
        subheadlineEs="Ayudamos a los adultos mayores a entender sus opciones de Medicare — de forma clara, honesta y sin presión. Nuestros asesores trabajan para usted, no para una aseguradora."
        showForm={true}
      />

      <TrustBar />

      {/* Smart Medicare Review */}
      <SmartMedicareReview />

      {/* Welcome */}
      <section ref={welcomeReveal.ref} className={`py-20 lg:py-28 bg-cream-50 transition-all duration-700 ${welcomeReveal.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
        <div className="max-w-4xl mx-auto px-5 text-center">
          <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-gold-500 mb-4 block">{t('Welcome', 'Bienvenido')}</span>
          <h2 className="font-serif text-3xl sm:text-4xl lg:text-[2.6rem] font-normal text-earth-900 leading-snug mb-6">
            {t('At Clear Point, we are dedicated to providing exceptional Medicare guidance tailored to your unique needs.', 'En Clear Point, nos dedicamos a brindar orientación excepcional de Medicare adaptada a sus necesidades únicas.')}
          </h2>
          <p className="text-earth-600 text-base sm:text-lg leading-relaxed max-w-2xl mx-auto mb-8">
            {t('Our experienced team is here to guide you through every step of your healthcare journey, ensuring optimal outcomes and peace of mind.', 'Nuestro experimentado equipo está aquí para guiarlo en cada paso de su viaje de salud, asegurando resultados óptimos y tranquilidad.')}
          </p>
          <Link to="/contact" className="inline-flex items-center gap-2 bg-earth-800 text-cream-50 font-semibold text-sm px-7 py-3.5 rounded-xl hover:bg-earth-900 transition-all hover:shadow-soft">
            {t('Get Started Now', 'Comience Ahora')}
            <ChevronRight />
          </Link>
        </div>
      </section>

      {/* Services */}
      <section ref={servicesReveal.ref} id="services" className={`py-20 lg:py-28 bg-white transition-all duration-700 ${servicesReveal.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
        <div className="max-w-6xl mx-auto px-5">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-gold-500 mb-4 block">{t('What We Cover', 'Lo Que Cubrimos')}</span>
            <h2 className="font-serif text-3xl sm:text-4xl lg:text-[2.6rem] font-normal text-earth-900 leading-snug mb-4">
              {t('Medicare Solutions We Offer', 'Soluciones Medicare Que Ofrecemos')}
            </h2>
            <p className="text-earth-600 text-base leading-relaxed">
              {t('We work with all major carriers to find the plan that fits your health needs, budget, and lifestyle.', 'Trabajamos con todas las aseguradoras principales para encontrar el plan que se adapte a sus necesidades de salud, presupuesto y estilo de vida.')}
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {services.map((s) => (
              <ServiceCard key={s.link} {...s} />
            ))}
          </div>
        </div>
      </section>

      {/* Enrollment Periods */}
      <section className="py-20 lg:py-28 bg-cream-50">
        <div className="max-w-6xl mx-auto px-5">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <div>
              <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-gold-500 mb-4 block">{t('Enrollment Guide', 'Guía de Inscripción')}</span>
              <h2 className="font-serif text-3xl sm:text-4xl font-normal text-earth-900 leading-snug mb-3">
                {t('Medicare Enrollment Periods', 'Períodos de Inscripción de Medicare')}
              </h2>
              <p className="text-earth-600 text-base leading-relaxed mb-8">
                {t(
                  'Medicare has specific times during the year when you can enroll in or change your coverage. Clear Point Senior Advisors helps you understand which enrollment period may apply to your situation, without pressure and in clear English or Spanish.',
                  'Medicare tiene momentos específicos durante el año en los que puede inscribirse o cambiar su cobertura. Clear Point Senior Advisors le ayuda a entender qué período de inscripción puede aplicar a su situación, sin presión y en inglés o español claros.'
                )}
              </p>

              <div className="space-y-4">
                {[
                  { title: 'Initial Enrollment Period', titleEs: 'Período de Inscripción Inicial', en: 'Your first chance to sign up for Medicare usually begins 3 months before the month you turn 65, includes your birthday month, and ends 3 months after that month.', es: 'Su primera oportunidad para inscribirse en Medicare generalmente comienza 3 meses antes del mes en que cumple 65 años, incluye el mes de su cumpleaños y termina 3 meses después de ese mes.' },
                  { title: 'Annual Enrollment Period', titleEs: 'Período de Inscripción Anual', en: 'From October 15 to December 7, people with Medicare can review or change certain Medicare Advantage and Part D prescription drug coverage for the following year.', es: 'Del 15 de octubre al 7 de diciembre, las personas con Medicare pueden revisar o cambiar ciertos planes Medicare Advantage y cobertura de medicamentos Parte D para el año siguiente.' },
                  { title: 'Medicare Advantage Open Enrollment', titleEs: 'Inscripción Abierta de Medicare Advantage', en: 'From January 1 to March 31, people already enrolled in a Medicare Advantage plan may be able to switch to another Medicare Advantage plan or return to Original Medicare.', es: 'Del 1 de enero al 31 de marzo, las personas ya inscritas en un plan Medicare Advantage pueden cambiarse a otro plan Medicare Advantage o regresar a Medicare Original.' },
                  { title: 'General Enrollment Period', titleEs: 'Período de Inscripción General', en: 'From January 1 to March 31, this period may apply if someone missed their first chance to sign up for Medicare Part A or Part B and does not qualify for a Special Enrollment Period. Penalties may apply.', es: 'Del 1 de enero al 31 de marzo, este período puede aplicar si alguien perdió su primera oportunidad de inscribirse en la Parte A o B de Medicare y no califica para un Período de Inscripción Especial. Pueden aplicar penalidades.' },
                  { title: 'Special Enrollment Period', titleEs: 'Período de Inscripción Especial', en: 'Certain life events may allow you to enroll or make changes outside the usual enrollment periods. Examples may include moving, losing coverage, qualifying for Medicaid, or getting Extra Help. Timing depends on the situation.', es: 'Ciertos eventos de vida pueden permitirle inscribirse o hacer cambios fuera de los períodos de inscripción habituales. Ejemplos incluyen mudarse, perder cobertura, calificar para Medicaid u obtener Ayuda Extra. El tiempo depende de la situación.' },
                ].map((p, i) => (
                  <div key={i} className="bg-white rounded-xl p-5 border border-cream-200 shadow-xs">
                    <h3 className="font-serif text-base font-semibold text-earth-900 mb-1.5">{t(p.title, p.titleEs)}</h3>
                    <p className="text-earth-600 text-sm leading-relaxed">{t(p.en, p.es)}</p>
                  </div>
                ))}
              </div>

              <p className="text-gold-600 text-xs mt-4">
                {t(
                  'Not every enrollment period applies to every person. Eligibility, timing, plan availability, and coverage options may vary by situation, location, and Medicare rules.',
                  'No todos los períodos de inscripción aplican a todas las personas. La elegibilidad, el tiempo, la disponibilidad de planes y las opciones de cobertura pueden variar según la situación, ubicación y reglas de Medicare.'
                )}
              </p>

              <div className="mt-8 bg-cream-100 rounded-2xl p-6 border border-cream-200">
                <h3 className="font-serif text-lg font-semibold text-earth-900 mb-2">
                  {t('Not sure which enrollment period applies to you?', '¿No está seguro de qué período de inscripción aplica?')}
                </h3>
                <p className="text-earth-600 text-sm mb-5">
                  {t('A licensed Medicare advisor can help you review your situation and understand your next steps.', 'Un asesor licenciado de Medicare puede ayudarle a revisar su situación y entender sus próximos pasos.')}
                </p>
                <div className="flex flex-wrap gap-3">
                  <Link to="/contact" className="inline-flex items-center gap-2 bg-earth-800 text-cream-50 font-semibold text-sm px-6 py-3 rounded-xl hover:bg-earth-900 transition-all">
                    {t('Check My Enrollment Options', 'Revisar Mis Opciones de Inscripción')}
                  </Link>
                  <a href="tel:18663108702" className="inline-flex items-center gap-2 bg-white text-earth-800 font-semibold text-sm px-6 py-3 rounded-xl border border-cream-200 hover:bg-cream-50 transition-all">
                    {t('Call 1-866-310-8702', 'Llamar al 1-866-310-8702')}
                  </a>
                </div>
              </div>
            </div>

            <div className="hidden lg:block">
              <img
                src="/enrollment-advisor.jpg"
                alt="Senior couple reviewing Medicare enrollment options with a trusted advisor."
                className="rounded-2xl shadow-lifted w-full object-cover"
                style={{ maxHeight: '600px' }}
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section ref={howReveal.ref} id="how" className={`py-20 lg:py-28 bg-cream-50 scroll-mt-24 transition-all duration-700 ${howReveal.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
        <div className="max-w-6xl mx-auto px-5">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-start">
            <div>
              <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-gold-500 mb-4 block">{t('Simple Process', 'Proceso Simple')}</span>
              <h2 className="font-serif text-3xl sm:text-4xl lg:text-[2.6rem] font-normal text-earth-900 leading-snug mb-4">
                {t('How It Works', 'Cómo Funciona')}
              </h2>
              <p className="text-earth-600 text-base leading-relaxed mb-10">
                {t('No confusing paperwork. No sales pressure. Just a clear, honest conversation about your options.', 'Sin papeleo confuso. Sin presión de ventas. Solo una conversación clara y honesta sobre sus opciones.')}
              </p>
              <div className="space-y-7">
                {steps.map((step) => (
                  <div key={step.num} className="flex gap-5 items-start">
                    <div className="flex-shrink-0 w-11 h-11 rounded-full bg-earth-800 text-gold-300 font-bold text-sm flex items-center justify-center">{step.num}</div>
                    <div>
                      <h3 className="font-serif text-base font-semibold text-earth-900 mb-1">{t(step.title, step.titleEs)}</h3>
                      <p className="text-earth-600 text-sm leading-relaxed">{t(step.desc, step.descEs)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="relative">
              <div className="bg-earth-800 rounded-3xl p-8 sm:p-10 text-center shadow-card relative overflow-hidden">
                <div className="absolute top-0 right-0 w-48 h-48 rounded-full bg-gold-400/10 -translate-y-1/2 translate-x-1/2" />
                <div className="relative z-10">
                  <div className="mb-4"><LogoSvg size={52} /></div>
                  <h3 className="font-serif text-xl text-cream-50 mb-3">{t('Ready to Talk?', '¿Listo para Hablar?')}</h3>
                  <p className="text-cream-100/70 text-sm leading-relaxed mb-6 max-w-sm mx-auto">
                    {t('Our advisors are available Monday through Friday, 9am–6pm Eastern Time. No robots. No hold music. Just a real person who knows Medicare.', 'Nuestros asesores están disponibles de lunes a viernes, 9am–6pm hora del Este. Sin robots. Sin música de espera. Solo una persona real que conoce Medicare.')}
                  </p>
                  <span className="font-serif text-2xl font-bold text-gold-300 block mb-5">1-866-310-8702</span>
                  <a href="tel:18663108702" className="inline-flex items-center gap-2 bg-gold-400 text-earth-900 font-bold text-sm px-6 py-3 rounded-xl hover:bg-gold-300 transition-all">
                    <PhoneIcon className="w-4 h-4" />
                    {t("Call Now — It's Free", 'Llamar Ahora — Es Gratis')}
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Why Independent */}
      <section ref={whyReveal.ref} id="why" className={`py-20 lg:py-28 bg-white scroll-mt-20 transition-all duration-700 ${whyReveal.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
        <div className="max-w-6xl mx-auto px-5">
          <div className="max-w-3xl">
            <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-gold-500 mb-4 block">{t('Why Independent Matters', 'Por Qué Importa Ser Independiente')}</span>
            <h2 className="font-serif text-3xl sm:text-4xl lg:text-[2.6rem] font-normal text-earth-900 leading-snug mb-4">
              {t('We Work for You,', 'Trabajamos para Usted,')}<br />{t('Not the Insurance Company', 'No para la Aseguradora')}
            </h2>
            <p className="text-earth-600 text-base leading-relaxed mb-8">
              {t("Unlike captive agents who can only offer one company's plans, we're independent — meaning we compare across the entire market to find what's genuinely best for you.", 'A diferencia de los agentes cautivos que solo ofrecen planes de una empresa, somos independientes — comparamos en todo el mercado para encontrar lo que es genuinamente mejor para usted.')}
            </p>
            <div className="space-y-4">
              {[
                { icon: <ShieldIcon className="w-5 h-5 text-gold-500" />, title: 'Unbiased Advice', titleEs: 'Asesoría Imparcial', desc: 'No quotas, no company targets. Our only goal is to find the right plan for you.', descEs: 'Sin cuotas, sin metas corporativas. Nuestro único objetivo es encontrar el plan correcto para usted.' },
                { icon: <LockIcon className="w-5 h-5 text-gold-500" />, title: 'Your Data Is Protected', titleEs: 'Sus Datos Están Protegidos', desc: 'We never sell your personal information. Period.', descEs: 'Nunca vendemos su información personal. Punto.' },
                { icon: <UsersIcon className="w-5 h-5 text-gold-500" />, title: 'We Stay With You After Enrollment', titleEs: 'Permanecemos Con Usted Después de la Inscripción', desc: "Questions, claims, or billing issues — we're your point of contact, not a call center.", descEs: 'Preguntas, reclamaciones o problemas de facturación — somos su contacto, no un centro de llamadas.' },
              ].map((r, i) => (
                <div key={i} className="flex gap-4 items-start bg-cream-50 rounded-xl p-5 shadow-xs hover:shadow-soft transition-shadow">
                  <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gold-100 flex items-center justify-center">{r.icon}</div>
                  <div>
                    <h3 className="font-serif text-sm font-semibold text-earth-900 mb-1">{t(r.title, r.titleEs)}</h3>
                    <p className="text-earth-600 text-sm leading-relaxed">{t(r.desc, r.descEs)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Carriers */}
      <section className="py-16 lg:py-20 bg-cream-50">
        <div className="max-w-[1100px] mx-auto px-6">
          <h3 className="font-serif text-xl sm:text-2xl text-earth-900 mb-2">
            {t('Carriers We May Help You Review', 'Aseguradoras que podemos ayudarle a revisar')}
          </h3>
          <p className="text-earth-600 text-sm sm:text-base mb-3 max-w-3xl">
            {t(
              'Carrier availability varies by location and eligibility. We help you review options available in your area.',
              'La disponibilidad de aseguradoras varía por ubicación y elegibilidad. Le ayudamos a revisar las opciones disponibles en su área.'
            )}
          </p>
          <p className="text-xs text-gold-600 font-semibold mb-8">
            {t('Carrier participation and plan availability vary by county, state, eligibility, and appointment status.', 'La participación de aseguradoras y la disponibilidad de planes varían por condado, estado, elegibilidad y estado de cita.')}
          </p>

          <div className="grid grid-cols-1 min-[430px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {carriers.map((carrier) => (
              <div
                key={carrier.name}
                className="h-[96px] bg-white/95 rounded-2xl border border-cream-200 shadow-soft flex items-center justify-center px-4 py-4 overflow-hidden"
              >
                <div className="flex items-center justify-center w-[130px] h-[44px]">
                  <img
                    src={carrier.logo}
                    alt={carrier.alt}
                    loading="lazy"
                    decoding="async"
                    className={`block object-contain max-w-full max-h-full transition-transform${carrier.logoClass ? ' ' + carrier.logoClass : ''}`}
                  />
                </div>
              </div>
            ))}
          </div>

          <p className="text-earth-400 mt-8 leading-relaxed max-w-[760px]" style={{ fontSize: 13, lineHeight: 1.6 }}>
            {t(
              'Carrier names and logos are shown for informational purposes only. Availability varies by state, county, eligibility, and appointment status. Clear Point Senior Advisors is not affiliated with or endorsed by Medicare, CMS, the U.S. government, or the carriers listed.',
              'Los nombres y logotipos de las aseguradoras se muestran solo con fines informativos. La disponibilidad varía por estado, condado, elegibilidad y estado de cita. Clear Point Senior Advisors no está afiliado ni respaldado por Medicare, CMS, el gobierno de los Estados Unidos ni las aseguradoras listadas.'
            )}
          </p>
        </div>
      </section>

      {/* Client Experience Standards */}
      <section ref={testimonialsReveal.ref} className={`py-20 lg:py-28 bg-cream-100 transition-all duration-700 ${testimonialsReveal.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
        <div className="max-w-6xl mx-auto px-5">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-gold-500 mb-4 block">{t('Our Commitment', 'Nuestro Compromiso')}</span>
            <h2 className="font-serif text-3xl sm:text-4xl lg:text-[2.6rem] font-normal text-earth-900 leading-snug mb-4">
              {t('Client Experience Standards', 'Estándares de Experiencia del Cliente')}
            </h2>
            <p className="text-earth-600 text-base leading-relaxed">
              {t('Every interaction with Clear Point is guided by these three principles — no exceptions.', 'Cada interacción con Clear Point se guía por estos tres principios — sin excepciones.')}
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                num: '1',
                titleEn: 'Clear Explanations Before Decisions',
                titleEs: 'Explicaciones Claras Antes de Decisiones',
                descEn: 'We explain every option in plain language — English or Spanish — so you understand what you are choosing and why. No jargon. No rushing. No decision before you are ready.',
                descEs: 'Explicamos cada opción en lenguaje sencillo — inglés o español — para que entienda lo que está eligiendo y por qué. Sin jerga. Sin prisa. Sin decisión antes de que esté listo.',
              },
              {
                num: '2',
                titleEn: 'Respectful Bilingual Support',
                titleEs: 'Apoyo Bilingüe Respetuoso',
                descEn: 'All our advisors speak English and Spanish. Medicare is confusing enough without a language barrier. You deserve to understand your coverage in the language you are most comfortable with.',
                descEs: 'Todos nuestros asesores hablan inglés y español. Medicare ya es lo suficientemente confuso sin una barrera del idioma. Usted merece entender su cobertura en el idioma con el que se siente más cómodo.',
              },
              {
                num: '3',
                titleEn: 'No-Pressure, Appointment-Based Guidance',
                titleEs: 'Orientación Sin Presión, Basada en Citas',
                descEn: 'We work by appointment so every client gets our full attention. There is no cold calling, no pushy sales tactics, and no obligation to enroll. You decide what is right for you.',
                descEs: 'Trabajamos por cita para que cada cliente reciba nuestra total atención. No hay llamadas en frío, no tácticas de venta agresivas, y no hay obligación de inscribirse. Usted decide lo que es correcto para usted.',
              },
            ].map((card, i) => (
              <div key={i} className="bg-white rounded-2xl p-8 shadow-soft border border-cream-200">
                <div className="w-12 h-12 rounded-full bg-earth-800 text-gold-300 font-bold text-lg flex items-center justify-center mb-5">
                  {card.num}
                </div>
                <h3 className="font-serif text-xl font-semibold text-earth-900 mb-3">
                  {t(card.titleEn, card.titleEs)}
                </h3>
                <p className="text-earth-600 text-sm leading-relaxed">
                  {t(card.descEn, card.descEs)}
                </p>
              </div>
            ))}
          </div>
          <p className="text-center text-[11px] text-earth-400 mt-8">
            {t('Client testimonials require written consent and FMO/legal review before publication.', 'Los testimonios de clientes requieren consentimiento por escrito y revisión FMO/legal antes de la publicación.')}
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section ref={ctaReveal.ref} id="faq" className="py-20 lg:py-28 bg-cream-50 scroll-mt-20">
        <div className="max-w-6xl mx-auto px-5">
          <FAQ items={faqItems} title="Common Questions" titleEs="Preguntas Frecuentes" />
        </div>
      </section>

      {/* CTA */}
      <CTASection
        headline="Ready to Find the Right Plan?"
        headlineEs="¿Listo para Encontrar el Plan Correcto?"
        subheadline="No obligation. No pressure. Just clear, honest guidance from a licensed Medicare advisor who works for you."
        subheadlineEs="Sin compromiso. Sin presión. Solo orientación clara y honesta de un asesor de Medicare licenciado que trabaja para usted."
      />
    </div>
  );
}
 
