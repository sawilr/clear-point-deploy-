import { CustomerServiceBot } from '../components/CustomerServiceBot';

export default function Support() {
  // Sawil 2026-06 — /support is now a NORMAL page, not a full-screen modal
  // takeover. The site Header stays sticky and tappable above Clara, the page
  // is no longer scroll-locked, and Clara renders as the page's main panel
  // (see CustomerServiceBot mode="page"). The previous body-scroll-lock +
  // visualViewport reset existed ONLY to tame iOS on a position:fixed overlay;
  // with Clara back in normal document flow there is no fixed shell for iOS to
  // drag, so the soft keyboard behaves natively and nothing traps the user.
  return <CustomerServiceBot mode="page" />;
}
