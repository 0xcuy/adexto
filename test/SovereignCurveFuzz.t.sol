// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CurveFixture} from "./CurveFixture.sol";

/**
 * Fuzz stateless: satu aksi, ribuan besaran.
 *
 * Yang dicari di sini bukan bug logika yang terlihat saat dibaca, melainkan tepi
 * rentang — nilai yang membuat pembulatan berpihak ke pedagang, kuotasi menyimpang
 * dari eksekusi, atau kurva berutang lebih banyak daripada yang dipegangnya.
 * Invarian berurutan (banyak aksi acak) ada di SovereignCurveInvariant.t.sol.
 */
contract SovereignCurveFuzzTest is CurveFixture {
    function setUp() public {
        _launch();
    }

    /// Batas atas dipilih supaya kurva tidak diberi harga di luar rentang yang wajar,
    /// dan batas bawah 1 wei karena justru di situ pembulatan paling mungkin salah arah.
    function _boundBuy(uint256 raw) internal pure returns (uint256) {
        return bound(raw, 1, 100_000 ether);
    }

    // ── 1. Kuotasi harus SAMA dengan eksekusi ──────────────────────────────────
    //
    // Kalau keduanya bisa berbeda, setiap angka yang ditampilkan UI adalah tebakan.
    function testFuzz_buyQuoteMatchesExecution(uint256 rawIn) public {
        uint256 nativeIn = _boundBuy(rawIn);
        vm.deal(address(this), nativeIn);

        (uint256 quoted,,,) = curve.getBuyQuote(nativeIn);
        vm.assume(quoted > 0);

        uint256 before = token.balanceOf(address(this));
        uint256 received = curve.buy{value: nativeIn}(0, address(this), block.timestamp + 1);

        assertEq(received, quoted, "nilai kembalian buy != kuotasi");
        assertEq(token.balanceOf(address(this)) - before, quoted, "token diterima != kuotasi");
        _assertSolvent();
    }

    function testFuzz_sellQuoteMatchesExecution(uint256 rawIn, uint256 sellPct) public {
        uint256 nativeIn = _boundBuy(rawIn);
        vm.deal(address(this), nativeIn);
        (uint256 bought,,,) = curve.getBuyQuote(nativeIn);
        vm.assume(bought > 0);
        curve.buy{value: nativeIn}(0, address(this), block.timestamp + 1);

        uint256 pct = bound(sellPct, 1, 100);
        uint256 amount = (bought * pct) / 100;
        vm.assume(amount > 0);

        (uint256 quotedOut,,,) = curve.getSellQuote(amount);
        vm.assume(quotedOut > 0);

        token.approve(address(curve), amount);
        uint256 balBefore = address(this).balance;
        uint256 out = curve.sell(amount, 0, address(this), block.timestamp + 1);

        assertEq(out, quotedOut, "nilai kembalian sell != kuotasi");
        assertEq(address(this).balance - balBefore, quotedOut, "native diterima != kuotasi");
        _assertSolvent();
    }

    // ── 2. Bolak-balik TIDAK BOLEH menguntungkan pedagang ─────────────────────
    //
    // Beli lalu langsung jual seluruh hasilnya harus mengembalikan LEBIH SEDIKIT
    // daripada yang dibayar. Kalau tidak, kurva bisa dikuras dengan mengulang satu
    // pasangan transaksi — dan fee yang ada tidak cukup menutup pembulatan.
    function testFuzz_roundTripNeverProfitable(uint256 rawIn) public {
        uint256 nativeIn = _boundBuy(rawIn);
        vm.deal(address(this), nativeIn);

        (uint256 bought,,,) = curve.getBuyQuote(nativeIn);
        vm.assume(bought > 0);
        curve.buy{value: nativeIn}(0, address(this), block.timestamp + 1);

        (uint256 back,,,) = curve.getSellQuote(bought);
        vm.assume(back > 0);
        token.approve(address(curve), bought);
        uint256 out = curve.sell(bought, 0, address(this), block.timestamp + 1);

        assertLt(out, nativeIn, "bolak-balik menghasilkan untung: kurva bisa dikuras");
        _assertSolvent();
    }

    // ── 3. Pembulatan selalu berpihak ke kurva ────────────────────────────────
    //
    // Kuotasi memakai pembagian yang membulatkan ke bawah. Yang diperiksa: token
    // yang keluar tidak pernah MELEBIHI hasil produk-konstan eksak.
    function testFuzz_buyRoundsInFavourOfCurve(uint256 rawIn) public view {
        uint256 nativeIn = _boundBuy(rawIn);
        (uint256 reserveNative, uint256 reserveToken) = curve.getReserves();

        (uint256 quoted, uint256 depthFee, uint256 creatorFee, uint256 treasuryFee) = curve.getBuyQuote(nativeIn);
        uint256 dx = nativeIn - depthFee - creatorFee - treasuryFee;
        vm.assume(dx > 0);

        // Nilai eksak sebelum dibulatkan; kuotasi tidak boleh melampauinya.
        uint256 exact = (reserveToken * dx) / (reserveNative + dx);
        assertLe(quoted, exact, "kuotasi melebihi nilai eksak: pembulatan berpihak ke pedagang");
    }

    // ── 4. Fee selalu berjumlah kurang dari masukan ───────────────────────────
    function testFuzz_feesNeverExceedInput(uint256 rawIn) public view {
        uint256 nativeIn = _boundBuy(rawIn);
        (, uint256 depthFee, uint256 creatorFee, uint256 treasuryFee) = curve.getBuyQuote(nativeIn);
        assertLe(depthFee + creatorFee + treasuryFee, nativeIn, "total fee melebihi masukan");
    }

    // ── 5. Tidak ada yang bisa menjual lebih dari yang pernah dilepas kurva ───
    function testFuzz_cannotSellMoreThanOutstanding(uint256 rawIn, uint256 excess) public {
        uint256 nativeIn = _boundBuy(rawIn);
        vm.deal(address(this), nativeIn);
        (uint256 bought,,,) = curve.getBuyQuote(nativeIn);
        vm.assume(bought > 0);
        curve.buy{value: nativeIn}(0, address(this), block.timestamp + 1);

        uint256 outstanding = curve.tokensSold();
        uint256 over = outstanding + bound(excess, 1, 1e30);

        token.approve(address(curve), over);
        vm.expectRevert(bytes("SovereignCurve: exceeds outstanding supply"));
        curve.sell(over, 0, address(this), block.timestamp + 1);
    }

    // ── 6. Buyback dibatasi 1% reserve, siapa pun pemanggilnya ────────────────
    //
    // Buyback memang PERMISSIONLESS; yang menahannya adalah ukuran per panggilan.
    // Jadi yang diuji batasnya, bukan identitas pemanggil.
    function testFuzz_buybackCappedAtOnePercent(uint256 rawIn, address caller) public {
        vm.assume(caller != address(0) && caller.code.length == 0);
        uint256 nativeIn = bound(rawIn, 1 ether, 100_000 ether);
        vm.deal(address(this), nativeIn);
        (uint256 bought,,,) = curve.getBuyQuote(nativeIn);
        vm.assume(bought > 0);
        curve.buy{value: nativeIn}(0, address(this), block.timestamp + 1);

        uint256 treasury = curve.treasuryNative();
        vm.assume(treasury > 0);
        (uint256 reserveNative,) = curve.getReserves();
        uint256 cap = reserveNative / 100;

        // Di atas batas harus revert, dari alamat mana pun.
        if (treasury > cap) {
            vm.prank(caller);
            vm.expectRevert(bytes("SovereignCurve: buyback exceeds 1% of reserve"));
            curve.executeBuyback(cap + 1, 0);
        }

        // Di dalam batas harus berhasil, dari alamat mana pun, dan membakar supply.
        uint256 spend = treasury > cap ? cap : treasury;
        vm.assume(spend > 0);
        (uint256 willBurn,,,) = curve.getBuyQuote(spend);
        vm.assume(willBurn > 0);

        uint256 supplyBefore = token.totalSupply();
        vm.prank(caller);
        curve.executeBuyback(spend, 0);
        assertLt(token.totalSupply(), supplyBefore, "buyback tidak mengurangi supply");
        _assertSolvent();
    }

    // ── 7. Supply tidak pernah bertambah, apa pun yang dilakukan ──────────────
    function testFuzz_supplyNeverGrows(uint256 rawIn) public {
        uint256 supplyBefore = token.totalSupply();
        uint256 nativeIn = _boundBuy(rawIn);
        vm.deal(address(this), nativeIn);
        (uint256 bought,,,) = curve.getBuyQuote(nativeIn);
        vm.assume(bought > 0);
        curve.buy{value: nativeIn}(0, address(this), block.timestamp + 1);
        assertLe(token.totalSupply(), supplyBefore, "supply bertambah setelah beli");

        token.approve(address(curve), bought);
        (uint256 back,,,) = curve.getSellQuote(bought);
        vm.assume(back > 0);
        curve.sell(bought, 0, address(this), block.timestamp + 1);
        assertLe(token.totalSupply(), supplyBefore, "supply bertambah setelah jual");
    }

    // ── 8. Fee creator hanya bisa ke alamat creator ───────────────────────────
    //
    // `claimCreatorFees` tidak menerima parameter tujuan, jadi yang diuji: siapa pun
    // boleh MEMICUnya, tapi uangnya selalu mendarat di creator yang immutable.
    function testFuzz_creatorFeesOnlyReachCreator(uint256 rawIn, address caller) public {
        vm.assume(caller != address(0) && caller != address(this) && caller.code.length == 0);
        uint256 nativeIn = bound(rawIn, 1 ether, 100_000 ether);
        vm.deal(address(this), nativeIn);
        (uint256 bought,,,) = curve.getBuyQuote(nativeIn);
        vm.assume(bought > 0);
        curve.buy{value: nativeIn}(0, address(this), block.timestamp + 1);

        uint256 owed = curve.creatorOwed();
        vm.assume(owed > 0);

        uint256 creatorBefore = address(this).balance;
        uint256 callerBefore = caller.balance;

        vm.prank(caller);
        curve.claimCreatorFees();

        assertEq(address(this).balance - creatorBefore, owed, "creator tidak menerima penuh");
        assertEq(caller.balance, callerBefore, "pemanggil menerima native padahal bukan creator");
        assertEq(curve.creatorOwed(), 0, "utang creator tidak dinolkan");
        _assertSolvent();
    }
}
