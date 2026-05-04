/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#0f1419',
          elevated: '#161b22',
          muted: '#1c2128',
        },
        border: {
          subtle: 'rgba(148, 163, 184, 0.12)',
          DEFAULT: 'rgba(148, 163, 184, 0.18)',
        },
        accent: {
          DEFAULT: '#e11d48',
          hover: '#f43f5e',
          muted: 'rgba(225, 29, 72, 0.15)',
        },
      },
      borderRadius: {
        xl: '14px',
        '2xl': '18px',
      },
      maxWidth: {
        wizard: '1040px',
      },
    },
  },
  plugins: [],
}
