'use strict';

var domain   = require('domain'),
	isEmpty  = require('lodash.isempty'),
	platform = require('./platform'),
	devices  = {},
	clients = {},
	authorizedDevices = {},
	server, port;

/**
 * Emitted when a message or command is received from the platform.
 * @param {object} message The message metadata
 */
platform.on('message', function (message) {
	if (clients[message.device]) {
		clients[message.device].send(message.message, function (error) {
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
		platform.log('Successfully added ' + device._id + ' to the pool of authorized devices.');
	}
	else
		platform.handleException(new Error('Device data invalid. Device not added. ' + device));
});

/**
 * Emitted when a device is removed or deleted from the platform. Can be used to authorize device connections.
 * @param {object} device The details of the device removed from the platform represented as JSON Object.
 */
platform.on('removedevice', function (device) {
	if (!isEmpty(device) && !isEmpty(device._id)) {
		delete devices[device._id];
		platform.log('Successfully removed ' + device._id + ' from the pool of authorized devices.');
	}
	else
		platform.handleException(new Error('Device data invalid. Device not removed. ' + device));
});

/**
 * Emitted when the platform shuts down the plugin. The Gateway should perform cleanup of the resources on this event.
 */
platform.once('close', function () {
	var d = domain.create();

	d.once('error', function (error) {
		console.error('Error closing Websockets Gateway on port ' + port, error);
		platform.handleException(error);
		platform.notifyClose();
		d.exit();
	});

	d.run(function () {
		server.close();
		console.log('Websockets Gateway closed on port ' + port);
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
	var config = require('./config.json');
	var clone  = require('lodash.clone');
	var WebSocketServer = require('ws').Server;

	var dataEvent = options.data_event || config.data_event.default;
	var messageEvent = options.message_event || config.message_event.default;
	var groupMessageEvent = options.groupmessage_event || config.groupmessage_event.default;

	if (!isEmpty(registeredDevices)) {
		var indexBy = require('lodash.indexby');
		var tmpDevices = clone(registeredDevices, true);

		authorizedDevices = indexBy(tmpDevices, '_id');
	}

	port = options.port;
	server = new WebSocketServer({
		port: options.port
	});

	server.on('error', function (error) {
		console.error(error);
		platform.handleException(error);
	});

	server.on('connection', function (socket) {
		socket.on('error', function (error) {
			console.error(error);
			platform.handleException(error);
		});

		socket.on('close', function () {
			if (socket.device)
				platform.notifyDisconnection(socket.device);
		});

		socket.on('message', function (message) {
			var d = domain.create();

			d.once('error', function (error) {
				console.error('Error on message data', error);
				platform.handleException(error);
				d.exit();
			});

			d.run(function () {
				var data = JSON.parse(message);

				if (isEmpty(data.device)) return d.exit();

				if (isEmpty(authorizedDevices[data.device])) {
					platform.log(JSON.stringify({
						title: 'Unauthorized Device',
						device: data.device
					}));

					socket.close(1008, 'Unauthorized or unregistered device.');

					return d.exit();
				}
				else
					platform.notifyConnection(data.device);

				if (data.type === dataEvent) {
					platform.processData(data.device, message);
					platform.log(JSON.stringify({
						title: 'Data Received.',
						device: data.device,
						data: data
					}));

					if (isEmpty(clients[data.device])) {
						clients[data.device] = socket;
						socket.device = data.device;
					}
				}
				else if (data.type === messageEvent) {
					if (isEmpty(data.target) || isEmpty(data.message)) {
						socket.send('Invalid message');
					}
					else {
						platform.sendMessageToDevice(data.target, data.message);
						platform.log(JSON.stringify({
							title: 'Message Sent.',
							source: data.device,
							target: data.target,
							message: data.message
						}));
					}
				}
				else if (data.type === groupMessageEvent) {
					if (isEmpty(data.target) || isEmpty(data.message)) {
						socket.send('Invalid group message');
					}
					else {
						platform.sendMessageToGroup(data.target, data.message);
						platform.log(JSON.stringify({
							title: 'Group Message Sent.',
							source: data.device,
							target: data.target,
							message: data.message
						}));
					}
				}

				d.exit();
			});
		});
	});

	platform.log('Websockets Gateway initialized on port ' + port);
	platform.notifyReady();
});