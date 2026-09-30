// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {AdextoFactory} from "../contracts/AdextoFactory.sol";
import {AdextoCurve} from "../contracts/AdextoCurve.sol";
import {AdextoToken} from "../contracts/AdextoToken.sol";

/**
 * Shared fixture: one real launch through the factory, not a curve assembled by hand.
 *
 * Assembling a curve directly allows states that production can never reach, and a property
 * that holds in an impossible state proves nothing. Here the path is the one users take.
 *
 * `PROTOCOL_TREASURY` is deliberately not `address(this)`. The fixture is also the creator,
 * so if both roles shared an address, a test asserting "protocol fees land at the treasury"
 * would pass even if protocol fees were routed to the creator.
 */
abstract contract AdextoCurveFixture is Test {
    AdextoFactory internal factory;
    AdextoCurve internal curve;
    AdextoToken internal token;

    /// An EOA with no code, so a value `call` to it always succeeds.
    address internal constant PROTOCOL_TREASURY = address(0xBEEF);

    /**
     * The studio's launch model: a 100 bps total, which is exactly what a trader pays.
     *
     * Production rates, not convenient ones. A fixture with different rates would prove
     * properties of a fee split nobody uses, and the split is where the four legs interact.
     * `TOTAL_PAID_BPS` equals `SWAP_FEE_BPS` because the protocol leg is carved out of the
     * total; it is kept as its own constant so a test fails if the two ever drift apart.
     */
    uint256 internal constant SWAP_FEE_BPS = 100;
    uint256 internal constant CREATOR_BPS = 70;
    uint256 internal constant TREASURY_BPS = 10;
    uint256 internal constant PROTOCOL_BPS = 10;
    /// depth = 100 - 70 - 10 - 10 = 10, computed by the factory as the remainder.
    uint256 internal constant DEPTH_BPS = 10;
    uint256 internal constant TOTAL_PAID_BPS = 100;

    /// The generation the source declares. One place, so a version bump is one edit.
    string internal constant SOURCE_VERSION = "1.0.0";

    uint256 internal constant SUPPLY = 1_000_000_000;
    /// Same order of magnitude as a production opening on 0G.
    uint256 internal constant VIRTUAL_NATIVE = 1500 ether;

    /**
     * Tickers reserved in the factory constructor: the base list broadcast on every chain.
     *
     * The first six are ADEXTO's own live markets. They trade on the 0.11.0 factories and stay
     * there, so reserving them on v1 stops a lookalike from ever being launched under the same
     * name on any chain. The other ten are major asset names, reserved so a curve token can never
     * be mistaken for the real asset. The Robinhood Chain deployment appends the tickers of the
     * tokenized equities on that chain.
     *
     * Must equal `base` in scripts/reserved-symbols.json, in the same order. The deploy script
     * refuses to broadcast when the two differ, because a fixture that drifts from the deployed
     * list would prove protection for a list nobody broadcast.
     */
    function reservedSymbols() internal pure returns (string[] memory list) {
        list = new string[](16);
        list[0] = "ADEXTO";
        list[1] = "ADT";
        list[2] = "ZEEBO";
        list[3] = "WOMBO";
        list[4] = "BLOOP";
        list[5] = "PARCEL";
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

    /// Deploys the factory and one market, then moves past the launch window.
    function _launchCurve() internal {
        _launchCurveInWindow();
        /**
         * Skip the launch window. Its per-wallet limit is real and has its own suite
         * (`AdextoTokenLaunchWindow.t.sol`), but left active here it would reject large fuzz
         * samples, and the result would measure rejected samples instead of the curve.
         */
        vm.warp(block.timestamp + token.ANTI_SNIPE_WINDOW());
    }

    /// Deploys the factory and one market, and stays inside the launch window.
    function _launchCurveInWindow() internal {
        // The production reserved list, not an empty one. A fixture without reservations would
        // test a factory nobody broadcasts.
        factory = new AdextoFactory(PROTOCOL_TREASURY, reservedSymbols());
        (address t, address c) = factory.deployTrinity(
            "Adexto Curve Fuzz Agent",
            "FUZZ3",
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
    }

    /**
     * Solvency, written once. `protocolOwed` must be a term: leaving it out would let the check
     * pass on money that already belongs to the treasury, and the shortfall would surface only
     * as a failed sell for whoever happened to be last.
     */
    function _assertSolvent() internal view {
        uint256 accounted =
            curve.realNative() + curve.creatorOwed() + curve.treasuryNative() + curve.protocolOwed();
        assertGe(address(curve).balance, accounted, "curve insolvent: balance below what it owes");
    }

    /// The curve pays sellers and fee claimants, so the fixture must be able to receive native.
    receive() external payable {}
}
