import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        brand: {
          50: "#eef5ff",
          100: "#d9e8ff",
          500: "#2563eb",
          600: "#1d4ed8",
          700: "#1e40af",
          900: "#0f1d3d",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
