const path = require('path');
const moment = require('moment-timezone');
const { rdbParser } = require('./rdbParser');
const fs = require('fs');
const RadixTrie = require("radix-trie-js");


let redisStore = {
    // key: { value: 34, expiry: UNIX } // Format for storing keys and values 
};

const slaveAcks = {
    // port : ackCount
};

const setCommandByClient = {
    // port : setCount
}
let waitingForNewEntry = false;
let waitingForStreamIDs = [];
let receivedStreamsWhileWaiting = {
    // streamID: [entryID-1, entryID-2]
}
// -------------------------------- Helper Functions -----------------------

const parseResponse = (respEncoding, content) => {
    if (respEncoding == 'bulkString') {
        return `$${content.length}\r\n${content}\r\n`;
    }
    if (respEncoding == 'bulkStringArray') {
        // content will be array in this case 
        let response = `*${content.length}\r\n`;
        for (const element of content) {
            response += `$${element.length}\r\n${element}\r\n`
        }
        return response;
    }
    if (respEncoding == 'respInteger') {
        return `:${content}\r\n`;
    }
    if (respEncoding == 'respSimpleString') {
        return `+${content}\r\n`;
    }
}

// it will recieve rdb file and directory
const loadRedisStore = (fileDir, fileName) => {
    const filePath = path.join(fileDir, fileName);
    const devENV = (fileDir == './testingDumps' && fileName == 'dump.rdb') ? true : false;
    const parsedRDB = rdbParser(filePath, devENV);
    redisStore = parsedRDB.redisStore;
    // console.log('redis store loaded', redisStore, parsedRDB);
}

const getLastStoredEntry = (trie) => {
    let lastEntry = null;
    for (const [key, value] of trie.entries()) {
        lastEntry = { key, value };
    }
    return lastEntry;
}

// timestamp is always in a miliseconds
const validateEntryID = (lastEntryID, currEntryID) => {
    const resp = {
        isValidEntry: false,
        msg: currEntryID // will contain valid current entry ID or error msg
    }

    // Case 1: curr entry ID is *
    if (currEntryID == '*') {
        resp.isValidEntry = true;
        if (lastEntryID) {
            const lastTimestamp = lastEntryID.split('-')[0];
            const lastSeqNumber = lastEntryID.split('-')[1];

            resp.msg = `${lastTimestamp}-${parseInt(lastSeqNumber) + 1}`;
        }
        else {
            // last entry id not present
            const currTimestamp = Date.now();
            resp.msg = `${currTimestamp}-0`;
        }
    }

    else if (currEntryID.split('-')[1] == '*') { // Case2: curr timestamp is present but not the seq number
        const currTimestamp = currEntryID.split('-')[0];

        if (lastEntryID) {
            const lastTimestamp = lastEntryID.split('-')[0];
            const lastSeqNumber = lastEntryID.split('-')[1];

            if (currTimestamp < lastTimestamp) {
                resp.isValidEntry = false;
                resp.msg = 'The ID specified in XADD is equal or smaller than the target stream top item'
            }
            else if (currTimestamp == lastTimestamp) {
                resp.isValidEntry = true;
                resp.msg = `${currTimestamp}-${parseInt(lastSeqNumber) + 1}`;
            }
            else {
                resp.isValidEntry = true;
                resp.msg = `${currTimestamp}-${currTimestamp == 0 ? 1 : 0}`;
            }
        }
        else {
            // last entry id not present
            resp.msg = `${currTimestamp}-${currTimestamp == 0 ? 1 : 0}`;
        }
    }

    else { // Case 3: Full current entry is present

        // check for the minimum ID 
        if (currEntryID == '0-0') {
            resp.isValidEntry = false;
            resp.msg = `The ID specified in XADD must be greater than 0-0`
        }
        else if (lastEntryID && currEntryID <= lastEntryID) {
            resp.isValidEntry = false;
            resp.msg = 'The ID specified in XADD is equal or smaller than the target stream top item'
        }
        else {
            // last entry id not present
            resp.isValidEntry = true;
            resp.msg = currEntryID;
        }
    }

    return resp;
}
// ------------------------------- Command Functions ----------------------------

const handleEchoCommand = (commandArray) => {
    const arg1 = commandArray[1] ? commandArray[1] : 'Echo';
    const response = parseResponse('bulkString', arg1);

    return [response];
}

const handleSetCommand = (commandArray, socket) => {
    const key = commandArray[1];
    const value = commandArray[2];
    const flag = commandArray[3] ? commandArray[3] : '';
    const expiryInSec = commandArray[4] ? commandArray[4] : '';

    redisStore[key] = { value };
    // in case of no socket present, it is coming to slave, ignore
    if (socket) {
        setCommandByClient[socket.remotePort] = setCommandByClient[socket.remotePort] ? setCommandByClient[socket.remotePort] + 1 : 1;
    }

    if (flag.toLowerCase() == 'px' && expiryInSec) {
        redisStore[key].expiry = moment().add(expiryInSec, 'milliseconds').valueOf();
    }
    return ['+OK\r\n'];
}

const handleGetCommand = (commandArray) => {


    const key = commandArray[1];

    const value = redisStore[key] ? redisStore[key].value : '';
    const expiry = redisStore[key] ? redisStore[key].expiry : '';

    if (value && (expiry ? expiry > moment().valueOf() : true)) {
        const response = parseResponse('bulkString', value);
        return (response);
    }
    else
        return ['$-1\r\n'];
}

const handleConfigCommand = (commandArray, fileDir, fileName) => {
    // 2 config commands allowed - 
    const arg1 = commandArray[1];
    const arg2 = commandArray[2];

    if (arg1.toLowerCase() == 'get' && arg2) {
        if (arg2.toLowerCase() == 'dir' && fileDir) {
            // response will be an array => [dir, /tmp/redis-data]
            return (parseResponse('bulkStringArray', ['dir', fileDir]));
        }
        else if (arg2.toLowerCase() == 'dbfilename' && fileName) {
            // response will be an array => [dbfilename, dump.rdb]
            return (parseResponse('bulkStringArray', ['dbfilename', fileName]));
        }
        else
            return '-ERR: Missing dir and filename arguments or wrong command\r\n';
    }
    else {
        return ['$-1\r\n'];
    }
}

const handleKeysCommand = (commandArray) => {
    const arg1 = commandArray[1];
    if (arg1 == "*") {
        const response = parseResponse('bulkStringArray', Object.keys(redisStore))
        return (response);
    }
    else return ['+PONG\r\n'];
}

const handlePingCommand = () => {
    // console.log('received ping command, responding');
    return ['+PONG\r\n'];
}

const handleInfoCommand = (commandArray, flagsAndValues, connectedSlaves) => {
    if (commandArray[1].toLowerCase() == 'replication') {
        // it needs info about redis cluster, role of current server, number of slaves, etc. 
        const serverRole = flagsAndValues.replicaof ? 'slave' : 'master';
        const totalSlaves = connectedSlaves ? connectedSlaves.length : 0;
        const serverID = '8371b4fb1155b71f4a04d3e1bc3e18c4a990aeeb';
        const masterOffset = 0;
        const response = parseResponse('bulkString',
            `role:${serverRole}\nconnected_slaves:${totalSlaves}\nmaster_replid:${serverID}\nmaster_repl_offset:${masterOffset}`
        )
        return [response];
    }
    else
        return parseResponse('bulkString', 'allInfoHere')
}

const handleReplConfCommand = (commandArray, dataReceivedByteCount, socket) => {
    const commandArg1 = commandArray[1];
    if (commandArg1 == 'listening-port' || commandArg1 == 'capa') {
        return ['+OK\r\n'];
    }
    else if (commandArg1 == 'getack') {
        const slaveOffset = dataReceivedByteCount;
        const response = parseResponse('bulkStringArray', ['REPLCONF', 'ACK', slaveOffset.toString()]);
        return [response];
    }
    else if (commandArg1.toLowerCase() == 'ack') {
        // If ack by same slave, increase ack count, else add entry for new slave
        slaveAcks[socket.remotePort] = slaveAcks[socket.remotePort] ? slaveAcks[socket.remotePort] + 1 : 1;
        return [];
    }
}

const handlePsyncCommand = (commandArray) => {
    let masterReplicationID = commandArray[1];
    let slaveOffset = commandArray[2];

    const response = [];
    if (masterReplicationID == '?' && slaveOffset == -1) {
        // This is the first time synchronise 
        // replication is is unknown to slave, so we will set it 
        masterReplicationID = '8371b4fb1155b71f4a04d3e1bc3e18c4a990aeeb'; // sending the masters replication ID. 
        // offset will be set to zero 
        const masterOffset = 0; // sending offset = 0, means no data is sent till now.
        response.push(`+FULLRESYNC ${masterReplicationID} ${masterOffset}\r\n`);

        // Send current snapshot of master's data to replica
        const fileContentInHex = fs.readFileSync(path.join(process.cwd(), 'testingDumps', 'emptyDumpInbase64.rdb'));
        const rdbBuffer = Buffer.from(fileContentInHex.toString(), 'hex');
        const rdbHead = Buffer.from(`$${rdbBuffer.length}\r\n`);

        response.push(rdbHead);
        response.push(rdbBuffer);

    }
    return response;
}

const handleFullResyncCommand = (commandArray) => {
    // console.log(commandArray);
}

const handleWaitCommand = async (commandArray, connectedSlaves) => {

    let commandProcessedByReplicaCount = Object.keys(setCommandByClient).length ? Object.keys(slaveAcks).length : connectedSlaves;
    const reqReplicaCount = commandArray[1];
    const timeoutInMs = commandArray[2];

    // If current count is less than required, wait for the timeout period
    if (Object.keys(setCommandByClient).length && commandProcessedByReplicaCount < reqReplicaCount) {

        const waitStartTime = Date.now(); // Track the time before waiting
        await new Promise((resolve) => setTimeout(resolve, Number(timeoutInMs)
        ));
        // Recount acks after waiting
        commandProcessedByReplicaCount = Object.keys(slaveAcks).length;
    }

    // After waiting or if enough replicas already processed, return response
    const resp = parseResponse('respInteger', commandProcessedByReplicaCount);
    return [resp];
};

const handleTypeCommand = (commandArray) => {
    const key = commandArray[1];
    let keyType = 'none';
    if (redisStore[key]) {
        keyType = redisStore[key].value ? 'string' : 'stream';
    }
    const resp = parseResponse('respSimpleString', keyType);
    return [resp];
}

const handleXaddCommand = (commandArray) => {
    // this will add streams in redis store 
    // incoming stream format - XADD stream_key ID key1 val1 key2 value2
    const stream_key = commandArray[1];
    // entryIDs basically are timestampInMS - serial number, where serial number is incremented in case of same timestamp
    let entryID = commandArray[2];
    // entry ID can be in 3 formats - full entry ID (need validation), time-* (need validation for time part, and sequence number should be auto generated) and * (time and seq autogenerated)

    const obj = {}
    for (let i = 3; i < commandArray.length; i += 2) {
        // i = key, i+1 = value
        obj[commandArray[i]] = commandArray[i + 1];
    }

    // Check if a stream exists in redis store using stream_key
    if (redisStore[stream_key]) {

        const trie = redisStore[stream_key];
        if (trie.get(entryID)) {
            // entry with same ID exists
            return [`-ERR The ID specified in XADD is equal or smaller than the target stream top item\r\n`]
        }
        else {
            // entry with same ID dont exist 
            // comapre the ID with last inserted node's entryID 
            const lastEntry = getLastStoredEntry(trie);
            const currEntryValidation = validateEntryID(lastEntry.key, entryID);

            if (currEntryValidation.isValidEntry) {
                entryID = currEntryValidation.msg;
                // insert new entry to the stream
                trie.add(entryID, obj);
            }
            else {
                return [`-ERR ${currEntryValidation.msg}\r\n`]
            }

        }
    }
    else {
        // add a new stream

        // rax tree ( a trie based DS ) used to store redis-streams. 
        const trie = new RadixTrie();
        const currEntryValidation = validateEntryID(null, entryID);
        entryID = currEntryValidation.msg;
        trie.add(entryID, obj);
        redisStore[stream_key] = trie;
    }

    // Handle cases if waiting for new streams
    // IF the XADD command failed, no new message is added to the stream.
    if (waitingForNewEntry && waitingForStreamIDs.includes(stream_key)) {
        receivedStreamsWhileWaiting[stream_key] = receivedStreamsWhileWaiting[stream_key] ? receivedStreamsWhileWaiting[stream_key].push(entryID) : [entryID];
    }

    // console.log(JSON.stringify({redisStore}, null, 2));
    return parseResponse('bulkString', entryID);
}

/**
 * Parses XRANGE command parameters.
 * 
 * @param {*} commandArray - [XRANGE some_key startID endID]
 * @returns {Array} - Properly formatted XRANGE command array.
 * 
 * - `XRANGE some_key startID endID` => Returns entries in the **inclusive** range of start and end IDs.
 * - Defaults: `startID = 0` (start of stream), `endID = +` (end of stream).
 * - Special IDs: 
 *    - `-` => Beginning of stream.
 *    - `+` => End of stream.
 * 
 * ### Examples:
 * - `XRANGE some_key - 1526985054079` => From start to ID `1526985054079`.
 * - `XRANGE key 1526985054069-0 1526985054079-5`  // From ID `1526985054069-0` to `1526985054079-5`
 * - `XRANGE some_key 1526985054069 +` => From ID `1526985054069` to end.
 */
const handleXRangeCommand = (commandArray) => {

    const streamKey = commandArray[1];
    let streamStart = commandArray[2];
    let streamEnd = commandArray[3];


    if (!streamStart.includes('-')) {
        streamStart += '-0'; //append seq number
    }

    if (streamEnd != '+' && !streamEnd.includes('-')) {
        streamEnd += '-9999999999999999'; //append seq number
    }

    const trie = redisStore[streamKey];

    if (!trie)
        return ['$-1\r\n'];

    // stream exists 
    const requiredStreams = [];

    for (const [key, value] of trie.entries()) {
        if ((streamStart == '-' || streamStart <= key) && (streamEnd == '+' || streamEnd >= key))
            requiredStreams.push({ key, value });
    }


    const finalResponse = [];
    for (const { key, value } of requiredStreams) {
        const parsedKey = parseResponse('bulkString', key);
        const valueArray = [];

        for (const [key1, val1] of Object.entries(value)) {
            valueArray.push(parseResponse('bulkString', key1));
            valueArray.push(parseResponse('bulkString', val1));
        }

        let parsedValueArray = `*${valueArray.length}\r\n${valueArray.join('')}`;

        const parsedEntry = `*2\r\n${parsedKey}${parsedValueArray}`;

        finalResponse.push(parsedEntry);

    }
    const response = `*${finalResponse.length}\r\n${finalResponse.join('')}`;

    return [response];
}
/**
 * Used to read multiple streams
 * @param {*} commandArray 
 * XRead is exclusive
 * Example 
 * XREAD STREAMS stream1 stream2 stream3 0 0 0 // read from specific IDs in each stream
 * XREAD STREAMS stream1 stream2 stream3 id1 id2 id3 ...
 */
const handleXReadCommand = (commandArray) => {
    const streamReadResponse = [];

    const streamArray = commandArray.slice(2);
    for (let i = 0; i < (streamArray.length) / 2; i++) {
        // extract keys and startingIDs 
        const streamKey = streamArray[i];
        let entryID = streamArray[i + (streamArray.length) / 2];

        const incrementedEntryID = `${entryID.split('-')[0]}-${Number(entryID.split('-')[1]) + 1}`

        const streamRangeCommand = ['XRANGE', streamKey, incrementedEntryID, '+'];
        streamReadResponse.push(`*2\r\n${parseResponse('bulkString', streamKey)}${handleXRangeCommand(streamRangeCommand)[0]}`)
    }

    const finalResponse = `*${streamReadResponse.length}\r\n${streamReadResponse.join('')}`
    return [finalResponse];
}

const waitForNewEntries = () => {
    return new Promise((resolve) => {
        const checkForEntries = () => {
            // If new entries are detected, resolve the promise
            if (Object.keys(receivedStreamsWhileWaiting).length) {
                waitingForNewEntry = false;
                resolve();
            } else {
                // Check again after a short delay
                if (waitingForNewEntry)
                    setTimeout(checkForEntries, 50);  // Non-blocking wait
                else
                    resolve();
            }
        };
        checkForEntries();
    });
};

// can be waitign for single stream or multiple 
// XREAD BLOCK 1000 STREAMS mystream1 mystream2 mystream3 $ 2-2 1-2
const handleXReadCommandWithReadBlocking = async (commandArray, socket) => {
    const timeoutInMs = commandArray[2];

    // toggle waiting flag 
    waitingForNewEntry = true;
    const streamArray = commandArray.slice(4);
    for (let i = 0; i < streamArray.length; i += 2) {
        waitingForStreamIDs.push(streamArray[i]);
    }

    let response = [];
    if (timeoutInMs != '0') {
        // if timeout == 0, blocking read indefinitely -> run xread command only when new entry comes 
        // else blocking read for time -> run xread command after timeout OR when new entry comes
        setTimeout(() => {
            waitingForNewEntry = false;
        }, timeoutInMs);
    }

    // Wait until new entries are detected
    await waitForNewEntries();


    // Fire XRead command with stream keys and entry IDs 
    response = handleXReadCommand(['XREAD', 'STREAMS', ...streamArray]);

    if (streamArray.length == 2) {
        // single stream queried, if response is null, return empty array 
        const splittedResp = response[0].split('\r\n');
        const entryArrayCount = splittedResp[4];
        if (entryArrayCount.includes('0')) // means no entry present, return empty bulk array
            response[0] = `$-1\r\n`;
    }
    socket.write(response[0]);

    // cleanup
    receivedStreamsWhileWaiting = {};
    waitingForNewEntry = false;
    waitingForStreamIDs = [];
    return;



}

module.exports = {
    handleEchoCommand,
    handleSetCommand,
    handleGetCommand,
    handleConfigCommand,
    handleKeysCommand,
    handlePingCommand,
    loadRedisStore,
    handleInfoCommand,
    parseResponse,
    handleReplConfCommand,
    handlePsyncCommand,
    handleFullResyncCommand,
    handleWaitCommand,
    handleTypeCommand,
    handleXaddCommand,
    handleXRangeCommand,
    handleXReadCommand,
    handleXReadCommandWithReadBlocking
}