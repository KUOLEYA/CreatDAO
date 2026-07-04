// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Hello {
    string public message;

    constructor() {
        message = "hello world!";
    }

    function set(string memory newMessage) public {
        message = newMessage;
    }

    function get() public view returns (string memory) {
        return message;
    }
}
