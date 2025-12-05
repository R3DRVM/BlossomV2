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
          pink: '#FF6BA0',
          pinkSoft: '#FFE4F0',
          pinkLight: '#FFF0F8',
          ink: '#111827',
          slate: '#6B7280',
          surface: '#F7F5FA',
          outline: '#E5E7EB',
          success: '#16A34A',
          warning: '#FBBF24',
          danger: '#EF4444',
        },
      },
    },
  },
  plugins: [],
}

