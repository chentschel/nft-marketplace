// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.6.8;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import { CManager } from "./compound/CManager.sol";

contract RewardRegistry is Ownable, ERC721, CManager {

    event BaseURIChange(string baseURI);
    event FeesCollectorChange(address indexed collector);
    event ItemCreated(
        address indexed from,
        uint256 indexed tokenId,
        address indexed collateralRegistry,
        uint256 collateralAmount,
        uint256 releaseTime
    );
    event ItemRedeemed(
        address indexed from,
        uint256 indexed tokenId,
        address indexed collateralRegistry,
        uint256 collateralAmount
    );

    using SafeERC20 for IERC20;

    struct RewardInfo {
        uint256 tokenAmount;
        uint256 releaseTime;
        address tokenRegistry;
        bytes32 metaDataHash;
    }

    mapping (uint256 => RewardInfo) public rewardsMap;

    /// Creation fee in a 0 - 1000 basis
    uint256 public creationFee = 25; // 2,5%
    uint256 public constant FEES_PRECISION = 1000;

    address public feesCollector;

    constructor (address _feesCollector, string memory _baseUri)
        public Ownable() ERC721("Unstoppable redeemables", "REDEEM")
    {
        setFeesCollector(_feesCollector);
        setBaseURI(_baseUri);
    }

    /**
     * @dev Sets the base URI for the registry metadata
     * @param _baseUri Address for the fees collector
     */
    function setBaseURI(string memory _baseUri) public onlyOwner {
        _setBaseURI(_baseUri);
        emit BaseURIChange(_baseUri);
    }

    /**
     * @dev Sets the fees collecto
     * @param _collector Address for the fees collector
     */
    function setFeesCollector(address _collector) public onlyOwner {
        feesCollector = _collector;
        emit FeesCollectorChange(_collector);
    }

    /**
     * Creates a NFT backed up by some ERC20 collateral
     * @param _amount collateral ERC20 amount
     * @param _registry ERC20 registry address
     * @param _redeemableFrom timestamp in the future
     * @param _metaDataURI for the new token
     * @param _metaData metadata JSONified string
     */
    function create(
        uint256 _amount,
        address _registry,
        uint256 _redeemableFrom,
        string calldata _metaDataURI,
        string calldata _metaData
    )
        external payable
    {
        require(_amount > 0, "RewardRegistry: invalid collateral amount");

        // solhint-disable-next-line not-rely-on-time
        require(
            _redeemableFrom > block.timestamp,
            "RewardRegistry: redeemable timestamp is before current time"
        );

        uint256 creationFeeAmount = _amount
            .mul(creationFee)
            .div(FEES_PRECISION);

        /// address(0) is ETH.
        if (_registry == address(0)) {
            _collectEth(_amount, creationFeeAmount);

        } else {
            _collectToken(_amount, _registry, creationFeeAmount);
        }

        // Mint

        uint256 tokenId = totalSupply();

        /// Save corresponding ERC20 amount and registry
        rewardsMap[tokenId] = RewardInfo({
            tokenAmount: _amount,
            tokenRegistry: _registry,
            releaseTime: _redeemableFrom,
            metaDataHash: getMetaDataHash(_metaData)
        });

        /// Mint new NFT backed by the ERC20 collateral to msg.sender.
        _mint(msg.sender, tokenId);
        _setTokenURI(tokenId, _metaDataURI);

        emit ItemCreated(
            msg.sender,
            tokenId,
            _registry,
            _amount,
            _redeemableFrom
        );
    }

    function _collectEth(uint256 _amount, uint256 _creationFeeAmount) private {
        uint256 totalAmount = _amount.add(_creationFeeAmount);

        require(
            msg.value >= totalAmount,
            "RewardRegistry: not enought eth collateral for order + fees"
        );

        // return change if value exedees order amount
        uint256 change = msg.value - totalAmount;

        if (change > 0) {
            payable(msg.sender).transfer(change);
        }

        // Transfer fees to collector
        payable(feesCollector).transfer(_creationFeeAmount);
    }

    function _collectToken(
        uint256 _amount,
        address _registry,
        uint256 _creationFeeAmount
    )
        private
    {
        require(
            IERC20(_registry).balanceOf(msg.sender) >= _amount.add(_creationFeeAmount),
            "RewardRegistry: not enought token collateral for order + fees"
        );

        // Transfer Collateral to this contract
        IERC20(_registry).safeTransferFrom(
            msg.sender, address(this), _amount
        );

        // Transfer fees to collector
        IERC20(_registry).safeTransferFrom(
            msg.sender, feesCollector, _creationFeeAmount
        );
    }

    function getMetaDataHash(string memory _metaData) public pure returns (bytes32) {
        bytes32 msgHash = keccak256(abi.encodePacked(_metaData));

        // return prefixed hash, see: eth_sign()
        return keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash)
        );
    }

    /**
     * Redeems a created NFT, releasing the ERC20 collateral to the msg.sender
     * @param _tokenId to redeem
     */
    function redeem(uint256 _tokenId) public {

        /// Check caller is owner or approved
        require(
            _isApprovedOrOwner(_msgSender(), _tokenId),
            "RewardRegistry: caller is not owner nor approved"
        );

        RewardInfo memory reward = rewardsMap[_tokenId];

        // solhint-disable-next-line not-rely-on-time
        require(
            block.timestamp >= reward.releaseTime,
            "RewardRegistry: current time is before release time"
        );

        /// burn the token releasing the collateral to the msg.sender.
        _burn(_tokenId);

        /// Send collateral to burner
        if (reward.tokenRegistry == address(0)) {
            payable(msg.sender).transfer(reward.tokenAmount);

        } else {
            IERC20(reward.tokenRegistry).safeTransfer(
                msg.sender,
                reward.tokenAmount
            );
        }

        delete rewardsMap[_tokenId];

        emit ItemRedeemed(
            msg.sender,
            _tokenId,
            reward.tokenRegistry,
            reward.tokenAmount
        );
    }
}
