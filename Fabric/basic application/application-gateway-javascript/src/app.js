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
        await getAllAssets(contract);
        console.log(assetList);
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
        console.log(`STATE (handleTTL): was called on payload which does not have a TTL property (${typeof(payload)}): ${payload}`);
        return;
    }
    // calculate if TTL has ended
    const creationTime = new Date(Date.parse(payload.timestamp));
    const currentTime = new Date();
    const timeToLive = new Date().setDate(creationTime.getDate() + payload.ttl);
    // if TTL has ended, purge private data
    if (currentTime.getDate() > timeToLive.getDate()) {
        contract.submitTransaction('Purge', JSON.stringify(txid));
        console.log(`SUCCESS (handleTTL): purged private data of ${txid} because TTL is ${(currentTime - timeToLive).toString()}`);
    }
}
async function handleResponse(contract, payload, txid) {
    if (!payload.request_to) {
        console.log(`Attempted to handle invalid response: ${JSON.stringify(payload)}`)
        return;
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
    if (!contract || !payload || !txid) {
        throw new Error(`missing properties: contract: ${typeof(contract)}, payload: ${typeof(payload)}, txid: ${typeof(txid)}`)
    }
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
    console.log(`\t STATE: ${txid} has public data: ${await getPublic(contract, txid)}\n-> setting status of ${txid} with ${result_txid}`);
    const update = await setStatus(contract, txid, result_txid);
}
async function setStatus(contract, requestTxid, responseTxid) { 
    var new_public = await getPublic(contract, requestTxid);
    console.log(`old status: ${new_public}`);
    new_public = JSON.parse(new_public);
    new_public.status = responseTxid;
    new_public = JSON.stringify(new_public);
    console.log(`new status: ${new_public}`);
    await updatePublic(contract, new_public, requestTxid)
}
async function updatePublic(contract, pub, key) { //pub = object -> is stringified in chaincode call!
    try {
        console.log(`STATE (updatePublic): updating public of ${key}: ${pub}`)
        const txid = await contract.submitTransaction('UpdatePublic', pub, key);
        console.log(`SUCCESS (updatePublic): updated asset ${utf8Decoder.decode(txid)}`);
        return utf8Decoder.decode(txid);
    } catch (err) {
        console.error(`ERROR (updatePublic):`);
        console.error(err)
    }
}
async function updatePrivate(contract, priv, key) { //returns txid!
    try {
        const txid = await contract.submitTransaction('UpdatePrivate', JSON.stringify(priv), key);
        console.log(`SUCCESS (updatePrivate): updated asset ${utf8Decoder.decode(txid)}`);
        return utf8Decoder.decode(txid);
    } catch (err) {
        console.error(`ERROR (updatePrivate):`);
        console.error(err)
    }
}
async function getPublic(contract, txid) {
    if (!contract || !txid) {
        throw new Error(`ERROR (getPublic): invalid arguments contract: ${typeof(contract)}, txid: ${typeof(txid)}`);
    }
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
