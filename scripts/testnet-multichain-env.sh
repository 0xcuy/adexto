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
# Pakai:  source scripts/testnet-multichain-env.sh

export NEXT_PUBLIC_CHAIN_OVERRIDES='{
  "0G":       {"chainId":16602, "name":"0G Testnet",       "rpcUrl":"https://evmrpc-testnet.0g.ai",            "blockExplorer":"https://chainscan-galileo.0g.ai",  "nativeSymbol":"0G",  "factoryV2Address":"0x6394E3820d62a9Ab901128bEf5A04860b71A535c"},
  "Arbitrum": {"chainId":421614,"name":"Arbitrum Sepolia", "rpcUrl":"https://sepolia-rollup.arbitrum.io/rpc",   "blockExplorer":"https://sepolia.arbiscan.io",       "nativeSymbol":"ETH", "factoryV2Address":"0x75EeDEd196D2BE283d815D52F617eB70bCe865bC"},
  "Base":     {"chainId":84532, "name":"Base Sepolia",     "rpcUrl":"https://sepolia.base.org",                "blockExplorer":"https://sepolia.basescan.org",      "nativeSymbol":"ETH", "factoryV2Address":"0x5A2F13f1eFB86bD1e1814A5212690A2B765c85C8"},
  "Monad":    {"chainId":10143, "name":"Monad Testnet",    "rpcUrl":"https://testnet-rpc.monad.xyz",           "blockExplorer":"https://testnet.monadexplorer.com", "nativeSymbol":"MON", "factoryV2Address":"0x33811F9c53da5071A130F18D844f64999dBD43bA"}
}'

# Seed kecil supaya dana testnet tidak cepat habis (seed TERKUNCI permanen di pool).
export NEXT_PUBLIC_DEFAULT_SEED="${NEXT_PUBLIC_DEFAULT_SEED:-0.0005}"

# Registry terpisah agar data uji tidak pernah bercampur dengan produksi.
export ADEXTO_DATA_DIR="${ADEXTO_DATA_DIR:-/tmp/adexto-multi-data}"

# Kunci DIKOSONGKAN untuk proses server: upload 0G DA jadi tersimulasi (nol biaya).
# Skrip audit tetap membaca kunci sendiri dari .env.local untuk menandatangani tx.
export OG_PRIVATE_KEY=""
export PRIVATE_KEY=""

echo "lingkungan uji multi-chain aktif -> 16602 / 421614 / 84532 / 10143"
echo "ADEXTO_DATA_DIR=$ADEXTO_DATA_DIR"
