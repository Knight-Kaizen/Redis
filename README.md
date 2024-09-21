
# Redis Server Implementation in Node.js

## Overview

This project demonstrates a simplified Redis server implemented in Node.js. It features custom command handlers like `GET`, `SET`, `ECHO`, `PING`, `CONFIG`, and `KEYS`, while also supporting RDB (Redis Database) file parsing. The server mimics basic Redis functionalities and can interact with `redis-cli`.

## Features

- **Supported Commands**: Core Redis commands are implemented using the RESP protocol, including `ECHO`, `SET`, `GET`, `CONFIG`, `KEYS`, and `PING`.
- **RDB Parsing**: Parses and loads key-value pairs, along with expiry times, from an `.rdb` file.
- **Custom Redis Store**: Emulates in-memory data storage like Redis, supporting basic `SET` and `GET` operations.
- **Key Expiry Handling**: Supports key expiry when using the `PX` (milliseconds) flag with the `SET` command.

## Commands Supported

1. **ECHO**: Returns the same string sent as input.
   - Example: `ECHO "Hello World"`
  
2. **SET**: Stores a key-value pair with an optional expiry in milliseconds.
   - Example: `SET key value [PX expiry_in_ms]`
   
3. **GET**: Retrieves the value of a key.
   - Example: `GET key`
   
4. **PING**: Responds with `PONG`.
   - Example: `PING`
   
5. **CONFIG GET**: Retrieves the server's configuration values (e.g., `dir`, `dbfilename`).
   - Example: `CONFIG GET dir`
   
6. **KEYS**: Lists all keys stored in the Redis server.
   - Example: `KEYS *`
  
## Setup Instructions

### 1. Clone the Repository:

```bash
git clone https://github.com/your-repo/redis-node-server.git
cd redis-node-server
```

### 2. Install Dependencies:

```bash
npm install
```

### 3. Run the Server:

To start the server, use the following command:

```bash
node app/main.js [--dir /path/to/rdb --dbfilename dump.rdb]
```

- Both `--dir` and `--dbfilename` are optional. Use them to test RDB file parsing.
- `--dir`: Specifies the directory where the RDB file is located.
- `--dbfilename`: Specifies the RDB file name (e.g., `dump.rdb`).

Example:

```bash
node app/main.js --dir ./path/to/rdb --dbfilename dump.rdb
```

### 4. Using the Redis CLI:

In another terminal, connect to the server using `redis-cli`:

```bash
redis-cli -h 127.0.0.1 -p 6379
```

Once connected, you can use Redis commands such as `SET`, `GET`, `ECHO`, etc.

Example commands:

```bash
SET mykey "Hello"
GET mykey
PING
```

### 5. Testing with RDB File Parsing

You can test RDB file parsing by using the pre-existing `.rdb` files in the `testingDumps` directory. Explanations for these files are provided in the accompanying `.txt` files. To load the data, simply run the following command:

```bash
node app/main.js --dir ./testingDumps --dbfilename testDump.rdb
```
#### NOTE: In the `commands.js` file, modify this line:

```javascript
const devENV = (fileDir == './your-directory-name' && fileName == 'your-dump.rdb-name') ? true : false;
```

This will load the keys and values from the specified RDB file, allowing you to interact with them using commands like `GET`, `KEYS`, and others.

## Project Structure

- **app/main.js**: The entry point of the server, managing client connections.
- **utils/commands.js**: Handles the logic for Redis command execution, such as `SET`, `GET`, `PING`, etc.
- **utils/rdbParser.js**: Responsible for parsing RDB files and loading data into the Redis store.

## Example Commands

```bash
SET key1 "value1"
GET key1
PING
ECHO "Hello World"
CONFIG GET dir
KEYS *
```

## To-Do

1. Implement `HGET`, `HGETALL`, and `HSET` commands to add support for Redis hash data structures.
2. Implement the `SAVE` command to allow saving the in-memory Redis store to an RDB file.

