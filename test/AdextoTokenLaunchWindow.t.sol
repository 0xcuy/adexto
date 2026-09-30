// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AdextoCurveFixture} from "./AdextoCurveFixture.sol";

/// A second holder, so transfers between wallets can be tested.
contract WindowWallet {
    receive() external payable {}

    function buy(address payable curve, uint256 amount) external {
        (bool ok, bytes memory ret) = curve.call{value: amount}(
            abi.encodeWithSignature("buy(uint256,address,uint256)", 0, address(this), 0)
        );
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }
}

/**
 * The launch window: for `ANTI_SNIPE_WINDOW` seconds, no wallet may hold more than 1% of supply.
 *
 * Version 1.0.0 replaced a per-transaction cap counted in blocks. That cap could be repeated
 * inside the window as often as a wallet liked, and its length in seconds differed by chain.
 * These tests pin the three things the new limit must do, and the three things it must not.
 *
 * Must: stop one purchase above the limit, stop many purchases that add up above it, stop
 * transfers that collect tokens into one wallet above it.
 * Must not: block sells, block buyback burns, or apply after the window.
 */
contract AdextoTokenLaunchWindowTest is AdextoCurveFixture {
    function setUp() public {
        _launchCurveInWindow();
    }

    /// Native that buys the given token amount, with a small margin, at the current curve state.
    function _nativeFor(uint256 tokensWanted) internal view returns (uint256 amount) {
        // Binary search over the quote, because fees make the inverse awkward to write exactly.
        uint256 lo = 1;
        uint256 hi = 10_000 ether;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            (uint256 out,,,,) = curve.getBuyQuote(mid);
            if (out < tokensWanted) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }

    function test_windowParameters() public view {
        assertEq(token.ANTI_SNIPE_WINDOW(), 180, "window is not 180 seconds");
        assertEq(token.launchTime(), block.timestamp, "launchTime is not the deployment timestamp");
        assertEq(token.maxWalletAmount(), (SUPPLY * 1e18) / 100, "wallet limit is not 1% of supply");
        assertEq(factory.ANTI_SNIPER_BPS(), 100, "factory does not pass 1%");
    }

    function test_singleBuyAboveLimitReverts() public {
        uint256 limit = token.maxWalletAmount();
        uint256 amount = _nativeFor(limit + 1e18);
        vm.deal(address(this), amount);
        vm.expectRevert(bytes("Anti-sniper: wallet limit during launch window"));
        curve.buy{value: amount}(0, address(this), 0);
    }

    function test_buyUpToLimitSucceeds() public {
        uint256 limit = token.maxWalletAmount();
        uint256 amount = _nativeFor((limit * 99) / 100);
        vm.deal(address(this), amount);
        curve.buy{value: amount}(0, address(this), 0);
        assertLe(token.balanceOf(address(this)), limit, "balance above the limit");
        assertGt(token.balanceOf(address(this)), 0, "nothing was bought");
    }

    /**
     * The case the old per-transaction cap missed: two purchases, each under the limit on its
     * own, that together would pass it. A per-transaction cap accepts both; a per-wallet limit
     * must reject the second.
     */
    function test_splitBuysCannotPassLimit() public {
        uint256 limit = token.maxWalletAmount();
        uint256 first = _nativeFor((limit * 6) / 10);
        vm.deal(address(this), first);
        curve.buy{value: first}(0, address(this), 0);
        assertLe(token.balanceOf(address(this)), limit, "first purchase alone passed the limit");

        uint256 second = _nativeFor((limit * 6) / 10);
        vm.deal(address(this), second);
        vm.expectRevert(bytes("Anti-sniper: wallet limit during launch window"));
        curve.buy{value: second}(0, address(this), 0);
    }

    function test_transfersCannotCollectAboveLimit() public {
        WindowWallet other = new WindowWallet();
        uint256 limit = token.maxWalletAmount();
        uint256 amount = _nativeFor((limit * 3) / 4);
        vm.deal(address(this), amount);
        vm.deal(address(other), amount * 2);
        curve.buy{value: amount}(0, address(this), 0);
        other.buy(payable(address(curve)), amount);

        uint256 mine = token.balanceOf(address(this));
        vm.expectRevert(bytes("Anti-sniper: wallet limit during launch window"));
        token.transfer(address(other), mine);
    }

    function test_sellsWorkDuringWindow() public {
        uint256 amount = _nativeFor(token.maxWalletAmount() / 2);
        vm.deal(address(this), amount);
        curve.buy{value: amount}(0, address(this), 0);
        uint256 held = token.balanceOf(address(this));

        token.approve(address(curve), held);
        uint256 out = curve.sell(held, 0, address(this), 0);
        assertGt(out, 0, "sell paid nothing during the window");
        assertEq(token.balanceOf(address(this)), 0, "tokens left after selling everything");
    }

    function test_buybackBurnWorksDuringWindow() public {
        // Several wallets, each under the limit, build the buyback bucket.
        for (uint256 i = 0; i < 6; i++) {
            WindowWallet w = new WindowWallet();
            uint256 amount = _nativeFor(token.maxWalletAmount() / 2);
            vm.deal(address(w), amount);
            w.buy(payable(address(curve)), amount);
        }
        uint256 bucket = curve.treasuryNative();
        (uint256 reserveNative,) = curve.getReserves();
        uint256 spend = bucket < reserveNative / 100 ? bucket : reserveNative / 100;
        assertGt(spend, 0, "no buyback bucket to spend");

        uint256 supplyBefore = token.totalSupply();
        curve.executeBuyback(spend, 0);
        assertLt(token.totalSupply(), supplyBefore, "buyback did not burn during the window");
        assertLt(block.timestamp, token.launchTime() + token.ANTI_SNIPE_WINDOW(), "test left the window");
    }

    function test_noLimitAfterWindow() public {
        vm.warp(block.timestamp + token.ANTI_SNIPE_WINDOW());
        uint256 amount = _nativeFor(token.maxWalletAmount() * 5);
        vm.deal(address(this), amount);
        curve.buy{value: amount}(0, address(this), 0);
        assertGt(token.balanceOf(address(this)), token.maxWalletAmount() * 4, "limit still applied after the window");
    }

    function test_lastSecondOfWindowStillLimited() public {
        vm.warp(block.timestamp + token.ANTI_SNIPE_WINDOW() - 1);
        uint256 amount = _nativeFor(token.maxWalletAmount() + 1e18);
        vm.deal(address(this), amount);
        vm.expectRevert(bytes("Anti-sniper: wallet limit during launch window"));
        curve.buy{value: amount}(0, address(this), 0);
    }

    /// Whatever a wallet tries inside the window, its balance ends at or under the limit.
    function testFuzz_windowNeverLetsAWalletPassLimit(uint256 rawIn, uint256 rawSteps) public {
        uint256 steps = bound(rawSteps, 1, 8);
        uint256 amount = bound(rawIn, 1e12, 50 ether);
        vm.deal(address(this), amount * steps);
        for (uint256 i = 0; i < steps; i++) {
            (uint256 quoted,,,,) = curve.getBuyQuote(amount);
            if (quoted == 0) continue;
            try curve.buy{value: amount}(0, address(this), 0) {} catch {}
        }
        assertLe(token.balanceOf(address(this)), token.maxWalletAmount(), "a wallet passed the limit inside the window");
        _assertSolvent();
    }
}
