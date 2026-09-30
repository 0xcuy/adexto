// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {AdextoCurveFixture} from "./AdextoCurveFixture.sol";
import {AdextoFactory} from "../contracts/AdextoFactory.sol";
import {AdextoCurve} from "../contracts/AdextoCurve.sol";

/**
 * Stateless fuzz properties of the curve and factory.
 *
 * What is tested: the four fee legs are charged as published, the protocol leg is carved out of
 * the total rather than added to it, each claim can only ever reach its immutable recipient,
 * rounding always favours the curve, and solvency holds after every action.
 */
contract AdextoCurveFuzzTest is AdextoCurveFixture {
    function setUp() public {
        _launchCurve();
    }

    function _boundBuy(uint256 raw) internal pure returns (uint256) {
        return bound(raw, 1, 100_000 ether);
    }

    // ── 1. Fee legs are configured as published ──────────────────────────────
    //
    // These numbers are published, so the contract has to prove them, not the documentation.
    function test_feeLegsMatchPublishedNumbers() public view {
        assertEq(curve.depthFeeBps(), DEPTH_BPS, "depth is not 10 bps");
        assertEq(curve.creatorFeeBps(), CREATOR_BPS, "creator is not 70 bps");
        assertEq(curve.treasuryBuybackBps(), TREASURY_BPS, "buyback is not 10 bps");
        assertEq(curve.protocolFeeBps(), PROTOCOL_BPS, "protocol is not 10 bps");
        assertEq(curve.totalFeeBps(), TOTAL_PAID_BPS, "total paid is not 100 bps");
        assertEq(factory.PROTOCOL_FEE_BPS(), PROTOCOL_BPS, "factory constant is not 10 bps");
        // The four legs must add up to exactly `swapFeeBps`: nothing is charged outside the quote.
        assertEq(
            curve.depthFeeBps() + curve.creatorFeeBps() + curve.treasuryBuybackBps() + curve.protocolFeeBps(),
            SWAP_FEE_BPS,
            "the four legs do not add up to swapFeeBps"
        );
        assertEq(curve.protocolTreasury(), PROTOCOL_TREASURY, "wrong protocol treasury");
        // The factory embeds the curve's creation code, so two different numbers would mean one
        // of them was never updated.
        assertEq(curve.VERSION(), SOURCE_VERSION, "wrong curve version");
        assertEq(factory.VERSION(), SOURCE_VERSION, "wrong factory version");
        assertEq(curve.VERSION(), factory.VERSION(), "curve and factory versions differ");
    }

    // ── 2. Quotes equal execution, protocol leg included ─────────────────────
    function testFuzz_buyQuoteMatchesExecution(uint256 rawIn) public {
        uint256 nativeIn = _boundBuy(rawIn);
        vm.deal(address(this), nativeIn);

        (uint256 quoted,,,, uint256 protocolFee) = curve.getBuyQuote(nativeIn);
        vm.assume(quoted > 0);

        uint256 owedBefore = curve.protocolOwed();
        uint256 received = curve.buy{value: nativeIn}(0, address(this), block.timestamp + 1);

        assertEq(received, quoted, "buy returned something other than the quote");
        assertEq(curve.protocolOwed() - owedBefore, protocolFee, "accrued protocol fee differs from the quote");
        _assertSolvent();
    }

    function testFuzz_sellQuoteMatchesExecution(uint256 rawIn, uint256 sellPct) public {
        uint256 nativeIn = _boundBuy(rawIn);
        vm.deal(address(this), nativeIn);
        (uint256 bought,,,,) = curve.getBuyQuote(nativeIn);
        vm.assume(bought > 0);
        curve.buy{value: nativeIn}(0, address(this), block.timestamp + 1);

        uint256 amount = (bought * bound(sellPct, 1, 100)) / 100;
        vm.assume(amount > 0);

        (uint256 quotedOut,,,, uint256 protocolFee) = curve.getSellQuote(amount);
        vm.assume(quotedOut > 0);

        token.approve(address(curve), amount);
        uint256 owedBefore = curve.protocolOwed();
        uint256 out = curve.sell(amount, 0, address(this), block.timestamp + 1);

        assertEq(out, quotedOut, "sell returned something other than the quote");
        assertEq(curve.protocolOwed() - owedBefore, protocolFee, "protocol fee on the sell differs from the quote");
        _assertSolvent();
    }

    // ── 3. The protocol fee is exact bps arithmetic ──────────────────────────
    function testFuzz_protocolFeeIsExactBpsOfInput(uint256 rawIn) public view {
        uint256 nativeIn = _boundBuy(rawIn);
        (,,,, uint256 protocolFee) = curve.getBuyQuote(nativeIn);
        assertEq(protocolFee, (nativeIn * PROTOCOL_BPS) / 10_000, "protocol fee != bps * input");
    }

    // ── 4. The four legs never exceed the input ──────────────────────────────
    function testFuzz_fourLegsNeverExceedInput(uint256 rawIn) public view {
        uint256 nativeIn = _boundBuy(rawIn);
        (, uint256 depthFee, uint256 creatorFee, uint256 treasuryFee, uint256 protocolFee) =
            curve.getBuyQuote(nativeIn);
        assertLe(depthFee + creatorFee + treasuryFee + protocolFee, nativeIn, "total fee exceeds the input");
    }

    // ── 5. The protocol leg is carved out of the total, not added on top ─────
    //
    // A trader is quoted `swapFeeBps` and must pay exactly that. If the protocol leg were
    // added on top, the fee on an input would be `swapFeeBps + PROTOCOL_BPS` of it, which is
    // what generation 0.11.0 charged.
    //
    // Each leg is floored on its own, so four floors can undercut one floor of the total by at
    // most three wei, and always in the trader's favour. The bound is exact, not a tolerance:
    // a leg that genuinely moved would break it.
    function testFuzz_protocolFeeIsCarvedOutOnBuy(uint256 rawIn) public view {
        uint256 nativeIn = bound(rawIn, 1 ether, 100_000 ether);
        (, uint256 depthFee, uint256 creatorFee, uint256 treasuryFee, uint256 protocolFee) =
            curve.getBuyQuote(nativeIn);
        _assertCarvedOut(nativeIn, depthFee + creatorFee + treasuryFee + protocolFee, protocolFee);
    }

    function testFuzz_protocolFeeIsCarvedOutOnSell(uint256 rawIn) public {
        uint256 nativeIn = bound(rawIn, 1 ether, 100_000 ether);
        vm.deal(address(this), nativeIn);
        (uint256 bought,,,,) = curve.getBuyQuote(nativeIn);
        vm.assume(bought > 0);
        curve.buy{value: nativeIn}(0, address(this), block.timestamp + 1);

        (uint256 nativeOut, uint256 depthFee, uint256 creatorFee, uint256 treasuryFee, uint256 protocolFee) =
            curve.getSellQuote(bought);
        uint256 charged = depthFee + creatorFee + treasuryFee + protocolFee;
        _assertCarvedOut(nativeOut + charged, charged, protocolFee);
    }

    /// `gross` is what the fee is taken from: native in on a buy, gross proceeds on a sell.
    function _assertCarvedOut(uint256 gross, uint256 charged, uint256 protocolFee) internal pure {
        uint256 quotedTotal = (gross * SWAP_FEE_BPS) / 10_000;
        uint256 additiveTotal = (gross * (SWAP_FEE_BPS + PROTOCOL_BPS)) / 10_000;
        assertGt(protocolFee, 0, "no protocol fee on a real-sized trade");
        assertLe(charged, quotedTotal, "charged more than the quoted total");
        assertLe(quotedTotal - charged, 3, "more than rounding separates the legs from the total");
        assertLt(charged, additiveTotal, "the protocol leg was charged on top of the total");
    }

    // ── 6. Protocol fees can only reach the immutable treasury ───────────────
    //
    // `claimProtocolFees` takes no destination, so anyone may trigger it and the money must
    // always land at the treasury.
    function testFuzz_protocolFeesOnlyReachTreasury(uint256 rawIn, address caller) public {
        vm.assume(caller != address(0) && caller != PROTOCOL_TREASURY && caller != address(this));
        vm.assume(caller.code.length == 0 && caller.balance == 0);

        uint256 nativeIn = bound(rawIn, 1 ether, 100_000 ether);
        vm.deal(address(this), nativeIn);
        (uint256 bought,,,,) = curve.getBuyQuote(nativeIn);
        vm.assume(bought > 0);
        curve.buy{value: nativeIn}(0, address(this), block.timestamp + 1);

        uint256 owed = curve.protocolOwed();
        vm.assume(owed > 0);

        uint256 treasuryBefore = PROTOCOL_TREASURY.balance;
        uint256 creatorBefore = address(this).balance;

        vm.prank(caller);
        curve.claimProtocolFees();

        assertEq(PROTOCOL_TREASURY.balance - treasuryBefore, owed, "treasury was not paid in full");
        assertEq(caller.balance, 0, "the caller received native without being the treasury");
        assertEq(address(this).balance, creatorBefore, "the creator received protocol fees");
        assertEq(curve.protocolOwed(), 0, "protocol debt was not cleared");
        assertEq(curve.totalProtocolFeesPaid(), owed, "total paid was not recorded");
        _assertSolvent();
    }

    // ── 7. Creator and protocol claims do not take from each other ───────────
    //
    // Two buckets that anyone can claim are where one claim emptying the other would appear.
    function testFuzz_creatorAndProtocolClaimsAreIndependent(uint256 rawIn) public {
        uint256 nativeIn = bound(rawIn, 1 ether, 100_000 ether);
        vm.deal(address(this), nativeIn);
        (uint256 bought,,,,) = curve.getBuyQuote(nativeIn);
        vm.assume(bought > 0);
        curve.buy{value: nativeIn}(0, address(this), block.timestamp + 1);

        uint256 creatorOwed = curve.creatorOwed();
        uint256 protocolOwed = curve.protocolOwed();
        vm.assume(creatorOwed > 0 && protocolOwed > 0);

        curve.claimCreatorFees();
        assertEq(curve.protocolOwed(), protocolOwed, "the creator claim changed protocol debt");

        uint256 treasuryBefore = PROTOCOL_TREASURY.balance;
        curve.claimProtocolFees();
        assertEq(PROTOCOL_TREASURY.balance - treasuryBefore, protocolOwed, "the treasury received the wrong amount");
        assertEq(curve.creatorOwed(), 0, "creator debt changed after the protocol claim");
        _assertSolvent();
    }

    // ── 8. A buyback charges no protocol fee ─────────────────────────────────
    //
    // A buyback recycles money that already came from fees, so charging it again would be a
    // fee on a fee.
    function testFuzz_buybackChargesNoProtocolFee(uint256 rawIn) public {
        uint256 nativeIn = bound(rawIn, 1 ether, 100_000 ether);
        vm.deal(address(this), nativeIn);
        (uint256 bought,,,,) = curve.getBuyQuote(nativeIn);
        vm.assume(bought > 0);
        curve.buy{value: nativeIn}(0, address(this), block.timestamp + 1);

        uint256 treasury = curve.treasuryNative();
        vm.assume(treasury > 0);
        (uint256 reserveNative,) = curve.getReserves();
        uint256 cap = reserveNative / 100;
        uint256 spend = treasury > cap ? cap : treasury;
        vm.assume(spend > 0);
        (uint256 willBurn,,,,) = curve.getBuyQuote(spend);
        vm.assume(willBurn > 0);

        uint256 protocolBefore = curve.protocolOwed();
        curve.executeBuyback(spend, 0);

        assertEq(curve.protocolOwed(), protocolBefore, "the buyback charged a protocol fee");
        _assertSolvent();
    }

    // ── 9. A round trip is never profitable ──────────────────────────────────
    function testFuzz_roundTripNeverProfitable(uint256 rawIn) public {
        uint256 nativeIn = _boundBuy(rawIn);
        vm.deal(address(this), nativeIn);

        (uint256 bought,,,,) = curve.getBuyQuote(nativeIn);
        vm.assume(bought > 0);
        curve.buy{value: nativeIn}(0, address(this), block.timestamp + 1);

        (uint256 back,,,,) = curve.getSellQuote(bought);
        vm.assume(back > 0);
        token.approve(address(curve), bought);
        uint256 out = curve.sell(bought, 0, address(this), block.timestamp + 1);

        assertLt(out, nativeIn, "a round trip made a profit: the curve could be drained");
        _assertSolvent();
    }

    // ── 10. A zero protocol treasury is rejected at deployment ───────────────
    //
    // If this passed, curves would accrue `protocolOwed` that nobody could claim, locked forever.
    function test_zeroProtocolTreasuryRejected() public {
        vm.expectRevert(bytes("Factory: zero protocol treasury"));
        new AdextoFactory(address(0), new string[](0));
    }

    // ── 11. The 5% cap applies to what a trader actually pays ────────────────
    //
    // Tested from both sides on purpose. Testing only the rejected side would still pass if the
    // cap quietly moved down and legitimate markets became impossible to launch.
    function test_capCountsProtocolLeg() public {
        vm.expectRevert(bytes("Factory: fee too high"));
        factory.deployTrinity(
            "Over Cap", "OVER", SUPPLY, address(this), VIRTUAL_NATIVE, 501, 10, 5, bytes32(0), false, 0
        );

        // 500 is exactly at the cap, with the protocol leg inside it: depth = 500 - 10 - 5 - 10.
        (, address c) = factory.deployTrinity(
            "At Cap", "ATCAP", SUPPLY, address(this), VIRTUAL_NATIVE, 500, 10, 5, bytes32(0), false, 0
        );
        assertEq(AdextoCurve(payable(c)).totalFeeBps(), 500, "total at the cap is not 500 bps");
        assertEq(AdextoCurve(payable(c)).depthFeeBps(), 475, "depth at the cap is not 475 bps");
    }

    // ── 12. A fee with no room for the protocol leg is rejected ──────────────
    //
    // Without `PROTOCOL_FEE_BPS` in the shares check, computing `depthFeeBps` would underflow
    // into a panic with no message. Two cases, because they fail by different routes: a fee
    // smaller than the protocol leg, and a fee already used up by the other two shares.
    function test_feeTooSmallForProtocolLegRejected() public {
        vm.expectRevert(bytes("Factory: shares exceed fee"));
        factory.deployTrinity(
            "Tiny Fee", "TINY", SUPPLY, address(this), VIRTUAL_NATIVE, 5, 0, 0, bytes32(0), false, 0
        );

        vm.expectRevert(bytes("Factory: shares exceed fee"));
        factory.deployTrinity(
            "No Room", "NOROOM", SUPPLY, address(this), VIRTUAL_NATIVE, 100, 70, 30, bytes32(0), false, 0
        );

        // Exactly enough room: 70 + 20 + 10 = 100, depth 0. Legitimate: a zero depth leg is
        // allowed, a protocol leg with no room is not.
        (, address c) = factory.deployTrinity(
            "Exact Room", "EXACT", SUPPLY, address(this), VIRTUAL_NATIVE, 100, 70, 20, bytes32(0), false, 0
        );
        assertEq(AdextoCurve(payable(c)).depthFeeBps(), 0, "depth is not zero when the room is used exactly");
        assertEq(AdextoCurve(payable(c)).protocolFeeBps(), PROTOCOL_BPS, "protocol leg missing when the room is used exactly");
    }

    // ── 13. Reserved tickers cannot be launched by anyone ────────────────────
    //
    // `symbolRegistry` belongs to one factory, so a new factory starts with an empty book.
    // Tested from two addresses: `deployTrinity` has no access control, so what must be proven
    // is that everyone is refused, including the address that deployed the factory.
    function test_reservedSymbolsCannotBeLaunchedByAnyone() public {
        string[] memory reserved = reservedSymbols();
        address stranger = address(0xC0FFEE);

        for (uint256 i = 0; i < reserved.length; i++) {
            vm.expectRevert(bytes("Factory: symbol already taken"));
            factory.deployTrinity(
                "Squat", reserved[i], SUPPLY, address(this), VIRTUAL_NATIVE,
                SWAP_FEE_BPS, CREATOR_BPS, TREASURY_BPS, bytes32(0), false, 0
            );

            vm.prank(stranger);
            vm.expectRevert(bytes("Factory: symbol already taken"));
            factory.deployTrinity(
                "Squat", reserved[i], SUPPLY, stranger, VIRTUAL_NATIVE,
                SWAP_FEE_BPS, CREATOR_BPS, TREASURY_BPS, bytes32(0), false, 0
            );

            assertFalse(factory.isSymbolAvailable(reserved[i]), "isSymbolAvailable is true for a reserved ticker");
            assertEq(
                factory.symbolRegistry(keccak256(abi.encodePacked(reserved[i]))),
                factory.SYMBOL_RESERVED(),
                "reserved slot does not hold the marker"
            );
        }
    }

    // ── 14. Reservation is case-insensitive ──────────────────────────────────
    //
    // Without upper-casing in both places, reserving "ETH" would not stop "eth", which is the
    // same name to every human reader.
    function test_reservedSymbolIsCaseInsensitive() public {
        vm.expectRevert(bytes("Factory: symbol already taken"));
        factory.deployTrinity(
            "lowercase eth", "eth", SUPPLY, address(this), VIRTUAL_NATIVE,
            SWAP_FEE_BPS, CREATOR_BPS, TREASURY_BPS, bytes32(0), false, 0
        );
        assertFalse(factory.isSymbolAvailable("eth"), "lower-case eth is still available");
        assertFalse(factory.isSymbolAvailable("EtH"), "mixed-case EtH is still available");
    }

    // ── 15. A ticker outside the reserved list still launches ────────────────
    //
    // The pair of test 13. A reservation that is too wide would kill the product, and a test
    // that only checks refusals would not notice.
    function test_unreservedSymbolStillLaunches() public {
        (address t, address c) = factory.deployTrinity(
            "Not Reserved", "NOTRSV", SUPPLY, address(this), VIRTUAL_NATIVE,
            SWAP_FEE_BPS, CREATOR_BPS, TREASURY_BPS, bytes32(0), false, 0
        );
        assertTrue(t != address(0) && c != address(0), "launching a free ticker failed");
        assertFalse(factory.isSymbolAvailable("NOTRSV"), "ticker not claimed after launch");
        assertEq(factory.symbolRegistry(keccak256(abi.encodePacked("NOTRSV"))), t, "slot does not hold the token");
    }

    // ── 16. The reserved marker cannot be mistaken for a real token ──────────
    function test_reservedMarkerIsNotAContract() public view {
        address marker = factory.SYMBOL_RESERVED();
        assertEq(marker.code.length, 0, "the reserved marker has code and could be read as a token");
        assertTrue(marker != address(0), "a zero marker would read as available");
    }

    // ── 17. Buy rounding favours the curve ───────────────────────────────────
    //
    // Compared with the exact rational value by cross-multiplication, not with a second integer
    // division that would equal the quote by construction.
    function testFuzz_buyRoundsInFavourOfCurve(uint256 rawIn) public view {
        uint256 nativeIn = _boundBuy(rawIn);
        (uint256 reserveNative, uint256 reserveToken) = curve.getReserves();
        (uint256 quoted, uint256 depthFee, uint256 creatorFee, uint256 treasuryFee, uint256 protocolFee) =
            curve.getBuyQuote(nativeIn);
        uint256 dx = nativeIn - depthFee - creatorFee - treasuryFee - protocolFee;
        vm.assume(dx > 0);
        assertLe(
            quoted * (reserveNative + dx),
            reserveToken * dx,
            "the quote exceeds the exact value: rounding favours the trader"
        );
    }

    // ── 18. Nobody can sell more than is outstanding ─────────────────────────
    function testFuzz_cannotSellMoreThanOutstanding(uint256 rawIn, uint256 excess) public {
        uint256 nativeIn = _boundBuy(rawIn);
        vm.deal(address(this), nativeIn);
        (uint256 bought,,,,) = curve.getBuyQuote(nativeIn);
        vm.assume(bought > 0);
        curve.buy{value: nativeIn}(0, address(this), block.timestamp + 1);

        uint256 over = curve.tokensSold() + bound(excess, 1, 1e30);
        token.approve(address(curve), over);
        vm.expectRevert(bytes("AdextoCurve: exceeds outstanding supply"));
        curve.sell(over, 0, address(this), block.timestamp + 1);
    }

    // ── 19. A buyback is capped at 1% of the reserve per call, from any address ─
    //
    // This is the curve's first buyback (`lastBuybackAt == 0`), so the cap is what is tested,
    // not the cooldown, which has its own suite in AdextoBuybackCooldown.t.sol.
    function testFuzz_buybackCappedAtOnePercent(uint256 rawIn, address caller) public {
        vm.assume(caller != address(0) && caller.code.length == 0);
        uint256 nativeIn = bound(rawIn, 1 ether, 100_000 ether);
        vm.deal(address(this), nativeIn);
        (uint256 bought,,,,) = curve.getBuyQuote(nativeIn);
        vm.assume(bought > 0);
        curve.buy{value: nativeIn}(0, address(this), block.timestamp + 1);

        uint256 treasury = curve.treasuryNative();
        vm.assume(treasury > 0);
        (uint256 reserveNative,) = curve.getReserves();
        uint256 cap = reserveNative / 100;

        if (treasury > cap) {
            vm.prank(caller);
            vm.expectRevert(bytes("AdextoCurve: buyback exceeds 1% of reserve"));
            curve.executeBuyback(cap + 1, 0);
        }

        uint256 spend = treasury > cap ? cap : treasury;
        vm.assume(spend > 0);
        (uint256 willBurn,,,,) = curve.getBuyQuote(spend);
        vm.assume(willBurn > 0);

        uint256 supplyBefore = token.totalSupply();
        vm.prank(caller);
        curve.executeBuyback(spend, 0);
        assertLt(token.totalSupply(), supplyBefore, "the buyback did not reduce supply");
        _assertSolvent();
    }

    // ── 20. Creator fees only reach the creator, whoever calls ───────────────
    function testFuzz_creatorFeesOnlyReachCreator(uint256 rawIn, address caller) public {
        vm.assume(
            caller != address(0) && caller != address(this) && caller != PROTOCOL_TREASURY && caller.code.length == 0
        );
        uint256 nativeIn = bound(rawIn, 1 ether, 100_000 ether);
        vm.deal(address(this), nativeIn);
        (uint256 bought,,,,) = curve.getBuyQuote(nativeIn);
        vm.assume(bought > 0);
        curve.buy{value: nativeIn}(0, address(this), block.timestamp + 1);

        uint256 owed = curve.creatorOwed();
        vm.assume(owed > 0);
        uint256 creatorBefore = address(this).balance;
        uint256 callerBefore = caller.balance;
        uint256 treasuryBefore = PROTOCOL_TREASURY.balance;
        uint256 protocolOwedBefore = curve.protocolOwed();

        vm.prank(caller);
        curve.claimCreatorFees();

        assertEq(address(this).balance - creatorBefore, owed, "the creator was not paid in full");
        assertEq(caller.balance, callerBefore, "the caller received native without being the creator");
        assertEq(PROTOCOL_TREASURY.balance, treasuryBefore, "the creator claim moved native to the protocol treasury");
        assertEq(curve.protocolOwed(), protocolOwedBefore, "the creator claim changed protocol debt");
        assertEq(curve.creatorOwed(), 0, "creator debt was not cleared");
        _assertSolvent();
    }
}
