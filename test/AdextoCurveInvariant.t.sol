// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AdextoCurveFixture} from "./AdextoCurveFixture.sol";
import {AdextoCurve} from "../contracts/AdextoCurve.sol";
import {AdextoToken} from "../contracts/AdextoToken.sol";

/**
 * Pelaku aksi acak untuk v0.11.0.
 *
 * Sama alasannya dengan CurveHandler v0.10.0: fuzz stateless menguji satu panggilan
 * pada state bersih, dan yang tidak ditangkapnya adalah URUTAN. Bedanya di sini ada
 * kantong keempat yang bisa diklaim siapa pun, jadi urutan yang dicari termasuk
 * "klaim protokol di tengah rentetan jual" — tempat akuntansi yang benar per langkah
 * paling mungkin meleset saat digabung.
 */
contract AdextoCurveHandler {
    AdextoCurve public immutable curve;
    AdextoToken public immutable token;

    /// Ghost: dijumlahkan sendiri supaya invarian tidak bergantung pada penghitung kontrak.
    uint256 public protocolAccrued;
    uint256 public buys;
    uint256 public sells;
    uint256 public buybacks;
    uint256 public creatorClaims;
    uint256 public protocolClaims;

    constructor(AdextoCurve _curve, AdextoToken _token) payable {
        curve = _curve;
        token = _token;
    }

    receive() external payable {}

    /**
     * @dev BATAS BAWAH 0.001 ether, BUKAN 1 wei, DAN ITU BUKAN KELONGGARAN.
     *
     * Versi pertama memakai `_bound(seed, 1, 5_000 ether)`. Karena `_bound` mengambil
     * `seed % rentang`, seed kecil menghasilkan pembelian sebesar beberapa ribu wei —
     * terhadap reserve virtual 1500 ether. Diukur: seed 12345 membeli 12346 wei dan
     * menerima 8.19e9 unit token dari persediaan 1e27.
     *
     * Akibatnya berantai. Penjualan berikutnya mengkuotasi
     * `1.5e21 * jumlah / 1e27`, yang membulat ke NOL untuk jumlah sekecil itu,
     * sehingga handler `return` lebih awal dan `sells` tidak pernah bertambah. Tabel
     * Foundry tetap melaporkan `sell` dipanggil 6604 kali dengan 0 revert, jadi
     * kelihatannya teruji padahal tidak ada satu pun penjualan yang terjadi.
     *
     * Tepi rentang 1 wei tidak hilang dari cakupan: itu justru yang diuji fuzz
     * stateless di AdextoCurveFuzz.t.sol, yang sengaja membatasi dari 1 wei.
     * Berkas ini bertugas mencari URUTAN, dan urutan hanya berarti kalau aksinya
     * benar-benar terjadi.
     */
    function buy(uint256 seed) external {
        uint256 amount = _bound(seed, 0.001 ether, 5_000 ether);
        if (address(this).balance < amount) return;
        (uint256 quoted,,,, uint256 protocolFee) = curve.getBuyQuote(amount);
        if (quoted == 0) return;
        protocolAccrued += protocolFee;
        buys += 1;
        curve.buy{value: amount}(0, address(this), block.timestamp + 1);
    }

    /**
     * @dev Persentase kepemilikan, bukan jumlah absolut, dengan alasan yang sama:
     *      `seed % held` condong ke jumlah kecil yang kuotasinya nol, sedangkan
     *      persentase selalu berskala terhadap yang benar-benar dipegang.
     */
    function sell(uint256 seed) external {
        uint256 held = token.balanceOf(address(this));
        if (held == 0) return;
        uint256 amount = (held * _bound(seed, 1, 100)) / 100;
        if (amount == 0) return;
        (uint256 quoted,,,, uint256 protocolFee) = curve.getSellQuote(amount);
        if (quoted == 0) return;
        token.approve(address(curve), amount);
        protocolAccrued += protocolFee;
        sells += 1;
        curve.sell(amount, 0, address(this), block.timestamp + 1);
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
        (uint256 willBurn,,,,) = curve.getBuyQuote(amount);
        if (willBurn == 0) return;
        buybacks += 1;
        curve.executeBuyback(amount, 0);
    }

    function claimCreator() external {
        if (curve.creatorOwed() == 0) return;
        creatorClaims += 1;
        curve.claimCreatorFees();
    }

    /// Juga permissionless, dan tujuannya immutable, jadi handler boleh memicunya.
    function claimProtocol() external {
        if (curve.protocolOwed() == 0) return;
        protocolClaims += 1;
        curve.claimProtocolFees();
    }

    function _bound(uint256 x, uint256 lo, uint256 hi) private pure returns (uint256) {
        if (hi <= lo) return lo;
        return lo + (x % (hi - lo + 1));
    }
}

contract AdextoCurveInvariantTest is AdextoCurveFixture {
    AdextoCurveHandler internal handler;
    uint256 internal initialSupply;
    uint256 internal lastFloor;
    uint256 internal lastTotalProtocolPaid;

    function setUp() public {
        _launchCurve();
        initialSupply = token.totalSupply();
        lastFloor = curve.floorPriceNativePerToken();

        handler = new AdextoCurveHandler{value: 5_000_000 ether}(curve, token);
        vm.deal(address(handler), 5_000_000 ether);

        targetContract(address(handler));
    }

    /**
     * Invarian 1 — SOLVENSI DENGAN KANTONG KEEMPAT. Ini yang paling penting di sini.
     *
     * Setiap wei yang dipegang kurva harus punya pemilik: kurva, klaim creator,
     * kantong buyback, atau klaim protokol. Kalau `protocolOwed` tertinggal dari
     * jumlah ini, kurva terbaca solven padahal kurang persis sebesar fee protokol
     * yang belum diklaim.
     */
    function invariant_curveAlwaysSolventWithProtocolLeg() public view {
        uint256 accounted =
            curve.realNative() + curve.creatorOwed() + curve.treasuryNative() + curve.protocolOwed();
        assertGe(address(curve).balance, accounted, "kurva insolven setelah urutan aksi acak");
    }

    /**
     * Invarian 2 — tidak ada fee protokol yang hilang atau tercipta.
     *
     * Yang mengendap ditambah yang sudah dibayar harus persis sama dengan yang
     * dihitung handler dari kuotasi. Kalau jumlahnya kurang, ada jalur yang
     * membelanjakan fee protokol ke tempat lain; kalau lebih, ada jalur yang
     * mengendapkannya dua kali.
     */
    function invariant_protocolFeesConserved() public view {
        assertEq(
            curve.protocolOwed() + curve.totalProtocolFeesPaid(),
            handler.protocolAccrued(),
            "fee protokol hilang atau tercipta"
        );
    }

    /**
     * Invarian 3 — fee protokol yang sudah dibayar tidak pernah berkurang.
     *
     * `totalProtocolFeesPaid` hanya ditambah di `claimProtocolFees`. Kalau ia bisa
     * turun, catatan pendapatan protokol tidak bisa dipakai untuk apa pun.
     */
    function invariant_totalProtocolPaidNeverFalls() public {
        uint256 paidNow = curve.totalProtocolFeesPaid();
        assertGe(paidNow, lastTotalProtocolPaid, "total fee protokol terbayar turun");
        lastTotalProtocolPaid = paidNow;
    }

    /**
     * Invarian 4 — treasury protokol tidak pernah menerima lebih dari yang tercatat.
     *
     * Saldo treasury adalah satu-satunya tempat fee protokol boleh mendarat, jadi ia
     * harus sama dengan `totalProtocolFeesPaid`. Lebih besar berarti ada jalur lain
     * yang mengirim uang ke sana — dan jalur yang tidak tercatat tidak bisa diaudit.
     */
    function invariant_treasuryBalanceMatchesPaid() public view {
        assertEq(
            PROTOCOL_TREASURY.balance,
            curve.totalProtocolFeesPaid(),
            "saldo treasury tidak cocok dengan yang tercatat terbayar"
        );
    }

    /**
     * Invarian 5 — lantai harga tidak pernah turun.
     *
     * Kaki protokol keluar dari kurva, jadi kalau ia keliru dihitung sebagai fee depth
     * di suatu tempat, lantai akan naik tanpa uangnya benar-benar ada di kurva —
     * atau turun saat diklaim. Keduanya tertangkap di sini.
     */
    function invariant_floorNeverFalls() public {
        uint256 floorNow = curve.floorPriceNativePerToken();
        assertGe(floorNow, lastFloor, "lantai harga turun");
        lastFloor = floorNow;
    }

    function invariant_supplyNeverGrows() public view {
        assertLe(token.totalSupply(), initialSupply, "total supply bertambah");
    }

    function invariant_tokensSoldWithinCurve() public view {
        assertLe(curve.tokensSold(), curve.curveTokens(), "tokensSold melampaui curveTokens");
    }

    function invariant_inventoryMatchesBalance() public view {
        assertEq(
            token.balanceOf(address(curve)),
            curve.curveTokens() - curve.tokensSold(),
            "persediaan internal tidak cocok dengan saldo ERC-20"
        );
    }

    function invariant_creatorHoldsNoTokens() public view {
        assertEq(token.balanceOf(address(this)), 0, "creator memegang token");
    }

    /**
     * Penjaga terhadap suite yang lolos tanpa menguji apa pun.
     *
     * Ini ditambahkan setelah temuan nyata. `fail_on_revert = false` di foundry.toml
     * memang disengaja — handler menolak aksi yang tidak masuk akal dengan `return`,
     * dan revert dari kontraknya sendiri tidak boleh menghentikan pencarian urutan.
     * Efek sampingnya: kalau SETIAP aksi revert, tidak ada state yang berubah dan
     * seluruh invarian di atas terpenuhi secara hampa.
     *
     * Itu bukan hipotesis. Saat `- protocolFee` dihapus dari akumulasi kurva sebagai
     * uji mutasi, `_assertSolvent` mulai me-revert setiap pembelian; sembilan tes
     * fuzz stateless menangkapnya, tetapi seluruh suite invariant ini LULUS karena
     * handler-nya tidak pernah berhasil melakukan satu pun aksi.
     *
     * `afterInvariant` berjalan sekali di akhir setiap urutan, jadi di sinilah
     * "handler tidak pernah bergerak" bisa dinyatakan gagal. `buys` bertambah sebelum
     * panggilan, sehingga ia ikut ter-rollback kalau panggilannya revert — yang
     * membuat penghitung ini hanya mencatat aksi yang benar-benar berhasil.
     */
    /**
     * Penjaga terhadap suite yang lolos tanpa menguji apa pun.
     *
     * Ini ditambahkan setelah temuan nyata, bukan sebagai kelengkapan. `fail_on_revert
     * = false` di foundry.toml memang disengaja: handler menolak aksi yang tidak masuk
     * akal dengan `return`, dan revert dari kontraknya sendiri tidak boleh
     * menghentikan pencarian urutan. Efek sampingnya: kalau SETIAP aksi gagal, tidak
     * ada state yang berubah dan kesembilan invarian di atas terpenuhi secara hampa.
     *
     * Itu terbukti dua kali di sini. Pertama, saat `- protocolFee` dihapus dari
     * akumulasi kurva sebagai uji mutasi: `_assertSolvent` mulai me-revert setiap
     * pembelian, sembilan tes fuzz stateless menangkapnya, dan seluruh suite invariant
     * ini LULUS. Kedua, dengan batas bawah `_bound` yang lama: `sell` dilaporkan
     * dipanggil 6604 kali dengan 0 revert padahal `sells` tetap nol, karena setiap
     * jumlah jual mengkuotasi ke nol dan handler keluar lebih awal.
     *
     * Ditulis sebagai tes biasa, BUKAN `afterInvariant`. `afterInvariant` sudah dicoba
     * dan ternyata dievaluasi saat urutan baru berjalan satu panggilan, sehingga
     * assertion kumulatif di sana gagal dengan `--match-path` tetapi lolos dengan
     * `--match-test` — penjaga yang hasilnya bergantung pada cara pemanggilan tidak
     * bisa dipercaya. Tes biasa berjalan sekali dan deterministik.
     */
    function test_handlerCanActuallyPerformEveryAction() public {
        handler.buy(uint256(keccak256("buy")));
        assertGt(handler.buys(), 0, "handler tidak bisa membeli: suite invariant akan hampa");

        handler.sell(uint256(keccak256("sell")));
        assertGt(handler.sells(), 0, "handler tidak bisa menjual: suite invariant akan hampa");

        handler.buy(uint256(keccak256("buy2")));
        handler.buyback(uint256(keccak256("buyback")));
        assertGt(handler.buybacks(), 0, "handler tidak bisa buyback: jalur itu tidak teruji");

        handler.claimCreator();
        assertGt(handler.creatorClaims(), 0, "handler tidak bisa klaim creator: jalur itu tidak teruji");

        handler.claimProtocol();
        assertGt(handler.protocolClaims(), 0, "handler tidak bisa klaim protokol: jalur itu tidak teruji");

        // Dan setelah kelima jalur berjalan, akuntansinya harus tetap utuh.
        assertEq(
            curve.protocolOwed() + curve.totalProtocolFeesPaid(),
            handler.protocolAccrued(),
            "fee protokol hilang atau tercipta setelah kelima aksi"
        );
        _assertSolvent();
    }
}
