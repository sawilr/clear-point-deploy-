/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  // Sawil 2026-06 enterprise interaction fix — THE root cause of "el botón
  // salta y se queda disparado al tocar". Without this flag every `hover:`
  // utility (scale, -translate-y, shadow, bg) STICKS on touch devices: the
  // tap triggers :hover and it stays applied until you tap elsewhere, so the
  // button looks launched/broken. hoverOnlyWhenSupported wraps all hover
  // styles in `@media (hover: hover)`, so they only fire for real pointers
  // (mouse/trackpad). Phones, tablets and touch-TVs no longer get stuck
  // hover. Desktop behavior is unchanged. One line, fixes it site-wide.
  future: {
    hoverOnlyWhenSupported: true,
  },
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Sawil 2026-06 enterprise responsive: add a custom small breakpoint
      // for 400+ px phones (Hero.tsx had `xs:` which Tailwind didn't define),
      // and a `3xl` for 1920+ monitors / TVs so we can widen containers
      // without leaving 700+ px dead margin on 2560 displays.
      screens: {
        xs: '400px',
        '3xl': '1920px',
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        cream: {
          50: '#FDF8F0',
          100: '#F5EFE6',
          200: '#EDE4D6',
          300: '#E0D4C4',
          400: '#C9B9A5',
        },
        earth: {
          50: '#F7F3EE',
          100: '#EDE6DC',
          200: '#DDD0C0',
          300: '#C9B9A5',
          400: '#B89A7A',
          500: '#A68360',
          600: '#8A6B4E',
          700: '#6B5340',
          800: '#4A3A2E',
          900: '#2D2A26',
        },
        sage: {
          50: '#F4F7F2',
          100: '#E4EBE0',
          200: '#C8D6C0',
          300: '#A3BC97',
          400: '#8A9A7B',
          500: '#6E7F62',
        },
        gold: {
          50: '#FAF5ED',
          100: '#F0E4D0',
          200: '#E0CBA5',
          300: '#D0B27A',
          400: '#B8956A',
          500: '#9A7A52',
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      fontFamily: {
        serif: ['Playfair Display', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        xs: "calc(var(--radius) - 6px)",
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        soft: "0 4px 24px rgba(45, 42, 38, 0.06)",
        card: "0 8px 40px rgba(45, 42, 38, 0.08)",
        lifted: "0 16px 56px rgba(45, 42, 38, 0.12)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "caret-blink": {
          "0%,70%,100%": { opacity: "1" },
          "20%,50%": { opacity: "0" },
        },
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(24px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "slide-in-right": {
          "0%": { opacity: "0", transform: "translateX(20px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "caret-blink": "caret-blink 1.25s ease-out infinite",
        "fade-in-up": "fade-in-up 0.7s ease-out forwards",
        "fade-in": "fade-in 0.5s ease-out forwards",
        "slide-in-right": "slide-in-right 0.5s ease-out forwards",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
