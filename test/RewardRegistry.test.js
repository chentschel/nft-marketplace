const { accounts, contract } = require('@openzeppelin/test-environment')

const {
  BN, // big number
  time, // time helpers
  expectEvent, // Assertions for emitted events
  expectRevert, // Assertions for transactions that should fail
} = require('@openzeppelin/test-helpers')

const ERC20Mock = contract.fromArtifact('ERC20Mock')
const RewardRegistry = contract.fromArtifact('RewardRegistry')

require('chai').should()

describe('RewardRegistry', function () {
  const [owner, someone, anotherOne, feesCollector ] = accounts

  before(async function () {
    /// NFT registry
    this.registry = await RewardRegistry.new(
      feesCollector, 'https://someuri.com/', { from: owner }
    )

    /// create a erc20 mock for tests
    this.erc20mock = await ERC20Mock.new({ from: owner })

    /// get blocktime
    this.blockTime = await time.latest();
  })

  /// admin base uri
  describe('Change baseUri', function () {

    it('emits BaseURIChange on succesful set', async function () {
      const newURI = 'https://somenewuri.com/'
      const receipt = await this.registry.setBaseURI(newURI, { from: owner })

      expectEvent(receipt, 'BaseURIChange', {
        baseURI: newURI
      })
    })

    it('reverts when setting baseURI from non owner account', async function () {
      const newURI = 'https://somenewuri.com/'

      await expectRevert(
        this.registry.setBaseURI(newURI, { from: someone }),
        'Ownable: caller is not the owner'
      )
    })
  })

  /// admin fees
  describe('Change fees collector', function () {

    it('emits FeesCollectorChange on succesful set', async function () {
      const receipt = await this.registry.setFeesCollector(
        feesCollector, { from: owner }
      )

      expectEvent(receipt, 'FeesCollectorChange', {
        collector: feesCollector
      })
    })

    it('reverts when setting fees collector from non owner account', async function () {
      await expectRevert(
        this.registry.setFeesCollector(
          feesCollector, { from: someone }
        ),
        'Ownable: caller is not the owner'
      )
    })
  })

  /// create tests
  describe('Testing NFT create', function () {

    it('fails to create with invalid collateral (erc20) amount', async function () {
      const tokenAmount = new BN('0');
      const releaseTime = this.blockTime + time.duration.days(10)

      await expectRevert(
        this.registry.create(
          tokenAmount,
          this.erc20mock.address,
          releaseTime,
          'MetadataURI',
          '{"data": "json object"}', {
            from: someone
          }
        ),
        'RewardRegistry: invalid collateral amount'
      )
    })

    it('fails to create if sender does not have enought balance (order+fees)', async function () {
      const tokenAmount = new BN('10000');
      const releaseTime = this.blockTime + time.duration.days(10)

      await expectRevert(
        this.registry.create(
          tokenAmount,
          this.erc20mock.address,
          releaseTime,
          'MetadataURI',
          '{"data": "json object"}', {
            from: someone
          }
        ),
        'RewardRegistry: not enought token collateral for order + fees'
      )
    })

    it('fails to create with release if releaseTime < block.timestamp', async function () {
      const tokenAmount = new BN('10000');
      const collateralReleaseTime = await time.latest() - time.duration.seconds(1)

      await expectRevert(
        this.registry.create(
          tokenAmount,
          this.erc20mock.address,
          collateralReleaseTime,
          'MetadataURI',
          '{"data": "json object"}',{
            from: someone
          }
        ),
        'RewardRegistry: redeemable timestamp is before current time'
      )
    })

    describe('calling create()', function () {

      beforeEach(async function () {
        this.collateralAmount = new BN('10000')
        this.collateralFees = new BN('250')

        const totalCollateral = this.collateralAmount.add(this.collateralFees)

        /// mint msg.sender tokenAmount to cover this order
        await this.erc20mock.mint(someone, totalCollateral)

        /// allow registry contract to move tokens on senders' behalf
        await this.erc20mock.approve(
          this.registry.address, totalCollateral, { from: someone }
        )
      })

      it('emits ItemCreated on succesful create()', async function () {
        const mintedTokenId = await this.registry.totalSupply()

        /// fees collector pre-balance
        const feesCollectorPre = await this.erc20mock.balanceOf(feesCollector)
        const releaseTime = Number(this.blockTime) + Number(time.duration.days(10))

        const receipt = await this.registry.create(
          this.collateralAmount,
          this.erc20mock.address,
          releaseTime,
          'MetadataURI',
          '{"data": "json object"}', {
            from: someone
          }
        )

        expectEvent(receipt, 'ItemCreated', {
          from: someone,
          tokenId: mintedTokenId,
          collateralRegistry: this.erc20mock.address,
          collateralAmount: this.collateralAmount,
          // releaseTime: ....,
        })

        /// Check fees collector post order balance
        const feesCollectorPost = await this.erc20mock.balanceOf(
          feesCollector
        )

        feesCollectorPost.should.be.bignumber.eq(
          feesCollectorPre.add(this.collateralFees)
        )
      })
    })
  })

  /// redeem tests
  describe('Testing NFT redeem', function () {

    it('fails to redeem() if not owner/approved', async function () {
      const tokenId = '0';

      await expectRevert(
        this.registry.redeem(tokenId, { from: anotherOne }),
        'RewardRegistry: caller is not owner nor approved'
      )
    })

    it('fails to redeem() if releasetime not met', async function () {
      const tokenId = '0';

      await expectRevert(
        this.registry.redeem(tokenId, { from: someone }),
        'RewardRegistry: current time is before release time'
      )
    })

    it('emits ItemRedeemed on succesful redeem() when releaseTime met', async function () {
      const tokenId = '0';
      const collateralAmount = new BN('10000')

      // advance blocks
      await time.increase(time.duration.days(30))

      // check redeem
      const receipt = await this.registry.redeem(tokenId, { from: someone })

      expectEvent(receipt, 'ItemRedeemed', {
        from: someone,
        tokenId: tokenId,
        collateralRegistry: this.erc20mock.address,
        collateralAmount: collateralAmount
      })
    })
  })
});
