// SPDX-License-Identifier: MIT OR Apache-2.0
pragma solidity ^0.8.20;

// The README's example: script/integrator.sh fails when the two differ.
import {LibID} from "libid/LibID.sol";

contract Guestbook {
    address public immutable owner = msg.sender;
    mapping(string handle => string) public notes;

    error NotOwner();

    function sign(string calldata handle, string calldata message) external {
        LibID.requireHolder(LibID.GITHUB, handle, 90 days);
        notes[handle] = message;
    }

    // Changes no state, so the holder's code running inside `pay` cannot
    // corrupt any. A function that does needs a reentrancy guard.
    function tip(string calldata handle) external payable returns (bytes32 handleNode) {
        return LibID.pay(LibID.GITHUB, handle, msg.value);
    }

    // Only the depositor, this contract, can refund a mistyped or unclaimed tip.
    // It sends every tipper's share to `recipient`; record shares for per-tipper refunds.
    function refund(bytes32 handleNode, address recipient) external {
        if (msg.sender != owner) revert NotOwner();
        LibID.refund(handleNode, LibID.NATIVE, recipient);
    }
}
