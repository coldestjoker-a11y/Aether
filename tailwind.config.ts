import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        vault: {
          bg: "#07090E",
          card: "rgba(17, 22, 34, 0.78)",
          border: "rgba(255, 255, 255, 0.08)",
          accent: "#6366F1",
          emerald: "#10B981",
          danger: "#EF4444",
          warning: "#F59E0B"
        }
      },
      backdropBlur: {
        xs: "2px",
      }
    },
  },
  plugins: [],
};
export default config;
