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
    uint256 public constant MAX_SUPPLY = 1_000_000_000 * 1e18; // 总供应量上限：10亿
    uint256 public constant MAX_RATE = 1_000_000; // 汇率上限，防止乘法溢出

    bool private _withdrawLocked; // 重入锁

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

    modifier nonReentrant() {
        require(!_withdrawLocked, "Reentrant call");
        _withdrawLocked = true;
        _;
        _withdrawLocked = false;
    }

    /// @dev 购买 CEAT（测试用，兑换率可配置）
    function buyCEAT() external payable {
        require(msg.value > 0, "Send ETH to buy CEAT");
        require(ethToCeatRate <= MAX_RATE, "Rate exceeds max");

        // 防止乘法溢出：msg.value * ethToCeatRate 必须在 uint256 范围内
        require(msg.value <= type(uint256).max / ethToCeatRate, "ETH amount too large, overflow risk");

        uint256 ceatAmount = msg.value * ethToCeatRate;
        require(totalSupply() + ceatAmount <= MAX_SUPPLY, "Exceeds max supply");
        _mint(msg.sender, ceatAmount);

        emit CEATPurchased(msg.sender, msg.value, ceatAmount);
    }

    /// @dev 更新 ETH/CEAT 兑换率（应对市场波动）
    function setExchangeRate(uint256 _rate) external onlyOwner {
        require(_rate > 0, "Rate must be positive");
        require(_rate <= MAX_RATE, "Rate exceeds max");
        emit ExchangeRateUpdated(ethToCeatRate, _rate);
        ethToCeatRate = _rate;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        require(totalSupply() + amount <= MAX_SUPPLY, "Exceeds max supply");
        _mint(to, amount);
    }

    // 所有者提取ETH（CEI模式 + 重入锁）
    function withdrawETH() external onlyOwner nonReentrant {
        uint256 balance = address(this).balance;
        require(balance > 0, "No ETH to withdraw");

        // CEI: 先记录状态，再执行外部调用
        emit ETHWithdrawn(owner, balance);
        (bool success, ) = payable(owner).call{value: balance}("");
        require(success, "ETH transfer failed");
    }

    // 设置新所有者
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        owner = newOwner;
    }
}
