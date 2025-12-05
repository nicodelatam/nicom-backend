const RouterOSAPI = require("node-routeros").RouterOSAPI;

// Handler global para errores de node-routeros que no pueden ser capturados por try/catch
// UNKNOWNREPLY: ocurre cuando la Mikrotik responde con !empty (no encontró resultados)
// SOCKTMOUT: ocurre cuando la conexión queda colgada después de un UNKNOWNREPLY
let errorHandlerRegistered = false;
if (!errorHandlerRegistered) {
  const handledErrors = ['UNKNOWNREPLY', 'SOCKTMOUT'];
  
  process.on('uncaughtException', (error) => {
    if (handledErrors.includes(error.errno)) {
      // Silenciar estos errores específicos - son esperados en ciertos casos
      console.log(`Mikrotik ${error.errno}:`, error.message);
      return;
    }
    // Re-lanzar otros errores no manejados
    console.error('Uncaught Exception:', error);
    throw error;
  });
  
  // También manejar unhandledRejection por si acaso
  process.on('unhandledRejection', (reason, promise) => {
    if (reason && reason.errno && handledErrors.includes(reason.errno)) {
      console.log(`Mikrotik Promise ${reason.errno}:`, reason.message);
      return;
    }
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });
  
  errorHandlerRegistered = true;
}

module.exports.GTEL = async function (
  mikrotikHost
  ) {
    console.log('mikrotikHost', mikrotikHost)
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