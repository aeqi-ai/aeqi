// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Mock Budget module emitting the same event signatures as the real
/// aeqi-core Budget.module (sourced from
/// /home/claudedev/projects/aeqi-graph/abis/Budget.module.json).
contract MockBudget {
    event Budget_BudgetCreated(bytes32 indexed budgetId);
    event Budget_BudgetFrozen(bytes32 indexed budgetId);
    event Budget_BudgetUnfrozen(bytes32 indexed budgetId);
    event Budget_BudgetRemoved(bytes32 indexed budgetId);
    event Budget_BudgetDeposited(
        bytes32 indexed budgetId,
        uint256 amount,
        address indexed from,
        address indexed asset
    );
    event Budget_BudgetConsumed(
        bytes32 indexed budgetId,
        uint256 amount,
        address indexed to,
        address indexed asset
    );

    function emitCreated(bytes32 budgetId) external {
        emit Budget_BudgetCreated(budgetId);
    }

    function emitFrozen(bytes32 budgetId) external {
        emit Budget_BudgetFrozen(budgetId);
    }

    function emitUnfrozen(bytes32 budgetId) external {
        emit Budget_BudgetUnfrozen(budgetId);
    }

    function emitRemoved(bytes32 budgetId) external {
        emit Budget_BudgetRemoved(budgetId);
    }

    function emitDeposited(
        bytes32 budgetId,
        uint256 amount,
        address from,
        address asset
    ) external {
        emit Budget_BudgetDeposited(budgetId, amount, from, asset);
    }

    function emitConsumed(
        bytes32 budgetId,
        uint256 amount,
        address to,
        address asset
    ) external {
        emit Budget_BudgetConsumed(budgetId, amount, to, asset);
    }

    /// Department-budget flow: budget created, funder deposits, two
    /// payouts to vendor, budget frozen by admin. 5 events in one tx.
    function emitBudgetLifecycle(
        bytes32 budgetId,
        address funder,
        address vendor,
        address asset,
        uint256 deposit,
        uint256 payout
    ) external {
        emit Budget_BudgetCreated(budgetId);
        emit Budget_BudgetDeposited(budgetId, deposit, funder, asset);
        emit Budget_BudgetConsumed(budgetId, payout, vendor, asset);
        emit Budget_BudgetConsumed(budgetId, payout, vendor, asset);
        emit Budget_BudgetFrozen(budgetId);
    }
}
