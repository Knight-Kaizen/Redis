const net = require('net');
const { parseResponse } = require('./commands');

const client = new net.Socket();

const sendHandshake = (flagsAndValues) => {
    if (flagsAndValues.replicaof) {
        // running as a replica 
        const masterHost = flagsAndValues.replicaof.split(' ')[0];
        const masterPort = flagsAndValues.replicaof.split(' ')[1];


        client.connect(masterPort, masterHost, function () {
            // console.log('connected to master');

            // Handshake step 1: Send PING command to master
            const ping = parseResponse('bulkStringArray', ['PING'])
            client.write(ping);

            // Wait for response, and once response received, send handshake step 2 commands
        });

        // Handle data received from the server
        client.on('data', function (data) {
            // console.log('Received: ' + data);

            // Handshake step 2: Send REPLCONF command
            // The REPLCONF command is used to configure replication. Replicas will send this command to the master twice

            // notifying the master of the port it's listening on
            const replconf1 = parseResponse('bulkStringArray', ['REPLCONF', 'listening-port', flagsAndValues.port])
            client.write(replconf1);

            // replica notifying the master of its capabilities ("capa" is short for "capabilities")
            const replconf2 = parseResponse('bulkStringArray', ['REPLCONF', 'capa', 'psync2'])  // hardcoding capabilities for now
            client.write(replconf2);
        });

    }

}

module.exports = {
    sendHandshake
}