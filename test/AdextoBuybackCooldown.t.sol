// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AdextoCurveFixture} from "./AdextoCurveFixture.sol";
import {AdextoCurve} from "../contracts/AdextoCurve.sol";

/**
 * The buyback bucket must not be drainable inside one transaction.
 *
 * WHY THIS SUITE EXISTS
 *
 * `executeBuyback` is capped at 1% of the reserve per call, and every other test calls it exactly
 * once and then checks the invariants. So every invariant can pass while the attack runs: what
 * was never tested is repetition, and that is where the hole was. Each call raises the reserve,
 * so the 1% ceiling rises while a loop runs.
 *
 * The reporter of GHSA-g589-wjqq-86f2 measured 101.32 native drained in 3 calls for a profit of
 * 65.96 on 3,000 of capital. These tests check the property that makes that impossible rather than
 * the specific numbers: a second call before the cooldown has passed must revert.
 */
contract AdextoBuybackCooldownTest is AdextoCurveFixture {
    function setUp() public {
        _launchCurve();
    }

    /**
     * Build `treasuryNative` through real trades, not by writing storage.
     *
     * Round trips rather than one large purchase, and that is required, not style. One large
     * purchase grows the reserve and the bucket together, so the bucket stays far below the 1%
     * ceiling and a single buyback empties it: there is no loop left to test. Buying then selling
     * returns native to the buyer, so the reserve stays near where it started while fees from both
     * legs accrue in the bucket, which is the high-volume state the attack needs.
     */
    function _accrueTreasury(uint256 perTrade, uint256 rounds) internal {
        for (uint256 i = 0; i < rounds; i++) {
            vm.deal(address(this), perTrade);
            curve.buy{value: perTrade}(0, address(this), block.timestamp + 1);
            uint256 held = token.balanceOf(address(this));
            if (held == 0) break;
            token.approve(address(curve), held);
            curve.sell(held, 0, address(this), block.timestamp + 1);
        }
    }

    /// The bucket must exceed the per-call ceiling, or these tests test nothing.
    function _accrueUntilAboveCap() internal {
        for (uint256 round = 0; round < 40; round++) {
            _accrueTreasury(2_000 ether, 20);
            (uint256 reserveNative, ) = curve.getReserves();
            if (curve.treasuryNative() > reserveNative / 100) return;
        }
        revert("the bucket never passed the 1% ceiling: test precondition not met");
    }

    function _capped() internal view returns (uint256) {
        (uint256 reserveNative, ) = curve.getReserves();
        uint256 cap = reserveNative / 100;
        uint256 treasury = curve.treasuryNative();
        return treasury > cap ? cap : treasury;
    }

    // ── 1. A second call in the same transaction reverts ─────────────────────
    function test_buybackCannotBeLoopedInOneTransaction() public {
        _accrueUntilAboveCap();

        uint256 first = _capped();
        assertGt(first, 0, "no bucket accrued, the test tests nothing");
        curve.executeBuyback(first, 0);

        uint256 second = _capped();
        assertGt(second, 0, "the bucket is not empty, so a loop would be possible without the cooldown");
        vm.expectRevert("AdextoCurve: buyback cooldown");
        curve.executeBuyback(second, 0);
    }

    // ── 2. The bucket cannot be emptied in one block ─────────────────────────
    //
    // The reported attack: repeat until the bucket is empty. Checks that most of it remains.
    function test_treasuryCannotBeDrainedInOneBlock() public {
        _accrueUntilAboveCap();
        uint256 before = curve.treasuryNative();

        curve.executeBuyback(_capped(), 0);
        for (uint256 i = 0; i < 5; i++) {
            uint256 amount = _capped();
            if (amount == 0) break;
            vm.expectRevert("AdextoCurve: buyback cooldown");
            curve.executeBuyback(amount, 0);
        }

        uint256 remaining = curve.treasuryNative();
        assertGt(remaining, 0, "the bucket was emptied in one block");
        // One call is capped at 1% of the reserve, so what remains must be far larger than what
        // was spent. The 50% threshold is loose on purpose, so fee parameters can change without
        // breaking a test that is about the property.
        assertGt(remaining * 2, before, "more than half the bucket left in one block");
        _assertSolvent();
    }

    // ── 3. After the cooldown, it runs again ─────────────────────────────────
    //
    // The fix must not kill the feature. Without this test, a cooldown that never expires would
    // pass both tests above.
    function test_buybackWorksAgainAfterCooldown() public {
        _accrueUntilAboveCap();
        curve.executeBuyback(_capped(), 0);

        vm.warp(block.timestamp + curve.BUYBACK_COOLDOWN());

        uint256 amount = _capped();
        assertGt(amount, 0, "no bucket left to test the path after the cooldown");
        uint256 burnedBefore = curve.totalTokensBurned();
        curve.executeBuyback(amount, 0);
        assertGt(curve.totalTokensBurned(), burnedBefore, "nothing was burned after the cooldown");
        _assertSolvent();
    }

    // ── 4. One second early, it is still refused ─────────────────────────────
    function test_buybackStillBlockedOneSecondEarly() public {
        _accrueUntilAboveCap();
        curve.executeBuyback(_capped(), 0);

        vm.warp(block.timestamp + curve.BUYBACK_COOLDOWN() - 1);

        // Computed before `vm.expectRevert`, and not for tidiness. `expectRevert` binds to the next
        // external call, and `_capped()` calls `getReserves()`, which does not revert. Inline, the
        // expectation would be consumed by that view call and the test would pass untested.
        uint256 amount = _capped();
        vm.expectRevert("AdextoCurve: buyback cooldown");
        curve.executeBuyback(amount, 0);
    }

    // ── 5. lastBuybackAt is recorded, and that is what holds it back ─────────
    function test_lastBuybackAtRecorded() public {
        assertEq(curve.lastBuybackAt(), 0, "lastBuybackAt must be zero before the first buyback");
        _accrueUntilAboveCap();
        curve.executeBuyback(_capped(), 0);
        assertEq(curve.lastBuybackAt(), block.timestamp, "lastBuybackAt was not set");
    }
}
