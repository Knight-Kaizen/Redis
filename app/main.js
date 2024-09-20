const net = require('net');
const moment = require('moment-timezone')

const port = 6379;
const host = '127.0.0.1'

const keyValueMapping = {
    // key: { value: 34, expiry: UNIX } // Format for storing keys and values 
};

const server = net.createServer((socket) => {
    // console.log(`Client connected: ${socket.remoteAddress}:${socket.remotePort}`);

    socket.on('data', (data) => {
        const commandArray = parseCommand(data.toString());
        const command = commandArray[0];

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

            keyValueMapping[key] = { value };
            if (flag.toLowerCase() == 'px' && expiryInSec) {
                keyValueMapping[key].expiry = moment().add(expiryInSec, 'milliseconds').unix();
            }
            socket.write('+OK\r\n');
        }
        else if (command && command.toLowerCase() == 'get') {
            const key = commandArray[1];

            const value = keyValueMapping[key] ? keyValueMapping[key].value : '';
            const expiry = keyValueMapping[key] ? keyValueMapping[key].expiry : '';

            if (value && (expiry ? expiry > moment().unix() : true)) {
                const response = parseResponse('bulkString', value);
                socket.write(response);
            }
            else
                socket.write('$-1\r\n');

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
}
/**
 * Connect with this server using netcat in another terminal
 * nc 127.0.0.1 6379 
 * send msgs 
 * Disconnect with server with ctrl+c
 * 
 * Run redis-cli locally and test for parsing your command and response. 
**/
