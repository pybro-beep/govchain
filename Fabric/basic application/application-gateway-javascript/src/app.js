/*
 * Copyright IBM Corp. All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

const grpc = require('@grpc/grpc-js');
const { connect, hash, signers } = require('@hyperledger/fabric-gateway');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { TextDecoder } = require('node:util');

const channelName = envOrDefault('CHANNEL_NAME', 'mychannel');
const chaincodeName = envOrDefault('CHAINCODE_NAME', 'basic-private-cc');
const mspId = envOrDefault('MSP_ID', 'Org1MSP');

// Path to crypto materials.
const cryptoPath = envOrDefault(
    'CRYPTO_PATH',
    path.resolve(
        __dirname,
        '..',
        '..',
        '..',
        'test-network',
        'organizations',
        'peerOrganizations',
        'org1.example.com'
    )
);

// Path to user private key directory.
const keyDirectoryPath = envOrDefault(
    'KEY_DIRECTORY_PATH',
    path.resolve(
        cryptoPath,
        'users',
        'User1@org1.example.com',
        'msp',
        'keystore'
    )
);

// Path to user certificate directory.
const certDirectoryPath = envOrDefault(
    'CERT_DIRECTORY_PATH',
    path.resolve(
        cryptoPath,
        'users',
        'User1@org1.example.com',
        'msp',
        'signcerts'
    )
);

// Path to peer tls certificate.
const tlsCertPath = envOrDefault(
    'TLS_CERT_PATH',
    path.resolve(cryptoPath, 'peers', 'peer0.org1.example.com', 'tls', 'ca.crt')
);

// Gateway peer endpoint.
const peerEndpoint = envOrDefault('PEER_ENDPOINT', 'localhost:7051');

// Gateway peer SSL host name override.
const peerHostAlias = envOrDefault('PEER_HOST_ALIAS', 'peer0.org1.example.com');

const utf8Decoder = new TextDecoder();
const assetId = `asset${String(Date.now())}`;
const searchRequestId = 'asset0';

async function main() {
    displayInputParameters();

    // The gRPC client connection should be shared by all Gateway connections to this endpoint.
    const client = await newGrpcConnection();

    const gateway = connect({
        client,
        identity: await newIdentity(),
        signer: await newSigner(),
        hash: hash.sha256,
        // Default timeouts for different gRPC calls
        evaluateOptions: () => {
            return { deadline: Date.now() + 5000 }; // 5 seconds
        },
        endorseOptions: () => {
            return { deadline: Date.now() + 15000 }; // 15 seconds
        },
        submitOptions: () => {
            return { deadline: Date.now() + 5000 }; // 5 seconds
        },
        commitStatusOptions: () => {
            return { deadline: Date.now() + 60000 }; // 1 minute
        },
    });

    try {
        // Get a network instance representing the channel where the smart contract is deployed.
        const network = gateway.getNetwork(channelName);

        // Get the smart contract from the network.
        const contract = network.getContract(chaincodeName);

        // Initialize a set of asset data on the ledger using the chaincode 'InitLedger' function.
        await initLedger(contract);

        var id = 3;
        // FIXME: this uses random ids -> collision will happen, but unlikely so fine for testing
        const timeMiliSeconds = 1000; // jede Sekunde
        const interval = setInterval( searchRequestId = await handleRequest(contract, id), timeMiliSeconds);
        // TODO: iterate through requests until newest ID is found. If ID > currentID && !hasResponse()
        // -> start responding from this asset onward
        await createPrivateRequest(new Request(
            assetId, peerHostAlias,
            // transient
            stringify(
                {
                    // in example, PID is used to uniquely identifiy a data entry in a register
                    PID: '1234',
                    // needed must exist
                    needed: "Wohnort 1"
                }
            )
        ));

        clearInterval(interval);
    } finally {
        gateway.close();
        client.close();
    }
}

main().catch((error) => {
    console.error('******** FAILED to run the application:', error);
    process.exitCode = 1;
});

async function newGrpcConnection() {
    const tlsRootCert = await fs.readFile(tlsCertPath);
    const tlsCredentials = grpc.credentials.createSsl(tlsRootCert);
    return new grpc.Client(peerEndpoint, tlsCredentials, {
        'grpc.ssl_target_name_override': peerHostAlias,
    });
}

async function newIdentity() {
    const certPath = await getFirstDirFileName(certDirectoryPath);
    const credentials = await fs.readFile(certPath);
    return { mspId, credentials };
}

async function getFirstDirFileName(dirPath) {
    const files = await fs.readdir(dirPath);
    const file = files[0];
    if (!file) {
        throw new Error(`No files in directory: ${dirPath}`);
    }
    return path.join(dirPath, file);
}

async function newSigner() {
    const keyPath = await getFirstDirFileName(keyDirectoryPath);
    const privateKeyPem = await fs.readFile(keyPath);
    const privateKey = crypto.createPrivateKey(privateKeyPem);
    return signers.newPrivateKeySigner(privateKey);
}
/**
 * This type of transaction would typically only be run once by an application the first time it was started after its
 * initial deployment. A new version of the chaincode deployed later would likely not need to run an "init" function.
 */
async function initLedger(contract) {
    console.log(
        '\n--> Submit Transaction: InitLedger, function creates the initial set of assets on the ledger'
    );

    await contract.submitTransaction('InitLedger');

    console.log('*** Transaction committed successfully');
}

/**
 * Evaluate a transaction to query ledger state.
 */
async function getAllAssets(contract) {
    console.log(
        '\n--> Evaluate Transaction: GetAllAssets, function returns all the current assets on the ledger'
    );

    const resultBytes = await contract.evaluateTransaction('GetAllAssets');

    const resultJson = utf8Decoder.decode(resultBytes);
    const result = JSON.parse(resultJson);
    console.log('*** Result:', result);
}
// NEW:
// FIXME: id is currently just being added, no guarantee for non-overlapping id
// TODO: go through every id and update to a more functional way of assigning / using IDs
class Request {
    constructor(owner, transientData) {
        this.id = `asset${String(Date.now())}`;
        this.owner = owner;
        this.timestamp = new Date().toISOString();
        // Transient:
        this.transientData = transientData;
    }
}
class Response {
    constructor(request_id, owner, transientData) {
        this.id = `asset${String(Date.now())}`;
        this.request_id = request_id;
        this.owner = owner;
        this.timestamp = new Date().toISOString();
        // Transient:
        this.transientData = transientData;
    }
}
// FIXME: new_id should be handled with chaincode-internal logic
async function handleRequest(contract, id) {
    // get the request
    const resultBytes = await contract.evaluateTransaction('GetNextRequest', searchRequestId, peerHostAlias);
    const resultJson = utf8Decoder.decode(resultBytes);
    let result;
    try {
        result = JSON.parse(resultJson);
    } catch (err) {
        console.error(`handleRequest: could not parse result:\n${resultJson}`);
        // skip to next request
        // FIXME: `asset${Date(id.lstrip("asset")).add(1)}`
        return id++;
    }

    // handle the request
    const new_id = `asset${String(Date.now())}`
    if (result) { // if result is not empty
        createPrivateResponse(new Response(
            new_id, result.id, peerHostAlias,
            {
            /* NOTE: this prototype does not have a database / register connection.
            *  We are simply appending ": Secret" to the query to verify the functionality as this logic
            *  is very application-specific
            */
                answer: `${result.needed}: Secret`
            }
        ));
        console.log(`handleRequest: answered request ${result.id}.`)
        // if succesfully answered: increase the id for future searching of requests
        return result.id;
    } else if (result.owner === peerHostAlias) {
        console.log(`handleRequest: i am owner of request ${id}. Skipping.`)
        return id++;
    } else {
        console.log(`handleRequest: no data available on id ${id}. Skipping.`)
        return id++;
    }
}
async function createPrivateRequest(contract, request) {
    console.log(
        'Sumbit Transaction: CreatePrivateRequest'
    );
    const transaction = await contract.createTransaction(
        'CreatePrivateRequest',
        request.id,
        request.owner,
        request.timestamp
    );
    const transient = {
        asset: Buffer.from(
            JSON.stringify({
                data: request.transientData,
            })
        ),
    };
    transaction.setTransient(transient);
    try {
        await transaction.submit();
        console.log("transaction submitted successfully:");
        console.log(transaction.toString());
    } catch (err) {
        console.error("transaction failed:");
        console.error(err.toString());
    }

}
async function createPrivateResponse(contract, response) {
    console.log(
        'Sumbit Transaction: CreatePrivateResponse'
    );
    const transaction = await contract.createTransaction(
        'CreatePrivateResponse',
        response.id,
        response.request_id,
        response.owner,
        response.timestamp
    );
    const transient = {
        asset: Buffer.from(
            JSON.stringify({
                data: response.transientData,
            })
        ),
    };
    transaction.setTransient(transient);
    try {
        await transaction.submit();
        console.log("transaction submitted successfully:");
        console.log(transaction.toString());
    } catch (err) {
        console.error("transaction failed:");
        console.error(err.toString());
    }

}
// OLD:
/**
 * Submit a transaction synchronously, blocking until it has been committed to the ledger.
 */
async function createAsset(contract) {
    console.log(
        '\n--> Submit Transaction: CreateAsset, creates new asset with ID, Color, Size, Owner and AppraisedValue arguments'
    );

    await contract.submitTransaction(
        'CreateAsset',
        assetId,
        'yellow',
        '5',
        'Tom',
        '1300'
    );

    console.log('*** Transaction committed successfully');
}
// same as createAsset, but adds asset to private collection instead
async function createPrivateAsset(contract) {
    console.log('\n--> Submit Transaction: CreatePrivateAsset, creating a private asset');

    const assetTransient = {
        asset: Buffer.from(
            JSON.stringify({
                ID: 'privateAsset1',
                Color: 'blue',
                Size: 10,
                Owner: 'Alice',
                AppraisedValue: 500
            })
        ),
    };

    // Create the transaction and set transient data
    const transaction = contract.createTransaction('CreatePrivateAsset');
    transaction.setTransient(assetTransient);

    // Submit the transaction
    await transaction.submit();
    console.log('*** Private Asset created successfully');
}

/*
same as createAsset, but adds asset to the shared private data collection between org1 and org2.
This function will propagate the private data (transient data) from the creating peer to the peers of Org1 and Org2
using the Gossip protocol.
*/
//WARN: will error if client peer does not fullfill the policy requirements for the sharedPrivateCollection
async function createSharedPrivateAsset(contract) {
    console.log('\n--> Submit Transaction: CreateSharedPrivateAsset, creating a shared private asset');

    const assetTransient = {
        asset: Buffer.from(
            JSON.stringify({
                ID: 'sharedAsset1',
                Color: 'red',
                Size: 15,
                Owner: 'Alice',
                AppraisedValue: 1000
            })
        ),
    };

    // submit the transaction with transient data
    try {
        const transaction = await contract.submit('CreateSharedPrivateAsset', {transientData: assetTransient,});
        console.log('***** Transaction CreateSharedPrivateAsset Success');
        console.log(transaction.toString());
    } catch (err) {
        console.log('***** Transaction CreateSharedPrivateAsset Failed due to Error:');
        console.error(err);
    }
}




/**
 * Submit transaction asynchronously, allowing the application to process the smart contract response (e.g. update a UI)
 * while waiting for the commit notification.
 */
async function transferAssetAsync(contract) {
    console.log(
        '\n--> Async Submit Transaction: TransferAsset, updates existing asset owner'
    );

    const commit = await contract.submitAsync('TransferAsset', {
        arguments: [assetId, 'Saptha'],
    });
    const oldOwner = utf8Decoder.decode(commit.getResult());

    console.log(
        `*** Successfully submitted transaction to transfer ownership from ${oldOwner} to Saptha`
    );
    console.log('*** Waiting for transaction commit');

    const status = await commit.getStatus();
    if (!status.successful) {
        throw new Error(
            `Transaction ${
                status.transactionId
            } failed to commit with status code ${String(status.code)}`
        );
    }

    console.log('*** Transaction committed successfully');
}

async function readAssetByID(contract) {
    console.log(
        '\n--> Evaluate Transaction: ReadAsset, function returns asset attributes'
    );

    const resultBytes = await contract.evaluateTransaction(
        'ReadAsset',
        assetId
    );

    const resultJson = utf8Decoder.decode(resultBytes);
    const result = JSON.parse(resultJson);
    console.log('*** Result:', result);
}

/**
 * submitTransaction() will throw an error containing details of any error responses from the smart contract.
 */
async function updateNonExistentAsset(contract) {
    console.log(
        '\n--> Submit Transaction: UpdateAsset asset70, asset70 does not exist and should return an error'
    );

    try {
        await contract.submitTransaction(
            'UpdateAsset',
            'asset70',
            'blue',
            '5',
            'Tomoko',
            '300'
        );
        console.log('******** FAILED to return an error');
    } catch (error) {
        console.log('*** Successfully caught the error: \n', error);
    }
}

/**
 * envOrDefault() will return the value of an environment variable, or a default value if the variable is undefined.
 */
function envOrDefault(key, defaultValue) {
    return process.env[key] || defaultValue;
}

/**
 * displayInputParameters() will print the global scope parameters used by the main driver routine.
 */
function displayInputParameters() {
    console.log(`channelName:       ${channelName}`);
    console.log(`chaincodeName:     ${chaincodeName}`);
    console.log(`mspId:             ${mspId}`);
    console.log(`cryptoPath:        ${cryptoPath}`);
    console.log(`keyDirectoryPath:  ${keyDirectoryPath}`);
    console.log(`certDirectoryPath: ${certDirectoryPath}`);
    console.log(`tlsCertPath:       ${tlsCertPath}`);
    console.log(`peerEndpoint:      ${peerEndpoint}`);
    console.log(`peerHostAlias:     ${peerHostAlias}`);
}
