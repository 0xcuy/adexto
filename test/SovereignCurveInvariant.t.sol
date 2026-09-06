// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CurveFixture} from "./CurveFixture.sol";
import {SovereignCurve} from "../contracts/SovereignCurve.sol";
import {AdextoToken} from "../contracts/AdextoToken.sol";

/**
 * Pelaku aksi acak.
 *
 * Fuzz stateless menguji satu panggilan pada state yang bersih. Yang tidak
 * ditangkapnya adalah URUTAN: beli, jual sebagian, buyback, klaim fee, beli lagi,
 * jual habis — ribuan permutasi. Kelas bug yang hidup di sana adalah akuntansi yang
 * benar per langkah tapi meleset saat digabung, dan itu persis kelas bug yang
 * membuat AMM bisa dikuras.
 *
 * Handler memegang dana dan token, jadi urutan aksinya berjalan seperti satu pedagang
 * nyata alih-alih pemanggil yang tiap kali disetel ulang.
 */
contract CurveHandler {
    SovereignCurve public immutable curve;
    AdextoToken public immutable token;

    /// Ghost: dijumlahkan sendiri supaya invarian tidak bergantung pada penghitung kontrak.
    uint256 public nativeIn;
    uint256 public nativeOut;
    uint256 public buys;
    uint256 public sells;
    uint256 public buybacks;
    uint256 public claims;

    constructor(SovereignCurve _curve, AdextoToken _token) payable {
        curve = _curve;
        token = _token;
    }

    receive() external payable {}

    /**
     * @dev BATAS BAWAH 0.001 ether, BUKAN 1 wei.
     *
     * Versi pertama memakai `_bound(seed, 1, 5_000 ether)`. Karena `_bound` mengambil
     * `seed % rentang`, seed kecil menghasilkan pembelian beberapa ribu wei terhadap
     * reserve virtual 1500 ether. Diukur: seed 12345 membeli 12346 wei dan menerima
     * 8.19e9 unit token dari persediaan 1e27.
     *
     * Akibatnya, `sell` di bawah mengkuotasi `1.5e21 * jumlah / 1e27` yang membulat ke
     * NOL, handler keluar lebih awal, dan `sells` tidak pernah bertambah — sementara
     * tabel Foundry tetap melaporkan `sell` dipanggil ribuan kali dengan 0 revert.
     * Suite ini karena itu tidak pernah benar-benar menguji URUTAN yang mengandung
     * penjualan, yang justru satu-satunya alasan berkas ini ada.
     *
     * Tepi rentang 1 wei tidak hilang: SovereignCurveFuzz.t.sol sengaja membatasi dari
     * 1 wei untuk menguji pembulatan.
     */
    function buy(uint256 seed) external {
        uint256 amount = _bound(seed, 0.001 ether, 5_000 ether);
        if (address(this).balance < amount) return;
        (uint256 quoted,,,) = curve.getBuyQuote(amount);
        if (quoted == 0) return;
        nativeIn += amount;
        buys += 1;
        curve.buy{value: amount}(0, address(this), block.timestamp + 1);
    }

    /// @dev Persentase kepemilikan, bukan jumlah absolut, dengan alasan yang sama.
    function sell(uint256 seed) external {
        uint256 held = token.balanceOf(address(this));
        if (held == 0) return;
        uint256 amount = (held * _bound(seed, 1, 100)) / 100;
        if (amount == 0) return;
        (uint256 quoted,,,) = curve.getSellQuote(amount);
        if (quoted == 0) return;
        token.approve(address(curve), amount);
        sells += 1;
        uint256 got = curve.sell(amount, 0, address(this), block.timestamp + 1);
        nativeOut += got;
    }

    /// Buyback memang permissionless, jadi handler memanggilnya seperti orang lain.
    function buyback(uint256 seed) external {
        uint256 treasury = curve.treasuryNative();
        if (treasury == 0) return;
        (uint256 reserveNative,) = curve.getReserves();
        uint256 cap = reserveNative / 100;
        uint256 max = treasury < cap ? treasury : cap;
        if (max == 0) return;
        uint256 amount = _bound(seed, 1, max);
        (uint256 willBurn,,,) = curve.getBuyQuote(amount);
        if (willBurn == 0) return;
        buybacks += 1;
        curve.executeBuyback(amount, 0);
    }

    function claim() external {
        if (curve.creatorOwed() == 0) return;
        claims += 1;
        curve.claimCreatorFees();
    }

    function _bound(uint256 x, uint256 lo, uint256 hi) private pure returns (uint256) {
        if (hi <= lo) return lo;
        return lo + (x % (hi - lo + 1));
    }
}

contract SovereignCurveInvariantTest is CurveFixture {
    CurveHandler internal handler;
    uint256 internal initialSupply;
    uint256 internal initialCurveTokens;
    uint256 internal lastFloor;

    function setUp() public {
        _launch();
        initialSupply = token.totalSupply();
        initialCurveTokens = curve.curveTokens();
        lastFloor = curve.floorPriceNativePerToken();

        handler = new CurveHandler{value: 5_000_000 ether}(curve, token);
        vm.deal(address(handler), 5_000_000 ether);

        // Hanya handler yang boleh jadi pelaku; tanpa ini fuzzer memanggil kontrak
        // test itu sendiri dan urutannya jadi tidak berarti.
        targetContract(address(handler));
    }

    /**
     * Invarian 1 — SOLVENSI. Ini yang paling penting di berkas ini.
     *
     * Setiap wei yang dipegang kurva harus punya pemilik: kurva, klaim creator, atau
     * kantong buyback. Kekurangan berarti ada jalur pembayaran yang membelanjakan
     * uang yang bukan miliknya, dan itu berarti pasar bisa dikuras.
     */
    function invariant_curveAlwaysSolvent() public view {
        uint256 accounted = curve.realNative() + curve.creatorOwed() + curve.treasuryNative();
        assertGe(address(curve).balance, accounted, "kurva insolven setelah urutan aksi acak");
    }

    /**
     * Invarian 2 — supply tidak pernah bertambah.
     *
     * `_mint` hanya dipanggil sekali di konstruktor dan tidak ada fungsi mint, jadi
     * satu-satunya arah yang mungkin adalah turun (lewat pembakaran buyback).
     */
    function invariant_supplyNeverGrows() public view {
        assertLe(token.totalSupply(), initialSupply, "total supply bertambah");
    }

    /**
     * Invarian 3 — kurva tidak bisa menjual lebih dari yang dimuatnya.
     *
     * `_tokensSold` naik saat beli dan saat buyback, dan turun saat jual. Kalau ia
     * bisa melampaui `curveTokens`, `curveTokens - _tokensSold` akan underflow dan
     * reserve token terbaca raksasa.
     */
    function invariant_tokensSoldWithinCurve() public view {
        assertLe(curve.tokensSold(), curve.curveTokens(), "tokensSold melampaui curveTokens");
    }

    /**
     * Invarian 4 — lantai harga tidak pernah turun.
     *
     * Lantai dihitung dari `virtualNative + totalDepthFeesRetained` dibagi
     * `curveTokens`. Pembilangnya hanya bertambah dan penyebutnya tetap, jadi lantai
     * yang turun berarti salah satu asumsi itu patah — misalnya fee depth
     * dibelanjakan, bukan diendapkan.
     */
    function invariant_floorNeverFalls() public {
        uint256 floorNow = curve.floorPriceNativePerToken();
        assertGe(floorNow, lastFloor, "lantai harga turun");
        lastFloor = floorNow;
    }

    /**
     * Invarian 5 — akuntansi cocok dengan saldo ERC-20 sesungguhnya.
     *
     * Kurva percaya `curveTokens - _tokensSold` sebagai persediaannya. Kalau angka itu
     * berbeda dari saldo token yang benar-benar dipegangnya, salah satu sisi bohong —
     * dan buyback membakar dari saldo NYATA sementara kuotasi memakai angka internal.
     */
    function invariant_inventoryMatchesBalance() public view {
        assertEq(
            token.balanceOf(address(curve)),
            curve.curveTokens() - curve.tokensSold(),
            "persediaan internal tidak cocok dengan saldo ERC-20"
        );
    }

    /**
     * Invarian 6 — creator tidak pernah menerima token.
     *
     * Seluruh model bertumpu pada ini: creator dibayar dari irisan fee, bukan alokasi.
     * Kalau saldo tokennya pernah bukan nol, klaim "tidak ada supply untuk di-dump"
     * batal.
     */
    function invariant_creatorHoldsNoTokens() public view {
        assertEq(token.balanceOf(address(this)), 0, "creator memegang token");
    }

    /**
     * Penjaga terhadap suite yang lolos tanpa menguji apa pun.
     *
     * `fail_on_revert = false` disengaja, dan handler menolak aksi mustahil dengan
     * `return`. Gabungan keduanya berarti suite yang setiap aksinya gagal akan
     * memenuhi seluruh invarian di atas secara HAMPA, dan lolos.
     *
     * Itu bukan hipotesis: dengan batas `_bound` yang lama, `sell` dilaporkan
     * dipanggil ribuan kali dengan 0 revert padahal `sells` tetap nol sepanjang suite.
     * Tidak ada satu pun invarian yang bisa memberi tahu, karena semuanya benar
     * tentang state yang tidak pernah berubah.
     */
    function test_handlerCanActuallyPerformEveryAction() public {
        handler.buy(uint256(keccak256("buy")));
        assertGt(handler.buys(), 0, "handler tidak bisa membeli: suite invariant akan hampa");

        handler.sell(uint256(keccak256("sell")));
        assertGt(handler.sells(), 0, "handler tidak bisa menjual: suite invariant akan hampa");

        handler.buy(uint256(keccak256("buy2")));
        handler.buyback(uint256(keccak256("buyback")));
        assertGt(handler.buybacks(), 0, "handler tidak bisa buyback: jalur itu tidak teruji");

        handler.claim();
        assertGt(handler.claims(), 0, "handler tidak bisa klaim fee creator: jalur itu tidak teruji");

        _assertSolvent();
    }
}
