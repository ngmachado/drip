pragma solidity ^0.8.0;

import {
    ISuperfluid,
    ISuperToken
} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";

import {
    IConstantFlowAgreementV1
} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";



library TradeableFlowStorage  {

   // Subscriber's details
  struct SubscriberProfile {
    // ISuperToken subscriberAcceptedToken;                 // the super token the subscriber is paying with 
    // int96 inflowRate;                                    // how much subscriber is streaming into the app
    uint256 tokenId;                                     // the tokenId representing the affiliate from which the subscriber was referred
    mapping(ISuperToken => int96) inflowRate;            // for a certain token, how much is the subscriber streaming into the app        
  }

  struct AffiliateProgram {                              // An affiliate progarm generate when TradeableCashflow is deployed
    address owner;                                       // Program owner
    ISuperfluid host;                                    // Superfluid host contract
    IConstantFlowAgreementV1 cfa;                        // The stored constant flow agreement class address
    ISuperToken[] acceptedTokensList;                    // List of all accepted super tokens (iterateable so for changeReceiver, we can iterate over and change flows)
    mapping(ISuperToken => bool) acceptedTokens;         // Contains all super tokens permitted as payment for subscription service as a mapping
    // mapping(string => bool) referralCodes;               // Contains all used affiliate codes so that there is no repeating and flows can't be stolen (unnessary given referralcodeToToken)
    mapping(string => uint256) referralcodeToToken;      // Maps referral code to tokenIds
    mapping(uint256 => address) tokenToAffiliate;        // Maps token ID to affiliate address
    mapping(address => SubscriberProfile) subscribers;   // Maps subscriber to [how much subscriber is streaming into the app] + [the affiliate who referred the subscriber]
    int96 affiliatePortion;                              // Portion of referred subscriber revenue that corresponding affiliates receive ( affiliatePortion / 10000 ) should equal desired portion. If this is greater than 10000, contract will NOT work
  }

}