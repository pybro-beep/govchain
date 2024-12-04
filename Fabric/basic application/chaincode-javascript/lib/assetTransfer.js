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
    async SetStatus(ctx, requestTxid, responseTxid) {
        const dataBytes = await ctx.stub.getState(requestTxid);
        if (!dataBytes || dataBytes.length === 0) {
            throw new Error(`state of ${requestTxid}: data does not exist`);
        }
        const data = JSON.parse(dataBytes.toString());
        // check if response exists
        const responseBytes = await ctx.stub.getState(responseTxid);
        if (!responseBytes || responseBytes.length === 0) {
            throw new Error(`response ${responseTxid} to ${requestTxid} does not exist`);
        }
        data.status = responseTxid;
        await ctx.stub.putState(requestTxid, Buffer.from(JSON.stringify(data)));
        return responseTxid;
    }
    async GetPublic(ctx, txid) {
        const publicDataBytes = ctx.stub.getState(txid);
        if (!publicDataBytes || publicDataBytes.length === 0) {
            throw new Error(`Request with transaction ID ${txid}: public data does not exist`);
        }
        return JSON.parse(publicDataBytes);
    }
    async GetPrivate(ctx, txid) {
        const privateCollectionName = "SharedPrivateCollection";
        const privateDataBytes = await ctx.stub.getPrivateData(privateCollectionName, txid);
        if (!privateDataBytes || privateDataBytes.length === 0) {
            throw new Error(`Request with transaction ID ${txid} does not exist in collection ${privateCollectionName}`);
        }

        return JSON.parse(privateDataBytes.toString());
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
        await ctx.stub.putPrivateData(privateCollectionName, txid, Buffer.from(stringify(sortKeysRecursive(priv))));
        if (pub["type"] == "request") {
            await ctx.stub.setEvent("request");
        } else if (pub["type"] == "response") {
            await ctx.stub.setEvent("response");
        }
        return txid;
    }
    // create private asset by writing transient data
    async CreatePrivateAsset(ctx, id, color, size, owner, appraisedValue) {
        const transientData = ctx.stub.getTransient();
        if (!transientData.has('asset')) {
            throw new Error('The transient data must contain an "asset" key');
        }

        const assetData = transientData.get('asset').toString('utf8');
        const asset = JSON.parse(assetData);

        if (!asset.ID || !asset.Color || !asset.Size || !asset.Owner || !asset.AppraisedValue) {
            throw new Error('Asset object must contain ID, Color, Size, Owner, and AppraisedValue');
        }

        const privateCollectionName = `Org${ctx.clientIdentity.getMSPID()}MSPPrivateCollection`;

        await ctx.stub.putPrivateData(privateCollectionName, asset.ID, Buffer.from(JSON.stringify(asset)));
        return JSON.stringify(asset);
    }
    // create private data shared between the two orgs using their shared private data collection
    async CreateSharedPrivateAsset(ctx) {
        const transientData = ctx.stub.getTransient();
        if (!transientData.has('asset')) {
            throw new Error('The transient data must contain an "asset" key');
        }

        const assetData = transientData.get('asset').toString('utf8');
        const asset = JSON.parse(assetData);

        if (!asset.ID || !asset.Color || !asset.Size || !asset.Owner || !asset.AppraisedValue) {
            throw new Error('Asset object must contain ID, Color, Size, Owner, and AppraisedValue');
        }

        const sharedCollectionName = 'SharedPrivateCollection';

        await ctx.stub.putPrivateData(sharedCollectionName, asset.ID, Buffer.from(JSON.stringify(asset)));
        return JSON.stringify(asset);
    }



    // ReadAsset returns the asset stored in the world state with given id.
    async ReadAsset(ctx, id) {
        const assetJSON = await ctx.stub.getState(id); // get the asset from chaincode state
        if (!assetJSON || assetJSON.length === 0) {
            throw new Error(`The asset ${id} does not exist`);
        }
        return assetJSON.toString();
    }
    // add ReadAsset support for the use of private collections of the current client
    async ReadPrivateAsset(ctx, id) {
        const privateCollectionName = `Org${ctx.clientIdentity.getMSPID()}MSPPrivateCollection`;
        const assetJSON = await ctx.stub.getPrivateData(privateCollectionName, id);
        if (!assetJSON || assetJSON.length === 0) {
            throw new Error(`Private asset with ID ${id} does not exist`);
        }
        return assetJSON.toString();
    }
    // ReadAsset support for reading data from the shared private data collection between org1 and org2
    async ReadSharedPrivateAsset(ctx, id) {
        const sharedCollectionName = 'SharedPrivateCollection';
        const assetJSON = await ctx.stub.getPrivateData(sharedCollectionName, id);
        if (!assetJSON || assetJSON.length === 0) {
            throw new Error(`Shared private asset with ID ${id} does not exist`);
        }
        return assetJSON.toString();
    }



    // UpdateAsset updates an existing asset in the world state with provided parameters.
    async UpdateAsset(ctx, id, color, size, owner, appraisedValue) {
        const exists = await this.AssetExists(ctx, id);
        if (!exists) {
            throw new Error(`The asset ${id} does not exist`);
        }

        // overwriting original asset with new asset
        const updatedAsset = {
            ID: id,
            Color: color,
            Size: size,
            Owner: owner,
            AppraisedValue: appraisedValue,
        };
        // we insert data in alphabetic order using 'json-stringify-deterministic' and 'sort-keys-recursive'
        return ctx.stub.putState(id, Buffer.from(stringify(sortKeysRecursive(updatedAsset))));
    }

    // DeleteAsset deletes an given asset from the world state.
    async DeleteAsset(ctx, id) {
        const exists = await this.AssetExists(ctx, id);
        if (!exists) {
            throw new Error(`The asset ${id} does not exist`);
        }
        return ctx.stub.deleteState(id);
    }
    // DeleteAsset for private data collections
    async DeletePrivateAsset(ctx, id) {
        const privateCollectionName = `Org${ctx.clientIdentity.getMSPID()}MSPPrivateCollection`;
        await ctx.stub.deletePrivateData(privateCollectionName, id);
    }


    // AssetExists returns true when asset with given ID exists in world state.
    async AssetExists(ctx, id) {
        const assetJSON = await ctx.stub.getState(id);
        return assetJSON && assetJSON.length > 0;
    }

    // TransferAsset updates the owner field of asset with given id in the world state.
    async TransferAsset(ctx, id, newOwner) {
        const assetString = await this.ReadAsset(ctx, id);
        const asset = JSON.parse(assetString);
        const oldOwner = asset.Owner;
        asset.Owner = newOwner;
        // we insert data in alphabetic order using 'json-stringify-deterministic' and 'sort-keys-recursive'
        await ctx.stub.putState(id, Buffer.from(stringify(sortKeysRecursive(asset))));
        return oldOwner;
    }
    // TODO: get all requests until current ID or no Answer
    async GetNextRequest(ctx, id, peer) {
        // FIXME: specify range parameters according to Documentation -> adjustable for better performance
        // TODO: if id is empty, get oldest
        const iterator = await ctx.stub.getStateByRange('', '');
        let result = await iterator.next();
        const answers = [];
        while (!result.done) {
            strValue = Buffer.from(result.value.value.toString()).toString('utf-8');
            let record;
            try {
                record = JSON.parse(strValue);
                if (record.request_id) {//record is a response
                    answers.push(request_id);
                } else if (!record.requester === peer && !answers.includes(record.id) && record.id > id) {
                    return JSON.stringify(record)
                }
            } catch (err) {
                console.error(`Failed to parse: ${strValue}`);
                record = strValue;
            }
        }
        return '';
    }
    // GetAllAssets returns all assets found in the world state.
    async GetAllAssets(ctx) {
        const allResults = [];
        // range query with empty string for startKey and endKey does an open-ended query of all assets in the chaincode namespace.
        const iterator = await ctx.stub.getStateByRange('', '');
        let result = await iterator.next();
        while (!result.done) {
            const strValue = Buffer.from(result.value.value.toString()).toString('utf8');
            let record;
            try {
                record = JSON.parse(strValue);
            } catch (err) {
                console.log(err);
                record = strValue;
            }
            allResults.push(record);
            result = await iterator.next();
        }
        return JSON.stringify(allResults);
    }
}

module.exports = AssetTransfer;
