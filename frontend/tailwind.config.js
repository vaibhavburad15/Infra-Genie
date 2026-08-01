/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f0f4ff",
          100: "#dce6ff",
          200: "#b9ccff",
          300: "#87a8ff",
          400: "#5279ff",
          500: "#2b4fff",
          600: "#1a35e6",
          700: "#1528b8",
          800: "#162395",
          900: "#172177",
        },
      },
    },
  },
  plugins: [],
};
