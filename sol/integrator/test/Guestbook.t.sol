// SPDX-License-Identifier: MIT OR Apache-2.0
pragma solidity ^0.8.24;

import {LibID} from "libid/LibID.sol";
import {LibIDTestBase} from "libid/test/LibIDTestBase.sol";

import {Guestbook} from "../src/Guestbook.sol";

contract GuestbookTest is LibIDTestBase {
    Guestbook internal book;
    address internal alice = makeAddr("alice");

    function setUp() public {
        deployLibID();
        book = new Guestbook();
    }

    function test_theHolderSigns() public {
        bindHandle(alice, LibID.GITHUB, "1001", "octocat");
        vm.prank(alice);
        book.sign("octocat", "hi");
        assertEq(book.notes("octocat"), "hi");
    }

    function test_nobodyElseSigns() public {
        bindHandle(alice, LibID.GITHUB, "1001", "octocat");
        vm.expectRevert(abi.encodeWithSelector(LibID.NotHolder.selector, alice, address(this)));
        book.sign("octocat", "hi");
    }
}
