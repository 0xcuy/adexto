// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AdextoFactory} from "../AdextoFactory.sol";
import {AdextoCurve} from "../AdextoCurve.sol";
import {AdextoToken} from "../AdextoToken.sol";

/**
 * Harness Echidna untuk kurva 0.12.0 — pasangan `EchidnaCurve.sol`, yang menguji kurva 0.10.0.
 *
 * Ditambahkan 2026-09-30. Sampai saat itu Echidna hanya pernah menyerang `SovereignCurve`, jadi
 * kurva yang benar-benar dipakai meluncurkan hanya diuji satu mesin fuzz (Foundry). Harness ini
 * meluncurkan lewat `AdextoFactory` 0.12.0 dengan model fee produksi (100 bps: creator 70, depth 10,
 * buyback 10, protokol 10), sama seperti `test/AdextoCurveFixture.sol`.
 *
 * Bedanya dengan harness 0.10.0: ada kaki keempat. `echidna_solvent` karena itu WAJIB memuat
 * `protocolOwed` — tanpa suku itu kurva terbaca solven memakai uang yang sudah milik treasury — dan
 * ada aksi `claimProtocol` plus properti bahwa saldo treasury sama persis dengan yang tercatat
 * terbayar.
 *
 * Buyback: kurva 0.12.0 punya cooldown satu jam. Echidna memajukan `block.timestamp` secara acak di
 * antara transaksi, jadi buyback berikutnya tetap bisa terjadi dalam satu urutan, tidak seperti di
 * handler Foundry yang tidak pernah memajukan waktu.
 *
 * Seperti harness 0.10.0, creator DAN pedagang adalah kontrak ini, karena Echidna memanggil fungsi
 * pada satu kontrak uji. Properti "creator tidak memegang token" dinyatakan di
 * `test/AdextoCurveInvariant.t.sol`, yang punya handler terpisah.
 */
contract EchidnaAdextoCurve {
    AdextoFactory internal factory;
    AdextoCurve internal curve;
    AdextoToken internal token;
    uint256 internal initialSupply;

    /// Alamat tanpa kode, BUKAN kontrak ini: kalau sama, fee protokol yang salah alamat tidak terlihat.
    address internal constant PROTOCOL_TREASURY = address(0xBEEF);

    constructor() payable {
        factory = new AdextoFactory(PROTOCOL_TREASURY, new string[](0));
        (address t, address c) = factory.deployTrinity(
            "Echidna Adexto Curve",
            "ECH12",
            1_000_000_000,
            address(this),
            1500 ether,
            100,
            70,
            10,
            bytes32(0),
            false,
            0
        );
        token = AdextoToken(t);
        curve = AdextoCurve(payable(c));
        initialSupply = token.totalSupply();
    }

    receive() external payable {}

    // ── Aksi yang boleh dicoba fuzzer ─────────────────────────────────────────

    function buy(uint256 seed) public {
        uint256 amount = 1 + (seed % 5_000 ether);
        if (address(this).balance < amount) return;
        (uint256 quoted,,,,) = curve.getBuyQuote(amount);
        if (quoted == 0) return;
        curve.buy{value: amount}(0, address(this), block.timestamp + 1);
    }

    function sell(uint256 seed) public {
        uint256 held = token.balanceOf(address(this));
        if (held == 0) return;
        uint256 amount = 1 + (seed % held);
        (uint256 quoted,,,,) = curve.getSellQuote(amount);
        if (quoted == 0) return;
        token.approve(address(curve), amount);
        curve.sell(amount, 0, address(this), block.timestamp + 1);
    }

    function buyback(uint256 seed) public {
        uint256 treasury = curve.treasuryNative();
        if (treasury == 0) return;
        (uint256 reserveNative,) = curve.getReserves();
        uint256 cap = reserveNative / 100;
        uint256 max = treasury < cap ? treasury : cap;
        if (max == 0) return;
        uint256 amount = 1 + (seed % max);
        (uint256 willBurn,,,,) = curve.getBuyQuote(amount);
        if (willBurn == 0) return;
        curve.executeBuyback(amount, 0);
    }

    function claim() public {
        if (curve.creatorOwed() == 0) return;
        curve.claimCreatorFees();
    }

    function claimProtocol() public {
        if (curve.protocolOwed() == 0) return;
        curve.claimProtocolFees();
    }

    // ── Properti ──────────────────────────────────────────────────────────────

    /// Setiap wei yang dipegang kurva harus punya pemilik, termasuk treasury protokol.
    function echidna_solvent() public view returns (bool) {
        return
            address(curve).balance >=
            curve.realNative() + curve.creatorOwed() + curve.treasuryNative() + curve.protocolOwed();
    }

    /// `_mint` sekali di konstruktor, tanpa fungsi mint: hanya bisa turun.
    function echidna_supplyNeverGrows() public view returns (bool) {
        return token.totalSupply() <= initialSupply;
    }

    /// Persediaan internal harus cocok dengan saldo ERC-20 sesungguhnya.
    function echidna_inventoryMatchesBalance() public view returns (bool) {
        return token.balanceOf(address(curve)) == curve.curveTokens() - curve.tokensSold();
    }

    /// Kalau ini bisa dilampaui, `curveTokens - _tokensSold` underflow.
    function echidna_tokensSoldWithinCurve() public view returns (bool) {
        return curve.tokensSold() <= curve.curveTokens();
    }

    /// Fee protokol hanya mendarat di treasury, dan tepat sebanyak yang tercatat terbayar.
    function echidna_treasuryBalanceMatchesPaid() public view returns (bool) {
        return PROTOCOL_TREASURY.balance == curve.totalProtocolFeesPaid();
    }
}
