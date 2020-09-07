const { accounts, contract } = require('@openzeppelin/test-environment')

const {
  BN, // big number
  time, // time helpers
  expectEvent, // Assertions for emitted events
  expectRevert, // Assertions for transactions that should fail
} = require('@openzeppelin/test-helpers')

const ArtToken = contract.fromArtifact('ArtToken')
const ERC20Mock = contract.fromArtifact('ERC20Mock')
const Marketplace = contract.fromArtifact('Marketplace')

require('chai').should()

describe('Marketplace', function () {
  const [owner, someone, anotherOne, randomBuyer, randomBidder, anotherBidder ] = accounts

  before(async function () {
    /// create a erc20 mock as currency
    this.erc20mock = await ERC20Mock.new({ from: owner })

    /// NFT Marketplace
    this.marketplace = await Marketplace.new(
      this.erc20mock.address, { from: owner }
    )

    /// Create NFT Registry
    this.registry = await ArtToken.new(
      "Token Test",
      "TEST",
      "https://ipfs/ipfs", {
        from: owner
      }
    )

    this.blockTime = await time.latest();
  })

  /// admin base uri
  describe('creation tests', function () {
    it('Creates and Publish', async function () {
      const assetURI = 'SOMEURI'
      const assetJSON = '{SOMEJSON}'

      const assetAddress = this.registry.address
      const assetId = '0'
      const assetPrice = '20000000'
      const assetExpires = this.blockTime.add(time.duration.days(30)).toString()

      const encodedCreateOrder = this.marketplace.contract.methods
        .createOrder(assetAddress, assetId, assetPrice, assetExpires)
        .encodeABI();

      const receipt = await this.registry.createPub(
        assetURI,
        assetJSON,
        this.marketplace.address,
        encodedCreateOrder
      );

      expectEvent(receipt, 'ItemCreated')
    })
  })
})
