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
# Alamat AdextoCurveFactory DIBACA dari build/deployments.json, tidak dipaku.
#
# Sebelumnya keempat alamat ditulis tangan di berkas ini, dan itu jadi basi persis
# saat kontraknya di-deploy ulang: skrip masih mengarahkan UI ke factory generasi
# lama sementara build/deployments.json sudah menunjuk yang baru, dan tidak ada
# yang gagal secara terang-terangan — peluncuran cuma memakai kontrak yang salah.
# Sumber kebenarannya sekarang satu, dan ia yang ditulis oleh skrip deploy.
#
# Generasi v2 yang berseed sengaja tidak diikutkan: `chains.ts` memilih kurva bila
# keduanya ada, jadi menyertakan v2 hanya membingungkan.
#
# Pakai:  source scripts/testnet-multichain-env.sh

_ADEXTO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NEXT_PUBLIC_CHAIN_OVERRIDES="$(python3 - "$_ADEXTO_ROOT/build/deployments.json" <<'PYEOF'
import io, json, sys

# Slot chain produksi -> kunci testnet di deployments.json, plus metadata yang
# tidak ada di sana. Base Sepolia memakai publicnode: sepolia.base.org berulang
# kali membalas 503.
SLOTS = {
    "0G": ("0g-testnet", 16602, "0G Testnet", "https://evmrpc-testnet.0g.ai",
           "https://chainscan-galileo.0g.ai", "0G"),
    "Arbitrum": ("arbitrum-sepolia", 421614, "Arbitrum Sepolia",
                 "https://sepolia-rollup.arbitrum.io/rpc",
                 "https://sepolia.arbiscan.io", "ETH"),
    "Base": ("base-sepolia", 84532, "Base Sepolia",
             "https://base-sepolia-rpc.publicnode.com",
             "https://sepolia.basescan.org", "ETH"),
    "Monad": ("monad-testnet", 10143, "Monad Testnet",
              "https://testnet-rpc.monad.xyz",
              "https://testnet.monadexplorer.com", "MON"),
}

dep = json.load(io.open(sys.argv[1], encoding="utf-8"))
out = {}
missing = []
for slot, (key, chain_id, name, rpc, explorer, native) in SLOTS.items():
    address = (dep.get(key) or {}).get("curveFactory")
    if not address:
        missing.append(key)
        continue
    out[slot] = {
        "chainId": chain_id,
        "name": name,
        "rpcUrl": rpc,
        "blockExplorer": explorer,
        "nativeSymbol": native,
        "curveFactoryAddress": address,
    }

if missing:
    sys.stderr.write(
        "PERINGATAN: belum ada curveFactory untuk %s — slot itu akan tampil "
        "sebagai 'DEX not live'.\n" % ", ".join(missing)
    )
sys.stdout.write(json.dumps(out, separators=(",", ":")))
PYEOF
)"
export NEXT_PUBLIC_CHAIN_OVERRIDES

if [ -z "$NEXT_PUBLIC_CHAIN_OVERRIDES" ] || [ "$NEXT_PUBLIC_CHAIN_OVERRIDES" = "{}" ]; then
  echo "GAGAL: build/deployments.json tidak memuat satu pun curveFactory testnet." >&2
  echo "       Jalankan: node scripts/deploy-sovereign-curve.mjs --chain 0g-testnet --broadcast" >&2
  return 1 2>/dev/null || exit 1
fi

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
unset NEXT_PUBLIC_CURVE_FACTORY_DEVCHAIN

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

echo "lingkungan uji multi-chain aktif (AdextoCurveFactory) -> 16602 / 421614 / 84532 / 10143"
echo "ADEXTO_DATA_DIR=$ADEXTO_DATA_DIR"
