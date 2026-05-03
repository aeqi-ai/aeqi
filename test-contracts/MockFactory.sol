// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Minimal contract that emits Factory_TRUSTCreatedEvent with the same
/// signature as the real aeqi-core Factory. Used by the indexer test loop
/// to verify end-to-end event decoding without deploying full aeqi-core.
contract MockFactory {
    event Factory_TRUSTCreatedEvent(
        address indexed creatorAddress,
        bytes32 indexed trustId,
        address indexed trustAddress
    );

    function emitTrustCreated(
        address creator,
        bytes32 trustId,
        address trustAddress
    ) external {
        emit Factory_TRUSTCreatedEvent(creator, trustId, trustAddress);
    }
}
