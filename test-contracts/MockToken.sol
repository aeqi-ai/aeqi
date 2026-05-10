// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Mock Token module emitting standard ERC20 Transfer events as the real
/// aeqi-core Token.module does.
///
/// Mint = Transfer(from=address(0), to, value).
/// Burn = Transfer(from, to=address(0), value).
contract MockToken {
    event Transfer(address indexed from, address indexed to, uint256 value);

    function emitTransfer(address from, address to, uint256 value) external {
        emit Transfer(from, to, value);
    }

    function emitMint(address to, uint256 value) external {
        emit Transfer(address(0), to, value);
    }

    function emitBurn(address from, uint256 value) external {
        emit Transfer(from, address(0), value);
    }

    /// Cap-table seeding flow: mint to founder, founder transfers some to
    /// employee, founder burns some. 3 events in one tx.
    function emitCapTableLifecycle(
        address founder,
        address employee,
        uint256 mintAmount,
        uint256 transferAmount,
        uint256 burnAmount
    ) external {
        emit Transfer(address(0), founder, mintAmount);
        emit Transfer(founder, employee, transferAmount);
        emit Transfer(founder, address(0), burnAmount);
    }
}
