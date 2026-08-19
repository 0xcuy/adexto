#!/usr/bin/env bash
#
# Pembalikan palet gelap -> cream, mekanis dan bisa diulang.
#
# KENAPA MEKANIS
#
# Ada sekitar 1.270 kemunculan kelas khusus-gelap di 19 berkas. Menyuntingnya satu
# per satu bukan hanya lambat, tapi rawan: satu `text-white` yang terlewat menjadi
# teks putih di atas cream, dan itu tidak terlihat sampai halaman itu dibuka.
# Pemetaan di sini bekerja per NAMA warna semantik yang didefinisikan di
# tailwind.config, jadi pergeseran palet berikutnya hanya menyentuh token.
#
# MURNI PRESENTASI. Tidak ada nama fungsi, kondisi, atau alur yang disentuh —
# hanya nilai className. Jalankan `git diff --stat` sesudahnya untuk memastikan
# perubahan hanya di berkas tampilan.
#
# Pakai: bash scripts/repalette-to-cream.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
FILES=$(git ls-files 'src/**/*.tsx')

# Urutan PENTING: pola paling spesifik lebih dulu, kalau tidak pola umum akan
# memakannya. Contoh: `border-white/10` harus diganti sebelum `text-white`.
apply() {
  # shellcheck disable=SC2086
  sed -i "$1" $FILES
}

echo "==> teks"
# Putih murni jadi tinta. Ini penggantian paling banyak dan paling menentukan.
apply 's/text-white\b/text-ink/g'
# Abu-abu terang tema gelap -> tinta lembut/pudar. Semakin tinggi angkanya di tema
# gelap, semakin redup; di tema terang urutannya dibalik.
apply 's/text-zinc-\(50\|100\|200\)\b/text-ink/g'
apply 's/text-zinc-\(300\|400\)\b/text-ink-soft/g'
apply 's/text-zinc-\(500\|600\|700\)\b/text-ink-faint/g'
apply 's/text-slate-\(50\|100\|200\)\b/text-ink/g'
apply 's/text-slate-\(300\|400\)\b/text-ink-soft/g'
apply 's/text-slate-\(500\|600\)\b/text-ink-faint/g'

echo "==> aksen dikumpulkan jadi SATU"
# Cyan, ungu, dan pink semuanya jadi satu aksen. Inilah inti perbaikannya: tiga
# warna hiasan yang bersaing membuat halaman terbaca seperti proyek memecoin.
for c in cyan purple pink violet fuchsia sky indigo blue; do
  apply "s/text-${c}-[0-9]\{3\}\b/text-accent/g"
  apply "s/border-${c}-[0-9]\{3\}\(\/[0-9]\{1,3\}\)\?/border-accent\/30/g"
  apply "s/bg-${c}-[0-9]\{3\}\(\/[0-9]\{1,3\}\)\?/bg-accent-soft/g"
  apply "s/from-${c}-[0-9]\{3\}/from-accent/g"
  apply "s/via-${c}-[0-9]\{3\}/via-accent/g"
  apply "s/to-${c}-[0-9]\{3\}/to-accent/g"
  apply "s/shadow-${c}-[0-9]\{3\}\(\/[0-9]\{1,3\}\)\?/shadow-accent\/10/g"
done

echo "==> warna keadaan dipesan khusus untuk status"
# Hijau/amber/merah TIDAK dikumpulkan: ketiganya menandakan keadaan sungguhan.
# Tapi nadanya harus digelapkan, karena emerald-400 di atas cream tidak terbaca.
apply 's/text-\(emerald\|green\)-[0-9]\{3\}\b/text-ok/g'
apply 's/text-\(amber\|orange\|yellow\)-[0-9]\{3\}\b/text-warn/g'
apply 's/text-\(red\|rose\)-[0-9]\{3\}\b/text-danger/g'
for c in emerald green; do
  apply "s/border-${c}-[0-9]\{3\}\(\/[0-9]\{1,3\}\)\?/border-ok\/30/g"
  apply "s/bg-${c}-[0-9]\{3\}\(\/[0-9]\{1,3\}\)\?/bg-ok\/10/g"
done
for c in amber orange yellow; do
  apply "s/border-${c}-[0-9]\{3\}\(\/[0-9]\{1,3\}\)\?/border-warn\/30/g"
  apply "s/bg-${c}-[0-9]\{3\}\(\/[0-9]\{1,3\}\)\?/bg-warn\/10/g"
done
for c in red rose; do
  apply "s/border-${c}-[0-9]\{3\}\(\/[0-9]\{1,3\}\)\?/border-danger\/30/g"
  apply "s/bg-${c}-[0-9]\{3\}\(\/[0-9]\{1,3\}\)\?/bg-danger\/10/g"
done

echo "==> garis dan permukaan"
apply 's/border-white\(\/[0-9]\{1,3\}\)\?\(\[[^]]*\]\)\?/border-line/g'
apply 's/border-zinc-[0-9]\{3\}\(\/[0-9]\{1,3\}\)\?/border-line/g'
apply 's/border-slate-[0-9]\{3\}\(\/[0-9]\{1,3\}\)\?/border-line/g'
apply 's/divide-white\(\/[0-9]\{1,3\}\)\?/divide-line/g'
# Latar semi-putih di tema gelap adalah "sedikit lebih terang dari induk".
# Padanan di tema terang adalah cream yang sedikit lebih gelap, bukan putih lagi.
apply 's/bg-white\(\/[0-9]\{1,3\}\)\?\(\[[^]]*\]\)\?/bg-cream-3/g'
apply 's/bg-black\(\/[0-9]\{1,3\}\)\?\(\[[^]]*\]\)\?/bg-cream-2/g'
# Hex gelap yang ditulis langsung. Semuanya jadi permukaan putih atau cream.
apply 's/bg-\[#0[0-9a-fA-F]\{5\}\]\(\/[0-9]\{1,3\}\)\?/bg-white/g'
apply 's/bg-\[#1[0-9a-fA-F]\{5\}\]\(\/[0-9]\{1,3\}\)\?/bg-cream-3/g'
apply 's/border-\[#[0-9a-fA-F]\{6\}\]\(\/[0-9]\{1,3\}\)\?/border-line/g'
apply 's/text-\[#[0-9a-fA-F]\{6\}\]/text-ink/g'

echo "==> sisa tema gelap"
apply 's/\bdark\b //g'
# Bayangan hitam pekat terlalu keras untuk latar cream.
apply 's/shadow-black\(\/[0-9]\{1,3\}\)\?/shadow-ink\/5/g'

echo "==> selesai"
git diff --stat -- src | tail -3
