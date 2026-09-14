# Indexer Monad, dijalankan sebagai layanan bukan sebagai perintah di laptop.
#
# `bookworm-slim` dan bukan `alpine`: paket `envio` memuat addon native `.node`, dan
# varian yang terpasang di lockfile ini `envio-linux-x64` (glibc). Ada varian musl, tapi
# memilih basis yang cocok dengan lockfile menghindari `npm ci` diam-diam mengambil biner
# berbeda dari yang diuji.
FROM node:22-bookworm-slim

WORKDIR /app

# Lapisan dependensi dipisah supaya perubahan handler tidak memicu install ulang.
COPY package.json package-lock.json ./
RUN npm ci

# `config.yaml`, `schema.graphql`, `abis/` dan `src/` — semuanya dibutuhkan saat runtime,
# bukan hanya saat build: `envio start` menjalankan codegen lebih dulu, lalu memuat handler
# dari `src/handlers/` saat proses hidup.
COPY . .

# Codegen dijalankan saat build supaya kegagalan skema muncul di sini, bukan setengah menit
# setelah container hidup di produksi.
RUN npx envio codegen

# Log ke stdout, bukan ke berkas: di container yang membacanya adalah `docker logs`, dan
# menulis ke ./logs berarti log hilang bersama container.
ENV ENVIO_TUI=false
ENV LOG_STRATEGY=console-pretty

CMD ["npx", "envio", "start"]
