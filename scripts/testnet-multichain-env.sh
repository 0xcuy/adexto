#!/usr/bin/env bash
# Lingkungan pengujian multi-chain: mengarahkan keempat SLOT chain produksi ke testnet.
#
# Dipakai HANYA untuk pengujian. Jangan pernah diset di produksi — produksi harus
# tetap mainnet-only. Lihat ADEXTO-RUNBOOK.md §1b.
#
#   0G       -> 0G Testnet        16602
#   Arbitrum -> Arbitrum Sepolia  421614
#   Base     -> Base Sepolia      84532
#   Monad    -> Monad Testnet     10143
#
# Alamat di bawah adalah AdextoTrinityFactoryV3 (bonding curve, tanpa seed).
# Generasi v2 yang berseed sengaja tidak diikutkan: `chains.ts` memilih v3 bila
# keduanya ada, jadi menyertakan v2 hanya membingungkan.
#
# Pakai:  source scripts/testnet-multichain-env.sh

export NEXT_PUBLIC_CHAIN_OVERRIDES='{
  "0G":       {"chainId":16602, "name":"0G Testnet",       "rpcUrl":"https://evmrpc-testnet.0g.ai",            "blockExplorer":"https://chainscan-galileo.0g.ai",  "nativeSymbol":"0G",  "factoryV3Address":"0xeaC93b76101da1f5F0471fd311Dd7A8d9Ef93632"},
  "Arbitrum": {"chainId":421614,"name":"Arbitrum Sepolia", "rpcUrl":"https://sepolia-rollup.arbitrum.io/rpc",   "blockExplorer":"https://sepolia.arbiscan.io",       "nativeSymbol":"ETH", "factoryV3Address":"0xb89d17F7308Ac007b106EB400eB2A8CB51cf887A"},
  "Base":     {"chainId":84532, "name":"Base Sepolia",     "rpcUrl":"https://base-sepolia-rpc.publicnode.com", "blockExplorer":"https://sepolia.basescan.org",      "nativeSymbol":"ETH", "factoryV3Address":"0x921E03288ADA4192bF592B603e86A147c6D2f6e7"},
  "Monad":    {"chainId":10143, "name":"Monad Testnet",    "rpcUrl":"https://testnet-rpc.monad.xyz",           "blockExplorer":"https://testnet.monadexplorer.com", "nativeSymbol":"MON", "factoryV3Address":"0x516D005367045b1fc18c9c9a0Ff7bf8653d1B4e3"}
}'

# Base Sepolia memakai publicnode: sepolia.base.org berulang kali membalas 503.

# Slot devchain WAJIB dimatikan di sini.
#
# chains.ts mengaktifkan chain 31337 hanya berdasarkan ada-tidaknya
# NEXT_PUBLIC_DEVCHAIN_RPC. Kalau skrip ini di-source di shell yang sebelumnya
# pernah memuat scripts/devchain-env.sh, variabel itu masih terwarisi dan
# Devchain ikut muncul sebagai target launch — tombolnya berbunyi
# "Launch on 0G + Devchain" dan harness yang menuntut "1 of 1" jadi gagal,
# padahal 0G-nya sendiri sehat. Lebih buruk lagi: token uji ikut ter-deploy ke
# chain lokal dan mengotori registry.
#
# Karena itu jangan berasumsi shell-nya bersih — nyatakan saja.
# CATATAN: NEXT_PUBLIC_* di-inline saat `next build`, jadi unset ini harus aktif
# saat build, bukan hanya saat start.
unset NEXT_PUBLIC_DEVCHAIN_RPC
unset NEXT_PUBLIC_DEVCHAIN_CHAIN_ID
unset NEXT_PUBLIC_DEVCHAIN_NAME
unset NEXT_PUBLIC_DEVCHAIN_SYMBOL
unset NEXT_PUBLIC_DEVCHAIN_EXPLORER
unset NEXT_PUBLIC_FACTORY_V2_DEVCHAIN
unset NEXT_PUBLIC_FACTORY_V3_DEVCHAIN

# Tidak ada lagi NEXT_PUBLIC_DEFAULT_SEED. Kurva tidak menerima setoran, jadi
# variabel itu sudah tidak punya arti.

# Registry terpisah agar data uji tidak pernah bercampur dengan produksi.
#
# HARUS tanpa syarat. Dulu di sini tertulis `${ADEXTO_DATA_DIR:-...}`, padahal env
# ini selalu di-source SETELAH `. ./.env.local` yang sudah mengisi ADEXTO_DATA_DIR
# dengan jalur produksi kontainer (/app/data). Akibatnya default uji tidak pernah
# dipakai dan registry uji menulis ke jalur produksi. Untuk mengarahkan ke tempat
# lain, pakai ADEXTO_TEST_DATA_DIR.
export ADEXTO_DATA_DIR="${ADEXTO_TEST_DATA_DIR:-/tmp/adexto-multi-data}"

# Kunci DIKOSONGKAN untuk proses server: upload 0G DA jadi tersimulasi (nol biaya).
# Skrip audit tetap membaca kunci sendiri dari .env.local untuk menandatangani tx.
export OG_PRIVATE_KEY=""
export PRIVATE_KEY=""

echo "lingkungan uji multi-chain aktif (FactoryV3) -> 16602 / 421614 / 84532 / 10143"
echo "ADEXTO_DATA_DIR=$ADEXTO_DATA_DIR"
