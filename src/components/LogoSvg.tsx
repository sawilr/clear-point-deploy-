import { useId } from 'react';

export function LogoSvg({ size = 42 }: { size?: number }) {
  // Sawil 2026-06-30 SECURITY HOTFIX (a11y finding 24) — this logo renders more
  // than once per page (Header + Footer), so hardcoded gradient ids ("ng"/"gg")
  // produced DUPLICATE element ids in the DOM. That's invalid HTML and browsers
  // resolve url(#ng) to the first match, so the second logo can render with the
  // wrong gradient. useId() gives each instance a unique, stable id.
  const uid = useId();
  const ringId = `lg-ring-${uid}`;
  const goldId = `lg-gold-${uid}`;
  return (
    <svg width={size} height={size} viewBox="0 0 54 54" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={ringId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6E7F62"/>
          <stop offset="100%" stopColor="#4A3A2E"/>
        </linearGradient>
        <linearGradient id={goldId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#D0B27A"/>
          <stop offset="100%" stopColor="#B8956A"/>
        </linearGradient>
      </defs>
      <circle cx="27" cy="27" r="26" fill={`url(#${ringId})`} stroke={`url(#${goldId})`} strokeWidth="1.2"/>
      <path d="M27 8L30.5 23.5L46 27L30.5 30.5L27 46L23.5 30.5L8 27L23.5 23.5Z" fill={`url(#${goldId})`} opacity="0.9"/>
      <circle cx="27" cy="27" r="3.5" fill="white"/>
      <circle cx="27" cy="27" r="19" stroke="rgba(208,178,122,0.25)" strokeWidth="0.8" fill="none"/>
    </svg>
  );
}
