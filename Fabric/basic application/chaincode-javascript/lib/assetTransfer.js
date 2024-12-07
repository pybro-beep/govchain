/*
 * Copyright IBM Corp. All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict';

// Deterministic JSON.stringify()
const stringify  = require('json-stringify-deterministic');
const sortKeysRecursive  = require('sort-keys-recursive');
const { Contract } = require('fabric-contract-api');
const { TextDecoder } = require('node:util');


const utf8Decoder = new TextDecoder();

class AssetTransfer extends Contract {
    async InitLedger(ctx) {
        const assets = [
            {
                ID: 0,
                Owner: 'N/A',
            },
            {
                ID: 1,
                Owner: 'N/A',
            }
        ];

        for (const asset of assets) {
            asset.docType = 'asset';
            // example of how to write to world state deterministically
            // use convetion of alphabetic order
            // we insert data in alphabetic order using 'json-stringify-deterministic' and 'sort-keys-recursive'
            // when retrieving data, in any lang, the order of data will be the same and consequently also the corresonding hash
            try {
                await ctx.stub.putState(asset.ID, Buffer.from(stringify(sortKeysRecursive(asset))));
            } catch (err) {
                console.log("Chaincode Error (InitLedger");
                console.error(err);
            }
        }
    }
    async Purge(ctx, txid) {
        const privateCollectionName = "SharedPrivateCollection";
        // check if private data exists
        const privateDataBytes = await ctx.stub.getPrivateData(privateCollectionName, txid);
        if (!privateDataBytes || privateDataBytes.length === 0) {
            throw new Error(`Private data of request ${txid} does not exist in collection ${privateCollectionName}`);
        }
        // if it does, delete it
        ctx.stub.deletePrivateData(privateCollectionName, txid);
        // remove TTL, because te(txid, JSON.stringify(data));
        return txid;
    }
    async GetPublic(ctx, txid) {
        console.log(`txid used in GetPublic: ${txid}`)
        const publicDataBytes = await ctx.stub.getState(txid);
        // if (!publicDataBytes || publicDataBytes.length === 0) {
        //     throw new Error(`Request with transaction ID ${txid} of type ${typeof(txid)}: public data does not exist: ${publicDataBytes.toString()}`);
        // }
        return publicDataBytes.toString();
    }
    async GetPrivate(ctx, txid) {
        console.log(`txid used in GetPrivate: ${txid}`)
        const publicDataBytes = await ctx.stub.getState(txid);
        const privateCollectionName = "SharedPrivateCollection";
        const privateDataBytes = await ctx.stub.getPrivateData(privateCollectionName, txid);
        if (!privateDataBytes || privateDataBytes.length === 0) {
            throw new Error(`Private data of request ${txid} does not exist in collection ${privateCollectionName}`);
        }
        return privateDataBytes.toString();
    }
    // CreateAsset issues a new asset to the world state with given details.
    async CreateAsset(ctx, pub, priv) {
        const privateCollectionName = "SharedPrivateCollection";
        const txid = await ctx.stub.getTxID();
        const exists = await this.AssetExists(ctx, txid);
        if (exists) {
            throw new Error(`The asset ${txid} already exists`);
        }
        // if done with dynamic collectionName -> could throw error if access is not allowed
        await ctx.stub.putState(txid, Buffer.from(stringify(sortKeysRecursive(pub))));
        console.log(`txid used in putState: ${txid}`)
        await ctx.stub.putPrivateData(privateCollectionName, txid, Buffer.from(stringify(sortKeysRecursive(priv))));
        console.log(`txid used in putPrivateData: ${txid}`)
        
        try {
            const publicData = await this.GetPublic(ctx, txid);
            console.log(`Retrieved public data for txid ${txid}: ${publicData}`);
        } catch (err) {
            console.error(`Error retrieving public data for txid ${txid}:`, err);
        }
        const pub_object = JSON.parse(pub);
        pub_object.txid = txid;
        await ctx.stub.setEvent("CreateAsset", Buffer.from(stringify(sortKeysRecursive(pub_object))));
        return txid.toString();
    }
    async UpdatePublic(ctx, pub, key) {
        const exists = await this.AssetExists(ctx, key);
        if (!exists) {
            throw new Error(`The asset ${key} does not exist -> should not be updated`);
        }
        // if done with dynamic collectionName -> could throw error if access is not allowed
        await ctx.stub.putState(key, Buffer.from(stringify(sortKeysRecursive(pub))));
        return key.toString();
    }
    async UpdatePrivate(ctx, priv, key) {
        const privateCollectionName = "SharedPrivateCollection";
        const exists = await this.AssetExists(ctx, key);
        if (!exists) {
            throw new Error(`The asset ${key} does not exist -> should not be updated`);
        }
        // if done with dynamic collectionName -> could throw error if access is not allowed
        await ctx.stub.putPrivateData(privateCollectionName, key, Buffer.from(stringify(sortKeysRecursive(priv))));
        return key.toString();
    }
    // DeleteAsset deletes an given asset from the world state.
    async DeleteAsset(ctx, id) {
        const exists = await this.AssetExists(ctx, id);
        if (!exists) {
            throw new Error(`The asset ${id} does not exist`);
        }
        return ctx.stub.deleteState(id);
    }
    // AssetExists returns true when asset with given ID exists in world state.
    async AssetExists(ctx, id) {
        const assetJSON = await ctx.stub.getState(id);
        return assetJSON && assetJSON.length > 0;
    }
    // GetAllAssets returns all assets found in the world state.
    async GetAllAssets(ctx) {
        const allResults = [];
        // range query with empty string for startKey and endKey does an open-ended query of all assets in the chaincode namespace.
        const iterator = await ctx.stub.getStateByRange('', '');
        let result = await iterator.next();
        while (!result.done) {
            const strValue = Buffer.from(result.value.value.toString()).toString('utf8');
            const keyValue = Buffer.from(result.value.key.toString()).toString('utf8');
            let record;
            try {
                record = {key: keyValue, value: JSON.parse(strValue)}
            } catch (err) {
                console.log(err);
                record = `${keyValue}: ${strValue}`;
            }
            allResults.push(record);
            result = await iterator.next();
        }
        return JSON.stringify(allResults);
    }
}

module.exports = AssetTransfer;
