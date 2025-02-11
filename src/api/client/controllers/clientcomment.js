'use strict';

/**
 * A set of functions called "actions" for `clientcomment`
 */
const { mkSetComment } = require('../../../mikrotik/mkSetComment')
module.exports = {
  async setclientcomment(ctx) {
    const client = ctx.request.body.data
    let searchCity = await strapi.service('api::city.city').find({
      filters: {
        name: {
          $eq: client.city.name
        }
      }, populate: ['mikrotiks']
    })
    searchCity = searchCity.results[0]
    const process = []
    if (searchCity.mikrotiks.length > 1) {
      for (let i = 0; i < searchCity.mikrotiks.length; i++) {
        const mikrotikHost = searchCity.mikrotiks[i].ip
        const resMk = await mkSetComment({ dni: client.dni, code: client.code, mikrotikHost, model: client.newModel, comment: createComment(client) })
        if ( resMk) {
          process.push({ code: client.code, name: client.name, success: true })
        } else {
          process.push({ code: client.code, name: client.name, success: false })
        }
      }
      return process
    } else {
      const mikrotikHost = searchCity.mikrotiks[0].ip
      const resMk = await mkSetComment({ dni: client.dni, code: client.code, mikrotikHost, model: client.newModel, comment: createComment(client) })
      if (resMk) {
        process.push({ code: client.code, name: client.name, success: true })
      } else {
        process.push({ code: client.code, name: client.name, success: false })
      }
      return process
    }
  },
};
function createComment (client) {
  const newComment = `${client.code} FTTH ${client.neighborhood} ${client.address} ${client.client_name} ${client.dni} ${client.phone} ${client.offer?.name} ${client.wifi_ssid} ${client.wifi_password}`
  return newComment;
};
