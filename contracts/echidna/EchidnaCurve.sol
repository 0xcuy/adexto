// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AdextoCurveFactory} from "../AdextoCurveFactory.sol";
import {SovereignCurve} from "../SovereignCurve.sol";
import {AdextoToken} from "../AdextoToken.sol";

/**
 * Harness Echidna — mesin fuzz KEDUA di atas invarian yang sama.
 *
 * Kenapa diulang kalau Foundry sudah menguji hal yang sama: mesin pencarinya beda.
 * Foundry memakai fuzzer berbasis kamus dengan pembangkit acak; Echidna memakai
 * grammar-based fuzzing dengan corpus yang berkembang dan minimisasi counterexample.
 * Keduanya bisa gagal menemukan hal yang ditemukan yang lain. Kalau dua mesin
 * berbeda menyerang invarian yang sama dan dua-duanya tidak menemukan apa pun, itu
 * bukti yang lebih kuat daripada satu mesin dijalankan dua kali lebih lama.
 *
 * Perbedaan yang disengaja dari suite Foundry: di sini creator DAN pedagang adalah
 * kontrak yang sama, karena Echidna memanggil fungsi pada satu kontrak uji. Jadi
 * properti "creator tidak memegang token" tidak bisa dinyatakan di sini — ia
 * dinyatakan di SovereignCurveInvariant.t.sol, yang punya handler terpisah.
 */
contract EchidnaCurve {
    AdextoCurveFactory internal factory;
    SovereignCurve internal curve;
    AdextoToken internal token;
    uint256 internal initialSupply;

    constructor() payable {
        factory = new AdextoCurveFactory();
        (address t, address c) = factory.deployTrinity(
            "Echidna Curve",
            "ECH",
            1_000_000_000,
            address(this),
            1500 ether,
            30,
            10,
            5,
            bytes32(0),
            false,
            0
        );
        token = AdextoToken(t);
        curve = SovereignCurve(payable(c));
        initialSupply = token.totalSupply();
    }

    receive() external payable {}

    // ── Aksi yang boleh dicoba fuzzer ─────────────────────────────────────────

    function buy(uint256 seed) public {
        uint256 amount = 1 + (seed % 5_000 ether);
        if (address(this).balance < amount) return;
        (uint256 quoted,,,) = curve.getBuyQuote(amount);
        if (quoted == 0) return;
        curve.buy{value: amount}(0, address(this), block.timestamp + 1);
    }

    function sell(uint256 seed) public {
        uint256 held = token.balanceOf(address(this));
        if (held == 0) return;
        uint256 amount = 1 + (seed % held);
        (uint256 quoted,,,) = curve.getSellQuote(amount);
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
        (uint256 willBurn,,,) = curve.getBuyQuote(amount);
        if (willBurn == 0) return;
        curve.executeBuyback(amount, 0);
    }

    function claim() public {
        if (curve.creatorOwed() == 0) return;
        curve.claimCreatorFees();
    }

    // ── Properti ──────────────────────────────────────────────────────────────

    /// Setiap wei yang dipegang kurva harus punya pemilik.
    function echidna_solvent() public view returns (bool) {
        return address(curve).balance >= curve.realNative() + curve.creatorOwed() + curve.treasuryNative();
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
}
