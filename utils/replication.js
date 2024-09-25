const net = require('net');
const { parseResponse, handleSetCommand, handleReplConfCommand, handlePingCommand } = require('./commands');

const client = new net.Socket();
let isHandshakeDone = false;
let dataReceivedByteCount = 0; // should count all the data received after handshake is done

const sendHandshake = (flagsAndValues) => {
    if (flagsAndValues.replicaof) {
        // running as a replica 
        const masterHost = flagsAndValues.replicaof.split(' ')[0];
        const masterPort = flagsAndValues.replicaof.split(' ')[1];


        client.connect(masterPort, masterHost, function () {
            console.log('connected to master');

            // Handshake step 1: Send PING command to master
            const ping = parseResponse('bulkStringArray', ['PING'])
            client.write(ping);

            // Wait for response, and once response received, send handshake step 2 commands
        });

        // Handle data received from the server
        client.on('data', function (data) {
            if (isHandshakeDone) {
                // master will send regular write commands, and periodically REPLCONF GETACK command 

                const commandArrays = parseCommand(data.toString());

                commandArrays.forEach((commandArray) => {
                    // These commands are sent by master and dont expect reply
                    if (commandArray.length) {
                        let response = [];
                        const command = commandArray[0].toLowerCase();
                        switch (command) {
                            case 'set':
                                handleSetCommand(commandArray);
                                break;
                            case 'replconf':
                                response = handleReplConfCommand(commandArray, dataReceivedByteCount);
                                break;
                            case 'ping':
                                parseResponse('bulkStringArray', ['PING']);
                                break;
                            default:
                                response = [`-ERR unknown command '${command}'\r\n`];
                        }
                        for (const resp of response)
                            client.write(resp);

                        // count data received after current command is responded
                        // byte should be counted of resp formatted commands.  
                        const respCommand = parseResponse('bulkStringArray', commandArray);
                        dataReceivedByteCount += respCommand.length;
                    }
                })

            }
            else {
                // handshake continues here ...
                data = data.toString();

                // Handshake step 2: Send REPLCONF command if received +PONG
                if (data.includes('PONG')) {
                    // The REPLCONF command is used to configure replication. Replicas will send this command to the master twice

                    // notifying the master of the port it's listening on
                    const replconf1 = parseResponse('bulkStringArray', ['REPLCONF', 'listening-port', flagsAndValues.port])
                    client.write(replconf1);

                    // replica notifying the master of its capabilities ("capa" is short for "capabilities")
                    const replconf2 = parseResponse('bulkStringArray', ['REPLCONF', 'capa', 'psync2'])  // hardcoding capabilities for now
                    client.write(replconf2);

                }

                // Handshake step 3: Send PSYNC command
                // The PSYNC command is used to synchronize the state of the replica with the master.
                if (data.includes('OK')) {
                    // Since this is the first time the replica is connecting to the master, the replication ID will be ? (a question mark)
                    const replicationID = '?' // asking the replication id of master
                    // Since this is the first time the replica is connecting to the master, the offset will be -1
                    const offset = '-1'; // means it has recieved -1 byte of data

                    const psync = parseResponse('bulkStringArray', ['PSYNC', replicationID, offset])
                    client.write(psync);

                    // mark handshake done 
                    isHandshakeDone = true;

                }
            }

        });

        client.on('error', (err) => {
            console.log(err);
        })
    }

}

const parseCommand = (command) => {
    const commandArray = command.split('\r\n');

    const finalArray = [];
    // command can have multiple commands 
    for (let i = 0; i < commandArray.length; i++) {
        const command = commandArray[i].toLowerCase();
        const array = [];
        if (command == 'set' || command == 'replconf') {
            // will have 2 arguments, key and value 
            array.push(command); // command
            array.push(commandArray[i + 2].toLowerCase()); // key
            array.push(commandArray[i + 4].toLowerCase()); // value

            i += 4;
        }
        else if (command == 'ping') {
            array.push(command);
        }

        if (array.length)
            finalArray.push(array);
    }

    // console.log(finalArray);
    return finalArray
}


module.exports = {
    sendHandshake
}