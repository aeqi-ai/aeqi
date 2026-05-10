// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Mock Vesting module emitting the same event signatures as the real
/// aeqi-core Vesting.module.
contract MockVesting {
    event Vesting_VestingPositionCreated(bytes32 indexed vestingPositionId);
    event Vesting_VestingPositionActivated(bytes32 indexed vestingPositionId);
    event Vesting_VestingPositionContributed(
        bytes32 indexed vestingPositionId,
        address indexed from,
        uint256 amount
    );
    event Vesting_VestingClaimed(
        bytes32 indexed vestingPositionId,
        address indexed asset,
        address indexed to,
        uint256 amount
    );
    event Vesting_PositionRemoved(bytes32 indexed vestingPositionId);

    function emitPositionCreated(bytes32 positionId) external {
        emit Vesting_VestingPositionCreated(positionId);
    }

    function emitPositionActivated(bytes32 positionId) external {
        emit Vesting_VestingPositionActivated(positionId);
    }

    function emitContributed(bytes32 positionId, address from, uint256 amount) external {
        emit Vesting_VestingPositionContributed(positionId, from, amount);
    }

    function emitClaimed(
        bytes32 positionId,
        address asset,
        address to,
        uint256 amount
    ) external {
        emit Vesting_VestingClaimed(positionId, asset, to, amount);
    }

    function emitPositionRemoved(bytes32 positionId) external {
        emit Vesting_PositionRemoved(positionId);
    }

    /// Realistic founder-vesting flow: position created, activated, funder
    /// contributes, beneficiary claims partial, position removed when fully claimed.
    /// 5 events in one tx.
    function emitFounderVestingLifecycle(
        bytes32 positionId,
        address funder,
        address beneficiary,
        address asset,
        uint256 contribution,
        uint256 claim
    ) external {
        emit Vesting_VestingPositionCreated(positionId);
        emit Vesting_VestingPositionActivated(positionId);
        emit Vesting_VestingPositionContributed(positionId, funder, contribution);
        emit Vesting_VestingClaimed(positionId, asset, beneficiary, claim);
        emit Vesting_PositionRemoved(positionId);
    }
}
