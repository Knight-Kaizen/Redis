const net = require('net');
const fs = require('fs');
const path = require('path')
const { handleEchoCommand, handleSetCommand, handleGetCommand, handleConfigCommand, handleKeysCommand, handlePingCommand, loadRedisStore } = require('../utils/commands');

let port = 6379; // default
const host = '127.0.0.1'

const arguments = process.argv.slice(2);

// If port flag comes, use dynamic port
if(arguments && arguments[0] == '--port')
    port = arguments[1];

const [fileDir, fileName] = [arguments[1] ?? null, arguments[3] ?? null];
let isRedisStoreLoaded = false;

const server = net.createServer((socket) => {
    console.log(`Client connected: ${socket.remoteAddress}:${socket.remotePort}`);

    socket.on('data', (data) => {
        const commandArray = parseCommand(data.toString());
        let command = commandArray[0];
        if(command) command = command.toLowerCase(); // commands are sace insensitive in redis
        // console.log({commandArray});

        // If rdb file exists, load redis store
        if(fileDir && fileName && !isRedisStoreLoaded){
            // Load store if file exist
            if(fs.existsSync(fileDir) && fs.existsSync(path.join(fileDir, fileName)))
                loadRedisStore(fileDir, fileName);
        }
           

        let response = '$-1\r\n';
        switch (command) {
            case 'echo':
                response = handleEchoCommand(commandArray);
            break;
            case 'set':
                response = handleSetCommand(commandArray);
                break;

            case 'get':
                response = handleGetCommand(commandArray);
                break;

            case 'config':
                response = handleConfigCommand(commandArray, fileDir, fileName);
                break;

            case 'keys':
                response = handleKeysCommand(commandArray);
                break;

            case 'ping':
                response = handlePingCommand();
                break;

            default:
                response = `-ERR unknown command '${command}'\r\n`;
        }

        socket.write(response);

    })

})


server.listen(port, host, () => {
    console.log('Redis Server running on ', port);
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
