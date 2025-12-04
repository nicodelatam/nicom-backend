'use strict';

/**
 * A set of functions called "actions" for `admincreate`
 */
const fetch = require('node-fetch');
module.exports = {
  async getMedia(ctx) {
    const mediaid = ctx.request.query.mediaid
    const meta_api_version = ctx.request.query.meta_api_version
    const meta_token = ctx.request.query.meta_token
    const res = await fetch(`https://graph.facebook.com/${meta_api_version}/${mediaid}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${meta_token}`
          }
        })
          .then(response => response.json())
          .then(async (data) => {
            if (data.error) {
              return {
                status: 403
              }
            }
            const binaryMedia = await fetch(`${data.url}`, {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${process.env.META_TOKEN}`
              }
            })
              .then(async (mediaData) => {
                const binary = Buffer.from(await mediaData.arrayBuffer())
                return binary
              })
            return binaryMedia
          })
    return res
  }
};
