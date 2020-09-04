// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.6.8;

import { CEth, CErc20 } from "./ICToken.sol";

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

contract CManager is Ownable {

    using SafeERC20 for IERC20;

    // ropsten
    mapping (address => address) private cTokensMap;

    function setTokenPair(address _erc20Address, address _cErc20Address) public onlyOwner {
        cTokensMap[_erc20Address] = _cErc20Address;
    }

    function getMappedToken(address _erc20Address) public view returns (address) {
        return cTokensMap[_erc20Address];
    }

    function supplyEth(
        uint256 _amount
    )
        public payable returns (uint256, address)
    {
        address cToken = getMappedToken(address(0));
        require(cToken != address(0), 'CManager: address(0) not mapped');

        // Mint cEthers to caller, reverts on error
        CEth(cToken).mint{ value: _amount, gas: 250000 }();

        return (_amount, cToken);
    }

    function supplyErc20(
        address _erc20Contract,
        uint256 _numTokensToSupply
    )
        public returns (uint256, address)
    {
        address cToken = getMappedToken(_erc20Contract);
        require(cToken != address(0), 'CManager: _erc20Contract not mapped');

        // Approve transfer on the ERC20 contract
        IERC20(_erc20Contract).safeIncreaseAllowance(
            cToken,
            _numTokensToSupply
        );

        // Mint cTokens
        uint256 mintResult = CErc20(cToken).mint(_numTokensToSupply);
        require(mintResult == 0, "CManager: error CErc20.mint()");

        return (_numTokensToSupply, cToken);
    }


    function redeemCToken(uint256 _amount, address _cErc20Contract) public {
        require(_cErc20Contract != address(0), 'CManager: _cErc20Contract invalid');

        // Create a reference to the corresponding cToken contract
        uint256 redeemResult = CEth(_cErc20Contract)
            .redeem(_amount);

        require(redeemResult == 0, "CManager: error calling redeem()");
    }
}
