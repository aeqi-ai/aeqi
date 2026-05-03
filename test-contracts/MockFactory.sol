// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Mock Factory that emits the same event signatures as the real aeqi-core
/// Factory. Used by the indexer test loop to verify end-to-end decode +
/// dispatch without deploying full aeqi-core.
contract MockFactory {
    event Factory_TRUSTCreatedEvent(
        address indexed creatorAddress,
        bytes32 indexed trustId,
        address indexed trustAddress
    );
    event Factory_TRUSTRegisteredEvent(
        address indexed creatorAddress,
        bytes32 indexed trustId,
        bytes32 indexed templateId,
        bytes ipfsCid,
        uint256 signersCount,
        uint256 valueConfigsCount
    );
    event Factory_TRUSTSignerAdded(
        bytes32 indexed trustId,
        bytes32 indexed addressKey,
        address indexed signerAddress,
        bool hasSigned
    );

    function emitTrustCreated(
        address creator,
        bytes32 trustId,
        address trustAddress
    ) external {
        emit Factory_TRUSTCreatedEvent(creator, trustId, trustAddress);
    }

    function emitTrustRegistered(
        address creator,
        bytes32 trustId,
        bytes32 templateId,
        bytes calldata ipfsCid,
        uint256 signersCount,
        uint256 valueConfigsCount
    ) external {
        emit Factory_TRUSTRegisteredEvent(
            creator, trustId, templateId, ipfsCid, signersCount, valueConfigsCount
        );
    }

    function emitTrustSignerAdded(
        bytes32 trustId,
        bytes32 addressKey,
        address signerAddress,
        bool hasSigned
    ) external {
        emit Factory_TRUSTSignerAdded(trustId, addressKey, signerAddress, hasSigned);
    }

    /// Realistic flow: one tx emits all three events for a single TRUST
    /// (matches the real Factory.createAndRegisterTRUST shape).
    function emitFullCompanyCreation(
        address creator,
        bytes32 trustId,
        address trustAddress,
        bytes32 templateId,
        bytes calldata ipfsCid,
        bytes32 addressKey,
        address signerAddress
    ) external {
        emit Factory_TRUSTCreatedEvent(creator, trustId, trustAddress);
        emit Factory_TRUSTRegisteredEvent(
            creator, trustId, templateId, ipfsCid, 1, 0
        );
        emit Factory_TRUSTSignerAdded(trustId, addressKey, signerAddress, true);
    }
}
