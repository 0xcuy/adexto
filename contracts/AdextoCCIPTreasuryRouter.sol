// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IRouterClient {
    struct EVMTokenAmount {
        address token;
        uint256 amount;
    }

    struct Any2EVMMessage {
        bytes32 messageId;
        uint64 sourceChainSelector;
        bytes sender;
        bytes data;
        EVMTokenAmount[] destTokenAmounts;
    }

    struct EVM2AnyMessage {
        bytes receiver;
        bytes data;
        EVMTokenAmount[] tokenAmounts;
        address feeToken;
        bytes extraArgs;
    }

    function getFee(uint64 destinationChainSelector, EVM2AnyMessage memory message) external view returns (uint256 fee);
    function ccipSend(uint64 destinationChainSelector, EVM2AnyMessage memory message) external payable returns (bytes32);
}

/**
 * @title AdextoCCIPTreasuryRouter
 * @notice Cross-Chain Treasury Rebalancing between Base (8453) and 0G (16661)
 * @dev Sinks DEX fees and routes automated agent buybacks across chains
 */
contract AdextoCCIPTreasuryRouter {
    address public immutable router;
    address public immutable owner;
    
    // Chain Selectors (Chainlink CCIP)
    uint64 public constant CHAIN_SELECTOR_BASE = 15971525489660198786; // Base Mainnet
    uint64 public constant CHAIN_SELECTOR_ARBITRUM = 4949039107694359620; // Arbitrum One
    
    event CrossChainTreasurySynced(
        bytes32 indexed messageId,
        uint64 indexed destinationChainSelector,
        address receiver,
        uint256 feeAmount
    );

    event CrossChainMessageReceived(
        bytes32 indexed messageId,
        uint64 indexed sourceChainSelector,
        address sender,
        bytes payload
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner authorized");
        _;
    }

    constructor(address _router) {
        router = _router;
        owner = msg.sender;
    }

    function sendTreasurySignal(
        uint64 destinationChainSelector,
        address receiver,
        bytes memory payload
    ) external payable onlyOwner returns (bytes32 messageId) {
        IRouterClient.EVMTokenAmount[] memory tokenAmounts = new IRouterClient.EVMTokenAmount[](0);
        
        IRouterClient.EVM2AnyMessage memory message = IRouterClient.EVM2AnyMessage({
            receiver: abi.encode(receiver),
            data: payload,
            tokenAmounts: tokenAmounts,
            feeToken: address(0), // Native token payment
            extraArgs: ""
        });

        uint256 fee = IRouterClient(router).getFee(destinationChainSelector, message);
        require(msg.value >= fee, "Insufficient CCIP fee provided");

        messageId = IRouterClient(router).ccipSend{value: fee}(destinationChainSelector, message);
        emit CrossChainTreasurySynced(messageId, destinationChainSelector, receiver, fee);
        /**
         * Kelebihan di atas fee DIKEMBALIKAN, dan sebelumnya tidak.
         *
         * Fee CCIP baru diketahui setelah `getFee`, jadi pemanggil harus melebihkan kiriman.
         * Tanpa pengembalian, selisihnya mengendap di kontrak yang tidak punya fungsi penarikan
         * — terperangkap selamanya. Itulah High "Contract locks Ether without a withdraw
         * function" dari Aderyn, dan ia menunjuk cacat yang nyata, bukan pembacaan statis.
         *
         * Dikembalikan ke `msg.sender` dan bukan ke `owner`: yang melebihkan bayarannya adalah
         * pemanggil, jadi kepada dialah kelebihan itu milik. Dikirim SETELAH `ccipSend` supaya
         * kegagalan pengiriman membatalkan seluruh transaksi alih-alih membayar balik lebih dulu.
         */
        uint256 refund = msg.value - fee;
        if (refund > 0) {
            (bool sent, ) = payable(msg.sender).call{value: refund}("");
            require(sent, "CCIP fee refund failed");
        }
    }
}
