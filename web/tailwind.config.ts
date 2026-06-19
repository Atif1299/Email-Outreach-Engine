import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        chrome: '#141418',
        'chrome-line': '#2a2a32',
        page: '#0a0a0e',
        card: '#14141a',
        dim: '#9b9bab',
        accent: '#3b82f6',
        'accent-bright': '#60a5fa',
      },
    },
  },
  plugins: [],
}
export default config
