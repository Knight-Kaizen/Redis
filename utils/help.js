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

module.exports = {
    echo
}