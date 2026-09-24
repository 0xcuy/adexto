// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AdextoCurveFixture} from "./AdextoCurveFixture.sol";
import {AdextoCurve} from "../contracts/AdextoCurve.sol";

/**
 * Buyback tidak boleh bisa dihabiskan dalam satu transaksi.
 *
 * KENAPA TEST INI ADA, DAN KENAPA YANG SUDAH ADA TIDAK MENANGKAPNYA
 *
 * `executeBuyback` dibatasi 1% reserve per panggilan, dan setiap test yang sudah ada memanggilnya
 * TEPAT SEKALI lalu memeriksa invarian. `test/AdextoCurveInvariant.t.sol:95` dan
 * `test/AdextoCurveFuzz.t.sol:219` keduanya menghitung `min(treasury, reserve/100)` dan berhenti
 * di situ. Jadi sembilan invarian bisa lulus semua sementara serangannya jalan: yang tidak pernah
 * diuji adalah PENGULANGAN, dan justru di sana lubangnya — tiap panggilan menaikkan reserve,
 * sehingga plafon 1% ikut naik selama loop berjalan.
 *
 * Pelapor GHSA-g589-wjqq-86f2 mengukur 101,32 native terkuras dalam 3 panggilan dengan profit
 * 65,96 dari modal 3.000. Test di bawah menguji sifat yang membuat itu mustahil, bukan angka
 * spesifiknya: panggilan kedua di blok yang sama harus revert.
 */
contract AdextoBuybackCooldownTest is AdextoCurveFixture {
    function setUp() public {
        _launchCurve();
    }

    /**
     * Bangun `treasuryNative` lewat perdagangan sungguhan, bukan dengan menulis storage.
     *
     * BOLAK-BALIK, BUKAN SATU PEMBELIAN BESAR — dan itu keharusan, bukan gaya.
     *
     * Satu pembelian besar menumbuhkan reserve dan treasury sekaligus, sehingga treasury tetap
     * jauh di bawah plafon 1% reserve dan satu panggilan buyback sudah menghabiskannya. Pada
     * keadaan itu tidak ada loop untuk diuji, dan versi pertama test ini gagal tepat karena itu:
     * `treasuryNative` nol setelah panggilan pertama.
     *
     * Beli-lalu-jual mengembalikan native ke pembeli, jadi reserve kembali mendekati semula
     * sementara fee dari KEDUA kaki mengendap di treasury. Itulah kondisi yang disebut komentar
     * pada `executeBuyback`: volume kumulatif jauh di atas reserve. Di situlah serangannya hidup,
     * jadi di situlah ia harus diuji.
     */
    function _accrueTreasury(uint256 perTrade, uint256 rounds) internal {
        for (uint256 i = 0; i < rounds; i++) {
            vm.deal(address(this), perTrade);
            curve.buy{value: perTrade}(0, address(this), block.timestamp + 1);
            uint256 held = token.balanceOf(address(this));
            if (held == 0) break;
            token.approve(address(curve), held);
            curve.sell(held, 0, address(this), block.timestamp + 1);
        }
    }

    /** Treasury harus melebihi plafon per panggilan, kalau tidak test ini tidak menguji apa pun. */
    function _accrueUntilAboveCap() internal {
        for (uint256 round = 0; round < 40; round++) {
            _accrueTreasury(2_000 ether, 20);
            (uint256 reserveNative, ) = curve.getReserves();
            if (curve.treasuryNative() > reserveNative / 100) return;
        }
        revert("treasury tidak pernah melewati plafon 1%: prasyarat test tidak terpenuhi");
    }

    function _capped() internal view returns (uint256) {
        (uint256 reserveNative, ) = curve.getReserves();
        uint256 cap = reserveNative / 100;
        uint256 treasury = curve.treasuryNative();
        return treasury > cap ? cap : treasury;
    }

    // ── 1. Panggilan kedua dalam transaksi yang sama harus revert ─────────────
    function test_buybackCannotBeLoopedInOneTransaction() public {
        _accrueUntilAboveCap();

        uint256 first = _capped();
        assertGt(first, 0, "treasury tidak terkumpul, test tidak menguji apa pun");
        curve.executeBuyback(first, 0);

        uint256 second = _capped();
        assertGt(second, 0, "masih ada sisa treasury, jadi loop memang mungkin tanpa cooldown");
        vm.expectRevert("AdextoCurve: buyback cooldown");
        curve.executeBuyback(second, 0);
    }

    // ── 2. Treasury tidak bisa dikuras habis dalam satu blok ─────────────────
    //
    // Inilah bentuk serangan yang dilaporkan: ulangi sampai bucket kosong. Yang diperiksa
    // adalah treasury masih menyisakan sebagian besar isinya setelah percobaan menguras.
    function test_treasuryCannotBeDrainedInOneBlock() public {
        _accrueUntilAboveCap();
        uint256 before = curve.treasuryNative();

        curve.executeBuyback(_capped(), 0);
        for (uint256 i = 0; i < 5; i++) {
            uint256 amount = _capped();
            if (amount == 0) break;
            vm.expectRevert("AdextoCurve: buyback cooldown");
            curve.executeBuyback(amount, 0);
        }

        uint256 remaining = curve.treasuryNative();
        assertGt(remaining, 0, "treasury terkuras habis dalam satu blok");
        // Satu panggilan dibatasi 1% reserve, jadi sisanya harus jauh lebih besar daripada
        // yang terpakai. Ambang 50% dipilih longgar dengan sengaja: yang diuji sifatnya, bukan
        // angka pastinya, supaya test ini tidak pecah ketika parameter fee berubah.
        assertGt(remaining * 2, before, "lebih dari separuh treasury keluar dalam satu blok");
        _assertSolvent();
    }

    // ── 3. Sesudah cooldown lewat, ia boleh jalan lagi ────────────────────────
    //
    // Penting: perbaikannya tidak boleh mematikan fiturnya. Tanpa test ini, cooldown yang
    // keliru — misalnya yang tidak pernah kedaluwarsa — akan lulus kedua test di atas.
    function test_buybackWorksAgainAfterCooldown() public {
        _accrueUntilAboveCap();
        curve.executeBuyback(_capped(), 0);

        vm.warp(block.timestamp + curve.BUYBACK_COOLDOWN());

        uint256 amount = _capped();
        assertGt(amount, 0, "tidak ada sisa treasury untuk menguji jalur setelah cooldown");
        uint256 burnedBefore = curve.totalTokensBurned();
        curve.executeBuyback(amount, 0);
        assertGt(curve.totalTokensBurned(), burnedBefore, "buyback tidak membakar apa pun setelah cooldown");
        _assertSolvent();
    }

    // ── 4. Satu detik sebelum cooldown lewat, masih ditolak ──────────────────
    function test_buybackStillBlockedOneSecondEarly() public {
        _accrueUntilAboveCap();
        curve.executeBuyback(_capped(), 0);

        vm.warp(block.timestamp + curve.BUYBACK_COOLDOWN() - 1);

        // Dihitung SEBELUM `vm.expectRevert`, dan itu bukan soal kerapian. `expectRevert`
        // mengikat panggilan kontrak BERIKUTNYA, dan `_capped()` sendiri memanggil
        // `getReserves()` — yang tidak revert. Ditulis inline, harapannya termakan oleh
        // panggilan view itu dan test lulus tanpa pernah menguji cooldown-nya.
        uint256 amount = _capped();
        vm.expectRevert("AdextoCurve: buyback cooldown");
        curve.executeBuyback(amount, 0);
    }

    // ── 5. lastBuybackAt dicatat, dan itu yang menahannya ────────────────────
    function test_lastBuybackAtRecorded() public {
        assertEq(curve.lastBuybackAt(), 0, "lastBuybackAt harus nol sebelum buyback pertama");
        _accrueUntilAboveCap();
        curve.executeBuyback(_capped(), 0);
        assertEq(curve.lastBuybackAt(), block.timestamp, "lastBuybackAt tidak disetel");
    }
}
