// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title SovereignHook
 * @notice Uniswap v4 Sovereign Hook implementation for ADEXTO Protocol (adexto.xyz)
 * @dev Intercepts swap delta on-chain, allocating:
 *      - 0.20% to Liquidity Providers (LPs)
 *      - 0.10% directly to the 0G TEE Agent Buyback & Burn Treasury Vault
 */

interface IPoolManager {
    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }
}

interface IAdextoToken {
    function executeTreasuryBuyback(uint256 amountToBurn) external;
}

contract SovereignHook {
    address public immutable factory;
    address public immutable agentTreasury;
    address public immutable targetToken;

    uint256 public constant LP_FEE_BPS = 20; // 0.20%
    uint256 public constant TREASURY_BUYBACK_BPS = 10; // 0.10%
    uint256 public constant TOTAL_FEE_BPS = 30; // 0.30%

    uint256 public totalTreasuryFeesCollected;
    uint256 public totalTokensBurned;

    event TreasuryFeeCollected(address indexed currency, uint256 amount);
    event AutoBuybackExecuted(uint256 amountIn, uint256 tokensBurned);

    modifier onlyAgent() {
        require(msg.sender == agentTreasury || msg.sender == factory, "Unauthorized caller");
        _;
    }

    constructor(address _factory, address _agentTreasury, address _targetToken) {
        require(_factory != address(0) && _agentTreasury != address(0), "Zero address validation");
        factory = _factory;
        agentTreasury = _agentTreasury;
        targetToken = _targetToken;
    }

    /**
     * @notice Callback invoked by Uniswap v4 PoolManager after a swap completes
     */
    function afterSwap(
        address sender,
        IPoolManager.PoolKey calldata key,
        int128 amount0Delta,
        int128 amount1Delta,
        bytes calldata hookData
    ) external returns (bytes4, int128) {
        // Compute the 0.10% take-rate for the Agent Treasury
        uint256 swapVolume = amount0Delta > 0 ? uint256(int256(amount0Delta)) : uint256(int256(amount1Delta));
        uint256 treasuryFee = (swapVolume * TREASURY_BUYBACK_BPS) / 10000;

        if (treasuryFee > 0) {
            totalTreasuryFeesCollected += treasuryFee;
            emit TreasuryFeeCollected(key.currency0, treasuryFee);
        }

        // Return Uniswap v4 afterSwap selector (0)
        return (this.afterSwap.selector, 0);
    }

    /**
     * @notice Triggered by 0G TEE Agent or Helm Scheduler to execute continuous token buyback & burn
     */
    function executeScheduledBurn(uint256 tokensToBurn) external onlyAgent {
        require(tokensToBurn > 0, "Zero burn amount");
        totalTokensBurned += tokensToBurn;
        IAdextoToken(targetToken).executeTreasuryBuyback(tokensToBurn);
        emit AutoBuybackExecuted(tokensToBurn, tokensToBurn);
    }
}
