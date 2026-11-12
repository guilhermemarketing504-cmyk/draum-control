import type { Config } from "tailwindcss";

// Tokens da identidade visual DRAUM (Prancha visual · Rota 01 — O Vão)
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        mineral: "#252624",   // Preto Mineral
        grafite: "#3B3B38",   // Grafite
        espresso: "#584F49",  // Espresso
        stone: "#A89C8B",     // Stone
        sand: "#D8CFC2",      // Sand
        offwhite: "#F3F0E8",  // Off-white
        // derivados para interface (mesma família, contraste AA)
        paper: "#FBFAF6",
        line: "#E3DDD2",
        muted: "#7A7067",
        // estados (sempre acompanhados de rótulo)
        ok: "#4F5E45",
        warn: "#8F5B24",
        crit: "#8B3A2F",
      },
      fontFamily: {
        display: ['"Archivo Variable"', "Archivo", "system-ui", "sans-serif"],
        sans: ['"Inter Variable"', "Inter", "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
      borderRadius: { DEFAULT: "2px", md: "3px" },
    },
  },
  plugins: [],
} satisfies Config;
