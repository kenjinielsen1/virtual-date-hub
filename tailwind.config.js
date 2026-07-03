/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Body defaults to a warm, letter-like serif.
        sans: ['Lora', 'Georgia', 'serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
        script: ['Caveat', 'cursive'],
      },
      colors: {
        cream: '#f7f1e3', // page (aged paper)
        paper: '#fdfaf2', // cards (fresh ivory)
        ink: '#2b2320', // text
        // stamp red
        seal: {
          50: '#faf1ef',
          100: '#f4ded9',
          200: '#e7bcb4',
          300: '#d7968b',
          400: '#c46d5f',
          500: '#b0413e',
          600: '#8f322f',
          700: '#6f2725',
        },
        // gold / brass
        gold: {
          50: '#faf5e8',
          100: '#f3e9cc',
          200: '#e7d29b',
          300: '#d9b967',
          400: '#cca544',
          500: '#b98f38',
          600: '#96712b',
          700: '#725623',
        },
      },
    },
  },
  plugins: [],
}
