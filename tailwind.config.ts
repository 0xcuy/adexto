import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  // Tema dikendalikan atribut <html data-theme>, bukan kelas. Varian `dark:` diarahkan ke
  // atribut yang sama supaya kalau suatu saat dibutuhkan, ia membaca sumber yang sama.
  darkMode: ["selector", '[data-theme="dark"]'],
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
        /** Permukaan kartu. Pengganti `bg-white` literal yang tidak bisa ikut tema. */
        surface: "rgb(var(--surface-2-rgb) / <alpha-value>)",
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
      /**
       * Isian aksen dipisah dari warna teks aksen.
       *
       * `bg-accent` memakai --accent-fill, `text-accent`/`border-accent` memakai --accent.
       * Di tema terang keduanya sama (#7c3aed). Di tema gelap violet yang terbaca sebagai
       * TEKS di atas latar gelap (#a07bff) terlalu terang untuk memikul tulisan putih
       * (3,1:1), sementara isian #7c3aed memikulnya 5,7:1. Memisahkannya di sini berarti
       * tidak ada satu pun komponen yang perlu tahu bahwa ada dua tema.
       */
      backgroundColor: {
        accent: {
          DEFAULT: "rgb(var(--accent-fill-rgb) / <alpha-value>)",
          strong: "rgb(var(--accent-fill-strong-rgb) / <alpha-value>)",
          soft: "rgb(var(--accent-rgb) / 0.1)",
        },
        // Alasan yang sama untuk warna status: hijau/amber/merah yang terbaca sebagai TEKS di
        // tema gelap terlalu terang untuk isian tombol bertulisan putih ("Connect wallet to
        // trade", Buy, Sell). Tint tipis (`bg-ok/10`) tetap memakai kanal isian ini.
        ok: "rgb(var(--ok-fill-rgb) / <alpha-value>)",
        warn: "rgb(var(--warn-fill-rgb) / <alpha-value>)",
        danger: "rgb(var(--danger-fill-rgb) / <alpha-value>)",
      },
      fontFamily: {
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "var(--r-card)",
        panel: "var(--r-panel)",
      },
      transitionTimingFunction: {
        settle: "cubic-bezier(0.22, 1, 0.36, 1)",
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
