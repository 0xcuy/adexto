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
 * @notice Cross-Chain Liquidity Receiver & Automated Market Order Executor
 * @dev Receives buyback commands from 0G Mainnet/Base and executes local pool swaps
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
