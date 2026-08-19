import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        /**
         * Warna semantik palet cream.
         *
         * Dipakai supaya pembalikan tema terjadi lewat NAMA, bukan lewat hex yang
         * tersebar di ~1.270 tempat. Kalau nanti palet digeser lagi, yang berubah
         * hanya token di globals.css — bukan setiap komponen.
         *
         * Perhatikan hanya ada SATU aksen. Sebelumnya ada enam warna hiasan, dan
         * akibatnya tidak ada warna tersisa untuk menandakan keadaan. Sekarang
         * ok/warn/danger dipesan khusus untuk status sungguhan.
         */
        cream: {
          DEFAULT: "rgb(var(--cream-rgb) / <alpha-value>)",
          2: "rgb(var(--cream-2-rgb) / <alpha-value>)",
          3: "rgb(var(--cream-3-rgb) / <alpha-value>)",
        },
        ink: {
          DEFAULT: "rgb(var(--ink-rgb) / <alpha-value>)",
          soft: "rgb(var(--ink-soft-rgb) / <alpha-value>)",
          faint: "rgb(var(--ink-faint-rgb) / <alpha-value>)",
        },
        line: {
          DEFAULT: "rgb(var(--line-rgb) / <alpha-value>)",
          strong: "rgb(var(--line-strong-rgb) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--accent-rgb) / <alpha-value>)",
          strong: "rgb(var(--accent-strong-rgb) / <alpha-value>)",
          soft: "rgb(var(--accent-rgb) / 0.1)",
        },
        ok: "rgb(var(--ok-rgb) / <alpha-value>)",
        warn: "rgb(var(--warn-rgb) / <alpha-value>)",
        danger: "rgb(var(--danger-rgb) / <alpha-value>)",
        primary: {
          50: "#f5f3ff",
          100: "#ede9fe",
          200: "#ddd6fe",
          300: "#c4b5fd",
          400: "#a78bfa",
          500: "#8b5cf6",
          600: "#7c3aed",
          700: "#6d28d9",
          800: "#5b21b6",
          900: "#4c1d95",
        },
        cyber: {
          dark: "#07080d",
          card: "#0f111a",
          border: "#1e2235",
          cyan: "#00f5ff",
          purple: "#9d4edd",
          emerald: "#10b981",
        }
      },
      fontFamily: {
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      animation: {
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float': 'float 6s ease-in-out infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        glow: {
          '0%': { boxShadow: '0 0 15px rgba(124, 58, 237, 0.3)' },
          '100%': { boxShadow: '0 0 35px rgba(0, 245, 255, 0.6)' },
        }
      }
    },
  },
  plugins: [],
} satisfies Config;
