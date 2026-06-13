import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { useLanguage } from '../hooks/useLanguage';

// Sawil 2026-06 — UNIQUE per-page <title> + meta description (SEO).
// Before this, every route shared the single static title/description from
// index.html, which search engines flag as duplicate content. This sets a
// unique, bilingual title + description per route from one central map.
interface Meta { title: string; titleEs: string; description: string; descriptionEs: string; }

const PAGE_META: Record<string, Meta> = {
  '/': {
    title: 'Bilingual Medicare Help in NY, NJ & CT | Clear Point Senior Advisors',
    titleEs: 'Ayuda Bilingüe de Medicare en NY, NJ y CT | Clear Point Senior Advisors',
    description: 'Independent, licensed Medicare agency serving New York, New Jersey and Connecticut. Free bilingual guidance on Medicare Advantage, Supplement, Part D and Extra Help.',
    descriptionEs: 'Agencia de Medicare independiente y licenciada que sirve New York, New Jersey y Connecticut. Orientación bilingüe gratis sobre Medicare Advantage, Suplemento, Parte D y Ayuda Extra.',
  },
  '/about': {
    title: 'About Us — Independent, Licensed Medicare Brokers | Clear Point Senior Advisors',
    titleEs: 'Nosotros — Corredores de Medicare Independientes y Licenciados | Clear Point Senior Advisors',
    description: 'Clear Point Senior Advisors is an independent, licensed Medicare agency offering free, no-pressure, bilingual guidance across New York, New Jersey and Connecticut.',
    descriptionEs: 'Clear Point Senior Advisors es una agencia de Medicare independiente y licenciada con orientación gratis, sin presión y bilingüe en New York, New Jersey y Connecticut.',
  },
  '/medicare-advantage': {
    title: 'Medicare Advantage Plans in NY, NJ & CT | Clear Point Senior Advisors',
    titleEs: 'Planes Medicare Advantage en NY, NJ y CT | Clear Point Senior Advisors',
    description: 'Understand Medicare Advantage (Part C): how it works, networks, extra benefits and costs. Free bilingual help comparing plans in NY, NJ and CT — no pressure.',
    descriptionEs: 'Entienda Medicare Advantage (Parte C): cómo funciona, redes, beneficios extra y costos. Ayuda bilingüe gratis para comparar planes en NY, NJ y CT — sin presión.',
  },
  '/medicare-supplement': {
    title: 'Medicare Supplement (Medigap) Explained | Clear Point Senior Advisors',
    titleEs: 'Suplemento Medicare (Medigap) Explicado | Clear Point Senior Advisors',
    description: 'Learn how Medicare Supplement (Medigap) works with Original Medicare to help with out-of-pocket costs. Free bilingual guidance for NY, NJ and CT.',
    descriptionEs: 'Aprenda cómo el Suplemento Medicare (Medigap) funciona con Medicare Original para ayudar con costos de bolsillo. Orientación bilingüe gratis para NY, NJ y CT.',
  },
  '/part-d': {
    title: 'Medicare Part D Drug Plans Explained | Clear Point Senior Advisors',
    titleEs: 'Planes de Medicamentos Parte D Explicados | Clear Point Senior Advisors',
    description: 'How Medicare Part D drug coverage works: formularies, pharmacies and the coverage gap. Free bilingual help reviewing your drug plan in NY, NJ and CT.',
    descriptionEs: 'Cómo funciona la cobertura de medicamentos Parte D: formularios, farmacias y la brecha de cobertura. Ayuda bilingüe gratis para revisar su plan en NY, NJ y CT.',
  },
  '/extra-help': {
    title: 'Extra Help / LIS for Medicare Drug Costs | Clear Point Senior Advisors',
    titleEs: 'Ayuda Extra / LIS para Costos de Medicamentos | Clear Point Senior Advisors',
    description: 'Extra Help (LIS) may lower Medicare prescription drug costs for people with limited income and resources. Learn how it works — free bilingual guidance.',
    descriptionEs: 'Ayuda Extra (LIS) puede bajar los costos de medicamentos de Medicare para personas con ingresos y recursos limitados. Aprenda cómo funciona — orientación bilingüe gratis.',
  },
  '/help-paying-costs': {
    title: 'Help Paying Medicare Costs — MSP & Medicaid | Clear Point Senior Advisors',
    titleEs: 'Ayuda con Costos de Medicare — MSP y Medicaid | Clear Point Senior Advisors',
    description: 'Programs that may help pay Medicare costs: Medicare Savings Programs (QMB, SLMB, QI), Medicaid and Extra Help. Free bilingual guidance for NY, NJ and CT.',
    descriptionEs: 'Programas que pueden ayudar a pagar costos de Medicare: Programas de Ahorros (QMB, SLMB, QI), Medicaid y Ayuda Extra. Orientación bilingüe gratis para NY, NJ y CT.',
  },
  '/otc-benefits': {
    title: 'Medicare OTC Benefits Explained | Clear Point Senior Advisors',
    titleEs: 'Beneficios OTC de Medicare Explicados | Clear Point Senior Advisors',
    description: 'Some Medicare Advantage plans include an Over-the-Counter (OTC) benefit. Learn what it may cover and how it varies by plan. Free bilingual help in NY, NJ and CT.',
    descriptionEs: 'Algunos planes Medicare Advantage incluyen un beneficio OTC (sin receta). Aprenda qué puede cubrir y cómo varía por plan. Ayuda bilingüe gratis en NY, NJ y CT.',
  },
  '/support': {
    title: 'Customer Support — Chat with Clara | Clear Point Senior Advisors',
    titleEs: 'Servicio al Cliente — Hable con Clara | Clear Point Senior Advisors',
    description: 'Need help with your Medicare coverage, a plan, a bill or a letter? Chat with Clara, our bilingual assistant, or connect with a licensed advisor — free, no pressure.',
    descriptionEs: '¿Necesita ayuda con su cobertura, un plan, una factura o una carta de Medicare? Hable con Clara, nuestra asistente bilingüe, o con un asesor licenciado — gratis, sin presión.',
  },
  '/resources': {
    title: 'Medicare Resources & Free Guides | Clear Point Senior Advisors',
    titleEs: 'Recursos y Guías de Medicare Gratis | Clear Point Senior Advisors',
    description: 'Free bilingual Medicare education: the basics, enrollment periods, late penalties, long-term care, PACE and more. Trusted guidance for NY, NJ and CT.',
    descriptionEs: 'Educación de Medicare bilingüe y gratis: lo básico, períodos de inscripción, penalidades, cuidado a largo plazo, PACE y más. Orientación confiable para NY, NJ y CT.',
  },
  '/contact': {
    title: 'Contact Us | Clear Point Senior Advisors (NY, NJ, CT)',
    titleEs: 'Contáctenos | Clear Point Senior Advisors (NY, NJ, CT)',
    description: 'Contact Clear Point Senior Advisors for free, no-pressure bilingual Medicare help. Call 1-866-310-8702 or request a callback. Serving NY, NJ and CT.',
    descriptionEs: 'Contacte a Clear Point Senior Advisors para ayuda de Medicare bilingüe, gratis y sin presión. Llame al 1-866-310-8702 o pida una llamada. Servimos NY, NJ y CT.',
  },
  '/privacy-policy': {
    title: 'Privacy Policy | Clear Point Senior Advisors',
    titleEs: 'Política de Privacidad | Clear Point Senior Advisors',
    description: 'How Clear Point Senior Advisors collects, uses and protects the information you provide. Please do not submit Social Security or Medicare numbers online.',
    descriptionEs: 'Cómo Clear Point Senior Advisors recopila, usa y protege la información que usted proporciona. Por favor no envíe números de Seguro Social ni de Medicare en línea.',
  },
  '/accessibility': {
    title: 'Accessibility Statement | Clear Point Senior Advisors',
    titleEs: 'Declaración de Accesibilidad | Clear Point Senior Advisors',
    description: 'Clear Point Senior Advisors is committed to making our website accessible to everyone, including people with disabilities. Read our accessibility commitment.',
    descriptionEs: 'Clear Point Senior Advisors se compromete a hacer nuestro sitio accesible para todos, incluidas las personas con discapacidad. Lea nuestro compromiso de accesibilidad.',
  },
  '/terms': {
    title: 'Terms of Use | Clear Point Senior Advisors',
    titleEs: 'Términos de Uso | Clear Point Senior Advisors',
    description: 'The terms of use for the Clear Point Senior Advisors website. An independent insurance agency, not connected with or endorsed by Medicare or the U.S. government.',
    descriptionEs: 'Los términos de uso del sitio de Clear Point Senior Advisors. Agencia de seguros independiente, no conectada ni respaldada por Medicare ni el gobierno de EE. UU.',
  },
};

const FALLBACK = PAGE_META['/'];
const SITE = 'https://clearpointsenioradvisors.com';

// upsert sin duplicar: busca el tag; si no existe lo crea; set content.
function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  let tag = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute(attr, key);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}

export function RouteMeta() {
  const { lang } = useLanguage();
  const { pathname } = useLocation();
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const m = PAGE_META[pathname] || FALLBACK;
    const title = lang === 'es' ? m.titleEs : m.title;
    const desc = lang === 'es' ? m.descriptionEs : m.description;
    const url = SITE + pathname;
    document.title = title;
    let el = document.head.querySelector('meta[name="description"]');
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute('name', 'description');
      document.head.appendChild(el);
    }
    el.setAttribute('content', desc);

    // canonical POR RUTA (nunca global al home)
    let link = document.head.querySelector('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.setAttribute('rel', 'canonical');
      document.head.appendChild(link);
    }
    link.setAttribute('href', url);

    // OG / Twitter por ruta (reusa el title/description únicos que ya existen).
    // og:image / twitter:image quedan como base en index.html (misma imagen).
    upsertMeta('property', 'og:title', title);
    upsertMeta('property', 'og:description', desc);
    upsertMeta('property', 'og:url', url);
    upsertMeta('name', 'twitter:title', title);
    upsertMeta('name', 'twitter:description', desc);
  }, [pathname, lang]);
  return null;
}
