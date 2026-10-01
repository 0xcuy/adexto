// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AdextoCurveFixture} from "./AdextoCurveFixture.sol";
import {AdextoFactory} from "../contracts/AdextoFactory.sol";
import {AdextoCurve} from "../contracts/AdextoCurve.sol";
import {AdextoToken} from "../contracts/AdextoToken.sol";
import {AdextoStakeHub} from "../contracts/AdextoStakeHub.sol";

/// A factory stand-in that answers `curveOf` for whatever it is told. Only for tokens that are
/// not ADEXTO tokens at all, to reach the hub's transfer checks.
contract LookupStub {
    mapping(address => address) public curveOf;

    function set(address token, address curve) external {
        curveOf[token] = curve;
    }
}

/// Takes 1% of every transferFrom, so less arrives than was asked for.
contract FeeOnTransferToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        uint256 fee = amount / 100;
        balanceOf[to] += amount - fee;
        totalSupply -= fee;
        return true;
    }
}

/// Returns false instead of reverting, which ERC-20 permits.
contract SoftFailHubToken {
    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply = 1_000_000 ether;

    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }
}

/// Calls back into the hub from inside transferFrom.
contract ReentrantToken {
    AdextoStakeHub public hub;
    uint256 public totalSupply = 1_000_000 ether;
    mapping(address => uint256) public balanceOf;

    function setHub(AdextoStakeHub h) external {
        hub = h;
    }

    function transfer(address, uint256) external pure returns (bool) {
        return true;
    }

    function transferFrom(address, address, uint256) external returns (bool) {
        hub.stake(address(this), 1_000 ether);
        return true;
    }
}

/**
 * AdextoStakeHub, against real launches from two real factories.
 *
 * Two factory instances stand in for the two generations a chain carries (0.11.0 and 1.0.0):
 * the hub only ever calls `curveOf`, which both expose with the same signature. A third market is
 * listed as having its own stake contract and must be refused.
 */
contract AdextoStakeHubTest is AdextoCurveFixture {
    AdextoFactory internal factoryB;
    AdextoToken internal tokenB;
    AdextoCurve internal curveB;
    AdextoToken internal ownToken;
    AdextoStakeHub internal hub;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    /// 0.001% of the fixture's 1,000,000,000 supply.
    uint256 internal constant MIN = 10_000 ether;

    function setUp() public {
        _launchCurve();

        factoryB = new AdextoFactory(PROTOCOL_TREASURY, reservedSymbols());
        (address tb, address cb) = factoryB.deployTrinity(
            "Hub Second Market", "HUBB", SUPPLY, address(this), VIRTUAL_NATIVE, SWAP_FEE_BPS, CREATOR_BPS, TREASURY_BPS,
            bytes32(0), false, 0
        );
        tokenB = AdextoToken(tb);
        curveB = AdextoCurve(payable(cb));

        (address to,) = factory.deployTrinity(
            "Has Its Own Stake", "OWNS", SUPPLY, address(this), VIRTUAL_NATIVE, SWAP_FEE_BPS, CREATOR_BPS, TREASURY_BPS,
            bytes32(0), false, 0
        );
        ownToken = AdextoToken(to);

        // Every market past its launch window, so the window has its own test below.
        vm.warp(block.timestamp + token.ANTI_SNIPE_WINDOW());

        hub = new AdextoStakeHub(_pair(address(factory), address(factoryB)), _one(address(ownToken)));

        vm.deal(address(this), 1_000 ether);
        curve.buy{value: 5 ether}(0, address(this), 0);
        curveB.buy{value: 5 ether}(0, address(this), 0);
        token.transfer(alice, 1_000_000 ether);
        token.transfer(bob, 1_000_000 ether);
        tokenB.transfer(alice, 1_000_000 ether);
    }

    function _pair(address a, address b) internal pure returns (address[] memory list) {
        list = new address[](2);
        list[0] = a;
        list[1] = b;
    }

    function _one(address a) internal pure returns (address[] memory list) {
        list = new address[](1);
        list[0] = a;
    }

    function _none() internal pure returns (address[] memory list) {
        list = new address[](0);
    }

    function _stakeAs(address who, AdextoToken t, uint256 amount) internal {
        vm.startPrank(who);
        t.approve(address(hub), amount);
        hub.stake(address(t), amount);
        vm.stopPrank();
    }

    // ── 1. Construction ───────────────────────────────────────────────────────

    function test_constructorRecordsFactoriesAndExclusions() public view {
        address[] memory fs = hub.factories();
        assertEq(fs.length, 2);
        assertEq(fs[0], address(factory));
        assertEq(fs[1], address(factoryB));
        address[] memory own = hub.tokensWithOwnStake();
        assertEq(own.length, 1);
        assertEq(own[0], address(ownToken));
        assertTrue(hub.hasOwnStake(address(ownToken)));
        assertEq(hub.VERSION(), "1.0.0");
        assertEq(hub.MIN_STAKE_DIVISOR(), 100_000);
    }

    function test_constructorRejectsNoFactory() public {
        vm.expectRevert("StakeHub: one to four factories");
        new AdextoStakeHub(_none(), _none());
    }

    function test_constructorRejectsFiveFactories() public {
        address[] memory fs = new address[](5);
        for (uint256 i = 0; i < 5; i++) fs[i] = address(new LookupStub());
        vm.expectRevert("StakeHub: one to four factories");
        new AdextoStakeHub(fs, _none());
    }

    function test_constructorRejectsFactoryWithoutCode() public {
        vm.expectRevert("StakeHub: factory has no code");
        new AdextoStakeHub(_one(address(0xdead)), _none());
    }

    function test_constructorRejectsDuplicateFactory() public {
        vm.expectRevert("StakeHub: duplicate factory");
        new AdextoStakeHub(_pair(address(factory), address(factory)), _none());
    }

    function test_constructorRejectsZeroOrDuplicateExclusion() public {
        vm.expectRevert("StakeHub: zero token");
        new AdextoStakeHub(_one(address(factory)), _one(address(0)));
        vm.expectRevert("StakeHub: duplicate token");
        new AdextoStakeHub(_one(address(factory)), _pair(address(ownToken), address(ownToken)));
    }

    function test_hasNoOwnerFunction() public {
        (bool ok,) = address(hub).call(abi.encodeWithSignature("owner()"));
        assertFalse(ok, "the hub must not expose an owner");
    }

    // ── 2. Which tokens it accepts ────────────────────────────────────────────

    function test_eligibility() public {
        assertTrue(hub.isEligible(address(token)), "token from the first factory");
        assertTrue(hub.isEligible(address(tokenB)), "token from the second factory");
        assertFalse(hub.isEligible(address(ownToken)), "token with its own stake");
        assertFalse(hub.isEligible(address(0)), "zero address");
        assertFalse(hub.isEligible(address(new FeeOnTransferToken())), "token from nowhere");
        assertFalse(hub.isEligible(address(curve)), "a curve is not a token");
    }

    function test_rejectsTokenWithOwnStake() public {
        curve.buy{value: 1 ether}(0, address(this), 0);
        (bool ok,) = address(ownToken).call(abi.encodeWithSignature("approve(address,uint256)", address(hub), MIN));
        assertTrue(ok);
        vm.expectRevert("StakeHub: token has its own stake contract");
        hub.stake(address(ownToken), MIN);
    }

    function test_rejectsTokenFromNowhere() public {
        FeeOnTransferToken other = new FeeOnTransferToken();
        other.mint(alice, MIN);
        vm.startPrank(alice);
        other.approve(address(hub), MIN);
        vm.expectRevert("StakeHub: not an ADEXTO market token");
        hub.stake(address(other), MIN);
        vm.stopPrank();
    }

    // ── 3. The minimum ────────────────────────────────────────────────────────

    function test_minimumIsShareOfSupply() public view {
        assertEq(hub.minStakeOf(address(token)), token.totalSupply() / 100_000);
        assertEq(hub.minStakeOf(address(token)), MIN, "1,000,000,000 supply gives 10,000");
    }

    function test_firstStakeBelowMinimumReverts() public {
        vm.startPrank(alice);
        token.approve(address(hub), MIN - 1);
        vm.expectRevert("StakeHub: below minimum stake");
        hub.stake(address(token), MIN - 1);
        vm.stopPrank();
    }

    function test_topUpBelowMinimumAllowedOnceActive() public {
        _stakeAs(alice, token, MIN);
        _stakeAs(alice, token, 1 ether);
        assertEq(hub.stakedOf(address(token), alice), MIN + 1 ether);
    }

    // ── 4. Stake and unstake ──────────────────────────────────────────────────

    function test_stakeMovesTokensAndActivates() public {
        uint256 before = token.balanceOf(alice);
        vm.startPrank(alice);
        token.approve(address(hub), MIN);
        vm.expectEmit(true, true, false, true, address(hub));
        emit AdextoStakeHub.Staked(address(token), alice, MIN, MIN);
        hub.stake(address(token), MIN);
        vm.stopPrank();

        assertEq(token.balanceOf(alice), before - MIN);
        assertEq(token.balanceOf(address(hub)), MIN);
        assertEq(hub.stakedOf(address(token), alice), MIN);
        assertEq(hub.totalStaked(address(token)), MIN);
        assertEq(hub.stakerCount(address(token)), 1);
        assertEq(hub.lastStakeAt(address(token), alice), block.timestamp);
        assertTrue(hub.isActive(address(token), alice));
        assertFalse(hub.isActive(address(token), bob));
    }

    function test_unstakePartialAndRemainderRule() public {
        _stakeAs(alice, token, 3 * MIN);
        vm.startPrank(alice);
        hub.unstake(address(token), MIN);
        assertEq(hub.stakedOf(address(token), alice), 2 * MIN);
        vm.expectRevert("StakeHub: remainder below minimum");
        hub.unstake(address(token), 2 * MIN - 1);
        vm.expectRevert("StakeHub: amount exceeds stake");
        hub.unstake(address(token), 2 * MIN + 1);
        vm.expectRevert("StakeHub: zero amount");
        hub.unstake(address(token), 0);
        vm.stopPrank();
    }

    function test_unstakeAllReturnsEverythingToTheStaker() public {
        _stakeAs(alice, token, 2 * MIN);
        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        hub.unstakeAll(address(token));
        assertEq(token.balanceOf(alice), before + 2 * MIN);
        assertEq(hub.stakedOf(address(token), alice), 0);
        assertEq(hub.totalStaked(address(token)), 0);
        assertEq(hub.stakerCount(address(token)), 0);
        assertFalse(hub.isActive(address(token), alice));

        vm.prank(alice);
        vm.expectRevert("StakeHub: nothing staked");
        hub.unstakeAll(address(token));
    }

    function test_nobodyCanTouchAnotherPosition() public {
        _stakeAs(alice, token, MIN);
        vm.startPrank(bob);
        vm.expectRevert("StakeHub: amount exceeds stake");
        hub.unstake(address(token), MIN);
        vm.expectRevert("StakeHub: nothing staked");
        hub.unstakeAll(address(token));
        vm.stopPrank();
        assertEq(hub.stakedOf(address(token), alice), MIN);
    }

    function test_positionsAreIsolatedPerToken() public {
        _stakeAs(alice, token, MIN);
        _stakeAs(alice, tokenB, 2 * MIN);
        assertEq(hub.totalStaked(address(token)), MIN);
        assertEq(hub.totalStaked(address(tokenB)), 2 * MIN);
        vm.prank(alice);
        hub.unstakeAll(address(token));
        assertEq(hub.stakedOf(address(tokenB), alice), 2 * MIN, "unstaking one token touched another");
        assertEq(tokenB.balanceOf(address(hub)), 2 * MIN);
    }

    function test_noLock() public {
        _stakeAs(alice, token, MIN);
        vm.prank(alice);
        hub.unstakeAll(address(token));
        assertEq(hub.stakedOf(address(token), alice), 0);
    }

    function test_directTransferShowsAsSurplus() public {
        _stakeAs(alice, token, MIN);
        vm.prank(bob);
        token.transfer(address(hub), 5 ether);
        (uint256 held, uint256 accounted, uint256 surplus) = hub.accounting(address(token));
        assertEq(held, MIN + 5 ether);
        assertEq(accounted, MIN);
        assertEq(surplus, 5 ether);
    }

    // ── 5. Transfer checks, reached through a stand-in factory ──────────────

    function test_feeOnTransferIsRefused() public {
        LookupStub stub = new LookupStub();
        FeeOnTransferToken fee = new FeeOnTransferToken();
        stub.set(address(fee), address(0xC0FFEE));
        AdextoStakeHub h = new AdextoStakeHub(_one(address(stub)), _none());
        fee.mint(alice, 100_000 ether);
        vm.startPrank(alice);
        fee.approve(address(h), 10_000 ether);
        vm.expectRevert("StakeHub: amount not received in full");
        h.stake(address(fee), 10_000 ether);
        vm.stopPrank();
    }

    function test_softFailTransferIsRefused() public {
        LookupStub stub = new LookupStub();
        SoftFailHubToken soft = new SoftFailHubToken();
        stub.set(address(soft), address(0xC0FFEE));
        AdextoStakeHub h = new AdextoStakeHub(_one(address(stub)), _none());
        vm.prank(alice);
        vm.expectRevert("StakeHub: transferFrom failed");
        h.stake(address(soft), 10_000 ether);
    }

    function test_reentryIsRefused() public {
        LookupStub stub = new LookupStub();
        ReentrantToken re = new ReentrantToken();
        stub.set(address(re), address(0xC0FFEE));
        AdextoStakeHub h = new AdextoStakeHub(_one(address(stub)), _none());
        re.setHub(h);
        vm.prank(alice);
        vm.expectRevert("StakeHub: reentrant call");
        h.stake(address(re), 10_000 ether);
    }

    // ── 6. The launch window applies to the hub like any wallet ─────────────

    function test_launchWindowCapsTheHubBalance() public {
        (address t, address c) = factory.deployTrinity(
            "Fresh Market", "FRESH", SUPPLY, address(this), VIRTUAL_NATIVE, SWAP_FEE_BPS, CREATOR_BPS, TREASURY_BPS,
            bytes32(0), false, 0
        );
        AdextoToken fresh = AdextoToken(t);
        AdextoCurve freshCurve = AdextoCurve(payable(c));
        uint256 limit = fresh.maxWalletAmount();

        // Two buyers, each under the 1% limit, together over it.
        WindowBuyer a = new WindowBuyer();
        WindowBuyer b = new WindowBuyer();
        vm.deal(address(a), 100 ether);
        vm.deal(address(b), 100 ether);
        a.buyUpTo(freshCurve, (limit * 6) / 10);
        b.buyUpTo(freshCurve, (limit * 6) / 10);
        uint256 amountA = fresh.balanceOf(address(a));
        uint256 amountB = fresh.balanceOf(address(b));

        a.stakeAll(hub, fresh);
        assertEq(hub.stakedOf(address(fresh), address(a)), amountA);

        vm.expectRevert("Anti-sniper: wallet limit during launch window");
        b.stakeAll(hub, fresh);

        vm.warp(block.timestamp + fresh.ANTI_SNIPE_WINDOW());
        b.stakeAll(hub, fresh);
        assertEq(hub.totalStaked(address(fresh)), amountA + amountB);
    }

    // ── 7. Accounting holds over any sequence ─────────────────────────────────

    function testFuzz_totalEqualsSumOfPositions(uint256 a1, uint256 b1, uint256 a2, uint8 exits) public {
        a1 = bound(a1, MIN, 400_000 ether);
        b1 = bound(b1, MIN, 400_000 ether);
        a2 = bound(a2, MIN, 400_000 ether);
        _stakeAs(alice, token, a1);
        _stakeAs(bob, token, b1);
        _stakeAs(alice, tokenB, a2);

        if (exits & 1 == 1) {
            vm.prank(alice);
            hub.unstakeAll(address(token));
        }
        if (exits & 2 == 2) {
            vm.prank(bob);
            hub.unstakeAll(address(token));
        }

        uint256 sumA = hub.stakedOf(address(token), alice) + hub.stakedOf(address(token), bob);
        assertEq(hub.totalStaked(address(token)), sumA, "token total drifted from positions");
        assertEq(token.balanceOf(address(hub)), sumA, "token held differs from accounted");
        assertEq(hub.totalStaked(address(tokenB)), a2, "second token total drifted");
        assertEq(tokenB.balanceOf(address(hub)), a2, "second token held differs from accounted");
        uint256 stakers = (hub.stakedOf(address(token), alice) > 0 ? 1 : 0) + (hub.stakedOf(address(token), bob) > 0 ? 1 : 0);
        assertEq(hub.stakerCount(address(token)), stakers, "staker count drifted");
    }
}

/// A buyer contract for the launch-window test: buys from a curve, then stakes what it holds.
contract WindowBuyer {
    receive() external payable {}

    function buyUpTo(AdextoCurve c, uint256 tokensWanted) external {
        uint256 lo = 1;
        uint256 hi = 50 ether;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            (uint256 out,,,,) = c.getBuyQuote(mid);
            if (out < tokensWanted) lo = mid + 1;
            else hi = mid;
        }
        c.buy{value: lo}(0, address(this), 0);
    }

    function stakeAll(AdextoStakeHub hub, AdextoToken t) external {
        uint256 amount = t.balanceOf(address(this));
        t.approve(address(hub), amount);
        hub.stake(address(t), amount);
    }
}
