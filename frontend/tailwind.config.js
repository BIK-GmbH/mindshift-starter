/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          900: "#0b0d12",
          800: "#11141b",
          700: "#1a1f2a",
          600: "#262d3a",
          500: "#384155",
          400: "#5a6478",
          300: "#8b94a8",
          200: "#c2c8d6",
          100: "#e6e9f0",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
      },
    },
  },
  plugins: [],
};
