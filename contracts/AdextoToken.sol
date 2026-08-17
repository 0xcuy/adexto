// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AdextoToken
 * @notice ERC-20 & ERC-8004 Autonomous Agent Identity Standard for ADEXTO Protocol (adexto.xyz)
 */
contract AdextoToken is ERC20, Ownable {
    address public immutable agentIdentity;
    address public immutable sovereignDexHook;
    uint256 public immutable maxTxAmount;
    bool public antiSnipeActive;
    uint256 public launchBlock;

    event AgentTreasuryBuyback(uint256 amountIn, uint256 tokensBurned);
    event AntiSnipeToggled(bool active);

    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply,
        address _agentIdentity,
        address _sovereignDexHook,
        uint256 _maxTxPercentBps
    ) ERC20(name, symbol) Ownable(msg.sender) {
        require(_agentIdentity != address(0), "Invalid agent identity");
        agentIdentity = _agentIdentity;
        sovereignDexHook = _sovereignDexHook;
        maxTxAmount = (initialSupply * 10 ** decimals() * _maxTxPercentBps) / 10000;
        antiSnipeActive = true;
        launchBlock = block.number;

        _mint(msg.sender, initialSupply * 10 ** decimals());
    }

    function _update(
        address from,
        address to,
        uint256 value
    ) internal virtual override {
        if (antiSnipeActive && from != owner() && to != owner()) {
            if (block.number <= launchBlock + 5) {
                require(value <= maxTxAmount, "Anti-sniper: Exceeds max transaction limit");
            }
        }
        super._update(from, to, value);
    }

    function executeTreasuryBuyback(uint256 amountToBurn) external {
        require(msg.sender == agentIdentity || msg.sender == sovereignDexHook, "Unauthorized agent");
        _burn(msg.sender, amountToBurn);
        emit AgentTreasuryBuyback(amountToBurn, amountToBurn);
    }

    function disableAntiSnipe() external onlyOwner {
        antiSnipeActive = false;
        emit AntiSnipeToggled(false);
    }
}
