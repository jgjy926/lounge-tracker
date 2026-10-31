/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Shared with the app icon (scripts/make-icons.py).
        night: { 950: '#071C2F', 900: '#0B2A44', 800: '#123B5C', 700: '#1B5078' },
        brass: { 600: '#B9831F', 500: '#D9A441', 400: '#F0C462', 100: '#FBF0D5' },
      },
    },
  },
  plugins: [],
}
