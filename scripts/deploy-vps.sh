#!/usr/bin/env bash
#
# Kirim keadaan lokal ke VPS produksi, bangun ulang kontainer, lalu VERIFIKASI.
#
# Dibuat karena berulang kali perbaikan sudah beres di lokal tapi adexto.xyz
# masih menyajikan build lama, sehingga bug yang "sudah diperbaiki" tetap terlihat
# oleh pengguna. Satu perintah menutup jarak itu.
#
# Pakai:  bash scripts/deploy-vps.sh
#
# CATATAN PENTING:
#   - `.env.local` TIDAK dikirim (ada di .rsyncignore). Env produksi hidup di VPS
#     dan sengaja tidak ditimpa dari mesin pengembang.
#   - Nilai NEXT_PUBLIC_* ter-inline saat `next build`, dan build terjadi DI DALAM
#     image. Karena itu mengubah env di VPS WAJIB diikuti build ulang, bukan
#     sekadar restart kontainer.
#   - Jalankan hanya setelah perubahan lulus uji lokal. Skrip ini menyalin apa
#     adanya; ia tidak menilai benar atau salah.

set -euo pipefail

HOST="${ADEXTO_VPS_HOST:-root@168.144.249.185}"
KEY="${ADEXTO_VPS_KEY:-/home/cucu/.ssh/id_ed25519}"
REMOTE_DIR="${ADEXTO_VPS_DIR:-/root/adexto}"
LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUBLIC_URL="${ADEXTO_PUBLIC_URL:-https://adexto.xyz}"

SSH=(ssh -i "$KEY" -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new)

echo "==> 1/4 kirim berkas ke $HOST:$REMOTE_DIR"
rsync -rlptvz --exclude-from="$LOCAL_DIR/.rsyncignore" \
  -e "ssh -i $KEY -o ConnectTimeout=20" \
  "$LOCAL_DIR/" "$HOST:$REMOTE_DIR/" | tail -3

echo "==> 2/4 build image"
"${SSH[@]}" "$HOST" "cd $REMOTE_DIR && set -a && . ./.env.local && set +a && docker compose build" 2>&1 | tail -4

echo "==> 3/4 jalankan kontainer baru"
"${SSH[@]}" "$HOST" "cd $REMOTE_DIR && set -a && . ./.env.local && set +a && docker compose up -d" 2>&1 | tail -3
"${SSH[@]}" "$HOST" "docker compose -f $REMOTE_DIR/docker-compose.yml ps | tail -2"

echo "==> 4/4 verifikasi rute publik"
# Kontainer butuh sedikit waktu sebelum sehat; exit code nol dari `up -d` bukan
# bukti situsnya menyajikan apa pun.
fail=0
# Tunggu sampai benar-benar melayani, bukan menebak dengan satu `sleep`. Kontainer
# baru saja dibuat ulang, jadi permintaan pertama bisa mengenai proses yang masih
# naik dan itu bukan kegagalan deploy.
printf '  menunggu kontainer melayani'
for i in $(seq 1 30); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$PUBLIC_URL/" || echo 000)" = "200" ]; then
    printf ' siap setelah %ss\n' "$((i * 2))"
    break
  fi
  printf '.'
  sleep 2
  [ "$i" -eq 30 ] && { printf ' TIDAK PERNAH SIAP\n'; fail=1; }
done

for r in / /studio /swap /explorer /docs /pitch /whitepaper /governance; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 30 "$PUBLIC_URL$r" || echo 000)
  printf '  %-13s HTTP %s\n' "$r" "$code"
  [ "$code" = "200" ] || fail=1
done

# Kosakata generasi lama tidak boleh muncul lagi di permukaan publik.
#
# `|| true` WAJIB di sini. Dengan `set -e` dan `pipefail`, `grep` yang tidak
# menemukan apa pun keluar dengan status 1 dan mematikan skrip — artinya kasus
# BERSIH justru dilaporkan sebagai kegagalan deploy. Itu sempat terjadi.
stale=$(curl -s -m 30 "$PUBLIC_URL/" | grep -oiE 'Uniswap|BaseHook|seed liquidity|100% Fee Retained' | sort -u | tr '\n' ' ' || true)
if [ -n "$stale" ]; then
  echo "  PERINGATAN copy usang masih tersaji: $stale"
  fail=1
else
  echo "  copy: BERSIH"
fi

# Penjaga konsistensi: klaim statis vs fakta yang bisa dibaca.
#
# Pemeriksaan copy di atas melarang kosakata tetap. Yang TIDAK bisa ditangkapnya
# adalah kelas bug yang paling sering terjadi di proyek ini: pernyataan yang dulu
# benar lalu diam-diam berhenti benar ketika fakta yang dirujuknya berubah. README
# menandai factory 0.9.0 sebagai "current" berbulan-bulan setelah 0.10.0 hidup;
# /swap memberi tahu pengunjung factory belum di-broadcast setelah ia hidup di empat
# mainnet. Keduanya lolos build, lolos tes, dan lolos pemeriksaan copy di atas.
#
# audit_consistency.mjs membandingkan teks dengan chain, .env.local dan kode. Uji
# mandirinya menyuntikkan ulang enam regresi sejarah dan menangkap keenamnya.
#
# `|| fail=1` mengikuti pola yang sama seperti grep di atas: dengan `set -e`, exit
# bukan-nol dari node akan mematikan skrip sebelum ringkasan tercetak.
echo "==> penjaga konsistensi klaim"
if BASE_URL="$PUBLIC_URL" node audit_consistency.mjs; then
  :
else
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "==> SELESAI DENGAN MASALAH — periksa keluaran di atas"
  exit 1
fi
echo "==> PRODUKSI SINKRON DENGAN LOKAL"
