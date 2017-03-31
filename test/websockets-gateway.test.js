/* global describe, it, before, after */
'use strict'

const async = require('async')
const WebSocket = require('ws')
const should = require('should')

const PORT = 8182
const PLUGIN_ID = 'demo.gateway'
const BROKER = 'amqp://guest:guest@127.0.0.1/'
const OUTPUT_PIPES = 'demo.outpipe1,demo.outpipe2'
const COMMAND_RELAYS = 'demo.relay1,demo.relay2'

let _ws = null
let _app = null

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
  })

  after('terminate', function () {

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

    it('should be able to recieve offline commands (on boot)', function (done) {
      this.timeout(5000)

      let called = false
      let ws3 = new WebSocket('http://127.0.0.1:' + PORT)

      ws3.on('open', () => {
        ws3.send(JSON.stringify({
          topic: 'data',
          device: '567827489028376'
        }))

        _app.on('response.ok', (device) => {
          if (!called && device === '567827489028376') {
            called = true
            done()
          }
        })
      })
    })


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
