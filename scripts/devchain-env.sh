#!/usr/bin/env bash
# Overlay env untuk menguji FactoryV3 (bonding curve) di devchain lokal.
#
# Pemakaian:
#   cd devchain && npx hardhat node --port 8545     # terminal 1
#   node scripts/deploy-sovereign-curve.mjs --chain devchain --broadcast
#   set -a && . ./.env.local && set +a && source scripts/devchain-env.sh && npx next build && npx next start -p 3100
#
# CATATAN PENTING: variabel NEXT_PUBLIC_* di-inline saat `next build`, bukan saat
# `next start`. Jadi env ini harus aktif SEBELUM build, bukan hanya sebelum start.
# Dan `next start` tidak memuat .env.local sendiri, jadi `set -a && . ./.env.local`
# tetap diperlukan agar /api/chat tidak balas 500.

export NEXT_PUBLIC_DEVCHAIN_RPC="http://127.0.0.1:8545"
export NEXT_PUBLIC_DEVCHAIN_CHAIN_ID="31337"
export NEXT_PUBLIC_DEVCHAIN_NAME="Local Devchain"
export NEXT_PUBLIC_DEVCHAIN_SYMBOL="ETH"

# Alamat deploy pertama dari akun #0 Hardhat bersifat deterministik, jadi nilai ini
# stabil setiap kali node di-restart lalu factory dideploy ulang.
export NEXT_PUBLIC_FACTORY_V3_DEVCHAIN="0x5FbDB2315678afecb367f032d93F642f64180aa3"

# Sengaja TIDAK menyetel NEXT_PUBLIC_FACTORY_V2_DEVCHAIN: generasi berseed sudah
# ditinggalkan, dan chains.ts memilih v3 bila keduanya ada.

# Buang sisa lingkungan uji testnet.
#
# Simetris dengan unset devchain di scripts/testnet-multichain-env.sh. Kalau shell
# ini sebelumnya pernah memuat testnet-multichain-env.sh, NEXT_PUBLIC_CHAIN_OVERRIDES
# masih terwarisi dan keempat slot chain produksi tetap menunjuk testnet — uji
# devchain lalu berjalan di atas peta chain yang salah tanpa memberi tanda apa pun.
unset NEXT_PUBLIC_CHAIN_OVERRIDES

# Registry uji devchain dipisah dari registry uji testnet MAUPUN produksi.
# Tanpa syarat, karena .env.local sudah mengisi ADEXTO_DATA_DIR dengan jalur
# produksi kontainer (/app/data) yang bahkan tidak ada di host.
export ADEXTO_DATA_DIR="${ADEXTO_DEVCHAIN_DATA_DIR:-/tmp/adexto-devchain-data}"

echo "devchain env: chainId 31337 · FactoryV3 ${NEXT_PUBLIC_FACTORY_V3_DEVCHAIN}"
