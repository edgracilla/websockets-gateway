'use strict';

var async    = require('async'),
	isEmpty  = require('lodash.isempty'),
	platform = require('./platform'),
	clients  = {},
	server, port;

/**
 * Emitted when a message or command is received from the platform.
 * @param {object} message The message metadata
 */
platform.on('message', function (message) {
	if (clients[message.device]) {
		clients[message.device].send(`${message.message}\n`, (error) => {
			if (error)
				platform.handleException(error);
			else {
				platform.sendMessageResponse(message.messageId, 'Message Sent');
				platform.log(JSON.stringify({
					title: 'Message Sent',
					device: message.device,
					messageId: message.messageId,
					message: message.message
				}));
			}
		});
	}
});

/**
 * Emitted when the platform shuts down the plugin. The Gateway should perform cleanup of the resources on this topic.
 */
platform.once('close', function () {
	let d = require('domain').create();

	d.once('error', function (error) {
		console.error(`Error closing WS Gateway on port ${port}`, error);
		platform.handleException(error);
		platform.notifyClose();
		d.exit();
	});

	d.run(function () {
		server.close(() => {
			platform.log(`Websocket Gateway closed on port ${port}`);
			platform.notifyClose();
			d.exit();
		});
	});
});

/**
 * Emitted when the platform bootstraps the plugin. The plugin should listen once and execute its init process.
 * Afterwards, platform.notifyReady() should be called to notify the platform that the init process is done.
 * @param {object} options The parameters or options. Specified through config.json. Gateways will always have port as option.
 */
platform.once('ready', function (options) {
	let config = require('./config.json');

	let WebSocketServer = require('ws').Server;

	let dataTopic         = options.data_topic || config.data_topic.default,
		messageTopic      = options.message_topic || config.message_topic.default,
		groupMessageTopic = options.groupmessage_topic || config.groupmessage_topic.default;

	port = options.port;
	server = new WebSocketServer({
		port: options.port
	});

	server.once('error', (error) => {
		console.error('Websocket Gateway Error', error);
		platform.handleException(error);

		setTimeout(() => {
			server.close(() => {
				platform.log(`Websocket Gateway closed on port ${port}`);
				server.removeAllListeners();
				process.exit();
			});
		}, 5000);
	});

	server.once('listening', () => {
		platform.log(`Websocket Gateway initialized on port ${port}`);
		platform.notifyReady();
	});

	server.on('connection', (socket) => {
		socket.on('error', (error) => {
			console.error(error);
			platform.handleException(error);
		});

		socket.once('close', () => {
			if (socket.device) platform.notifyDisconnection(socket.device);

			setTimeout(() => {
				socket.removeAllListeners();
			}, 5000);
		});

		socket.on('message', (message) => {
			async.waterfall([
				async.constant(message || '{}'),
				async.asyncify(JSON.parse)
			], (error, obj) => {
				if (error || isEmpty(obj.topic) || isEmpty(obj.device)) {
					platform.handleException(new Error('Invalid data sent. Must be a valid JSON String with a "topic" field and a "device" field which corresponds to a registered Device ID.'));
					return socket.close(1003, 'Invalid data sent. Must be a valid JSON String with a "topic" field and a "device" field.\n');
				}

				if (isEmpty(clients[obj.device])) {
					platform.notifyConnection(obj.device);
					socket.device = obj.device;
					clients[obj.device] = socket;
				}

				platform.requestDeviceInfo(obj.device, (error, requestId) => {
					platform.once(requestId, (deviceInfo) => {
						if (isEmpty(deviceInfo)) {
							platform.log(JSON.stringify({
								title: 'WS Gateway - Access Denied. Unauthorized Device',
								device: obj.device
							}));

							return socket.close(1003, `Device not registered. Device ID: ${obj.device}\n`);
						}

						if (obj.topic === dataTopic) {
							platform.processData(obj.device, message);

							platform.log(JSON.stringify({
								title: 'WS Gateway - Data Received.',
								device: obj.device,
								data: obj
							}));

							socket.send(`Data Received.`);
							//socket.send(`Data Received. Device ID: ${obj.device}. Data: ${message}\n`);
						}
						else if (obj.topic === messageTopic) {
							if (isEmpty(obj.target) || isEmpty(obj.message)) {
								platform.handleException(new Error('Invalid message or command. Message must be a valid JSON String with "target" and "message" fields. "target" is the a registered Device ID. "message" is the payload.'));
								return socket.send('Invalid message or command. Message must be a valid JSON String with "target" and "message" fields. "target" is the a registered Device ID. "message" is the payload.');
							}

							platform.sendMessageToDevice(obj.target, obj.message);

							platform.log(JSON.stringify({
								title: 'WS Gateway - Message Received.',
								source: obj.device,
								target: obj.target,
								message: obj.message
							}));

							socket.send(`Message Received. Device ID: ${obj.device}. Message: ${message}\n`);
						}
						else if (obj.topic === groupMessageTopic) {
							if (isEmpty(obj.target) || isEmpty(obj.message)) {
								platform.handleException(new Error('Invalid group message or command. Message must be a valid JSON String with "target" and "message" fields. "target" is the the group id or name. "message" is the payload.'));
								return socket.send('Invalid group message or command. Message must be a valid JSON String with "target" and "message" fields. "target" is the the group id or name. "message" is the payload.');
							}

							platform.sendMessageToGroup(obj.target, obj.message);

							platform.log(JSON.stringify({
								title: 'WS Gateway - Group Message Received.',
								source: obj.device,
								target: obj.target,
								message: obj.message
							}));

							socket.send(`Group Message Received. Device ID: ${obj.device}. Message: ${message}\n`);
						}
						else {
							platform.handleException(new Error(`Invalid topic specified. Topic: ${obj.topic}`));
							socket.close(1003, `Invalid topic specified. Topic: ${obj.topic}\n`);
						}
					});
				});
			});
		});
	});
});