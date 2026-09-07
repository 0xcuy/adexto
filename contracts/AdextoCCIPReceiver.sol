// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface ICCIPReceiver {
    struct ClientAny2EVMMessage {
        bytes32 messageId;
        uint64 sourceChainSelector;
        bytes sender;
        bytes data;
        address[] destTokens;
        uint256[] amounts;
    }
}

/**
 * @title AdextoCCIPReceiver
 * @notice Inert. Records cross-chain buyback messages and executes nothing.
 * @dev This contract does NOT execute swaps, and the header above used to say it did.
 *
 * `ccipReceive` decodes the payload, bumps two counters and emits an event. It never
 * calls `targetHook`, which is therefore set at construction and never read. Nothing
 * moves. That is the whole behaviour.
 *
 * The gap is deliberate and CCIP was dropped rather than finished, so this is the
 * final state, not a stub waiting on a follow-up. Three of the four deployed
 * receivers were even given a router address that does not exist on their chain,
 * which means `onlyRouter` can never pass and they cannot be invoked at all. They
 * are left deployed rather than hidden, because an address that exists on chain
 * should be findable in the source that produced it.
 *
 * `audit_consistency.mjs` asserts this stays inert on all four chains. If someone
 * later wires the execution path, that audit fails on purpose: turning this on is a
 * decision to re-argue, not a blank to quietly fill in.
 */
contract AdextoCCIPReceiver {
    address public immutable router;
    address public immutable targetHook;
    address public owner;

    uint256 public totalCrossChainBuybacksExecuted;
    uint256 public totalValueReceived;

    event CCIPBuybackExecuted(
        bytes32 indexed messageId,
        uint64 indexed sourceChainSelector,
        address sender,
        uint256 amountIn,
        string targetSymbol
    );

    modifier onlyRouter() {
        require(msg.sender == router, "Only CCIP router authorized");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner authorized");
        _;
    }

    constructor(address _router, address _targetHook) {
        router = _router;
        targetHook = _targetHook;
        owner = msg.sender;
    }

    function ccipReceive(ICCIPReceiver.ClientAny2EVMMessage calldata message) external onlyRouter {
        (address tokenToBuy, uint256 amountIn, string memory symbol) = abi.decode(
            message.data,
            (address, uint256, string)
        );

        totalCrossChainBuybacksExecuted++;
        totalValueReceived += amountIn;

        emit CCIPBuybackExecuted(
            message.messageId,
            message.sourceChainSelector,
            abi.decode(message.sender, (address)),
            amountIn,
            symbol
        );
    }

    receive() external payable {}
}
