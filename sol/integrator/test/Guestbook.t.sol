// SPDX-License-Identifier: MIT OR Apache-2.0
pragma solidity ^0.8.24;

import {ILibIDEscrow, LibID} from "libid/LibID.sol";
import {LibIDTestBase} from "libid/test/LibIDTestBase.sol";

import {Guestbook} from "../src/Guestbook.sol";

contract GuestbookTest is LibIDTestBase {
    Guestbook internal book;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

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

    function test_aTipReachesTheHolder() public {
        bindHandle(alice, LibID.GITHUB, "1001", "octocat");
        hoax(bob, 1 ether);
        book.tip{value: 1 ether}("octocat");
        assertEq(alice.balance, 1 ether);
    }

    function test_theOwnerRefundsAnUnclaimedTip() public {
        hoax(bob, 1 ether);
        bytes32 node = book.tip{value: 1 ether}("nobody");
        (uint256 amount, uint64 refundableAt) =
            ILibIDEscrow(LibID.ESCROW).contribution(node, LibID.NATIVE, address(book));
        assertEq(amount, 1 ether);

        vm.warp(refundableAt);
        vm.prank(bob);
        vm.expectRevert(Guestbook.NotOwner.selector);
        book.refund(node, bob);

        book.refund(node, bob);
        assertEq(bob.balance, 1 ether);
    }
}
