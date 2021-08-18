const { web3tx, toWad, wad4human } = require("@decentral.ee/web3-helpers");

const deployFramework = require("@superfluid-finance/ethereum-contracts/scripts/deploy-framework");
const deployTestToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-test-token");
const deploySuperToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-super-token");
const SuperfluidSDK = require("@superfluid-finance/js-sdk");

const erc20Token = artifacts.require("ERC20");
const TradeableFlow = artifacts.require("TradeableFlow.sol");

const traveler = require("ganache-time-traveler");
const { assert } = require("hardhat");
const ONE_DAY = 3600 * 24;
const ONE_HOUR = 3600;
const ONE_MINUTE = 60;
const TO_GWEI = 10**18;


describe("TradeableFlow", function () {

    let accounts;

    before(async function () {
        accounts = await web3.eth.getAccounts();
    });
    
    const errorHandler = (err) => {
        if (err) throw err;
    };

    const names = ["Admin", "Alice", "Bob", "Carol", "Dan", "Emma", "Frank"];
    const tokens = ["fDAI","fUSDC"]

    let sf;
    let dai;
    let daix;
    let app;
    const token_directory = {}  // token => regulartoken, supertoken
    const user_directory = {};  // alias => sf.user
    const alias_directory = {}; // address => alias

    before(async function () {
        //process.env.RESET_SUPERFLUID_FRAMEWORK = 1;
        // Deploy SuperFluid test framework
        await deployFramework(errorHandler, {
            web3,
            from: accounts[0],
        });
    });

    beforeEach(async function () {
        for (var i = 0; i < tokens.length; i++) {
            // Deploy ERC20 token
            await deployTestToken(errorHandler, [":", tokens[i]], {
                web3,
                from: accounts[0],
            });
            // Deploy SuperToken
            await deploySuperToken(errorHandler, [":", tokens[i]], {
                web3,
                from: accounts[0],
            });
        }

        // Deploy and Initialize Superfluid JS SDK framework with fDAI token
        sf = new SuperfluidSDK.Framework({
            web3,
            version: "test",
            tokens: tokens,
        });
        await sf.initialize();

        for (var i = 0; i < tokens.length; i++) {
            
            token_directory[tokens[i]] = {}
            token_directory[tokens[i]]['supertoken'] = sf.tokens[tokens[i]+"x"]
            token_directory[tokens[i]]['regulartoken'] = await sf.contracts.TestToken.at(await sf.tokens[tokens[i]].address)

        }

        // Constructing a user dictionary with the below mapping of aliases to Superfluid user objects
        // Constructing a alias diction with the mapping of addresses to aliases
        for (var i = 0; i < names.length; i++) {
            // user_directory[names[i].toLowerCase()] = sf.user({
            //     address: accounts[i],
            //     token: daix.address,
            // });
            user_directory[names[i].toLowerCase()] = accounts[i];
            // user_directory[names[i].toLowerCase()].alias = names[i];
            alias_directory[user_directory[names[i].toLowerCase()]] = names[i];
            console.log(names[i],"|",accounts[i])

        }

        for (var i = 0; i < tokens.length; i++) {
            // Mint 100000000 regulartokens for each user 
            // Approving reception of supertokens for each user
            for (const [, user] of Object.entries(user_directory)) {
                if (alias_directory[user] === "App") return;
                await web3tx(token_directory[tokens[i]]['regulartoken'].mint, `${alias_directory[user]} mints many DAI`)(
                    user,
                    toWad(100000000),
                    {     
                        from: user,
                    }
                );
                await web3tx(token_directory[tokens[i]]['regulartoken'].approve, `${alias_directory[user]} approves DAIx`)(
                    token_directory[tokens[i]]['supertoken'].address,
                    toWad(100000000),
                    {
                        from: user,
                    }
                );

                checkTokenBalance(user,token_directory[tokens[i]]['regulartoken'])
            }

            console.log(tokens[i]+"x","|",token_directory[tokens[i]]['supertoken'].address);
        }

        //u.zero = { address: ZERO_ADDRESS, alias: "0x0" };
        console.log("Admin:", user_directory.admin);
        console.log("Host:", sf.host.address);
        console.log("CFA:", sf.agreements.cfa.address);

        // Mint "UWL" token
        uwl = await erc20Token.new(
            "Uniwhales",
            "UWL",
            {from:user_directory.alice}
        )
        // await uwl._mint(user_directory.alice.address, 5*10e18)
        console.log("$UWL Address:",uwl.address)
        console.log(`$UWL balance for Alice is ${await uwl.balanceOf(user_directory.alice)}`)

        // Deploy TradeableFlow contract
        app = await TradeableFlow.new(
            user_directory.admin,
            "TradeableFlow",
            "TF",
            sf.host.address,
            sf.agreements.cfa.address,
            token_directory['fDAI']['supertoken'].address,      // SuperToken accepted by app
            uwl.address,                                // ERC20Restrict token
            2000                                        // Affiliate Portion (20%)
        );

        console.log("TradeableFlow Owner is:", alias_directory[ await app.owner() ] )

        // Create Superfluid user for TradeableFlow contract
        user_directory.app = app.address

    });

    async function checkTokenBalance(user,token) {
        console.log(`$${await token.symbol()} Balance of`, alias_directory[user], "is:", (await token.balanceOf(user)).toString());
    }

    async function checkBalances(accounts,token) {
        for (let i = 0; i < accounts.length; ++i) {
            await checkTokenBalance(accounts[i],token);
        }
    }

    async function upgrade(accounts,supertoken) {
        for (let i = 0; i < accounts.length; ++i) {
            await web3tx(
                supertoken.upgrade,
                `${alias_directory[accounts[i]]} upgrades many ${await supertoken.symbol()}`
            )(toWad(100000000), { from: accounts[i] });
            await checkTokenBalance(accounts[i],supertoken);
        }
    }

    async function logUsers(userList) {
        let header = `USER\t`
        for (let i = 0; i < tokens.length; ++i) {
            header += `|\t${tokens[i]}x\t`
        }
        header += `|\tAFFILIATE`
        console.log(header)
        console.log("--------------------------------------------------------------------------------------")
        for (let i = 0; i < userList.length; i++) {
            row = `${alias_directory[userList[i]]}\t`
            for (let j = 0; j < tokens.length; ++j) {
                var tempUser = sf.user({ address: userList[i], token: token_directory[tokens[j]]['supertoken'].address });
                row += `|\t${(await tempUser.details()).cfa.netFlow}\t`
            }
            row += `|\t${alias_directory[( await app.getAffiliateForSubscriber( userList[i] ) )]}`
            console.log(row)
        }
        console.log("--------------------------------------------------------------------------------------")
        bottomline = `App\t`
        for (let i = 0; i < tokens.length; ++i) {
            let tempUser = sf.user({ address: user_directory.app, token: token_directory[tokens[i]]['supertoken'].address });
            bottomline += `|\t${(await tempUser.details()).cfa.netFlow}\t`
        }
        bottomline += "|"
        console.log(bottomline)
        console.log("======================================================================================")
    }

    async function hasFlows(user) {
        const { inFlows, outFlows } = (await user.details()).cfa.flows;
        return inFlows.length + outFlows.length > 0;
    }

    async function appStatus() {
        const isApp = await sf.host.isApp(u.app.address);
        const isJailed = await sf.host.isAppJailed(app.address);
        !isApp && console.error("App is not an App");
        isJailed && console.error("app is Jailed");
        await checkTokenBalance(u.app,daix);
        await checkOwner();
    }

    async function checkOwner() {
        const owner = await app.getOwner();
        console.log("Contract Owner: ", alias_directory[owner], " = ", owner);
        return owner.toString();
    }

    async function transferNFT(to) {
        const receiver = to.address || to;
        const owner = await checkOwner();
        console.log("got owner from checkOwner(): ", owner);
        console.log("receiver: ", receiver);
        if (receiver === owner) {
            console.log("user === owner");
            return false;
        }
        await app.transferFrom(owner, receiver, 1, { from: owner });
        console.log(
            "token transferred, new owner: ",
            receiver,
            " = ",
            alias_directory[receiver]
        );
        return true;
    }

    // TODO: edge cases 
    //    - multi-NFT cases
    //    - Transfering pre-cashflow NFTs cashflows
    //    - Testing the subscriber switching payment tokens
    //    - test that someone can't mint an NFT with the same URI as another one to prevent affiliate flows from being stolen

    describe("sending flows", async function () {

        let switchBoard = {
            "NFT Testing":false,
            "_createOutflow no aff":false,
            "_createOutflow w/ aff, 2 subscribers":false,
            "_updateOutflow no aff (increase)":false,
            "_updateOutflow no aff (decrease)": false,
            "_updateOutflow w/ aff (increase then decrease)": false,
            "_updateOutflow w/ 2 aff, 3 subs (increase then decrease)": false,
            "_createOutflow w/ aff, 1 subscribers, NFT transfer": false,
            "_updateOutflow w/ 2 aff, 3 subs (increase then decrease), NFT transfer": false,
            "affiliate being a subscriber as well":true
        }

        if (switchBoard["NFT Testing"]) {

            it("Testing Token Requirements", async () => {
                const { alice , bob } = user_directory
                uwl.transfer(bob.address,10000, {from:alice.address})
                await checkTokenBalance(bob,uwl)
                
                await app.mint("BlueWhale", {from:bob.address})
                await app.mint("Orca", {from:bob.address})
                console.log("NFT Balance of Alice:", (await app.balanceOf(bob.address)).toString() )
                console.log("URI of NFT:", (await app.tokenURI(1)))

                // TODO: test changing ERC20 restrictions
            });

        }

        if (switchBoard["_createOutflow no aff"]) {

            it("Testing _createOutflow no affiliation", async () => {
            // SET UP

                const { alice , bob, admin } = user_directory
                const userList = [alice , bob, admin]
                const rate = 0.0000001

                // Mint Bob 10000 $UWL and an affiliate NFT
                uwl.transfer(bob.address,10000, {from:alice.address})
                await checkTokenBalance(bob,uwl)
                await app.mint("BlueWhale", {from:bob.address})

                // Upgrade all of Alice and Bob's DAI
                await upgrade([alice]);
                await upgrade([bob]);

            // PART 1: User with no affiliation opens stream to app but with erratic affiliate code

                // Create invalid affiliate code
                let aliceEncodedUserData = web3.eth.abi.encodeParameter('string','PilotWhale');

                // Start flow from Alice to App at 0.001 DAI/second
                await sf.cfa.createFlow({
                    superToken:   daix.address, 
                    sender:       alice.address,
                    receiver:     user_directory.app.address,
                    flowRate:     "10000",
                    userData:     aliceEncodedUserData});

                await logUsers(userList)

            // PART 2: Check that app handles additional flow properly

                // Start flow from Alice to App at 0.001 DAI/second
                await sf.cfa.createFlow({
                    superToken:   daix.address, 
                    sender:       bob.address,
                    receiver:     user_directory.app.address,
                    flowRate:     "10000",
                    userData:     aliceEncodedUserData});

                await logUsers(userList)

            });

        }

        if (switchBoard["_createOutflow w/ aff, 2 subscribers"]) {

            it("Testing _createOutflow with affiliation", async () => {
        // SET UP

            const { alice , bob , carol , admin } = user_directory
            const userList = [ alice , bob , carol , admin ]
            const rate = 0.0000001

            // Mint Bob 10000 $UWL and an affiliate NFT
            await uwl.transfer(bob.address,10000, {from:alice.address})
            await checkTokenBalance(bob,uwl)
            await app.mint("BlueWhale", {from:bob.address})

            // Upgrade all of Alice, Carol, and Bob's DAI
            await upgrade([alice]);
            await upgrade([bob]);
            await upgrade([carol]);

            // Give App a little DAIx so it doesn't get mad over deposit allowance
            await daix.transfer(user_directory.app.address, 100000000000000, {from:alice.address});

        // PART 1: Open stream from Alice with Bob's affiliate code "BlueWhale"
            console.log("=== PART 1: Open stream from Alice with Bob's affiliate code 'BlueWhale' ===")

            // Create valid affiliate code
            let aliceEncodedUserData = web3.eth.abi.encodeParameter('string','BlueWhale');

            // Start flow from Alice to App at 0.001 DAI/second
            await sf.cfa.createFlow({
                superToken:   daix.address, 
                sender:       alice.address,
                receiver:     user_directory.app.address,
                flowRate:     "10000",
                userData:     aliceEncodedUserData});

            await logUsers(userList)
        
        // PART 2: Open stream from Carol with Bob's affiliate code "BlueWhale"
            console.log("=== PART 2: Open stream from Carol with Bob's affiliate code 'BlueWhale' ===")

            // Create valid affiliate code
            let carolEncodedUserData = web3.eth.abi.encodeParameter('string','BlueWhale');

            // Start flow from Alice to App at 0.001 DAI/second
            await sf.cfa.createFlow({
                superToken:   daix.address, 
                sender:       carol.address,
                receiver:     user_directory.app.address,
                flowRate:     "10000",
                userData:     carolEncodedUserData});

            await logUsers(userList)

            });

        }

        if (switchBoard["_updateOutflow no aff (increase)"]) {

            it("Testing _updateOutflow increase without affiliation", async () => {
            // SET UP
                const { alice , bob , carol , admin } = user_directory
                const userList = [alice , bob , carol , admin]
                const rate = 0.0000001

                // Upgrade all of Alice, Carol, and Bob's DAI
                await upgrade([alice]);
                await upgrade([bob]);
                await upgrade([carol]);

                // Give App a little DAIx so it doesn't get mad over deposit allowance
                await daix.transfer(user_directory.app.address, 100000000000000, {from:alice.address});

                let aliceEncodedUserData = web3.eth.abi.encodeParameter('string',"");

            // PART 1
                console.log("=== PART 1: Open stream from Alice to app ===")

                await sf.cfa.createFlow({
                    superToken:   daix.address, 
                    sender:       alice.address,
                    receiver:     user_directory.app.address,
                    flowRate:     "10000",
                    userData:     aliceEncodedUserData
                });

                logUsers(userList)
                
            // PART 2
                console.log("=== PART 2: Increase stream from Alice to app by 2x ===")

                sf.cfa.updateFlow({
                    superToken: daix.address,
                    sender: alice.address,
                    receiver: user_directory.app.address,
                    flowRate: "20000",
                    aliceEncodedUserData
                });

                logUsers(userList)

            });

        }

        if (switchBoard["_updateOutflow no aff (decrease)"]) {

            it("Testing _updateOutflow decrease without affiliation", async () => {
            // SET UP
                const { alice , bob , carol , admin } = user_directory
                const userList = [ alice , bob , carol , admin ]
                const rate = 0.0000001

                // Upgrade all of Alice, Carol, and Bob's DAI
                await upgrade([alice]);
                await upgrade([bob]);
                await upgrade([carol]);

                // Give App a little DAIx so it doesn't get mad over deposit allowance
                await daix.transfer(user_directory.app.address, 100000000000000, {from:alice.address});

                let aliceEncodedUserData = web3.eth.abi.encodeParameter('string',"");

            // PART 1: Open stream from Alice to app
                console.log("=== PART 1: Open stream from Alice to app ===")

                await sf.cfa.createFlow({
                    superToken:   daix.address, 
                    sender:       alice.address,
                    receiver:     user_directory.app.address,
                    flowRate:     "20000",
                    userData:     aliceEncodedUserData
                });

                await logUsers(userList)

            // PART 2: cut stream in half
                console.log("=== PART 2: Decrease stream from Alice to app by 1/2 ===")

                sf.cfa.updateFlow({
                    superToken:   daix.address,
                    sender:       alice.address,
                    receiver:     user_directory.app.address,
                    flowRate:     "10000",
                    userData:     aliceEncodedUserData
                });

                await logUsers(userList)
            
            });
        }

        if (switchBoard["_updateOutflow w/ aff (increase then decrease)"]) {

            it("Testing _updateOutflow increase with affiliation", async () => {
            // SET UP
                const { alice , bob , carol , admin } = user_directory
                userList = [alice , bob , carol , admin]
                const rate = 0.0000001

                // Mint Bob 10000 $UWL and an affiliate NFT
                await uwl.transfer(bob.address,10000, {from:alice.address})
                await checkTokenBalance(bob,uwl)
                await app.mint("BlueWhale", {from:bob.address})

                // Upgrade all of Alice, Carol, and Bob's DAI
                await upgrade([alice]);
                await upgrade([bob]);
                await upgrade([carol]);

                // Give App a little DAIx so it doesn't get mad over deposit allowance
                await daix.transfer(user_directory.app.address, 100000000000000, {from:alice.address});

                let aliceEncodedUserData = web3.eth.abi.encodeParameter('string',"BlueWhale");

            // PART 1
                console.log("=== PART 1: Open stream from Alice to app with affiliate code ===")

                await sf.cfa.createFlow({
                    superToken:   daix.address, 
                    sender:       alice.address,
                    receiver:     user_directory.app.address,
                    flowRate:     "10000",
                    userData:     aliceEncodedUserData
                });

                // Check flow results - did affiliate get share?
                await logUsers(userList)

            // PART 2
                console.log("=== PART 2: Increase stream from Alice to app by 2x ===")

                await sf.cfa.updateFlow({
                    superToken: daix.address,
                    sender: alice.address,
                    receiver: user_directory.app.address,
                    flowRate: "20000"
                });

                // Check flow results - did affiliate share get increased?
                await logUsers(userList)

            // PART 3
                console.log("=== PART 3: End Alice's stream (update to zero) ===")

                await sf.cfa.deleteFlow({
                    superToken: daix.address,
                    sender:     alice.address,
                    receiver:   user_directory.app.address,
                    by:         alice.address
                });

                // Check flow results - did affiliate share get increased?
                await logUsers(userList)
                
            });
        }

        if (switchBoard["_updateOutflow w/ 2 aff, 3 subs (increase then decrease)"]) {

            it("Testing _updateOutflow increase/decrease with multiple affiliates and subscribers", async () => {
            // SET UP
                const { alice , bob , emma , carol , dan , admin } = user_directory
                userList = [alice , bob , emma , carol , dan , admin]
                const rate = 0.0000001

                // Mint Bob and Carol 10000 $UWL and an affiliate NFT
                await uwl.transfer(carol.address,10000, {from:alice.address})
                await uwl.transfer(dan.address,10000, {from:alice.address})
                await checkTokenBalance(carol,uwl)
                await checkTokenBalance(dan,uwl)
                await app.mint("BlueWhale", {from:carol.address})
                await app.mint("KillerWhale", {from:dan.address})

                // Upgrade all of Alice, Carol, and Bob's DAI
                await upgrade([alice]);
                await upgrade([bob]);
                await upgrade([carol]);
                await upgrade([dan]);
                await upgrade([emma]);

                // Give App a little DAIx so it doesn't get mad over deposit allowance
                await daix.transfer(user_directory.app.address, 100000000000000, {from:alice.address});

                let aliceEncodedUserData = web3.eth.abi.encodeParameter('string',"BlueWhale");
                let bobEncodedUserData = web3.eth.abi.encodeParameter('string',"KillerWhale");
                let emmaEncodedUserData = web3.eth.abi.encodeParameter('string',"KillerWhale");

            // PART 1
                console.log("=== PART 1: Open stream from Alice, Bob, Emma to app with respective affiliate codes ===")

                await sf.cfa.createFlow({
                    superToken:   daix.address, 
                    sender:       alice.address,
                    receiver:     user_directory.app.address,
                    flowRate:     "10000",
                    userData:     aliceEncodedUserData
                });

                await sf.cfa.createFlow({
                    superToken:   daix.address, 
                    sender:       bob.address,
                    receiver:     user_directory.app.address,
                    flowRate:     "10000",
                    userData:     bobEncodedUserData
                });

                await sf.cfa.createFlow({
                    superToken:   daix.address, 
                    sender:       emma.address,
                    receiver:     user_directory.app.address,
                    flowRate:     "10000",
                    userData:     emmaEncodedUserData
                });

                // Check flow results - did affiliate get share?
                await logUsers(userList)

            // PART 2
                console.log("=== PART 2: Increase stream from Alice and Bob to app by 2x ===")

                await sf.cfa.updateFlow({
                    superToken: daix.address,
                    sender: alice.address,
                    receiver: user_directory.app.address,
                    flowRate: "20000"
                });

                
                await sf.cfa.updateFlow({
                    superToken: daix.address,
                    sender: bob.address,
                    receiver: user_directory.app.address,
                    flowRate: "20000"
                });

                // Check flow results - did affiliate share get increased?
                await logUsers(userList)

            // PART 3
                console.log("=== PART 3: End Alice and Bob's stream (update to zero) ===")

                await sf.cfa.deleteFlow({
                    superToken: daix.address,
                    sender:     alice.address,
                    receiver:   user_directory.app.address,
                    by:         alice.address
                });

                await sf.cfa.deleteFlow({
                    superToken: daix.address,
                    sender:     bob.address,
                    receiver:   user_directory.app.address,
                    by:         bob.address
                });

                // Check flow results - did affiliate share get increased?
                await logUsers(userList)


            });

        }

        if (switchBoard["_createOutflow w/ aff, 1 subscribers, NFT transfer"]) {

            it("Testing _createOutflow with affiliation, 1 subscribers, NFT transfer", async () => {
        // SET UP

            const { alice , bob , carol , admin } = user_directory
            const userList = [ alice , bob , carol , admin ]
            const rate = 0.0000001

            // Mint Bob 10000 $UWL and an affiliate NFT
            await uwl.transfer(bob.address,10000, {from:alice.address})
            await checkTokenBalance(bob,uwl)
            await app.mint("BlueWhale", {from:bob.address})

            // Upgrade all of Alice, Carol, and Bob's DAI
            await upgrade([alice]);
            await upgrade([bob]);
            await upgrade([carol]);

            // Give App a little DAIx so it doesn't get mad over deposit allowance
            await daix.transfer(user_directory.app.address, 100000000000000, {from:alice.address});

        // PART 1
            console.log("=== PART 1: Open stream from Alice with Bob's affiliate code 'BlueWhale' ===")

            // Create valid affiliate code
            let aliceEncodedUserData = web3.eth.abi.encodeParameter('string','BlueWhale');

            // Start flow from Alice to App at 0.001 DAI/second
            await sf.cfa.createFlow({
                superToken:   daix.address, 
                sender:       alice.address,
                receiver:     user_directory.app.address,
                flowRate:     "10000",
                userData:     aliceEncodedUserData});

            await logUsers(userList);
        
        // PART 2
            console.log("=== PART 2: Bob transfer affiliate NFT to Carol ===")

            // Transfer affiliate NFT to Carol from Bob
            await app.transferFrom(
                bob.address, 
                carol.address, 
                1, 
                {from:bob.address}
            );

            await logUsers(userList);

        // PART 3
            console.log("=== PART 3: Pass it back to Bob ===")

            // Transfer affiliate NFT to Bob from Carol
            await app.transferFrom(
                carol.address, 
                bob.address, 
                1, 
                {from:carol.address}
            );

            await logUsers(userList);

            });


        }

        if (switchBoard["_updateOutflow w/ 2 aff, 3 subs (increase then decrease), NFT transfer"]) {

            it("Testing _updateOutflow increase/decrease with multiple affiliates and subscribers and then an NFT transfer", async () => {
            // SET UP
                const { alice , bob , emma , carol , dan , admin } = user_directory
                userList = [alice , bob , emma , carol , dan , admin]
                const rate = 0.0000001

                // Mint Bob and Carol 10000 $UWL and an affiliate NFT
                await uwl.transfer(carol.address,10000, {from:alice.address})
                await uwl.transfer(dan.address,10000, {from:alice.address})
                await checkTokenBalance(carol,uwl)
                await checkTokenBalance(dan,uwl)
                await app.mint("BlueWhale", {from:carol.address})
                await app.mint("KillerWhale", {from:dan.address})

                // Upgrade all of Alice, Carol, and Bob's DAI
                await upgrade([alice]);
                await upgrade([bob]);
                await upgrade([carol]);
                await upgrade([dan]);
                await upgrade([emma]);

                // Give App a little DAIx so it doesn't get mad over deposit allowance
                await daix.transfer(user_directory.app.address, 100000000000000, {from:alice.address});

                let aliceEncodedUserData = web3.eth.abi.encodeParameter('string',"BlueWhale");
                let bobEncodedUserData = web3.eth.abi.encodeParameter('string',"KillerWhale");
                let emmaEncodedUserData = web3.eth.abi.encodeParameter('string',"KillerWhale");

            // PART 1
                console.log("=== PART 1: Open stream from Alice, Bob, Emma to app with respective affiliate codes ===")

                await sf.cfa.createFlow({
                    superToken:   daix.address, 
                    sender:       alice.address,
                    receiver:     user_directory.app.address,
                    flowRate:     "10000",
                    userData:     aliceEncodedUserData
                });

                await sf.cfa.createFlow({
                    superToken:   daix.address, 
                    sender:       bob.address,
                    receiver:     user_directory.app.address,
                    flowRate:     "10000",
                    userData:     bobEncodedUserData
                });

                await sf.cfa.createFlow({
                    superToken:   daix.address, 
                    sender:       emma.address,
                    receiver:     user_directory.app.address,
                    flowRate:     "10000",
                    userData:     emmaEncodedUserData
                });

                // Check flow results - did affiliate get share?
                await logUsers(userList)

            // PART 2
                console.log("=== PART 2: Increase stream from Alice and Bob to app by 3x ===")

                await sf.cfa.updateFlow({
                    superToken: daix.address,
                    sender: alice.address,
                    receiver: user_directory.app.address,
                    flowRate: "30000"
                });

                
                await sf.cfa.updateFlow({
                    superToken: daix.address,
                    sender: bob.address,
                    receiver: user_directory.app.address,
                    flowRate: "30000"
                });

                // Check flow results - did affiliate share get increased?
                await logUsers(userList)

            // PART 3
                console.log("=== PART 3: Reduce Alice's stream by 1/2 and end Bob's stream ===")

                await sf.cfa.updateFlow({
                    superToken: daix.address,
                    sender:     alice.address,
                    receiver:   user_directory.app.address,
                    flowRate:   "15000"
                });

                await sf.cfa.deleteFlow({
                    superToken: daix.address,
                    sender:     bob.address,
                    receiver:   user_directory.app.address,
                    by:         bob.address
                });

                // Check flow results - did affiliate share get increased?
                await logUsers(userList)

            // PART 4
                console.log("=== PART 4: Dan transfer affiliate NFT to Carol ===")

                // Transfer affiliate NFT to Bob from Carol
                await app.transferFrom(
                    dan.address, 
                    carol.address, 
                    2, 
                    {from:dan.address}
                );

                await logUsers(userList);

            // PART 5
                console.log("=== PART 5: Emma, one of Dan's previous affiliate subscribers, increases her stream by 2x (should increase Carol's stream now) ===")

                await sf.cfa.updateFlow({
                    superToken: daix.address,
                    sender:     emma.address,
                    receiver:   user_directory.app.address,
                    flowRate:   "20000"
                });
                
                // @dev - see console screenshot, there's a createFlow happening where there should be an update. Making netflow non-zero

                // Check flow results - did affiliate get share?
                await logUsers(userList)

            });

        }

        if (switchBoard["affiliate being a subscriber as well"]) {

            it("Testing what happens when an affiliate is also a subscriber", async () => {
            // SET UP
                const { alice , bob , carol , admin } = user_directory
                userList = [alice , bob , carol , admin]
                const rate = 0.0000001

                // Mint Alice 10000 $UWL and an affiliate NFT (Alice already has all the $UWL)
                await app.mint("BlueWhale", {from:alice})

                // Upgrade all of Alice and Bob's DAI
                await upgrade([alice],token_directory["fDAI"]["supertoken"]);
                await upgrade([bob],token_directory["fDAI"]["supertoken"]);
                await upgrade([carol],token_directory["fDAI"]["supertoken"]);

                // Give App a little DAIx so it doesn't get mad over deposit allowance
                await token_directory["fDAI"]["supertoken"].transfer(user_directory.app, 100000000000000, {from:alice});

                let aliceEncodedUserData = web3.eth.abi.encodeParameter('string',"BlueWhale");

                // if you're an affiliate, can you refer yourself and get a discount plus the affiliate portion of your stream back? Partly.
                // The app should detect if you are an affiliate. If you are, then the discount gets waived. You're already getting your stream back!
                console.log('=== PART 1: Alice, who is an affiliate, opens up a stream to the app with her own referral code')
                
                await sf.cfa.createFlow({
                    superToken:   token_directory["fDAI"]["supertoken"].address, 
                    sender:       alice,
                    receiver:     user_directory.app,
                    flowRate:     "10000",
                    userData:     aliceEncodedUserData
                });

                // Alice should have a netflow of -8000
                await logUsers(userList)

                console.log(`=== PART 2: Bob opens a stream with Alice's referral`)

                await sf.cfa.createFlow({
                    superToken:   token_directory["fDAI"]["supertoken"].address, 
                    sender:       bob,
                    receiver:     user_directory.app,
                    flowRate:     "10000",
                    userData:     aliceEncodedUserData
                });

                // Alice should have a netflow of -6000
                await logUsers(userList)

                console.log(`=== PART 3: Alice transfers her affiliate NFT to Bob`)

                await app.transferFrom(
                    alice, 
                    bob, 
                    1, 
                    {from:alice}
                );
    
                // Bob should now have the netflow of -6000
                await logUsers(userList);

                console.log(`=== PART 4: Alice increases her stream by 2x and Bob decreases by (1/2)x`)

                await sf.cfa.updateFlow({
                    superToken: token_directory["fDAI"]["supertoken"].address,
                    sender: alice,
                    receiver: user_directory.app,
                    flowRate: "20000"
                });

                await sf.cfa.updateFlow({
                    superToken: token_directory["fDAI"]["supertoken"].address,
                    sender: bob,
                    receiver: user_directory.app,
                    flowRate: "5000"
                });

                // Bob is paying out -5000
                // Bob is receiving 20% of Alice's 20000, so +4000
                // Bob is receiving 20% of his own 5000, so +1000
                // Bob netflow should be zero - he broke even!
                await logUsers(userList);

                console.log(`=== PART 5: Bob cancels his stream`)

                await sf.cfa.deleteFlow({
                    superToken: token_directory["fDAI"]["supertoken"].address,
                    sender:     bob,
                    receiver:   user_directory.app,
                    by:         bob
                });

                await logUsers(userList);

            });
        
        }

    });
});