const path = require('path');
const moment = require('moment-timezone');
const { rdbParser } = require('./rdbParser');

let redisStore = {
    // key: { value: 34, expiry: UNIX } // Format for storing keys and values 
};

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
}

// it will recieve rdb file and directory
const loadRedisStore= (fileDir, fileName)=>{
    const filePath = path.join(fileDir, fileName);
    const devENV = (fileDir == './testingDumps' && fileName == 'dump.rdb') ? true: false;
    const parsedRDB = rdbParser(filePath, devENV);
    redisStore = parsedRDB.redisStore;
    // console.log('redis store loaded', redisStore, parsedRDB);
}

// ------------------------------- Command Functions ----------------------------

const handleEchoCommand = (commandArray) =>{
    const arg1 = commandArray[1] ? commandArray[1] : 'Echo';
    const response = parseResponse('bulkString', arg1);

    return response;
}

const handleSetCommand = (commandArray) =>{
    const key = commandArray[1];
    const value = commandArray[2];
    const flag = commandArray[3] ? commandArray[3] : '';
    const expiryInSec = commandArray[4] ? commandArray[4] : '';

    redisStore[key] = { value };
    if (flag.toLowerCase() == 'px' && expiryInSec) {
        redisStore[key].expiry = moment().add(expiryInSec, 'milliseconds').valueOf();
    }
    return '+OK\r\n';
}

const handleGetCommand = (commandArray) =>{
   

    const key = commandArray[1];

    const value = redisStore[key] ? redisStore[key].value : '';
    const expiry = redisStore[key] ? redisStore[key].expiry : '';

    if (value && (expiry ? expiry > moment().valueOf() : true)) {
        const response = parseResponse('bulkString', value);
        return (response);
    }
    else
        return '$-1\r\n';
}

const handleConfigCommand = (commandArray, fileDir, fileName) =>{
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
           return '$-1\r\n';
       }
}

const handleKeysCommand = (commandArray) =>{
    const arg1 = commandArray[1];
    if (arg1 == "*") {
        const response = parseResponse('bulkStringArray', Object.keys(redisStore))
        return (response);
    }
    else return '+PONG\r\n';
}

const handlePingCommand = () =>{
    return '+PONG\r\n';
}
module.exports = {
    handleEchoCommand,
    handleSetCommand,
    handleGetCommand,
    handleConfigCommand,
    handleKeysCommand,
    handlePingCommand,
    loadRedisStore
}