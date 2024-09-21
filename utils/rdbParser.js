const fs = require('fs')

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

const rdbParser = (filePath, devENV) => {
    const parsedRDB = {
        redisStore: {}
    };

    const fileBuffer = fs.readFileSync(filePath);

    const fileContent = devENV ? fileBuffer.toString(): fileBuffer.toString('hex');

    let currPtr = 0;

    // Extract Headers - 18 bytes size
    let header = fileContent.substring(0, 18);
    parsedRDB['header'] = hexToASCII(header)

    currPtr = header.length;

    // Extract metadata 
    const dbStartIndex = fileContent.indexOf('fe');
    const metadata = fileContent.slice(currPtr, dbStartIndex);

    // Move to end of metadata 
    currPtr += metadata.length;


    // Extract DB 
    let db = `${fileContent[currPtr + 2]}${fileContent[currPtr + 3]}`
    db = parseInt(db, 16);

    parsedRDB['db'] = db;
    // Move to FB - hashTable size and keysWith Expiry
    currPtr += 4;

    const totalKeys = `${fileContent[currPtr + 2]}${fileContent[currPtr + 3]}`;
    const keysWithExpiry = `${fileContent[currPtr + 4]}${fileContent[currPtr + 5]}`
    parsedRDB['keysWithExpiry'] = parseInt(keysWithExpiry, 16)
    // Move to keys
    currPtr += 6;
    // console.log({totalKeys, keysWithExpiry});

    for (let i = 0; i < totalKeys; i++) {
        let key = '';
        let value = '';
        let expiry = '';

        if (`${fileContent[currPtr]}${fileContent[currPtr + 1]}` == 'fc') {
            // this is key with expiry - expiry is byte - 16 chars

            // Move to start of expiry timestamp
            currPtr += 2;
            expiry = fileContent.substring(currPtr, currPtr + 16)

            const buffer = Buffer.from(expiry, 'hex'); // Create a buffer from the hex string

            const result = buffer.readBigUInt64LE(0); // Read the value at offset 0
            expiry = result;
            expiry = expiry.toString();

            // move to end of expiry
            currPtr += 16
        }

        // skip 00 
        currPtr += 2;

        const keySize = parseInt(`${fileContent[currPtr]}${fileContent[currPtr + 1]}`, 16) // 16 means it is hex represnetaion, convert it to decimal
        // Move to starting of key
        currPtr += 2;
        key = fileContent.substring(currPtr, keySize * 2 + currPtr);
        key = hexToASCII(key);

        // Move to starting of value size 
        currPtr += keySize * 2;
        let valueSize = `${fileContent[currPtr]}${fileContent[currPtr + 1]}`;

        // Move to starting of value 
        currPtr += 2;

        if (valueSize == 'c0' || valueSize == 'c1' || valueSize == 'c2') {
            // value size is in 8-bit signed integer, 1 byte = next 2 chars
            if (valueSize == 'c0') valueSize = 1;

            // 16-bit signed integer, 2 bytes = next 4 chars
            if (valueSize == 'c1') valueSize = 2;

            // 32-bit signed integer, 4 bytes = next 8 chars
            if (valueSize == 'c2') valueSize = 4;

            value = fileContent.substring(currPtr, currPtr + valueSize * 2);
            const buffer = Buffer.from(value, 'hex'); // Create a buffer from the hex string
            const result = buffer.readUInt16LE(0); // Read the value at offset 0 
            value = result;

            // Move to end of value
            currPtr += valueSize * 2;
        }
        else {
            valueSize = parseInt(valueSize, 16)
            // simple string encoding 
            value = fileContent.substring(currPtr, currPtr + valueSize * 2);
            value = hexToASCII(value)
            // Move to end of value
            currPtr += valueSize * 2;
        }
        // if(devENV)
        // console.log({
        //     i, key, valueSize, value, currPtr,
        //     nxt: fileContent[currPtr], nxt2: fileContent[currPtr+1],
        //     nxt8: fileContent.substring(currPtr)
        // });
        parsedRDB.redisStore[key] = { value, expiry };

    }
    // if(devENV)
    // console.log(JSON.stringify({parsedRDB}, null, 2));
    return parsedRDB

}



module.exports = {
    rdbParser
}