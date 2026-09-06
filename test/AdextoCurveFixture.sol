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

    /// Nilai yang sama dengan preset "standard" di studio: total 30 bps yang dikonfigurasi.
    uint256 internal constant SWAP_FEE_BPS = 30;
    uint256 internal constant CREATOR_BPS = 10;
    uint256 internal constant TREASURY_BPS = 5;
    /// depth = 30 - 10 - 5 = 15, dihitung oleh factory, bukan diteruskan.
    uint256 internal constant DEPTH_BPS = 15;
    /// Aditif, konstanta di factory. 30 bps yang dikonfigurasi jadi 40 bps yang dibayar.
    uint256 internal constant PROTOCOL_BPS = 10;
    uint256 internal constant TOTAL_PAID_BPS = 40;

    uint256 internal constant SUPPLY = 1_000_000_000;
    /// Sama besaran dengan pembukaan 0G di produksi.
    uint256 internal constant VIRTUAL_NATIVE = 1500 ether;

    function _launchCurve() internal {
        factory = new AdextoFactory(PROTOCOL_TREASURY);
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
