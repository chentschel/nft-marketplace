// SPDX-License-Identifier: Apache-2.0

pragma solidity ^0.6.8;

interface CBaseToken {
    function exchangeRateCurrent() external returns (uint256);
    function supplyRatePerBlock() external returns (uint256);
    function redeem(uint256) external returns (uint256);
    function redeemUnderlying(uint256) external returns (uint256);
}

interface CErc20 is CBaseToken {
    function mint(uint256) external returns (uint256);
}

interface CEth is CBaseToken {
    function mint() external payable;
}
