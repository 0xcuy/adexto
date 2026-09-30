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
        assertEq(curve.depthFeeBps(), DEPTH_BPS, "depth bukan 10 bps");
        assertEq(curve.creatorFeeBps(), CREATOR_BPS, "creator bukan 70 bps");
        assertEq(curve.treasuryBuybackBps(), TREASURY_BPS, "buyback bukan 10 bps");
        assertEq(curve.protocolFeeBps(), PROTOCOL_BPS, "protokol bukan 10 bps");
        assertEq(curve.totalFeeBps(), TOTAL_PAID_BPS, "total yang dibayar bukan 100 bps");
        assertEq(factory.PROTOCOL_FEE_BPS(), PROTOCOL_BPS, "konstanta factory bukan 10 bps");
        /**
         * Keempat kaki HARUS berjumlah tepat `swapFeeBps`, dan ini yang membedakan 0.12.0
         * dari 0.11.0 dalam satu baris. Di 0.11.0 jumlahnya `swapFeeBps + 10` karena kaki
         * protokol ditagih di atasnya; di sini tidak ada apa pun yang ditagih di atas, jadi
         * angka yang dikutip ke trader adalah angka yang dikonfigurasi pembuat pasar.
         */
        assertEq(
            curve.depthFeeBps() + curve.creatorFeeBps() + curve.treasuryBuybackBps() + curve.protocolFeeBps(),
            SWAP_FEE_BPS,
            "keempat kaki tidak berjumlah swapFeeBps: ada yang ditagih di luar kuotasi"
        );
        assertEq(curve.protocolTreasury(), PROTOCOL_TREASURY, "treasury protokol salah");
        // Dibandingkan dengan SATU konstanta, dan satu sama lain. Yang kedua itu invarian
        // sebenarnya: factory menanam creation code kurva, jadi dua nomor berbeda berarti
        // salah satunya tidak pernah diperbarui.
        assertEq(curve.VERSION(), SOURCE_VERSION, "versi kurva salah");
        assertEq(factory.VERSION(), SOURCE_VERSION, "versi factory salah");
        assertEq(curve.VERSION(), factory.VERSION(), "versi kurva dan factory berbeda");
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

    // ── 5. Fee protokol DIPOTONG DARI DALAM, bukan ditagih di atas ────────────
    //
    // DIBALIK DI 0.12.0. Properti ini dulu bernama `testFuzz_protocolFeeIsAdditiveNotCarvedOut`
    // dan membuktikan kebalikan persis dari yang sekarang: bahwa 10 bps protokol ditagih
    // DI ATAS `swapFeeBps`, sehingga pembeli 0.11.0 menerima lebih sedikit token daripada
    // pembeli 0.10.0 pada konfigurasi yang sama.
    //
    // Dibalik dan bukan dihapus, karena properti yang dihapus tidak meninggalkan jejak
    // bahwa perilakunya pernah berbeda. Yang dibuktikan sekarang, masih dengan cara yang
    // sama — membandingkan langsung terhadap kurva 0.10.0 yang dikonfigurasi identik:
    //
    //   1. `depthFeeBps` BERBEDA, tepat sebesar `PROTOCOL_BPS`. Depth adalah sisa, jadi
    //      di situlah kaki protokol diambil pada `swapFeeBps` yang sama.
    //   2. creator dan buyback IDENTIK. Carve-out tidak boleh menyentuh dua kaki yang
    //      sudah dijanjikan ke orang: creator dibayar, buyback dibakar.
    //   3. total yang dibayar IDENTIK, jadi pembeli menerima jumlah token yang SAMA.
    //      Ini pembuktian "tidak ada tambahan di luar kuotasi", dan di 0.11.0 justru
    //      assertion inilah yang gagal.
    //
    // Perhatikan bahwa (1) hanya berlaku saat `swapFeeBps` kedua kurva disetel sama.
    // Pada model peluncuran 0.12.0 yang sebenarnya, `swapFeeBps` naik 30 -> 100, sehingga
    // creator justru naik 10 -> 70 bps. Tidak ada yang dibayar lebih sedikit; yang berubah
    // adalah angka yang fee-nya dipotong dari situ.
    function testFuzz_protocolFeeIsCarvedOutNotAdditive(uint256 rawIn) public {
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

        // 1. Depth menyerap kaki protokol, tepat sebesar PROTOCOL_BPS dan tidak lebih.
        assertEq(
            legacy.depthFeeBps() - curve.depthFeeBps(),
            PROTOCOL_BPS,
            "selisih depth bukan tepat PROTOCOL_BPS: carve-out mengambil dari tempat lain"
        );

        // 2. Dua kaki yang sudah dijanjikan ke orang tidak boleh tersentuh.
        assertEq(legacy.creatorFeeBps(), curve.creatorFeeBps(), "creator berbeda: protokol mengambil dari creator");
        assertEq(
            legacy.treasuryBuybackBps(), curve.treasuryBuybackBps(), "buyback berbeda: protokol mengambil dari buyback"
        );

        // 3. Total dalam bps identik, jadi tidak ada satu pun kaki yang ditagih di atas.
        assertEq(
            curve.totalFeeBps(),
            legacy.lpFeeBps() + legacy.creatorFeeBps() + legacy.treasuryBuybackBps(),
            "total 0.12.0 != total 0.10.0 pada swapFeeBps yang sama: ada kaki yang ditagih di atas"
        );

        uint256 nativeIn = bound(rawIn, 1 ether, 100_000 ether);
        (uint256 legacyOut, uint256 lDepth, uint256 lCreator, uint256 lTreasury) = legacy.getBuyQuote(nativeIn);
        (uint256 v2Out, uint256 nDepth, uint256 nCreator, uint256 nTreasury, uint256 protocolFee) =
            curve.getBuyQuote(nativeIn);
        vm.assume(legacyOut > 0 && v2Out > 0);

        assertGt(protocolFee, 0, "fee protokol nol pada pembelian berukuran nyata");

        /**
         * Total dalam WEI tidak persis sama, dan itu benar — bukan toleransi yang dikarang.
         *
         * Tiap kaki dipotong sendiri-sendiri: `(nativeIn * bps) / 10_000`, membulat ke bawah.
         * 0.10.0 memotong TIGA kali, 0.12.0 memotong EMPAT kali karena depth 20 bps terbelah
         * menjadi depth 10 + protokol 10. Dan `floor(x*20)` bisa lebih besar 1 wei daripada
         * `floor(x*10) + floor(x*10)`. Jadi selisih maksimumnya tepat 1 wei, bisa dihitung,
         * bukan diperkirakan — dan batas ketat inilah yang akan gagal kalau suatu saat sebuah
         * kaki benar-benar bergeser, yang tidak akan terdeteksi oleh `assertApproxEq` berpagu
         * longgar.
         *
         * Arahnya juga ditegaskan: pembulatan ekstra membuat fee LEBIH KECIL, jadi selisihnya
         * menguntungkan trader. Kalau tandanya terbalik, kurva memungut lebih dari yang
         * dikonfigurasi dan itu temuan, bukan pembulatan.
         */
        uint256 legacyTotalFee = lDepth + lCreator + lTreasury;
        uint256 newTotalFee = nDepth + nCreator + nTreasury + protocolFee;
        assertLe(newTotalFee, legacyTotalFee, "fee 0.12.0 melebihi 0.10.0: carve-out memungut lebih");
        assertLe(legacyTotalFee - newTotalFee, 1, "selisih fee > 1 wei: ada kaki yang benar-benar bergeser");

        // Konsekuensi langsung dari kalimat di atas: pembeli tidak pernah lebih buruk.
        assertGe(v2Out, legacyOut, "pembeli 0.12.0 menerima lebih sedikit: fee protokol bukan carve-out murni");
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
        new AdextoFactory(address(0), new string[](0));
    }

    // ── 11. Batas 5% dihitung atas apa yang BENAR-BENAR dibayar pedagang ──────
    //
    // Klaimnya tidak berubah di 0.12.0 — batasnya tetap atas yang dibayar trader — tetapi
    // ARITMETIKANYA berubah, jadi angka di test ini pun berubah. Karena kaki protokol
    // sekarang dipotong dari dalam, `swapFeeBps` ITU SENDIRI adalah yang dibayar: 500 bps
    // sekarang SAH dan tepat di batas, sementara di 0.11.0 ia ditolak karena 500 + 10 = 510.
    //
    // Batas itu diuji dari kedua sisi dengan sengaja. Menguji hanya sisi yang ditolak akan
    // tetap lolos kalau batasnya diam-diam bergeser ke bawah, dan pasar yang sah jadi
    // mustahil diluncurkan tanpa ada satu pun test yang mengeluh.
    function test_capCountsProtocolLeg() public {
        vm.expectRevert(bytes("Factory: fee too high"));
        factory.deployTrinity(
            "Over Cap", "OVER", SUPPLY, address(this), VIRTUAL_NATIVE, 501, 10, 5, bytes32(0), false, 0
        );

        // 500 tepat di batas, dan protokol ada DI DALAMnya: depth = 500 - 10 - 5 - 10 = 475.
        (, address c) = factory.deployTrinity(
            "At Cap", "ATCAP", SUPPLY, address(this), VIRTUAL_NATIVE, 500, 10, 5, bytes32(0), false, 0
        );
        assertEq(AdextoCurve(payable(c)).totalFeeBps(), 500, "total di batas bukan 500 bps");
        assertEq(AdextoCurve(payable(c)).depthFeeBps(), 475, "depth di batas bukan 475 bps");
    }

    // ── 12. `swapFeeBps` yang tidak menyisakan ruang untuk kaki protokol ditolak ─
    //
    // Konsekuensi langsung dari carve-out, dan satu-satunya cara ia bisa gagal buruk.
    // Tanpa `PROTOCOL_FEE_BPS` di dalam require pembagian share, subtraksi yang menghitung
    // `depthFeeBps` akan underflow — di solc 0.8.x itu panic tanpa pesan, jadi pembuat pasar
    // melihat revert tak berpenjelasan untuk pembagian fee yang bagi dia terlihat benar.
    //
    // Dua kasus, karena keduanya gagal lewat jalan yang berbeda: fee yang lebih kecil dari
    // kaki protokol, dan fee yang cukup besar tetapi sudah dihabiskan dua share lainnya.
    function test_feeTooSmallForProtocolLegRejected() public {
        vm.expectRevert(bytes("Factory: shares exceed fee"));
        factory.deployTrinity(
            "Tiny Fee", "TINY", SUPPLY, address(this), VIRTUAL_NATIVE, 5, 0, 0, bytes32(0), false, 0
        );

        vm.expectRevert(bytes("Factory: shares exceed fee"));
        factory.deployTrinity(
            "No Room", "NOROOM", SUPPLY, address(this), VIRTUAL_NATIVE, 100, 70, 30, bytes32(0), false, 0
        );

        // Tepat menyisakan ruang: 70 + 20 + 10 = 100, depth 0. Sah, dan depth nol memang
        // diizinkan — yang tidak diizinkan adalah kaki protokol yang tidak kebagian.
        (, address c) = factory.deployTrinity(
            "Exact Room", "EXACT", SUPPLY, address(this), VIRTUAL_NATIVE, 100, 70, 20, bytes32(0), false, 0
        );
        assertEq(AdextoCurve(payable(c)).depthFeeBps(), 0, "depth bukan nol saat ruang habis tepat");
        assertEq(AdextoCurve(payable(c)).protocolFeeBps(), PROTOCOL_BPS, "kaki protokol hilang saat ruang habis tepat");
    }

    // ── 13. Ticker yang dicadangkan di constructor tidak bisa diluncurkan siapa pun ──
    //
    // Ini yang menutup lubang nyata: `symbolRegistry` adalah state MILIK SATU FACTORY,
    // jadi factory baru lahir dengan buku kosong dan setiap nama yang sudah dipakai
    // generasi sebelumnya bebas diklaim lagi. Terukur pada keempat factory 0.11.0 yang
    // live sebelum perubahan ini: "ETH", "USDC" dan "BTC" bebas di keempat chain, dan
    // "ADEXTO" bebas di Base, Arbitrum dan Monad.
    //
    // Diuji dari DUA alamat, dan itu bukan pengulangan: `deployTrinity` tidak punya access
    // control sama sekali, jadi yang harus dibuktikan bukan "orang lain ditolak" melainkan
    // "SEMUA ORANG ditolak, termasuk yang men-deploy factory ini". Kalau suatu saat
    // pengecualian untuk deployer diselipkan, assertion kedua yang menangkapnya.
    function test_reservedSymbolsCannotBeLaunchedByAnyone() public {
        string[] memory reserved = reservedSymbols();
        address stranger = address(0xC0FFEE);

        for (uint256 i = 0; i < reserved.length; i++) {
            // Dari alamat yang men-deploy factory.
            vm.expectRevert(bytes("Factory: symbol already taken"));
            factory.deployTrinity(
                "Squat", reserved[i], SUPPLY, address(this), VIRTUAL_NATIVE,
                SWAP_FEE_BPS, CREATOR_BPS, TREASURY_BPS, bytes32(0), false, 0
            );

            // Dari alamat asing.
            vm.prank(stranger);
            vm.expectRevert(bytes("Factory: symbol already taken"));
            factory.deployTrinity(
                "Squat", reserved[i], SUPPLY, stranger, VIRTUAL_NATIVE,
                SWAP_FEE_BPS, CREATOR_BPS, TREASURY_BPS, bytes32(0), false, 0
            );

            assertFalse(factory.isSymbolAvailable(reserved[i]), "isSymbolAvailable masih true untuk ticker cadangan");
            assertEq(
                factory.symbolRegistry(keccak256(abi.encodePacked(reserved[i]))),
                factory.SYMBOL_RESERVED(),
                "slot cadangan tidak berisi penanda"
            );
        }
    }

    // ── 14. Cadangan tidak peka huruf besar-kecil ─────────────────────────────
    //
    // `_toUpper` dipakai di constructor DAN di `deployTrinity`. Tanpa itu, mencadangkan
    // "ETH" tidak akan menghalangi peluncuran "eth" — nama yang sama bagi setiap pembaca
    // manusia, dan justru bentuk penyerobotan yang paling mudah dilewatkan.
    function test_reservedSymbolIsCaseInsensitive() public {
        vm.expectRevert(bytes("Factory: symbol already taken"));
        factory.deployTrinity(
            "lowercase eth", "eth", SUPPLY, address(this), VIRTUAL_NATIVE,
            SWAP_FEE_BPS, CREATOR_BPS, TREASURY_BPS, bytes32(0), false, 0
        );
        assertFalse(factory.isSymbolAvailable("eth"), "eth huruf kecil masih tersedia");
        assertFalse(factory.isSymbolAvailable("EtH"), "EtH campuran masih tersedia");
    }

    // ── 15. Ticker DI LUAR daftar cadangan tetap bisa diluncurkan ─────────────
    //
    // Pasangan wajib dari test 13. Cadangan yang terlalu lebar akan mematikan produknya,
    // dan kegagalan seperti itu tidak akan tertangkap oleh test yang hanya memastikan
    // penolakan. Fixture sendiri sudah meluncurkan "FUZZ2" dengan daftar produksi
    // terpasang, jadi ini menegaskannya untuk ticker kedua yang tidak dipakai fixture.
    function test_unreservedSymbolStillLaunches() public {
        (address t, address c) = factory.deployTrinity(
            "Not Reserved", "NOTRSV", SUPPLY, address(this), VIRTUAL_NATIVE,
            SWAP_FEE_BPS, CREATOR_BPS, TREASURY_BPS, bytes32(0), false, 0
        );
        assertTrue(t != address(0) && c != address(0), "peluncuran ticker bebas gagal");
        assertFalse(factory.isSymbolAvailable("NOTRSV"), "ticker tidak terklaim setelah diluncurkan");
        assertEq(factory.symbolRegistry(keccak256(abi.encodePacked("NOTRSV"))), t, "slot tidak berisi alamat token");
    }

    // ── 16. Penanda cadangan tidak bisa tertukar dengan token sungguhan ───────
    //
    // `symbolRegistry` memetakan ticker ke ALAMAT TOKEN, dan slot cadangan tidak punya
    // token. Yang dijaga di sini: penandanya adalah alamat tanpa kode, jadi tidak ada
    // pembaca yang bisa memperlakukannya sebagai ERC-20 dan mendapat jawaban.
    function test_reservedMarkerIsNotAContract() public view {
        address marker = factory.SYMBOL_RESERVED();
        assertEq(marker.code.length, 0, "penanda cadangan punya kode: bisa disalahbaca sebagai token");
        assertTrue(marker != address(0), "penanda cadangan nol: slot akan terbaca sebagai tersedia");
    }

    // ── 17–20. Empat properti yang dulu HANYA ada di kurva 0.10.0 ──────────────
    //
    // Diport 2026-09-30. Sebelumnya `SovereignCurveFuzz.t.sol` satu-satunya tempat arah
    // pembulatan beli, klaim creator, batas jual, dan batas 1% buyback diuji sebagai properti
    // sendiri — padahal kurva yang dipakai meluncurkan adalah yang ini. Versinya di sini
    // memakai EMPAT kaki fee (termasuk protokol) dan cooldown buyback 0.12.0.

    // 17. Pembulatan beli berpihak ke kurva. Dibandingkan dengan nilai rasional EKSAK lewat
    //     perkalian silang, bukan dengan pembagian bulat kedua yang pasti sama dengan kuotasi.
    function testFuzz_buyRoundsInFavourOfCurve(uint256 rawIn) public view {
        uint256 nativeIn = _boundBuy(rawIn);
        (uint256 reserveNative, uint256 reserveToken) = curve.getReserves();
        (uint256 quoted, uint256 depthFee, uint256 creatorFee, uint256 treasuryFee, uint256 protocolFee) =
            curve.getBuyQuote(nativeIn);
        uint256 dx = nativeIn - depthFee - creatorFee - treasuryFee - protocolFee;
        vm.assume(dx > 0);
        assertLe(
            quoted * (reserveNative + dx),
            reserveToken * dx,
            "kuotasi melebihi nilai eksak: pembulatan berpihak ke pedagang"
        );
    }

    // 18. Tidak bisa menjual lebih dari yang beredar, berapa pun kelebihannya.
    function testFuzz_cannotSellMoreThanOutstanding(uint256 rawIn, uint256 excess) public {
        uint256 nativeIn = _boundBuy(rawIn);
        vm.deal(address(this), nativeIn);
        (uint256 bought,,,,) = curve.getBuyQuote(nativeIn);
        vm.assume(bought > 0);
        curve.buy{value: nativeIn}(0, address(this), block.timestamp + 1);

        uint256 over = curve.tokensSold() + bound(excess, 1, 1e30);
        token.approve(address(curve), over);
        vm.expectRevert(bytes("AdextoCurve: exceeds outstanding supply"));
        curve.sell(over, 0, address(this), block.timestamp + 1);
    }

    // 19. Buyback dibatasi 1% cadangan per panggilan, dari alamat mana pun, dan membakar supply.
    //     Ini buyback PERTAMA kurva ini (`lastBuybackAt == 0`), jadi yang diuji batasnya, bukan
    //     cooldown — cooldown punya suite sendiri di AdextoBuybackCooldown.t.sol.
    function testFuzz_buybackCappedAtOnePercent(uint256 rawIn, address caller) public {
        vm.assume(caller != address(0) && caller.code.length == 0);
        uint256 nativeIn = bound(rawIn, 1 ether, 100_000 ether);
        vm.deal(address(this), nativeIn);
        (uint256 bought,,,,) = curve.getBuyQuote(nativeIn);
        vm.assume(bought > 0);
        curve.buy{value: nativeIn}(0, address(this), block.timestamp + 1);

        uint256 treasury = curve.treasuryNative();
        vm.assume(treasury > 0);
        (uint256 reserveNative,) = curve.getReserves();
        uint256 cap = reserveNative / 100;

        if (treasury > cap) {
            vm.prank(caller);
            vm.expectRevert(bytes("AdextoCurve: buyback exceeds 1% of reserve"));
            curve.executeBuyback(cap + 1, 0);
        }

        uint256 spend = treasury > cap ? cap : treasury;
        vm.assume(spend > 0);
        (uint256 willBurn,,,,) = curve.getBuyQuote(spend);
        vm.assume(willBurn > 0);

        uint256 supplyBefore = token.totalSupply();
        vm.prank(caller);
        curve.executeBuyback(spend, 0);
        assertLt(token.totalSupply(), supplyBefore, "buyback tidak mengurangi supply");
        _assertSolvent();
    }

    // 20. Klaim creator hanya sampai ke creator, siapa pun pemanggilnya, dan tidak menyentuh
    //     treasury protokol — kaki keempat yang tidak ada di kurva 0.10.0.
    function testFuzz_creatorFeesOnlyReachCreator(uint256 rawIn, address caller) public {
        vm.assume(
            caller != address(0) && caller != address(this) && caller != PROTOCOL_TREASURY && caller.code.length == 0
        );
        uint256 nativeIn = bound(rawIn, 1 ether, 100_000 ether);
        vm.deal(address(this), nativeIn);
        (uint256 bought,,,,) = curve.getBuyQuote(nativeIn);
        vm.assume(bought > 0);
        curve.buy{value: nativeIn}(0, address(this), block.timestamp + 1);

        uint256 owed = curve.creatorOwed();
        vm.assume(owed > 0);
        uint256 creatorBefore = address(this).balance;
        uint256 callerBefore = caller.balance;
        uint256 treasuryBefore = PROTOCOL_TREASURY.balance;
        uint256 protocolOwedBefore = curve.protocolOwed();

        vm.prank(caller);
        curve.claimCreatorFees();

        assertEq(address(this).balance - creatorBefore, owed, "creator tidak menerima penuh");
        assertEq(caller.balance, callerBefore, "pemanggil menerima native padahal bukan creator");
        assertEq(PROTOCOL_TREASURY.balance, treasuryBefore, "klaim creator memindahkan native ke treasury protokol");
        assertEq(curve.protocolOwed(), protocolOwedBefore, "klaim creator mengubah utang protokol");
        assertEq(curve.creatorOwed(), 0, "utang creator tidak dinolkan");
        _assertSolvent();
    }
}
