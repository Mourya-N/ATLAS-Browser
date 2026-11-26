/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{html,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        atlas: {
          bg: 'rgb(var(--atlas-bg) / <alpha-value>)',
          shell: 'rgb(var(--atlas-shell) / <alpha-value>)',
          surface: 'rgb(var(--atlas-surface) / <alpha-value>)',
          elevated: 'rgb(var(--atlas-elevated) / <alpha-value>)',
          hover: 'rgb(var(--atlas-hover) / <alpha-value>)',
          border: 'rgb(var(--atlas-border) / <alpha-value>)',
          'border-strong': 'rgb(var(--atlas-border-strong) / <alpha-value>)',
          text: 'rgb(var(--atlas-text) / <alpha-value>)',
          secondary: 'rgb(var(--atlas-secondary) / <alpha-value>)',
          muted: 'rgb(var(--atlas-muted) / <alpha-value>)',
          accent: 'rgb(var(--atlas-accent) / <alpha-value>)',
          'accent-fg': 'rgb(var(--atlas-accent-fg) / <alpha-value>)',
          danger: 'rgb(var(--atlas-danger) / <alpha-value>)',
          warning: 'rgb(var(--atlas-warning) / <alpha-value>)',
          success: 'rgb(var(--atlas-success) / <alpha-value>)'
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
        'atlas-sm': 'var(--atlas-shadow-sm)',
        'atlas-tab': 'var(--atlas-shadow-tab)',
        'atlas-float': 'var(--atlas-shadow-float)'
      },
      transitionTimingFunction: {
        atlas: 'cubic-bezier(0.2, 0, 0, 1)'
      }
    }
  },
  plugins: []
};
