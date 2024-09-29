const net = require('net');
const fs = require('fs');
const path = require('path')
const { handleEchoCommand, handleSetCommand, handleGetCommand, handleConfigCommand, handleKeysCommand, handlePingCommand, loadRedisStore, handleInfoCommand, handleReplConfCommand, handlePsyncCommand, handleFullResyncCommand, handleWaitCommand, parseResponse, handleTypeCommand, handleXaddCommand, handleXRangeCommand, handleXReadCommand, handleXReadCommandWithReadBlocking, handleIncrCommand } = require('../utils/commands');
const { sendHandshake } = require('../utils/replication');

let port = 6379; // default
const host = '127.0.0.1'

const flagsAndValues = { // It will contain all the supported flags, and values will be updated if any flag is passed in arguments. 
    // --port flag will be passed if server to be run dynamic port
    port: null,
    fileDir: null,
    fileName: null,
    // If server runs in replica mode, master host & port will be passed
    replicaof: null
};

const queuedCommands = { // multi and exec commands store 
    // port : [commands1, commands2 ] 
}

const arguments = process.argv.slice(2);
for (let i = 0; i < arguments.length; i += 2) {
    const flag = arguments[i].split('--')[1];
    flagsAndValues[flag] = arguments[i + 1]
}

// If port flag comes, use dynamic port
if (flagsAndValues.port)
    port = flagsAndValues.port

// If this is replica server, connect to master
if (flagsAndValues.replicaof) {
    sendHandshake(flagsAndValues);
}

const [fileDir, fileName] = [arguments[1] ?? null, arguments[3] ?? null];
let isRedisStoreLoaded = false;

// save all slave connection 
const connectedSlaves = [];

const sendWriteCommandsToSlaves = async (data) => {

    for (const slaveSocket of connectedSlaves) {
        slaveSocket.write(data);
    }
}

const sendGetAckCommandsToSlaves = () => {
    for (const slaveSocket of connectedSlaves) {
        const getAckCommand = parseResponse('bulkStringArray', ['REPLCONF', 'GETACK', '*'])
        slaveSocket.write(getAckCommand)
    }
}

const server = net.createServer((socket) => {
    console.log(`Client connected: ${socket.remoteAddress}:${socket.remotePort}`);

    socket.on('data', async (data) => {
        const commandArray = parseCommand(data.toString());
        let command = commandArray[0];
        if (command) command = command.toLowerCase(); // commands are case insensitive in redis
        console.log({ commandArray });

        // If rdb file exists, load redis store
        if (fileDir && fileName && !isRedisStoreLoaded) {
            // Load store if file exist
            if (fs.existsSync(fileDir) && fs.existsSync(path.join(fileDir, fileName)))
                loadRedisStore(fileDir, fileName);
        }

        // if(flagsAndValues.replicaof){
        //     // Log all data received by slave
        //     console.log('Slave received this - ', data, data.toString(), commandArray);
        // }

        if (queuedCommands[socket.remotePort] && command != 'exec') { // If queue exists, queue all commands until exec comes
            queuedCommands[socket.remotePort].push(data);
            socket.write('+QUEUED\r\n');
            return;
        }


        let response = [];
        switch (command) {
            case 'echo':
                response = handleEchoCommand(commandArray);
                break;

            case 'set':
                response = handleSetCommand(commandArray, socket);
                sendWriteCommandsToSlaves(data);
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

            case 'info':
                response = handleInfoCommand(commandArray, flagsAndValues, connectedSlaves);
                break;

            // This is internal command, sent only by the slaves for handshake step 1
            case 'replconf':
                response = handleReplConfCommand(commandArray, 0, socket);
                break;

            // Handshake step 2 
            case 'psync':
                response = handlePsyncCommand(commandArray);
                connectedSlaves.push(socket);
                break;

            case 'fullresync':
                handleFullResyncCommand(commandArray);
                break;

            case 'wait':
                sendGetAckCommandsToSlaves();
                response = await handleWaitCommand(commandArray, connectedSlaves.length);
                break;

            case 'type':
                response = handleTypeCommand(commandArray);
                break;

            case 'xadd':
                response = handleXaddCommand(commandArray);
                break;

            case 'xrange':
                response = handleXRangeCommand(commandArray);
                break;

            case 'xread':
                if (commandArray[1].toLowerCase() == 'block')
                    handleXReadCommandWithReadBlocking(commandArray, socket);
                else
                    response = handleXReadCommand(commandArray);
                break;

            case 'incr':
                response = handleIncrCommand(commandArray);
                break;

            case 'multi':
                queuedCommands[socket.remotePort] = []; // init a queue command
                response = ['+OK\r\n'];
                break;

            case 'exec':
                if (queuedCommands[socket.remotePort]) {
                    if (!queuedCommands[socket.remotePort].length) // No queued commands avaialble
                        response = ['*0\r\n']; // empty array

                    for (const queuedCommand of queuedCommands[socket.remotePort])
                        socket.write(queuedCommand);
                    delete queuedCommands[socket.remotePort];
                }
                else
                    response = ['-ERR EXEC without MULTI\r\n'];
                break;

            default:
                response = `-ERR unknown command '${command}'\r\n`;
        }

        if (response) {
            for (const resp of response)
                socket.write(resp);
        }


    })

    socket.on('end', () => {
        console.log(`Client disconnected: ${socket.remoteAddress}:${socket.remotePort}`);

        // Remove the disconnected slave from the connectedSlaves array
        const index = connectedSlaves.indexOf(socket);
        if (index !== -1) {
            connectedSlaves.splice(index, 1);
            console.log(`Removed slave at ${socket.remoteAddress}:${socket.remotePort}`);
        }
    });

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
