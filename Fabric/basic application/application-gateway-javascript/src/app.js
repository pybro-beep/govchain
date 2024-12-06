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
// const assetId = `asset${String(Date.now())}`;
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
        // await initLedger(contract);
        const n = 1
        for (i = 0; i < n; i++) {
            const pub = {
                "requester": mspId,
                "timestamp": new Date().toISOString(),
                "type": "request",
                "status": "pending",
                "ttl": 2
            };
            const priv = {
                "details": `frage personenbezogene daten von ${Math.random()*100000000} an.`
            };
            await createAsset(contract, pub, priv);
        }
        const assetList = await getAllAssets(contract);
        console.log(assetList);
        for (i = 0; i < assetList.length; i++) {
            metadata = JSON.parse(assetList[i].value);
            try {
                // const public_data = JSON.parse(await getPublic(contract, assetList[i].key));
                if (metadata.type === 'request') {
                    if (metadata.requester === mspId) {
                        console.log(`skipping request ${assetList[i].key}: made by my MSP`)
                    } else {
                        await handleRequest(contract, metadata, assetList[i].key);
                    }
                } else if (metadata.type === 'response') {
                    await handleResponse(contract, metadata, assetList[i].key);
                } else {
                    console.log (`no type for ${assetList[i].key}} ${metadata}`);
                }
            } catch (err) {
                console.error("error while looping over assets:");
                console.error(err);
            }
        }
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
async function handleTTL(contract, payload, txid) {
    // used for purging private data from all peers if it has not happened automatically because of blocksToLive of the collection
    if (!payload.ttl) {
        console.log(`ERROR (handleTTL): was called on payload which does not have a TTL property (${typeof(payload)}): ${payload}`);
        return;
    }
    const creationTime = new Date(Date.parse(payload.timestamp));
    const currentTime = new Date();
    const timeToLive = new Date().setDate(creationTime.getDate() + payload.ttl);
    if (currentTime.getDate() > timeToLive.getDate()) {
        // TODO: purge private data
        contract.submitTransaction('Purge', JSON.stringify(txid));
        console.log(`SUCCESS (handleTTL): purged private data of ${txid}`);
    }
}
async function handleResponse(contract, payload, txid) {
    if (!payload.request_to) {
        console.log(`Attempted to handle invalid response: ${JSON.stringify(payload)}`)
    }
    const request = JSON.parse(getPublic(contract, payload.request_to.toString()));
    if (request.requester === mspId) {
        console.log(`STATUS (handleResponse): status of request ${payload.request_to} is now ${request.status}\n
        \tSUCCESS (handleResponse): got data for ${payload.request_to} from ${txid}`)
        getPrivate(contract, txid);
    } else {
        console.log(`SUCCESS (handleResponse): response ${txid} does not respond to a request of ${mspId}`);
    }
    // responses contain sensitive data -> need to be purged
    handleTTL(contract, payload, txid);
}
async function handleRequest(contract, payload, txid) {
    if (payload.requester == mspId) {
        console.log(`SUCCESS (handleRequest): skipping request made by own org ${mspId}`);
        return null;
    } else if (payload.status != "pending") {
        console.log(`SUCCESS (handleRequest): skipping already answered request ${txid} with status ${payload.status}`);
        return null;
    }
    const pub = {
        "type": "response",
        "timestamp": new Date().toISOString(),
        "response_to": txid,
        "ttl": 2
    };
    const priv = { // replacement for internal logic of Org
        "details": "personenbezogene Daten"
    };
    console.log(`STATUS (handleRequest): responding to ${txid} with ${JSON.stringify(pub)}`);
    const result_txid = await createAsset(contract, pub, priv)
    console.log(`\tSUCCESS (handleRequest): created response ${result_txid}`);
    console.log(`\t STATE: ${txid} has public data: ${await getPublic(contract, txid)}`);
    const update = await setStatus(contract, txid, result_txid);
    console.log(`\tSUCCESS (handleRequest): updated status ${update}`);
}
async function initLedger(contract) {
    await contract.submitTransaction('InitLedger');
    console.log('SUCCESS (initLedger): initialized Ledger');
}
async function setStatus(contract, requestTxid, responseTxid) { //TODO: rewrite (use updateAsset instead, this is weird!)
    const new_public = await getPublic();
    new_public.status = responseTxid;
    await updatePublic(contract, requestTxid, new_public)
    console.log(`SUCCESS (setStatus): set status of ${requestTxid}: ${JSON.stringify(new_public)}`)
}
async function updatePublic(contract, pub, key) { //pub = object -> is stringified in chaincode call!
    try {
        const txid = await contract.submitTransaction('UpdatePublic', key, JSON.stringify(pub));
        console.log(`SUCCESS (updatePublic): updated asset ${utf8Decoder.decode(txid)}`);
        return utf8Decoder.decode(txid);
    } catch (err) {
        console.error(`ERROR (updatePrivate):`);
        console.error(err)
    }
}
async function updatePrivate(contract, priv, key) { //returns txid!
    try {
        const txid = await contract.submitTransaction('UpdatePrivate', key, JSON.stringify(priv));
        console.log(`SUCCESS (updatePrivate): updated asset ${utf8Decoder.decode(txid)}`);
        return utf8Decoder.decode(txid);
    } catch (err) {
        console.error(`ERROR (updatePrivate):`);
        console.error(err)
    }
}
async function getPublic(contract, txid) {
    console.log(`STATUS (getPublic): getting public for ${txid}`);
    let result
    result = JSON.parse(
        utf8Decoder.decode(
            await contract.submitTransaction('GetPublic', txid)
        )
    );
    console.log(`\tSUCCESS (getPublic): ${result}`);
    return result
}
async function getPrivate(contract, txid) {
    console.log(`STATUS (getPrivate): getting transient for ${txid}`);
    const result = JSON.parse(
        utf8Decoder.decode(
            await contract.evaluateTransaction('GetPrivate', txid)
        )
    );
    console.log(`\tSUCCESS (getPrivate): ${result}`);
    return result
}
async function getAllAssets(contract) {
    const resultBytes = await contract.submitTransaction('GetAllAssets');

    const resultJson = utf8Decoder.decode(resultBytes);
    const result = JSON.parse(resultJson);
    return result;
}
// NEW:
async function createAsset(contract, pub, priv) { //returns txid!
    try {
        const txid = await contract.submitTransaction('CreateAsset', JSON.stringify(pub), JSON.stringify(priv));
        console.log(`SUCCESS (createAsset): created asset ${utf8Decoder.decode(txid)}`);
        return utf8Decoder.decode(txid);
    } catch (err) {
        console.error(`ERROR (createAsset):`);
        console.error(err)
    }
}
async function getExisting(contract) {
    console.log(
        '\n--> Evaluate Transaction: GetAllAssets, function returns all the current assets on the ledger'
    );

    const resultBytes = await contract.evaluateTransaction('GetAllNotFrom', peerHostAlias);

    const resultJson = utf8Decoder.decode(resultBytes);
    const requests = JSON.parse(resultJson);
    console.log('*** Existing Requests:', requests);
    return requests;
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
