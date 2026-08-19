#!/usr/bin/env bash
#
# Lanjutan dari scripts/repalette-to-cream.sh — memperbaiki apa yang TIDAK bisa
# ditangkap oleh pemetaan warna satu-per-satu.
#
# repalette-to-cream.sh menukar nilai kelas per token: `text-white` → `text-ink`,
# `bg-green-400` → `bg-ok/10`, dan seterusnya. Untuk teks di atas latar cream itu
# benar. Tetapi ada dua tempat di mana pemetaan seperti itu tidak mungkin benar,
# karena artinya bergantung pada kelas LAIN di elemen yang sama:
#
#   1. Tombol beraksen penuh. `bg-accent` ditambah `text-ink` berarti tinta
#      cokelat gelap di atas ungu pekat — rasio kontrasnya sekitar 2:1, dan itu
#      justru terjadi pada satu-satunya tombol utama di setiap halaman. Isian
#      pekat butuh teks putih, bukan tinta.
#
#   2. Titik status. `bg-green-400` pada elemen 6×6 px menjadi `bg-ok/10`, yaitu
#      hijau dengan opasitas 10% — praktis tak terlihat di atas cream. Titik yang
#      berkedip tanpa terlihat lebih buruk daripada tidak ada titik.
#
# Sekaligus: gradien `from-accent to-accent` (dua ujung berwarna sama, jadi
# sebenarnya bukan gradien) diratakan menjadi satu `bg-accent`, dan berat huruf
# 900 diturunkan ke 600. Berat 900 dipakai di ~90 tempat, termasuk label 10 px;
# pada ukuran itu ia hanya menebalkan bentuk huruf tanpa menambah hierarki, dan
# itu bagian besar dari kesan "ramai".
#
# Idempoten: jalankan berapa kali pun, hasilnya sama.
set -euo pipefail
cd "$(dirname "$0")/.."

FILES=$(grep -rl "" src --include=*.tsx)

for f in $FILES; do
  # --- 1. Ratakan gradien-aksen-palsu menjadi isian tunggal -------------------
  sed -i \
    -e 's|bg-gradient-to-r from-accent via-accent to-accent|bg-accent hover:bg-accent-strong|g' \
    -e 's|bg-gradient-to-r from-accent to-accent hover:from-accent hover:to-accent|bg-accent hover:bg-accent-strong|g' \
    -e 's|bg-gradient-to-r from-accent to-accent|bg-accent hover:bg-accent-strong|g' \
    -e 's|bg-gradient-to-tr from-accent to-accent|bg-accent|g' \
    "$f"

  # --- 2. Teks putih di atas isian aksen pekat --------------------------------
  # Hanya pada baris yang memang berlatar aksen pekat, supaya `text-ink` di
  # tempat lain (di atas cream, yang sudah benar) tidak tersentuh.
  sed -i \
    -e '/bg-accent hover:bg-accent-strong/ s|text-ink |text-white |g' \
    -e '/bg-accent hover:bg-accent-strong/ s|text-ink"|text-white"|g' \
    -e '/bg-accent[^-]/ s|text-ink"|text-white"|g' \
    -e '/bg-accent /  s|text-ink disabled|text-white disabled|g' \
    "$f"

  # --- 3. Titik status harus pekat, bukan 10% --------------------------------
  # Syaratnya `animate-pulse` HARUS ada di elemen yang sama. Percobaan pertama
  # hanya mencocokkan `rounded-full bg-ok/10` dan itu salah: pil label seperti
  # "PILLAR 04 [O]" juga `rounded-full` dengan latar 10% — menjadikannya pekat
  # membuat teks warna yang sama lenyap ke dalam latarnya sendiri. Titik status
  # tidak punya teks, dan satu-satunya penanda yang pasti membedakannya adalah
  # animasi denyut.
  sed -i -E \
    -e 's|bg-(ok\|warn\|danger\|accent)/10( [^"]*)?( animate-pulse)|bg-\1\2\3|g' \
    -e 's|(animate-pulse[^"]*)bg-(ok\|warn\|danger\|accent)/10|\1bg-\2|g' \
    "$f"

  # --- 4. Berat huruf ---------------------------------------------------------
  sed -i -e 's|font-black|font-semibold|g' "$f"
done

echo "— sisa yang perlu diperiksa tangan —"
echo "gradien aksen palsu:  $(grep -rn 'from-accent to-accent' src --include=*.tsx | wc -l)"
echo "text-ink di atas aksen: $(grep -rn 'bg-accent[^-][^"]*text-ink[^-]' src --include=*.tsx | wc -l)"
echo "titik 10% tembus pandang: $(grep -rn 'rounded-full bg-\(ok\|warn\|danger\)/10' src --include=*.tsx | wc -l)"
echo "font-black: $(grep -rn 'font-black' src --include=*.tsx | wc -l)"
