/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      borderRadius: {
        xl: '1rem',
        '2xl': '1.5rem',
        '3xl': '2rem',
      },
      colors: {
        // Keep current palette aligned with existing dashboard
        nexus: {
          sidebar: '#0F172A',
          bg: '#F8FAFC',
        },
      },
      boxShadow: {
        'nexus-blue': '0 10px 15px -3px rgba(37, 99, 235, 0.3)',
      },
    },
  },
  plugins: [],
}
