const RouterOSAPI = require("node-routeros").RouterOSAPI;
module.exports.GTEL = async function (
  mikrotikHost
  ) {
    const ip = mikrotikHost.split(":")[0]
    const port = mikrotikHost.split(":")[1]
    const access = mikrotikHost.split(":")[2]
    const secret = mikrotikHost.split(":")[3]
    const mkobj = new RouterOSAPI({
      host: ip,
      user: access,
      password: secret,
      port: port,
    });
    return mkobj
}