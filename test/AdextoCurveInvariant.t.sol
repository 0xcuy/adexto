// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AdextoCurveFixture} from "./AdextoCurveFixture.sol";
import {AdextoCurve} from "../contracts/AdextoCurve.sol";
import {AdextoToken} from "../contracts/AdextoToken.sol";

/**
 * Random actor for the invariant suite.
 *
 * Stateless fuzzing tests one call on a clean state; what it misses is ordering. With four fee
 * buckets that anyone can claim, the sequences worth finding include "claim the protocol fees in
 * the middle of a run of sells", where accounting that is right step by step is most likely to
 * drift when steps combine.
 */
contract AdextoCurveHandler {
    AdextoCurve public immutable curve;
    AdextoToken public immutable token;

    /// Ghost total, summed independently so the invariants do not rely on the contract's counters.
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
     * @dev Lower bound 0.001 ether, not 1 wei, and that is not leniency.
     *
     * With a lower bound of 1 wei, small seeds bought a few thousand wei against a 1,500 ether
     * virtual reserve. A later sell of that amount quoted zero, so the handler returned early and
     * no sell ever happened, while Foundry still reported thousands of `sell` calls with no
     * reverts. The 1 wei edge is covered by the stateless fuzz suite; this suite looks for
     * sequences, and sequences only mean something if the actions actually happen.
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

    /// A share of the holding rather than an absolute amount, for the same reason as above.
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

    /// The buyback is permissionless, so the handler calls it like anyone else.
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

    /// Also permissionless, with an immutable destination, so the handler may trigger it.
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
     * 1. Solvency with the fourth bucket, the most important property here. Every wei the curve
     *    holds must have an owner: the curve, the creator's claim, the buyback bucket or the
     *    protocol's claim.
     */
    function invariant_curveAlwaysSolventWithProtocolLeg() public view {
        uint256 accounted =
            curve.realNative() + curve.creatorOwed() + curve.treasuryNative() + curve.protocolOwed();
        assertGe(address(curve).balance, accounted, "curve insolvent after a random sequence");
    }

    /**
     * 2. No protocol fee is lost or created. What is owed plus what was paid must equal what the
     *    handler summed from the quotes: less means a path spent protocol fees elsewhere, more
     *    means a path accrued them twice.
     */
    function invariant_protocolFeesConserved() public view {
        assertEq(
            curve.protocolOwed() + curve.totalProtocolFeesPaid(),
            handler.protocolAccrued(),
            "protocol fees lost or created"
        );
    }

    /// 3. Protocol fees paid never go down, or the revenue record would mean nothing.
    function invariant_totalProtocolPaidNeverFalls() public {
        uint256 paidNow = curve.totalProtocolFeesPaid();
        assertGe(paidNow, lastTotalProtocolPaid, "total protocol fees paid went down");
        lastTotalProtocolPaid = paidNow;
    }

    /**
     * 4. The treasury never receives more than recorded. It is the only place protocol fees may
     *    land, so its balance must equal `totalProtocolFeesPaid`; more would mean an unrecorded
     *    path, and an unrecorded path cannot be audited.
     */
    function invariant_treasuryBalanceMatchesPaid() public view {
        assertEq(
            PROTOCOL_TREASURY.balance,
            curve.totalProtocolFeesPaid(),
            "treasury balance does not match what was recorded as paid"
        );
    }

    /**
     * 5. The price floor never falls. The protocol leg leaves the curve, so if it were counted as
     *    depth anywhere, the floor would rise without the money being in the curve, or fall when
     *    it was claimed. Both are caught here.
     */
    function invariant_floorNeverFalls() public {
        uint256 floorNow = curve.floorPriceNativePerToken();
        assertGe(floorNow, lastFloor, "the price floor fell");
        lastFloor = floorNow;
    }

    function invariant_supplyNeverGrows() public view {
        assertLe(token.totalSupply(), initialSupply, "total supply grew");
    }

    function invariant_tokensSoldWithinCurve() public view {
        assertLe(curve.tokensSold(), curve.curveTokens(), "tokensSold exceeds curveTokens");
    }

    function invariant_inventoryMatchesBalance() public view {
        assertEq(
            token.balanceOf(address(curve)),
            curve.curveTokens() - curve.tokensSold(),
            "internal inventory does not match the ERC-20 balance"
        );
    }

    function invariant_creatorHoldsNoTokens() public view {
        assertEq(token.balanceOf(address(this)), 0, "the creator holds tokens");
    }

    /**
     * Guard against a suite that passes while testing nothing.
     *
     * `fail_on_revert = false` is deliberate: the handler refuses nonsensical actions with
     * `return`, and reverts must not stop the search for sequences. The side effect is that if
     * every action failed, no state would change and every invariant above would hold vacuously.
     * That has happened here twice: once in a mutation test where every buy reverted and this
     * whole suite still passed, and once when every sell quoted zero and the handler returned
     * early while thousands of calls were reported.
     *
     * Written as an ordinary test, not `afterInvariant`, which was tried and evaluated one call
     * into a new sequence, so its result depended on how the suite was invoked.
     */
    function test_handlerCanActuallyPerformEveryAction() public {
        handler.buy(uint256(keccak256("buy")));
        assertGt(handler.buys(), 0, "the handler cannot buy: the invariant suite would be vacuous");

        handler.sell(uint256(keccak256("sell")));
        assertGt(handler.sells(), 0, "the handler cannot sell: the invariant suite would be vacuous");

        handler.buy(uint256(keccak256("buy2")));
        handler.buyback(uint256(keccak256("buyback")));
        assertGt(handler.buybacks(), 0, "the handler cannot buy back: that path is untested");

        handler.claimCreator();
        assertGt(handler.creatorClaims(), 0, "the handler cannot claim creator fees: that path is untested");

        handler.claimProtocol();
        assertGt(handler.protocolClaims(), 0, "the handler cannot claim protocol fees: that path is untested");

        // After all five paths have run, the accounting must still hold.
        assertEq(
            curve.protocolOwed() + curve.totalProtocolFeesPaid(),
            handler.protocolAccrued(),
            "protocol fees lost or created after the five actions"
        );
        _assertSolvent();
    }
}
