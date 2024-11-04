const GTEL = require("./mkConnection").GTEL;
module.exports.mkGetSecrets = async function (mikrotikHost) {
  try {
    const conn = await GTEL(mikrotikHost)
    await conn.connect().catch((err) => {
      conn.close();
      console.log(err);
    });
    // eslint-disable-next-line no-unused-vars
    var com1 = await conn.write("/ppp/secret/getall", [
      "=.proplist=last-caller-id,name,profile,last-logged-out",
    ]).catch((err) => {
      conn.close();
      console.log(err);
    });
    conn.close();
    return com1;
  } catch (error) {
    conn.close();
    console.log(error)
    return error;
  }
};