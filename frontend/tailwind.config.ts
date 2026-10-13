import type { Config } from "tailwindcss";

// Colours come from CSS variables in src/styles/globals.css, written as RGB
// channels so Tailwind's opacity modifiers (bg-ink/10) keep working.
const token = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: token("ink"),
        gold: token("gold"),
        paper: token("paper"),
        card: token("card"),
        mint: token("mint"),
        sky: token("sky"),
        blush: token("blush"),
        rose: token("rose"),
        muted: token("muted"),
        line: token("line"),
      },
      fontFamily: {
        display: ["var(--font-display)"],
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      borderRadius: {
        button: "6px",
        card: "12px",
      },
    },
  },
  plugins: [],
};
export default config;
