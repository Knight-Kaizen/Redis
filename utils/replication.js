const net = require('net');
const { parseResponse } = require('./commands');

const client = new net.Socket();

const sendHandshake = (flagsAndValues)=>{
    if(flagsAndValues.replicaof){
        // running as a replica 
        const masterHost = flagsAndValues.replicaof.split(' ')[0];
        const masterPort = flagsAndValues.replicaof.split(' ')[1];

        // Handshake 1: Send PING command to master
        client.connect(masterPort, masterHost, function() {
            
            const command = parseResponse('bulkStringArray', ['PING'])
            // console.log('sending ping command');
            client.write(command);
        });

    }

}

module.exports = {
    sendHandshake
}