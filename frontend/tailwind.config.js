/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#fff7ed",
          100: "#ffedd5",
          200: "#fed7aa",
          300: "#fdba74",
          400: "#fb923c",
          500: "#e87522",
          600: "#c9611b",
          700: "#9f4a17",
          800: "#7c3d17",
          900: "#163555",
          950: "#0b1f35",
        },
      },
    },
  },
  plugins: [],
};
