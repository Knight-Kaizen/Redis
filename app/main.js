const net = require('net')

const port = 6379;
const host = '127.0.0.1'

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
        const arrayLength = commandArray[0].slice(1);

        for (let i = 0; i < commandArray.length; i += parseInt(arrayLength)) {
            const element = commandArray[i + parseInt(arrayLength)];
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
// *2\r\n$4\r\nEChO\r\n$6\r\nbanana\r\n */
