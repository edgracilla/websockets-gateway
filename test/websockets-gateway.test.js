/* global describe, it, before, after */
'use strict'

const async = require('async')
const WebSocket = require('ws')
const should = require('should')
const amqp = require('amqplib')
const isEmpty = require('lodash.isempty')
const Broker = require('../node_modules/reekoh/lib/broker.lib')

const PORT = 8182
const PLUGIN_ID = 'demo.gateway'
const BROKER = 'amqp://guest:guest@127.0.0.1/'
const OUTPUT_PIPES = 'demo.outpipe1,demo.outpipe2'
const COMMAND_RELAYS = 'demo.relay1,demo.relay2'

let _ws = null
let _app = null
let _conn = null
let _broker = null
let _channel = null

let conf = {
  port: PORT,
  dataTopic: 'data',
  commandTopic: 'command'
}

describe('WS Gateway', function () {

  before('init', () => {
    process.env.BROKER = BROKER
    process.env.PLUGIN_ID = PLUGIN_ID
    process.env.OUTPUT_PIPES = OUTPUT_PIPES
    process.env.COMMAND_RELAYS = COMMAND_RELAYS
    process.env.CONFIG = JSON.stringify(conf)

    _broker = new Broker()

    amqp.connect(BROKER).then((conn) => {
      _conn = conn
      return conn.createChannel()
    }).then((channel) => {
      _channel = channel
    }).catch((err) => {
      console.log(err)
    })
  })

  after('terminate', function () {
    _conn.close()
  })

  describe('#start', function () {
    it('should start the app', function (done) {
      this.timeout(10000)
      _app = require('../app')

      _app.once('init', () => {
        _ws = new WebSocket('http://127.0.0.1:' + PORT)
        done()
      })
    })
  })

  describe('#test RPC preparation', () => {
    it('should connect to broker', (done) => {
      _broker.connect(BROKER).then(() => {
        return done() || null
      }).catch((err) => {
        done(err)
      })
    })

    it('should spawn temporary RPC server', (done) => {
      // if request arrives this proc will be called
      let sampleServerProcedure = (msg) => {
        // console.log(msg.content.toString('utf8'))
        return new Promise((resolve, reject) => {
          async.waterfall([
            async.constant(msg.content.toString('utf8')),
            async.asyncify(JSON.parse)
          ], (err, parsed) => {
            if (err) return reject(err)
            parsed.foo = 'bar'
            resolve(JSON.stringify(parsed))
          })
        })
      }

      _broker.createRPC('server', 'deviceinfo').then((queue) => {
        return queue.serverConsume(sampleServerProcedure)
      }).then(() => {
        // Awaiting RPC requests
        done()
      }).catch((err) => {
        done(err)
      })
    })
  })

  describe('#data', function () {
    it('should be able to process data', function (done) {
      this.timeout(10000)

      _ws.send(JSON.stringify({
        topic: 'data',
        device: '567827489028375',
        dummy: 'this is test'
      }))

      _ws.once('message', (data) => {
        should.ok(data.toString().startsWith('Data Received'))
        done()
      })
    })
  })

  describe('#command', function () {

    it('should create commandRelay listener', function (done) {
      this.timeout(10000)

      let cmdRelays = `${COMMAND_RELAYS || ''}`.split(',').filter(Boolean)

      async.each(cmdRelays, (cmdRelay, cb) => {
        _channel.consume(cmdRelay, (msg) => {
          if (!isEmpty(msg)) {
            async.waterfall([
              async.constant(msg.content.toString('utf8') || '{}'),
              async.asyncify(JSON.parse)
            ], (err, obj) => {
              if (err) return console.log('parse json err. supplied invalid data')

              let devices = []

              if (Array.isArray(obj.devices)) {
                devices = obj.devices
              } else {
                devices.push(obj.devices)
              }

              // if (obj.deviceGroup) {
                // get devices from platform agent
                // then push to devices[]
              // }

              async.each(devices, (device, cb) => {
                _channel.publish('amq.topic', `${cmdRelay}.topic`, new Buffer(JSON.stringify({
                  sequenceId: obj.sequenceId,
                  commandId: new Date().getTime().toString(), // uniq
                  command: obj.command,
                  device: device
                })))
                cb()
              }, (err) => {
                should.ifError(err)
              })
            })

            // _channel.publish('amq.topic', `${cmdRelay}.topic`, new Buffer(msg.content.toString('utf8')))
          }
          _channel.ack(msg)
        }).then(() => {
          return cb()
        }).catch((err) => {
          should.ifError(err)
        })
      }, done)
    })

    it('should be able to send command (sent to offline device)', function (done) {
      this.timeout(10000)

      _ws.once('message', (data) => {
        should.ok(data.toString().startsWith('Command Received.'))
        done()
      })

      _ws.send(JSON.stringify({
        topic: 'command',
        device: '567827489028375',
        target: '567827489028376', // <-- offline device
        deviceGroup: '',
        command: 'TEST_OFFLINE_COMMAND'
      }))
    })

    it('should be able to recieve command response', function (done) {
      this.timeout(10000)

      let ws2 = new WebSocket('http://127.0.0.1:' + PORT)

      ws2.on('open', () => {
        ws2.send(JSON.stringify({
          topic: 'command',
          device: '567827489028377',
          target: '567827489028375',
          deviceGroup: '',
          command: 'TURNOFF'
        }))

        _app.on('response.ok', (device) => {
          if (device === '567827489028375') done()
        })
      })
    })

    // NOTE!!! below test requires device '567827489028376' to offline in mongo
    // NOTE!!! below test requires device '567827489028376' to offline in mongo
    // NOTE!!! below test requires device '567827489028376' to offline in mongo

    /**
    commented below test. this require redis for saving offline commands
    but tested in local machine
    */

    // it('should be able to recieve offline commands (on boot)', function (done) {
    //   this.timeout(5000)

    //   let called = false
    //   let ws3 = new WebSocket('http://127.0.0.1:' + PORT)

    //   ws3.on('open', () => {
    //     ws3.send(JSON.stringify({
    //       topic: 'data',
    //       device: '567827489028376'
    //     }))

    //     _app.on('response.ok', (device) => {
    //       if (!called && device === '567827489028376') {
    //         called = true
    //         done()
    //       }
    //     })
    //   })
    // })


    /*

    NOTE: not testable yet since we cant pull devices from group yet

    it('should be able to send command to group of device', function (done) {
      this.timeout(10000)

      _ws.send(JSON.stringify({
        topic: 'command',
        deviceGroup: 'group123',
        command: 'ACTIVATE'
      }))

      _app.once('command.ok', () => {
        setTimeout(done, 5000)
      })
    })

    */

  })
})
