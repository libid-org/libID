// SPDX-License-Identifier: MIT OR Apache-2.0
pragma solidity ^0.8.20;

import {LibID} from "libid/LibID.sol";

/// The README's example, with state.
contract Guestbook {
    mapping(string handle => string) public notes;

    function sign(string calldata handle, string calldata message) external {
        LibID.requireHolder(LibID.GITHUB, handle, 90 days);
        notes[handle] = message;
    }
}
