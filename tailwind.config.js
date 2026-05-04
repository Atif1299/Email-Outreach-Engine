/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'sans-serif'],
      },
      colors: {
        canvas: '#0B0B0C',
        surface: {
          DEFAULT: '#111113',
          raised: '#151518',
        },
        edge: '#232326',
        ink: {
          DEFAULT: '#EDEDED',
          muted: '#A1A1AA',
          faint: '#6B6B73',
        },
        accent: {
          DEFAULT: '#5B8DEF',
          hover: '#6E9CF0',
          subtle: 'rgba(91, 141, 239, 0.14)',
        },
        danger: {
          DEFAULT: '#b45353',
          muted: 'rgba(180, 83, 83, 0.25)',
        },
      },
      borderRadius: {
        card: '10px',
      },
      maxWidth: {
        content: '72rem',
      },
      transitionDuration: {
        DEFAULT: '150ms',
      },
    },
  },
  plugins: [],
}
