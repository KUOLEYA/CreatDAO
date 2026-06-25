// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title CeatToken
 * @dev DAO Credit Token - 社区治理积分代币（测试网 Demo）
 *
 * === 设计说明 ===
 * - 本代币为测试网 Demo 用途，不绑定 ETH 固定价格
 * - 兑换率可配置（仅owner可修改），适应市场变化
 * - 主网上线前建议接入 Chainlink 预言机或改为纯积分体系
 */
contract Ceattoken is ERC20 {
    address public owner;
    uint256 public ethToCeatRate = 100; // 可配置：1 ETH = N CEAT（默认100）

    event CEATPurchased(address indexed buyer, uint256 ethAmount, uint256 ceatAmount);
    event ETHWithdrawn(address indexed owner, uint256 amount);
    event ExchangeRateUpdated(uint256 oldRate, uint256 newRate);

    constructor(uint256 initialSupply) ERC20("CeatToken", "CEAT") {
        owner = msg.sender;
        _mint(msg.sender, initialSupply);
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    /// @dev 购买 CEAT（测试用，兑换率可配置）
    function buyCEAT() external payable {
        require(msg.value > 0, "Send ETH to buy CEAT");

        uint256 ceatAmount = msg.value * ethToCeatRate;
        _mint(msg.sender, ceatAmount);

        emit CEATPurchased(msg.sender, msg.value, ceatAmount);
    }

    /// @dev 更新 ETH/CEAT 兑换率（应对市场波动）
    function setExchangeRate(uint256 _rate) external onlyOwner {
        require(_rate > 0, "Rate must be positive");
        emit ExchangeRateUpdated(ethToCeatRate, _rate);
        ethToCeatRate = _rate;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    // 所有者提取ETH
    function withdrawETH() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No ETH to withdraw");

        payable(owner).transfer(balance);
        emit ETHWithdrawn(owner, balance);
    }

    // 设置新所有者
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        owner = newOwner;
    }
}
