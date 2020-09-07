// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.6.8;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract ArtToken is Ownable, ERC721 {

    event BaseURIChange(string baseURI);

    event ItemCreated(
        address indexed owner,
        uint256 indexed tokenId
    );

    struct TokenExtraInfo {
        string metaDataURI;
        bytes32 metaDataHash;
    }

    mapping (uint256 => TokenExtraInfo) public extraInfoMap;

    // Used to correctly support fingerprint verification for the assets
    bytes4 public constant _INTERFACE_ID_ERC721_VERIFY_FINGERPRINT = bytes4(
        keccak256("verifyFingerprint(uint256,bytes32)")
    );

    constructor (
        string memory _name,
        string memory _symbol,
        string memory _baseUri
    )
        public Ownable() ERC721(_name, _symbol)
    {
        setBaseURI(_baseUri);

        // Registers
        _registerInterface(_INTERFACE_ID_ERC721_VERIFY_FINGERPRINT);
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
     * Creates a NFT
     * @param _metaDataURI for the new token
     * @param _metaData metadata JSONified string
     */
    function create(
        string calldata _metaDataURI,
        string calldata _metaData
    )
        external
    {
        _create(msg.sender, _metaDataURI, _metaData);
    }

    /**
     * Creates a NFT
     * @param _metaDataURI for the new token
     * @param _metaData metadata JSONified string
     * @param _marketplace address
     * @param _encodedCallData of the create call in dst marketplace
     */
    function createPub(
        string calldata _metaDataURI,
        string calldata _metaData,
        address _marketplace,
        bytes calldata _encodedCallData
    )
        external
    {
        // Create the new asset and allow marketplace to manage it
        // Use this to override the msg.sender here.
        this.approve(
            _marketplace,
            _create(address(this), _metaDataURI, _metaData)
        );

        // execute create order in destination marketplace
        (bool success, ) = _marketplace.call(_encodedCallData);
        require(
            success,
            "Marketplace: failed to execute publish order"
        );
    }

    function _create(
        address _owner,
        string calldata _metaDataURI,
        string calldata _metaData
    )
        internal returns (uint256 tokenId)
    {
        tokenId = totalSupply();

        /// Save data
        extraInfoMap[tokenId] = TokenExtraInfo({
            metaDataURI: _metaDataURI,
            metaDataHash: getMetaDataHash(_metaData)
        });

        /// Mint new NFT
        _mint(_owner, tokenId);
        _setTokenURI(tokenId, _metaDataURI);

        emit ItemCreated(_owner, tokenId);
    }

    function getMetaDataHash(string memory _metaData) public pure returns (bytes32) {
        bytes32 msgHash = keccak256(abi.encodePacked(_metaData));

        // return prefixed hash, see: eth_sign()
        return keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash)
        );
    }

    function verifyFingerprint(uint256 _tokenId, bytes32 _fingerprint) public view returns (bool) {
        return extraInfoMap[_tokenId].metaDataHash == _fingerprint;
    }
}
