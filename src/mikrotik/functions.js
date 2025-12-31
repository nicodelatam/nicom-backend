/* eslint-disable no-undef */
const GTEL = require("./mkConnection").GTEL;
module.exports.mkSetClientPlanInformation = async function (
  mikrotikHost,
  input
) {
  const conn = await GTEL(mikrotikHost)
  try {
    await conn.connect();
    if (input.model === 1) {
      // eslint-disable-next-line no-unused-vars
      var com1 = await conn.write("/ppp/secret/getall", [
        "=.proplist=.id",
        "?=name=" + input.code,
      ]);
      var removeActive = await conn.write("/ppp/active/getall", [
        "=.proplist=.id",
        "?=name=" + input.code,
      ]);
    } else {
      // eslint-disable-next-line no-redeclare
      var com1 = await conn.write("/ppp/secret/getall", [
        "=.proplist=.id",
        "?=name=" + input.dni,
      ]);
      // eslint-disable-next-line no-redeclare
      var removeActive = await conn.write("/ppp/active/getall", [
        "=.proplist=.id",
        "?=name=" + input.dni,
      ]);
    }
    if (com1.length > 0) {
      await conn.write("/ppp/secret/set", [
        "=.id=" + com1[0][".id"],
        "=profile=" + input.newClientPlan,
      ]);
      if (input.removeActive) {
        if (removeActive.length > 0) {
          // eslint-disable-next-line no-redeclare
          var removeActive = await conn.write("/ppp/active/remove", [
            "=.proplist=.id",
            "=.id=" + removeActive[0][".id"],
          ]);
        }
      }
      conn.close();
      return true;
    } else {
      conn.close();
      return false;
    }
  } catch (error) {
    console.log(error);
  }
};
module.exports.mkGetMikrotikInfo = async function (mikrotikHost) {
  const conn = await GTEL(mikrotikHost)
  await conn.connect();
  try {
    var com1 = await conn.write("/system/identity/print").catch((error) => {
      conn.close();
      return error;
    });
    var com2 = await conn.write("/system/resource/print");
    conn.close();
    const res = { ...com1[0], ...com2[0] };
    const send = {};
    send.name = res.name;
    send.uptime = res.uptime;
    send.cpu = res["cpu-load"];
    send.memory = res["free-memory"];
    send.version = res.version;
    send.buildtime = res["build-time"];
    send.factorysoftware = res["factory-software"];
    send.totalmemory = res["total-memory"];
    send.cpucount = res["cpu-count"];
    send.cpufrequency = res["cpu-frequency"];
    send.freehddspace = res["free-hdd-space"];
    send.totalhddspace = res["total-hdd-space"];
    send.architecturename = res["architecture-name"];
    send.boardname = res["board-name"];
    send.platform = res.platform;
    return send;
  } catch (error) {
    conn.close();
    return error;
  }
};
module.exports.mkClientStatus = async function (
  mikrotikHost,
  code,
  dni,
  model
) {
  console.log('functions - mkClientStatus')
  /* VAR INIT */
  let client = {
    exists: null,
    online: null,
    mikrotik: null,
    address: null,
    uptime: null,
    lastCallerId: null,
    mac_address: null,
    offlineTime: null,
    disconnectReason: null,
    download: null,
    upload: null,
    errorType: null, // 'timeout', 'connection_error', 'not_found', null
    errorMessage: null,
  };
  
  let conn;
  
  try {
    /* Mikrotik connection init */
    conn = await GTEL(mikrotikHost);
    await conn.connect();
    
    /* Get Current mikrotik identity */
    try {
      var identity = await conn.write("/system/identity/print");
      client.mikrotik = identity[0]?.name || 'unknown';
    } catch (identityError) {
      console.log('Error getting identity:', identityError);
      client.mikrotik = 'unknown';
    }
    
    // Track if we had any timeouts
    let hadTimeout = false;
    
    // Helper function to safely query Mikrotik with timeout
    const safeWrite = async (command, params) => {
      // Use logic conn, allowing it seamlessly handle reconnections
      const timeoutMs = 2000; // 2 segundos de timeout
      
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Command timeout')), timeoutMs);
      });
      
      const writePromise = (async () => {
        try {
          const result = await conn.write(command, params);
          // Check if result is a valid array
          if (Array.isArray(result)) {
            return result;
          }
          return [];
        } catch (error) {
          console.log(`Error executing ${command}:`, error?.message || error);
          return [];
        }
      })();
      
      try {
        return await Promise.race([writePromise, timeoutPromise]);
      } catch (error) {
        console.log(`Timeout or error in ${command}:`, error?.message || error);
        hadTimeout = true;
        return [];
      }
    };
    
    let getSecret = [];
    let getActiveConnection = [];
    let getInterfaceConnection = [];
    let getInterfacePppoeConnection = [];
    let searchIdentifier = null;
    
    // Primero intentar con code si model === 1
    if (model === 1) {
      console.log('Trying with code:', code);
      getSecret = await safeWrite("/ppp/secret/print", ["?=name=" + code]);
      console.log('getSecret:', getSecret);
      // Si encontró con code, continuar con code
      if (getSecret.length > 0) {
        searchIdentifier = code;
        getActiveConnection = await safeWrite("/ppp/active/print", ["?=name=" + code]);
        getInterfaceConnection = await safeWrite("/interface/print", ["?=name=<pppoe-" + code + ">"]);
        getInterfacePppoeConnection = await safeWrite("/interface/pppoe-server/print", ["?=name=<pppoe-" + code + ">"]);
      } else {
        // Fallback: Si no encontró con code, intentar con dni
        // IMPORTANTE: Si la búsqueda anterior falló con UNKNOWNREPLY/timeout, la conexión puede estar corrupta.
        // Forzamos reconexión para asegurar que la búsqueda por DNI tenga un canal limpio.
        console.log('Code not found or compromised connection. Reconnecting before DNI fallback...');
        
        try {
          conn.close();
        } catch (e) {
          console.log('Error closing previous connection:', e);
        }

        // Crear nueva conexión limpia
        conn = await GTEL(mikrotikHost);
        await conn.connect();
        console.log('Reconnected successfully.');

        if (dni) {
          console.log('Trying with dni:', dni);
          getSecret = await safeWrite("/ppp/secret/print", ["?=name=" + dni]);
          if (getSecret.length > 0) {
            searchIdentifier = dni;
            getActiveConnection = await safeWrite("/ppp/active/print", ["?=name=" + dni]);
            getInterfaceConnection = await safeWrite("/interface/print", ["?=name=<pppoe-" + dni + ">"]);
            getInterfacePppoeConnection = await safeWrite("/interface/pppoe-server/print", ["?=name=<pppoe-" + dni + ">"]);
          }
        }
      }
    } else if (dni) {
      // Si model !== 1, buscar directamente con dni
      console.log('Trying with dni:', dni);
      getSecret = await safeWrite("/ppp/secret/print", ["?=name=" + dni]);   
      console.log('getSecret:', getSecret);   
      if (getSecret.length > 0) {
        searchIdentifier = dni;
        getActiveConnection = await safeWrite("/ppp/active/print", ["?=name=" + dni]);
        if (getActiveConnection.length > 0) {
          getInterfaceConnection = await safeWrite("/interface/print", ["?=name=<pppoe-" + dni + ">"]);
          getInterfacePppoeConnection = await safeWrite("/interface/pppoe-server/print", ["?=name=<pppoe-" + dni + ">"]);
        }
      }
    }
    
    // Determine client existence
    if (getSecret.length > 0) {
      client.exists = true;
    } else {
      client.exists = false;
    }

    // Determine online status
    if (getActiveConnection.length > 0 && getInterfaceConnection.length > 0) {
      client.online = true;
    } else {
      client.online = false;
    }

    if (client.exists) {
      if (client.online) {
        client.download = getInterfaceConnection[0]?.["tx-byte"] || null;
        client.upload = getInterfaceConnection[0]?.["rx-byte"] || null;
        client.service = getInterfacePppoeConnection[0]?.["service"] || null;
        client.address = getActiveConnection[0]?.["address"] || null;
        client.mac_address = getActiveConnection[0]?.["caller-id"] || null;
        client.uptime = getActiveConnection[0]?.uptime || null;
        client.profile = getSecret[0]?.["profile"] || null;
      } else {
        const rawOfflineTime = getSecret[0]?.["last-logged-out"];
        let normalizedOfflineTime = null;
        if (rawOfflineTime && typeof rawOfflineTime === 'string') {
          if (rawOfflineTime.includes('/')) {
            normalizedOfflineTime = rawOfflineTime;
          } else if (/^\d{4}-\d{2}-\d{2}/.test(rawOfflineTime)) {
            // Convert YYYY-MM-DD HH:mm:ss to MMM/DD/YYYY HH:mm:ss for frontend compatibility
            try {
              const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
              const [datePart, timePart] = rawOfflineTime.split(' ');
              const [year, month, day] = datePart.split('-');
              const monthName = months[parseInt(month) - 1];
              if (monthName) {
                normalizedOfflineTime = `${monthName}/${day}/${year} ${timePart || '00:00:00'}`;
              }
            } catch (e) {
              console.log('Error normalizing date:', e);
            }
          }
        }

        if (normalizedOfflineTime) {
            client.offlineTime = normalizedOfflineTime;
        } else {
            client.offlineTime = null;
        }
        client.disconnectReason = getSecret[0]?.["last-disconnect-reason"] || null;
        client.lastCallerId = getSecret[0]?.["last-caller-id"] || null;
        client.profile = getSecret[0]?.["profile"] || null;
      }
    } else {
      // No se encontró el cliente
      if (hadTimeout) {
        client.errorType = 'timeout';
        client.errorMessage = 'La consulta tardó demasiado tiempo. Tiempo agotado, intenta de nuevo.';
      } else {
        client.errorType = 'not_found';
        client.errorMessage = `El usuario no existe en la Mikrotik (buscado por ${model === 1 ? 'código y DNI' : 'DNI'}).`;
      }
    }
    
    conn.close();
    return client;
  } catch (error) {
    console.log('mkClientStatus error:', error);
    if (conn) {
      try {
        conn.close();
      } catch (closeError) {
        console.log('Error closing connection:', closeError);
      }
    }
    // Return client object with error info instead of crashing
    client.errorType = 'connection_error';
    client.errorMessage = `Error de conexión con la Mikrotik: ${error?.message || 'Error desconocido'}`;
    return client;
  }
};
module.exports.mkActiveClientCount = async function (cityIpArray) {
  if (cityIpArray.length > 1) {
    const cityActiveClients = [];
    for (let i = 0; i < cityIpArray.length; i++) {
      const conn = await GTEL(mikrotikHost)
      await conn.connect();
      const result = await conn.write("/ppp/active/getall", [
        "=.proplist=name",
      ]);
      conn.close();
      cityActiveClients.push(result);
    }
    return cityActiveClients[0].concat(cityActiveClients[1]);
  } else {
    const conn = new GTEL({
      host: cityIpArray[0],
      user: "remoto",
      password: strapi.config.get("server.admin.mikrotik.secret", "null"),
      port: 48087,
    });
    console.time("mkfind");
    await conn.connect();
    console.timeEnd("mkfind");
    const result2 = await conn.write("/ppp/active/print", ["=.proplist=name"]);
    conn.close();
    return result2;
  }
};
module.exports.mkGetSecrets = async function (mikrotikHost) {
  try {
    const conn = await GTEL(mikrotikHost)
    await conn.connect();
    // eslint-disable-next-line no-unused-vars
    var com1 = await conn.write("/ppp/secret/getall", [
      "=.proplist=last-caller-id,name",
    ]);
    conn.close();
    return com1;
  } catch (error) {
    conn.close();
    return error;
  }
};
module.exports.mkGetComment = async function (mikrotikHost, dni, code, model) {
  try {
    const conn = await GTEL(mikrotikHost)
    await conn.connect();
    if (model === 1) {
      // eslint-disable-next-line no-unused-vars
      var com1 = await conn.write("/ppp/secret/print", [
        "=.proplist=comment",
        "?=name=" + code,
      ]);
    } else {
      // eslint-disable-next-line no-redeclare
      var com1 = await conn.write("/ppp/secret/print", [
        "=.proplist=comment",
        "?=name=" + dni,
      ]);
    }
    conn.close();
    return com1[0];
  } catch (error) {
    conn.close();
    return error;
  }
};
module.exports.mkSetComment = async function (
  mikrotikHost,
  dni,
  code,
  model,
  comment
) {
  const conn = await GTEL(mikrotikHost)
  await conn.connect();
  if (
    comment !== "" &&
    comment != "0" &&
    comment != null &&
    comment != "null"
  ) {
    if (model === 1) {
      // eslint-disable-next-line no-unused-vars
      try {
        var com1 = await conn
          .write("/ppp/secret/set", ["=.id=" + code, "=comment=" + comment])
          .then(() => {
            return true;
          })
          .catch((err) => {
            console.log(err);
            conn.close();
            return false;
          });
      } catch (error) {
        conn.close();
        return error;
      }
    } else {
      try {
        // eslint-disable-next-line no-redeclare
        var com1 = await conn
          .write("/ppp/secret/set", ["=.id=" + dni, "=comment=" + comment])
          .then(() => {
            return true;
          })
          .catch((err) => {
            console.log(err);
            conn.close();
            return false;
          });
      } catch (error) {
        conn.close();
        return error;
      }
    }
  } else {
    conn.close();
    return true;
  }
  conn.close();
  if (com1.length > 0) {
    return true;
  } else {
    return true;
  }
};
module.exports.mkDxClient = async function (input) {
  const conn = await GTEL(mikrotikHost)
  try {
    await conn.connect();
    if (input.model === 1) {
      // eslint-disable-next-line no-unused-vars
      var com1 = await conn.write("/ppp/secret/getall", [
        "=.proplist=.id",
        "?=name=" + input.code,
      ]);
      if (input.kick === 2) {
        var removeActive = await conn.write("/ppp/active/getall", [
          "=.proplist=.id",
          "?=name=" + input.code,
        ]);
      }
    } else {
      // eslint-disable-next-line no-redeclare
      var com1 = await conn.write("/ppp/secret/getall", [
        "=.proplist=.id",
        "?=name=" + input.dni,
      ]);
      if (input.kick === 2) {
        // eslint-disable-next-line no-redeclare
        var removeActive = await conn.write("/ppp/active/getall", [
          "=.proplist=.id",
          "?=name=" + input.dni,
        ]);
      }
    }
    if (com1.length > 0) {
      await conn.write("/ppp/secret/set", [
        "=.id=" + com1[0][".id"],
        "=profile=" + input.planDxMk,
      ]);
      if (input.kick === 2) {
        if (removeActive.length > 0) {
          // eslint-disable-next-line no-redeclare
          var removeActive = await conn.write("/ppp/active/remove", [
            "=.proplist=.id",
            "=.id=" + removeActive[0][".id"],
          ]);
        }
      }
      conn.close();
      return true;
    } else {
      conn.close();
      return false;
    }
  } catch (error) {
    console.log(error);
  }
};
module.exports.createComment = async function (client) {
  const newComment = `${client.code} ${client.technology.name} ${client.neighborhood.name} ${client.address} ${client.name} ${client.dni} ${client.phone} ${client.plan.name} ${client.mac_address} NAP-ONU: ${client.nap_onu_address} POTENCIA: ${client.opticalPower} ${client.wifi_ssid} ${client.wifi_password}`;
  return newComment;
};
