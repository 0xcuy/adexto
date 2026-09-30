// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {AdextoFactory} from "../AdextoFactory.sol";
import {AdextoCurve} from "../AdextoCurve.sol";
import {AdextoToken} from "../AdextoToken.sol";

/**
 * Echidna harness for the AdextoFactory / AdextoCurve / AdextoToken generation.
 *
 * Launches through `AdextoFactory` with the production fee model (100 bps: creator 70, depth 10,
 * buyback 10, protocol 10), the same as `test/AdextoCurveFixture.sol`, so a second fuzzing engine
 * attacks the exact contracts that launch markets.
 *
 * `echidna_solvent` must include `protocolOwed`: without that term the curve would read as solvent
 * on money that already belongs to the treasury. The one-hour buyback cooldown does not stop
 * buybacks here, because Echidna advances `block.timestamp` between transactions.
 *
 * The creator and the trader are both this contract, because Echidna calls one contract. The
 * property "the creator holds no tokens" lives in `test/AdextoCurveInvariant.t.sol`, which has a
 * separate handler. The launch-window property below covers the per-wallet limit.
 */
contract EchidnaAdextoCurve {
    AdextoFactory internal factory;
    AdextoCurve internal curve;
    AdextoToken internal token;
    uint256 internal initialSupply;

    /// An address with no code, not this contract, so a misrouted protocol fee would show.
    address internal constant PROTOCOL_TREASURY = address(0xBEEF);

    constructor() payable {
        factory = new AdextoFactory(PROTOCOL_TREASURY, new string[](0));
        (address t, address c) = factory.deployTrinity(
            "Echidna Adexto Curve",
            "ECH13",
            1_000_000_000,
            address(this),
            1500 ether,
            100,
            70,
            10,
            bytes32(0),
            false,
            0
        );
        token = AdextoToken(t);
        curve = AdextoCurve(payable(c));
        initialSupply = token.totalSupply();
    }

    receive() external payable {}

    // ── Actions the fuzzer may try ────────────────────────────────────────────

    function buy(uint256 seed) public {
        uint256 amount = 1 + (seed % 5_000 ether);
        if (address(this).balance < amount) return;
        (uint256 quoted,,,,) = curve.getBuyQuote(amount);
        if (quoted == 0) return;
        curve.buy{value: amount}(0, address(this), block.timestamp + 1);
    }

    function sell(uint256 seed) public {
        uint256 held = token.balanceOf(address(this));
        if (held == 0) return;
        uint256 amount = 1 + (seed % held);
        (uint256 quoted,,,,) = curve.getSellQuote(amount);
        if (quoted == 0) return;
        token.approve(address(curve), amount);
        curve.sell(amount, 0, address(this), block.timestamp + 1);
    }

    function buyback(uint256 seed) public {
        uint256 treasury = curve.treasuryNative();
        if (treasury == 0) return;
        (uint256 reserveNative,) = curve.getReserves();
        uint256 cap = reserveNative / 100;
        uint256 max = treasury < cap ? treasury : cap;
        if (max == 0) return;
        uint256 amount = 1 + (seed % max);
        (uint256 willBurn,,,,) = curve.getBuyQuote(amount);
        if (willBurn == 0) return;
        curve.executeBuyback(amount, 0);
    }

    function claim() public {
        if (curve.creatorOwed() == 0) return;
        curve.claimCreatorFees();
    }

    function claimProtocol() public {
        if (curve.protocolOwed() == 0) return;
        curve.claimProtocolFees();
    }

    // ── Properties ────────────────────────────────────────────────────────────

    /// Every wei the curve holds has an owner, the protocol treasury included.
    function echidna_solvent() public view returns (bool) {
        return
            address(curve).balance >=
            curve.realNative() + curve.creatorOwed() + curve.treasuryNative() + curve.protocolOwed();
    }

    /// `_mint` runs once, in the constructor, and there is no mint function: supply only falls.
    function echidna_supplyNeverGrows() public view returns (bool) {
        return token.totalSupply() <= initialSupply;
    }

    /// The internal inventory matches the real ERC-20 balance.
    function echidna_inventoryMatchesBalance() public view returns (bool) {
        return token.balanceOf(address(curve)) == curve.curveTokens() - curve.tokensSold();
    }

    /// If this could be exceeded, `curveTokens - _tokensSold` would underflow.
    function echidna_tokensSoldWithinCurve() public view returns (bool) {
        return curve.tokensSold() <= curve.curveTokens();
    }

    /// Protocol fees land only at the treasury, and exactly as much as was recorded as paid.
    function echidna_treasuryBalanceMatchesPaid() public view returns (bool) {
        return PROTOCOL_TREASURY.balance == curve.totalProtocolFeesPaid();
    }

    /// Inside the launch window, no wallet holds more than the per-wallet limit.
    function echidna_walletLimitDuringWindow() public view returns (bool) {
        if (block.timestamp >= token.launchTime() + token.ANTI_SNIPE_WINDOW()) return true;
        return token.balanceOf(address(this)) <= token.maxWalletAmount();
    }
}
