'use strict';

// Deterministic JSON
const stringify  = require('json-stringify-deterministic');
const sortKeysRecursive  = require('sort-keys-recursive');
const { Contract } = require('fabric-contract-api');

class AssetTransfer extends Contract {
    async Purge(ctx, txid) {
        const privateCollectionName = "SharedPrivateCollection";
        // check if private data exists
        const privateDataBytes = await ctx.stub.getPrivateData(privateCollectionName, txid);
        if (!privateDataBytes || privateDataBytes.length === 0) {
            // if it doesnt, it does not need to be deleted
            return txid;
        }
        // if it does, delete it
        ctx.stub.deletePrivateData(privateCollectionName, txid);
        return txid;
    }
    async GetPublic(ctx, txid) {
        const publicDataBytes = await ctx.stub.getState(txid);
        if (!publicDataBytes || publicDataBytes.length === 0) {
            throw new Error(`Request with transaction ID ${txid}: state does not exist.}`);
        }
        return publicDataBytes.toString();
    }
    async GetPrivate(ctx, txid) {
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
        // CreateAsset should never be used to update an existing state -> throw an error if the asset exists
        if (exists) {
            throw new Error(`The asset ${txid} already exists`);
        }
        await ctx.stub.putState(txid, Buffer.from(stringify(sortKeysRecursive(pub))));
        // if done with dynamic collectionName -> could throw error if access is not allowed
        await ctx.stub.putPrivateData(privateCollectionName, txid, Buffer.from(stringify(sortKeysRecursive(priv))));

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
