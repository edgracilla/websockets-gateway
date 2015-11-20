# Websockets Gateway

[![Build Status](https://travis-ci.org/Reekoh/websockets-channel.svg)](https://travis-ci.org/Reekoh/websockets-channel)
![Dependencies](https://img.shields.io/david/Reekoh/websockets-channel.svg)
![Dependencies](https://img.shields.io/david/dev/Reekoh/websockets-channel.svg)
![Built With](https://img.shields.io/badge/built%20with-gulp-red.svg)

Vanilla Websockets Gateway for the Reekoh IoT Platform. Allows hardware devices to connect to a Reekoh instance to communicate and send data via the Websocket Protocol.

## Assumptions

1. Devices connect to the internet via Websockets Protocol.
2. Devices send data in JSON format.

## Configuration Parameters

1. Data Event - The type of event to denote that the incoming data is a sensor-generated data.
2. Message Event - The type of event to denote that the incoming data is a command or message for another device in the topology.
3. Group Message Event - The type of event to denote that the incoming data is a command or message for a group of devices in the topology.

## Sample Data

__Data__

```javascript
{
    "device": "567827489028375" // required - Corresponds a device registered in the platform
    "type": "data" // required - Corresponds to the data event you've specified in the configuration
    "co2": "11%" // sensor data
    "o2": "20%", // sensor data
    "air_quality": "normal" // sensor data
}
```

__Message__

```javascript
{
    "device": "567827489028375" // required - Corresponds a device registered in the platform
    "type": "message" // required - Corresponds to the message event you've specified in the configuration
    "target": "567827489028376" // required - The device to send the data to
    "message": "activate", // required - The message or command to send to the device
}
```

__Group Message__

```javascript
{
    "device": "567827489028375" // required - Corresponds a device registered in the platform
    "type": "message" // required - Corresponds to the message event you've specified in the configuration
    "target": "Air Conditioners" // required - The name of the group to send the data to
    "message": "activate", // required - The message or command to send to the group
}
```