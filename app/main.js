const net = require('net')

const port = 6379;
const host = '127.0.0.1'

const server = net.createServer((socket) => {
    socket.on('data', (data) => {

        socket.write('+PONG\r\n');
    })
  
})


server.listen(port, host, () => {
});

/**
 * Connect with this server using netcat in another terminal
 * nc 127.0.0.1 6379 
 * send msgs 
 * Disconnect with server with ctrl+c
 */