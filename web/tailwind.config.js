/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#070a10", 900: "#0b1019", 850: "#0f1622", 800: "#141c2b", 700: "#1d2738", 600: "#2a3649" },
        win: { DEFAULT: "#34d399", dim: "#065f46" },
        draw: "#94a3b8",
        lose: "#60a5fa",
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"] },
    },
  },
  plugins: [],
};
