/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{html,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        atlas: {
          bg: 'rgb(var(--atlas-bg) / <alpha-value>)',
          surface: 'rgb(var(--atlas-surface) / <alpha-value>)',
          elevated: 'rgb(var(--atlas-elevated) / <alpha-value>)',
          border: 'rgb(var(--atlas-border) / <alpha-value>)',
          text: 'rgb(var(--atlas-text) / <alpha-value>)',
          muted: 'rgb(var(--atlas-muted) / <alpha-value>)',
          accent: 'rgb(var(--atlas-accent) / <alpha-value>)',
          danger: 'rgb(var(--atlas-danger) / <alpha-value>)',
          warning: 'rgb(var(--atlas-warning) / <alpha-value>)',
          success: 'rgb(var(--atlas-success) / <alpha-value>)'
        }
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['SF Mono', 'JetBrains Mono', 'Fira Code', 'monospace']
      }
    }
  },
  plugins: []
};
