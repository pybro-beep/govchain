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
        var pub = {
            "requester": mspId,
            "timestamp": new Date().toISOString(),
            "type": "request",
            "status": "pending",
        };
        var priv = {
            "details": `frage personenbezogene daten von ${Math.random()*100000000} an.`
        };
        console.time("All Assets")
        var assetList = await getAllAssets(contract);
        console.timeEnd("All Assets")
        console.log(`amount of assets: ${assetList.length}`)
        var promises = [];
        if (assetList.length == 0) {
            var n = 100;
            for (i = 0; i < n; i++) {
                pub["timestamp"] = new Date().toISOString();
                priv = {
                    "details": `frage personenbezogene daten von ${Math.random()*100000000} an.`
                };
                promises.push(createAsset(contract, pub, priv));
            }
            Promise.all(promises);
            var assetList = await getAllAssets(contract);
        }
        
        console.time(`work on ${assetList.length} assets`);
        var promises = [];
        for (i = 0; i < assetList.length; i++) {
            metadata = JSON.parse(assetList[i].value);
            // console.log(`\n######### WORKING ON #########\n\tKEY: ${assetList[i].key}\n\tWITH DATA: ${JSON.stringify(metadata)}\n`);
            console.time(metadata.type || "unknown");
            try {
                // const public_data = JSON.parse(await getPublic(contract, assetList[i].key));
                if (metadata.type === 'request') {
                    if (metadata.requester === mspId) {
                        // console.log(`\tSUCCESS (loop): skipping request ${assetList[i].key}: made by my MSP`)
                    } else {
                        promises.push(handleRequest(contract, metadata, assetList[i].key));
                    }
                } else if (metadata.type === 'response') {
                    promises.push(handleResponse(contract, metadata, assetList[i].key));
                } else {
                    console.log (`\tWARN (loop):no type for ${assetList[i].key}} ${metadata}`);
                }
            } catch (err) {
                console.error("error while looping over assets:");
                console.error(err);
            } finally {
                console.timeEnd(metadata.type || "unknown");
            }
        }
        Promise.all(promises); //await all promises created in this loop
        console.timeEnd(`work on ${assetList.length} assets`);
        var worldState = await getAllAssets(contract);
        console.log(`\n############### WORLD STATE:`);
        console.log(worldState);
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
    if (!payload.ttl && payload.ttl != 0) {
        console.log(`\tSTATE (handleTTL): was called on payload which does not have a TTL property (${typeof(payload)}): ${payload}`);
        return;
    }
    // calculate if TTL has ended
    const creationTime = new Date(Date.parse(payload.timestamp));
    const currentTime = new Date();
    var timeToLive = new Date(creationTime.toString());
    timeToLive.setDate(timeToLive.getDate() + payload.ttl);
    // if TTL has ended, purge private data
    if (currentTime >= timeToLive) {
        await contract.submitTransaction('Purge', txid);
        // console.log(`\tSTATE (handleTTL): purged private data of ${txid} because TTL is ${timeToLive.toString()} and current time is ${currentTime.toString()}`);
        var new_public = JSON.parse(await getPublic(contract, txid));
        delete new_public.ttl;
        // console.log(`\tSTATE (handleTTL): new metadata ${typeof(new_public)} without ttl: ${JSON.stringify(new_public)}`);;
        await updatePublic(contract, JSON.stringify(new_public), txid);
    } else {
        // console.log(`SUCCESS (handleTTL): current time: ${currentTime.toString()}, TTL: ${timeToLive.toString()}, TTL remaining: ${(timeToLive - currentTime).toString()}`)
    }
}
async function handleResponse(contract, payload, txid) {
    if (!payload.response_to) {
        console.log(`\tWARN (handleResponse): Attempted to handle response with no response_to attribute: ${JSON.stringify(payload)}`)
        return;
    }
    const request = JSON.parse(await getPublic(contract, payload.response_to));
    // console.log(`\tSTATUS (handleResponse): request corresponding with response ${payload.response_to}: ${request}`);
    if (request.requester === mspId) {
        const priv_data = await getPrivate(contract, txid);
        // console.log(`\tSTATUS (handleResponse): status of request ${payload.response_to} is now ${request.status}\n
        //     \tSUCCESS (handleResponse): got private data for ${payload.response_to} from ${txid}:\n
        //     \t\t${priv_data}`
        // );
    } else {
        // console.log(`\tSUCCESS (handleResponse): response ${txid} responds to ${request.requester} which is not my Org (${mspId})`);
    }
    // responses contain sensitive data -> need to be purged
    await handleTTL(contract, payload, txid);
}
async function handleRequest(contract, payload, txid) {
    if (!contract || !payload || !txid) {
        throw new Error(`missing properties: contract: ${typeof(contract)}, payload: ${typeof(payload)}, txid: ${typeof(txid)}`)
    }
    if (payload.requester == mspId) {
        // console.log(`\tSUCCESS (handleRequest): skipping request made by own org ${mspId}`);
        return null;
    } else if (payload.status != "pending") {
        // console.log(`\tSUCCESS (handleRequest): skipping already answered request ${txid} with status ${payload.status}`);
        return null;
    }
    const pub = {
        "type": "response",
        "timestamp": new Date().toISOString(),
        "response_to": txid,
        "ttl": 2 // days
    };
    const priv = { // replacement for internal logic of Org
        "details": "personenbezogene Daten"
    };
    // console.log(`\tSTATUS (handleRequest): request ${txid} has private data: ${await getPrivate(contract, txid)}`);
    // console.log(`\tSTATUS (handleRequest): responding to ${txid} with ${JSON.stringify(pub)}`);
    const result_txid = await createAsset(contract, pub, priv)
    // console.log(`\tSUCCESS (handleRequest): created response ${result_txid}`);
    // console.log(`\tSTATE(handleRequest): ${txid} has public data: ${await getPublic(contract, txid)}\n-> setting status of ${txid} with ${result_txid}`);
    const update = await setStatus(contract, txid, result_txid);
}
async function setStatus(contract, requestTxid, responseTxid) { 
    var new_public = await getPublic(contract, requestTxid);
    new_public = JSON.parse(new_public);
    new_public.status = responseTxid;
    new_public = JSON.stringify(new_public);
    await updatePublic(contract, new_public, requestTxid)
}
async function updatePublic(contract, pub, key) {
    try {
        // console.log(`\tSTATE (updatePublic): updating public of ${key}: ${pub}`)
        const txid = await contract.submitTransaction('UpdatePublic', pub, key);
        // console.log(`\tSUCCESS (updatePublic): updated asset ${utf8Decoder.decode(txid)}`);
        return utf8Decoder.decode(txid);
    } catch (err) {
        console.error(`ERROR (updatePublic):`);
        console.error(err)
    }
}
async function updatePrivate(contract, priv, key) { //returns txid!
    try {
        const txid = await contract.submitTransaction('UpdatePrivate', JSON.stringify(priv), key);
        // console.log(`\tSUCCESS (updatePrivate): updated asset ${utf8Decoder.decode(txid)}`);
        return utf8Decoder.decode(txid);
    } catch (err) {
        console.error(`ERROR (updatePrivate):`);
        console.error(err)
    }
}
async function getPublic(contract, txid) {
    console.time("get Metadata");
    if (!contract || !txid) {
        throw new Error(`ERROR (getPublic): invalid arguments contract: ${typeof(contract)}, txid: ${typeof(txid)}`);
    }
    // console.log(`\tSTATUS (getPublic): getting public for ${txid}`);
    let result;
    result = JSON.parse(
        utf8Decoder.decode(
            await contract.submitTransaction('GetPublic', txid)
        )
    );
    console.timeEnd("get Metadata");
    // console.log(`\tSUCCESS (getPublic): ${txid} = ${result}`);
    return result
}
async function getPrivate(contract, txid) {
    console.time("get Data");
    // console.log(`\tSTATUS (getPrivate): getting transient for ${txid}`);
    const result = JSON.parse(
        utf8Decoder.decode(
            await contract.evaluateTransaction('GetPrivate', txid)
        )
    );
    console.timeEnd("get Data");
    // console.log(`\tSUCCESS (getPrivate): ${result}`);
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
    console.time("create");
    try {
        const txid = await contract.submitTransaction('CreateAsset', JSON.stringify(pub), JSON.stringify(priv));
        // console.log(`\tSUCCESS (createAsset): created asset ${utf8Decoder.decode(txid)}`);
        return utf8Decoder.decode(txid);
    } catch (err) {
        console.error(`ERROR (createAsset):`);
        console.error(err)
    } finally {
        console.timeEnd("create");
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
