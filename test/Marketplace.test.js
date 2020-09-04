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

    /// Mint 10 NFT objects to someone for the tests
    this.objs = [];

    for (let x=0; x<10; x++) {
      this.objs.push({
        u: `Token Metadata URI - ${x}`,
        m: `{"data": "json metadata object - ${x}"}`
      });
    }

    /// mint NFTs to someone
    for (let x=0; x<10; x++) {
      await this.registry.create(
        this.objs[x].u,
        this.objs[x].m, {
          from: someone
        }
      )
    }

    /// get blocktime
    this.blockTime = await time.latest();

    //// Util functions for orders.
    this.createOrder = async function(assetId, assetPrice, daysDuration) {
      assetId = new BN(assetId);
      assetPrice = new BN(assetPrice)

      const assetExpiresAt = new BN(
        Number(this.blockTime) + Number(time.duration.days(daysDuration))
      )

      // give permission for managing the asset
      await this.registry.approve(
        this.marketplace.address,
        assetId, {
          from: someone
        }
      );

      /// Create the marketplace order
      return this.marketplace.createOrder(
        this.registry.address,
        assetId,
        assetPrice,
        assetExpiresAt, {
          from: someone
        }
      )
    }
  })

  /// admin base uri
  describe('Order creation tests', function () {

    it('reverts createOrder() called from non asset owner', async function () {
      const assetId = 0;
      const assetPrice = new BN('1')
      const assetExpires = Number(this.blockTime) + Number(time.duration.days(30))

      await expectRevert(
        this.marketplace.createOrder(
          this.registry.address,
          assetId,
          assetPrice,
          assetExpires, {
            from: anotherOne
          }
        ),
        'Marketplace: Only the asset owner can create orders'
      )
    })

    it('reverts createOrder() invalid price', async function () {
      const assetId = 0;
      const assetPrice = 0;
      const assetExpires = Number(this.blockTime) + Number(time.duration.days(30));

      await expectRevert(
        this.marketplace.createOrder(
          this.registry.address,
          assetId,
          assetPrice,
          assetExpires, {
            from: someone
          }
        ),
        'Marketplace: Price should be bigger than 0'
      )
    })

    it('reverts createOrder() invalid expire time', async function () {
      const assetId = 0;
      const assetPrice = new BN('1')
      const assetExpires = await time.latest()

      await expectRevert(
        this.marketplace.createOrder(
          this.registry.address,
          assetId,
          assetPrice,
          assetExpires, {
            from: someone
          }
        ),
        'Marketplace: Publication should be more than 1 minute in the future'
      )
    })

    it('emits OrderCreated on success', async function () {
      const assetId = new BN('0');
      const assetPrice = new BN('1')
      const assetExpiresAt = new BN(
        Number(this.blockTime) + Number(time.duration.days(30))
      )

      // give permission for managing the asset
      await this.registry.approve(
        this.marketplace.address,
        assetId, {
          from: someone
        }
      );

      /// Create the marketplace order
      const receipt = await this.createOrder(assetId, assetPrice, 30)

      expectEvent(receipt, 'OrderCreated', {
        seller: someone,
        nftAddress: this.registry.address,
        assetId: assetId,
        priceInWei: assetPrice,
        expiresAt: assetExpiresAt
      })

      // check marketplace is the new owner of the asset
      const newOwner = await this.registry.ownerOf(assetId)
      newOwner.should.be.eq(
        this.marketplace.address
      )
    })
  })

  describe('Order canceling tests', function () {

    it('reverts cancelOrder() unauthorized sender', async function () {
      const assetId = 0;

      await expectRevert(
        this.marketplace.cancelOrder(
          this.registry.address,
          assetId, {
            from: anotherOne
          }
        ),
        'Marketplace: unauthorized sender'
      )
    })

    it('emits OrderCanceled on success', async function () {
      const assetId = 0;

      const receipt = await this.marketplace.cancelOrder(
        this.registry.address,
        assetId, {
          from: someone
        }
      )

      expectEvent(receipt, 'OrderCancelled')

      // check originall seller is the new owner of the asset
      const newOwner = await this.registry.ownerOf(assetId)

      newOwner.should.be.eq(
        someone
      )
    })
  })

  describe('Order execution tests', function () {

    before(async function () {
      // publish 2 assets (0, 1) with price = 1, 30 and 60 days expiration
      await this.createOrder(0, 1, 30)
      await this.createOrder(1, 1, 60)
    })

    it('reverts asset not published', async function () {
      const assetId = 3000;
      const assetPrice = new BN('1')
      const assetFingerprint = '0x0'

      await expectRevert(
        this.marketplace.safeExecuteOrder(
          this.registry.address,
          assetId,
          assetPrice,
          assetFingerprint, {
            from: randomBuyer
          }
        ),
        'Marketplace: asset not published'
      )
    })

    it('reverts invalid buyer (seller) (asset #0)', async function () {
      const assetId = 0;
      const assetPrice = new BN('1')
      const assetFingerprint = '0x0'

      await expectRevert(
        this.marketplace.safeExecuteOrder(
          this.registry.address,
          assetId,
          assetPrice,
          assetFingerprint, {
            from: someone
          }
        ),
        'Marketplace: unauthorized sender'
      )
    })

    it('reverts expired order (asset #0)', async function () {
      const assetId = 0;
      const assetPrice = new BN('1')
      const assetFingerprint = '0x0'

      // advance blocks
      await time.increase(time.duration.days(31))

      await expectRevert(
        this.marketplace.safeExecuteOrder(
          this.registry.address,
          assetId,
          assetPrice,
          assetFingerprint, {
            from: randomBuyer
          }
        ),
        'Marketplace: order expired'
      )
    })

    /// Order 0 is expired. Continue with asset 1

    it('reverts invalid order execution price (asset #1)', async function () {
      const assetId = 1;
      const assetPrice = new BN('1000000')
      const assetFingerprint = '0x0'

      await expectRevert(
        this.marketplace.safeExecuteOrder(
          this.registry.address,
          assetId,
          assetPrice,
          assetFingerprint, {
            from: randomBuyer
          }
        ),
        'Marketplace: invalid price'
      )
    })

    it('reverts invalid asset fingerprint (asset #1)', async function () {
      const assetId = 1;
      const assetPrice = new BN('1')
      const assetFingerprint = '0x0'

      await expectRevert(
        this.marketplace.safeExecuteOrder(
          this.registry.address,
          assetId,
          assetPrice,
          assetFingerprint, {
            from: randomBuyer
          }
        ),
        'Marketplace: asset fingerprint is not valid'
      )
    })

    it('emits OrderSuccessful on success (asset #1)', async function () {
      const assetId = 1;
      const assetPrice = new BN('1')
      const assetFingerprint = await this.registry.getMetaDataHash(
        this.objs[1].m
      )

      /// mints assetPrice to randomBuyer
      await this.erc20mock.mint(randomBuyer, assetPrice, { from: owner })

      /// allow marketplace to take tokens for the payment.
      await this.erc20mock.approve(
        this.marketplace.address,
        assetPrice, {
          from: randomBuyer
        }
      )

      const receipt = await this.marketplace.safeExecuteOrder(
        this.registry.address,
        assetId,
        assetPrice,
        assetFingerprint, {
          from: randomBuyer
        }
      )

      expectEvent(receipt, 'OrderSuccessful', {
        buyer: randomBuyer,
        priceInWei: assetPrice
      })
    })
  })

  describe('Order update tests', function () {

    before(async function () {
      // publish asset 2, for 90 days (since day 0)
      await this.createOrder(2, 1, 90)
    })

    it('reverts update expired order (asset #0)', async function () {
      const assetId = 0;
      const assetPrice = new BN('1');
      const assetExpiresAt = new BN(
        Number(await time.latest()) + Number(time.duration.days(1))
      )

      await expectRevert(
        this.marketplace.updateOrder(
          this.registry.address,
          assetId,
          assetPrice,
          assetExpiresAt, {
            from: someone
          }
        ),
        'Marketplace: order expired'
      )
    })

    it('reverts update invalid order (asset #1)', async function () {
      const assetId = 1;
      const assetPrice = new BN('1');
      const assetExpiresAt = new BN(
        Number(await time.latest()) + Number(time.duration.days(1))
      )

      await expectRevert(
        this.marketplace.updateOrder(
          this.registry.address,
          assetId,
          assetPrice,
          assetExpiresAt, {
            from: randomBuyer
          }
        ),
        'asset not published'
      )
    })

    it('reverts update not seller (asset #2)', async function () {
      const assetId = 2;
      const assetPrice = new BN('1');
      const assetExpiresAt = new BN(
        Number(await time.latest()) + Number(time.duration.days(1))
      )

      await expectRevert(
        this.marketplace.updateOrder(
          this.registry.address,
          assetId,
          assetPrice,
          assetExpiresAt, {
            from: randomBuyer
          }
        ),
        'Marketplace: sender not allowed'
      )
    })

    it('emits OrderUpdated on success (asset #2)', async function () {
      const assetId = 2;
      const assetPrice = new BN('2');
      const assetExpiresAt = new BN(
        Number(await time.latest()) + Number(time.duration.days(2))
      )

      const receipt = await this.marketplace.updateOrder(
        this.registry.address,
        assetId,
        assetPrice,
        assetExpiresAt, {
          from: someone
        }
      )

      expectEvent(receipt, 'OrderUpdated', {
        priceInWei: assetPrice,
        expiresAt: assetExpiresAt
      })
    })
  })

  describe('Bid placement tests', function () {

    it('reverts invalid asset fingerprint (asset #1)', async function () {
      const assetId = 0;
      const assetFingerprint = '0x0'

      const bidPrice = new BN('1')
      const bidExpiresAt = new BN(
        Number(await time.latest()) + Number(time.duration.days(1))
      )

      await expectRevert(
        this.marketplace.safePlaceBid(
          this.registry.address,
          assetId,
          bidPrice,
          bidExpiresAt,
          assetFingerprint, {
            from: randomBidder
          }
        ),
        'Marketplace: asset fingerprint is not valid'
      )
    })

    it('reverts bid on expired order (asset #0)', async function () {
      const assetId = 0;
      const assetFingerprint = await this.registry.getMetaDataHash(
        this.objs[0].m
      )

      const bidPrice = new BN('1')
      const bidExpiresAt = new BN(
        Number(await time.latest()) + Number(time.duration.days(1))
      )

      await expectRevert(
        this.marketplace.safePlaceBid(
          this.registry.address,
          assetId,
          bidPrice,
          bidExpiresAt,
          assetFingerprint, {
            from: randomBidder
          }
        ),
        'Marketplace: order expired'
      )
    })

    it('reverts invalid price = 0 (asset #2)', async function () {
      const assetId = 2;
      const assetFingerprint = await this.registry.getMetaDataHash(
        this.objs[2].m
      )

      const bidPrice = new BN('0')
      const bidExpiresAt = new BN(
        Number(await time.latest()) + Number(time.duration.days(1))
      )

      await expectRevert(
        this.marketplace.safePlaceBid(
          this.registry.address,
          assetId,
          bidPrice,
          bidExpiresAt,
          assetFingerprint, {
            from: randomBidder
          }
        ),
        'Marketplace: bid should be > 0'
      )
    })

    it('emits BidCreated on success (asset #2)', async function () {
      const assetId = new BN('2');
      const assetFingerprint = await this.registry.getMetaDataHash(
        this.objs[2].m
      )

      const bidPrice = new BN('1')
      const bidExpiresAt = new BN(
        Number(await time.latest()) + Number(time.duration.days(1))
      )

      /// mint bidPrice to randomBidder and allow markerplace
      this.erc20mock.mint(randomBidder, bidPrice, { from: owner })
      this.erc20mock.approve(
        this.marketplace.address,
        bidPrice, {
          from: randomBidder
        }
      )

      const receipt = await this.marketplace.safePlaceBid(
        this.registry.address,
        assetId,
        bidPrice,
        bidExpiresAt,
        assetFingerprint, {
          from: randomBidder
        }
      )

      expectEvent(receipt, 'BidCreated', {
        nftAddress: this.registry.address,
        assetId: assetId,
        priceInWei: bidPrice,
        expiresAt: bidExpiresAt
      })

    })

    it('reverts previous bid -> smaller price', async function () {
      const assetId = 2;
      const assetFingerprint = await this.registry.getMetaDataHash(
        this.objs[2].m
      )

      const bidPrice = new BN('1')
      const bidExpiresAt = new BN(
        Number(await time.latest()) + Number(time.duration.days(1))
      )

      await expectRevert(
        this.marketplace.safePlaceBid(
          this.registry.address,
          assetId,
          bidPrice,
          bidExpiresAt,
          assetFingerprint, {
            from: randomBidder
          }
        ),
        'Marketplace: bid price should be higher than last bid'
      )
    })

    it('emits BidCreated on new bid success (asset #2)', async function () {
      const assetId = new BN('2');
      const assetFingerprint = await this.registry.getMetaDataHash(
        this.objs[2].m
      )

      const bidPrice = new BN('2')
      const bidExpiresAt = new BN(
        Number(await time.latest()) + Number(time.duration.days(2))
      )

      /// mint bidPrice to anotherBidder and allow markerplace
      this.erc20mock.mint(anotherBidder, bidPrice, { from: owner })
      this.erc20mock.approve(
        this.marketplace.address,
        bidPrice, {
          from: anotherBidder
        }
      )

      const receipt = await this.marketplace.safePlaceBid(
        this.registry.address,
        assetId,
        bidPrice,
        bidExpiresAt,
        assetFingerprint, {
          from: anotherBidder
        }
      )

      expectEvent(receipt, 'BidCreated', {
        bidder: anotherBidder,
        nftAddress: this.registry.address,
        assetId: assetId,
        priceInWei: bidPrice,
        expiresAt: bidExpiresAt
      })
    })
  })

  describe('Bid cancel tests', function () {

    it('reverts unauthorized sender', async function () {
      const assetId = 2

      await expectRevert(
        this.marketplace.cancelBid(
          this.registry.address,
          assetId, {
            from: someone
          }
        ),
        'Marketplace: Unauthorized sender'
      )
    })

    it('emits BidCancelled on success', async function () {
      const assetId = 2

      const preBalance = await this.erc20mock.balanceOf(anotherBidder)
      preBalance.should.be.bignumber.eq('0')

      const receipt = await this.marketplace.cancelBid(
        this.registry.address,
        assetId, {
          from: anotherBidder
        }
      )
      expectEvent(receipt, 'BidCancelled')

      const postBalance = await this.erc20mock.balanceOf(anotherBidder)
      postBalance.should.be.bignumber.eq('2')
    })
  })

  describe('Order cancel with pending Bid tests', function () {

    before(async function () {

      const assetId = new BN('2');
      const assetFingerprint = await this.registry.getMetaDataHash(
        this.objs[2].m
      )

      const bidPrice = new BN('2')
      const bidExpiresAt = new BN(
        Number(await time.latest()) + Number(time.duration.days(2))
      )

      /// approve marketplace
      this.erc20mock.approve(
        this.marketplace.address,
        bidPrice, {
          from: anotherBidder
        }
      )

      await this.marketplace.safePlaceBid(
        this.registry.address,
        assetId,
        bidPrice,
        bidExpiresAt,
        assetFingerprint, {
          from: anotherBidder
        }
      )
    })

    it('checks cancel order with bids (asset #2)', async function () {
      const assetId = 2
      const receipt = await this.marketplace.cancelOrder(
        this.registry.address,
        assetId, {
          from: someone // the seller
        }
      )

      expectEvent(receipt, 'BidCancelled')
      expectEvent(receipt, 'OrderCancelled')
    })
  })

  describe('Bid accept tests', function () {

    before(async function() {

      // publish asset 2, for 90 days (since day 0)
      await this.createOrder(2, 10, 90)

      this.createBid = async function(assetId, bidPrice) {
        /// set up bids
        const assetFingerprint = await this.registry.getMetaDataHash(
          this.objs[assetId].m
        )
        const bidExpiresAt = new BN(
          Number(await time.latest()) + Number(time.duration.days(2))
        )

        /// approve marketplace
        this.erc20mock.mint(anotherBidder, bidPrice)
        this.erc20mock.approve(
          this.marketplace.address,
          bidPrice, {
            from: anotherBidder
          }
        )

        await this.marketplace.safePlaceBid(
          this.registry.address,
          assetId,
          bidPrice,
          bidExpiresAt,
          assetFingerprint, {
            from: anotherBidder
          }
        )
      }

      await this.createBid(2, 1) /// create a test bic
    })

    it('emits reverts unauthorized sender (asset #4)', async function () {
      const assetId = 2
      const bidPrice = 2

      await expectRevert(
        this.marketplace.acceptBid(
          this.registry.address,
          assetId,
          bidPrice, {
            from: anotherOne // not the seller
          }
        ),
        'Marketplace: unauthorized sender'
      )
    })

    it('emits reverts invalid bid price (asset #4)', async function () {
      const assetId = 2
      const bidPrice = 3

      await expectRevert(
        this.marketplace.acceptBid(
          this.registry.address,
          assetId,
          bidPrice, {
            from: someone
          }
        ),
        'Marketplace: invalid bid price'
      )
    })

    it('emits reverts expired bid (asset #4)', async function () {

      // advance blocks
      await time.increase(time.duration.days(5))

      const assetId = 2
      const bidPrice = 1

      await expectRevert(
        this.marketplace.acceptBid(
          this.registry.address,
          assetId,
          bidPrice, {
            from: someone
          }
        ),
        'Marketplace: the bid expired'
      )
    })

    it('emits BidAccepted and OrderSuccessful on success accept', async function () {

      await this.createBid(2, 2) /// create a test bid

      const assetId = 2
      const bidPrice = 2

      const receipt = await this.marketplace.acceptBid(
        this.registry.address,
        assetId,
        bidPrice, {
          from: someone
        }
      )

      expectEvent(receipt, 'BidAccepted')
      expectEvent(receipt, 'OrderSuccessful')
    })
  })

})
