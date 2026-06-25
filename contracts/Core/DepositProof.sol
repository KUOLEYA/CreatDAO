// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts/access/Ownable.sol";

contract DepositProof is Ownable {
    address public auditDAO;
    event Deposit(bytes32 indexed hashValue, uint256 timestamp, address senderAddress);
    mapping(bytes32 => uint256) public proofs;
    mapping(uint256 => bytes32) public evidenceIdToHash;
    uint256 counter;

    modifier onlyAuditDAO() {
        require(msg.sender == auditDAO, "Not authorized");
        _;
    }

    constructor() Ownable(msg.sender) {}

    function setAuditDAO(address _auditDAO) external onlyOwner {
        auditDAO = _auditDAO;
    }

    function deposit(bytes32 hashValue) external onlyAuditDAO returns (uint256) {
        require(hashValue != bytes32(0), "Hash cannot be zero");
        require(proofs[hashValue] == 0, "Hash already exists");
        uint256 currentTime = block.timestamp;
        proofs[hashValue] = currentTime;
        address senderAddress = msg.sender;
        emit Deposit(hashValue, currentTime, senderAddress);
        counter++;
        return currentTime;
    }

    function getEvidence(bytes32 hashValue) external view returns (uint256) {
        require(hashValue != bytes32(0), "Hash cannot be zero");
        require(proofs[hashValue] != 0, "Hash does not exist");
        return proofs[hashValue];
    }

    function exists(bytes32 hashValue) external view returns (bool) {
        return proofs[hashValue] > 0;
    }

    function getTotalCount() external view returns (uint256) {
        return counter;
    }
}