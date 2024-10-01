// This will contain all help commands 

const { parseResponse } = require("./commands");

const echo = () => {
    const response = parseResponse('bulkStringArray', [
        'Command Format: ECHO <message>',
        'Outputs the given message',
        'Example',
        'ECHO Hello # Hello'

    ])
    return [response];
};

const set = () => {
    const response = parseResponse('bulkStringArray', [
        'Command Format: SET <key> <value> [PX milliseconds]',
        'Sets the value of a key with an optional expiration time.',
        'Example:',
        'SET mykey Hello',
        'SET mykey Hello PX 5000'
    ]);
    return [response];
};

const get = () => {
    const response = parseResponse('bulkStringArray', [
        'Command Format: GET <key>',
        'Gets the value of the specified key.',
        'Example:',
        'GET mykey'
    ]);
    return [response];
};

const keys = () => {
    const response = parseResponse('bulkStringArray', [
        'Command Format: KEYS <pattern>',
        'Finds all keys',
        'Example:',
        'KEYS *'
    ]);
    return [response];
};

const ping = () => {
    const response = parseResponse('bulkStringArray', [
        'Command Format: PING',
        'Checks the connection with the server.',
        'Example:',
        'PING'
    ]);
    return [response];
};

const info = () => {
    return parseResponse('bulkStringArray', [
        'Command Format: INFO <section>',
        'Displays information and statistics about the server.',
        'Sections:',
        ' - replication: Shows the server role (master/slave) and number of connected slaves.',
        'Example:',
        'INFO replication',
    ]);
};

const config = () => {
    return parseResponse('bulkStringArray', [
        'Command Format: CONFIG GET <parameter>',
        'Returns the value of a configuration parameter like `dir` or `dbfilename`.',
        'Parameters:',
        ' - dir: Path to the directory where the RDB file is stored. Example: `/tmp/redis-data`',
        ' - dbfilename: Name of the RDB file. Example: `rdbfile`',
        'Example:',
        'CONFIG GET dir',
        'CONFIG GET dbfilename'
    ]);
};

module.exports = {
    echo,
    set,
    get,
    config,
    keys,
    ping,
    info
}