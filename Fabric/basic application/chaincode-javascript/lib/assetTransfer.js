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
                ID: '0',
                Owner: 'Null',
            },
            {
                ID: '1',
                Owner: '0',
            }
        ];

        for (const asset of assets) {
            asset.docType = 'asset';
            // example of how to write to world state deterministically
            // use convetion of alphabetic order
            // we insert data in alphabetic order using 'json-stringify-deterministic' and 'sort-keys-recursive'
            // when retrieving data, in any lang, the order of data will be the same and consequently also the corresonding hash
            await ctx.stub.putState(asset.ID, Buffer.from(stringify(sortKeysRecursive(asset))));
        }
    }

    async CreatePrivateRequest(ctx, id, owner, timestamp) {
        // FIXME: event not being set/thrown/used in app.js
        const transientData = ctx.stub.getTransient();
        if (!transientData.has('data')) {
            throw new Error('The transient data must contain a "data" key');
        }

        // Transient data
        const data = JSON.parse(transientData.get('data').toString('utf8'));
        const privateCollectionName = `Org${ctx.clientIdentity.getMSPID()}MSPPrivateCollection`;
        try {
            await ctx.stub.putPrivateData(privateCollectionName, id, Buffer.from(JSON.stringify(data)));
            console.log(`put private data with ID ${id}:\n${Buffer.from(JSON.stringify(data))}`)
        } catch (err) {
            console.error(`Failed to put private data:\n${err.toString()}`)
        }

        // Normal data
        const request = {
            id: id,
            requester: owner,
            timestamp: timestamp
        }
        try {
            await ctx.stub.putState(id, Buffer.from(
                stringify(
                    sortKeysRecursive(request)
                )
            ));
            console.log(`put data of request ${id}:\n${stringify(sortKeysRecursive(request))}`);
        } catch (err) {
            console.error(`failed to put data of request ${id} with error:\n${err.toString()}`);
        }
        return JSON.stringify(request);
    }
    async CreatePrivateResponse(ctx, id, request_id, owner, timestamp) {
        // FIXME: event not being set/thrown/used in app.js
        const transientData = ctx.stub.getTransient();
        if (!transientData.has('data')) {
            throw new Error('The transient data must contain a "data" key');
        }

        // Transient data
        const data = JSON.parse(transientData.get('data').toString('utf8'));
        const privateCollectionName = `Org${ctx.clientIdentity.getMSPID()}MSPPrivateCollection`;
        try {
            await ctx.stub.putPrivateData(privateCollectionName, id, Buffer.from(JSON.stringify(data)));
            console.log(`put private data with ID ${id} as answer to ${request_id}:\n${Buffer.from(JSON.stringify(data))}`)
        } catch (err) {
            console.error(`Failed to put private data:\n${err.toString()}`)
        }

        // Normal data
        const response = {
                        id: id,
                        request_id: request_id,
                        owner: owner,
                        timestamp: timestamp
                    }
        try {
            await ctx.stub.putState(id, Buffer.from(
                stringify(
                    sortKeysRecursive(response)
                )
            ));
            console.log(`put data in response ${id} to request ${request_id}:\n${stringify(sortKeysRecursive(response))}`)
        } catch(err) {
            console.error(`failed to put data in response ${id} to request ${request_id}:\n${err.toString()}`)
        }
        return JSON.stringify(response);
    }
    // CreateAsset issues a new asset to the world state with given details.
    async CreateAsset(ctx, id, color, size, owner, appraisedValue) {
        const exists = await this.AssetExists(ctx, id);
        if (exists) {
            throw new Error(`The asset ${id} already exists`);
        }

        const asset = {
            ID: id,
            Color: color,
            Size: size,
            Owner: owner,
            AppraisedValue: appraisedValue,
        };
        // we insert data in alphabetic order using 'json-stringify-deterministic' and 'sort-keys-recursive'
        await ctx.stub.putState(id, Buffer.from(stringify(sortKeysRecursive(asset))));
        return JSON.stringify(asset);
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
