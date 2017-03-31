'use strict'

const reekoh = require('reekoh')
const plugin = new reekoh.plugins.Gateway()

const async = require('async')
const isEmpty = require('lodash.isempty')

let clients = {}
let server
let port

plugin.once('ready', () => {
  let WebSocketServer = require('ws').Server
  let commandTopic = plugin.config.commandTopic
  let dataTopic = plugin.config.dataTopic

  port = plugin.config.port
  server = new WebSocketServer({
    port: port
  })

  server.once('error', (error) => {
    console.error('Websocket Gateway Error', error)
    plugin.logException(error)

    setTimeout(() => {
      server.close(() => {
        plugin.log(`Websocket Gateway closed on port ${port}`)
        server.removeAllListeners()
        process.exit()
      })
    }, 5000)
  })

  server.once('listening', () => {
    plugin.log(`Websocket Gateway initialized on port ${port}`)
    plugin.emit('init')
  })

  server.on('connection', (socket) => {
    let errMsg = null

    let handleErr = (err) => {
      if (err) {
        console.error(err)
        plugin.logException(err)
      }
    }

    socket.on('error', handleErr)

    socket.once('close', () => {
      if (socket.device) plugin.notifyDisconnection(socket.device)

      setTimeout(() => {
        socket.removeAllListeners()
      }, 5000)
    })

    socket.on('message', (message) => {
      async.waterfall([
        async.constant(message || '{}'),
        async.asyncify(JSON.parse)
      ], (error, obj) => {
        if (error || isEmpty(obj.topic) || (isEmpty(obj.device) && isEmpty(obj.deviceGroup))) {
          errMsg = 'Invalid data sent. Must be a valid JSON String with a "topic" field and a "device" field which corresponds to a registered Device ID.'
          plugin.logException(new Error(errMsg))
          return socket.close(1003, errMsg)
        }

        if (isEmpty(clients[obj.device])) {
          socket.device = obj.device
          clients[obj.device] = socket
          plugin.notifyConnection(obj.device)
        }

        plugin.requestDeviceInfo(obj.device).then((deviceInfo) => {
          if (isEmpty(deviceInfo)) {
            plugin.log(JSON.stringify({
              title: 'WS Gateway - Access Denied. Unauthorized Device',
              device: obj.device
            }))

            return socket.close(1003, `Device not registered. Device ID: ${obj.device}\n`)
          }

          if (obj.topic === dataTopic) {
            return plugin.pipe(obj).then(() => {
              return plugin.log(JSON.stringify({
                title: 'WS Gateway - Data Received (data topic)',
                device: obj.device,
                data: obj
              })).then(() => {
                socket.send('Data Received')
              })
            }).catch(handleErr)
          } else if (obj.topic === commandTopic) {
            if (isEmpty(obj.command) || (isEmpty(obj.device) && isEmpty(obj.deviceGroup))) {
              errMsg = 'Invalid message or command. Message must be a valid JSON String with "device" or "deviceGroup" and "command" fields. "device" is the a registered Device ID. "command" is the payload.'

              return plugin
                .logException(new Error(errMsg))
                .then(() => socket.send(errMsg))
            }

            return plugin.relayCommand(obj.command, obj.target, obj.deviceGroup, obj.device).then(() => {
              return plugin.log(JSON.stringify({
                title: 'WS Gateway - Message Received (command topic)',
                deviceGroup: obj.deviceGroup,
                device: obj.device,
                command: obj.command
              })).then(() => {
                socket.send(`Command Received. Device ID: ${obj.device}. Message: ${message}\n`)
              })
            }).catch(handleErr)
          } else {
            errMsg = `Invalid topic specified. Topic: ${obj.topic}`
            return plugin.logException(new Error(errMsg))
              .then(() => socket.close(1003, errMsg))
          }
        }).catch(handleErr)
      })
    })
  })
})

plugin.on('command', (msg) => {
  // console.log(msg)
  if (clients[msg.device]) {
    clients[msg.device].send(`${msg.command}\n`, (error) => {
      if (error) return plugin.logException(error)

      plugin.sendCommandResponse(msg.commandId, 'Message Sent').then(() => {
        plugin.emit('response.ok', msg.device)

        plugin.log(JSON.stringify({
          title: 'Message Sent',
          device: msg.device,
          commandId: msg.commandId,
          command: msg.command
        }))
      })
    })
  }
})

module.exports = plugin
