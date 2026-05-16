export function LogoSvg({ size = 42 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 54 54" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="ng" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6E7F62"/>
          <stop offset="100%" stopColor="#4A3A2E"/>
        </linearGradient>
        <linearGradient id="gg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#D0B27A"/>
          <stop offset="100%" stopColor="#B8956A"/>
        </linearGradient>
      </defs>
      <circle cx="27" cy="27" r="26" fill="url(#ng)" stroke="url(#gg)" strokeWidth="1.2"/>
      <path d="M27 8L30.5 23.5L46 27L30.5 30.5L27 46L23.5 30.5L8 27L23.5 23.5Z" fill="url(#gg)" opacity="0.9"/>
      <circle cx="27" cy="27" r="3.5" fill="white"/>
      <circle cx="27" cy="27" r="19" stroke="rgba(208,178,122,0.25)" strokeWidth="0.8" fill="none"/>
    </svg>
  );
}
