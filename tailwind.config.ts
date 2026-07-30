import type { Config } from "tailwindcss";

/**
 * Airwright design system — strictly monochrome, light mode.
 * No colour. One near-black ink, a three-step neutral surface ladder,
 * hairline borders (no shadows). Tokens are CSS variables (see globals.css)
 * so the palette stays in one place.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--canvas)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        ink: "var(--ink)",
        "ink-muted": "var(--ink-muted)",
        "ink-subtle": "var(--ink-subtle)",
        hairline: "var(--hairline)",
        "hairline-strong": "var(--hairline-strong)",
      },
      fontFamily: {
        sans: ["var(--font-manrope)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        sm: "6px",
        DEFAULT: "8px",
        md: "8px",
        lg: "12px",
      },
      letterSpacing: {
        tight: "-0.01em",
        tighter: "-0.02em",
      },
      maxWidth: {
        content: "1180px",
      },
    },
  },
  plugins: [],
};

export default config;
