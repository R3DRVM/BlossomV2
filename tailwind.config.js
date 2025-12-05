/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        blossom: {
          pink: '#FF6FB5',
          pinkSoft: '#FFE6F3',
          pinkLight: '#FFF0F8',
          ink: '#111827',
          slate: '#6B7280',
          surface: '#F9FAFB',
          outline: '#E5E7EB',
          success: '#16A34A',
          warning: '#FACC15',
          danger: '#EF4444',
        },
      },
    },
  },
  plugins: [],
}

