import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '1rem' },
    extend: {
      colors: {
        bg: v('bg'),
        panel: v('panel'),
        'panel-2': v('panel-2'),
        border: v('border'),
        text: v('text'),
        muted: v('muted'),
        accent: { DEFAULT: v('accent'), foreground: v('accent-fg') },
        info: v('info'),
        up: v('up'),
        down: v('down'),
        warn: v('warn'),
        ring: v('info'),
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: { lg: '10px', md: '8px', sm: '6px' },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: { shimmer: 'shimmer 1.5s infinite' },
    },
  },
  plugins: [animate],
};
export default config;
