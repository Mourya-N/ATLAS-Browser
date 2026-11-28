/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{html,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        lavray: {
          bg: 'rgb(var(--lavray-bg) / <alpha-value>)',
          shell: 'rgb(var(--lavray-shell) / <alpha-value>)',
          surface: 'rgb(var(--lavray-surface) / <alpha-value>)',
          elevated: 'rgb(var(--lavray-elevated) / <alpha-value>)',
          hover: 'rgb(var(--lavray-hover) / <alpha-value>)',
          border: 'rgb(var(--lavray-border) / <alpha-value>)',
          'border-strong': 'rgb(var(--lavray-border-strong) / <alpha-value>)',
          text: 'rgb(var(--lavray-text) / <alpha-value>)',
          secondary: 'rgb(var(--lavray-secondary) / <alpha-value>)',
          muted: 'rgb(var(--lavray-muted) / <alpha-value>)',
          accent: 'rgb(var(--lavray-accent) / <alpha-value>)',
          'accent-fg': 'rgb(var(--lavray-accent-fg) / <alpha-value>)',
          danger: 'rgb(var(--lavray-danger) / <alpha-value>)',
          warning: 'rgb(var(--lavray-warning) / <alpha-value>)',
          success: 'rgb(var(--lavray-success) / <alpha-value>)'
        }
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          'Inter',
          '"Segoe UI"',
          'Roboto',
          'sans-serif'
        ],
        serif: ['"New York"', 'Georgia', 'Cambria', '"Times New Roman"', 'serif'],
        mono: ['"SF Mono"', '"JetBrains Mono"', '"Fira Code"', 'ui-monospace', 'monospace']
      },
      boxShadow: {
        'lavray-sm': 'var(--lavray-shadow-sm)',
        'lavray-tab': 'var(--lavray-shadow-tab)',
        'lavray-float': 'var(--lavray-shadow-float)'
      },
      transitionTimingFunction: {
        lavray: 'cubic-bezier(0.2, 0, 0, 1)'
      }
    }
  },
  plugins: []
};
