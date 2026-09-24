// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {AdextoAgentStake} from "../contracts/AdextoAgentStake.sol";

/**
 * Token uji yang MENGEMBALIKAN false alih-alih revert.
 *
 * Dipakai karena itu perilaku ERC-20 yang sah dan nyata, dan `stake`/`unstake` memeriksa nilai
 * kembalian justru untuk kasus ini. Tanpa token seperti ini, pemeriksaan `require(...transfer...)`
 * di kontrak tidak pernah teruji — ia hanya terlihat benar.
 */
contract SoftFailToken {
    string public name = "Adexto";
    string public symbol = "ADEXTO";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public failTransfers;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function setFailTransfers(bool v) external {
        failTransfers = v;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (failTransfers) return false;
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (failTransfers) return false;
        require(balanceOf[from] >= amount, "balance");
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract AdextoAgentStakeTest is Test {
    SoftFailToken internal token;
    AdextoAgentStake internal stakeContract;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    uint256 internal constant MIN = 5_000 ether;

    function setUp() public {
        token = new SoftFailToken();
        stakeContract = new AdextoAgentStake(address(token), MIN);
        token.mint(alice, 1_000_000 ether);
        token.mint(bob, 1_000_000 ether);
    }

    function _stakeAs(address who, uint256 amount) internal {
        vm.startPrank(who);
        token.approve(address(stakeContract), amount);
        stakeContract.stake(amount);
        vm.stopPrank();
    }

    // ── 1. Jalur normal ───────────────────────────────────────────────────────
    function test_stakeMovesTokensAndActivates() public {
        uint256 before = token.balanceOf(alice);
        _stakeAs(alice, MIN);

        assertEq(stakeContract.stakedOf(alice), MIN, "posisi tidak tercatat");
        assertEq(stakeContract.totalStaked(), MIN, "total tidak naik");
        assertEq(stakeContract.stakerCount(), 1, "jumlah staker salah");
        assertTrue(stakeContract.isActive(alice), "belum aktif padahal sudah minimum");
        assertEq(token.balanceOf(alice), before - MIN, "token tidak keluar dari dompet");
        assertEq(token.balanceOf(address(stakeContract)), MIN, "token tidak masuk kontrak");
        assertEq(stakeContract.lastStakeAt(alice), block.timestamp, "lastStakeAt tidak disetel");
    }

    function test_unstakeReturnsTokensAndDeactivates() public {
        _stakeAs(alice, MIN);
        vm.prank(alice);
        stakeContract.unstakeAll();

        assertEq(stakeContract.stakedOf(alice), 0);
        assertEq(stakeContract.totalStaked(), 0);
        assertEq(stakeContract.stakerCount(), 0);
        assertFalse(stakeContract.isActive(alice), "masih aktif padahal sudah keluar");
        assertEq(token.balanceOf(address(stakeContract)), 0, "token tertinggal di kontrak");
    }

    // ── 2. Minimum diukur pada POSISI, bukan pada jumlah tambahan ─────────────
    //
    // Ini yang membedakan "minimum stake" dari "minimum setoran". Tanpa test ini, menambah 1 token
    // ke posisi besar akan ditolak dan tidak ada yang menyadarinya sampai ada pengguna mengeluh.
    function test_firstStakeBelowMinimumRejected() public {
        vm.startPrank(alice);
        token.approve(address(stakeContract), MIN);
        vm.expectRevert("AgentStake: below minimum stake");
        stakeContract.stake(MIN - 1);
        vm.stopPrank();
    }

    function test_topUpBelowMinimumAllowedOnceActive() public {
        _stakeAs(alice, MIN);
        _stakeAs(alice, 1); // jauh di bawah minimum, tapi posisinya sudah di atas
        assertEq(stakeContract.stakedOf(alice), MIN + 1);
        assertEq(stakeContract.stakerCount(), 1, "top-up tidak boleh menambah jumlah staker");
    }

    // ── 3. Keluar sebagian tidak boleh meninggalkan posisi debu ──────────────
    function test_partialExitLeavingDustRejected() public {
        _stakeAs(alice, MIN + 100 ether);
        vm.prank(alice);
        vm.expectRevert("AgentStake: remainder below minimum");
        stakeContract.unstake(200 ether); // menyisakan MIN - 100, di bawah minimum
    }

    function test_partialExitKeepingMinimumAllowed() public {
        _stakeAs(alice, MIN * 2);
        vm.prank(alice);
        stakeContract.unstake(MIN);
        assertEq(stakeContract.stakedOf(alice), MIN);
        assertTrue(stakeContract.isActive(alice));
    }

    // ── 4. Tidak ada yang bisa menyentuh posisi orang lain ───────────────────
    //
    // Inilah jaminan yang paling penting untuk diuji, sebab ia jaminan tentang APA YANG TIDAK ADA.
    function test_cannotUnstakeMoreThanOwn() public {
        _stakeAs(alice, MIN);
        vm.prank(bob);
        vm.expectRevert("AgentStake: amount exceeds stake");
        stakeContract.unstake(MIN);
    }

    function test_othersCannotDrainWhenTheyHaveNothing() public {
        _stakeAs(alice, MIN);
        vm.prank(bob);
        vm.expectRevert("AgentStake: nothing staked");
        stakeContract.unstakeAll();
        assertEq(stakeContract.stakedOf(alice), MIN, "posisi alice tersentuh");
    }

    // ── 5. Transfer yang GAGAL TANPA REVERT tidak boleh mengkredit apa pun ───
    function test_softFailingTransferFromReverts() public {
        token.setFailTransfers(true);
        vm.startPrank(alice);
        token.approve(address(stakeContract), MIN);
        vm.expectRevert("AgentStake: transferFrom failed");
        stakeContract.stake(MIN);
        vm.stopPrank();
        assertEq(stakeContract.stakedOf(alice), 0, "stake tercatat padahal token tidak pindah");
        assertEq(stakeContract.totalStaked(), 0);
    }

    function test_softFailingTransferOnUnstakeReverts() public {
        _stakeAs(alice, MIN);
        token.setFailTransfers(true);
        vm.prank(alice);
        vm.expectRevert("AgentStake: transfer failed");
        stakeContract.unstake(MIN);
        assertEq(stakeContract.stakedOf(alice), MIN, "posisi hilang padahal token tidak keluar");
    }

    // ── 6. Konstruktor menolak konfigurasi yang tidak bisa dipakai ───────────
    function test_constructorRejectsZeroToken() public {
        vm.expectRevert("AgentStake: zero token");
        new AdextoAgentStake(address(0), MIN);
    }

    function test_constructorRejectsZeroMinimum() public {
        vm.expectRevert("AgentStake: zero minimum");
        new AdextoAgentStake(address(token), 0);
    }

    // ── 7. Akuntansi memperlihatkan kelebihan, tidak menyembunyikannya ──────
    //
    // Transfer langsung ke kontrak tidak mengkredit siapa pun dan tidak bisa ditarik. Yang penting
    // adalah ia TERLIHAT, bukan mendistorsi totalStaked.
    function test_directTransferShowsAsSurplus() public {
        _stakeAs(alice, MIN);
        vm.prank(bob);
        token.transfer(address(stakeContract), 777 ether);

        (uint256 held, uint256 accounted, uint256 surplus) = stakeContract.accounting();
        assertEq(accounted, MIN, "totalStaked terdistorsi oleh transfer langsung");
        assertEq(held, MIN + 777 ether);
        assertEq(surplus, 777 ether, "kelebihan tidak terlihat");
    }

    // ── 8. Banyak staker: total dan jumlah tetap konsisten ──────────────────
    function test_multipleStakersAccounting() public {
        _stakeAs(alice, MIN);
        _stakeAs(bob, MIN * 3);
        assertEq(stakeContract.totalStaked(), MIN * 4);
        assertEq(stakeContract.stakerCount(), 2);

        vm.prank(alice);
        stakeContract.unstakeAll();
        assertEq(stakeContract.totalStaked(), MIN * 3);
        assertEq(stakeContract.stakerCount(), 1);
        assertTrue(stakeContract.isActive(bob));
    }

    // ── 9. Tidak ada lock: keluar di blok yang sama harus BISA ──────────────
    //
    // Diuji secara eksplisit karena dokumentasi kontraknya menyatakan tidak ada cooldown. Kalau
    // suatu saat lock ditambahkan, test ini yang gagal lebih dulu dan memaksa kalimat itu diperbarui.
    function test_noLockPeriod() public {
        _stakeAs(alice, MIN);
        vm.prank(alice);
        stakeContract.unstakeAll();
        assertEq(token.balanceOf(address(stakeContract)), 0, "ada lock yang tidak didokumentasikan");
    }

    // ── 10. Fuzz: total selalu sama dengan saldo yang tercatat ──────────────
    function testFuzz_totalMatchesSumOfPositions(uint256 aliceAmount, uint256 bobAmount) public {
        aliceAmount = bound(aliceAmount, MIN, 500_000 ether);
        bobAmount = bound(bobAmount, MIN, 500_000 ether);
        _stakeAs(alice, aliceAmount);
        _stakeAs(bob, bobAmount);
        assertEq(
            stakeContract.totalStaked(),
            stakeContract.stakedOf(alice) + stakeContract.stakedOf(bob),
            "total menyimpang dari jumlah posisi"
        );
        assertEq(token.balanceOf(address(stakeContract)), stakeContract.totalStaked(), "saldo != total");
    }
}
