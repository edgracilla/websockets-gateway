'use strict';

var async             = require('async'),
	isEmpty           = require('lodash.isempty'),
	platform          = require('./platform'),
	devices           = {},
	clients           = {},
	authorizedDevices = {},
	server, port;

/**
 * Emitted when a message or command is received from the platform.
 * @param {object} message The message metadata
 */
platform.on('message', function (message) {
	if (clients[message.device]) {
		clients[message.device].send(message.message, (error) => {
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
 * Emitted when a new device is registered on the platform.
 * Lets the gateway know that a new registered device is added. Can be used to authorize device connections.
 * @param {object} device The details of the device registered on the platform represented as JSON Object.
 */
platform.on('adddevice', function (device) {
	if (!isEmpty(device) && !isEmpty(device._id)) {
		devices[device._id] = device;
		platform.log(`WS Gateway - Successfully added ${device._id} to the pool of authorized devices.`);
	}
	else
		platform.handleException(new Error(`Device data invalid. Device not added. ${device}`));
});

/**
 * Emitted when a device is removed or deleted from the platform. Can be used to authorize device connections.
 * @param {object} device The details of the device removed from the platform represented as JSON Object.
 */
platform.on('removedevice', function (device) {
	if (!isEmpty(device) && !isEmpty(device._id)) {
		delete devices[device._id];
		platform.log(`WS Gateway - Successfully removed ${device._id} from the pool of authorized devices.`);
	}
	else
		platform.handleException(new Error(`Device data invalid. Device not removed. ${device}`));
});

/**
 * Emitted when the platform shuts down the plugin. The Gateway should perform cleanup of the resources on this event.
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
		server.close();
		console.log(`WS Gateway closed on port ${port}`);
		platform.notifyClose();
		d.exit();
	});
});

/**
 * Emitted when the platform bootstraps the plugin. The plugin should listen once and execute its init process.
 * Afterwards, platform.notifyReady() should be called to notify the platform that the init process is done.
 * @param {object} options The parameters or options. Specified through config.json. Gateways will always have port as option.
 * @param {array} registeredDevices Collection of device objects registered on the platform.
 */
platform.once('ready', function (options, registeredDevices) {
	let keyBy  = require('lodash.keyby'),
		config = require('./config.json');

	let WebSocketServer = require('ws').Server;

	let dataEvent         = options.data_event || config.data_event.default,
		messageEvent      = options.message_event || config.message_event.default,
		groupMessageEvent = options.groupmessage_event || config.groupmessage_event.default;

	if (!isEmpty(registeredDevices))
		authorizedDevices = keyBy(registeredDevices, '_id');

	port = options.port;
	server = new WebSocketServer({
		port: options.port
	});

	server.on('error', (error) => {
		console.error(error);
		platform.handleException(error);
	});

	server.on('connection', (socket) => {
		socket.on('error', (error) => {
			console.error(error);
			platform.handleException(error);
		});

		socket.on('close', () => {
			if (socket.device)
				platform.notifyDisconnection(socket.device);
		});

		socket.on('message', (message) => {
			async.waterfall([
				async.constant(message || '{}'),
				async.asyncify(JSON.parse)
			], (error, obj) => {
				if (error || isEmpty(obj.event) || isEmpty(obj.device)) {
					platform.handleException(new Error('Invalid data sent. Data must be a valid JSON String with an "event" field and a "device" field which corresponds to a registered Device ID.'));
					return socket.send('Invalid data sent. Data must be a valid JSON String with an "event" field and a "device" field which corresponds to a registered Device ID.');
				}

				if (isEmpty(authorizedDevices[obj.device])) {
					platform.log(JSON.stringify({
						title: 'WS Gateway - Access Denied. Unauthorized Device',
						device: obj.device
					}));

					return socket.close(1008, 'Unauthorized or unregistered device.');
				}

				if (obj.event === dataEvent) {
					platform.processData(obj.device, message);

					platform.log(JSON.stringify({
						title: 'WS Gateway - Data Received.',
						device: obj.device,
						data: obj
					}));

					if (isEmpty(clients[obj.device])) {
						clients[obj.device] = socket;
						socket.device = obj.device;
					}

					socket.send('Data Received');
				}
				else if (obj.event === messageEvent) {
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

					socket.send('Message Received');
				}
				else if (obj.event === groupMessageEvent) {
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

					socket.send('Group Message Received');
				}
				else {
					platform.handleException(new Error(`Invalid event specified. Event: ${obj.event}`));
					socket.send(`Invalid event specified. Event: ${obj.event}`);
				}
			});
		});
	});

	platform.log(`WS Gateway initialized on port ${port}`);
	platform.notifyReady();
});