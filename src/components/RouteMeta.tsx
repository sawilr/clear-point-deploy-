import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { useLanguage, isSpanishPath, toEnglishPath, toSpanishPath } from '../hooks/useLanguage';

// Sawil 2026-06 — UNIQUE per-page <title> + meta description (SEO).
// Before this, every route shared the single static title/description from
// index.html, which search engines flag as duplicate content. This sets a
// unique, bilingual title + description per route from one central map.
interface Meta { title: string; titleEs: string; description: string; descriptionEs: string; }

const PAGE_META: Record<string, Meta> = {
  // SEO 2026-09-27 (SEO-T2 / SEO-LIVE-01 / CA-SEO-05). Mi commit ff43e8d recortó
  // los títulos a 60 caracteres y en el recorte se fue "in NY, NJ & CT" de 25 de
  // 26 títulos: la única señal geográfica que Google tenía para casar la
  // intención local. Restaurada dentro del límite; la portada va marca-primero
  // porque la consulta de marca la diluyen firmas financieras homónimas.
  // (El comentario va FUERA del objeto: prerender-meta exige `title:` justo
  // después de la llave y un comentario dentro dejaría la ruta sin shell.)
  '/': {
    title: 'Clear Point Senior Advisors | Medicare Help in NY, NJ & CT',
    titleEs: 'Clear Point Senior Advisors | Medicare en NY, NJ y CT',
    description: 'Independent, licensed Medicare agency for New York, New Jersey and Connecticut. Free bilingual guidance on Advantage, Part D and Extra Help.',
    descriptionEs: 'Agencia de Medicare independiente y licenciada para New York, New Jersey y Connecticut. Orientación bilingüe gratis sobre Advantage y Parte D.',
  },
  '/about': {
    title: 'About Our Medicare Advisors in NY, NJ & CT | Clear Point',
    titleEs: 'Nuestros Asesores de Medicare en NY, NJ y CT | Clear Point',
    description: 'An independent, licensed Medicare agency offering free, no-pressure bilingual guidance across New York, New Jersey and Connecticut.',
    descriptionEs: 'Agencia de Medicare independiente y licenciada, con orientación gratis, sin presión y bilingüe en New York, New Jersey y Connecticut.',
  },
  '/medicare-advantage': {
    title: 'Medicare Advantage Plans in NY, NJ & CT | Clear Point',
    titleEs: 'Planes Medicare Advantage en NY, NJ y CT | Clear Point',
    description: 'Understand Medicare Advantage (Part C): how it works, networks, extra benefits and costs. Free bilingual help comparing plans in NY, NJ and CT — no pressure.',
    descriptionEs: 'Entienda Medicare Advantage (Parte C): cómo funciona, redes, beneficios extra y costos. Ayuda bilingüe gratis para comparar planes en NY, NJ y CT — sin presión.',
  },
  // Sawil 2026-06-30 AUDIT FIX (SEO) — /medicare-supplement is 301-redirected to
  // /resources (ClearPoint does not currently broker Medigap) and its route is out
  // of the app router. Its PAGE_META was orphaned dead meta for an unreachable URL.
  '/part-d': {
    title: 'Medicare Part D Drug Plans in NY, NJ & CT | Clear Point',
    titleEs: 'Planes de Medicamentos Parte D en NY, NJ y CT | Clear Point',
    description: 'How Part D drug coverage works: formularies, pharmacies and the three coverage stages (no more donut hole). Free bilingual help with your plan.',
    descriptionEs: 'Cómo funciona la Parte D: formularios, farmacias y las tres etapas de cobertura (ya no hay donut hole). Ayuda bilingüe gratis con su plan.',
  },
  '/extra-help': {
    title: 'Medicare Extra Help (LIS) in NY, NJ & CT | Clear Point',
    titleEs: 'Ayuda Adicional (LIS) en NY, NJ y CT | Clear Point',
    description: 'Extra Help (LIS) may lower Medicare drug costs for people with limited income and resources. Free bilingual guidance in NY, NJ and CT.',
    descriptionEs: 'Ayuda Adicional (LIS) puede bajar los costos de medicamentos de Medicare si tiene ingresos y recursos limitados. Orientación bilingüe gratis.',
  },
  '/help-paying-costs': {
    title: 'Help Paying Medicare Costs in NY, NJ & CT | Clear Point',
    titleEs: 'Ayuda con Costos de Medicare en NY, NJ y CT | Clear Point',
    description: 'Programs that may help pay Medicare costs: Medicare Savings Programs (QMB, SLMB, QI), Medicaid and Extra Help. Free bilingual guidance.',
    descriptionEs: 'Programas que pueden ayudar a pagar costos de Medicare: Programas de Ahorros (QMB, SLMB, QI), Medicaid y Ayuda Adicional. Orientación gratis.',
  },
  '/otc-benefits': {
    title: 'Medicare OTC Benefits in NY, NJ & CT | Clear Point',
    titleEs: 'Beneficios OTC de Medicare en NY, NJ y CT | Clear Point',
    description: 'Some Medicare Advantage plans include an Over-the-Counter (OTC) benefit. What it may cover and how it varies by plan. Free bilingual help.',
    descriptionEs: 'Algunos planes Medicare Advantage incluyen un beneficio OTC (sin receta). Aprenda qué puede cubrir y cómo varía por plan. Ayuda bilingüe gratis en NY, NJ y CT.',
  },
  '/support': {
    title: 'Customer Support | Clear Point Senior Advisors',
    titleEs: 'Servicio al Cliente | Clear Point Senior Advisors',
    description: 'Help with your Medicare coverage, a plan, a bill or a letter. Chat with Clara, our bilingual assistant, or reach a licensed advisor — free.',
    descriptionEs: 'Ayuda con su cobertura, un plan, una factura o una carta de Medicare. Hable con Clara, nuestra asistente bilingüe, o con un asesor licenciado.',
  },
  '/resources': {
    title: 'Medicare Resources & Guides for NY, NJ & CT | Clear Point',
    titleEs: 'Recursos y Guías de Medicare para NY, NJ y CT | Clear Point',
    description: 'Free bilingual Medicare education: the basics, enrollment periods, late penalties, long-term care, PACE and more. Guidance for NY, NJ and CT.',
    descriptionEs: 'Educación de Medicare bilingüe y gratis: lo básico, períodos de inscripción, penalidades, cuidado a largo plazo, PACE y más. Para NY, NJ y CT.',
  },
  '/contact': {
    title: 'Contact Us | Clear Point Senior Advisors (NY, NJ, CT)',
    titleEs: 'Contáctenos | Clear Point Senior Advisors (NY, NJ, CT)',
    description: 'Contact Clear Point Senior Advisors for free, no-pressure bilingual Medicare help. Call 1-855-720-8555 or request a callback. Serving NY, NJ and CT.',
    descriptionEs: 'Contacte a Clear Point Senior Advisors para ayuda de Medicare bilingüe, gratis y sin presión. Llame al 1-855-720-8555 o pida una llamada. Servimos NY, NJ y CT.',
  },
  '/privacy-policy': {
    title: 'Privacy Policy | Clear Point Senior Advisors',
    titleEs: 'Política de Privacidad | Clear Point Senior Advisors',
    description: 'How Clear Point Senior Advisors collects, uses and protects the information you provide. Please do not submit Social Security or Medicare numbers online.',
    descriptionEs: 'Cómo Clear Point Senior Advisors recopila, usa y protege su información. Por favor no envíe números de Seguro Social ni de Medicare en línea.',
  },
  '/accessibility': {
    title: 'Accessibility Statement | Clear Point Senior Advisors',
    titleEs: 'Declaración de Accesibilidad | Clear Point Senior Advisors',
    description: 'Clear Point Senior Advisors is committed to making our website accessible to everyone, including people with disabilities. Read our accessibility commitment.',
    descriptionEs: 'Clear Point Senior Advisors se compromete a hacer su sitio accesible para todos, incluidas las personas con discapacidad. Lea el compromiso completo.',
  },
  // SEO 2026-09-27 — las diez guías educativas, antes modales sin URL (CA-SEO-03).
  // Título ≤ 60 y descripción ≤ 160; prerender-meta.mjs aborta el build si no.
  '/resources/medicare-101': {
    title: 'Medicare 101: Parts A, B, C and D Explained | Clear Point',
    titleEs: 'Medicare 101: Partes A, B, C y D Explicadas | Clear Point',
    description: 'What each part of Medicare generally covers, how Medicare Advantage fits in, and when you may be able to enroll. Plain-language guide from NY, NJ & CT advisors.',
    descriptionEs: 'Qué cubre en general cada parte de Medicare, cómo encaja Medicare Advantage y cuándo puede inscribirse. Guía en lenguaje sencillo, desde NY, NJ y CT.',
  },
  '/resources/enrollment-periods': {
    title: 'Medicare Enrollment Periods: IEP, AEP, OEP & SEP',
    titleEs: 'Períodos de Inscripción de Medicare: IEP, AEP, OEP y SEP',
    description: 'When you can enroll in or change Medicare coverage: the Initial, Annual and Open Enrollment Periods and the Special Enrollment Periods, explained simply.',
    descriptionEs: 'Cuándo puede inscribirse o cambiar su cobertura de Medicare: los períodos inicial, anual y abierto, y los períodos especiales, explicados con claridad.',
  },
  '/resources/turning-65': {
    title: 'Turning 65: Your Medicare Checklist | Clear Point',
    titleEs: 'Cumpliendo 65: Su Lista de Verificación de Medicare',
    description: 'A step-by-step checklist for people turning 65 in New York, New Jersey or Connecticut: when to sign up, what to decide, and what to avoid.',
    descriptionEs: 'Lista paso a paso para quien cumple 65 en Nueva York, Nueva Jersey o Connecticut: cuándo inscribirse, qué decidir y qué evitar.',
  },
  '/resources/part-d-three-stages': {
    title: 'Medicare Part D and Its Three Stages | Clear Point',
    titleEs: 'La Parte D de Medicare y sus Tres Etapas | Clear Point',
    description: 'How a Part D drug plan works in 2026: the deductible, initial coverage and catastrophic coverage stages, and the yearly out-of-pocket cap.',
    descriptionEs: 'Cómo funciona un plan de medicamentos Parte D en 2026: deducible, cobertura inicial y cobertura catastrófica, y el tope anual de gastos de bolsillo.',
  },
  '/resources/medicare-advantage-vs-medigap': {
    title: 'Medicare Advantage vs. Medigap Explained | Clear Point',
    titleEs: 'Medicare Advantage vs. Medigap: Diferencias Clave',
    description: 'How Medicare Advantage and Medicare Supplement (Medigap) differ in cost, networks, and coverage, so you can ask a licensed advisor the right questions.',
    descriptionEs: 'En qué se diferencian Medicare Advantage y el Suplemento (Medigap) en costo, redes y cobertura, para hacerle las preguntas correctas a un asesor licenciado.',
  },
  '/resources/extra-help-lis': {
    title: 'Extra Help (LIS): Could You Be Eligible? | Clear Point',
    titleEs: 'Ayuda Adicional (LIS): ¿Podría Ser Elegible? | Clear Point',
    description: 'What the Extra Help / Low-Income Subsidy program does for Medicare drug costs, who may qualify, and how to apply through Social Security.',
    descriptionEs: 'Qué hace el programa de Ayuda Adicional (LIS) con los costos de medicamentos de Medicare, quién podría calificar y cómo solicitarlo en el Seguro Social.',
  },
  '/resources/late-enrollment-penalties': {
    title: 'Medicare Late Enrollment Penalties Explained | Clear Point',
    titleEs: 'Penalidades de Medicare por Inscripción Tardía',
    description: 'How the Part B and Part D late enrollment penalties are calculated, how long they last, and the situations where they may not apply.',
    descriptionEs: 'Cómo se calculan las penalidades por inscripción tardía de la Parte B y la Parte D, cuánto duran y en qué situaciones podrían no aplicar.',
  },
  '/resources/long-term-care-pace': {
    title: 'Long-Term Care and PACE Under Medicare | Clear Point',
    titleEs: 'Cuidado a Largo Plazo y PACE con Medicare | Clear Point',
    description: 'What Medicare does and does not cover for long-term care, and how PACE programs work for people who qualify in NY, NJ and CT.',
    descriptionEs: 'Qué cubre y qué no cubre Medicare en cuidado a largo plazo, y cómo funcionan los programas PACE para quienes califican en NY, NJ y CT.',
  },
  '/resources/union-va-federal-state-coverage': {
    title: 'Union, VA, Federal & State Coverage with Medicare',
    titleEs: 'Cobertura de Unión, VA, Federal y Estatal con Medicare',
    description: 'How union, VA, federal employee and state retiree coverage coordinates with Medicare, and the questions to ask before changing anything.',
    descriptionEs: 'Cómo se coordinan con Medicare la cobertura sindical, del VA, de empleados federales y de jubilados estatales, y qué preguntar antes de cambiar algo.',
  },
  '/resources/nursing-homes-rehabilitation': {
    title: 'Nursing Homes & Rehab: What Medicare Covers | Clear Point',
    titleEs: 'Hogares de Ancianos y Rehabilitación con Medicare',
    description: 'After a qualifying hospital stay, Medicare may help pay for short-term skilled nursing or rehab. What is generally covered, for how long, and the rules.',
    descriptionEs: 'Tras una hospitalización que califique, Medicare puede ayudar con rehabilitación o cuidado especializado a corto plazo: qué cubre, cuánto tiempo y las reglas.',
  },
  '/terms': {
    title: 'Terms of Use | Clear Point Senior Advisors',
    titleEs: 'Términos de Uso | Clear Point Senior Advisors',
    description: 'Terms of use for the Clear Point Senior Advisors website. An independent agency, not connected with or endorsed by Medicare or the U.S. government.',
    descriptionEs: 'Términos de uso del sitio de Clear Point Senior Advisors. Agencia independiente, no conectada ni respaldada por Medicare ni el gobierno de EE. UU.',
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
    // Sawil 2026-07-27 ES ROUTES (SEO) — /es twins reuse the PAGE_META entry
    // keyed by their English path. A Spanish URL ALWAYS serves the Spanish
    // title/description (URL wins over the client-side language preference);
    // English URLs keep the original lang-driven behavior.
    const urlIsSpanish = isSpanishPath(pathname);
    const basePath = toEnglishPath(pathname);
    const m = PAGE_META[basePath] || FALLBACK;
    const useEs = urlIsSpanish || lang === 'es';
    const title = useEs ? m.titleEs : m.title;
    const desc = useEs ? m.descriptionEs : m.description;
    const url = SITE + pathname;
    document.title = title;
    // <html lang> mirrors the URL language (es on /es/*), or the client-side
    // preference on English URLs — same value the LanguageProvider writes.
    document.documentElement.lang = useEs ? 'es' : 'en';
    let el = document.head.querySelector('meta[name="description"]');
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute('name', 'description');
      document.head.appendChild(el);
    }
    el.setAttribute('content', desc);

    // Sawil 2026-06-29 SECURITY HOTFIX (findings 11/12) — a path not in our route
    // map (and not /thank-you or /soa/:token) is the SPA 404 page. Do NOT
    // self-canonicalize an invalid URL, and mark it noindex so search engines and
    // monitoring don't treat soft-404s as real pages. Known routes keep a
    // per-route canonical and are indexable.
    // Sawil 2026-06-30 AUDIT FIX (security HIGH + SEO) — /soa/:token are per-user,
    // 24h-expiring secure Scope-of-Appointment links. They must NEVER be indexed or
    // self-canonicalized (that would invite crawling/caching of tokenized secure URLs
    // and thin soft-404s once tokens expire). Force noindex + no canonical for /soa/*.
    const isSoa = basePath.startsWith('/soa/');
    // Sawil 2026-06-30 AUDIT FIX (SEO) — /thank-you is a post-submit confirmation
    // page. It has no PAGE_META, so indexing it served the homepage's title/description
    // as duplicate content. Treat it like /soa: noindex + no canonical.
    const isThankYou = basePath === '/thank-you';
    const isKnownRoute = !isSoa && !isThankYou && !!PAGE_META[basePath];
    let link = document.head.querySelector('link[rel="canonical"]');
    if (isKnownRoute) {
      if (!link) {
        link = document.createElement('link');
        link.setAttribute('rel', 'canonical');
        document.head.appendChild(link);
      }
      link.setAttribute('href', url); // self-referencing (the /es URL canonicalizes to itself)
      upsertMeta('name', 'robots', 'index, follow');
    } else {
      if (link) link.remove(); // omit canonical on a 404 (finding 12) or secure /soa page
      upsertMeta('name', 'robots', isSoa ? 'noindex, nofollow' : 'noindex, follow');
    }

    // Sawil 2026-07-27 ES ROUTES (SEO) — hreflang cluster per content page:
    // en → English URL, es → /es twin, x-default → English URL. Stale tags from
    // the previous route are removed first so the set stays exact on SPA
    // navigation (same idempotent pattern as canonical/robots above).
    document.head.querySelectorAll('link[rel="alternate"][hreflang]').forEach((el) => el.remove());
    if (isKnownRoute) {
      const enUrl = SITE + basePath;
      const esUrl = SITE + toSpanishPath(basePath);
      const alternates: Array<[string, string]> = [['en', enUrl], ['es', esUrl], ['x-default', enUrl]];
      alternates.forEach(([hreflang, href]) => {
        const alt = document.createElement('link');
        alt.setAttribute('rel', 'alternate');
        alt.setAttribute('hreflang', hreflang);
        alt.setAttribute('href', href);
        document.head.appendChild(alt);
      });
    }

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
