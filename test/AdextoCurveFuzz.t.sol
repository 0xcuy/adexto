// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AdextoCurveFixture} from "./AdextoCurveFixture.sol";
import {AdextoCurveFactory} from "../contracts/AdextoCurveFactory.sol";
import {AdextoFactory} from "../contracts/AdextoFactory.sol";
import {SovereignCurve} from "../contracts/SovereignCurve.sol";
import {AdextoCurve} from "../contracts/AdextoCurve.sol";
import {AdextoToken} from "../contracts/AdextoToken.sol";

/**
 * Fuzz stateless untuk kaki fee protokol v0.11.0.
 *
 * Yang diuji di sini bukan ulang seluruh sifat kurva — itu sudah ada di
 * SovereignCurveFuzz.t.sol dan matematikanya tidak berubah. Yang diuji adalah hal
 * yang BARU dan hal yang bisa dirusak olehnya: apakah fee protokol benar-benar
 * ditagih, apakah ia aditif seperti yang diklaim, apakah ia hanya bisa mendarat di
 * treasury yang immutable, dan apakah solvensi masih berlaku setelah ada kantong
 * keempat.
 */
contract AdextoCurveFuzzTest is AdextoCurveFixture {
    function setUp() public {
        _launchCurve();
    }

    function _boundBuy(uint256 raw) internal pure returns (uint256) {
        return bound(raw, 1, 100_000 ether);
    }

    // ── 1. Kaki fee terkonfigurasi seperti yang diklaim ───────────────────────
    //
    // Angka-angka ini dipublikasikan, jadi kontraknya yang harus membuktikannya,
    // bukan dokumentasinya.
    function test_feeLegsMatchPublishedNumbers() public view {
        assertEq(curve.depthFeeBps(), DEPTH_BPS, "depth bukan 15 bps");
        assertEq(curve.creatorFeeBps(), CREATOR_BPS, "creator bukan 10 bps");
        assertEq(curve.treasuryBuybackBps(), TREASURY_BPS, "buyback bukan 5 bps");
        assertEq(curve.protocolFeeBps(), PROTOCOL_BPS, "protokol bukan 10 bps");
        assertEq(curve.totalFeeBps(), TOTAL_PAID_BPS, "total yang dibayar bukan 40 bps");
        assertEq(factory.PROTOCOL_FEE_BPS(), PROTOCOL_BPS, "konstanta factory bukan 10 bps");
        assertEq(curve.protocolTreasury(), PROTOCOL_TREASURY, "treasury protokol salah");
        assertEq(curve.VERSION(), "0.11.0", "versi kurva salah");
        assertEq(factory.VERSION(), "0.11.0", "versi factory salah");
    }

    // ── 2. Kuotasi harus SAMA dengan eksekusi, termasuk kaki protokol ─────────
    function testFuzz_buyQuoteMatchesExecution(uint256 rawIn) public {
        uint256 nativeIn = _boundBuy(rawIn);
        vm.deal(address(this), nativeIn);

        (uint256 quoted,,,, uint256 protocolFee) = curve.getBuyQuote(nativeIn);
        vm.assume(quoted > 0);

        uint256 owedBefore = curve.protocolOwed();
        uint256 received = curve.buy{value: nativeIn}(0, address(this), block.timestamp + 1);

        assertEq(received, quoted, "nilai kembalian buy != kuotasi");
        assertEq(curve.protocolOwed() - owedBefore, protocolFee, "fee protokol yang mengendap != kuotasi");
        _assertSolvent();
    }

    function testFuzz_sellQuoteMatchesExecution(uint256 rawIn, uint256 sellPct) public {
        uint256 nativeIn = _boundBuy(rawIn);
        vm.deal(address(this), nativeIn);
        (uint256 bought,,,,) = curve.getBuyQuote(nativeIn);
        vm.assume(bought > 0);
        curve.buy{value: nativeIn}(0, address(this), block.timestamp + 1);

        uint256 amount = (bought * bound(sellPct, 1, 100)) / 100;
        vm.assume(amount > 0);

        (uint256 quotedOut,,,, uint256 protocolFee) = curve.getSellQuote(amount);
        vm.assume(quotedOut > 0);

        token.approve(address(curve), amount);
        uint256 owedBefore = curve.protocolOwed();
        uint256 out = curve.sell(amount, 0, address(this), block.timestamp + 1);

        assertEq(out, quotedOut, "nilai kembalian sell != kuotasi");
        assertEq(curve.protocolOwed() - owedBefore, protocolFee, "fee protokol pada jual != kuotasi");
        _assertSolvent();
    }

    // ── 3. Fee protokol persis mengikuti aritmetika bps ───────────────────────
    function testFuzz_protocolFeeIsExactBpsOfInput(uint256 rawIn) public view {
        uint256 nativeIn = _boundBuy(rawIn);
        (,,,, uint256 protocolFee) = curve.getBuyQuote(nativeIn);
        assertEq(protocolFee, (nativeIn * PROTOCOL_BPS) / 10_000, "fee protokol != bps * masukan");
    }

    // ── 4. Total keempat kaki tidak pernah melebihi masukan ───────────────────
    function testFuzz_fourLegsNeverExceedInput(uint256 rawIn) public view {
        uint256 nativeIn = _boundBuy(rawIn);
        (, uint256 depthFee, uint256 creatorFee, uint256 treasuryFee, uint256 protocolFee) =
            curve.getBuyQuote(nativeIn);
        assertLe(depthFee + creatorFee + treasuryFee + protocolFee, nativeIn, "total fee melebihi masukan");
    }

    // ── 5. Fee protokol ADITIF, bukan diambil dari kaki lain ──────────────────
    //
    // Ini klaim yang paling mudah dilanggar tanpa sadar, jadi diuji dengan
    // membandingkan langsung terhadap kurva v0.10.0 yang dikonfigurasi identik.
    // Kalau 10 bps itu diam-diam diambil dari depth atau creator, kedua kaki itu akan
    // berbeda dan pembeli akan menerima jumlah token yang SAMA — yang justru menandai
    // klaim "aditif" itu bohong.
    function testFuzz_protocolFeeIsAdditiveNotCarvedOut(uint256 rawIn) public {
        AdextoCurveFactory legacyFactory = new AdextoCurveFactory();
        (address lt, address lc) = legacyFactory.deployTrinity(
            "Legacy Curve",
            "LEG",
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
        SovereignCurve legacy = SovereignCurve(payable(lc));
        AdextoToken(lt);
        vm.roll(block.number + 6);

        // Kaki yang dikonfigurasi harus IDENTIK di kedua versi.
        assertEq(legacy.depthFeeBps(), curve.depthFeeBps(), "depth berbeda: protokol mengambil dari depth");
        assertEq(legacy.creatorFeeBps(), curve.creatorFeeBps(), "creator berbeda: protokol mengambil dari creator");
        assertEq(
            legacy.treasuryBuybackBps(), curve.treasuryBuybackBps(), "buyback berbeda: protokol mengambil dari buyback"
        );

        uint256 nativeIn = bound(rawIn, 1 ether, 100_000 ether);
        (uint256 legacyOut,,,) = legacy.getBuyQuote(nativeIn);
        (uint256 v2Out,,,, uint256 protocolFee) = curve.getBuyQuote(nativeIn);
        vm.assume(legacyOut > 0 && v2Out > 0);

        assertGt(protocolFee, 0, "fee protokol nol pada pembelian berukuran nyata");
        assertLt(v2Out, legacyOut, "pembeli v0.11.0 menerima >= v0.10.0: fee protokol tidak benar-benar ditagih");
    }

    // ── 6. Fee protokol hanya bisa mendarat di treasury yang immutable ────────
    //
    // `claimProtocolFees` tidak menerima parameter tujuan, jadi yang diuji: siapa pun
    // boleh MEMICUnya, tapi uangnya selalu mendarat di treasury.
    function testFuzz_protocolFeesOnlyReachTreasury(uint256 rawIn, address caller) public {
        vm.assume(caller != address(0) && caller != PROTOCOL_TREASURY && caller != address(this));
        vm.assume(caller.code.length == 0 && caller.balance == 0);

        uint256 nativeIn = bound(rawIn, 1 ether, 100_000 ether);
        vm.deal(address(this), nativeIn);
        (uint256 bought,,,,) = curve.getBuyQuote(nativeIn);
        vm.assume(bought > 0);
        curve.buy{value: nativeIn}(0, address(this), block.timestamp + 1);

        uint256 owed = curve.protocolOwed();
        vm.assume(owed > 0);

        uint256 treasuryBefore = PROTOCOL_TREASURY.balance;
        uint256 creatorBefore = address(this).balance;

        vm.prank(caller);
        curve.claimProtocolFees();

        assertEq(PROTOCOL_TREASURY.balance - treasuryBefore, owed, "treasury tidak menerima penuh");
        assertEq(caller.balance, 0, "pemanggil menerima native padahal bukan treasury");
        assertEq(address(this).balance, creatorBefore, "creator menerima fee protokol");
        assertEq(curve.protocolOwed(), 0, "utang protokol tidak dinolkan");
        assertEq(curve.totalProtocolFeesPaid(), owed, "total terbayar tidak tercatat");
        _assertSolvent();
    }

    // ── 7. Klaim creator dan klaim protokol tidak saling mencuri ──────────────
    //
    // Dua kantong yang keduanya bisa diklaim siapa pun adalah tempat wajar munculnya
    // bug di mana satu klaim mengosongkan kantong yang lain.
    function testFuzz_creatorAndProtocolClaimsAreIndependent(uint256 rawIn) public {
        uint256 nativeIn = bound(rawIn, 1 ether, 100_000 ether);
        vm.deal(address(this), nativeIn);
        (uint256 bought,,,,) = curve.getBuyQuote(nativeIn);
        vm.assume(bought > 0);
        curve.buy{value: nativeIn}(0, address(this), block.timestamp + 1);

        uint256 creatorOwed = curve.creatorOwed();
        uint256 protocolOwed = curve.protocolOwed();
        vm.assume(creatorOwed > 0 && protocolOwed > 0);

        curve.claimCreatorFees();
        assertEq(curve.protocolOwed(), protocolOwed, "klaim creator mengubah utang protokol");

        uint256 treasuryBefore = PROTOCOL_TREASURY.balance;
        curve.claimProtocolFees();
        assertEq(PROTOCOL_TREASURY.balance - treasuryBefore, protocolOwed, "treasury menerima jumlah yang salah");
        assertEq(curve.creatorOwed(), 0, "utang creator berubah setelah klaim protokol");
        _assertSolvent();
    }

    // ── 8. Buyback TIDAK menagih fee protokol ─────────────────────────────────
    //
    // Buyback memutar ulang uang yang sudah berasal dari fee. Menagihnya lagi berarti
    // fee di atas fee, dan kaki protokol harus mengikuti kaki creator dan buyback yang
    // sama-sama diabaikan di sana.
    function testFuzz_buybackChargesNoProtocolFee(uint256 rawIn) public {
        uint256 nativeIn = bound(rawIn, 1 ether, 100_000 ether);
        vm.deal(address(this), nativeIn);
        (uint256 bought,,,,) = curve.getBuyQuote(nativeIn);
        vm.assume(bought > 0);
        curve.buy{value: nativeIn}(0, address(this), block.timestamp + 1);

        uint256 treasury = curve.treasuryNative();
        vm.assume(treasury > 0);
        (uint256 reserveNative,) = curve.getReserves();
        uint256 cap = reserveNative / 100;
        uint256 spend = treasury > cap ? cap : treasury;
        vm.assume(spend > 0);
        (uint256 willBurn,,,,) = curve.getBuyQuote(spend);
        vm.assume(willBurn > 0);

        uint256 protocolBefore = curve.protocolOwed();
        curve.executeBuyback(spend, 0);

        assertEq(curve.protocolOwed(), protocolBefore, "buyback menagih fee protokol: fee di atas fee");
        _assertSolvent();
    }

    // ── 9. Bolak-balik tetap tidak menguntungkan, sekarang dengan 40 bps ──────
    function testFuzz_roundTripNeverProfitable(uint256 rawIn) public {
        uint256 nativeIn = _boundBuy(rawIn);
        vm.deal(address(this), nativeIn);

        (uint256 bought,,,,) = curve.getBuyQuote(nativeIn);
        vm.assume(bought > 0);
        curve.buy{value: nativeIn}(0, address(this), block.timestamp + 1);

        (uint256 back,,,,) = curve.getSellQuote(bought);
        vm.assume(back > 0);
        token.approve(address(curve), bought);
        uint256 out = curve.sell(bought, 0, address(this), block.timestamp + 1);

        assertLt(out, nativeIn, "bolak-balik menghasilkan untung: kurva bisa dikuras");
        _assertSolvent();
    }

    // ── 10. Treasury protokol nol harus ditolak saat deployment ───────────────
    //
    // Kalau ini lolos, kurva akan mengendapkan `protocolOwed` yang tidak bisa diklaim
    // siapa pun, dan karena tidak ada yang mutable, uang itu terkunci selamanya.
    function test_zeroProtocolTreasuryRejected() public {
        vm.expectRevert(bytes("Factory: zero protocol treasury"));
        new AdextoFactory(address(0));
    }

    // ── 11. Batas 5% dihitung atas apa yang BENAR-BENAR dibayar pedagang ──────
    //
    // 500 bps yang dikonfigurasi ditambah 10 bps protokol adalah 510 bps, jadi harus
    // ditolak di factory — bukan diteruskan lalu gagal di konstruktor kurva.
    function test_capCountsProtocolLeg() public {
        vm.expectRevert(bytes("Factory: fee too high"));
        factory.deployTrinity(
            "Over Cap", "OVER", SUPPLY, address(this), VIRTUAL_NATIVE, 500, 10, 5, bytes32(0), false, 0
        );

        // 490 + 10 = 500, tepat di batas, harus lolos.
        (, address c) = factory.deployTrinity(
            "At Cap", "ATCAP", SUPPLY, address(this), VIRTUAL_NATIVE, 490, 10, 5, bytes32(0), false, 0
        );
        assertEq(AdextoCurve(payable(c)).totalFeeBps(), 500, "total di batas bukan 500 bps");
    }
}
