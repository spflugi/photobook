import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Single monochromatic dark palette — all UI built on this
        zinc: {
          925: "#111111",
          950: "#0a0a0a",
        },
      },
    },
  },
  plugins: [],
};

export default config;
