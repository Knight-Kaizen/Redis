const net = require('net');
const fs = require('fs');
const moment = require('moment-timezone');
const path = require('path');

const port = 6379;
const host = '127.0.0.1'

const redisStore = {
    // key: { value: 34, expiry: UNIX } // Format for storing keys and values 
};


const arguments = process.argv.slice(2);
const [fileDir, fileName] = [arguments[1] ?? null, arguments[3] ?? null];
let isRedisStoreLoaded = false;

const server = net.createServer((socket) => {
    // console.log(`Client connected: ${socket.remoteAddress}:${socket.remotePort}`);

    socket.on('data', (data) => {
        const commandArray = parseCommand(data.toString());
        const command = commandArray[0];
        // console.log({commandArray});
        if (command && command.toLowerCase() == 'echo') {
            const arg1 = commandArray[1];
            const response = parseResponse('bulkString', arg1);

            socket.write(response);
        }
        else if (command && command.toLowerCase() == 'set') {
            const key = commandArray[1];
            const value = commandArray[2];
            const flag = commandArray[3] ? commandArray[3] : '';
            const expiryInSec = commandArray[4] ? commandArray[4] : '';

            redisStore[key] = { value };
            if (flag.toLowerCase() == 'px' && expiryInSec) {
                redisStore[key].expiry = moment().add(expiryInSec, 'milliseconds').valueOf();
            }
            socket.write('+OK\r\n');
        }
        else if (command && command.toLowerCase() == 'get') {

            if(fileDir && fileName && !isRedisStoreLoaded){
                parseDumpRDBFile(path.join(fileDir, fileName));
            }

            const key = commandArray[1];

            const value = redisStore[key] ? redisStore[key].value : '';
            const expiry = redisStore[key] ? redisStore[key].expiry : '';

            if (value && (expiry ? expiry > moment().valueOf() : true)) {
                const response = parseResponse('bulkString', value);
                socket.write(response);
            }
            else
                socket.write('$-1\r\n');

        }
        else if (command && command.toLowerCase() == 'config') {
            // 2 config commands allowed - 
            const arg1 = commandArray[1];
            const arg2 = commandArray[2];

            if (arg1.toLowerCase() == 'get' && arg2) {
                if (arg2.toLowerCase() == 'dir') {
                    // response will be an array => [dir, /tmp/redis-data]
                    socket.write(parseResponse('bulkStringArray', ['dir', fileDir]));
                }
                else if (arg2.toLowerCase() == 'dbfilename') {
                    // response will be an array => [dbfilename, dump.rdb]
                    socket.write(parseResponse('bulkStringArray', ['dbfilename', fileName]));
                }
                else
                    socket.write('$-1\r\n');
            }
            else {
                socket.write('$-1\r\n');
            }
        }
        else if (command && command.toLowerCase() == 'keys') {
            const arg1 = commandArray[1];
            if (arg1 == "*") {
                // read all keys from RDB dump 
                parseDumpRDBFile(path.join(fileDir, fileName));
                const response = parseResponse('bulkStringArray', Object.keys(redisStore))
                socket.write(response);
            }
            else socket.write('+PONG\r\n');
        }
        else {
            // Assume it will be PING command 
            socket.write('+PONG\r\n');
        }

    })

})


server.listen(port, host, () => {
});

const parseCommand = (command) => {
    const commandArray = command.split('\r\n');
    const finalArray = [];

    if (commandArray[0].includes('*')) {
        // command is an array 
        for (let i = 1; i < commandArray.length; i += 2) {
            const element = commandArray[i + 1];
            if (element)
                finalArray.push(element);
        }
    }

    return finalArray
}

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

const parseDumpRDBFile = (filePath) => {
    // console.log(filePath);
    const fileBuffer = fs.readFileSync(filePath);
    const fileContent = fileBuffer.toString('hex');
    // console.log(fileBuffer, fileContent);

    let remainingFileContent = fileContent;

    // Extract Header Section - fixed length = 18 bytes
    // contains the magic string (10 bytes) followed by version number (8 bytes)
    const headerString = remainingFileContent.slice(0, 18);
    remainingFileContent = remainingFileContent.slice(18);
    // console.log({headerString, remainingFileContent});

    // Extract EOF Section
    // const eofStringIndex = remainingFileContent.indexOf('ff');
    // const eofString = remainingFileContent.substring(eofStringIndex);
    // remainingFileContent = remainingFileContent.slice(0, remainingFileContent.length - eofString.length)
    // console.log({eofString, remainingFileContent});

    // Extract Database Section
    const databaseStartIndex = remainingFileContent.indexOf('fe');
    const databaseString = remainingFileContent.slice(databaseStartIndex);
    remainingFileContent = remainingFileContent.slice(0, databaseStartIndex);
    // console.log({databaseString, remainingFileContent});

    // OP code FE marks as DB  beginning, with next two bytes telling the db no
    const db = `${databaseString[2]}${databaseString[3]}`;
    // console.log({dbNumber: db});
    // OP code fb tells hashtable size, followed by next two bits telling keys with expiry
    const fbIndex = databaseString.indexOf('fb');
    const hashTableSize = `${databaseString[fbIndex + 2]}${databaseString[fbIndex + 3]}`
    const keysWithExpiry = `${databaseString[fbIndex + 4]}${databaseString[fbIndex + 5]}`;
    // console.log({ hashTableSize, keysWithExpiry });
    let remainingDBString = databaseString.slice(fbIndex + 6);
    // console.log({enties: remainingDBString});

    let counter = parseInt(hashTableSize, 'hex');
    while (counter--) {
        const entryType = `${remainingDBString[0]}${remainingDBString[1]}`
        // remainingDBString = remainingDBString.slice(2);
        // console.log({entryType, remainingDBString});
        if(entryType == 'ff'){
            // EOF file section reached
            remainingDBString = '';
            continue;
        }

        let key = '';
        let value = '';
        let expiry = '';

        if (entryType == 'fc') {
            // key will contain expiry - first 16 cahracters will eb timestamp
            expiry = remainingDBString.slice(2, 18);
            remainingDBString = remainingDBString.slice(18);

            // console.log({afterExpiry: remainingDBString});
        }

        /**
         * Now format will be 
         * 00 // value data-type always 00  
         * keySize(2 char) <followed by keysize*2 length key>
         * <value size (2 char)> <followed by value*2 length value>
         */
        let currIndex = 0;

        // ignore 0,1 as it will be 00
        currIndex = 2;

        //key size will be at index 2&3
        const keySize = parseInt(`${remainingDBString[currIndex]}${remainingDBString[currIndex + 1]}`, 16) // 16 means it is hex represnetaion, convert it to decimal
        // key will be from index currIndex = 4 to keySize *2 + currIndex
        currIndex = 4;
        key = remainingDBString.slice(currIndex, currIndex + (keySize * 2));

        // value size
        currIndex += keySize * 2;
        let valueSize = `${remainingDBString[currIndex]}${remainingDBString[currIndex + 1]}`;
        let isValueString = false;
        if (valueSize == 'c0') valueSize = 1; // *2 will be done in next step
        else if (valueSize == 'c1') valueSize = 2;
        else if (valueSize == 'c2') valueSize = 4;
        else {
            isValueString = true;
            valueSize = parseInt(valueSize, 'hex')
        };

        // value
        currIndex += 2;
        value = remainingDBString.slice(currIndex, currIndex + (valueSize * 2));

        currIndex += valueSize * 2;
        remainingDBString = remainingDBString.slice(currIndex);

        // console.log({ key, keySize, value, valueSize, currIndex, expiry, remainingDBString });
        // get actual key, value, expiry 
        key = hexToASCII(key);
        if (isValueString)
            value = hexToASCII(value);
        else {
            const buffer = Buffer.from(value, 'hex'); // Create a buffer from the hex string
            const result = buffer.readUInt16LE(0); // Read the value at offset 0 
            value = result;
        }
        if (expiry) {
            const buffer = Buffer.from(expiry, 'hex'); // Create a buffer from the hex string

            const result = buffer.readBigUInt64LE(0); // Read the value at offset 0
            expiry = result;
            expiry = expiry.toString();
        }
        // value = parseInt(value, 16) // value is in hexadecimal format
        redisStore[key] = { value, expiry }

        // return;

    }
    // console.log(redisStore);

    // Extract Metadata Section
    // Now remaining file only contains metadata key-value pairs which starts with fa
    const metaDataEntries = remainingFileContent.split('fa');
    // console.log({metaDataEntries});


}

const hexToASCII = (hexString) => {
    let asciiString = '';
    for (let i = 0; i < hexString.length; i += 2) {
        // convert hex to decimal 
        const decimal = parseInt(`${hexString[i]}${hexString[i + 1]}`, 16)
        // convert decimal to ascii
        const str = String.fromCharCode(decimal);
        asciiString += str;
    }
    return asciiString;
}

/**
 * Connect with this server using netcat in another terminal
 * nc 127.0.0.1 6379 
 * send msgs 
 * Disconnect with server with ctrl+c
 * 
 * Run redis-cli locally and test for parsing your command and response. 
**/
