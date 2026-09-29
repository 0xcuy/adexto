// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {AdextoFactory} from "../contracts/AdextoFactory.sol";
import {AdextoCurve} from "../contracts/AdextoCurve.sol";
import {AdextoToken} from "../contracts/AdextoToken.sol";

/**
 * Fixture bersama untuk v0.11.0: satu peluncuran nyata lewat factory, bukan kurva
 * yang dirakit tangan di dalam test.
 *
 * Alasannya sama dengan CurveFixture: merakit kurva langsung memungkinkan state yang
 * tidak pernah bisa terjadi di produksi, dan properti yang lolos di state mustahil
 * tidak membuktikan apa pun. Di sini jalurnya sama dengan yang dipakai orang.
 *
 * Yang khusus di sini: `PROTOCOL_TREASURY` sengaja BUKAN `address(this)`. Fixture
 * lama memakai `address(this)` sebagai creator, jadi kalau treasury protokol memakai
 * alamat yang sama, test "fee protokol mendarat di treasury" akan lolos hanya karena
 * kedua saldo itu satu alamat — dan pengalihan fee protokol ke creator tidak akan
 * terdeteksi.
 */
abstract contract AdextoCurveFixture is Test {
    AdextoFactory internal factory;
    AdextoCurve internal curve;
    AdextoToken internal token;

    /// EOA tanpa kode, jadi `call` bernilai ke sini pasti berhasil.
    address internal constant PROTOCOL_TREASURY = address(0xBEEF);

    /**
     * Model peluncuran 0.12.0: total 100 bps, dan 100 bps itu yang dibayar trader.
     *
     * Angkanya sengaja sama dengan preset studio, bukan angka yang enak untuk test.
     * Fixture yang memakai tarif berbeda dari produksi akan membuktikan properti pada
     * pembagian fee yang tidak pernah dipakai siapa pun — dan pembagian itulah yang
     * paling mungkin salah, karena ia satu-satunya tempat keempat kaki berinteraksi.
     *
     * Naik dari 30 bps (0.11.0) dan pembagiannya berubah arah: dulu `PROTOCOL_BPS`
     * ADITIF sehingga 30 yang dikonfigurasi menjadi 40 yang dibayar, sekarang ia
     * DIPOTONG DARI DALAM sehingga yang dikonfigurasi dan yang dibayar adalah angka
     * yang sama. `TOTAL_PAID_BPS` karena itu kini sama dengan `SWAP_FEE_BPS`, dan
     * dibiarkan sebagai konstanta terpisah justru supaya test nomor 1 bisa gagal kalau
     * suatu saat keduanya berpisah lagi tanpa disengaja.
     */
    uint256 internal constant SWAP_FEE_BPS = 100;
    uint256 internal constant CREATOR_BPS = 70;
    uint256 internal constant TREASURY_BPS = 10;
    uint256 internal constant PROTOCOL_BPS = 10;
    /// depth = 100 - 70 - 10 - 10 = 10, dihitung oleh factory sebagai sisa, bukan diteruskan.
    uint256 internal constant DEPTH_BPS = 10;
    uint256 internal constant TOTAL_PAID_BPS = 100;

    /**
     * Generasi yang ditulis SOURCE, bukan yang ter-deploy.
     *
     * Satu tempat saja, karena angkanya dulu tertanam dua kali di satu test sehingga naik ke
     * 0.12.0 menuntut dua suntingan berbarengan. Nilainya sengaja boleh berbeda dari
     * `src/config/contracts.ts`, yang mencatat generasi HIDUP di chain — perbedaan itu normal
     * selama 0.12.0 belum di-deploy.
     */
    string internal constant SOURCE_VERSION = "0.12.0";

    uint256 internal constant SUPPLY = 1_000_000_000;
    /// Sama besaran dengan pembukaan 0G di produksi.
    uint256 internal constant VIRTUAL_NATIVE = 1500 ether;

    /**
     * Ticker yang dicadangkan di constructor factory 0.12.0.
     *
     * SATU SUMPER KEBENARAN untuk fixture dan test, dan harus sama dengan yang dikirim
     * `scripts/deploy-sovereign-curve.mjs` saat broadcast. Kalau keduanya berpisah, test
     * membuktikan perlindungan atas daftar yang tidak pernah ter-deploy.
     *
     * Enam pertama adalah pasar yang hidup di UI. Sepuluh sisanya nama aset besar, yang
     * dicadangkan bukan untuk melindungi kami tetapi supaya token kurva tidak bisa
     * disalahbaca sebagai aset sungguhan — alasan yang berlaku sama kuat untuk token yang
     * kami luncurkan sendiri, jadi tidak ada pengecualian untuk siapa pun.
     */
    function reservedSymbols() internal pure returns (string[] memory list) {
        list = new string[](16);
        // Pasar yang live di UI.
        list[0] = "ADEXTO";
        list[1] = "ADT";
        list[2] = "ZEEBO";
        list[3] = "WOMBO";
        list[4] = "BLOOP";
        list[5] = "PARCEL";
        // Nama aset besar.
        list[6] = "ETH";
        list[7] = "WETH";
        list[8] = "USDC";
        list[9] = "USDT";
        list[10] = "BTC";
        list[11] = "WBTC";
        list[12] = "0G";
        list[13] = "A0GI";
        list[14] = "MON";
        list[15] = "ARB";
    }

    function _launchCurve() internal {
        // Daftar cadangan PRODUKSI, bukan daftar kosong. Fixture yang men-deploy factory
        // tanpa cadangan akan menguji kontrak yang tidak pernah di-broadcast, dan
        // "FUZZ2" di bawah justru membuktikan ticker di luar daftar tetap bisa
        // diluncurkan — properti yang hilang kalau daftarnya kosong.
        factory = new AdextoFactory(PROTOCOL_TREASURY, reservedSymbols());
        (address t, address c) = factory.deployTrinity(
            "Adexto Curve Fuzz Agent",
            "FUZZ2",
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
        curve = AdextoCurve(payable(c));

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
     * Invarian solvensi untuk v0.11.0, ditulis SEKALI.
     *
     * `protocolOwed` WAJIB ada di jumlah ini. Menambah kaki fee yang mengendapkan
     * saldo tanpa memasukkannya ke sini akan membuat pemeriksaan lolos memakai uang
     * yang sudah punya pemilik lain: kurva terbaca solven padahal kurang persis
     * sebesar fee protokol yang belum diklaim, dan kekurangannya baru muncul sebagai
     * penjualan gagal bagi siapa pun yang kebetulan terakhir.
     */
    function _assertSolvent() internal view {
        uint256 accounted =
            curve.realNative() + curve.creatorOwed() + curve.treasuryNative() + curve.protocolOwed();
        assertGe(address(curve).balance, accounted, "kurva insolven: saldo < yang tercatat");
    }

    /// Kurva membayar penjual dan pengklaim fee, jadi fixture harus bisa menerima native.
    receive() external payable {}
}
