// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {AdextoCurveFactory} from "../contracts/AdextoCurveFactory.sol";
import {SovereignCurve} from "../contracts/SovereignCurve.sol";
import {AdextoToken} from "../contracts/AdextoToken.sol";

/**
 * Fixture bersama: satu peluncuran nyata lewat factory, bukan kurva yang dirakit
 * tangan di dalam test.
 *
 * Bedanya penting. Merakit SovereignCurve langsung memungkinkan test menyetel state
 * yang tidak pernah bisa terjadi di produksi — misalnya kurva terinisialisasi tanpa
 * seluruh supply di dalamnya — dan properti yang lolos di state mustahil tidak
 * membuktikan apa pun. Di sini jalurnya sama dengan yang dipakai orang: factory
 * men-deploy kurva, men-deploy token, lalu memuat 100% supply dan MEWAJIBKAN
 * saldonya sendiri nol.
 *
 * `bindAgent` false karena registry ERC-8004 adalah kontrak pihak ketiga yang tidak
 * ada di lingkungan test; jalur pengikatannya punya suite sendiri di
 * scripts/test-erc8004-binding.mjs.
 */
abstract contract CurveFixture is Test {
    AdextoCurveFactory internal factory;
    SovereignCurve internal curve;
    AdextoToken internal token;

    /// Nilai yang sama dengan preset "standard" di studio: total 30 bps.
    uint256 internal constant SWAP_FEE_BPS = 30;
    uint256 internal constant CREATOR_BPS = 10;
    uint256 internal constant TREASURY_BPS = 5;
    /// depth = 30 - 10 - 5 = 15, dihitung oleh factory, bukan diteruskan.
    uint256 internal constant DEPTH_BPS = 15;

    uint256 internal constant SUPPLY = 1_000_000_000;
    /// Sama besaran dengan pembukaan 0G di produksi.
    uint256 internal constant VIRTUAL_NATIVE = 1500 ether;

    function _launch() internal {
        factory = new AdextoCurveFactory();
        (address t, address c) = factory.deployTrinity(
            "Fuzz Curve Agent",
            "FUZZ",
            SUPPLY,
            address(this),
            VIRTUAL_NATIVE,
            SWAP_FEE_BPS,
            CREATOR_BPS,
            TREASURY_BPS,
            bytes32(0),
            false,
            0
        );
        token = AdextoToken(t);
        curve = SovereignCurve(payable(c));

        /**
         * Lewati jendela anti-sniper.
         *
         * `_update` membatasi 1% supply per transaksi selama
         * `block.number <= launchBlock + 5`. Batas itu nyata dan diuji tersendiri,
         * tapi kalau dibiarkan aktif di sini ia akan me-revert sampel fuzz besar dan
         * yang terukur jadi "berapa banyak sampel yang ditolak", bukan sifat kurvanya.
         */
        vm.roll(block.number + 6);
    }

    /**
     * Invarian solvensi, ditulis SEKALI.
     *
     * Ini `_assertSolvent()` milik kontrak dinyatakan dari luar: setiap wei yang
     * dipegang kurva harus punya pemilik — kurva, klaim creator, atau kantong buyback.
     * Kekurangan berarti ada jalur pembayaran yang membelanjakan uang yang bukan
     * miliknya.
     */
    function _assertSolvent() internal view {
        uint256 accounted = curve.realNative() + curve.creatorOwed() + curve.treasuryNative();
        assertGe(address(curve).balance, accounted, "kurva insolven: saldo < yang tercatat");
    }

    /// Kurva membayar penjual dan pengklaim fee, jadi fixture harus bisa menerima native.
    receive() external payable {}
}
