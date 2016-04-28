'use strict';

const PORT       = 8080,
	  CLIENT_ID1 = '567827489028375',
	  CLIENT_ID2 = '567827489028376';

var cp        = require('child_process'),
	should    = require('should'),
	WebSocket = require('ws'),
	wsGateway;

describe('WS Gateway', function () {
	this.slow(8000);

	after('terminate child process', function () {
		this.timeout(5000);

		wsGateway.send({
			type: 'close'
		});

		setTimeout(function () {
			wsGateway.kill('SIGKILL');
		}, 4500);
	});

	describe('#spawn', function () {
		it('should spawn a child process', function () {
			should.ok(wsGateway = cp.fork(process.cwd()), 'Child process not spawned.');
		});
	});

	describe('#handShake', function () {
		it('should notify the parent process when ready within 8 seconds', function (done) {
			this.timeout(8000);

			wsGateway.on('message', function (message) {
				if (message.type === 'ready')
					done();
				else if (message.type === 'requestdeviceinfo') {
					if (message.data.deviceId === CLIENT_ID1 || message.data.deviceId === CLIENT_ID2) {
						
					}
				}
			});

			wsGateway.send({
				type: 'ready',
				data: {
					options: {
						port: PORT
					}
				}
			}, function (error) {
				should.ifError(error);
			});
		});
	});

	describe('#message', function () {
		it('should be able to process data', function (done) {
			this.timeout(5000);

			var url = 'http://127.0.0.1:' + PORT + '/data';
			var ws = new WebSocket(url);

			ws.on('open', function () {
				ws.send(JSON.stringify({
					type: 'data',
					device: '567827489028375',
					co2: '11%',
					o2: '20%'
				}));
			});

			setTimeout(function () {
				done();
			}, 2000);
		});
	});
});