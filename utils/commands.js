const path = require('path');
const moment = require('moment-timezone');
const { rdbParser } = require('./rdbParser');
const fs = require('fs');

let redisStore = {
    // key: { value: 34, expiry: UNIX } // Format for storing keys and values 
};

const slaveAcks = {
    // port : ackCount
};

const setCommandByClient = {
    // port : setCount
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
    console.log('received ping command, responding');
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
    console.log(commandArray);
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
    const keyType = redisStore[key] ? 'string' : 'none';
    const resp = parseResponse('respSimpleString', keyType);
    return [resp];
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
    handleTypeCommand
}