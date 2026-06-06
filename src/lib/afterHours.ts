// ─────────────────────────────────────────────────────────────────────────────
// PHASE 9E — After-hours detection + senior-friendly callback messaging.
//
// Office hours: Monday–Friday 9am–6pm ET.
// Returns a structured status both bots can use to:
//   - Skip "call now" CTAs outside hours (calls would go to voicemail)
//   - Offer callback scheduling instead
//   - Use the right warm-greeting for time of day
// ─────────────────────────────────────────────────────────────────────────────

export interface OfficeStatus {
  isOpen: boolean;
  nextOpenLabel: string; // "tomorrow at 9am ET" / "Monday at 9am ET"
  greetingEn: string;    // "Good morning" / "Good afternoon" / "Good evening"
  greetingEs: string;
  ctaLabelEn: string;    // "Call now" or "Schedule callback"
  ctaLabelEs: string;
}

function getEtNow(): Date {
  // Convert to America/New_York timezone via Intl. Returns a Date snapped to ET wall-clock.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '0';
  return new Date(
    Number(get('year')),
    Number(get('month')) - 1,
    Number(get('day')),
    Number(get('hour')),
    Number(get('minute')),
    Number(get('second')),
  );
}

export function getOfficeStatus(now: Date = getEtNow()): OfficeStatus {
  const dow = now.getDay(); // 0 Sun, 1 Mon, ..., 6 Sat
  const hour = now.getHours();
  const isWeekday = dow >= 1 && dow <= 5;
  const isOpen = isWeekday && hour >= 9 && hour < 18;

  let nextOpenLabel: string;
  if (isOpen) {
    nextOpenLabel = 'now';
  } else if (isWeekday && hour < 9) {
    nextOpenLabel = 'today at 9am ET';
  } else if (dow === 5 && hour >= 18) {
    nextOpenLabel = 'Monday at 9am ET';
  } else if (dow === 6) {
    nextOpenLabel = 'Monday at 9am ET';
  } else if (dow === 0) {
    nextOpenLabel = 'Monday at 9am ET';
  } else {
    nextOpenLabel = 'tomorrow at 9am ET';
  }

  const greetingEn =
    hour < 12 ? 'Good morning' :
    hour < 18 ? 'Good afternoon' :
    'Good evening';
  const greetingEs =
    hour < 12 ? 'Buenos días' :
    hour < 18 ? 'Buenas tardes' :
    'Buenas noches';

  return {
    isOpen,
    nextOpenLabel,
    greetingEn,
    greetingEs,
    ctaLabelEn: isOpen ? 'Call now — 1-866-310-8702' : 'Schedule callback',
    ctaLabelEs: isOpen ? 'Llamar ahora — 1-866-310-8702' : 'Programar llamada',
  };
}
