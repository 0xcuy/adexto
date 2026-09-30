// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {AdextoAgentStake} from "../contracts/AdextoAgentStake.sol";

/**
 * Test token that RETURNS false instead of reverting.
 *
 * That is legitimate ERC-20 behaviour, and `stake`/`unstake` check the return value for exactly
 * this case. Without a token like this, the `require(...transfer...)` checks in the contract would
 * never be exercised; they would only look right.
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

    // ── 1. The normal path ────────────────────────────────────────────────────
    function test_stakeMovesTokensAndActivates() public {
        uint256 before = token.balanceOf(alice);
        _stakeAs(alice, MIN);

        assertEq(stakeContract.stakedOf(alice), MIN, "position not recorded");
        assertEq(stakeContract.totalStaked(), MIN, "total did not increase");
        assertEq(stakeContract.stakerCount(), 1, "wrong staker count");
        assertTrue(stakeContract.isActive(alice), "not active at the minimum");
        assertEq(token.balanceOf(alice), before - MIN, "tokens did not leave the wallet");
        assertEq(token.balanceOf(address(stakeContract)), MIN, "tokens did not reach the contract");
        assertEq(stakeContract.lastStakeAt(alice), block.timestamp, "lastStakeAt not set");
    }

    function test_unstakeReturnsTokensAndDeactivates() public {
        _stakeAs(alice, MIN);
        vm.prank(alice);
        stakeContract.unstakeAll();

        assertEq(stakeContract.stakedOf(alice), 0);
        assertEq(stakeContract.totalStaked(), 0);
        assertEq(stakeContract.stakerCount(), 0);
        assertFalse(stakeContract.isActive(alice), "still active after exiting");
        assertEq(token.balanceOf(address(stakeContract)), 0, "tokens left in the contract");
    }

    // ── 2. The minimum applies to the POSITION, not to each top-up ────────────
    //
    // This is what separates a minimum stake from a minimum deposit. Without this test, adding one
    // token to a large position could be refused and nobody would notice until a user complained.
    function test_firstStakeBelowMinimumRejected() public {
        vm.startPrank(alice);
        token.approve(address(stakeContract), MIN);
        vm.expectRevert("AgentStake: below minimum stake");
        stakeContract.stake(MIN - 1);
        vm.stopPrank();
    }

    function test_topUpBelowMinimumAllowedOnceActive() public {
        _stakeAs(alice, MIN);
        _stakeAs(alice, 1); // far below the minimum, but the position is already above it
        assertEq(stakeContract.stakedOf(alice), MIN + 1);
        assertEq(stakeContract.stakerCount(), 1, "a top-up must not add a staker");
    }

    // ── 3. A partial exit must not leave a dust position ─────────────────────
    function test_partialExitLeavingDustRejected() public {
        _stakeAs(alice, MIN + 100 ether);
        vm.prank(alice);
        vm.expectRevert("AgentStake: remainder below minimum");
        stakeContract.unstake(200 ether); // leaves MIN - 100, below the minimum
    }

    function test_partialExitKeepingMinimumAllowed() public {
        _stakeAs(alice, MIN * 2);
        vm.prank(alice);
        stakeContract.unstake(MIN);
        assertEq(stakeContract.stakedOf(alice), MIN);
        assertTrue(stakeContract.isActive(alice));
    }

    // ── 4. Nobody can touch another staker's position ────────────────────────
    //
    // The most important guarantee to test, because it is a guarantee about what does NOT exist.
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
        assertEq(stakeContract.stakedOf(alice), MIN, "alice's position was touched");
    }

    // ── 5. A transfer that FAILS WITHOUT REVERTING must credit nothing ───────
    function test_softFailingTransferFromReverts() public {
        token.setFailTransfers(true);
        vm.startPrank(alice);
        token.approve(address(stakeContract), MIN);
        vm.expectRevert("AgentStake: transferFrom failed");
        stakeContract.stake(MIN);
        vm.stopPrank();
        assertEq(stakeContract.stakedOf(alice), 0, "stake recorded although no tokens moved");
        assertEq(stakeContract.totalStaked(), 0);
    }

    function test_softFailingTransferOnUnstakeReverts() public {
        _stakeAs(alice, MIN);
        token.setFailTransfers(true);
        vm.prank(alice);
        vm.expectRevert("AgentStake: transfer failed");
        stakeContract.unstake(MIN);
        assertEq(stakeContract.stakedOf(alice), MIN, "position lost although no tokens left");
    }

    // ── 6. The constructor rejects unusable configurations ───────────────────
    function test_constructorRejectsZeroToken() public {
        vm.expectRevert("AgentStake: zero token");
        new AdextoAgentStake(address(0), MIN);
    }

    function test_constructorRejectsZeroMinimum() public {
        vm.expectRevert("AgentStake: zero minimum");
        new AdextoAgentStake(address(token), 0);
    }

    // ── 7. Accounting shows a surplus instead of hiding it ───────────────────
    //
    // A direct transfer to the contract credits nobody and cannot be withdrawn. What matters is
    // that it is VISIBLE, and that it does not distort totalStaked.
    function test_directTransferShowsAsSurplus() public {
        _stakeAs(alice, MIN);
        vm.prank(bob);
        token.transfer(address(stakeContract), 777 ether);

        (uint256 held, uint256 accounted, uint256 surplus) = stakeContract.accounting();
        assertEq(accounted, MIN, "totalStaked distorted by a direct transfer");
        assertEq(held, MIN + 777 ether);
        assertEq(surplus, 777 ether, "surplus not visible");
    }

    // ── 8. Many stakers: total and count stay consistent ─────────────────────
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

    // ── 9. No lock: exiting in the same block MUST work ──────────────────────
    //
    // Tested explicitly because the contract's documentation says there is no cooldown. If a lock
    // is ever added, this test fails first and forces that sentence to be updated.
    function test_noLockPeriod() public {
        _stakeAs(alice, MIN);
        vm.prank(alice);
        stakeContract.unstakeAll();
        assertEq(token.balanceOf(address(stakeContract)), 0, "an undocumented lock exists");
    }

    // ── 10. Fuzz: the total always equals the recorded positions ─────────────
    function testFuzz_totalMatchesSumOfPositions(uint256 aliceAmount, uint256 bobAmount) public {
        aliceAmount = bound(aliceAmount, MIN, 500_000 ether);
        bobAmount = bound(bobAmount, MIN, 500_000 ether);
        _stakeAs(alice, aliceAmount);
        _stakeAs(bob, bobAmount);
        assertEq(
            stakeContract.totalStaked(),
            stakeContract.stakedOf(alice) + stakeContract.stakedOf(bob),
            "total drifted from the sum of positions"
        );
        assertEq(token.balanceOf(address(stakeContract)), stakeContract.totalStaked(), "balance != total");
    }
}
