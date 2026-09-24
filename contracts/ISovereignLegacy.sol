// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/**
 * Antarmuka bersama untuk generasi SovereignCurve / SovereignHook.
 *
 * KENAPA BERKAS INI ADA
 *
 * `IERC20Minimal` dan `IAdextoToken` dulu dideklarasikan DUA KALI — sekali di
 * `SovereignCurve.sol` dan sekali lagi di `SovereignHook.sol` — dengan isi yang identik.
 * Aderyn menandainya sebagai High "Contract Name Reused in Different Files", 4 instance, dan
 * penilaian itu tepat: dua definisi dengan satu nama adalah dua hal yang bisa menyimpang tanpa
 * ada yang gagal. Menambah satu fungsi di salah satunya sudah cukup untuk membuat dua berkas
 * memanggil ABI yang berbeda sambil tampak memanggil hal yang sama.
 *
 * Dipindah ke sini, ada satu definisi dan dua pengimpor.
 *
 * KENAPA NAMANYA `...Legacy`
 *
 * Keduanya melayani generasi yang SUDAH DIGANTIKAN. Generasi aktif, `AdextoCurve.sol`, punya
 * antarmukanya sendiri dengan nama berbeda (`IERC20Curve`, `IAdextoBurnable`) dan sengaja tidak
 * ikut mengimpor dari sini: menyatukannya akan mengikat generasi aktif pada bentuk yang dipakai
 * generasi lama, dan itu justru alasan generasi baru dibuat.
 */

interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

interface IAdextoToken {
    function executeTreasuryBuyback(uint256 amountToBurn) external;
}
